-- ---------------------------------------------------------------------------------------
-- 0079 — A dedicated "sales" role (POS/customers/quotes/payments only, no manager powers),
-- plus date-range support and summary RPCs for the Sales & Invoices and Payments lists.
-- ADDITIVE: 0001-0078 are not edited. Functions whose PARAMETER LIST changes are dropped by
-- their old signature first (same pattern as 0028), then re-created — everything else is a
-- plain create-or-replace.
--
-- Role: every sales/customer/quote/payment RLS policy and every sales RPC already routes
-- through exactly ONE gate, is_sales_staff() (RLS directly, RPCs via _rpc_require_sales_staff(),
-- which itself just calls is_sales_staff() — see 0004). So granting "sales" the whole sales
-- domain, and nothing else, is a single-function change: redefine is_sales_staff() to include
-- it. No other domain helper (is_vehicle_domain_staff, is_parts_staff, is_scrap_office,
-- is_container_staff, is_dismantling_staff, is_admin) is touched, so "sales" gets no access
-- outside this domain — confirmed by grepping every raw has_any_role('owner','engineer_admin',
-- 'manager') call site in supabase/migrations/*.sql: the ones outside is_sales_staff() itself
-- belong to vehicles/parts/dismantling/scrap triggers and helpers, not sales.
--
-- Summaries: list_sales/list_payments gain optional p_from/p_to (default null = unfiltered,
-- so every existing caller keeps working unchanged) for the UI's new date-range selector.
-- sales_summary/payments_summary are new, read-only, role-gated the same way, and filter by
-- the SAME column (created_at) the lists already sort/cursor by, so the KPI tiles and the list
-- agree for the same range by construction.
-- ---------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------
-- 1. The "sales" role itself.
-- ---------------------------------------------------------------------------------------
insert into public.roles (key, label, description) values
  ('sales', 'Sales', 'Sales desk and POS work only — customers, quotes, sales and payments. No manager powers outside this domain.')
on conflict (key) do nothing;

create or replace function public.is_sales_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role('owner', 'engineer_admin', 'manager', 'sales');
$$;
comment on function public.is_sales_staff() is
  'customers, quotes, sales, sale_items, payments, payment_allocations, invoices, returns, '
  'inventory_reservations, sales_settings (read). Matches nav.ts + route-access.ts: owner/'
  'engineer_admin/manager/sales route to /sales — auction, receiving, dismantling, '
  'scrap_driver, container_loading, export_manager and employee have no Customers & Sales '
  'screen at all. "sales" (0079) is a standalone role scoped to exactly this domain.';

-- ---------------------------------------------------------------------------------------
-- 2. list_sales: add an optional created_at range.
-- ---------------------------------------------------------------------------------------
drop function if exists public.list_sales(text, text, int, timestamptz, uuid);

create or replace function public.list_sales(
  p_search text default null,
  p_status text default null,
  p_limit int default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
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
       and (p_from is null or s.created_at >= p_from)
       and (p_to is null or s.created_at < p_to)
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

revoke execute on function public.list_sales(text, text, int, timestamptz, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.list_sales(text, text, int, timestamptz, uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. sales_summary: range totals for the Sales & Invoices KPI row. Same created_at predicate
--    as list_sales above (status/search are NOT applied — the tiles summarise the whole range,
--    the same universe the list shows by default with no status filter).
-- ---------------------------------------------------------------------------------------
create or replace function public.sales_summary(p_from timestamptz default null, p_to timestamptz default null)
returns table (
  total_count int, total_amount numeric,
  paid_count int, paid_amount numeric,
  outstanding_count int, outstanding_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._rpc_require_sales_staff();
  return query
  select
    count(*)::int,
    coalesce(sum(s.total), 0),
    count(*) filter (where s.payment_status = 'PAID')::int,
    coalesce(sum(s.total) filter (where s.payment_status = 'PAID'), 0),
    count(*) filter (where s.payment_status in ('PARTIAL', 'UNPAID'))::int,
    coalesce(sum(s.balance_due) filter (where s.payment_status in ('PARTIAL', 'UNPAID')), 0)
  from public.sales s
  where (p_from is null or s.created_at >= p_from)
    and (p_to is null or s.created_at < p_to);
end;
$$;

revoke execute on function public.sales_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.sales_summary(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. list_payments: same optional created_at range as list_sales.
-- ---------------------------------------------------------------------------------------
drop function if exists public.list_payments(text, text, int, timestamptz, uuid);

create or replace function public.list_payments(
  p_search text default null,
  p_status text default null,
  p_limit int default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  id uuid, customer_id uuid, customer_name text, amount numeric, method text, status text, reference text,
  created_at timestamptz, posted_at timestamptz, allocated_total numeric, has_more boolean
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
  if p_status is not null and p_status not in ('pending', 'posted', 'void') then
    raise exception 'unknown payment status' using errcode = '22023';
  end if;
  return query
  with page as (
    select p.*
      from public.payments p
      join public.customers c on c.id = p.customer_id
     where (v_q = '' or p.reference ilike '%' || v_q || '%'
                     or c.last_name ilike '%' || v_q || '%'
                     or c.first_name ilike '%' || v_q || '%'
                     or c.company_name ilike '%' || v_q || '%')
       and (p_status is null or p.status = p_status)
       and (p_from is null or p.created_at >= p_from)
       and (p_to is null or p.created_at < p_to)
       and (p_cursor_created_at is null or (p.created_at, p.id) < (p_cursor_created_at, p_cursor_id))
     order by p.created_at desc, p.id desc
     limit v_limit + 1
  ),
  numbered as (select page.*, row_number() over (order by page.created_at desc, page.id desc) as rn from page)
  select n.id, n.customer_id,
         public._customer_name_text(c.first_name, c.last_name, c.company_name),
         n.amount, n.method, n.status, n.reference, n.created_at, n.posted_at,
         coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.payment_id = n.id), 0),
         exists (select 1 from numbered x where x.rn = v_limit + 1)
    from numbered n
    join public.customers c on c.id = n.customer_id
   where n.rn <= v_limit
   order by n.created_at desc, n.id desc;
end;
$$;

revoke execute on function public.list_payments(text, text, int, timestamptz, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.list_payments(text, text, int, timestamptz, uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. payments_summary: range totals for the Payments KPI row. Same created_at predicate as
--    list_payments above (status/search are NOT applied, for the same reason as sales_summary).
-- ---------------------------------------------------------------------------------------
create or replace function public.payments_summary(p_from timestamptz default null, p_to timestamptz default null)
returns table (
  total_count int, total_amount numeric,
  posted_count int, posted_amount numeric,
  pending_count int, pending_amount numeric,
  void_count int, void_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._rpc_require_sales_staff();
  return query
  select
    count(*)::int,
    coalesce(sum(p.amount), 0),
    count(*) filter (where p.status = 'posted')::int,
    coalesce(sum(p.amount) filter (where p.status = 'posted'), 0),
    count(*) filter (where p.status = 'pending')::int,
    coalesce(sum(p.amount) filter (where p.status = 'pending'), 0),
    count(*) filter (where p.status = 'void')::int,
    coalesce(sum(p.amount) filter (where p.status = 'void'), 0)
  from public.payments p
  where (p_from is null or p.created_at >= p_from)
    and (p_to is null or p.created_at < p_to);
end;
$$;

revoke execute on function public.payments_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.payments_summary(timestamptz, timestamptz) to authenticated;
