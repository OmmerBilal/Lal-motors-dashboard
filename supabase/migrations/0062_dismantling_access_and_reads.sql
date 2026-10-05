-- =====================================================================================
-- 0062 — Dismantling v2 access rules and read models. ADDITIVE policy replacements and new read functions.
-- 0001–0061 are not edited.
--
-- 1. Direct table access for the dismantling role is removed where it bypassed the assignment rules:
--    * dismantling_sessions: the FOR ALL write policy (any dismantling user could edit any session) is removed.
--      Reads are limited to review roles and the session's own employee. All writes go through RPCs.
--    * vehicles / vehicle_events: a dismantling-only user no longer reads or writes the vehicle table directly.
--      The employee sees vehicles only through the assignment RPCs below.
-- 2. media_assets insert: evidence for a dismantling session, and photos of a captured part, can be added while
--    the session is active only by that session's employee. Managers keep read access for review.
-- 3. Read RPCs (bounded, server-filtered) for the admin list, the workload summary, the employee home and
--    workspace, and the manager vehicle-centric record.
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- 1. Access policies
-- ---------------------------------------------------------------------------------------
create or replace function public._is_dismantling_only()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role('dismantling')
     and not public.has_any_role('owner', 'engineer_admin', 'manager', 'auction', 'receiving', 'employee', 'container_loading', 'export_manager', 'scrap_driver');
$$;
revoke execute on function public._is_dismantling_only() from public, anon;
grant execute on function public._is_dismantling_only() to authenticated;

drop policy if exists dismantling_sessions_domain_write on public.dismantling_sessions;
drop policy if exists dismantling_sessions_domain_read on public.dismantling_sessions;
create policy dismantling_sessions_review_read on public.dismantling_sessions for select
  using (public.has_any_role('owner', 'engineer_admin', 'manager') or (employee_id = auth.uid() and public.has_any_role('dismantling')));

drop policy if exists vehicles_domain_read on public.vehicles;
create policy vehicles_domain_read on public.vehicles for select
  using (public.is_vehicle_domain_staff() and not public._is_dismantling_only());
drop policy if exists vehicles_domain_update on public.vehicles;
create policy vehicles_domain_update on public.vehicles for update
  using (public.is_vehicle_domain_staff() and not public._is_dismantling_only())
  with check (public.is_vehicle_domain_staff() and not public._is_dismantling_only());

drop policy if exists vehicle_events_domain_read on public.vehicle_events;
create policy vehicle_events_domain_read on public.vehicle_events for select
  using (public.is_vehicle_domain_staff() and not public._is_dismantling_only());
drop policy if exists vehicle_events_domain_insert on public.vehicle_events;
create policy vehicle_events_domain_insert on public.vehicle_events for insert
  with check (public.is_vehicle_domain_staff() and not public._is_dismantling_only());

