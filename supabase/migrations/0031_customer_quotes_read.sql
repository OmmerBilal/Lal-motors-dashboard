-- ---------------------------------------------------------------------------------------
-- 0031 — Quotes for one customer (read only). Used by the customer detail screen so its
-- quotes panel shows real quotes instead of the client-side mock list.
-- Sales staff only, same rule as the other sales read models.
-- ---------------------------------------------------------------------------------------

create or replace function public.list_customer_quotes(p_customer_id uuid, p_limit int default 50)
returns table (
  id uuid, quote_number text, status text, total numeric, created_at timestamptz, converted_sale_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform public._rpc_require_sales_staff();
  return query
  select q.id, q.quote_number, q.status, q.total, q.created_at, q.converted_sale_id
    from public.quotes q
   where q.customer_id = p_customer_id
   order by q.created_at desc, q.id desc
   limit v_limit;
end;
$$;

revoke execute on function public.list_customer_quotes(uuid, int) from public, anon;
grant execute on function public.list_customer_quotes(uuid, int) to authenticated;
