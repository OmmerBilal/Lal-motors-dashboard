-- =====================================================================================
-- 0064 — Dismantling v2 corrections. ADDITIVE: replaces three function bodies. 0001–0063 are not edited.
--
-- Found by the existing dismantling baselines after 0061 was applied:
-- 1. abandon_dismantled_part (0061) had lost the 0017 fix. It set status 'rejected' without the not-sellable
--    stage and reason, so the parts check constraint refused every abandon. This restores the 0017 behaviour and keeps
--    the v2 rule: only the dismantling role, and only the session's own employee.
-- 2. start_dismantling_assignment (0061) had lost the 0016 vehicle checks: a Completed or Scrapped vehicle, or one with
--    a completed dismantling session, must not start. Restored.
-- 3. flag_dismantling_issue (0061) accepted only the v2 issue list. Issue types already stored in history (0016) stay
--    valid, so the union is accepted. The employee screen offers the v2 list.
-- =====================================================================================

create or replace function public.abandon_dismantled_part(p_part_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
  v_ready int;
begin
  perform public._rpc_require_roles('dismantling');

  select * into v_part from public.parts where id = p_part_id for update;
  if not found then
    raise exception 'part not found' using errcode = '22023';
  end if;
  if v_part.dismantling_session_id is null then
    raise exception 'this part was not captured in a dismantling session' using errcode = 'P0001';
  end if;
  perform public._dismantling_owned_session(v_part.dismantling_session_id);

  if v_part.status = 'rejected' then
    return jsonb_build_object('part_id', v_part.id, 'status', v_part.status, 'idempotent_replay', true);
  end if;
  if v_part.status <> 'captured' then
    raise exception 'only an unreviewed capture can be abandoned' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.media_assets m
              where m.owner_type = 'part' and m.owner_id = p_part_id and m.variant = 'original' and m.status = 'ready') then
    raise exception 'this capture already has a photo and cannot be abandoned' using errcode = 'P0001';
  end if;

  update public.parts
     set status = 'rejected',
         stage = 'not_sellable',
         not_sellable_reason = 'Capture abandoned before photo upload',
         not_sellable_by = auth.uid(),
         operational_status = 'MISSING'
   where id = p_part_id;

  update public.vehicle_events set status = 'abandoned', note = 'Capture abandoned before photo upload'
   where id = v_part.source_vehicle_event_id;

  perform public.write_audit_log('dismantling.part_abandon', 'part', p_part_id,
    'Part capture abandoned before photo upload', '{}'::jsonb, null, null);

  return jsonb_build_object('part_id', p_part_id, 'status', 'rejected', 'idempotent_replay', false);
end;
$$;

