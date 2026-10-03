-- =====================================================================================
-- 0004 — Business RPCs: payments and stock/sales (transactional, authorization inside).
--
-- ADDITIVE. 0001–0003 are not edited.
--
-- Rules every function here follows:
--   * SECURITY DEFINER with a fixed search_path. The function owner bypasses RLS, so EVERY
--     function checks the caller itself: auth.uid() must be set and the caller must hold a role
--     through public.has_any_role() (which requires an active account, migration 0002).
--     A role name supplied by the browser is never trusted.
--   * Money is NUMERIC(12,2) / NUMERIC(10,2) in the schema and in every calculation here.
--     No floating point.
--   * Row locks: parents and parts are locked FOR UPDATE in a deterministic order (ascending
--     id) so concurrent transactions cannot deadlock or oversell.
--   * Idempotency: create_sale and create_payment accept a client_request_id. A retry with the
--     same id returns the existing row; the same id with different data is rejected.
--   * Any exception rolls back the whole call, so a multi-line sale or a multi-sale payment post
--     is all-or-nothing.
--   * Every successful state change writes one row through write_audit_log().
--   * EXECUTE is revoked from PUBLIC and anon and granted to authenticated only. Authorization
--     is still enforced inside each body.
--
-- Error codes used: 42501 forbidden, 22023 invalid input, P0001 business-rule violation.
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- 1. Schema additions (additive only)
-- ---------------------------------------------------------------------------------------
alter table public.sales add column if not exists client_request_id uuid;
create unique index if not exists sales_client_request_id_key
  on public.sales (client_request_id) where client_request_id is not null;

create unique index if not exists payments_client_request_id_key
  on public.payments (client_request_id) where client_request_id is not null;

-- One allocation per (payment, sale). A retried allocate call cannot double-allocate.
create unique index if not exists payment_allocations_payment_sale_key
  on public.payment_allocations (payment_id, sale_id);

create index if not exists inventory_reservations_active_part_idx
  on public.inventory_reservations (part_id) where status = 'active';
create index if not exists inventory_reservations_sale_idx
  on public.inventory_reservations (sale_id);

-- ---------------------------------------------------------------------------------------
-- 2. Shared helpers
-- ---------------------------------------------------------------------------------------

-- Caller must be authenticated AND hold a sales-side role (owner, engineer_admin, manager).
create or replace function public._rpc_require_sales_staff()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.is_sales_staff() then
    raise exception 'forbidden: a sales role is required for this action' using errcode = '42501';
  end if;
end;
$$;

-- Caller must be owner or engineer_admin. Used for posted-payment reversals.
create or replace function public._rpc_require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'forbidden: owner or engineer admin is required for this action' using errcode = '42501';
  end if;
end;
$$;

-- Validates a money input: positive, at most 2 decimal places, within the NUMERIC(10,2) range.
create or replace function public._require_money_positive(p_value numeric, p_field text)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_value is null or p_value <= 0 then
    raise exception '% must be greater than zero', p_field using errcode = '22023';
  end if;
  if p_value <> round(p_value, 2) then
    raise exception '% may have at most 2 decimal places', p_field using errcode = '22023';
  end if;
  if p_value >= 100000000 then
    raise exception '% is too large', p_field using errcode = '22023';
  end if;
end;
$$;

create or replace function public._payment_json(p public.payments)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'customer_id', p.customer_id,
    'amount', p.amount,
    'method', p.method,
    'status', p.status,
    'posted_at', p.posted_at,
    'voided_at', p.voided_at
  );
$$;

