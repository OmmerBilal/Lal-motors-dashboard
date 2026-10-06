-- =====================================================================================
-- 0075 — Warehouse lists: fix the row shape passed to _warehouse_row (0074 cast a row with an extra column).
-- The lists now carry the whole parts row as one value, so the shared row shape is built from a real parts row.
-- Same rules, same bounds, same keyset paging as 0074. ADDITIVE: replaces two function bodies.
-- =====================================================================================

create or replace function public.warehouse_list(p_view text, p_after uuid default null, p_limit int default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_rows jsonb;
  v_more boolean;
begin
  perform public._warehouse_require();
  if p_view not in ('pending', 'stored') then
    raise exception 'unknown view' using errcode = '22023';
  end if;
  with page as (
    select p as part from public.parts p
     where public._warehouse_is_inventory(p)
       and (p_after is null or p.id > p_after)
       and ((p_view = 'pending' and nullif(btrim(coalesce(p.location, '')), '') is null and p.quantity > 0)
         or (p_view = 'stored' and nullif(btrim(coalesce(p.location, '')), '') is not null))
     order by p.id
     limit v_limit + 1
  ), numbered as (
    select pg.part, row_number() over (order by (pg.part).id) as rn from page pg
  )
  select coalesce(jsonb_agg(public._warehouse_row(n.part) order by (n.part).id) filter (where n.rn <= v_limit), '[]'::jsonb),
         coalesce(bool_or(n.rn > v_limit), false)
    into v_rows, v_more
    from numbered n;
  return jsonb_build_object('rows', v_rows, 'has_more', v_more);
end;
$$;

create or replace function public.warehouse_search(p_query text, p_limit int default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 25);
begin
  perform public._warehouse_require();
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(public._warehouse_row(x.part) order by x.exact desc, (x.part).part_name, (x.part).id)
      from (
        select p as part, (p.stock_sku = v_q) as exact
          from public.parts p
         where public._warehouse_is_inventory(p)
           and (p.stock_sku = v_q or p.part_name ilike '%' || v_q || '%'
                or p.stock_sku ilike '%' || v_q || '%' or p.part_number ilike '%' || v_q || '%')
         order by (p.stock_sku = v_q) desc, p.part_name, p.id
         limit v_limit
      ) x), '[]'::jsonb);
end;
$$;
