-- ---------------------------------------------------------------------------------------
-- 0032 — Payments (Module 09): read models and a write-path guard.
--
-- 1. Direct INSERT on payments is closed for clients. The RLS policy payments_domain_insert let
--    sales staff insert payment rows straight into the table, skipping create_payment's
--    idempotency, validation and audit. create_payment (security definer) is the only writer.
--    No other writes existed: payments have no update policy, and allocations have no client policy.
-- 2. list_payments: lightweight keyset-paged rows for the Payments list.
-- 3. get_payment_detail: one payment with its allocations, affected sales and history, on demand.
-- 4. list_sale_payments: payments allocated to one sale, for the Sale Detail.
--
-- Money is NUMERIC. unallocated_amount is computed here, not in the browser.
-- Sales staff only, matching the existing payment RPCs. Posted-payment reversals stay admin-only
-- inside void_payment (migration 0004).
-- ---------------------------------------------------------------------------------------

revoke insert on public.payments from authenticated;

create or replace function public.list_payments(
  p_search text default null,
  p_status text default null,
  p_limit int default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
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

create or replace function public.get_payment_detail(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_p public.payments%rowtype;
  v_allocated numeric;
  v_cust jsonb;
  v_allocs jsonb;
begin
  perform public._rpc_require_sales_staff();
  select * into v_p from public.payments where id = p_payment_id;
  if not found then
    raise exception 'payment not found' using errcode = '22023';
  end if;

  select coalesce(sum(amount), 0) into v_allocated from public.payment_allocations where payment_id = p_payment_id;

  select jsonb_build_object('id', c.id, 'customer_number', c.customer_number,
                            'name', public._customer_name_text(c.first_name, c.last_name, c.company_name),
                            'phone', c.phone_normalized)
    into v_cust from public.customers c where c.id = v_p.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pa.id, 'sale_id', s.id, 'sale_number', s.sale_number, 'sale_total', s.total,
           'sale_amount_paid', s.amount_paid, 'sale_balance_due', s.balance_due,
           'sale_payment_status', s.payment_status, 'amount', pa.amount, 'created_at', pa.created_at)
         order by pa.created_at, pa.id), '[]'::jsonb)
    into v_allocs
    from public.payment_allocations pa join public.sales s on s.id = pa.sale_id
   where pa.payment_id = p_payment_id;

  return jsonb_build_object(
    'payment', jsonb_build_object(
      'id', v_p.id, 'customer_id', v_p.customer_id, 'amount', v_p.amount, 'method', v_p.method,
      'reference', v_p.reference, 'notes', v_p.notes, 'status', v_p.status,
      'created_at', v_p.created_at, 'posted_at', v_p.posted_at, 'voided_at', v_p.voided_at,
      'void_reason', v_p.void_reason,
      'allocated_total', v_allocated, 'unallocated_amount', v_p.amount - v_allocated),
    'customer', v_cust,
    'allocations', v_allocs,
    'viewer_is_admin', public.is_admin(),
    'history', public._business_history('payment', p_payment_id, null));
end;
$$;

create or replace function public.list_sale_payments(p_sale_id uuid)
returns table (
  payment_id uuid, allocation_id uuid, allocated_amount numeric, payment_status text, method text,
  payment_amount numeric, created_at timestamptz, posted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._rpc_require_sales_staff();
  return query
  select p.id, pa.id, pa.amount, p.status, p.method, p.amount, pa.created_at, p.posted_at
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
   where pa.sale_id = p_sale_id
   order by pa.created_at, pa.id;
end;
$$;

revoke execute on function public.list_payments(text, text, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_payments(text, text, int, timestamptz, uuid) to authenticated;
revoke execute on function public.get_payment_detail(uuid) from public, anon;
grant execute on function public.get_payment_detail(uuid) to authenticated;
revoke execute on function public.list_sale_payments(uuid) from public, anon;
grant execute on function public.list_sale_payments(uuid) to authenticated;