-- Payment status for a sale from its money totals. Mirrors the CHECK on sales.payment_status.
create or replace function public._payment_status_for(p_total numeric, p_paid numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_paid <= 0 then 'UNPAID'
    when p_paid >= p_total then 'PAID'
    else 'PARTIAL'
  end;
$$;

-- Fulfillment status for a sale, derived from its part-backed lines. A line counts as fulfilled
-- only when its stock_action is 'fulfill'. Reserved lines are not fulfilled yet.
create or replace function public._recalc_sale_fulfillment(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part_lines int;
  v_fulfilled int;
  v_status text;
begin
  select count(*) filter (where part_id is not null),
         count(*) filter (where part_id is not null and stock_action = 'fulfill')
    into v_part_lines, v_fulfilled
    from public.sale_items
   where sale_id = p_sale_id;

  v_status := case
    when v_part_lines > 0 and v_fulfilled = v_part_lines then 'fulfilled'
    when v_fulfilled > 0 then 'partial'
    else 'unfulfilled'
  end;

  update public.sales set fulfillment_status = v_status where id = p_sale_id;
end;
$$;

-- Keeps parts.operational_status consistent with quantity and active reservations. Only the
-- AVAILABLE / RESERVED / SOLD states are derived here. DAMAGED / RETURNED / MISSING are set by
-- people and are never overwritten.
create or replace function public._sync_part_operational_status(p_part_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty int;
  v_status text;
  v_active int;
begin
  select quantity, operational_status into v_qty, v_status from public.parts where id = p_part_id;
  if v_status not in ('AVAILABLE', 'RESERVED', 'SOLD') then
    return;
  end if;
  select coalesce(sum(quantity), 0) into v_active
    from public.inventory_reservations
   where part_id = p_part_id and status = 'active';

  update public.parts
     set operational_status = case
           when v_qty = 0 then 'SOLD'
           when v_qty - v_active <= 0 then 'RESERVED'
           else 'AVAILABLE'
         end,
         updated_at = now()
   where id = p_part_id;
end;
$$;

-- Available-to-sell for a part = physical quantity minus active reservations. Read under the
-- caller's part lock, never from browser state.
create or replace function public._available_quantity(p_part_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select p.quantity - coalesce((
    select sum(r.quantity) from public.inventory_reservations r
     where r.part_id = p.id and r.status = 'active'
  ), 0)
  from public.parts p where p.id = p_part_id;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. PAYMENTS
-- ---------------------------------------------------------------------------------------

-- create_payment: records a PENDING payment. It never touches sales balances.
create or replace function public.create_payment(
  p_customer_id      uuid,
  p_amount           numeric,
  p_method           text,
  p_reference        text default '',
  p_notes            text default '',
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.payments%rowtype;
  v_row public.payments%rowtype;
begin
  perform public._rpc_require_sales_staff();
  perform public._require_money_positive(p_amount, 'amount');

  if p_method not in ('CASH','CARD','CHECK','BANK_TRANSFER','QR_CODE','PAYMENT_LINK','OTHER') then
    raise exception 'unknown payment method' using errcode = '22023';
  end if;
  if char_length(coalesce(p_reference, '')) > 200 or char_length(coalesce(p_notes, '')) > 2000 then
    raise exception 'reference or notes is too long' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = '22023';
  end if;

  if p_client_request_id is not null then
    select * into v_existing from public.payments where client_request_id = p_client_request_id;
    if found then
      if v_existing.customer_id <> p_customer_id or v_existing.amount <> p_amount then
        raise exception 'client_request_id was already used for a different payment' using errcode = '22023';
      end if;
      return public._payment_json(v_existing);
    end if;
  end if;

  insert into public.payments (customer_id, amount, method, reference, notes, status, received_by, client_request_id)
  values (p_customer_id, p_amount, p_method, coalesce(p_reference, ''), coalesce(p_notes, ''), 'pending', auth.uid(), p_client_request_id)
  returning * into v_row;

  perform public.write_audit_log(
    'payment.create', 'payment', v_row.id, 'Payment created (pending)',
    jsonb_build_object('amount', p_amount, 'method', p_method, 'customer_id', p_customer_id),
    null, p_client_request_id);

  return public._payment_json(v_row);
end;
$$;

-- allocate_payment: attaches part of a PENDING payment to a sale. Still does not touch sale money.
create or replace function public.allocate_payment(
  p_payment_id uuid,
  p_sale_id    uuid,
  p_amount     numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
  v_sale public.sales%rowtype;
  v_existing public.payment_allocations%rowtype;
  v_alloc_total numeric;
  v_other_pending numeric;
  v_outstanding numeric;
  v_row public.payment_allocations%rowtype;
begin
  perform public._rpc_require_sales_staff();
  perform public._require_money_positive(p_amount, 'allocation amount');

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment not found' using errcode = '22023';
  end if;
  if v_pay.status <> 'pending' then
    raise exception 'only a pending payment can be allocated (status is %)', v_pay.status using errcode = 'P0001';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'sale not found' using errcode = '22023';
  end if;
  if v_sale.status = 'CANCELLED' then
    raise exception 'cannot allocate to a cancelled sale' using errcode = 'P0001';
  end if;
  if v_sale.customer_id <> v_pay.customer_id then
    raise exception 'payment and sale belong to different customers' using errcode = 'P0001';
  end if;

  -- Idempotent retry: the same (payment, sale) pair with the same amount returns the existing row.
  select * into v_existing from public.payment_allocations where payment_id = p_payment_id and sale_id = p_sale_id;
  if found then
    if v_existing.amount <> p_amount then
      raise exception 'this sale is already allocated from this payment with a different amount' using errcode = 'P0001';
    end if;
    return jsonb_build_object('allocation_id', v_existing.id, 'payment_id', p_payment_id, 'sale_id', p_sale_id, 'amount', v_existing.amount, 'idempotent_replay', true);
  end if;

  select coalesce(sum(amount), 0) into v_alloc_total from public.payment_allocations where payment_id = p_payment_id;
  if v_alloc_total + p_amount > v_pay.amount then
    raise exception 'allocations would exceed the payment amount (% remaining)', v_pay.amount - v_alloc_total using errcode = 'P0001';
  end if;

  -- Outstanding balance = total - already posted payments - allocations still pending on OTHER payments.
  select coalesce(sum(pa.amount), 0) into v_other_pending
    from public.payment_allocations pa
    join public.payments pp on pp.id = pa.payment_id
   where pa.sale_id = p_sale_id and pp.status = 'pending' and pa.payment_id <> p_payment_id;

  v_outstanding := v_sale.total - v_sale.amount_paid - v_other_pending;
  if p_amount > v_outstanding then
    raise exception 'allocation exceeds the outstanding balance (% available)', v_outstanding using errcode = 'P0001';
  end if;

  insert into public.payment_allocations (payment_id, sale_id, amount)
  values (p_payment_id, p_sale_id, p_amount)
  returning * into v_row;

  perform public.write_audit_log(
    'payment.allocate', 'payment', p_payment_id, 'Payment allocated to sale',
    jsonb_build_object('sale_id', p_sale_id, 'amount', p_amount), null, null);

  return jsonb_build_object('allocation_id', v_row.id, 'payment_id', p_payment_id, 'sale_id', p_sale_id, 'amount', v_row.amount, 'idempotent_replay', false);
end;
$$;

-- post_payment: the only path that changes sales.amount_paid / balance_due / payment_status for a
-- payment. Atomic across every allocated sale.
create or replace function public.post_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
  v_alloc record;
  v_sale public.sales%rowtype;
  v_new_paid numeric;
  v_alloc_total numeric := 0;
  v_summaries jsonb := '[]'::jsonb;
begin
  perform public._rpc_require_sales_staff();

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment not found' using errcode = '22023';
  end if;
  if v_pay.status = 'posted' then
    raise exception 'payment is already posted' using errcode = 'P0001';
  end if;
  if v_pay.status <> 'pending' then
    raise exception 'only a pending payment can be posted (status is %)', v_pay.status using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_alloc_total from public.payment_allocations where payment_id = p_payment_id;
  if v_alloc_total <> v_pay.amount then
    raise exception 'allocate the full payment amount before posting (allocated % of %)', v_alloc_total, v_pay.amount using errcode = 'P0001';
  end if;

  -- Lock every affected sale in ascending id order, then apply the allocation.
  for v_alloc in
    select pa.sale_id, pa.amount
      from public.payment_allocations pa
     where pa.payment_id = p_payment_id
     order by pa.sale_id
  loop
    select * into v_sale from public.sales where id = v_alloc.sale_id for update;
    if v_sale.status = 'CANCELLED' then
      raise exception 'sale % is cancelled and cannot receive payment', v_sale.id using errcode = 'P0001';
    end if;

    v_new_paid := v_sale.amount_paid + v_alloc.amount;
    if v_new_paid > v_sale.total then
      raise exception 'posting would overpay sale % (total %, already paid %)', v_sale.id, v_sale.total, v_sale.amount_paid using errcode = 'P0001';
    end if;

    update public.sales
       set amount_paid = v_new_paid,
           balance_due = v_sale.total - v_new_paid,
           payment_status = public._payment_status_for(v_sale.total, v_new_paid)
     where id = v_sale.id;

    v_summaries := v_summaries || jsonb_build_object(
      'sale_id', v_sale.id, 'amount_paid', v_new_paid,
      'balance_due', v_sale.total - v_new_paid,
      'payment_status', public._payment_status_for(v_sale.total, v_new_paid));
  end loop;

  update public.payments
     set status = 'posted', posted_at = now(), posted_by = auth.uid()
   where id = p_payment_id
   returning * into v_pay;

  perform public.write_audit_log(
    'payment.post', 'payment', p_payment_id, 'Payment posted',
    jsonb_build_object('amount', v_pay.amount, 'sales', v_summaries), null, null);

  return jsonb_build_object('payment', public._payment_json(v_pay), 'sales', v_summaries);
end;
$$;

-- void_payment: corrections. A pending payment is voided by sales staff. A POSTED payment is
-- reversed (sale money restored) and voided by owner / engineer admin only, with a reason.
-- Rows are never deleted: allocations stay as history.
create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
  v_alloc record;
  v_sale public.sales%rowtype;
  v_new_paid numeric;
  v_summaries jsonb := '[]'::jsonb;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a reason of at least 5 characters is required' using errcode = '22023';
  end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment not found' using errcode = '22023';
  end if;
  if v_pay.status = 'void' then
    return public._payment_json(v_pay);  -- idempotent retry
  end if;

  if v_pay.status = 'posted' then
    perform public._rpc_require_admin();
  else
    perform public._rpc_require_sales_staff();
  end if;

  if v_pay.status = 'posted' then
    for v_alloc in
      select pa.sale_id, pa.amount from public.payment_allocations pa
       where pa.payment_id = p_payment_id order by pa.sale_id
    loop
      select * into v_sale from public.sales where id = v_alloc.sale_id for update;
      v_new_paid := v_sale.amount_paid - v_alloc.amount;
      if v_new_paid < 0 then
        raise exception 'reversal would make sale % paid amount negative; inconsistent ledger', v_sale.id using errcode = 'P0001';
      end if;
      update public.sales
         set amount_paid = v_new_paid,
             balance_due = v_sale.total - v_new_paid,
             payment_status = public._payment_status_for(v_sale.total, v_new_paid)
       where id = v_sale.id;
      v_summaries := v_summaries || jsonb_build_object('sale_id', v_sale.id, 'amount_paid', v_new_paid);
    end loop;
  end if;

  update public.payments
     set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_payment_id
   returning * into v_pay;

  perform public.write_audit_log(
    'payment.void', 'payment', p_payment_id, 'Payment voided',
    jsonb_build_object('previously_posted', v_summaries <> '[]'::jsonb, 'sales', v_summaries),
    btrim(p_reason), null);

  return public._payment_json(v_pay);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. SALES AND STOCK
-- ---------------------------------------------------------------------------------------

-- create_sale: one sale with all its lines, in one transaction.
--   p_mode 'draft'      -> no stock change; part lines have stock_action 'none'
--   p_mode 'reserve'    -> physical quantity stays; an active reservation per part line
--   p_mode 'fulfill_now'-> stock consumed immediately; each part line is 'fulfill'
-- p_lines: [{ "part_id": uuid|null, "description": text, "quantity": int, "unit_price": numeric }]
create or replace function public.create_sale(
  p_customer_id      uuid,
  p_lines            jsonb,
  p_mode             text,
  p_client_request_id uuid default null,
  p_notes            text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.sales%rowtype;
  v_sale public.sales%rowtype;
  v_rate numeric := 0;
  v_line jsonb;
  v_item public.sale_items%rowtype;
  v_part record;
  v_qty int;
  v_price numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_count int;
  v_part_ids uuid[];
  v_need record;
  v_avail int;
  v_stock_action text;
  v_part_qty int;
begin
  perform public._rpc_require_sales_staff();

  if p_mode not in ('draft', 'reserve', 'fulfill_now') then
    raise exception 'mode must be draft, reserve or fulfill_now' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = '22023';
  end if;
  if char_length(coalesce(p_notes, '')) > 2000 then
    raise exception 'notes is too long' using errcode = '22023';
  end if;

  if p_client_request_id is not null then
    select * into v_existing from public.sales where client_request_id = p_client_request_id;
    if found then
      if v_existing.customer_id <> p_customer_id then
        raise exception 'client_request_id was already used for a different sale' using errcode = '22023';
      end if;
      return jsonb_build_object('sale_id', v_existing.id, 'total', v_existing.total, 'fulfillment_status', v_existing.fulfillment_status, 'idempotent_replay', true);
    end if;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale needs at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'a sale may have at most 200 lines' using errcode = '22023';
  end if;

  -- Validate every line before writing anything.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(v_line->>'description', '') = '' and (v_line->>'part_id') is null then
      raise exception 'each line needs a description or a part' using errcode = '22023';
    end if;
    if (v_line->>'quantity') is null or (v_line->>'quantity')::numeric <> trunc((v_line->>'quantity')::numeric)
       or (v_line->>'quantity')::int <= 0 then
      raise exception 'line quantity must be a whole number greater than zero' using errcode = '22023';
    end if;
    if (v_line->>'unit_price') is null or (v_line->>'unit_price')::numeric < 0
       or (v_line->>'unit_price')::numeric <> round((v_line->>'unit_price')::numeric, 2) then
      raise exception 'line unit price must be zero or positive with at most 2 decimals' using errcode = '22023';
    end if;
  end loop;

  -- Lock every referenced part in ascending id order, then check availability per part.
  select coalesce(array_agg(distinct (x.part_id) order by (x.part_id)), '{}')
    into v_part_ids
    from (select (e->>'part_id')::uuid as part_id from jsonb_array_elements(p_lines) e where (e->>'part_id') is not null) x;

  if p_mode in ('reserve', 'fulfill_now') and array_length(v_part_ids, 1) > 0 then
    perform 1 from public.parts where id = any(v_part_ids) order by id for update;

    for v_need in
      select (e->>'part_id')::uuid as part_id, sum((e->>'quantity')::int) as qty
        from jsonb_array_elements(p_lines) e
       where (e->>'part_id') is not null
       group by 1 order by 1
    loop
      if not exists (select 1 from public.parts where id = v_need.part_id) then
        raise exception 'part % not found', v_need.part_id using errcode = '22023';
      end if;
      select public._available_quantity(v_need.part_id) into v_avail;
      if v_avail < v_need.qty then
        raise exception 'insufficient stock for part %: available %, requested %', v_need.part_id, greatest(v_avail, 0), v_need.qty using errcode = 'P0001';
      end if;
    end loop;
  end if;

  select coalesce((select tax_rate from public.sales_settings where id = (select min(id) from public.sales_settings)), 0)
    into v_rate;

  insert into public.sales (customer_id, salesperson_id, tax_rate, notes, client_request_id, status)
  values (p_customer_id, auth.uid(), v_rate, coalesce(p_notes, ''), p_client_request_id, 'OPEN')
  returning * into v_sale;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::int;
    v_price := (v_line->>'unit_price')::numeric;
    v_line_total := round(v_qty * v_price, 2);
    v_subtotal := v_subtotal + v_line_total;

    v_stock_action := 'none';
    if (v_line->>'part_id') is not null then
      v_stock_action := case p_mode when 'reserve' then 'reserve' when 'fulfill_now' then 'fulfill' else 'none' end;
    end if;

    insert into public.sale_items (sale_id, part_id, description, quantity, unit_price, line_total, stock_action)
    values (
      v_sale.id,
      (v_line->>'part_id')::uuid,
      coalesce(nullif(v_line->>'description', ''), 'Part'),
      v_qty, v_price, v_line_total, v_stock_action
    )
    returning * into v_item;

    if v_stock_action = 'reserve' then
      insert into public.inventory_reservations (part_id, sale_id, sale_item_id, quantity, status, created_by)
      values (v_item.part_id, v_sale.id, v_item.id, v_qty, 'active', auth.uid());

    elsif v_stock_action = 'fulfill' then
      select quantity into v_part_qty from public.parts where id = v_item.part_id for update;
      update public.parts set quantity = v_part_qty - v_qty, updated_at = now() where id = v_item.part_id;
      update public.sale_items set previous_quantity = v_part_qty, new_quantity = v_part_qty - v_qty where id = v_item.id;
      perform public._sync_part_operational_status(v_item.part_id);
    end if;
  end loop;

  update public.sales
     set subtotal = v_subtotal,
         tax = round(v_subtotal * v_rate, 2),
         total = v_subtotal + round(v_subtotal * v_rate, 2),
         balance_due = v_subtotal + round(v_subtotal * v_rate, 2)
   where id = v_sale.id
   returning * into v_sale;

  perform public._recalc_sale_fulfillment(v_sale.id);

  select count(*) into v_count from public.sale_items where sale_id = v_sale.id;
  perform public.write_audit_log(
    'sale.create', 'sale', v_sale.id, 'Sale created (' || p_mode || ')',
    jsonb_build_object('mode', p_mode, 'lines', v_count, 'total', v_sale.total, 'customer_id', p_customer_id),
    null, p_client_request_id);

  return jsonb_build_object('sale_id', v_sale.id, 'total', v_sale.total, 'lines', v_count,
                            'fulfillment_status', (select fulfillment_status from public.sales where id = v_sale.id),
                            'idempotent_replay', false);
end;
$$;

-- reserve_stock: reserves every draft part line of an OPEN sale. Physical quantity is unchanged.
create or replace function public.reserve_stock(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_item record;
  v_avail int;
  v_reserved int := 0;
  v_part_ids uuid[];
  v_pid uuid;
begin
  perform public._rpc_require_sales_staff();

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'sale not found' using errcode = '22023';
  end if;
  if v_sale.status <> 'OPEN' then
    raise exception 'only an open sale can reserve stock (status is %)', v_sale.status using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct part_id order by part_id), '{}') into v_part_ids
    from public.sale_items where sale_id = p_sale_id and stock_action = 'none' and part_id is not null;

  if array_length(v_part_ids, 1) is null then
    return jsonb_build_object('sale_id', p_sale_id, 'reserved_lines', 0, 'idempotent_replay', true);
  end if;

  perform 1 from public.parts where id = any(v_part_ids) order by id for update;

  -- Check availability per part for the total requested by this sale's draft lines.
  for v_item in
    select part_id, sum(quantity) as qty from public.sale_items
     where sale_id = p_sale_id and stock_action = 'none' and part_id is not null
     group by part_id order by part_id
  loop
    select public._available_quantity(v_item.part_id) into v_avail;
    if v_avail < v_item.qty then
      raise exception 'insufficient stock for part %: available %, requested %', v_item.part_id, greatest(v_avail, 0), v_item.qty using errcode = 'P0001';
    end if;
  end loop;

  for v_item in
    select id, part_id, quantity from public.sale_items
     where sale_id = p_sale_id and stock_action = 'none' and part_id is not null
     order by id
  loop
    insert into public.inventory_reservations (part_id, sale_id, sale_item_id, quantity, status, created_by)
    values (v_item.part_id, p_sale_id, v_item.id, v_item.quantity, 'active', auth.uid());
    update public.sale_items set stock_action = 'reserve' where id = v_item.id;
    v_reserved := v_reserved + 1;
  end loop;

  foreach v_pid in array v_part_ids loop
    perform public._sync_part_operational_status(v_pid);
  end loop;

  perform public._recalc_sale_fulfillment(p_sale_id);
  perform public.write_audit_log('stock.reserve', 'sale', p_sale_id, 'Stock reserved for sale',
    jsonb_build_object('reserved_lines', v_reserved), null, null);

  return jsonb_build_object('sale_id', p_sale_id, 'reserved_lines', v_reserved, 'idempotent_replay', false);
end;
$$;

-- release_reservation: releases every active reservation of a sale. Nothing was consumed, so no
-- physical quantity changes. The lines return to draft.
create or replace function public.release_reservation(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_res record;
  v_pid uuid;
  v_part_ids uuid[];
  v_released int := 0;
begin
  perform public._rpc_require_sales_staff();

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'sale not found' using errcode = '22023';
  end if;

  -- Lock the affected parts first (ascending id), then release.
  select coalesce(array_agg(distinct part_id order by part_id), '{}') into v_part_ids
    from public.inventory_reservations where sale_id = p_sale_id and status = 'active';
  if array_length(v_part_ids, 1) is null then
    return jsonb_build_object('sale_id', p_sale_id, 'released', 0, 'idempotent_replay', true);
  end if;
  perform 1 from public.parts where id = any(v_part_ids) order by id for update;

  for v_res in
    select r.id, r.sale_item_id
      from public.inventory_reservations r
     where r.sale_id = p_sale_id and r.status = 'active'
     order by r.id
  loop
    update public.inventory_reservations
       set status = 'released', released_at = now()
     where id = v_res.id;
    update public.sale_items set stock_action = 'none' where id = v_res.sale_item_id;
    v_released := v_released + 1;
  end loop;

  foreach v_pid in array v_part_ids loop
    perform public._sync_part_operational_status(v_pid);
  end loop;

  perform public._recalc_sale_fulfillment(p_sale_id);
  perform public.write_audit_log('stock.release', 'sale', p_sale_id, 'Stock reservation released',
    jsonb_build_object('released', v_released), null, null);

  return jsonb_build_object('sale_id', p_sale_id, 'released', v_released, 'idempotent_replay', false);
end;
$$;

-- fulfill_sales_order: consumes the physical stock for every reserved line of a sale.
create or replace function public.fulfill_sales_order(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_res record;
  v_part_qty int;
  v_fulfilled int := 0;
begin
  perform public._rpc_require_sales_staff();

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'sale not found' using errcode = '22023';
  end if;
  if v_sale.status = 'CANCELLED' then
    raise exception 'a cancelled sale cannot be fulfilled' using errcode = 'P0001';
  end if;

  -- Lock the parts this sale touches in ascending id order before reading quantities.
  perform 1 from public.parts
   where id in (select part_id from public.inventory_reservations where sale_id = p_sale_id and status = 'active')
   order by id for update;

  for v_res in
    select r.id, r.part_id, r.quantity, r.sale_item_id
      from public.inventory_reservations r
     where r.sale_id = p_sale_id and r.status = 'active'
     order by r.part_id, r.id
  loop
    select quantity into v_part_qty from public.parts where id = v_res.part_id;
    if v_part_qty < v_res.quantity then
      raise exception 'cannot fulfill: part % has % on hand, reservation needs %', v_res.part_id, v_part_qty, v_res.quantity using errcode = 'P0001';
    end if;

    update public.parts set quantity = v_part_qty - v_res.quantity, updated_at = now() where id = v_res.part_id;
    update public.inventory_reservations set status = 'fulfilled', fulfilled_at = now() where id = v_res.id;
    update public.sale_items
       set stock_action = 'fulfill', previous_quantity = v_part_qty, new_quantity = v_part_qty - v_res.quantity
     where id = v_res.sale_item_id;
    v_fulfilled := v_fulfilled + 1;
  end loop;

  if v_fulfilled = 0 then
    return jsonb_build_object('sale_id', p_sale_id, 'fulfilled_lines', 0, 'idempotent_replay', true);
  end if;

  for v_res in select distinct part_id from public.sale_items where sale_id = p_sale_id and part_id is not null loop
    perform public._sync_part_operational_status(v_res.part_id);
  end loop;

  perform public._recalc_sale_fulfillment(p_sale_id);
  perform public.write_audit_log('stock.fulfill', 'sale', p_sale_id, 'Sales order fulfilled',
    jsonb_build_object('fulfilled_lines', v_fulfilled), null, null);

  return jsonb_build_object('sale_id', p_sale_id, 'fulfilled_lines', v_fulfilled,
                            'fulfillment_status', (select fulfillment_status from public.sales where id = p_sale_id),
                            'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Privileges: nothing for PUBLIC/anon; authenticated only. Authorization is inside each body.
-- ---------------------------------------------------------------------------------------
revoke execute on function public._rpc_require_sales_staff() from public, anon, authenticated;
revoke execute on function public._rpc_require_admin() from public, anon, authenticated;
revoke execute on function public._require_money_positive(numeric, text) from public, anon, authenticated;
revoke execute on function public._payment_json(public.payments) from public, anon, authenticated;
revoke execute on function public._payment_status_for(numeric, numeric) from public, anon, authenticated;
revoke execute on function public._recalc_sale_fulfillment(uuid) from public, anon, authenticated;
revoke execute on function public._sync_part_operational_status(uuid) from public, anon, authenticated;
revoke execute on function public._available_quantity(uuid) from public, anon, authenticated;

-- Helpers above are called from the RPCs (SECURITY DEFINER, owner-invoked), so they need no grant.

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_payment(uuid, numeric, text, text, text, uuid)',
    'public.allocate_payment(uuid, uuid, numeric)',
    'public.post_payment(uuid)',
    'public.void_payment(uuid, text)',
    'public.create_sale(uuid, jsonb, text, uuid, text)',
    'public.reserve_stock(uuid)',
    'public.release_reservation(uuid)',
    'public.fulfill_sales_order(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