create or replace function public.start_dismantling_assignment(p_assignment_id uuid, p_client_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.dismantling_assignments%rowtype;
  v public.vehicles%rowtype;
  s public.dismantling_sessions%rowtype;
begin
  perform public._rpc_require_roles('dismantling');

  select * into a from public.dismantling_assignments where id = p_assignment_id for update;
  if not found or a.employee_id <> auth.uid() then
    raise exception 'This vehicle is not assigned to you.' using errcode = '42501', hint = 'NOT_ASSIGNED';
  end if;

  if a.status = 'IN_PROGRESS' then
    select * into s from public.dismantling_sessions where assignment_id = a.id and ended_at is null;
    if found then
      return jsonb_build_object('session_id', s.id, 'assignment_id', a.id, 'vehicle_id', a.vehicle_id, 'status', 'IN_PROGRESS', 'idempotent_replay', true);
    end if;
    raise exception 'this assignment is no longer active' using errcode = 'P0001', hint = 'ALREADY_STARTED';
  end if;
  if a.status <> 'ASSIGNED' then
    raise exception 'this assignment cannot be started' using errcode = 'P0001', hint = 'NOT_STARTABLE';
  end if;

  select * into v from public.vehicles where id = a.vehicle_id for update;
  if v.closed_reason is not null then
    raise exception 'this vehicle is closed' using errcode = 'P0001', hint = 'CLOSED_VEHICLE';
  end if;
  if v.status in ('Dismantled', 'Completed', 'Scrapped / Closed')
     or exists (select 1 from public.dismantling_sessions x where x.vehicle_id = a.vehicle_id and x.status = 'completed')
     or exists (select 1 from public.dismantling_assignments x where x.vehicle_id = a.vehicle_id and x.status = 'COMPLETED') then
    raise exception 'this vehicle has already been dismantled' using errcode = 'P0001', hint = 'ALREADY_DISMANTLED';
  end if;
  if exists (select 1 from public.dismantling_sessions x where x.vehicle_id = a.vehicle_id and x.ended_at is null) then
    raise exception 'this vehicle is already being dismantled' using errcode = 'P0001', hint = 'ALREADY_IN_PROCESS';
  end if;

  insert into public.dismantling_sessions (vehicle_id, employee_id, status, assignment_id)
  values (a.vehicle_id, auth.uid(), 'active', a.id)
  returning * into s;

  update public.dismantling_assignments set status = 'IN_PROGRESS', started_at = now(), updated_at = now() where id = a.id;
  update public.vehicles set status = 'Processing', updated_by = auth.uid() where id = a.vehicle_id;

  insert into public.dismantling_assignment_history (vehicle_id, assignment_id, action, to_employee_id, actor_id, reason)
  values (a.vehicle_id, a.id, 'STARTED', auth.uid(), auth.uid(), '');

  insert into public.vehicle_events (vehicle_id, action, status, actor_id, actor_name, dismantling_session_id, note)
  values (a.vehicle_id, 'DISMANTLING_STARTED', 'Processing', auth.uid(), public._dismantling_actor_label(), s.id, 'Dismantling session started');

  perform public.write_audit_log('dismantling.start', 'dismantling_session', s.id, 'Dismantling session started',
    jsonb_build_object('vehicle_id', a.vehicle_id, 'assignment_id', a.id), null, p_client_request_id);

  return jsonb_build_object('session_id', s.id, 'assignment_id', a.id, 'vehicle_id', a.vehicle_id, 'status', 'IN_PROGRESS', 'idempotent_replay', false);
end;
$$;

create or replace function public.flag_dismantling_issue(p_session_id uuid, p_issue text, p_note text, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.dismantling_sessions%rowtype;
  v_existing public.vehicle_events%rowtype;
  v_row public.vehicle_events%rowtype;
begin
  perform public._rpc_require_roles('dismantling');
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  if p_issue not in ('Vehicle Mismatch', 'Unexpected Major Damage', 'Missing Expected Component', 'Unsafe Condition',
                     'Already Partially Dismantled', 'Record Discrepancy', 'Other',
                     'Missing Parts', 'Visible Damage', 'Wrong Vehicle', 'Safety Concern') then
    raise exception 'choose a listed issue type' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'describe the issue (at least 5 characters)' using errcode = '22023';
  end if;

  select * into v_existing from public.vehicle_events where client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object('event_id', v_existing.id, 'idempotent_replay', true);
  end if;

  s := public._dismantling_owned_session(p_session_id);
  if s.status <> 'active' or s.ended_at is not null then
    raise exception 'this session is not active' using errcode = 'P0001', hint = 'SESSION_NOT_ACTIVE';
  end if;

  insert into public.vehicle_events (vehicle_id, action, status, note, actor_id, actor_name, dismantling_session_id, client_request_id)
  values (s.vehicle_id, 'ISSUE_FLAGGED', p_issue, btrim(p_note), auth.uid(), public._dismantling_actor_label(), p_session_id, p_client_request_id)
  returning * into v_row;

  perform public.write_audit_log('dismantling.issue', 'vehicle', s.vehicle_id,
    'Dismantling issue flagged: ' || p_issue, jsonb_build_object('session_id', p_session_id, 'issue', p_issue), btrim(p_note), p_client_request_id);

  return jsonb_build_object('event_id', v_row.id, 'idempotent_replay', false);
end;
$$;
