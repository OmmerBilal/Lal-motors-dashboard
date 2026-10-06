-- =====================================================================================
-- 0066 — Front-desk sales simplification and manual inventory parts. ADDITIVE: new functions, one nullable
-- column, and two replaced function bodies (same signatures). 0001–0065 are not edited.
--
-- Payment rules are unchanged. Every money movement still goes through create_payment, allocate_payment and
-- post_payment, which keep their checks, audit rows and immutable history. The new functions only call them in
-- one transaction, so checkout and customer receipts are all-or-nothing.
--
-- 1. search_sellable_parts: nothing is listed until the desk types at least two characters or an exact SKU.
-- 2. create_sale_with_payment: sale (any mode) + optional payment, allocated and posted to this sale in one call.
--    Overpayment is refused and rolls back the whole sale.
-- 3. customer_outstanding: total balance and the open sales, oldest first (derived from sales.balance_due).
-- 4. receive_customer_payment: one payment applied to the oldest open sales, then posted, in one call.
-- 5. create_manual_inventory_part: a real, sellable inventory part with no donor vehicle. inventory_source = 'manual'.
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- 1. Part search
-- ---------------------------------------------------------------------------------------
create or replace function public.search_sellable_parts(p_search text default null, p_limit int default 20)
returns table (
  id uuid, part_name text, stock_sku text, price numeric, quantity int, available int,
  out_of_stock boolean, thumbnail_path text, thumbnail_bucket text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 20);
  v_q text := btrim(coalesce(p_search, ''));
begin
  perform public._rpc_require_sales_staff();
  -- The desk lists nothing until it has something to search for: two characters, or an exact SKU.
  if char_length(v_q) < 2 then
    return;
  end if;
  return query
  select p.id, p.part_name, p.stock_sku, p.price, p.quantity,
         public._available_quantity(p.id),
         public._available_quantity(p.id) <= 0,
         m.storage_path, m.bucket
    from public.parts p
    left join public.media_assets m
      on m.id = p.thumbnail_asset_id and m.variant = 'thumbnail' and m.status = 'ready'
   where public._part_is_sellable_state(p)
     and (p.stock_sku = v_q
          or p.part_name ilike '%' || v_q || '%'
          or p.stock_sku ilike '%' || v_q || '%'
          or p.part_number ilike '%' || v_q || '%')
   order by (p.stock_sku = v_q) desc, p.part_name, p.id
   limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Checkout with payment, in one transaction
-- ---------------------------------------------------------------------------------------
create or replace function public._sale_checkout_json(s public.sales)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'sale_id', s.id, 'sale_number', s.sale_number, 'customer_id', s.customer_id,
    'total', s.total, 'amount_paid', s.amount_paid, 'balance_due', s.balance_due,
    'payment_status', s.payment_status, 'fulfillment_status', s.fulfillment_status, 'sale_status', s.status);
$$;
revoke execute on function public._sale_checkout_json(public.sales) from public, anon, authenticated;

