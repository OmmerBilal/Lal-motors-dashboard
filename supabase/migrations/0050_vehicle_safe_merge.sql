-- =====================================================================================
-- 0050 — Safe existing-vehicle merge (Module 01). ADDITIVE: one new function.
--
-- The intake review compares an incoming vehicle with the existing record and lets a person choose, field by field,
-- which values to keep or take. This function applies only the chosen values, and only after it has checked:
--   * the caller's role (same roles as vehicle_edit_fields);
--   * that the row is still the one that was compared (updated_at unchanged), otherwise it refuses as STALE;
--   * the vehicle is open (closed vehicles need a reopen first);
--   * each field is on the merge whitelist. VIN is never merged. Lot and stock are merged only when the current
--     value is blank, so an existing identifier is never replaced.
-- Protected lifecycle, status, history, transport, financial and system fields are not reachable from here.
-- Every merge writes one event and one audit row that name the fields.
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
    raise exception 'STALE: this vehicle changed after the comparison was made. Refresh and compare again.' using errcode = '40001';
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
