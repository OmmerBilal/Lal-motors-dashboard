-- =====================================================================================
-- 0006 — Vehicle business RPCs: intake matching, close, carrier assignment, transport
-- status, and receiving.
--
-- ADDITIVE. 0001–0005 are not edited.
--
-- Same rules as 0004: SECURITY DEFINER with fixed search_path, caller authenticated and
-- authorized inside each body, EXECUTE granted to authenticated only, audit on every change,
-- and deterministic row locking. The guard triggers on vehicles skip when current_user is not
-- authenticated (the definer case), so these RPCs carry the role checks themselves.
--
-- Receiving evidence: the four required arrival photos are media_assets rows with
-- owner_type = 'vehicle', owner_id = the vehicle, role in
-- ('arrival_front','arrival_rear','arrival_left','arrival_right'), variant 'original',
-- status 'ready'. Matches the approved UI slots (Front View, Rear View, Left Side, Right Side).
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- 1. Role helpers
-- ---------------------------------------------------------------------------------------
create or replace function public._rpc_require_roles(variadic p_roles text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.has_any_role(variadic p_roles) then
    raise exception 'forbidden: your role may not perform this action' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public._rpc_require_roles(text[]) from public, anon, authenticated;

-- Normalizes a VIN for comparison: trimmed, upper-case, no internal spaces.
create or replace function public._norm_vin(p text)
returns text
language sql
immutable
set search_path = public
as $$ select nullif(upper(regexp_replace(btrim(coalesce(p, '')), '\s+', '', 'g')), ''); $$;

create or replace function public._norm_text(p text)
returns text
language sql
immutable
set search_path = public
as $$ select nullif(btrim(coalesce(p, '')), ''); $$;

-- Writes one vehicle_events row. actor_name comes from the profile, never from the browser.
create or replace function public._vehicle_event(p_vehicle_id uuid, p_action text, p_note text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select name into v_name from public.profiles where id = auth.uid();
  insert into public.vehicle_events (vehicle_id, action, note, status, actor_id, actor_name)
  values (p_vehicle_id, p_action, p_note, p_status, auth.uid(), coalesce(v_name, 'unknown'));
end;
$$;
revoke execute on function public._vehicle_event(uuid, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. match_or_create_vehicle
--   Identity rule: a vehicle is matched by VIN (exact), then stock number, then lot + auction
--   source. A match never overwrites the existing record. Contradictions (two different rows,
--   or a row whose VIN differs from the incoming VIN) return 'conflict' and write nothing.
--   Retries are safe because a second call matches the row the first call created.
-- ---------------------------------------------------------------------------------------
create or replace function public.match_or_create_vehicle(
  p_vin            text,
  p_lot_number     text,
  p_stock_number   text,
  p_auction_source text,
  p_fields         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vin text := public._norm_vin(p_vin);
  v_lot text := public._norm_text(p_lot_number);
  v_stock text := public._norm_text(p_stock_number);
  v_source text := public._norm_text(p_auction_source);
  v_ids uuid[];
  v_row public.vehicles%rowtype;
  v_match_by text;
  v_year int;
  v_make text;
  v_model text;
  v_new public.vehicles%rowtype;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'auction');

  if v_vin is null and v_stock is null and v_lot is null then
    raise exception 'enter a VIN, stock number, or lot number' using errcode = '22023';
  end if;
  if v_vin is not null and char_length(v_vin) <> 17 then
    raise exception 'VIN must be 17 characters' using errcode = '22023';
  end if;
  if v_vin is not null and v_vin ~ '[IOQ]' then
    raise exception 'VIN may not contain I, O or Q' using errcode = '22023';
  end if;
  if v_lot is not null and v_source is null then
    raise exception 'a lot number needs an auction source' using errcode = '22023';
  end if;

  -- Candidate rows from every identifier. Lock them in id order so concurrent intakes serialize.
  select coalesce(array_agg(id order by id), '{}') into v_ids
    from public.vehicles
   where (v_vin is not null and vin = v_vin)
      or (v_stock is not null and stock_number = v_stock)
      or (v_lot is not null and v_source is not null and lot_number = v_lot and auction_source = v_source);

  if array_length(v_ids, 1) is not null then
    perform 1 from public.vehicles where id = any(v_ids) order by id for update;

    if array_length(v_ids, 1) > 1 then
      return jsonb_build_object('outcome', 'conflict', 'reason',
        'These identifiers point at more than one existing vehicle. Resolve the duplicate before intake.',
        'candidate_ids', v_ids);
    end if;

    select * into v_row from public.vehicles where id = v_ids[1];

    -- Contradiction check: an identifier supplied now that disagrees with the stored value.
    if v_vin is not null and v_row.vin is not null and v_row.vin <> v_vin then
      return jsonb_build_object('outcome', 'conflict', 'reason', 'Matched vehicle has a different VIN.', 'vehicle_id', v_row.id);
    end if;
    if v_stock is not null and v_row.stock_number is not null and v_row.stock_number <> v_stock then
      return jsonb_build_object('outcome', 'conflict', 'reason', 'Matched vehicle has a different stock number.', 'vehicle_id', v_row.id);
    end if;
    if v_lot is not null and v_row.lot_number is not null and v_row.lot_number <> v_lot then
      return jsonb_build_object('outcome', 'conflict', 'reason', 'Matched vehicle has a different lot number.', 'vehicle_id', v_row.id);
    end if;

    v_match_by := case
      when v_vin is not null and v_row.vin = v_vin then 'vin'
      when v_stock is not null and v_row.stock_number = v_stock then 'stock_number'
      else 'lot_and_source' end;

    return jsonb_build_object('outcome', 'existing', 'matched_by', v_match_by, 'vehicle_id', v_row.id);
  end if;

  -- No match: create. Year, make and model are required for a new record.
  v_year := nullif(p_fields->>'year', '')::int;
  v_make := public._norm_text(p_fields->>'make');
  v_model := public._norm_text(p_fields->>'model');
  if v_year is null or v_year < 1950 or v_year > 2100 then
    raise exception 'a valid model year is required for a new vehicle' using errcode = '22023';
  end if;
  if v_make is null or v_model is null then
    raise exception 'make and model are required for a new vehicle' using errcode = '22023';
  end if;

  begin
    insert into public.vehicles (
      vin, lot_number, stock_number, auction_item_number, auction_source,
      year, make, model, trim, engine, mileage, title_status, location,
      purchase_price, auction_fees, transportation_cost, status, created_by, updated_by
    ) values (
      v_vin, v_lot, v_stock, public._norm_text(p_fields->>'auction_item_number'), coalesce(v_source, ''),
      v_year, v_make, v_model,
      coalesce(public._norm_text(p_fields->>'trim'), ''),
      coalesce(public._norm_text(p_fields->>'engine'), ''),
      nullif(p_fields->>'mileage', '')::int,
      coalesce(public._norm_text(p_fields->>'title_status'), 'Pending'),
      coalesce(public._norm_text(p_fields->>'location'), ''),
      coalesce(nullif(p_fields->>'purchase_price', '')::numeric, 0),
      coalesce(nullif(p_fields->>'auction_fees', '')::numeric, 0),
      coalesce(nullif(p_fields->>'transportation_cost', '')::numeric, 0),
      'Purchased', auth.uid(), auth.uid()
    ) returning * into v_new;
  exception when unique_violation then
    -- A concurrent intake created the same identity between our check and insert. Report it.
    return jsonb_build_object('outcome', 'conflict', 'reason', 'Another intake for this vehicle was saved at the same moment. Refresh and try again.');
  end;

  perform public._vehicle_event(v_new.id, 'VEHICLE_CREATED', 'Created by auction intake', 'Purchased');
  perform public.write_audit_log('vehicle.create', 'vehicle', v_new.id,
    'Vehicle created (' || coalesce(v_vin, v_stock, v_lot) || ')',
    jsonb_build_object('vin', v_vin, 'stock_number', v_stock, 'lot_number', v_lot), null, null);

  return jsonb_build_object('outcome', 'created', 'vehicle_id', v_new.id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. close_vehicle — soft close, never a delete. Reviewer roles only (matches the guard trigger).
-- ---------------------------------------------------------------------------------------
create or replace function public.close_vehicle(p_vehicle_id uuid, p_reason text, p_note text)
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

  if p_reason not in ('Scrapped', 'Sold Complete', 'Exported', 'Other') then
    raise exception 'choose a close reason' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'a note of at least 5 characters is required' using errcode = '22023';
  end if;

  select * into v_row from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;
  if v_row.closed_reason is not null then
    return jsonb_build_object('vehicle_id', v_row.id, 'status', v_row.status, 'closed_reason', v_row.closed_reason, 'idempotent_replay', true);
  end if;

  v_status := case when p_reason = 'Scrapped' then 'Scrapped / Closed' else 'Completed' end;

  update public.vehicles
     set closed_reason = p_reason,
         closed_note = btrim(p_note),
         status = v_status,
         completed_at = now(),
         updated_by = auth.uid()
   where id = p_vehicle_id
   returning * into v_row;

  perform public._vehicle_event(v_row.id, 'VEHICLE_CLOSED', btrim(p_note), v_status);
  perform public.write_audit_log('vehicle.close', 'vehicle', v_row.id,
    'Vehicle closed: ' || p_reason, jsonb_build_object('status', v_status), btrim(p_note), null);

  return jsonb_build_object('vehicle_id', v_row.id, 'status', v_row.status, 'closed_reason', v_row.closed_reason, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. assign_carrier — bulk, all-or-nothing. Same vehicle rows as intake (no dispatch copy).
-- ---------------------------------------------------------------------------------------
create or replace function public.assign_carrier(p_vehicle_ids uuid[], p_carrier_id uuid, p_transport_price numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carrier public.carriers%rowtype;
  v_row public.vehicles%rowtype;
  v_assigned int := 0;
  v_skipped int := 0;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'auction');

  if p_vehicle_ids is null or array_length(p_vehicle_ids, 1) is null then
    raise exception 'select at least one vehicle' using errcode = '22023';
  end if;
  if array_length(p_vehicle_ids, 1) > 200 then
    raise exception 'assign at most 200 vehicles at once' using errcode = '22023';
  end if;
  perform public._require_money_positive(p_transport_price, 'transport price');

  select * into v_carrier from public.carriers where id = p_carrier_id;
  if not found or not v_carrier.active then
    raise exception 'choose an active carrier' using errcode = '22023';
  end if;

  -- Lock every selected vehicle in id order, then validate the whole batch before writing.
  perform 1 from public.vehicles where id = any(p_vehicle_ids) order by id for update;
  if (select count(*) from public.vehicles where id = any(p_vehicle_ids)) <> (select count(distinct x) from unnest(p_vehicle_ids) x) then
    raise exception 'one or more vehicles were not found' using errcode = '22023';
  end if;

  for v_row in select * from public.vehicles where id = any(p_vehicle_ids) order by id loop
    if v_row.closed_reason is not null then
      raise exception 'vehicle % is closed and cannot be dispatched', v_row.id using errcode = 'P0001';
    end if;
    if v_row.transport_status not in ('NEED_TRANSPORT', 'READY_TO_POST', 'POSTED_TO_CD', 'ASSIGNED') then
      raise exception 'vehicle % is already in transit or arrived (%)', v_row.id, v_row.transport_status using errcode = 'P0001';
    end if;
    if v_row.carrier_id = p_carrier_id and v_row.transport_price = p_transport_price and v_row.transport_status = 'ASSIGNED' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.vehicles
       set carrier_id = p_carrier_id, transport_price = p_transport_price,
           transport_status = 'ASSIGNED', transport_problem = null, updated_by = auth.uid()
     where id = v_row.id;
    perform public._vehicle_event(v_row.id, 'CARRIER_ASSIGNED', 'Carrier ' || v_carrier.company, 'ASSIGNED');
    v_assigned := v_assigned + 1;
  end loop;

  perform public.write_audit_log('vehicle.assign_carrier', 'carrier', p_carrier_id,
    'Carrier assigned to ' || v_assigned || ' vehicle(s)',
    jsonb_build_object('vehicle_ids', p_vehicle_ids, 'transport_price', p_transport_price, 'assigned', v_assigned, 'unchanged', v_skipped),
    null, null);

  return jsonb_build_object('assigned', v_assigned, 'unchanged', v_skipped, 'carrier_id', p_carrier_id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. update_transport_status — one allowed transition table. Central Dispatch's external API is
--    NOT called here. READY_TO_POST -> POSTED_TO_CD records local intent only.
-- ---------------------------------------------------------------------------------------
create or replace function public.update_transport_status(p_vehicle_id uuid, p_to_status text, p_problem_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.vehicles%rowtype;
  v_from text;
  v_ok boolean := false;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'auction');

  if p_to_status not in ('NEED_TRANSPORT','READY_TO_POST','POSTED_TO_CD','ASSIGNED','IN_TRANSIT','ARRIVED','PROBLEM') then
    raise exception 'unknown transport status' using errcode = '22023';
  end if;

  select * into v_row from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;
  if v_row.closed_reason is not null then
    raise exception 'vehicle is closed' using errcode = 'P0001';
  end if;

  v_from := v_row.transport_status;
  if v_from = p_to_status then
    return jsonb_build_object('vehicle_id', v_row.id, 'transport_status', v_from, 'idempotent_replay', true);
  end if;

  -- Allowed transitions. PROBLEM may be raised from any active state and resolved to the
  -- states it can return to.
  v_ok := case
    when p_to_status = 'PROBLEM' then v_from <> 'ARRIVED'
    when v_from = 'NEED_TRANSPORT' and p_to_status = 'READY_TO_POST' then v_row.transport_price is not null
    when v_from = 'READY_TO_POST' and p_to_status = 'POSTED_TO_CD' then true
    when v_from = 'POSTED_TO_CD' and p_to_status = 'ASSIGNED' then v_row.carrier_id is not null
    when v_from = 'ASSIGNED' and p_to_status = 'IN_TRANSIT' then true
    when v_from = 'IN_TRANSIT' and p_to_status = 'ARRIVED' then true
    when v_from = 'PROBLEM' and p_to_status in ('ASSIGNED', 'IN_TRANSIT', 'POSTED_TO_CD') then true
    else false
  end;
  if not v_ok then
    raise exception 'cannot move transport status from % to %', v_from, p_to_status using errcode = 'P0001';
  end if;
  if p_to_status = 'PROBLEM' and char_length(btrim(coalesce(p_problem_note, ''))) < 5 then
    raise exception 'describe the problem (at least 5 characters)' using errcode = '22023';
  end if;

  update public.vehicles
     set transport_status = p_to_status,
         transport_problem = case when p_to_status = 'PROBLEM' then btrim(p_problem_note)
                                  when v_from = 'PROBLEM' then null else transport_problem end,
         arrival_date = case when p_to_status = 'ARRIVED' and arrival_date is null then now() else arrival_date end,
         updated_by = auth.uid()
   where id = p_vehicle_id
   returning * into v_row;

  perform public._vehicle_event(v_row.id, 'TRANSPORT_STATUS', coalesce(btrim(p_problem_note), v_from || ' -> ' || p_to_status), p_to_status);
  perform public.write_audit_log('vehicle.transport_status', 'vehicle', v_row.id,
    'Transport ' || v_from || ' -> ' || p_to_status, jsonb_build_object('from', v_from, 'to', p_to_status), null, null);

  return jsonb_build_object('vehicle_id', v_row.id, 'transport_status', v_row.transport_status, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. receive_vehicle — atomic. Requires the four arrival photos to exist server-side.
--    No AI, no OCR, no image analysis: the photos are evidence rows only.
-- ---------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.match_or_create_vehicle(text, text, text, text, jsonb)',
    'public.close_vehicle(uuid, text, text)',
    'public.assign_carrier(uuid[], uuid, numeric)',
    'public.update_transport_status(uuid, text, text)',
    'public.receive_vehicle(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