-- Evidence writes: a session's employee, while the session is active. Other writers keep their existing rules.
create or replace function public._dismantling_media_write_allowed(p_owner_type text, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner_type = 'dismantling_session' then
      not exists (select 1 from public.dismantling_sessions s where s.id = p_owner_id and s.ended_at is null)
      or exists (select 1 from public.dismantling_sessions s where s.id = p_owner_id and s.ended_at is null and s.employee_id = auth.uid())
    when p_owner_type = 'part' then
      not exists (select 1 from public.parts p join public.dismantling_sessions s on s.id = p.dismantling_session_id
                   where p.id = p_owner_id and s.ended_at is null)
      or exists (select 1 from public.parts p join public.dismantling_sessions s on s.id = p.dismantling_session_id
                  where p.id = p_owner_id and s.ended_at is null and s.employee_id = auth.uid())
    else true
  end;
$$;
revoke execute on function public._dismantling_media_write_allowed(text, uuid) from public, anon;
grant execute on function public._dismantling_media_write_allowed(text, uuid) to authenticated;

drop policy if exists media_assets_domain_insert on public.media_assets;
create policy media_assets_domain_insert on public.media_assets for insert
  with check (
    public.can_access_media(owner_type, owner_id)
    and public.media_owner_exists(owner_type, owner_id)
    and public._dismantling_media_write_allowed(owner_type, owner_id)
  );

-- ---------------------------------------------------------------------------------------
-- 2. Manager: vehicle-centric admin list
-- ---------------------------------------------------------------------------------------
create or replace function public.list_dismantling_vehicles(p_tab text, p_search text default null, p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_total bigint;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  if p_tab not in ('eligible', 'ready', 'assigned', 'in_progress', 'completed', 'issues') then
    raise exception 'unknown list' using errcode = '22023';
  end if;

  with base as (
    select v.id as vehicle_id, v.vin, v.lot_number, v.stock_number, v.year, v.make, v.model, v.auction_source,
           v.status as vehicle_status, v.received_at, v.dismantling_ready_at, v.closed_reason, v.receiving_status,
           a.id as assignment_id, a.status as assignment_status, a.employee_id, e.name as employee_name,
           a.assigned_at, ab.name as assigned_by_name, a.started_at, a.completed_at,
           (select count(*) from public.dismantling_sessions s join public.parts p on p.dismantling_session_id = s.id
             where s.assignment_id = a.id and p.status <> 'rejected') as parts_captured,
           (select count(*) from public.vehicle_events ev join public.dismantling_sessions s on s.id = ev.dismantling_session_id
             where s.assignment_id = a.id and ev.action = 'ISSUE_FLAGGED') as issues_flagged
      from public.vehicles v
      left join lateral (
        select x.* from public.dismantling_assignments x
         where x.vehicle_id = v.id
         order by (x.status in ('ASSIGNED', 'IN_PROGRESS')) desc, x.assigned_at desc
         limit 1
      ) a on true
      left join public.profiles e on e.id = a.employee_id
      left join public.profiles ab on ab.id = a.assigned_by
  ), filtered as (
    select b.*, count(*) over () as total
      from base b
     where b.closed_reason is null
       and (
            (p_tab = 'eligible' and b.received_at is not null and b.receiving_status = 'received'
               and b.vehicle_status <> 'Dismantled' and b.dismantling_ready_at is null
               and coalesce(b.assignment_status, '') not in ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED'))
         or (p_tab = 'ready' and b.dismantling_ready_at is not null and b.vehicle_status <> 'Dismantled'
               and coalesce(b.assignment_status, '') not in ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED'))
         or (p_tab = 'assigned' and b.assignment_status = 'ASSIGNED')
         or (p_tab = 'in_progress' and b.assignment_status = 'IN_PROGRESS')
         or (p_tab = 'completed' and b.assignment_status = 'COMPLETED')
         or (p_tab = 'issues' and b.assignment_id is not null and b.issues_flagged > 0)
       )
       and (v_term is null or b.vin ilike '%' || v_term || '%' or b.lot_number ilike '%' || v_term || '%'
            or b.stock_number ilike '%' || v_term || '%' or b.make ilike '%' || v_term || '%' or b.model ilike '%' || v_term || '%')
  )
  select coalesce(jsonb_agg(to_jsonb(f) - 'total' order by coalesce(f.assigned_at, f.dismantling_ready_at, f.received_at) desc, f.vehicle_id), '[]'::jsonb),
         coalesce(max(f.total), 0)
    into v_rows, v_total
    from (select * from filtered order by coalesce(assigned_at, dismantling_ready_at, received_at) desc, vehicle_id
           limit v_limit offset v_offset) f;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

-- Workload per ACTIVE dismantling employee, from the server (no client counting).
create or replace function public.get_dismantling_workload()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  return coalesce((
    select jsonb_agg(x order by x.name)
      from (
        select p.id as employee_id, p.name,
               count(a.id) filter (where a.status = 'ASSIGNED') as assigned,
               count(a.id) filter (where a.status = 'IN_PROGRESS') as in_progress,
               count(a.id) filter (where a.status = 'COMPLETED') as completed
          from public.profiles p
          join public.user_roles ur on ur.user_id = p.id
          join public.roles r on r.id = ur.role_id and r.key = 'dismantling'
          left join public.dismantling_assignments a on a.employee_id = p.id
         where p.account_status = 'active'
         group by p.id, p.name
      ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Manager: vehicle-centric dismantling record ("who dismantled this car, and which parts")
-- ---------------------------------------------------------------------------------------
create or replace function public.get_dismantling_vehicle_record(p_vehicle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.vehicles%rowtype;
  v_result jsonb;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  select * into v from public.vehicles where id = p_vehicle_id;
  if not found then
    raise exception 'vehicle not found' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'vehicle', jsonb_build_object(
      'id', v.id, 'vin', v.vin, 'lot_number', v.lot_number, 'stock_number', v.stock_number,
      'year', v.year, 'make', v.make, 'model', v.model, 'auction_source', v.auction_source,
      'status', v.status, 'received_at', v.received_at, 'dismantling_ready_at', v.dismantling_ready_at,
      'closed_reason', v.closed_reason),
    'assignments', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', a.id, 'employee_id', a.employee_id, 'employee_name', e.name,
            'assigned_by_name', ab.name, 'assigned_at', a.assigned_at, 'status', a.status,
            'started_at', a.started_at, 'completed_at', a.completed_at, 'cancelled_at', a.cancelled_at)
          order by a.assigned_at desc)
          from (select * from public.dismantling_assignments where vehicle_id = v.id order by assigned_at desc limit 20) a
          left join public.profiles e on e.id = a.employee_id
          left join public.profiles ab on ab.id = a.assigned_by), '[]'::jsonb),
    'history', coalesce((
        select jsonb_agg(jsonb_build_object('action', h.action, 'from_employee_id', h.from_employee_id,
                                            'to_employee_id', h.to_employee_id, 'actor_name', ac.name,
                                            'reason', h.reason, 'created_at', h.created_at) order by h.created_at desc)
          from (select * from public.dismantling_assignment_history where vehicle_id = v.id order by created_at desc limit 100) h
          left join public.profiles ac on ac.id = h.actor_id), '[]'::jsonb),
    'sessions', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'assignment_id', s.assignment_id, 'employee_id', s.employee_id,
                                            'employee_name', e.name, 'status', s.status,
                                            'started_at', s.started_at, 'ended_at', s.ended_at,
                                            'parts_captured', s.part_photos_captured) order by s.started_at desc)
          from (select * from public.dismantling_sessions where vehicle_id = v.id order by started_at desc limit 20) s
          left join public.profiles e on e.id = s.employee_id), '[]'::jsonb),
    'parts', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', p.id, 'session_id', p.dismantling_session_id, 'assignment_id', s.assignment_id,
            'capture_name', p.capture_name, 'capture_details', p.capture_details,
            'capture_saved_at', p.capture_saved_at, 'captured_at', p.created_at,
            'captured_by', p.captured_by, 'captured_by_name', cb.name,
            'status', p.status, 'stage', p.stage, 'duplicate_of_part_id', p.duplicate_of_part_id,
            'not_sellable_reason', p.not_sellable_reason, 'part_name', p.part_name,
            'photo_asset_ids', coalesce((
                select jsonb_agg(m.id order by m.created_at)
                  from public.media_assets m
                 where m.owner_type = 'part' and m.owner_id = p.id and m.variant = 'original' and m.status = 'ready'), '[]'::jsonb))
          order by p.created_at)
          from public.parts p
          join public.dismantling_sessions s on s.id = p.dismantling_session_id
          left join public.profiles cb on cb.id = p.captured_by
         where s.vehicle_id = v.id), '[]'::jsonb),
    'issues', coalesce((
        select jsonb_agg(jsonb_build_object('id', ev.id, 'session_id', ev.dismantling_session_id,
                                            'issue', ev.status, 'note', ev.note, 'actor_name', ev.actor_name,
                                            'created_at', ev.created_at) order by ev.created_at desc)
          from public.vehicle_events ev
         where ev.vehicle_id = v.id and ev.action = 'ISSUE_FLAGGED'), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Employee: own assignments only
-- ---------------------------------------------------------------------------------------
create or replace function public.list_my_dismantling_assignments(p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._rpc_require_roles('dismantling');
  return coalesce((
    select jsonb_agg(x order by x.sort_at desc)
      from (
        select a.id as assignment_id, a.status as assignment_status, a.assigned_at, a.started_at, a.completed_at,
               v.id as vehicle_id, v.vin, v.lot_number, v.stock_number, v.year, v.make, v.model, v.auction_source,
               (select s.id from public.dismantling_sessions s where s.assignment_id = a.id order by s.started_at desc limit 1) as session_id,
               (select count(*) from public.dismantling_sessions s join public.parts p on p.dismantling_session_id = s.id
                 where s.assignment_id = a.id and p.status <> 'rejected') as parts_captured,
               (select count(*) from public.vehicle_events ev join public.dismantling_sessions s on s.id = ev.dismantling_session_id
                 where s.assignment_id = a.id and ev.action = 'ISSUE_FLAGGED') as issues_flagged,
               coalesce(a.started_at, a.assigned_at) as sort_at
          from public.dismantling_assignments a
          join public.vehicles v on v.id = a.vehicle_id
         where a.employee_id = auth.uid() and a.status in ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED')
         order by coalesce(a.started_at, a.assigned_at) desc
         limit least(greatest(coalesce(p_limit, 100), 1), 200)
      ) x
  ), '[]'::jsonb);
end;
$$;

-- Search only resolves the caller's own assignments. Another employee's vehicle gets NOT_ASSIGNED, with no details.
create or replace function public.find_my_dismantling_assignment(p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_term text := btrim(coalesce(p_term, ''));
  v_vehicle uuid;
  a public.dismantling_assignments%rowtype;
begin
  perform public._rpc_require_roles('dismantling');
  if char_length(v_term) < 3 then
    return jsonb_build_object('result', 'not_found');
  end if;

  select v.id into v_vehicle from public.vehicles v
   where upper(v.vin) = upper(v_term) or upper(v.lot_number) = upper(v_term) or upper(v.stock_number) = upper(v_term)
   order by v.created_at desc limit 1;
  if v_vehicle is null then
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into a from public.dismantling_assignments
   where vehicle_id = v_vehicle and employee_id = auth.uid()
   order by (status in ('ASSIGNED', 'IN_PROGRESS')) desc, assigned_at desc limit 1;
  if found and a.status in ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED') then
    return jsonb_build_object('result', 'found', 'assignment_id', a.id, 'assignment_status', a.status);
  end if;
  return jsonb_build_object('result', 'not_assigned');
end;
$$;

-- The workspace for one assignment. Only the assigned employee; everything else is refused.
create or replace function public.get_my_dismantling_workspace(p_assignment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.dismantling_assignments%rowtype;
  v public.vehicles%rowtype;
  s public.dismantling_sessions%rowtype;
begin
  perform public._rpc_require_roles('dismantling');
  select * into a from public.dismantling_assignments where id = p_assignment_id;
  if not found or a.employee_id <> auth.uid() then
    raise exception 'This vehicle is not assigned to you.' using errcode = '42501', hint = 'NOT_ASSIGNED';
  end if;
  select * into v from public.vehicles where id = a.vehicle_id;
  select * into s from public.dismantling_sessions where assignment_id = a.id order by started_at desc limit 1;

  return jsonb_build_object(
    'vehicle', jsonb_build_object('id', v.id, 'vin', v.vin, 'lot_number', v.lot_number, 'stock_number', v.stock_number,
                                  'year', v.year, 'make', v.make, 'model', v.model, 'auction_source', v.auction_source,
                                  'closed_reason', v.closed_reason, 'status', v.status),
    'assignment', jsonb_build_object('id', a.id, 'status', a.status, 'assigned_at', a.assigned_at,
                                     'started_at', a.started_at, 'completed_at', a.completed_at),
    'session', case when s.id is null then null else jsonb_build_object('id', s.id, 'status', s.status,
                                                                         'started_at', s.started_at, 'ended_at', s.ended_at) end,
    'evidence_asset_ids', case when s.id is null then '[]'::jsonb else coalesce((
        select jsonb_agg(m.id order by m.created_at)
          from public.media_assets m
         where m.owner_type = 'dismantling_session' and m.owner_id = s.id and m.variant = 'original' and m.status = 'ready'), '[]'::jsonb) end,
    'parts', case when s.id is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', p.id, 'capture_name', p.capture_name, 'capture_details', p.capture_details,
            'status', p.status, 'capture_saved_at', p.capture_saved_at, 'captured_at', p.created_at,
            'photo_asset_ids', coalesce((
                select jsonb_agg(m.id order by m.created_at)
                  from public.media_assets m
                 where m.owner_type = 'part' and m.owner_id = p.id and m.variant = 'original' and m.status = 'ready'), '[]'::jsonb))
          order by p.created_at)
          from (select * from public.parts where dismantling_session_id = s.id and status <> 'rejected' order by created_at limit 200) p), '[]'::jsonb) end,
    'issues', case when s.id is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('id', ev.id, 'issue', ev.status, 'note', ev.note, 'created_at', ev.created_at)
                         order by ev.created_at desc)
          from (select * from public.vehicle_events where dismantling_session_id = s.id and action = 'ISSUE_FLAGGED' order by created_at desc limit 50) ev), '[]'::jsonb) end
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------------------
revoke execute on function public.list_dismantling_vehicles(text, text, int, int) from public, anon;
revoke execute on function public.get_dismantling_workload() from public, anon;
revoke execute on function public.get_dismantling_vehicle_record(uuid) from public, anon;
revoke execute on function public.list_my_dismantling_assignments(int) from public, anon;
revoke execute on function public.find_my_dismantling_assignment(text) from public, anon;
revoke execute on function public.get_my_dismantling_workspace(uuid) from public, anon;
grant execute on function public.list_dismantling_vehicles(text, text, int, int) to authenticated;
grant execute on function public.get_dismantling_workload() to authenticated;
grant execute on function public.get_dismantling_vehicle_record(uuid) to authenticated;
grant execute on function public.list_my_dismantling_assignments(int) to authenticated;
grant execute on function public.find_my_dismantling_assignment(text) to authenticated;
grant execute on function public.get_my_dismantling_workspace(uuid) to authenticated;
