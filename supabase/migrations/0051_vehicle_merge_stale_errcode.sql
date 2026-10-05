-- =====================================================================================
-- 0051 — vehicle_apply_merge: stale check uses an ordinary exception (P0001) instead of a serialization
-- error (40001), and a lock wait ends after 5 seconds. Same signature, same rules as 0050.
-- Found while testing 0050: a 40001 raised through PostgREST left pooled sessions idle in an aborted transaction.
-- =====================================================================================

create or replace function public.vehicle_apply_merge(
  p_vehicle_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set lock_timeout = '5s'
as $$
declare
  v_row public.vehicles%rowtype;
  v_key text;
  v_fields jsonb := '{}'::jsonb;
  v_identifiers jsonb := '{}'::jsonb;
  v_changed text[] := '{}';
  v_identifier_keys text[] := array['lot_number', 'stock_number'];
begin
  if not public.has_any_role('owner', 'engineer_admin', 'manager', 'auction') then
    raise exception 'your role cannot merge vehicle details' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'choose at least one field to use from the new record' using errcode = '22023';
  end if;

  select * into v_row from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'STALE: this vehicle changed after the comparison was made. Refresh and compare again.' using errcode = 'P0001';
  end if;
  if v_row.closed_reason is not null then
    raise exception 'this vehicle is closed. Reopen it before merging.' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key = 'vin' then
      raise exception 'the VIN identifies the vehicle and cannot be merged' using errcode = '22023';
    end if;
    if v_key = any (v_identifier_keys) then
      -- Identifiers are filled only when blank. An existing lot or stock number is never replaced.
      if v_key = 'lot_number' and coalesce(v_row.lot_number, '') <> '' then
        raise exception 'the lot number is already set and cannot be replaced by a merge' using errcode = '22023';
      end if;
      if v_key = 'stock_number' and coalesce(v_row.stock_number, '') <> '' then
        raise exception 'the stock number is already set and cannot be replaced by a merge' using errcode = '22023';
      end if;
      v_identifiers := v_identifiers || jsonb_build_object(v_key, p_changes->v_key);
    else
      v_fields := v_fields || jsonb_build_object(v_key, p_changes->v_key);
    end if;
    v_changed := array_append(v_changed, v_key);
  end loop;

  -- Descriptive fields go through the same validated edit path as a detail edit (role, closed state, whitelist, audit).
  if v_fields <> '{}'::jsonb then
    perform public.vehicle_edit_fields(p_vehicle_id, v_fields);
  end if;

  if v_identifiers <> '{}'::jsonb then
    update public.vehicles set
      lot_number = case when v_identifiers ? 'lot_number' then nullif(btrim(v_identifiers->>'lot_number'), '') else lot_number end,
      stock_number = case when v_identifiers ? 'stock_number' then nullif(btrim(v_identifiers->>'stock_number'), '') else stock_number end
     where id = p_vehicle_id;
    perform public._vehicle_event(p_vehicle_id, 'DETAILS_MERGED', 'Merged from a new record: ' || array_to_string(v_changed, ', '), null);
  else
    perform public._vehicle_event(p_vehicle_id, 'DETAILS_MERGED', 'Merged from a new record: ' || array_to_string(v_changed, ', '), null);
  end if;

  perform public.write_audit_log('vehicle.merged', 'vehicle', p_vehicle_id, 'Merged from a new intake record', jsonb_build_object('fields', v_changed), null, null);
  return public.vehicle_get(p_vehicle_id);
end;
$$;

revoke execute on function public.vehicle_apply_merge(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.vehicle_apply_merge(uuid, timestamptz, jsonb) to authenticated;
