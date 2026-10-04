-- ---------------------------------------------------------------------------------------
-- 0042 — Owner Dashboard real-data read models (Module 14). ADDITIVE: new read functions only.
--
-- The dashboard visuals are frozen. These functions supply their numbers from the database:
--   owner_dashboard_summary(from, to)   stage counts, key exceptions, KPIs, notification count
--   owner_dashboard_employees(from, to) employee overview rows (actions, captured parts, scrap loads)
--   owner_dashboard_activity(from, to, limit) recent vehicle events
--
-- Owner only, as the route is (/dashboard is OWNER_ONLY). Ranges are checked here (max 366 days) and
-- filtered in SQL, so the browser never receives the full history. Stage mapping follows the same rules as
-- src/lib/mock/owner-dashboard.ts, applied to the database status values.
-- ---------------------------------------------------------------------------------------

create or replace function public._owner_dash_require(p_from date, p_to date)
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
    raise exception 'forbidden: the owner dashboard is for the owner' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'choose a date range of up to one year' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public._owner_dash_require(date, date) from public, anon, authenticated;

create or replace function public._vehicle_stage(p_status text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_status in ('Completed', 'Scrapped / Closed') then 'completed'
    when p_status in ('Ready for Processing', 'Dismantled') then 'waitingReview'
    when p_status = 'Processing' then 'processing'
    when p_status in ('Arrived', 'Available at Yard') then 'arrived'
    when p_status in ('Awaiting Dispatch', 'Assigned', 'Awaiting Pickup', 'Picked Up', 'Awaiting Transport', 'In Transit') then 'inTransit'
    else 'purchased'
  end;
$$;
revoke execute on function public._vehicle_stage(text) from public, anon, authenticated;

create or replace function public.owner_dashboard_summary(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._owner_dash_require(p_from, p_to);
  select jsonb_build_object(
    'stage_counts', (select jsonb_build_object(
        'purchased', count(*) filter (where public._vehicle_stage(status) = 'purchased'),
        'inTransit', count(*) filter (where public._vehicle_stage(status) = 'inTransit'),
        'arrived', count(*) filter (where public._vehicle_stage(status) = 'arrived'),
        'processing', count(*) filter (where public._vehicle_stage(status) = 'processing'),
        'waitingReview', count(*) filter (where public._vehicle_stage(status) = 'waitingReview'),
        'completed', count(*) filter (where public._vehicle_stage(status) = 'completed'))
      from public.vehicles),
    'exceptions', jsonb_build_array(
      jsonb_build_object('id', 'overdue', 'label', 'Vehicles over 40 days', 'severity', 'critical',
        'count', (select count(*)::int from public.vehicles v where public._vehicle_stage(v.status) <> 'completed'
                    and (current_date - v.created_at::date) >= 40)),
      jsonb_build_object('id', 'needsAttention', 'label', 'Missing evidence', 'severity', 'critical',
        'count', (select count(*)::int from public.vehicles v where cardinality(v.unverified_fields) > 0)),
      jsonb_build_object('id', 'highValue', 'label', 'High-value parts', 'severity', 'critical',
        'count', (select count(*)::int from public.vehicle_events e where e.action = 'PART_REMOVED' and e.high_value and e.disposition is null)),
      jsonb_build_object('id', 'converters', 'label', 'Unmatched converters', 'severity', 'critical',
        'count', (select count(*)::int from public.vehicle_events e where e.action = 'PART_REMOVED'
                    and lower(coalesce(e.part_type, '')) like '%converter%' and e.disposition is null)),
      jsonb_build_object('id', 'awaitingDispatch', 'label', 'Awaiting dispatch', 'severity', 'warning',
        'count', (select count(*)::int from public.vehicles v where v.status in ('Purchased', 'Awaiting Dispatch')))),
    'kpis', jsonb_build_object(
      'total_vehicles', (select count(*)::int from public.vehicles),
      'parts_pulled', (select count(*)::int from public.vehicle_events e
                        where e.action = 'PART_REMOVED' and (e.created_at at time zone 'America/New_York')::date between p_from and p_to),
      'converters', (select count(*)::int from public.vehicle_events e
                      where e.action = 'PART_REMOVED' and lower(coalesce(e.part_type, '')) like '%converter%'
                        and (e.created_at at time zone 'America/New_York')::date between p_from and p_to),
      'containers_shipped', (select count(*)::int from public.container_jobs where status in ('on_the_way', 'closed')),
      'scrap_loads', (select count(*)::int from public.scrap_loads where load_date between p_from and p_to),
      'scrap_loads_today', (select count(*)::int from public.scrap_loads where load_date = public._scrap_business_date())),
    'notification_count', (select count(*)::int from public.vehicles v where public._vehicle_stage(v.status) = 'waitingReview')
                          + (select count(*)::int from public.scrap_discrepancies d where d.status = 'open')
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.owner_dashboard_employees(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._owner_dash_require(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'profile_id', x.id, 'name', x.name, 'role', x.role,
             'actions', x.actions, 'captured', x.captured, 'loads', x.loads)
             order by x.name)
      from (
        select p.id, p.name,
               coalesce((select string_agg(r.key, ', ' order by r.key) from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.id), '') as role,
               (select count(*)::int from public.vehicle_events e where e.actor_id = p.id
                  and (e.created_at at time zone 'America/New_York')::date between p_from and p_to) as actions,
               (select count(*)::int from public.parts pt where pt.captured_by = p.id) as captured,
               (select count(*)::int from public.scrap_loads sl where sl.driver_id = p.id
                  and sl.load_date between p_from and p_to) as loads
          from public.profiles p
         where p.account_status = 'active'
           and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.id and r.key = 'owner')
      ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.owner_dashboard_activity(p_from date, p_to date, p_limit int default 8)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._owner_dash_require(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'action', e.action, 'actor_name', e.actor_name, 'created_at', e.created_at,
             'vehicle_id', e.vehicle_id, 'part_type', e.part_type, 'note', e.note,
             'vehicle_title', trim(coalesce(v.year::text, '') || ' ' || coalesce(v.make, '') || ' ' || coalesce(v.model, '')))
             order by e.created_at desc)
      from (select * from public.vehicle_events
             where (created_at at time zone 'America/New_York')::date between p_from and p_to
             order by created_at desc limit least(greatest(coalesce(p_limit, 8), 1), 25)) e
      left join public.vehicles v on v.id = e.vehicle_id
  ), '[]'::jsonb);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array['owner_dashboard_summary(date,date)', 'owner_dashboard_employees(date,date)', 'owner_dashboard_activity(date,date,int)'] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
