-- =====================================================================================
-- 0030 — Sales and quote read models, POS part search, and business history for sales staff.
--
-- ADDITIVE. 0001–0029 are not edited.
--
-- All functions check sales staff (owner, engineer_admin, manager) inside the body.
-- List functions return lightweight rows and use keyset paging (no OFFSET). Detail functions
-- load one record and its lines, reservations and history on demand.
-- Payments are summarized in the sale header only. The payment ledger belongs to Module 09.
-- Business history is read from the audit log through a role-checked function, because the
-- audit table itself is readable by admins only.
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- 1. Sales list (keyset, lightweight)
-- ---------------------------------------------------------------------------------------
create or replace function public.list_sales(
  p_search text default null,
  p_status text default null,
  p_limit int default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid, sale_number text, customer_id uuid, customer_name text, created_at timestamptz,
  total numeric, amount_paid numeric, balance_due numeric, payment_status text,
  fulfillment_status text, status text, has_more boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_q text := btrim(coalesce(p_search, ''));
begin
  perform public._rpc_require_sales_staff();
  return query
  with page as (
    select s.*
      from public.sales s
      join public.customers c on c.id = s.customer_id
     where (v_q = '' or s.sale_number ilike '%' || v_q || '%'
                     or c.last_name ilike '%' || v_q || '%'
                     or c.first_name ilike '%' || v_q || '%'
                     or c.company_name ilike '%' || v_q || '%')
       and (p_status is null or s.status = p_status)
       and (p_cursor_created_at is null or (s.created_at, s.id) < (p_cursor_created_at, p_cursor_id))
     order by s.created_at desc, s.id desc
     limit v_limit + 1
  ),
  numbered as (select page.*, row_number() over (order by page.created_at desc, page.id desc) as rn from page)
  select n.id, n.sale_number, n.customer_id,
         public._customer_name_text(c.first_name, c.last_name, c.company_name),
         n.created_at, n.total, n.amount_paid, n.balance_due, n.payment_status,
         n.fulfillment_status, n.status,
         exists (select 1 from numbered x where x.rn = v_limit + 1)
    from numbered n
    join public.customers c on c.id = n.customer_id
   where n.rn <= v_limit
   order by n.created_at desc, n.id desc;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Business history (sale and quote events), role-checked
-- ---------------------------------------------------------------------------------------
create or replace function public._business_history(p_entity_type text, p_entity_id uuid, p_quote_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(h order by h.created_at desc), '[]'::jsonb)
    from (
      select a.action, a.summary, a.actor_name, a.actor_role, a.created_at
        from public.audit_logs a
       where (a.entity_type = p_entity_type and a.entity_id = p_entity_id)
          or (p_quote_id is not null and a.entity_type = 'quote' and a.entity_id = p_quote_id)
       order by a.created_at desc
       limit 100
    ) h;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Sale detail (on demand)
-- ---------------------------------------------------------------------------------------
create or replace function public.get_sale_detail(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_s public.sales%rowtype;
  v_cust jsonb;
  v_lines jsonb;
  v_res jsonb;
  v_quote jsonb := null;
  v_payments_count int;
begin
  perform public._rpc_require_sales_staff();
  select * into v_s from public.sales where id = p_sale_id;
  if not found then
    raise exception 'sale not found' using errcode = '22023';
  end if;

  select jsonb_build_object('id', c.id, 'customer_number', c.customer_number,
                            'name', public._customer_name_text(c.first_name, c.last_name, c.company_name),
                            'phone', c.phone_normalized, 'email', c.email::text, 'tax_status', c.tax_status)
    into v_cust from public.customers c where c.id = v_s.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', si.id, 'part_id', si.part_id, 'stock_sku', si.stock_sku, 'description', si.description,
           'quantity', si.quantity, 'unit_price', si.unit_price, 'discount', si.discount,
           'line_total', si.line_total, 'stock_action', si.stock_action,
           'previous_quantity', si.previous_quantity, 'new_quantity', si.new_quantity)
         order by si.created_at, si.id), '[]'::jsonb)
    into v_lines from public.sale_items si where si.sale_id = p_sale_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'part_id', r.part_id, 'sale_item_id', r.sale_item_id, 'quantity', r.quantity,
           'status', r.status, 'reserved_at', r.reserved_at, 'released_at', r.released_at, 'fulfilled_at', r.fulfilled_at)
         order by r.reserved_at, r.id), '[]'::jsonb)
    into v_res from public.inventory_reservations r where r.sale_id = p_sale_id;

  if v_s.quote_id is not null then
    select jsonb_build_object('id', q.id, 'quote_number', q.quote_number, 'status', q.status)
      into v_quote from public.quotes q where q.id = v_s.quote_id;
  end if;

  select count(*) into v_payments_count from public.payment_allocations pa where pa.sale_id = p_sale_id;

  return jsonb_build_object(
    'sale', jsonb_build_object(
      'id', v_s.id, 'sale_number', v_s.sale_number, 'status', v_s.status,
      'fulfillment_status', v_s.fulfillment_status, 'payment_status', v_s.payment_status,
      'created_at', v_s.created_at, 'finalized_at', v_s.finalized_at, 'notes', v_s.notes,
      'subtotal', v_s.subtotal, 'discount', v_s.discount, 'tax_rate', v_s.tax_rate, 'tax', v_s.tax,
      'total', v_s.total, 'amount_paid', v_s.amount_paid, 'balance_due', v_s.balance_due),
    'customer', v_cust,
    'lines', v_lines,
    'reservations', v_res,
    'quote', v_quote,
    'payment_allocation_count', v_payments_count,
    'history', public._business_history('sale', p_sale_id, v_s.quote_id));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Quote list (keyset) and quote detail