create or replace function public.create_sale_with_payment(
  p_customer_id       uuid,
  p_lines             jsonb,
  p_mode              text,
  p_discount          numeric default 0,
  p_notes             text default '',
  p_client_request_id uuid default null,
  p_amount_paid       numeric default 0,
  p_method            text default null,
  p_reference         text default '',
  p_payment_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale jsonb;
  v_sale_row public.sales%rowtype;
  v_pay jsonb;
  v_pay_id uuid;
begin
  perform public._rpc_require_sales_staff();

  -- create_sale checks lines, stock and modes, and is idempotent per client request id.
  v_sale := public.create_sale(p_customer_id, p_lines, p_mode, p_client_request_id, p_notes, p_discount, null);
  select * into v_sale_row from public.sales where id = (v_sale->>'sale_id')::uuid;

  -- A retry of a sale that already exists returns its current state. Nothing is written a second time.
  if coalesce((v_sale->>'idempotent_replay')::boolean, false) then
    return public._sale_checkout_json(v_sale_row) || jsonb_build_object('payment_id', null, 'idempotent_replay', true);
  end if;

  if coalesce(p_amount_paid, 0) = 0 then
    return public._sale_checkout_json(v_sale_row) || jsonb_build_object('payment_id', null, 'idempotent_replay', false);
  end if;

  if p_amount_paid < 0 or p_amount_paid <> round(p_amount_paid, 2) then
    raise exception 'the amount paid must be zero or positive with at most 2 decimals' using errcode = '22023';
  end if;
  if p_amount_paid > v_sale_row.total then
    raise exception 'the amount paid is more than the sale total. Record any difference separately.' using errcode = 'P0001', hint = 'OVERPAYMENT';
  end if;
  if p_method is null or p_method not in ('CASH','CARD','CHECK','BANK_TRANSFER','OTHER') then
    raise exception 'choose a payment method' using errcode = '22023';
  end if;

  v_pay := public.create_payment(p_customer_id, p_amount_paid, p_method, coalesce(p_reference, ''),
                                 'Front desk checkout ' || v_sale_row.sale_number, p_payment_request_id);
  v_pay_id := (v_pay->>'id')::uuid;
  perform public.allocate_payment(v_pay_id, v_sale_row.id, p_amount_paid);
  perform public.post_payment(v_pay_id);

  select * into v_sale_row from public.sales where id = v_sale_row.id;
  return public._sale_checkout_json(v_sale_row) || jsonb_build_object('payment_id', v_pay_id, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Customer outstanding balance (read model over sales.balance_due)
-- ---------------------------------------------------------------------------------------
create or replace function public.customer_outstanding(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._rpc_require_sales_staff();
  return (
    select jsonb_build_object(
      'customer_id', p_customer_id,
      'total_outstanding', coalesce(sum(s.balance_due), 0),
      'sales', coalesce(jsonb_agg(jsonb_build_object(
          'sale_id', s.id, 'sale_number', s.sale_number, 'sale_date', s.created_at,
          'total', s.total, 'amount_paid', s.amount_paid, 'balance_due', s.balance_due,
          'payment_status', s.payment_status) order by s.created_at, s.id), '[]'::jsonb))
      from public.sales s
     where s.customer_id = p_customer_id and s.status <> 'CANCELLED' and s.balance_due > 0
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Customer receive payment: oldest open sales first, posted in the same action
-- ---------------------------------------------------------------------------------------
create or replace function public.receive_customer_payment(
  p_customer_id       uuid,
  p_amount            numeric,
  p_method            text,
  p_reference         text default '',
  p_notes             text default '',
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.payments%rowtype;
  v_pay jsonb;
  v_pay_id uuid;
  v_remaining numeric;
  v_avail_total numeric := 0;
  v_avail numeric;
  v_alloc numeric;
  v_applied jsonb := '[]'::jsonb;
  s record;
begin
  perform public._rpc_require_sales_staff();
  perform public._require_money_positive(p_amount, 'amount');
  if p_amount <> round(p_amount, 2) then
    raise exception 'the amount must have at most 2 decimals' using errcode = '22023';
  end if;
  if p_method not in ('CASH','CARD','CHECK','BANK_TRANSFER','OTHER') then
    raise exception 'choose a payment method' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = '22023';
  end if;

  if p_client_request_id is not null then
    select * into v_existing from public.payments where client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object('payment_id', v_existing.id, 'status', v_existing.status, 'idempotent_replay', true);
    end if;
  end if;

  -- First pass: lock the open sales (oldest first) and check the money fits before anything is written.
  for s in
    select x.id, x.sale_number, x.total, x.amount_paid
      from public.sales x
     where x.customer_id = p_customer_id and x.status <> 'CANCELLED' and x.balance_due > 0
     order by x.created_at, x.id
       for update
  loop
    v_avail := greatest(s.total - s.amount_paid - coalesce((
      select sum(pa.amount) from public.payment_allocations pa join public.payments pp on pp.id = pa.payment_id
       where pa.sale_id = s.id and pp.status = 'pending'), 0), 0);
    v_avail_total := v_avail_total + v_avail;
  end loop;

  if v_avail_total <= 0 then
    raise exception 'this customer has no outstanding balance' using errcode = 'P0001', hint = 'NOTHING_OUTSTANDING';
  end if;
  if p_amount > v_avail_total then
    raise exception 'the amount is more than the outstanding balance (% due)', v_avail_total using errcode = 'P0001', hint = 'OVERPAYMENT';
  end if;

  v_pay := public.create_payment(p_customer_id, p_amount, p_method, coalesce(p_reference, ''), coalesce(p_notes, ''), p_client_request_id);
  v_pay_id := (v_pay->>'id')::uuid;

  v_remaining := p_amount;
  for s in
    select x.id, x.sale_number, x.total, x.amount_paid
      from public.sales x
     where x.customer_id = p_customer_id and x.status <> 'CANCELLED' and x.balance_due > 0
     order by x.created_at, x.id
       for update
  loop
    exit when v_remaining <= 0;
    v_avail := greatest(s.total - s.amount_paid - coalesce((
      select sum(pa.amount) from public.payment_allocations pa join public.payments pp on pp.id = pa.payment_id
       where pa.sale_id = s.id and pp.status = 'pending'), 0), 0);
    v_alloc := least(v_avail, v_remaining);
    if v_alloc > 0 then
      perform public.allocate_payment(v_pay_id, s.id, v_alloc);
      v_applied := v_applied || jsonb_build_object('sale_id', s.id, 'sale_number', s.sale_number, 'amount', v_alloc);
      v_remaining := v_remaining - v_alloc;
    end if;
  end loop;

  perform public.post_payment(v_pay_id);

  return jsonb_build_object(
    'payment_id', v_pay_id, 'received', p_amount, 'applied', v_applied,
    'remaining_outstanding', (public.customer_outstanding(p_customer_id)->>'total_outstanding')::numeric,
    'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Manual inventory part (no donor vehicle, real tracked stock)
-- ---------------------------------------------------------------------------------------
alter table public.parts add column if not exists inventory_source text
  check (inventory_source is null or inventory_source in ('manual'));

create or replace function public.create_manual_inventory_part(p_fields jsonb, p_client_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_fields->>'part_name', ''));
  v_qty int;
  v_price numeric;
  v_sku text := nullif(btrim(coalesce(p_fields->>'stock_sku', '')), '');
  v_part public.parts%rowtype;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');

  if p_client_request_id is not null then
    select * into v_part from public.parts where client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object('part_id', v_part.id, 'stock_sku', v_part.stock_sku, 'quantity', v_part.quantity, 'idempotent_replay', true);
    end if;
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    raise exception 'enter the part name (2 to 160 characters)' using errcode = '22023';
  end if;
  if (p_fields->>'quantity') is null or (p_fields->>'quantity')::numeric <> trunc((p_fields->>'quantity')::numeric)
     or (p_fields->>'quantity')::numeric < 0 or (p_fields->>'quantity')::numeric > 100000 then
    raise exception 'quantity must be a whole number from 0 to 100000' using errcode = '22023';
  end if;
  v_qty := (p_fields->>'quantity')::int;
  v_price := nullif(p_fields->>'price', '')::numeric;
  if v_price is null or v_price < 0 or v_price <> round(v_price, 2) then
    raise exception 'selling price must be zero or positive with at most 2 decimals' using errcode = '22023';
  end if;
  if v_sku is not null and exists (select 1 from public.parts where stock_sku = v_sku) then
    raise exception 'this SKU is already used by another part' using errcode = 'P0001', hint = 'SKU_TAKEN';
  end if;
  if char_length(coalesce(p_fields->>'part_notes', '')) > 2000 then
    raise exception 'description is too long' using errcode = '22023';
  end if;

  insert into public.parts (status, stage, operational_status, quantity, price, part_name, category, part_number,
                            condition, location, part_notes, stock_sku, inventory_source, client_request_id)
  values ('approved', 'ready_for_sale', case when v_qty = 0 then 'SOLD' else 'AVAILABLE' end, v_qty, v_price, v_name,
          coalesce(nullif(btrim(p_fields->>'category'), ''), ''),
          coalesce(nullif(btrim(p_fields->>'part_number'), ''), ''),
          coalesce(nullif(btrim(p_fields->>'condition'), ''), 'Used'),
          coalesce(nullif(btrim(p_fields->>'location'), ''), ''),
          coalesce(p_fields->>'part_notes', ''),
          v_sku, 'manual', p_client_request_id)
  returning * into v_part;

  insert into public.part_operations (part_id, action_type, new_status, quantity_delta, new_quantity, note, actor_id)
  values (v_part.id, 'MANUAL_CREATE', 'approved', v_qty, v_qty, 'Manual inventory part added', auth.uid());

  perform public.write_audit_log('inventory.manual_part_create', 'part', v_part.id, 'Manual inventory part added',
    jsonb_build_object('quantity', v_qty, 'price', v_price, 'stock_sku', v_sku), null, p_client_request_id);

  return jsonb_build_object('part_id', v_part.id, 'stock_sku', v_part.stock_sku, 'quantity', v_part.quantity, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------
revoke execute on function public.create_sale_with_payment(uuid, jsonb, text, numeric, text, uuid, numeric, text, text, uuid) from public, anon;
revoke execute on function public.customer_outstanding(uuid) from public, anon;
revoke execute on function public.receive_customer_payment(uuid, numeric, text, text, text, uuid) from public, anon;
revoke execute on function public.create_manual_inventory_part(jsonb, uuid) from public, anon;
grant execute on function public.create_sale_with_payment(uuid, jsonb, text, numeric, text, uuid, numeric, text, text, uuid) to authenticated;
grant execute on function public.customer_outstanding(uuid) to authenticated;
grant execute on function public.receive_customer_payment(uuid, numeric, text, text, text, uuid) to authenticated;
grant execute on function public.create_manual_inventory_part(jsonb, uuid) to authenticated;
