-- =====================================================================================
-- 0029 — Quotes and the sale write path: numbering, quote RPCs, quote -> sale conversion,
--        and create_sale re-defined with header and line discounts and a quote link.
--
-- ADDITIVE. 0001–0028 are not edited. create_sale (0004) is replaced by a new signature.
-- Concurrency, reservation and fulfillment semantics are the same as 0004 / 0005, now with the
-- extra discount and quote arguments.
--
-- Accounting conventions (match the approved UI, src/lib/mock/sales.ts itemTotals):
--   line_total = quantity * unit_price - line discount
--   subtotal   = sum(line_total)
--   taxable    = max(0, subtotal - header discount)
--   tax        = round(taxable * tax_rate / 100, 2)      -- tax_rate is a PERCENT
--   total      = taxable + tax
--   Rate source: sales_settings.tax_rate (0 when no settings row exists). Nothing is invented.
--
-- Stock rules (unchanged): DRAFT moves no stock. RESERVE creates active reservations and leaves
-- physical quantity alone. FULFILL NOW consumes quantity immediately. Every part line must be
-- sellable (approved, ready for sale, not not-sellable, not MISSING / DAMAGED / RETURNED).
--
-- Numbers come from database sequences (Q-nnnn, S-nnnn). Clients never supply them.
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- 1. Numbering
-- ---------------------------------------------------------------------------------------
do $$
declare
  v bigint;
begin
  select coalesce(max(substring(quote_number from 3)::bigint), 0) into v
    from public.quotes where quote_number ~ '^Q-[0-9]+$';
  execute format('create sequence if not exists public.quote_number_seq start with %s', v + 1);

  select coalesce(max(substring(sale_number from 3)::bigint), 0) into v
    from public.sales where sale_number ~ '^S-[0-9]+$';
  execute format('create sequence if not exists public.sale_number_seq start with %s', v + 1);
end $$;