-- ---------------------------------------------------------------------------------------
create or replace function public.list_quotes(
  p_search text default null,
  p_status text default null,
  p_limit int default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid, quote_number text, customer_id uuid, customer_name text, status text, total numeric,
  created_at timestamptz, converted_sale_id uuid, has_more boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_q text := btrim(coalesce(p_search, ''));
begin
  perform public._rpc_require_sales_staff();
  return query
  with page as (
    select q.*
      from public.quotes q
      join public.customers c on c.id = q.customer_id
     where (v_q = '' or q.quote_number ilike '%' || v_q || '%'
                     or c.last_name ilike '%' || v_q || '%'
                     or c.first_name ilike '%' || v_q || '%'
                     or c.company_name ilike '%' || v_q || '%')
       and (p_status is null or q.status = p_status)
       and (p_cursor_created_at is null or (q.created_at, q.id) < (p_cursor_created_at, p_cursor_id))
     order by q.created_at desc, q.id desc
     limit v_limit + 1
  ),
  numbered as (select page.*, row_number() over (order by page.created_at desc, page.id desc) as rn from page)
  select n.id, n.quote_number, n.customer_id,
         public._customer_name_text(c.first_name, c.last_name, c.company_name),
         n.status, n.total, n.created_at, n.converted_sale_id,
         exists (select 1 from numbered x where x.rn = v_limit + 1)
    from numbered n
    join public.customers c on c.id = n.customer_id
   where n.rn <= v_limit
   order by n.created_at desc, n.id desc;
end;
$$;

create or replace function public.get_quote_detail(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_q public.quotes%rowtype;
  v_cust jsonb;
  v_items jsonb;
  v_sale jsonb := null;
begin
  perform public._rpc_require_sales_staff();
  select * into v_q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'quote not found' using errcode = '22023';
  end if;

  select jsonb_build_object('id', c.id, 'customer_number', c.customer_number,
                            'name', public._customer_name_text(c.first_name, c.last_name, c.company_name),
                            'phone', c.phone_normalized, 'email', c.email::text, 'tax_status', c.tax_status)
    into v_cust from public.customers c where c.id = v_q.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', qi.id, 'part_id', qi.part_id, 'stock_sku', qi.stock_sku, 'description', qi.description,
           'quantity', qi.quantity, 'unit_price', qi.unit_price, 'discount', qi.discount, 'line_total', qi.line_total)
         order by qi.created_at, qi.id), '[]'::jsonb)
    into v_items from public.quote_items qi where qi.quote_id = p_quote_id;

  if v_q.converted_sale_id is not null then
    select jsonb_build_object('id', s.id, 'sale_number', s.sale_number, 'status', s.status)
      into v_sale from public.sales s where s.id = v_q.converted_sale_id;
  end if;

  return jsonb_build_object(
    'quote', jsonb_build_object(
      'id', v_q.id, 'quote_number', v_q.quote_number, 'status', v_q.status, 'notes', v_q.notes,
      'subtotal', v_q.subtotal, 'discount', v_q.discount, 'tax_rate', v_q.tax_rate, 'tax', v_q.tax,
      'total', v_q.total, 'created_at', v_q.created_at, 'updated_at', v_q.updated_at),
    'customer', v_cust,
    'items', v_items,
    'converted_sale', v_sale,
    'history', public._business_history('quote', p_quote_id, null));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. POS part search: sellable states only. Zero-stock parts are listed as Out of Stock and
--    cannot be added; they never disappear. Thumbnail only, one join.
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
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q text := btrim(coalesce(p_search, ''));
begin
  perform public._rpc_require_sales_staff();
  return query
  select p.id, p.part_name, p.stock_sku, p.price, p.quantity,
         public._available_quantity(p.id),
         public._available_quantity(p.id) <= 0,
         m.storage_path, m.bucket
    from public.parts p
    left join public.media_assets m
      on m.id = p.thumbnail_asset_id and m.variant = 'thumbnail' and m.status = 'ready'
   where public._part_is_sellable_state(p)
     and (v_q = '' or p.part_name ilike '%' || v_q || '%' or p.stock_sku ilike '%' || v_q || '%'
                   or p.part_number ilike '%' || v_q || '%')
   order by p.part_name, p.id
   limit v_limit;
end;
$$;

revoke execute on function public.list_sales(text, text, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_sales(text, text, int, timestamptz, uuid) to authenticated;
revoke execute on function public.get_sale_detail(uuid) from public, anon;
grant execute on function public.get_sale_detail(uuid) to authenticated;
revoke execute on function public.list_quotes(text, text, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_quotes(text, text, int, timestamptz, uuid) to authenticated;
revoke execute on function public.get_quote_detail(uuid) from public, anon;
grant execute on function public.get_quote_detail(uuid) to authenticated;
revoke execute on function public.search_sellable_parts(text, int) from public, anon;
grant execute on function public.search_sellable_parts(text, int) to authenticated;
revoke execute on function public._business_history(text, uuid, uuid) from public, anon, authenticated;
