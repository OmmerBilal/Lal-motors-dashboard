-- =====================================================================================
-- 0059 — receive_vehicle refuses dismantled vehicles (QA issue 2). ADDITIVE in intent: replaces the function body only.
--
-- Body is identical to 0006 except for one guard: a vehicle whose status is 'Dismantled' can no longer be received.
-- The idempotent replay for the same employee is kept first, so a retry after a successful receipt still returns the
-- existing result. Grants and revokes from 0006 are unchanged (create or replace keeps them).
-- =====================================================================================

create or replace function public.receive_vehicle(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.vehicles%rowtype;
  v_photos int;
  v_new_status text;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'receiving');

  select * into v_row from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;
  if v_row.closed_reason is not null then
    raise exception 'vehicle is closed and cannot be received' using errcode = 'P0001';
  end if;

  -- Retry-safe: the same employee confirming again gets the existing result; anyone else is refused.
  if v_row.receiving_status = 'received' then
    if v_row.received_by = auth.uid() then
      return jsonb_build_object('vehicle_id', v_row.id, 'receiving_status', 'received', 'idempotent_replay', true);
    end if;
    raise exception 'this vehicle was already received by another employee' using errcode = 'P0001';
  end if;

  -- A dismantled vehicle is no longer in the yard flow and cannot be received.
  if v_row.status = 'Dismantled' then
    raise exception 'vehicle is dismantled and cannot be received' using errcode = 'P0001';
  end if;

  select count(distinct m.role) into v_photos
    from public.media_assets m
   where m.owner_type = 'vehicle'
     and m.owner_id = p_vehicle_id
     and m.variant = 'original'
     and m.status = 'ready'
     and m.role in ('arrival_front', 'arrival_rear', 'arrival_left', 'arrival_right');
  if v_photos < 4 then
    raise exception 'capture all 4 arrival photos first (% of 4 present)', v_photos using errcode = 'P0001';
  end if;

  -- Lifecycle: a vehicle that was in transit or arrived is now available at the yard.
  v_new_status := case
    when v_row.status in ('In Transit', 'Arrived', 'Awaiting Transport', 'Assigned') then 'Available at Yard'
    else v_row.status
  end;

  update public.vehicles
     set receiving_status = 'received',
         received_by = auth.uid(),
         received_at = now(),
         status = v_new_status,
         transport_status = case when transport_status in ('ASSIGNED', 'IN_TRANSIT') then 'ARRIVED' else transport_status end,
         arrival_date = coalesce(arrival_date, now()),
         updated_by = auth.uid()
   where id = p_vehicle_id
   returning * into v_row;

  perform public._vehicle_event(v_row.id, 'RECEIVED', '4 arrival photos recorded', v_new_status);
  perform public.write_audit_log('vehicle.receive', 'vehicle', v_row.id,
    'Vehicle received at yard', jsonb_build_object('status', v_new_status, 'photos', v_photos), null, null);

  return jsonb_build_object('vehicle_id', v_row.id, 'receiving_status', v_row.receiving_status, 'status', v_row.status, 'idempotent_replay', false);
end;
$$;
