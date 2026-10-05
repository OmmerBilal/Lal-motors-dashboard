-- =====================================================================================
-- 0054 — Employee counts for Vehicle Dismantling Processing (Module 05). ADDITIVE: one read function.
--
-- One row per employee for a period: vehicles completed, parts captured, parts approved, parts still waiting for
-- review. Computed in the database, so the browser never downloads a year of part rows to count them.
-- Owner, engineer_admin and manager only. Read-only.
-- =====================================================================================

create or replace function public.dismantling_employee_counts(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_any_role('owner', 'engineer_admin', 'manager') then
    raise exception 'only a manager can see employee counts' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'choose a valid period' using errcode = '22023';
  end if;
  if p_to - p_from > interval '400 days' then
    raise exception 'choose a period of 400 days or less' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.name)
      from (
        select p.captured_by as employee_id,
               coalesce(pr.name, 'Unknown') as name,
               count(*)::int as parts_captured,
               count(*) filter (where p.status = 'approved')::int as parts_approved,
               count(*) filter (where p.status in ('captured', 'draft_ready', 'manager_review'))::int as parts_pending_review,
               (
                 select count(distinct s.vehicle_id)::int
                   from public.dismantling_sessions s
                  where s.employee_id = p.captured_by
                    and s.ended_at is not null
                    and s.ended_at >= p_from and s.ended_at < p_to
               ) as vehicles_completed
          from public.parts p
          left join public.profiles pr on pr.id = p.captured_by
         where p.dismantling_session_id is not null
           and p.captured_by is not null
           and p.created_at >= p_from and p.created_at < p_to
         group by p.captured_by, pr.name
      ) x
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.dismantling_employee_counts(timestamptz, timestamptz) from public, anon;
grant execute on function public.dismantling_employee_counts(timestamptz, timestamptz) to authenticated;
