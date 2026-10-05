-- =====================================================================================
-- 0061 — Dismantling workflow v2: readiness, assignments, assignment-driven employee work.
--
-- ADDITIVE schema, plus replaced function bodies for the employee path. 0001–0060 are not edited.
--
-- Business model (final):
--   manager/admin  -> marks a received vehicle READY FOR DISMANTLING -> assigns it to ONE active
--                     dismantling employee (role key 'dismantling') -> may reassign before work starts.
--   employee       -> sees only ITS assignments -> Start -> evidence + manual part captures -> Finish.
--   owner/manager/engineer_admin never perform employee capture, start or finish.
--
-- Schema:
--   vehicles.dismantling_ready_at / dismantling_ready_by     (readiness, deliberate manager decision)
--   dismantling_assignments                                   (one OPEN assignment per vehicle, history kept)
--   dismantling_assignment_history                            (ready / assign / reassign / cancel / start / complete)
--   dismantling_sessions.assignment_id                        (every new session belongs to an assignment)
--   parts.capture_name / capture_details / capture_saved_at   (employee capture text, kept apart from the
--                                                              manager's final title/description fields)
--
-- Backfill: legacy dismantling_sessions get a historical assignment row (legacy_session_id) so history is
-- continuous. The session's own employee is recorded as the worker; assigned_by stays NULL because no
-- assignment existed before this migration. Historical actor identity is not rewritten.
--
-- Errors: 42501 forbidden/not assigned; 22023 invalid input; P0001 business rule with a stable code in
-- error.hint (NOT_RECEIVED, CLOSED_VEHICLE, ALREADY_DISMANTLED, ALREADY_ASSIGNED, SESSION_ACTIVE,
-- NOT_DISMANTLING_EMPLOYEE, NOT_ASSIGNED, ALREADY_STARTED, NOT_REASSIGNABLE, NOT_READY, ...).
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- 1. Readiness on the vehicle
-- ---------------------------------------------------------------------------------------
alter table public.vehicles
  add column if not exists dismantling_ready_at timestamptz,
  add column if not exists dismantling_ready_by uuid references public.profiles(id);

-- ---------------------------------------------------------------------------------------
-- 2. Assignments
-- ---------------------------------------------------------------------------------------
create table if not exists public.dismantling_assignments (
  id                uuid primary key default gen_random_uuid(),
  vehicle_id        uuid not null references public.vehicles(id),
  employee_id       uuid not null references public.profiles(id),
  assigned_by       uuid references public.profiles(id),
  assigned_at       timestamptz not null default now(),
  status            text not null check (status in ('ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  started_at        timestamptz,
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  client_request_id uuid,
  legacy_session_id uuid unique references public.dismantling_sessions(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.dismantling_assignments is
  'Who is dismantling which vehicle. At most one OPEN assignment (ASSIGNED or IN_PROGRESS) per vehicle; '
  'history lives in dismantling_assignment_history. Read and written only through security definer RPCs.';
create unique index if not exists dismantling_assignments_one_open_per_vehicle
  on public.dismantling_assignments (vehicle_id) where status in ('ASSIGNED','IN_PROGRESS');
create index if not exists dismantling_assignments_employee_idx on public.dismantling_assignments (employee_id, status);
create unique index if not exists dismantling_assignments_request_key
  on public.dismantling_assignments (client_request_id) where client_request_id is not null;
alter table public.dismantling_assignments enable row level security;
revoke all on public.dismantling_assignments from public, anon, authenticated;

create table if not exists public.dismantling_assignment_history (
  id               uuid primary key default gen_random_uuid(),
  vehicle_id       uuid not null references public.vehicles(id),
  assignment_id    uuid references public.dismantling_assignments(id),
  action           text not null check (action in ('READY','UNREADY','ASSIGNED','REASSIGNED','CANCELLED','STARTED','COMPLETED','LEGACY_BACKFILL')),
  from_employee_id uuid references public.profiles(id),
  to_employee_id   uuid references public.profiles(id),
  actor_id         uuid references public.profiles(id),
  reason           text not null default '',
  created_at       timestamptz not null default now()
);
create index if not exists dismantling_assignment_history_vehicle_idx on public.dismantling_assignment_history (vehicle_id, created_at);
alter table public.dismantling_assignment_history enable row level security;
revoke all on public.dismantling_assignment_history from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. Sessions and captured parts
-- ---------------------------------------------------------------------------------------
alter table public.dismantling_sessions add column if not exists assignment_id uuid references public.dismantling_assignments(id);
create index if not exists dismantling_sessions_assignment_idx on public.dismantling_sessions (assignment_id);

alter table public.parts
  add column if not exists capture_name     text not null default '',
  add column if not exists capture_details  text not null default '',
  add column if not exists capture_saved_at timestamptz;

-- ---------------------------------------------------------------------------------------
-- 4. Backfill historical sessions (one assignment row per legacy session, linked by legacy_session_id)
-- ---------------------------------------------------------------------------------------
insert into public.dismantling_assignments
       (vehicle_id, employee_id, assigned_by, assigned_at, status, started_at, completed_at, legacy_session_id, created_at, updated_at)
select s.vehicle_id, s.employee_id, null, s.started_at,
       case when s.status = 'completed' then 'COMPLETED'
            when s.ended_at is null then 'IN_PROGRESS'
            else 'CANCELLED' end,
       s.started_at,
       case when s.status = 'completed' then s.ended_at end,
       s.id, s.created_at, now()
  from public.dismantling_sessions s
 where s.assignment_id is null
   and not exists (select 1 from public.dismantling_assignments a where a.legacy_session_id = s.id)
order by s.started_at;

update public.dismantling_sessions s
   set assignment_id = a.id
  from public.dismantling_assignments a
 where a.legacy_session_id = s.id
   and s.assignment_id is null;

insert into public.dismantling_assignment_history (vehicle_id, assignment_id, action, to_employee_id, actor_id, reason, created_at)
select a.vehicle_id, a.id, 'LEGACY_BACKFILL', a.employee_id, null,
       'Historical dismantling session before assignments existed', a.created_at
  from public.dismantling_assignments a
 where a.legacy_session_id is not null
   and not exists (select 1 from public.dismantling_assignment_history h where h.assignment_id = a.id);

-- ---------------------------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------------------------
create or replace function public._dismantling_employee_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      join public.roles r on r.id = ur.role_id
     where p.id = p_user
       and p.account_status = 'active'
       and r.key = 'dismantling'
  );
$$;
revoke execute on function public._dismantling_employee_active(uuid) from public, anon, authenticated;

create or replace function public._dismantling_open_assignment(p_vehicle_id uuid)
returns public.dismantling_assignments
language sql
stable
security definer
set search_path = public
as $$
  select * from public.dismantling_assignments
   where vehicle_id = p_vehicle_id and status in ('ASSIGNED','IN_PROGRESS')
   limit 1;
$$;
revoke execute on function public._dismantling_open_assignment(uuid) from public, anon, authenticated;

create or replace function public._dismantling_actor_label()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select name from public.profiles where id = auth.uid()), 'unknown');
$$;
revoke execute on function public._dismantling_actor_label() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 6. Readiness (manager decision, never automatic after receiving)
-- ---------------------------------------------------------------------------------------
create or replace function public.mark_vehicle_ready(p_vehicle_id uuid, p_client_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vehicles%rowtype;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');

  select * into v from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;
  if v.dismantling_ready_at is not null then
    return jsonb_build_object('vehicle_id', v.id, 'dismantling_ready_at', v.dismantling_ready_at, 'idempotent_replay', true);
  end if;
  if v.closed_reason is not null then
    raise exception 'this vehicle is closed' using errcode = 'P0001', hint = 'CLOSED_VEHICLE';
  end if;
  if v.status = 'Dismantled' or exists (select 1 from public.dismantling_assignments a where a.vehicle_id = v.id and a.status = 'COMPLETED') then
    raise exception 'this vehicle has already been dismantled' using errcode = 'P0001', hint = 'ALREADY_DISMANTLED';
  end if;
  if v.receiving_status <> 'received' or v.received_at is null then
    raise exception 'receive the vehicle before marking it ready for dismantling' using errcode = 'P0001', hint = 'NOT_RECEIVED';
  end if;
  if exists (select 1 from public.dismantling_assignments a where a.vehicle_id = v.id and a.status in ('ASSIGNED','IN_PROGRESS')) then
    raise exception 'this vehicle is already assigned' using errcode = 'P0001', hint = 'ALREADY_ASSIGNED';
  end if;
  if exists (select 1 from public.dismantling_sessions s where s.vehicle_id = v.id and s.ended_at is null) then
    raise exception 'a dismantling session is active on this vehicle' using errcode = 'P0001', hint = 'SESSION_ACTIVE';
  end if;

  update public.vehicles set dismantling_ready_at = now(), dismantling_ready_by = auth.uid(), updated_by = auth.uid()
   where id = v.id
  returning * into v;

  insert into public.dismantling_assignment_history (vehicle_id, action, actor_id, reason)
  values (v.id, 'READY', auth.uid(), '');

  perform public.write_audit_log('dismantling.ready', 'vehicle', v.id, 'Marked ready for dismantling',
    jsonb_build_object('vehicle_id', v.id), null, p_client_request_id);

  return jsonb_build_object('vehicle_id', v.id, 'dismantling_ready_at', v.dismantling_ready_at, 'idempotent_replay', false);
end;
$$;

create or replace function public.undo_vehicle_ready(p_vehicle_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vehicles%rowtype;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'give a reason for undoing the ready state' using errcode = '22023';
  end if;

  select * into v from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;
  if v.dismantling_ready_at is null then
    return jsonb_build_object('vehicle_id', v.id, 'idempotent_replay', true);
  end if;
  if exists (select 1 from public.dismantling_assignments a where a.vehicle_id = v.id) then
    raise exception 'an assigned or started vehicle cannot be un-readied' using errcode = 'P0001', hint = 'ASSIGNED_OR_STARTED';
  end if;
  if exists (select 1 from public.dismantling_sessions s where s.vehicle_id = v.id) then
    raise exception 'a dismantling session exists for this vehicle' using errcode = 'P0001', hint = 'ASSIGNED_OR_STARTED';
  end if;

  update public.vehicles set dismantling_ready_at = null, dismantling_ready_by = null, updated_by = auth.uid()
   where id = v.id;

  insert into public.dismantling_assignment_history (vehicle_id, action, actor_id, reason)
  values (v.id, 'UNREADY', auth.uid(), btrim(p_reason));

  perform public.write_audit_log('dismantling.unready', 'vehicle', v.id, 'Undone: ready for dismantling',
    jsonb_build_object('vehicle_id', v.id), btrim(p_reason), null);

  return jsonb_build_object('vehicle_id', v.id, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Assign / reassign / cancel (manager). Only ACTIVE dismantling employees can be assigned.
-- ---------------------------------------------------------------------------------------
create or replace function public.assign_dismantling_vehicle(p_vehicle_id uuid, p_employee_id uuid, p_client_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vehicles%rowtype;
  a public.dismantling_assignments%rowtype;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');

  if p_client_request_id is not null then
    select * into a from public.dismantling_assignments where client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object('assignment_id', a.id, 'vehicle_id', a.vehicle_id, 'employee_id', a.employee_id, 'status', a.status, 'idempotent_replay', true);
    end if;
  end if;

  select * into v from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;
  if v.closed_reason is not null then
    raise exception 'this vehicle is closed' using errcode = 'P0001', hint = 'CLOSED_VEHICLE';
  end if;
  if v.status = 'Dismantled' then
    raise exception 'this vehicle has already been dismantled' using errcode = 'P0001', hint = 'ALREADY_DISMANTLED';
  end if;
  if v.dismantling_ready_at is null then
    raise exception 'mark the vehicle ready for dismantling first' using errcode = 'P0001', hint = 'NOT_READY';
  end if;
  if v.receiving_status <> 'received' then
    raise exception 'receive the vehicle first' using errcode = 'P0001', hint = 'NOT_RECEIVED';
  end if;
  if exists (select 1 from public.dismantling_assignments x where x.vehicle_id = v.id and x.status in ('ASSIGNED','IN_PROGRESS')) then
    raise exception 'this vehicle already has an active assignment' using errcode = 'P0001', hint = 'ALREADY_ASSIGNED';
  end if;
  if not public._dismantling_employee_active(p_employee_id) then
    raise exception 'only an active dismantling employee can be assigned' using errcode = 'P0001', hint = 'NOT_DISMANTLING_EMPLOYEE';
  end if;

  insert into public.dismantling_assignments (vehicle_id, employee_id, assigned_by, assigned_at, status, client_request_id)
  values (v.id, p_employee_id, auth.uid(), now(), 'ASSIGNED', p_client_request_id)
  returning * into a;

  insert into public.dismantling_assignment_history (vehicle_id, assignment_id, action, to_employee_id, actor_id, reason)
  values (v.id, a.id, 'ASSIGNED', p_employee_id, auth.uid(), '');

  insert into public.vehicle_events (vehicle_id, action, status, actor_id, actor_name, note)
  values (v.id, 'DISMANTLING_ASSIGNED', 'Assigned', auth.uid(), public._dismantling_actor_label(), 'Assigned for dismantling');

  perform public.write_audit_log('dismantling.assign', 'dismantling_assignment', a.id, 'Assigned for dismantling',
    jsonb_build_object('vehicle_id', v.id, 'employee_id', p_employee_id), null, p_client_request_id);

  return jsonb_build_object('assignment_id', a.id, 'vehicle_id', v.id, 'employee_id', p_employee_id, 'status', 'ASSIGNED', 'idempotent_replay', false);
end;
$$;

create or replace function public.reassign_dismantling_assignment(p_assignment_id uuid, p_employee_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.dismantling_assignments%rowtype;
  v_from uuid;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'give a reason for reassigning' using errcode = '22023';
  end if;

  select * into a from public.dismantling_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'assignment not found' using errcode = '22023';
  end if;
  if a.status <> 'ASSIGNED' then
    raise exception 'only an assignment that has not started can be reassigned' using errcode = 'P0001', hint = 'NOT_REASSIGNABLE';
  end if;
  perform 1 from public.vehicles where id = a.vehicle_id for update;
  if exists (select 1 from public.dismantling_sessions s where s.vehicle_id = a.vehicle_id and s.ended_at is null) then
    raise exception 'work has started on this vehicle' using errcode = 'P0001', hint = 'ALREADY_STARTED';
  end if;
  if p_employee_id = a.employee_id then
    raise exception 'the vehicle is already assigned to this employee' using errcode = '22023';
  end if;
  if not public._dismantling_employee_active(p_employee_id) then
    raise exception 'only an active dismantling employee can be assigned' using errcode = 'P0001', hint = 'NOT_DISMANTLING_EMPLOYEE';
  end if;

  v_from := a.employee_id;
  update public.dismantling_assignments
     set employee_id = p_employee_id, assigned_by = auth.uid(), assigned_at = now(), updated_at = now()
   where id = a.id;

  insert into public.dismantling_assignment_history (vehicle_id, assignment_id, action, from_employee_id, to_employee_id, actor_id, reason)
  values (a.vehicle_id, a.id, 'REASSIGNED', v_from, p_employee_id, auth.uid(), btrim(p_reason));

  perform public.write_audit_log('dismantling.reassign', 'dismantling_assignment', a.id, 'Reassigned for dismantling',
    jsonb_build_object('from', v_from, 'to', p_employee_id), btrim(p_reason), null);

  return jsonb_build_object('assignment_id', a.id, 'vehicle_id', a.vehicle_id, 'employee_id', p_employee_id, 'status', 'ASSIGNED', 'idempotent_replay', false);
end;
$$;

create or replace function public.cancel_dismantling_assignment(p_assignment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.dismantling_assignments%rowtype;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'give a reason for cancelling the assignment' using errcode = '22023';
  end if;

  select * into a from public.dismantling_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'assignment not found' using errcode = '22023';
  end if;
  if a.status <> 'ASSIGNED' then
    raise exception 'only an assignment that has not started can be cancelled' using errcode = 'P0001', hint = 'NOT_CANCELLABLE';
  end if;

  update public.dismantling_assignments set status = 'CANCELLED', cancelled_at = now(), updated_at = now() where id = a.id;

  -- The vehicle returns to Ready for Dismantling: dismantling_ready_at is not cleared.
  insert into public.dismantling_assignment_history (vehicle_id, assignment_id, action, from_employee_id, actor_id, reason)
  values (a.vehicle_id, a.id, 'CANCELLED', a.employee_id, auth.uid(), btrim(p_reason));

  perform public.write_audit_log('dismantling.cancel', 'dismantling_assignment', a.id, 'Assignment cancelled before start',
    jsonb_build_object('vehicle_id', a.vehicle_id), btrim(p_reason), null);

  return jsonb_build_object('assignment_id', a.id, 'vehicle_id', a.vehicle_id, 'status', 'CANCELLED', 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 8. Employee start and resume. Only the assigned employee; transactional; replay-safe.
-- ---------------------------------------------------------------------------------------
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
  if v.status = 'Dismantled' then
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

-- The old vehicle-id entry point stays for compatibility, but it only ever starts the caller's own assignment.
create or replace function public.start_dismantling_session(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.dismantling_assignments%rowtype;
begin
  perform public._rpc_require_roles('dismantling');
  select * into a from public.dismantling_assignments
   where vehicle_id = p_vehicle_id and employee_id = auth.uid() and status in ('ASSIGNED','IN_PROGRESS');
  if not found then
    raise exception 'This vehicle is not assigned to you.' using errcode = '42501', hint = 'NOT_ASSIGNED';
  end if;
  return public.start_dismantling_assignment(a.id, null);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 9. Employee capture. Owner/manager/engineer_admin are refused by the role check.
-- ---------------------------------------------------------------------------------------
-- The 2-argument capture entry point is replaced by one that requires the capture name and details.
drop function if exists public.begin_dismantled_part(uuid, uuid);

create or replace function public.begin_dismantled_part(p_session_id uuid, p_client_request_id uuid, p_capture_name text, p_capture_details text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.dismantling_sessions%rowtype;
  v public.vehicles%rowtype;
  p public.parts%rowtype;
  v_event_id uuid;
  v_name text := btrim(coalesce(p_capture_name, ''));
  v_details text := btrim(coalesce(p_capture_details, ''));
begin
  perform public._rpc_require_roles('dismantling');
  if p_client_request_id is null then
    raise exception 'a capture request id is required' using errcode = '22023';
  end if;

  select * into p from public.parts where client_request_id = p_client_request_id;
  if found then
    if p.dismantling_session_id is distinct from p_session_id then
      raise exception 'this capture request belongs to another session' using errcode = '22023';
    end if;
    perform public._dismantling_owned_session(p_session_id);
    return jsonb_build_object('part_id', p.id, 'session_id', p_session_id, 'idempotent_replay', true);
  end if;

  s := public._dismantling_owned_session(p_session_id);
  if s.status <> 'active' or s.ended_at is not null then
    raise exception 'this session is no longer active' using errcode = 'P0001', hint = 'SESSION_NOT_ACTIVE';
  end if;
  if s.assignment_id is not null and not exists (
       select 1 from public.dismantling_assignments a where a.id = s.assignment_id and a.status = 'IN_PROGRESS' and a.employee_id = auth.uid()) then
    raise exception 'This vehicle is not assigned to you.' using errcode = '42501', hint = 'NOT_ASSIGNED';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'enter the part name (2 to 120 characters)' using errcode = '22023', hint = 'CAPTURE_REQUIRED';
  end if;
  if char_length(v_details) < 3 or char_length(v_details) > 500 then
    raise exception 'enter part details or notes (3 to 500 characters)' using errcode = '22023', hint = 'CAPTURE_REQUIRED';
  end if;

  select * into v from public.vehicles where id = s.vehicle_id;

  insert into public.vehicle_events (vehicle_id, action, part_type, high_value, status, actor_id, actor_name, dismantling_session_id, note)
  values (s.vehicle_id, 'PART_REMOVED', '', false, 'captured', auth.uid(), public._dismantling_actor_label(), p_session_id, 'Part capture started')
  returning id into v_event_id;

  insert into public.parts (vehicle_id, source_vehicle_event_id, dismantling_session_id, source_vin, source_lot,
                            status, quantity, captured_by, client_request_id, capture_name, capture_details)
  values (s.vehicle_id, v_event_id, p_session_id, v.vin, coalesce(v.lot_number, v.stock_number),
          'captured', 1, auth.uid(), p_client_request_id, v_name, v_details)
  returning * into p;

  perform public.write_audit_log('dismantling.part_begin', 'part', p.id, 'Part capture started',
    jsonb_build_object('session_id', p_session_id), null, p_client_request_id);

  return jsonb_build_object('part_id', p.id, 'session_id', p_session_id, 'idempotent_replay', false);
end;
$$;

-- Employee corrects their own capture while the session is in progress. Final catalog fields are not touched here.
create or replace function public.update_part_capture(p_part_id uuid, p_capture_name text, p_capture_details text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.parts%rowtype;
  s public.dismantling_sessions%rowtype;
  v_name text := btrim(coalesce(p_capture_name, ''));
  v_details text := btrim(coalesce(p_capture_details, ''));
begin
  perform public._rpc_require_roles('dismantling');
  select * into p from public.parts where id = p_part_id for update;
  if not found or p.dismantling_session_id is null then
    raise exception 'part not found' using errcode = '22023';
  end if;
  s := public._dismantling_owned_session(p.dismantling_session_id);
  if s.status <> 'active' or s.ended_at is not null then
    raise exception 'this session is finished, so captures are read-only' using errcode = 'P0001', hint = 'SESSION_NOT_ACTIVE';
  end if;
  if p.status <> 'captured' then
    raise exception 'this capture can no longer be edited' using errcode = 'P0001', hint = 'NOT_EDITABLE';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'enter the part name (2 to 120 characters)' using errcode = '22023', hint = 'CAPTURE_REQUIRED';
  end if;
  if char_length(v_details) < 3 or char_length(v_details) > 500 then
    raise exception 'enter part details or notes (3 to 500 characters)' using errcode = '22023', hint = 'CAPTURE_REQUIRED';
  end if;

  update public.parts set capture_name = v_name, capture_details = v_details, capture_saved_at = null, updated_at = now()
   where id = p.id;

  perform public.write_audit_log('dismantling.part_edit', 'part', p.id, 'Employee corrected part capture',
    jsonb_build_object('session_id', s.id), null, null);

  return jsonb_build_object('part_id', p.id, 'idempotent_replay', false);
end;
$$;

-- "Save Part & Next": a part counts as saved only when the capture text and at least one ready photo are persisted.
create or replace function public.save_dismantled_part(p_part_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.parts%rowtype;
  s public.dismantling_sessions%rowtype;
  v_photos int;
begin
  perform public._rpc_require_roles('dismantling');
  select * into p from public.parts where id = p_part_id for update;
  if not found or p.dismantling_session_id is null then
    raise exception 'part not found' using errcode = '22023';
  end if;
  s := public._dismantling_owned_session(p.dismantling_session_id);
  if p.status <> 'captured' then
    raise exception 'this capture can no longer be saved' using errcode = 'P0001', hint = 'NOT_EDITABLE';
  end if;
  if p.capture_saved_at is not null then
    return jsonb_build_object('part_id', p.id, 'capture_saved_at', p.capture_saved_at, 'idempotent_replay', true);
  end if;
  if s.status <> 'active' or s.ended_at is not null then
    raise exception 'this session is finished' using errcode = 'P0001', hint = 'SESSION_NOT_ACTIVE';
  end if;
  if char_length(btrim(p.capture_name)) < 2 or char_length(btrim(p.capture_details)) < 3 then
    raise exception 'enter the part name and details first' using errcode = 'P0001', hint = 'CAPTURE_REQUIRED';
  end if;
  select count(*) into v_photos from public.media_assets
   where owner_type = 'part' and owner_id = p.id and variant = 'original' and status = 'ready';
  if v_photos < 1 then
    raise exception 'add at least one part photo before saving' using errcode = 'P0001', hint = 'PART_WITHOUT_PHOTO';
  end if;

  update public.parts set capture_saved_at = now(), updated_at = now() where id = p.id returning * into p;

  return jsonb_build_object('part_id', p.id, 'capture_saved_at', p.capture_saved_at, 'idempotent_replay', false);
end;
$$;

-- abandon_dismantled_part: same behaviour as 0016, now for the dismantling role only.
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
-- 10. Finish (employee only). Transactional: session, assignment, vehicle lifecycle and history together.
-- ---------------------------------------------------------------------------------------
create or replace function public.finish_dismantling_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.dismantling_sessions%rowtype;
  v_evidence int;
  v_parts int;
  v_missing int;
  v_unsaved int;
begin
  perform public._rpc_require_roles('dismantling');

  select * into s from public.dismantling_sessions where id = p_session_id for update;
  if not found then
    raise exception 'dismantling session not found' using errcode = '22023';
  end if;
  if s.employee_id <> auth.uid() then
    raise exception 'This vehicle is not assigned to you.' using errcode = '42501', hint = 'NOT_ASSIGNED';
  end if;
  if s.status = 'completed' then
    return jsonb_build_object('session_id', s.id, 'status', 'completed', 'part_photos_captured', s.part_photos_captured, 'idempotent_replay', true);
  end if;
  if s.status <> 'active' or s.ended_at is not null then
    raise exception 'this session is not active' using errcode = 'P0001', hint = 'SESSION_NOT_ACTIVE';
  end if;

  select count(*) into v_evidence from public.media_assets
   where owner_type = 'dismantling_session' and owner_id = p_session_id and variant = 'original' and status = 'ready';
  if v_evidence < 1 then
    raise exception 'add at least one vehicle evidence photo before finishing' using errcode = 'P0001', hint = 'NO_EVIDENCE';
  end if;

  select count(*) into v_parts from public.parts where dismantling_session_id = p_session_id and status <> 'rejected';
  select count(*) into v_unsaved from public.parts p
   where p.dismantling_session_id = p_session_id and p.status = 'captured' and p.capture_saved_at is null;
  if v_unsaved > 0 then
    raise exception '% captured part(s) are not saved yet: save or abandon them first', v_unsaved
      using errcode = 'P0001', hint = 'PART_NOT_SAVED';
  end if;
  select count(*) into v_missing from public.parts p
   where p.dismantling_session_id = p_session_id and p.status = 'captured'
     and not exists (select 1 from public.media_assets m
                      where m.owner_type = 'part' and m.owner_id = p.id and m.variant = 'original' and m.status = 'ready');
  if v_missing > 0 then
    raise exception '% captured part(s) still need a photo: retry the upload or abandon the capture', v_missing
      using errcode = 'P0001', hint = 'PART_WITHOUT_PHOTO';
  end if;

  update public.dismantling_sessions set status = 'completed', ended_at = now(), part_photos_captured = v_parts where id = p_session_id;

  if s.assignment_id is not null then
    update public.dismantling_assignments set status = 'COMPLETED', completed_at = now(), updated_at = now() where id = s.assignment_id;
    insert into public.dismantling_assignment_history (vehicle_id, assignment_id, action, from_employee_id, actor_id, reason)
    values (s.vehicle_id, s.assignment_id, 'COMPLETED', s.employee_id, auth.uid(), v_parts || ' part(s) captured');
  end if;

  update public.vehicles set status = 'Dismantled', updated_by = auth.uid() where id = s.vehicle_id;

  insert into public.vehicle_events (vehicle_id, action, status, actor_id, actor_name, dismantling_session_id, note)
  values (s.vehicle_id, 'DISMANTLING_COMPLETED', 'Dismantled', auth.uid(), public._dismantling_actor_label(), p_session_id,
          v_parts || ' part(s) captured');

  perform public.write_audit_log('dismantling.finish', 'dismantling_session', p_session_id,
    'Dismantling session completed', jsonb_build_object('parts', v_parts, 'vehicle_id', s.vehicle_id), null, null);

  return jsonb_build_object('session_id', p_session_id, 'status', 'completed', 'part_photos_captured', v_parts, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 11. Optional issue report (employee only, own active session). Stored as a vehicle event on the session.
-- ---------------------------------------------------------------------------------------
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
  if p_issue not in ('Vehicle Mismatch','Unexpected Major Damage','Missing Expected Component','Unsafe Condition','Already Partially Dismantled','Record Discrepancy','Other') then
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

-- ---------------------------------------------------------------------------------------
-- 12. Grants. Every new or replaced RPC is callable by signed-in users only; each checks its own role.
-- ---------------------------------------------------------------------------------------
revoke execute on function public.mark_vehicle_ready(uuid, uuid) from public, anon;
revoke execute on function public.undo_vehicle_ready(uuid, text) from public, anon;
revoke execute on function public.assign_dismantling_vehicle(uuid, uuid, uuid) from public, anon;
revoke execute on function public.reassign_dismantling_assignment(uuid, uuid, text) from public, anon;
revoke execute on function public.cancel_dismantling_assignment(uuid, text) from public, anon;
revoke execute on function public.start_dismantling_assignment(uuid, uuid) from public, anon;
revoke execute on function public.start_dismantling_session(uuid) from public, anon;
revoke execute on function public.begin_dismantled_part(uuid, uuid, text, text) from public, anon;
revoke execute on function public.update_part_capture(uuid, text, text) from public, anon;
revoke execute on function public.save_dismantled_part(uuid) from public, anon;
revoke execute on function public.abandon_dismantled_part(uuid) from public, anon;
revoke execute on function public.finish_dismantling_session(uuid) from public, anon;
revoke execute on function public.flag_dismantling_issue(uuid, text, text, uuid) from public, anon;

grant execute on function public.mark_vehicle_ready(uuid, uuid) to authenticated;
grant execute on function public.undo_vehicle_ready(uuid, text) to authenticated;
grant execute on function public.assign_dismantling_vehicle(uuid, uuid, uuid) to authenticated;
grant execute on function public.reassign_dismantling_assignment(uuid, uuid, text) to authenticated;
grant execute on function public.cancel_dismantling_assignment(uuid, text) to authenticated;
grant execute on function public.start_dismantling_assignment(uuid, uuid) to authenticated;
grant execute on function public.start_dismantling_session(uuid) to authenticated;
grant execute on function public.begin_dismantled_part(uuid, uuid, text, text) to authenticated;
grant execute on function public.update_part_capture(uuid, text, text) to authenticated;
grant execute on function public.save_dismantled_part(uuid) to authenticated;
grant execute on function public.abandon_dismantled_part(uuid) to authenticated;
grant execute on function public.finish_dismantling_session(uuid) to authenticated;
grant execute on function public.flag_dismantling_issue(uuid, text, text, uuid) to authenticated;
