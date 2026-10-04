-- =====================================================================================
-- 0016 — Dismantling RPCs: start / finish a vehicle session, begin / abandon a part capture,
--        flag an issue. Plus the request-id columns that make retries safe.
--
-- ADDITIVE. 0001–0015 are not edited.
--
-- Invariants (enforced here and by the unique index dismantling_sessions_one_active_per_vehicle):
--   * one ACTIVE session per vehicle; a second employee's start is refused as "in process".
--   * a session is finished only by the employee who started it (actor = session owner).
--   * a closed or already dismantled vehicle cannot be started.
--   * a session cannot finish without at least one ready evidence photo, nor while any captured
--     part still lacks a ready photo (the employee must retry the upload or abandon that capture).
--   * a part capture is created BEFORE its photo is uploaded, because the media gate requires the
--     owner row to exist. Retrying begin_dismantled_part with the same request id returns the same row.
--
-- Errors: 42501 forbidden. 22023 invalid input. P0001 business rule, with a stable code in
-- error.hint (ALREADY_DISMANTLED, ALREADY_IN_PROCESS, CLOSED_VEHICLE, SESSION_NOT_ACTIVE,
-- NO_EVIDENCE, PART_WITHOUT_PHOTO, NOT_SESSION_OWNER, ...). The UI maps hints to guard states.
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- 1. Retry keys
-- ---------------------------------------------------------------------------------------
alter table public.vehicle_events add column if not exists client_request_id uuid;
create unique index if not exists vehicle_events_client_request_key
  on public.vehicle_events (client_request_id) where client_request_id is not null;

alter table public.parts add column if not exists client_request_id uuid;
create unique index if not exists parts_client_request_key
  on public.parts (client_request_id) where client_request_id is not null;

-- ---------------------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------------------

-- Loads a session the caller owns. Raises when it does not exist or belongs to someone else.
create or replace function public._dismantling_owned_session(p_session_id uuid)
returns public.dismantling_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.dismantling_sessions%rowtype;
begin
  select * into v_s from public.dismantling_sessions where id = p_session_id for update;
  if not found then
    raise exception 'dismantling session not found' using errcode = '22023';
  end if;
  if v_s.employee_id <> auth.uid() then
    raise exception 'only the employee who started this session can change it' using errcode = '42501', hint = 'NOT_SESSION_OWNER';
  end if;
  return v_s;
end;
$$;

create or replace function public._dismantling_actor_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select name from public.profiles where id = auth.uid()), 'unknown');
$$;

