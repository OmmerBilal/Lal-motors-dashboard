-- =====================================================================================
-- 0069 — search_sellable_parts also returns the OEM / interchange number, so the Sales Desk can show the part's
-- identity in full. The return columns change, so the function is recreated (drop and create). Behaviour is the same
-- as 0066: nothing is listed before two characters or an exact SKU, at most 20 results, sellable parts only.
-- Sellability (_part_is_sellable_state) is unchanged; manual and dismantled parts use the same rule.
-- =====================================================================================

drop function if exists public.search_sellable_parts(text, int);

create or replace function public.search_sellable_parts(p_search text default null, p_limit int default 20)
returns table (
  id uuid, part_name text, stock_sku text, part_number text, price numeric, quantity int, available int,
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
  if char_length(v_q) < 2 then
    return;
  end if;
  return query
  select p.id, p.part_name, p.stock_sku, p.part_number, p.price, p.quantity,
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

revoke execute on function public.search_sellable_parts(text, int) from public, anon;
grant execute on function public.search_sellable_parts(text, int) to authenticated;