create or replace function public._assign_quote_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.quote_number is null then
    new.quote_number := 'Q-' || lpad(nextval('public.quote_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists quotes_assign_number on public.quotes;
create trigger quotes_assign_number before insert on public.quotes
  for each row execute function public._assign_quote_number();

create or replace function public._assign_sale_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sale_number is null then
    new.sale_number := 'S-' || lpad(nextval('public.sale_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists sales_assign_number on public.sales;
create trigger sales_assign_number before insert on public.sales
  for each row execute function public._assign_sale_number();

alter table public.quotes add column if not exists client_request_id uuid;
create unique index if not exists quotes_client_request_key
  on public.quotes (client_request_id) where client_request_id is not null;

-- ---------------------------------------------------------------------------------------
-- 2. Shared helpers
-- ---------------------------------------------------------------------------------------
create or replace function public._sales_tax_rate()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select tax_rate from public.sales_settings order by id limit 1), 0);
$$;

-- Sellable state of a part, independent of quantity. A zero-quantity sellable part is still
-- sellable in state; stock decides whether it can be taken.
create or replace function public._part_is_sellable_state(p public.parts)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p.status = 'approved'
     and p.stage = 'ready_for_sale'
     and p.not_sellable_reason is null
     and p.operational_status not in ('MISSING', 'DAMAGED', 'RETURNED');
$$;

-- Available-to-sell = quantity minus active reservations, and ONLY for sellable parts.
create or replace function public._available_quantity(p_part_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
           when public._part_is_sellable_state(p) then
             p.quantity - coalesce((
               select sum(r.quantity) from public.inventory_reservations r
                where r.part_id = p.id and r.status = 'active'
             ), 0)
           else 0
         end
    from public.parts p
   where p.id = p_part_id;
$$;

-- Validates and snapshots quote lines. The description, SKU and (when not given) price come
-- from the part at the time of quoting, and are then stored on the quote line.
create or replace function public._quote_lines_snapshot(p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_out jsonb := '[]'::jsonb;
  v_part public.parts%rowtype;
  v_qty int;
  v_price numeric;
  v_disc numeric;
  v_part_id uuid;
  v_sku text;
  v_desc text;
  v_total numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'add at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'a quote may have at most 200 lines' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line->>'quantity') is null or (v_line->>'quantity')::numeric <> trunc((v_line->>'quantity')::numeric)
       or (v_line->>'quantity')::numeric <= 0 then
      raise exception 'line quantity must be a whole number greater than zero' using errcode = '22023';
    end if;
    v_qty := (v_line->>'quantity')::int;

    v_part_id := nullif(v_line->>'part_id', '')::uuid;
    if v_part_id is not null then
      select * into v_part from public.parts where id = v_part_id;
      if not found then
        raise exception 'part not found' using errcode = '22023';
      end if;
      if not public._part_is_sellable_state(v_part) then
        raise exception 'part "%" is not sellable', v_part.part_name using errcode = 'P0001', hint = 'NOT_SELLABLE';
      end if;
      v_sku := coalesce(v_part.stock_sku, '');
      v_desc := coalesce(nullif(btrim(v_part.part_name), ''), 'Part');
    else
      v_sku := '';
      v_desc := btrim(coalesce(v_line->>'description', ''));
      if v_desc = '' then
        raise exception 'each line needs a part or a description' using errcode = '22023';
      end if;
    end if;

    v_price := coalesce(nullif(v_line->>'unit_price', '')::numeric, case when v_part_id is not null then v_part.price end);
    if v_price is null or v_price < 0 or v_price <> round(v_price, 2) then
      raise exception 'unit price must be zero or positive with at most 2 decimals' using errcode = '22023';
    end if;

    v_disc := coalesce(nullif(v_line->>'discount', '')::numeric, 0);
    if v_disc < 0 or v_disc > v_qty * v_price or v_disc <> round(v_disc, 2) then
      raise exception 'line discount must be between 0 and the line amount' using errcode = '22023';
    end if;

    v_total := round(v_qty * v_price - v_disc, 2);
    v_out := v_out || jsonb_build_object(
      'part_id', v_part_id, 'stock_sku', v_sku, 'description', v_desc,
      'quantity', v_qty, 'unit_price', v_price, 'discount', v_disc, 'line_total', v_total);
  end loop;
  return v_out;
end;
$$;

create or replace function public._quote_totals(p_lines jsonb, p_discount numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_subtotal numeric := 0;
  v_rate numeric := public._sales_tax_rate();
  v_taxable numeric;
  v_tax numeric;
begin
  select coalesce(sum((e->>'line_total')::numeric), 0) into v_subtotal from jsonb_array_elements(p_lines) e;
  if coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > v_subtotal or coalesce(p_discount, 0) <> round(coalesce(p_discount, 0), 2) then
    raise exception 'the discount must be between 0 and the subtotal' using errcode = '22023';
  end if;
  v_taxable := v_subtotal - coalesce(p_discount, 0);
  v_tax := round(v_taxable * v_rate / 100, 2);
  return jsonb_build_object('subtotal', v_subtotal, 'discount', coalesce(p_discount, 0), 'tax_rate', v_rate,
                            'tax', v_tax, 'total', v_taxable + v_tax);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Quote RPCs
-- ---------------------------------------------------------------------------------------
create or replace function public.create_quote(
  p_customer_id uuid,
  p_lines jsonb,
  p_discount numeric default 0,
  p_notes text default '',
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.quotes%rowtype;
  v_lines jsonb;
  v_t jsonb;
  v_row public.quotes%rowtype;
  v_line jsonb;
begin
  perform public._rpc_require_sales_staff();
  if char_length(coalesce(p_notes, '')) > 2000 then
    raise exception 'notes is too long' using errcode = '22023';
  end if;
  if p_client_request_id is not null then
    select * into v_existing from public.quotes where client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object('quote_id', v_existing.id, 'quote_number', v_existing.quote_number, 'status', v_existing.status,
                                'total', v_existing.total, 'idempotent_replay', true);
    end if;
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = '22023';
  end if;

  v_lines := public._quote_lines_snapshot(p_lines);
  v_t := public._quote_totals(v_lines, p_discount);

  insert into public.quotes (customer_id, salesperson_id, status, subtotal, discount, tax_rate, tax, total, notes, client_request_id)
  values (p_customer_id, auth.uid(), 'DRAFT', (v_t->>'subtotal')::numeric, (v_t->>'discount')::numeric,
          (v_t->>'tax_rate')::numeric, (v_t->>'tax')::numeric, (v_t->>'total')::numeric, coalesce(p_notes, ''), p_client_request_id)
  returning * into v_row;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    insert into public.quote_items (quote_id, part_id, stock_sku, description, quantity, unit_price, discount, line_total)
    values (v_row.id, nullif(v_line->>'part_id', '')::uuid, v_line->>'stock_sku', v_line->>'description',
            (v_line->>'quantity')::int, (v_line->>'unit_price')::numeric, (v_line->>'discount')::numeric, (v_line->>'line_total')::numeric);
  end loop;

  perform public.write_audit_log('quote.create', 'quote', v_row.id, 'Quote created (' || v_row.quote_number || ')',
    jsonb_build_object('lines', jsonb_array_length(v_lines), 'total', v_row.total, 'customer_id', p_customer_id), null, p_client_request_id);

  return jsonb_build_object('quote_id', v_row.id, 'quote_number', v_row.quote_number, 'status', v_row.status,
                            'total', v_row.total, 'idempotent_replay', false);
end;
$$;

-- Replaces the lines of an editable quote (DRAFT or SENT). Atomic: an invalid line leaves the
-- quote exactly as it was, because the whole function rolls back.
create or replace function public.update_quote(
  p_quote_id uuid,
  p_customer_id uuid,
  p_lines jsonb,
  p_discount numeric default 0,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q public.quotes%rowtype;
  v_lines jsonb;
  v_t jsonb;
  v_line jsonb;
begin
  perform public._rpc_require_sales_staff();
  select * into v_q from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = '22023';
  end if;
  if v_q.status not in ('DRAFT', 'SENT') then
    raise exception 'a % quote can no longer be edited', v_q.status using errcode = 'P0001', hint = 'QUOTE_LOCKED';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = '22023';
  end if;
  if char_length(coalesce(p_notes, '')) > 2000 then
    raise exception 'notes is too long' using errcode = '22023';
  end if;

  v_lines := public._quote_lines_snapshot(p_lines);
  v_t := public._quote_totals(v_lines, p_discount);

  delete from public.quote_items where quote_id = p_quote_id;
  for v_line in select * from jsonb_array_elements(v_lines) loop
    insert into public.quote_items (quote_id, part_id, stock_sku, description, quantity, unit_price, discount, line_total)
    values (p_quote_id, nullif(v_line->>'part_id', '')::uuid, v_line->>'stock_sku', v_line->>'description',
            (v_line->>'quantity')::int, (v_line->>'unit_price')::numeric, (v_line->>'discount')::numeric, (v_line->>'line_total')::numeric);
  end loop;

  update public.quotes
     set customer_id = p_customer_id, subtotal = (v_t->>'subtotal')::numeric, discount = (v_t->>'discount')::numeric,
         tax_rate = (v_t->>'tax_rate')::numeric, tax = (v_t->>'tax')::numeric, total = (v_t->>'total')::numeric,
         notes = coalesce(p_notes, ''), updated_at = now()
   where id = p_quote_id
   returning * into v_q;

  perform public.write_audit_log('quote.update', 'quote', p_quote_id, 'Quote updated (' || v_q.quote_number || ')',
    jsonb_build_object('lines', jsonb_array_length(v_lines), 'total', v_q.total), null, null);

  return jsonb_build_object('quote_id', v_q.id, 'quote_number', v_q.quote_number, 'status', v_q.status, 'total', v_q.total);
end;
$$;

create or replace function public.set_quote_status(p_quote_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q public.quotes%rowtype;
  v_prev text;
begin
  perform public._rpc_require_sales_staff();
  select * into v_q from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = '22023';
  end if;
  v_prev := v_q.status;
  if p_status = v_prev then
    return jsonb_build_object('quote_id', v_q.id, 'status', v_prev, 'idempotent_replay', true);
  end if;
  if not (
       (v_prev = 'DRAFT' and p_status in ('SENT', 'DECLINED'))
    or (v_prev = 'SENT' and p_status in ('APPROVED', 'DECLINED', 'EXPIRED'))
  ) then
    raise exception 'cannot move a quote from % to %', v_prev, p_status using errcode = 'P0001', hint = 'INVALID_TRANSITION';
  end if;
  update public.quotes set status = p_status, updated_at = now() where id = p_quote_id returning * into v_q;
  perform public.write_audit_log('quote.status', 'quote', p_quote_id, 'Quote ' || v_prev || ' -> ' || p_status,
    jsonb_build_object('from', v_prev, 'to', p_status), null, null);
  return jsonb_build_object('quote_id', v_q.id, 'status', v_q.status, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Sale creation (re-defined): discounts, quote link, sellability, and the same stock rules.
-- ---------------------------------------------------------------------------------------
drop function if exists public.create_sale(uuid, jsonb, text, uuid, text);

create or replace function public.create_sale(
  p_customer_id      uuid,
  p_lines            jsonb,
  p_mode             text,
  p_client_request_id uuid default null,
  p_notes            text default '',
  p_discount         numeric default 0,
  p_quote_id         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.sales%rowtype;
  v_sale public.sales%rowtype;
  v_rate numeric;
  v_line jsonb;
  v_item public.sale_items%rowtype;
  v_part public.parts%rowtype;
  v_qty int;
  v_price numeric;
  v_disc numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_discount numeric := coalesce(p_discount, 0);
  v_taxable numeric;
  v_tax numeric;
  v_total numeric;
  v_part_ids uuid[];
  v_need record;
  v_avail int;
  v_stock_action text;
  v_part_qty int;
  v_count int;
  v_pid uuid;
begin
  perform public._rpc_require_sales_staff();

  if p_mode not in ('draft', 'reserve', 'fulfill_now') then
    raise exception 'mode must be draft, reserve or fulfill_now' using errcode = '22023';
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
      return jsonb_build_object('sale_id', v_existing.id, 'sale_number', v_existing.sale_number, 'total', v_existing.total,
                                'fulfillment_status', v_existing.fulfillment_status, 'idempotent_replay', true);
    end if;
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale needs at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'a sale may have at most 200 lines' using errcode = '22023';
  end if;

  -- Validate every line and total the sale before writing anything.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line->>'quantity') is null or (v_line->>'quantity')::numeric <> trunc((v_line->>'quantity')::numeric)
       or (v_line->>'quantity')::numeric <= 0 then
      raise exception 'line quantity must be a whole number greater than zero' using errcode = '22023';
    end if;
    v_qty := (v_line->>'quantity')::int;
    v_price := nullif(v_line->>'unit_price', '')::numeric;
    if v_price is null or v_price < 0 or v_price <> round(v_price, 2) then
      raise exception 'line unit price must be zero or positive with at most 2 decimals' using errcode = '22023';
    end if;
    v_disc := coalesce(nullif(v_line->>'discount', '')::numeric, 0);
    if v_disc < 0 or v_disc > v_qty * v_price or v_disc <> round(v_disc, 2) then
      raise exception 'line discount must be between 0 and the line amount' using errcode = '22023';
    end if;
    if (v_line->>'part_id') is null and coalesce(v_line->>'description', '') = '' then
      raise exception 'each line needs a description or a part' using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + round(v_qty * v_price - v_disc, 2);
  end loop;
  if v_discount < 0 or v_discount > v_subtotal or v_discount <> round(v_discount, 2) then
    raise exception 'the discount must be between 0 and the subtotal' using errcode = '22023';
  end if;

  -- Lock every referenced part in id order. Every part line must be sellable, in any mode.
  select coalesce(array_agg(distinct x.pid order by x.pid), '{}') into v_part_ids
    from (select nullif(e->>'part_id', '')::uuid as pid from jsonb_array_elements(p_lines) e) x
   where x.pid is not null;

  if array_length(v_part_ids, 1) > 0 then
    perform 1 from public.parts where id = any(v_part_ids) order by id for update;
    foreach v_pid in array v_part_ids loop
      select * into v_part from public.parts where id = v_pid;
      if not found then
        raise exception 'part % not found', v_pid using errcode = '22023';
      end if;
      if not public._part_is_sellable_state(v_part) then
        raise exception 'part "%" is not sellable', v_part.part_name using errcode = 'P0001', hint = 'NOT_SELLABLE';
      end if;
    end loop;
  end if;

  if p_mode in ('reserve', 'fulfill_now') and array_length(v_part_ids, 1) > 0 then
    for v_need in
      select nullif(e->>'part_id', '')::uuid as part_id, sum((e->>'quantity')::int) as qty
        from jsonb_array_elements(p_lines) e
       where nullif(e->>'part_id', '') is not null
       group by 1 order by 1
    loop
      select public._available_quantity(v_need.part_id) into v_avail;
      if v_avail < v_need.qty then
        raise exception 'insufficient stock for part %: available %, requested %', v_need.part_id, greatest(v_avail, 0), v_need.qty
          using errcode = 'P0001', hint = 'OUT_OF_STOCK';
      end if;
    end loop;
  end if;

  v_rate := public._sales_tax_rate();
  v_taxable := v_subtotal - v_discount;
  v_tax := round(v_taxable * v_rate / 100, 2);
  v_total := v_taxable + v_tax;

  insert into public.sales (customer_id, salesperson_id, quote_id, subtotal, discount, tax_rate, tax, total,
                            amount_paid, balance_due, notes, client_request_id, status)
  values (p_customer_id, auth.uid(), p_quote_id, v_subtotal, v_discount, v_rate, v_tax, v_total,
          0, v_total, coalesce(p_notes, ''), p_client_request_id, 'OPEN')
  returning * into v_sale;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::int;
    v_price := (v_line->>'unit_price')::numeric;
    v_disc := coalesce(nullif(v_line->>'discount', '')::numeric, 0);
    v_line_total := round(v_qty * v_price - v_disc, 2);
    v_pid := nullif(v_line->>'part_id', '')::uuid;

    v_stock_action := 'none';
    if v_pid is not null then
      v_stock_action := case p_mode when 'reserve' then 'reserve' when 'fulfill_now' then 'fulfill' else 'none' end;
    end if;

    insert into public.sale_items (sale_id, part_id, stock_sku, description, quantity, unit_price, discount, line_total, stock_action)
    values (v_sale.id, v_pid,
            coalesce((select stock_sku from public.parts where id = v_pid), ''),
            coalesce(nullif(v_line->>'description', ''), 'Part'),
            v_qty, v_price, v_disc, v_line_total, v_stock_action)
    returning * into v_item;

    if v_stock_action = 'reserve' then
      insert into public.inventory_reservations (part_id, sale_id, sale_item_id, quantity, status, created_by)
      values (v_pid, v_sale.id, v_item.id, v_qty, 'active', auth.uid());
    elsif v_stock_action = 'fulfill' then
      select quantity into v_part_qty from public.parts where id = v_pid for update;
      update public.parts set quantity = v_part_qty - v_qty, updated_at = now() where id = v_pid;
      update public.sale_items set previous_quantity = v_part_qty, new_quantity = v_part_qty - v_qty where id = v_item.id;
      perform public._sync_part_operational_status(v_pid);
    end if;
  end loop;

  perform public._recalc_sale_fulfillment(v_sale.id);

  select count(*) into v_count from public.sale_items where sale_id = v_sale.id;
  perform public.write_audit_log('sale.create', 'sale', v_sale.id,
    'Sale created (' || p_mode || ')' || coalesce(' from quote', ''),
    jsonb_build_object('mode', p_mode, 'lines', v_count, 'total', v_total, 'customer_id', p_customer_id, 'quote_id', p_quote_id),
    null, p_client_request_id);

  select * into v_sale from public.sales where id = v_sale.id;
  return jsonb_build_object('sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'total', v_sale.total, 'lines', v_count,
                            'fulfillment_status', v_sale.fulfillment_status, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Quote -> sale conversion. One engine: it calls create_sale. Atomic: any failure rolls back
--    the sale, its lines, stock movement and the quote status change together.
-- ---------------------------------------------------------------------------------------
create or replace function public.convert_quote_to_sale(p_quote_id uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q public.quotes%rowtype;
  v_lines jsonb;
  v_res jsonb;
begin
  perform public._rpc_require_sales_staff();
  select * into v_q from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = '22023';
  end if;

  -- Retry: a quote that already became a sale returns that sale. No second sale is created.
  if v_q.converted_sale_id is not null then
    return jsonb_build_object('quote_id', v_q.id, 'sale_id', v_q.converted_sale_id, 'idempotent_replay', true);
  end if;
  if v_q.status not in ('DRAFT', 'SENT', 'APPROVED') then
    raise exception 'a % quote cannot be converted', v_q.status using errcode = 'P0001', hint = 'QUOTE_NOT_CONVERTIBLE';
  end if;
  if not exists (select 1 from public.customers where id = v_q.customer_id) then
    raise exception 'the customer on this quote no longer exists' using errcode = 'P0001', hint = 'CUSTOMER_MISSING';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'part_id', qi.part_id, 'description', qi.description, 'quantity', qi.quantity,
           'unit_price', qi.unit_price, 'discount', qi.discount) order by qi.created_at, qi.id), '[]'::jsonb)
    into v_lines
    from public.quote_items qi where qi.quote_id = p_quote_id;

  -- The quote id is the sale's client request id, so a repeated conversion also finds the same sale.
  v_res := public.create_sale(v_q.customer_id, v_lines, p_mode, v_q.id, v_q.notes, v_q.discount, v_q.id);

  update public.quotes
     set status = 'CONVERTED', converted_sale_id = (v_res->>'sale_id')::uuid, updated_at = now()
   where id = p_quote_id;

  perform public.write_audit_log('quote.convert', 'quote', p_quote_id,
    'Quote converted to sale (' || (v_res->>'sale_number') || ', ' || p_mode || ')',
    jsonb_build_object('sale_id', v_res->>'sale_id', 'mode', p_mode), null, null);

  return jsonb_build_object('quote_id', p_quote_id, 'sale_id', v_res->>'sale_id', 'sale_number', v_res->>'sale_number',
                            'total', v_res->>'total', 'fulfillment_status', v_res->>'fulfillment_status',
                            'idempotent_replay', coalesce((v_res->>'idempotent_replay')::boolean, false));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------------------
revoke execute on function public._sales_tax_rate() from public, anon, authenticated;
revoke execute on function public._part_is_sellable_state(public.parts) from public, anon, authenticated;
revoke execute on function public._quote_lines_snapshot(jsonb) from public, anon, authenticated;
revoke execute on function public._quote_totals(jsonb, numeric) from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_quote(uuid, jsonb, numeric, text, uuid)',
    'public.update_quote(uuid, uuid, jsonb, numeric, text)',
    'public.set_quote_status(uuid, text)',
    'public.create_sale(uuid, jsonb, text, uuid, text, numeric, uuid)',
    'public.convert_quote_to_sale(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
