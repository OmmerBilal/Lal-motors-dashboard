-- =====================================================================================
-- 0049 — Vehicles workspace authority (Module 01 and the shared vehicle write paths).
-- ADDITIVE: new functions only. Earlier migrations are not edited.
--
-- Replaces the client-side vehicle store (mock seed data) with server reads and checked writes:
--   vehicle_get              one vehicle record for the detail screen (RLS applies: caller's own view)
--   vehicle_edit_fields      whitelisted detail edits to an open vehicle, audited, one event per edit
--   vehicle_add_note         a note or an issue flag on an open vehicle, audited
--   intake_create_batch      one intake review batch (bulk / single / scan / manual), audited
--   vehicle_decide_completion  reviewer decision on a dismantling completion submission, audited
--
-- Every function checks the caller's role itself. Nothing here trusts the browser.
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- vehicle_get — one vehicle, with its computed stage. Security INVOKER so the vehicles RLS applies.
-- ---------------------------------------------------------------------------------------
create or replace function public.vehicle_get(p_vehicle_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
begin
  if not public.is_vehicle_domain_staff() then
    raise exception 'your role cannot open vehicles' using errcode = '42501';
  end if;
  select to_jsonb(v) || jsonb_build_object('stage', public.vehicle_stage(v))
    into v_row
    from public.vehicles v
   where v.id = p_vehicle_id;
  if v_row is null then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- vehicle_edit_fields — whitelisted descriptive edits to an OPEN vehicle.
-- Identity (VIN, lot, stock) is not editable here: identity changes go through the match rules.
-- Status, assignment, carrier and closure have their own RPCs and are refused here.
-- ---------------------------------------------------------------------------------------
create or replace function public.vehicle_edit_fields(p_vehicle_id uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.vehicles%rowtype;
  v_key text;
  v_changed text[] := '{}';
  v_allowed constant text[] := array[
    'year','make','model','trim','engine','mileage','mileage_status','title_status','location',
    'auction_item_number','purchase_price','invoice_amount','balance_due','auction_fees',
    'transportation_cost','pickup_status','pickup_pin','pickup_deadline','pickup_address',
    'pickup_location_name','damage_info','transport_info','notes'
  ];
begin
  if not public.has_any_role('owner', 'engineer_admin', 'manager', 'auction') then
    raise exception 'your role cannot edit vehicle details' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb then
    raise exception 'nothing to save' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'the field % cannot be edited here', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_row from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;
  if v_row.closed_reason is not null then
    raise exception 'this vehicle is closed. Reopen it before editing.' using errcode = '22023';
  end if;

  if p_fields ? 'year' and nullif(btrim(p_fields->>'year'), '') is not null
     and (p_fields->>'year') !~ '^[0-9]{4}$' then
    raise exception 'enter the year as four digits' using errcode = '22023';
  end if;
  if p_fields ? 'mileage' and nullif(btrim(p_fields->>'mileage'), '') is not null
     and (p_fields->>'mileage') !~ '^[0-9]{1,9}$' then
    raise exception 'enter the mileage as whole miles' using errcode = '22023';
  end if;
  if p_fields ? 'notes' and length(coalesce(p_fields->>'notes', '')) > 2000 then
    raise exception 'notes are limited to 2000 characters' using errcode = '22023';
  end if;

  update public.vehicles set
    year                 = case when p_fields ? 'year' then nullif(btrim(p_fields->>'year'), '')::int else year end,
    make                 = case when p_fields ? 'make' then btrim(coalesce(p_fields->>'make', '')) else make end,
    model                = case when p_fields ? 'model' then btrim(coalesce(p_fields->>'model', '')) else model end,
    trim                 = case when p_fields ? 'trim' then btrim(coalesce(p_fields->>'trim', '')) else trim end,
    engine               = case when p_fields ? 'engine' then btrim(coalesce(p_fields->>'engine', '')) else engine end,
    mileage              = case when p_fields ? 'mileage' then nullif(btrim(p_fields->>'mileage'), '')::int else mileage end,
    mileage_status       = case when p_fields ? 'mileage_status' then btrim(coalesce(p_fields->>'mileage_status', '')) else mileage_status end,
    title_status         = case when p_fields ? 'title_status' then btrim(coalesce(p_fields->>'title_status', '')) else title_status end,
    location             = case when p_fields ? 'location' then btrim(coalesce(p_fields->>'location', '')) else location end,
    auction_item_number  = case when p_fields ? 'auction_item_number' then btrim(coalesce(p_fields->>'auction_item_number', '')) else auction_item_number end,
    purchase_price       = case when p_fields ? 'purchase_price' then coalesce(nullif(btrim(p_fields->>'purchase_price'), '')::numeric, 0) else purchase_price end,
    invoice_amount       = case when p_fields ? 'invoice_amount' then coalesce(nullif(btrim(p_fields->>'invoice_amount'), '')::numeric, 0) else invoice_amount end,
    balance_due          = case when p_fields ? 'balance_due' then coalesce(nullif(btrim(p_fields->>'balance_due'), '')::numeric, 0) else balance_due end,
    auction_fees         = case when p_fields ? 'auction_fees' then coalesce(nullif(btrim(p_fields->>'auction_fees'), '')::numeric, 0) else auction_fees end,
    transportation_cost  = case when p_fields ? 'transportation_cost' then coalesce(nullif(btrim(p_fields->>'transportation_cost'), '')::numeric, 0) else transportation_cost end,
    pickup_status        = case when p_fields ? 'pickup_status' then btrim(coalesce(p_fields->>'pickup_status', '')) else pickup_status end,
    pickup_pin           = case when p_fields ? 'pickup_pin' then btrim(coalesce(p_fields->>'pickup_pin', '')) else pickup_pin end,
    pickup_deadline      = case when p_fields ? 'pickup_deadline' then nullif(btrim(p_fields->>'pickup_deadline'), '')::timestamptz else pickup_deadline end,
    pickup_address       = case when p_fields ? 'pickup_address' then btrim(coalesce(p_fields->>'pickup_address', '')) else pickup_address end,
    pickup_location_name = case when p_fields ? 'pickup_location_name' then btrim(coalesce(p_fields->>'pickup_location_name', '')) else pickup_location_name end,
    damage_info          = case when p_fields ? 'damage_info' then btrim(coalesce(p_fields->>'damage_info', '')) else damage_info end,
    transport_info       = case when p_fields ? 'transport_info' then btrim(coalesce(p_fields->>'transport_info', '')) else transport_info end,
    notes                = case when p_fields ? 'notes' then btrim(coalesce(p_fields->>'notes', '')) else notes end
   where id = p_vehicle_id;

  for v_key in select jsonb_object_keys(p_fields) loop
    v_changed := array_append(v_changed, v_key);
  end loop;

  perform public._vehicle_event(p_vehicle_id, 'DETAILS_EDITED', 'Edited: ' || array_to_string(v_changed, ', '), null);
  perform public.write_audit_log('vehicle.details_edited', 'vehicle', p_vehicle_id, 'Vehicle details edited', jsonb_build_object('fields', v_changed), null, null);
  return public.vehicle_get(p_vehicle_id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- vehicle_add_note — a note or an issue flag on an open vehicle. Nothing else is recorded from here.
-- ---------------------------------------------------------------------------------------
create or replace function public.vehicle_add_note(p_vehicle_id uuid, p_action text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed text;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.has_any_role('owner', 'engineer_admin', 'manager', 'auction', 'receiving', 'dismantling') then
    raise exception 'your role cannot add vehicle notes' using errcode = '42501';
  end if;
  if p_action not in ('NOTE', 'ISSUE_FLAGGED') then
    raise exception 'that action cannot be recorded here' using errcode = '22023';
  end if;
  if length(v_note) < 1 or length(v_note) > 500 then
    raise exception 'write a note of 1 to 500 characters' using errcode = '22023';
  end if;
  select closed_reason into v_closed from public.vehicles where id = p_vehicle_id for share;
  if not found then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;
  if v_closed is not null then
    raise exception 'this vehicle is closed. Reopen it before adding notes.' using errcode = '22023';
  end if;

  perform public._vehicle_event(p_vehicle_id, p_action, v_note, null);
  perform public.write_audit_log('vehicle.' || lower(p_action), 'vehicle', p_vehicle_id, left(v_note, 200), '{}'::jsonb, null, null);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- intake_create_batch — one review batch for an intake method. The vehicles themselves are matched and
-- created by match_or_create_vehicle when the person confirms; this row only records the batch.
-- ---------------------------------------------------------------------------------------
create or replace function public.intake_create_batch(p_method text, p_source_text text, p_count int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.has_any_role('owner', 'engineer_admin', 'manager', 'auction') then
    raise exception 'your role cannot start a vehicle intake' using errcode = '42501';
  end if;
  if p_method not in ('bulk', 'single', 'scan', 'manual') then
    raise exception 'unknown intake method' using errcode = '22023';
  end if;
  if p_source_text is not null and length(p_source_text) > 20000 then
    raise exception 'the pasted text is larger than 20000 characters. Split it into smaller pastes.' using errcode = '22023';
  end if;
  if p_count is null or p_count < 0 or p_count > 200 then
    raise exception 'a batch holds 0 to 200 vehicles' using errcode = '22023';
  end if;

  insert into public.vehicle_intake_batches (method, source_text, status, created_by)
  values (p_method, coalesce(p_source_text, ''), 'review', auth.uid())
  returning id into v_id;

  perform public.write_audit_log('vehicle.intake_batch_created', 'vehicle_intake_batch', v_id, p_method || ' intake, ' || p_count || ' vehicles', jsonb_build_object('count', p_count), null, null);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- vehicle_decide_completion — a reviewer's decision on a dismantling completion submission.
-- Approve or send back for correction (a reason is required). A decision is final: it can be made once.
-- ---------------------------------------------------------------------------------------
create or replace function public.vehicle_decide_completion(p_completion_id uuid, p_decision text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.vehicle_completions%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.has_any_role('owner', 'engineer_admin', 'manager') then
    raise exception 'only a reviewer can decide a completion' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'needs_correction') then
    raise exception 'choose approve or needs correction' using errcode = '22023';
  end if;
  if p_decision = 'needs_correction' and (length(v_reason) < 3 or length(v_reason) > 500) then
    raise exception 'write the correction needed (3 to 500 characters)' using errcode = '22023';
  end if;

  select * into v_row from public.vehicle_completions where id = p_completion_id for update;
  if not found then
    raise exception 'completion not found' using errcode = '22023';
  end if;
  if v_row.decision <> 'pending' then
    raise exception 'this completion was already decided' using errcode = '22023';
  end if;

  update public.vehicle_completions set
    decision = p_decision,
    decision_reason = case when p_decision = 'needs_correction' then v_reason else null end,
    decided_by = auth.uid(),
    decided_at = now()
   where id = p_completion_id;

  perform public._vehicle_event(
    v_row.vehicle_id,
    case when p_decision = 'approved' then 'COMPLETION_APPROVED' else 'COMPLETION_NEEDS_CORRECTION' end,
    case when p_decision = 'needs_correction' then v_reason else 'Completion approved' end,
    null
  );
  perform public.write_audit_log('vehicle.completion_' || p_decision, 'vehicle_completion', p_completion_id, left(coalesce(nullif(v_reason, ''), 'approved'), 200), '{}'::jsonb, null, null);
  return jsonb_build_object('id', p_completion_id, 'decision', p_decision);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Grants: callers must be signed in. Each function refuses by role above.
-- ---------------------------------------------------------------------------------------
revoke execute on function public.vehicle_get(uuid) from public, anon;
revoke execute on function public.vehicle_edit_fields(uuid, jsonb) from public, anon;
revoke execute on function public.vehicle_add_note(uuid, text, text) from public, anon;
revoke execute on function public.intake_create_batch(text, text, int) from public, anon;
revoke execute on function public.vehicle_decide_completion(uuid, text, text) from public, anon;
grant execute on function public.vehicle_get(uuid) to authenticated;
grant execute on function public.vehicle_edit_fields(uuid, jsonb) to authenticated;
grant execute on function public.vehicle_add_note(uuid, text, text) to authenticated;
grant execute on function public.intake_create_batch(text, text, int) to authenticated;
grant execute on function public.vehicle_decide_completion(uuid, text, text) to authenticated;
