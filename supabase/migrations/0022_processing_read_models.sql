-- =====================================================================================
-- 0022 — Read models for the manager dismantling screens: completed sessions, the dismantling
--        roster, and employee-safe names. ADDITIVE; 0001–0021 are not edited.
--
-- Managers cannot read other staff profiles directly (profiles RLS is owner/engineer only),
-- so names are returned by these functions. Each function checks the caller's role itself
-- (owner, engineer_admin, manager) and reads only what that screen shows.
-- =====================================================================================

create or replace function public.list_dismantling_completions(p_from timestamptz, p_to timestamptz)
returns table (
  session_id uuid, vehicle_id uuid, vehicle_label text, vin text,
  employee_id uuid, employee_name text, started_at timestamptz, completed_at timestamptz,
  parts_count bigint, pending_review_count bigint, approved_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  return query
    select s.id, s.vehicle_id,
           concat_ws(' ', v.year::text, v.make, v.model),
           v.vin,
           s.employee_id,
           coalesce(pr.name, 'Unknown employee'),
           s.started_at,
           s.ended_at,
           count(p.id) filter (where p.status <> 'rejected'),
           count(p.id) filter (where p.status in ('captured', 'draft_ready', 'manager_review')),
           count(p.id) filter (where p.status = 'approved')
      from public.dismantling_sessions s
      join public.vehicles v on v.id = s.vehicle_id
      left join public.profiles pr on pr.id = s.employee_id
      left join public.parts p on p.dismantling_session_id = s.id
     where s.status = 'completed'
       and s.ended_at >= p_from and s.ended_at < p_to
     group by s.id, v.id, pr.name
     order by s.ended_at desc;
end;
$$;

create or replace function public.list_dismantling_roster()
returns table (employee_id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  return query
    select distinct pr.id, pr.name
      from public.profiles pr
      join public.user_roles ur on ur.user_id = pr.id
      join public.roles r on r.id = ur.role_id
     where r.key = 'dismantling' and pr.account_status = 'active'
     order by pr.name;
end;
$$;

revoke execute on function public.list_dismantling_completions(timestamptz, timestamptz) from public, anon;
grant execute on function public.list_dismantling_completions(timestamptz, timestamptz) to authenticated;
revoke execute on function public.list_dismantling_roster() from public, anon;
grant execute on function public.list_dismantling_roster() to authenticated;
