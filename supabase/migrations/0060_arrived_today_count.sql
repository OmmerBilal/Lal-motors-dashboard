-- =====================================================================================
-- 0060 — Receiving "Arrived Today" count. ADDITIVE: one new read function.
--
-- The Receiving KPI used the inbound list, which only holds vehicles not yet received (dispatch_inbound_vehicles,
-- 0052). A received vehicle leaves that list at once, so the count could never rise. This counts vehicles received
-- today by received_at, in UTC, the same day boundary the screen uses. SECURITY INVOKER: the vehicles RLS decides
-- what the caller can count. Grants are limited to authenticated, as for the other read functions.
-- =====================================================================================

create or replace function public.vehicles_arrived_today_count()
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)
    from public.vehicles v
   where v.received_at is not null
     and (v.received_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date;
$$;

revoke execute on function public.vehicles_arrived_today_count() from public, anon;
grant execute on function public.vehicles_arrived_today_count() to authenticated;
