-- =====================================================================================
-- 0012 — Central Dispatch: (1) carrier directory writes limited to dispatch roles,
--        (2) dispatch KPI counts that match computeDispatchStats() in the approved UI.
--
-- ADDITIVE. 0001 policies are not edited here; carriers_domain_write is replaced by a
-- narrower policy in THIS migration. Reads stay with vehicle domain staff.
--
-- Why (1): 0001 let every vehicle-domain role (Receiving and Dismantling included) insert and
-- update carriers. The brief forbids Receiving and Dismantling from changing dispatch and
-- carrier data, so writes move to owner, engineer_admin, manager and auction.
-- =====================================================================================

drop policy if exists carriers_domain_write on public.carriers;

create policy carriers_dispatch_write on public.carriers
  for all
  using (public.has_any_role('owner', 'engineer_admin', 'manager', 'auction'))
  with check (public.has_any_role('owner', 'engineer_admin', 'manager', 'auction'));

-- Dispatch KPI cards. Open means closed_reason is null, matching computeDispatchStats().
create or replace function public.dispatch_stage_counts()
returns table (need_transport bigint, posted_to_cd bigint, assigned bigint, in_transit bigint,
               arrived bigint, overdue bigint, problems bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where v.closed_reason is null and v.transport_status = 'NEED_TRANSPORT'),
    count(*) filter (where v.closed_reason is null and v.transport_status = 'POSTED_TO_CD'),
    count(*) filter (where v.closed_reason is null and v.transport_status = 'ASSIGNED'),
    count(*) filter (where v.closed_reason is null and v.transport_status = 'IN_TRANSIT'),
    count(*) filter (where v.closed_reason is null and v.transport_status = 'ARRIVED'),
    count(*) filter (where v.closed_reason is null
                       and v.transport_status not in ('ARRIVED', 'PROBLEM')
                       and (current_date - v.purchase_date) >= 10),
    count(*) filter (where v.closed_reason is null and v.transport_status = 'PROBLEM')
  from public.vehicles v;
$$;

revoke execute on function public.dispatch_stage_counts() from public, anon;
grant execute on function public.dispatch_stage_counts() to authenticated;
