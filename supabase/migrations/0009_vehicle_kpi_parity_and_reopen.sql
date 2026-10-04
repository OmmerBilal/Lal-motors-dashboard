-- =====================================================================================
-- 0009 — (1) KPI cards use the approved card definitions exactly; (2) reopen_vehicle RPC.
--
-- ADDITIVE. 0007 and 0008 are not edited. vehicle_stage_counts is re-defined here.
--
-- Card definitions, from src/lib/mock/vehicles.ts computeAuctionInventoryStats():
--   total      every vehicle
--   waiting    open, not ARRIVED, not overdue            (includes in-transit vehicles)
--   transit    open and IN_TRANSIT                       (includes overdue in-transit)
--   available  open and ARRIVED
--   overdue    open, not ARRIVED, not PROBLEM, 10+ days since purchase
--   closed     closed_reason is set
-- The table's stage filter (vehicle_stage) is a separate, single-valued classification.
-- =====================================================================================

create or replace function public.vehicle_stage_counts()
returns table (total bigint, waiting bigint, transit bigint, available bigint, overdue bigint, closed bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*),
    count(*) filter (where v.closed_reason is null
                       and v.transport_status <> 'ARRIVED'
                       and not (v.transport_status <> 'PROBLEM' and (current_date - v.purchase_date) >= 10)),
    count(*) filter (where v.closed_reason is null and v.transport_status = 'IN_TRANSIT'),
    count(*) filter (where v.closed_reason is null and v.transport_status = 'ARRIVED'),
    count(*) filter (where v.closed_reason is null
                       and v.transport_status not in ('ARRIVED', 'PROBLEM')
                       and (current_date - v.purchase_date) >= 10),
    count(*) filter (where v.closed_reason is not null)
  from public.vehicles v;
$$;

-- reopen_vehicle: reviewer roles only. Clears the closed state and records the reason in history.
create or replace function public.reopen_vehicle(p_vehicle_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.vehicles%rowtype;
  v_status text;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');

  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'a note of at least 5 characters is required' using errcode = '22023';
  end if;

  select * into v_row from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;
  if v_row.closed_reason is null then
    return jsonb_build_object('vehicle_id', v_row.id, 'status', v_row.status, 'idempotent_replay', true);
  end if;

  -- Back to the state the physical vehicle is actually in.
  v_status := case when v_row.receiving_status = 'received' then 'Available at Yard' else 'Purchased' end;

  update public.vehicles
     set closed_reason = null, closed_note = null, completed_at = null,
         status = v_status, updated_by = auth.uid()
   where id = p_vehicle_id
   returning * into v_row;

  perform public._vehicle_event(v_row.id, 'VEHICLE_REOPENED', btrim(p_note), v_status);
  perform public.write_audit_log('vehicle.reopen', 'vehicle', v_row.id,
    'Vehicle reopened', jsonb_build_object('status', v_status), btrim(p_note), null);

  return jsonb_build_object('vehicle_id', v_row.id, 'status', v_row.status, 'idempotent_replay', false);
end;
$$;

revoke execute on function public.vehicle_stage_counts() from public, anon;
grant execute on function public.vehicle_stage_counts() to authenticated;
revoke execute on function public.reopen_vehicle(uuid, text) from public, anon;
grant execute on function public.reopen_vehicle(uuid, text) to authenticated;
