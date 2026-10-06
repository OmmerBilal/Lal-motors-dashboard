-- =====================================================================================
-- 0074 — Warehouse Employee App: inventory location workspace. ADDITIVE; no new tables or columns.
--
-- Uses the SAME parts rows. The only write is the warehouse location (parts.location, the existing single location
-- field). Every change writes a part_operations history row (previous and new location, actor, timestamp) and an audit row.
-- Warehouse Employee (role key 'employee') may read inventory and set location. Owner, engineer_admin and manager may
-- use the same screens for review. Nothing here reads or writes price, cost, invoice, payment, customer, quantity,
-- SKU or approval state.
-- =====================================================================================

-- Who may use the warehouse screens.
create or replace function public._warehouse_require()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.has_any_role('employee', 'owner', 'engineer_admin', 'manager') then
    raise exception 'forbidden: a warehouse role is required' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public._warehouse_require() from public, anon, authenticated;

-- A valid inventory part: approved, not marked non-sellable, and physically present or in processing (not missing, damaged or returned).
create or replace function public._warehouse_is_inventory(p public.parts)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p.status = 'approved'
     and p.not_sellable_reason is null
     and p.operational_status not in ('MISSING', 'DAMAGED', 'RETURNED');
$$;
revoke execute on function public._warehouse_is_inventory(public.parts) from public, anon, authenticated;

-- Shared row shape for every warehouse list. No price or cost columns.
create or replace function public._warehouse_row(p public.parts)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id, 'part_name', p.part_name, 'stock_sku', p.stock_sku, 'part_number', p.part_number,
    'quantity', p.quantity, 'location', nullif(btrim(coalesce(p.location, '')), ''),
    'status', p.status, 'operational_status', p.operational_status,
    'thumbnail_asset_id', p.thumbnail_asset_id, 'updated_at', p.updated_at);
$$;
revoke execute on function public._warehouse_row(public.parts) from public, anon, authenticated;

-- Summary counts for the two cards.
create or replace function public.warehouse_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._warehouse_require();
  return jsonb_build_object(
    'pending', (select count(*)::int from public.parts p
                 where public._warehouse_is_inventory(p) and nullif(btrim(coalesce(p.location, '')), '') is null and p.quantity > 0),
    'stored', (select count(*)::int from public.parts p
                where public._warehouse_is_inventory(p) and nullif(btrim(coalesce(p.location, '')), '') is not null));
end;
$$;

-- Pending Putaway or Stored Inventory, one bounded page at a time (keyset on id).
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
    select p.* from public.parts p
     where public._warehouse_is_inventory(p)
       and (p_after is null or p.id > p_after)
       and ((p_view = 'pending' and nullif(btrim(coalesce(p.location, '')), '') is null and p.quantity > 0)
         or (p_view = 'stored' and nullif(btrim(coalesce(p.location, '')), '') is not null))
     order by p.id
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(public._warehouse_row(x) order by x.id) filter (where x.rn <= v_limit), '[]'::jsonb),
         coalesce(bool_or(x.rn > v_limit), false)
    into v_rows, v_more
    from (select pg.*, row_number() over (order by pg.id) as rn from page pg) x;
  return jsonb_build_object('rows', v_rows, 'has_more', v_more);
end;
$$;

-- Bounded search by name, SKU or OEM / interchange number. Two characters minimum; 25 rows at most.
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
    select jsonb_agg(public._warehouse_row(x) order by x.exact desc, x.part_name, x.id)
      from (
        select p.*, (p.stock_sku = v_q) as exact
          from public.parts p
         where public._warehouse_is_inventory(p)
           and (p.stock_sku = v_q or p.part_name ilike '%' || v_q || '%'
                or p.stock_sku ilike '%' || v_q || '%' or p.part_number ilike '%' || v_q || '%')
         order by (p.stock_sku = v_q) desc, p.part_name, p.id
         limit v_limit
      ) x), '[]'::jsonb);
end;
$$;

-- One part: its fields, the donor / source reference that already exists on the part, and its history.
create or replace function public.warehouse_get_part(p_part_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.parts%rowtype;
begin
  perform public._warehouse_require();
  select * into p from public.parts where id = p_part_id;
  if not found then
    raise exception 'part not found' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'part', public._warehouse_row(p) || jsonb_build_object(
              'source_vin', nullif(p.source_vin, ''), 'source_lot', nullif(p.source_lot, ''),
              'vehicle_id', p.vehicle_id, 'inventory_source', p.inventory_source,
              'can_place', public._warehouse_is_inventory(p)),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('action', h.action_type, 'previous_location', h.previous_location,
                                          'new_location', h.new_location, 'note', h.note,
                                          'actor_name', h.actor_name, 'actor_role', h.actor_role,
                                          'created_at', h.created_at) order by h.created_at desc)
        from (select * from public.part_operations where part_id = p_part_id order by created_at desc limit 30) h
    ), '[]'::jsonb));
end;
$$;

-- Assign or change the warehouse location. The only write this screen can make.
create or replace function public.warehouse_set_location(p_part_id uuid, p_location text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.parts%rowtype;
  v_loc text := btrim(coalesce(p_location, ''));
  v_prev text;
begin
  perform public._warehouse_require();
  select * into p from public.parts where id = p_part_id for update;
  if not found then
    raise exception 'part not found' using errcode = '22023';
  end if;
  if not public._warehouse_is_inventory(p) then
    raise exception 'only an approved inventory part can be placed (missing, damaged, returned or non-sellable parts cannot)' using errcode = 'P0001';
  end if;
  if char_length(v_loc) < 1 or char_length(v_loc) > 80 then
    raise exception 'enter a location of 1 to 80 characters' using errcode = '22023';
  end if;
  if v_loc ~ '[[:cntrl:]]' then
    raise exception 'the location may not contain control characters' using errcode = '22023';
  end if;
  v_prev := nullif(btrim(coalesce(p.location, '')), '');
  if v_prev is not distinct from v_loc then
    return public.warehouse_get_part(p_part_id);  -- same location: no change, no history row
  end if;

  update public.parts set location = v_loc where id = p_part_id;
  perform public._parts_history(p, 'LOCATION_CHANGE',
    case when v_prev is null then 'Location assigned: ' || v_loc
         else 'Location changed: ' || v_prev || ' → ' || v_loc end,
    null, null, v_prev, v_loc);
  perform public.write_audit_log('part.location_change', 'part', p_part_id, 'Warehouse location changed',
    jsonb_build_object('previous_location', v_prev, 'new_location', v_loc), null, null);
  return public.warehouse_get_part(p_part_id);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'warehouse_summary()', 'warehouse_list(text,uuid,int)', 'warehouse_search(text,int)',
    'warehouse_get_part(uuid)', 'warehouse_set_location(uuid,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
