-- =====================================================================================
-- 0025 — list_customers(): cast citext email to text so the result matches the declared type.
--
-- ADDITIVE. 0024 is applied and not edited. Found by rpc-customers.mjs: the function declared
-- email as text, but customers.email is citext, so the call failed with a result-type mismatch.
-- =====================================================================================

create or replace function public.list_customers(
  p_search text default null,
  p_limit int default 25,
  p_cursor_last text default null,
  p_cursor_first text default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid, customer_number text, display_name text, phone text, email text,
  customer_type text, tax_status text, has_more boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_digits text := public.normalize_phone(p_search);
  v_q text := btrim(coalesce(p_search, ''));
begin
  perform public._rpc_require_sales_staff();
  return query
  with page as (
    select c.*
      from public.customers c
     where (v_q = '' or
            (v_digits <> '' and c.phone_normalized like v_digits || '%') or
            c.last_name ilike '%' || v_q || '%' or
            c.first_name ilike '%' || v_q || '%' or
            c.company_name ilike '%' || v_q || '%' or
            c.email ilike '%' || v_q || '%' or
            c.customer_number ilike '%' || v_q || '%')
       and (p_cursor_last is null or (c.last_name, c.first_name, c.id) > (p_cursor_last, p_cursor_first, p_cursor_id))
     order by c.last_name, c.first_name, c.id
     limit v_limit + 1
  ),
  numbered as (select page.*, row_number() over (order by page.last_name, page.first_name, page.id) as rn from page)
  select n.id, n.customer_number,
         public._customer_name_text(n.first_name, n.last_name, n.company_name),
         n.phone_normalized, n.email::text, n.customer_type, n.tax_status,
         exists (select 1 from numbered x where x.rn = v_limit + 1)
    from numbered n
   where n.rn <= v_limit
   order by n.last_name, n.first_name, n.id;
end;
$$;

revoke execute on function public.list_customers(text, int, text, text, uuid) from public, anon;
grant execute on function public.list_customers(text, int, text, text, uuid) to authenticated;
