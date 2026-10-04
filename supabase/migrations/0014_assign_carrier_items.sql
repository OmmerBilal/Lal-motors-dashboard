-- =====================================================================================
-- 0014 — assign_carrier_items(): one carrier, a transport price PER VEHICLE, one atomic batch.
--
-- ADDITIVE. assign_carrier() (0006) takes one price for the whole batch. The approved dispatch
-- modal lets each vehicle carry its own price, so calling assign_carrier per price group would
-- be non-atomic. This function does the whole batch in one transaction.
-- Same checks as assign_carrier(): dispatch roles only, active carrier, not closed, not already
-- in transit or arrived, all-or-nothing.
-- =====================================================================================

create or replace function public.assign_carrier_items(p_carrier_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carrier public.carriers%rowtype;
  v_row public.vehicles%rowtype;
  v_item jsonb;
  v_ids uuid[];
  v_price numeric;
  v_assigned int := 0;
  v_skipped int := 0;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'auction');

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'select at least one vehicle' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'assign at most 200 vehicles at once' using errcode = '22023';
  end if;

  -- Validate the shape of every item before touching any row.
  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item->>'vehicle_id') is null then
      raise exception 'each item needs a vehicle_id' using errcode = '22023';
    end if;
    v_price := (v_item->>'transport_price')::numeric;
    perform public._require_money_positive(v_price, 'transport price');
  end loop;

  select * into v_carrier from public.carriers where id = p_carrier_id;
  if not found or not v_carrier.active then
    raise exception 'choose an active carrier' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct (e->>'vehicle_id')::uuid order by (e->>'vehicle_id')::uuid), '{}') into v_ids
    from jsonb_array_elements(p_items) e;
  if array_length(v_ids, 1) <> jsonb_array_length(p_items) then
    raise exception 'each vehicle may appear only once in a batch' using errcode = '22023';
  end if;

  perform 1 from public.vehicles where id = any(v_ids) order by id for update;
  if (select count(*) from public.vehicles where id = any(v_ids)) <> array_length(v_ids, 1) then
    raise exception 'one or more vehicles were not found' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_row from public.vehicles where id = (v_item->>'vehicle_id')::uuid;
    v_price := (v_item->>'transport_price')::numeric;

    if v_row.closed_reason is not null then
      raise exception 'vehicle % is closed and cannot be dispatched', v_row.id using errcode = 'P0001';
    end if;
    if v_row.transport_status not in ('NEED_TRANSPORT', 'READY_TO_POST', 'POSTED_TO_CD', 'ASSIGNED') then
      raise exception 'vehicle % is already in transit or arrived (%)', v_row.id, v_row.transport_status using errcode = 'P0001';
    end if;
    if v_row.carrier_id = p_carrier_id and v_row.transport_price = v_price and v_row.transport_status = 'ASSIGNED' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.vehicles
       set carrier_id = p_carrier_id, transport_price = v_price,
           transport_status = 'ASSIGNED', transport_problem = null, updated_by = auth.uid()
     where id = v_row.id;
    perform public._vehicle_event(v_row.id, 'CARRIER_ASSIGNED', 'Carrier ' || v_carrier.company || ' at ' || v_price, 'ASSIGNED');
    v_assigned := v_assigned + 1;
  end loop;

  perform public.write_audit_log('vehicle.assign_carrier_items', 'carrier', p_carrier_id,
    'Carrier assigned to ' || v_assigned || ' vehicle(s) with per-vehicle prices',
    jsonb_build_object('assigned', v_assigned, 'unchanged', v_skipped, 'items', p_items), null, null);

  return jsonb_build_object('assigned', v_assigned, 'unchanged', v_skipped, 'carrier_id', p_carrier_id);
end;
$$;

revoke execute on function public.assign_carrier_items(uuid, jsonb) from public, anon;
grant execute on function public.assign_carrier_items(uuid, jsonb) to authenticated;
