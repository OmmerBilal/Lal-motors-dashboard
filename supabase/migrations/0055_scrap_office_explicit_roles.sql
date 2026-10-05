-- =====================================================================================
-- 0055 — Scrap office authorization made explicit. ADDITIVE: redefines one predicate.
--
-- Before: is_scrap_office() = has_any_role('owner','engineer_admin','manager','auction').
--   The auction role reached every Scrap manager RPC (approval, payments, corrections, daily close, reports),
--   the Scrap financial and payment read policies, and Scrap media access. That was an implicit privilege granted
--   by a generic "office" list, not a designed Scrap authority.
--
-- After: owner, engineer_admin and manager only. These are the Scrap management roles in the spec. A Scrap driver
--   keeps its own evidence-only path (_scrap_require_driver, own-row policies) and never reads financial fields.
--   An auction employee keeps Auction Vehicle functions, which do not depend on this predicate.
--
-- Every caller of is_scrap_office() (_scrap_require_office, the office read policies, can_access_media and
-- check_scrap_load_status_authorization) inherits the narrower rule. Nothing else is changed.
-- =====================================================================================

create or replace function public.is_scrap_office()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role('owner', 'engineer_admin', 'manager');
$$;

comment on function public.is_scrap_office() is
  'Scrap management authority: owner, engineer_admin, manager. Not the auction role (see migration 0055).';