-- ---------------------------------------------------------------------------------------
-- 3. start_dismantling_session
-- ---------------------------------------------------------------------------------------
create or replace function public.start_dismantling_session(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_v public.vehicles%rowtype;
  v_active public.dismantling_sessions%rowtype;
  v_new public.dismantling_sessions%rowtype;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'dismantling');

  select * into v_v from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;
  if v_v.closed_reason is not null then
    raise exception 'this vehicle is closed' using errcode = 'P0001', hint = 'CLOSED_VEHICLE';
  end if;
  if v_v.status in ('Dismantled', 'Completed', 'Scrapped / Closed')
     or exists (select 1 from public.dismantling_sessions where vehicle_id = p_vehicle_id and status = 'completed') then
    raise exception 'this vehicle has already been dismantled' using errcode = 'P0001', hint = 'ALREADY_DISMANTLED';
  end if;

  select * into v_active from public.dismantling_sessions
   where vehicle_id = p_vehicle_id and ended_at is null;
  if found then
    if v_active.employee_id = auth.uid() then
      -- Same employee retrying the start: return the session they already have.
      return jsonb_build_object('session_id', v_active.id, 'vehicle_id', p_vehicle_id, 'status', 'active', 'idempotent_replay', true);
    end if;
    raise exception 'this vehicle is already being dismantled by another employee' using errcode = 'P0001', hint = 'ALREADY_IN_PROCESS';
  end if;

  insert into public.dismantling_sessions (vehicle_id, employee_id, status)
  values (p_vehicle_id, auth.uid(), 'active')
  returning * into v_new;

  update public.vehicles set status = 'Processing', updated_by = auth.uid() where id = p_vehicle_id;

  insert into public.vehicle_events (vehicle_id, action, status, actor_id, actor_name, dismantling_session_id, note)
  values (p_vehicle_id, 'DISMANTLING_STARTED', 'Processing', auth.uid(), public._dismantling_actor_name(), v_new.id, 'Dismantling session started');

  perform public.write_audit_log('dismantling.start', 'dismantling_session', v_new.id,
    'Dismantling session started', jsonb_build_object('vehicle_id', p_vehicle_id), null, null);

  return jsonb_build_object('session_id', v_new.id, 'vehicle_id', p_vehicle_id, 'status', 'active', 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. begin_dismantled_part — creates the part row before its photo is uploaded
-- ---------------------------------------------------------------------------------------
create or replace function public.begin_dismantled_part(p_session_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.dismantling_sessions%rowtype;
  v_v public.vehicles%rowtype;
  v_part public.parts%rowtype;
  v_event_id uuid;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'dismantling');
  if p_client_request_id is null then
    raise exception 'a capture request id is required' using errcode = '22023';
  end if;

  -- Retry: the same request id returns the same part, even if the session has since ended.
  select * into v_part from public.parts where client_request_id = p_client_request_id;
  if found then
    if v_part.dismantling_session_id is distinct from p_session_id then
      raise exception 'this capture request belongs to another session' using errcode = '22023';
    end if;
    return jsonb_build_object('part_id', v_part.id, 'session_id', p_session_id, 'idempotent_replay', true);
  end if;

  v_s := public._dismantling_owned_session(p_session_id);
  if v_s.status <> 'active' or v_s.ended_at is not null then
    raise exception 'this session is no longer active' using errcode = 'P0001', hint = 'SESSION_NOT_ACTIVE';
  end if;

  select * into v_v from public.vehicles where id = v_s.vehicle_id;

  insert into public.vehicle_events (vehicle_id, action, part_type, high_value, status, actor_id, actor_name, dismantling_session_id, note)
  values (v_s.vehicle_id, 'PART_REMOVED', '', false, 'captured', auth.uid(), public._dismantling_actor_name(), p_session_id, 'Part capture started')
  returning id into v_event_id;

  insert into public.parts (vehicle_id, source_vehicle_event_id, dismantling_session_id, source_vin, source_lot,
                            status, quantity, captured_by, client_request_id)
  values (v_s.vehicle_id, v_event_id, p_session_id, v_v.vin, coalesce(v_v.lot_number, v_v.stock_number),
          'captured', 1, auth.uid(), p_client_request_id)
  returning * into v_part;

  perform public.write_audit_log('dismantling.part_begin', 'part', v_part.id,
    'Part capture started', jsonb_build_object('session_id', p_session_id), null, p_client_request_id);

  return jsonb_build_object('part_id', v_part.id, 'session_id', p_session_id, 'idempotent_replay', false);
end;
$$;

-- abandon_dismantled_part — a capture whose photo never uploaded. Kept as history, never sellable.
create or replace function public.abandon_dismantled_part(p_part_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
  v_s public.dismantling_sessions%rowtype;
  v_ready int;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'dismantling');

  select * into v_part from public.parts where id = p_part_id for update;
  if not found then
    raise exception 'part not found' using errcode = '22023';
  end if;
  if v_part.dismantling_session_id is null then
    raise exception 'this part was not captured in a dismantling session' using errcode = 'P0001';
  end if;
  v_s := public._dismantling_owned_session(v_part.dismantling_session_id);

  if v_part.status = 'rejected' then
    return jsonb_build_object('part_id', v_part.id, 'status', v_part.status, 'idempotent_replay', true);
  end if;
  if v_part.status <> 'captured' then
    raise exception 'only an unreviewed capture can be abandoned' using errcode = 'P0001';
  end if;
  select count(*) into v_ready from public.media_assets
   where owner_type = 'part' and owner_id = p_part_id and variant = 'original' and status = 'ready';
  if v_ready > 0 then
    raise exception 'this capture already has a photo and cannot be abandoned' using errcode = 'P0001';
  end if;

  update public.parts set status = 'rejected' where id = p_part_id;
  update public.vehicle_events set status = 'abandoned', note = 'Capture abandoned before photo upload'
   where id = v_part.source_vehicle_event_id;
  perform public.write_audit_log('dismantling.part_abandon', 'part', p_part_id,
    'Part capture abandoned before photo upload', '{}'::jsonb, null, null);

  return jsonb_build_object('part_id', p_part_id, 'status', 'rejected', 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. finish_dismantling_session
-- ---------------------------------------------------------------------------------------
create or replace function public.finish_dismantling_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.dismantling_sessions%rowtype;
  v_evidence int;
  v_parts int;
  v_missing int;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'dismantling');

  select * into v_s from public.dismantling_sessions where id = p_session_id for update;
  if not found then
    raise exception 'dismantling session not found' using errcode = '22023';
  end if;
  if v_s.employee_id <> auth.uid() then
    raise exception 'only the employee who started this session can finish it' using errcode = '42501', hint = 'NOT_SESSION_OWNER';
  end if;

  -- Retry: an already completed session returns its result.
  if v_s.status = 'completed' then
    return jsonb_build_object('session_id', v_s.id, 'status', 'completed', 'part_photos_captured', v_s.part_photos_captured, 'idempotent_replay', true);
  end if;
  if v_s.status <> 'active' or v_s.ended_at is not null then
    raise exception 'this session is not active' using errcode = 'P0001', hint = 'SESSION_NOT_ACTIVE';
  end if;

  select count(*) into v_evidence from public.media_assets
   where owner_type = 'dismantling_session' and owner_id = p_session_id and variant = 'original' and status = 'ready';
  if v_evidence < 1 then
    raise exception 'add at least one vehicle evidence photo before finishing' using errcode = 'P0001', hint = 'NO_EVIDENCE';
  end if;

  select count(*) into v_parts from public.parts where dismantling_session_id = p_session_id;
  select count(*) into v_missing from public.parts p
   where p.dismantling_session_id = p_session_id
     and p.status = 'captured'
     and not exists (select 1 from public.media_assets m
                      where m.owner_type = 'part' and m.owner_id = p.id and m.variant = 'original' and m.status = 'ready');
  if v_missing > 0 then
    raise exception '% captured part(s) still need a photo: retry the upload or abandon the capture', v_missing
      using errcode = 'P0001', hint = 'PART_WITHOUT_PHOTO';
  end if;

  update public.dismantling_sessions
     set status = 'completed', ended_at = now(), part_photos_captured = v_parts
   where id = p_session_id;

  update public.vehicles set status = 'Dismantled', updated_by = auth.uid() where id = v_s.vehicle_id;

  insert into public.vehicle_events (vehicle_id, action, status, actor_id, actor_name, dismantling_session_id, note)
  values (v_s.vehicle_id, 'DISMANTLING_COMPLETED', 'Dismantled', auth.uid(), public._dismantling_actor_name(), p_session_id,
          v_parts || ' part(s) captured');

  perform public.write_audit_log('dismantling.finish', 'dismantling_session', p_session_id,
    'Dismantling session completed', jsonb_build_object('parts', v_parts, 'vehicle_id', v_s.vehicle_id), null, null);

  return jsonb_build_object('session_id', p_session_id, 'status', 'completed', 'part_photos_captured', v_parts, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. flag_dismantling_issue
-- ---------------------------------------------------------------------------------------
create or replace function public.flag_dismantling_issue(p_session_id uuid, p_issue text, p_note text, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.dismantling_sessions%rowtype;
  v_existing public.vehicle_events%rowtype;
  v_row public.vehicle_events%rowtype;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'dismantling');
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  if p_issue not in ('Missing Parts', 'Visible Damage', 'Wrong Vehicle', 'Safety Concern', 'Other') then
    raise exception 'choose a listed issue type' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'describe the issue (at least 5 characters)' using errcode = '22023';
  end if;

  select * into v_existing from public.vehicle_events where client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object('event_id', v_existing.id, 'idempotent_replay', true);
  end if;

  v_s := public._dismantling_owned_session(p_session_id);
  if v_s.status <> 'active' or v_s.ended_at is not null then
    raise exception 'this session is not active' using errcode = 'P0001', hint = 'SESSION_NOT_ACTIVE';
  end if;

  insert into public.vehicle_events (vehicle_id, action, status, note, actor_id, actor_name, dismantling_session_id, client_request_id)
  values (v_s.vehicle_id, 'ISSUE_FLAGGED', p_issue, btrim(p_note), auth.uid(), public._dismantling_actor_name(), p_session_id, p_client_request_id)
  returning * into v_row;

  perform public.write_audit_log('dismantling.issue', 'vehicle', v_s.vehicle_id,
    'Dismantling issue flagged: ' || p_issue, jsonb_build_object('session_id', p_session_id, 'issue', p_issue), btrim(p_note), p_client_request_id);

  return jsonb_build_object('event_id', v_row.id, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------------------
revoke execute on function public._dismantling_owned_session(uuid) from public, anon, authenticated;
revoke execute on function public._dismantling_actor_name() from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.start_dismantling_session(uuid)',
    'public.begin_dismantled_part(uuid, uuid)',
    'public.abandon_dismantled_part(uuid)',
    'public.finish_dismantling_session(uuid)',
    'public.flag_dismantling_issue(uuid, text, text, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
