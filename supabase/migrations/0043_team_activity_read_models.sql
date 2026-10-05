-- ---------------------------------------------------------------------------------------
-- 0043 — Team and employee activity read models (Module 15). ADDITIVE: read functions only.
--
-- The team directory is the existing profiles + user_roles source (no duplicate member table).
-- Pending invites come from user_invites, the real invite table. Activity is aggregated in SQL from the
-- operational sources: vehicle_events, dismantling_sessions, parts, scrap_loads, container_events and audit_logs.
--
-- Owner only, as /team is OWNER_ONLY (src/lib/auth/route-access.ts). No auth internals, no secrets, no
-- payment or export detail is returned. Ranges are bounded (max 366 days) and filtered in SQL.
-- ---------------------------------------------------------------------------------------

create or replace function public._team_require_owner(p_from date default null, p_to date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.has_any_role('owner') then
    raise exception 'forbidden: the team and activity views are for the owner' using errcode = '42501';
  end if;
  if (p_from is null) <> (p_to is null) or (p_from is not null and (p_to < p_from or p_to - p_from > 366)) then
    raise exception 'choose a date range of up to one year' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public._team_require_owner(date, date) from public, anon, authenticated;

-- Team directory: every profile with its role keys and account status. Disabled and removed accounts are
-- returned with their status so the UI can show them truthfully rather than hiding them.
create or replace function public.team_list_members()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._team_require_owner();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', p.name, 'email', p.email, 'account_status', p.account_status,
             'roles', coalesce(x.keys, '[]'::jsonb), 'last_seen_at', p.last_seen_at, 'created_at', p.created_at)
             order by p.name)
      from public.profiles p
      left join lateral (
        select jsonb_agg(r.key order by r.key) as keys
          from public.user_roles ur join public.roles r on r.id = ur.role_id
         where ur.user_id = p.id
      ) x on true
  ), '[]'::jsonb);
end;
$$;

-- Pending invitations from the real invite table. Empty when none exist.
create or replace function public.team_list_invites()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._team_require_owner();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'email', i.email, 'name', i.name, 'role', r.key, 'invited_at', i.invited_at,
             'invited_by_name', inv.name)
             order by i.invited_at desc)
      from public.user_invites i
      join public.roles r on r.id = i.role_id
      join public.profiles inv on inv.id = i.invited_by
     where i.status = 'pending'
  ), '[]'::jsonb);
end;
$$;

-- Per-employee activity counts for a range. Each count comes from its own authoritative source.
create or replace function public.employee_activity_summary(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._team_require_owner(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'profile_id', p.id, 'name', p.name, 'account_status', p.account_status,
             'roles', coalesce(x.keys, '[]'::jsonb),
             'vehicle_events', (select count(*)::int from public.vehicle_events e where e.actor_id = p.id
                                  and (e.created_at at time zone 'America/New_York')::date between p_from and p_to),
             'sessions_started', (select count(*)::int from public.dismantling_sessions s where s.employee_id = p.id
                                  and (s.started_at at time zone 'America/New_York')::date between p_from and p_to),
             'sessions_completed', (select count(*)::int from public.dismantling_sessions s where s.employee_id = p.id
                                  and s.status = 'completed' and s.ended_at is not null
                                  and (s.ended_at at time zone 'America/New_York')::date between p_from and p_to),
             'parts_captured', (select count(*)::int from public.parts pt where pt.captured_by = p.id
                                  and (pt.created_at at time zone 'America/New_York')::date between p_from and p_to),
             'part_reviews', (select count(*)::int from public.audit_logs a where a.actor_id = p.id and a.action like 'part.%'
                                  and (a.created_at at time zone 'America/New_York')::date between p_from and p_to),
             'scrap_loads', (select count(*)::int from public.scrap_loads sl where sl.driver_id = p.id
                                  and sl.load_date between p_from and p_to),
             'container_actions', (select count(*)::int from public.container_events ce where ce.actor_id = p.id
                                  and (ce.created_at at time zone 'America/New_York')::date between p_from and p_to))
             order by p.name)
      from public.profiles p
      left join lateral (
        select jsonb_agg(r.key order by r.key) as keys
          from public.user_roles ur join public.roles r on r.id = ur.role_id
         where ur.user_id = p.id
      ) x on true
     where not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                        where ur.user_id = p.id and r.key = 'owner')
  ), '[]'::jsonb);
end;
$$;

-- Recent activity from the audit trail: safe summaries only (no change payloads, no request data).
create or replace function public.employee_recent_activity(p_from date, p_to date, p_limit int default 25, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._team_require_owner(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'actor_name', a.actor_name, 'actor_id', a.actor_id, 'action', a.action,
             'entity_type', a.entity_type, 'entity_id', a.entity_id, 'summary', a.summary, 'created_at', a.created_at)
             order by a.created_at desc)
      from (select * from public.audit_logs
             where (created_at at time zone 'America/New_York')::date between p_from and p_to
               and (p_actor is null or actor_id = p_actor)
             order by created_at desc
             limit least(greatest(coalesce(p_limit, 25), 1), 100)) a
  ), '[]'::jsonb);
end;
$$;

-- Management operations counts (manager-dashboard figures) from the authoritative tables.
create or replace function public.management_operations_summary(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._team_require_owner(p_from, p_to);
  return jsonb_build_object(
    'dismantling_active_sessions', (select count(*)::int from public.dismantling_sessions where status = 'active'),
    'dismantling_completed_in_range', (select count(*)::int from public.dismantling_sessions where status = 'completed'
                                         and ended_at is not null and (ended_at at time zone 'America/New_York')::date between p_from and p_to),
    'parts_review_queue', (select count(*)::int from public.parts where status in ('captured', 'draft_ready', 'manager_review')),
    'parts_out_of_stock', (select count(*)::int from public.parts where status = 'approved' and quantity = 0),
    'parts_ready_for_sale', (select count(*)::int from public.parts where status = 'approved' and stage = 'ready_for_sale' and quantity > 0),
    'sales_open', (select count(*)::int from public.sales where status = 'OPEN' and fulfillment_status in ('unfulfilled', 'partial')),
    'scrap_awaiting_review', (select count(*)::int from public.scrap_loads where status = 'ready_for_review'),
    'scrap_open_discrepancies', (select count(*)::int from public.scrap_discrepancies where status = 'open'),
    'containers_loading', (select count(*)::int from public.container_jobs where status = 'loading'),
    'containers_ready_for_invoice', (select count(*)::int from public.container_jobs where status = 'ready_for_invoice'),
    'containers_on_the_way', (select count(*)::int from public.container_jobs where status = 'on_the_way')
  );
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'team_list_members()', 'team_list_invites()', 'employee_activity_summary(date,date)',
    'employee_recent_activity(date,date,int,uuid)', 'management_operations_summary(date,date)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
