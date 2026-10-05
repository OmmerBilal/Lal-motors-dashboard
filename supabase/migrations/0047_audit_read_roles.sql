-- ---------------------------------------------------------------------------------------
-- 0047 — Audit read access (Module 15). ADDITIVE: replaces one read function.
-- /audit is an engineer_admin route (src/lib/auth/route-access.ts); the owner is always allowed.
-- employee_recent_activity was owner-only in 0043, so it now allows owner and engineer_admin. Nothing else changes.
-- ---------------------------------------------------------------------------------------
create or replace function public.employee_recent_activity(p_from date, p_to date, p_limit int default 25, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.has_any_role('owner', 'engineer_admin') then
    raise exception 'forbidden: the audit trail is for the owner and engineer admin' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'choose a date range of up to one year' using errcode = '22023';
  end if;
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
revoke execute on function public.employee_recent_activity(date, date, int, uuid) from public, anon;
grant execute on function public.employee_recent_activity(date, date, int, uuid) to authenticated;
