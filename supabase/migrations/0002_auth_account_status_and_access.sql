-- =====================================================================================
-- 0002 — Auth hardening: enforce account_status in every RBAC predicate, add a
-- current_access() read RPC for the server-side route guard.
--
-- ADDITIVE migration. 0001_initial_schema.sql is already applied to DEV and is NOT edited.
-- CREATE OR REPLACE keeps the existing EXECUTE grants on has_role / has_any_role; the
-- explicit revokes/grants below restate the intended privilege for the new objects.
--
-- Why: profiles.account_status ('active' | 'disabled' | 'removed') existed in 0001 but no
-- predicate read it, so a disabled employee with a still-valid Supabase session kept full
-- RLS access to every domain they held a role for. Because every domain helper
-- (is_admin, is_owner, is_vehicle_domain_staff, is_sales_staff, ...) is built on
-- has_role / has_any_role, enforcing it here closes the gap for the whole schema at once.
-- =====================================================================================

-- 1. Active-account predicate. auth.uid() null (anon, service_role, seed/migration) -> false.
create or replace function public.is_active_account()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'active'
  );
$$;
comment on function public.is_active_account() is
  'True only when the current auth user has a profile whose account_status is active. Disabled or removed accounts fail every RBAC predicate.';

-- 2. has_role / has_any_role now require an active account.
create or replace function public.has_role(role_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.key = role_key
  )
  and public.is_active_account();
$$;
comment on function public.has_role(text) is
  'True if the current auth user holds the given role key AND the account is active.';

create or replace function public.has_any_role(variadic role_keys text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.key = any(role_keys)
  )
  and public.is_active_account();
$$;
comment on function public.has_any_role(text[]) is
  'True if the current auth user holds any of the given role keys AND the account is active.';

-- 3. current_access(): the caller's own account status and role keys, for the navigation /
-- route guard. Reads only the caller's own rows (auth.uid()), so it leaks nothing about
-- other people. It is a navigation hint only: every data access still goes through RLS.
create or replace function public.current_access()
returns table (account_status text, role_keys text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    p.account_status,
    coalesce(
      (
        select array_agg(r.key order by r.key)
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = p.id
      ),
      '{}'::text[]
    ) as role_keys
  from public.profiles p
  where p.id = auth.uid();
$$;
comment on function public.current_access() is
  'Caller''s own account_status and role keys. Empty result when there is no profile. Used by the route guard only; not an authorization decision for data.';

-- 4. Privileges. Client-facing: authenticated only. Never anon / bare PUBLIC.
revoke execute on function public.is_active_account() from public, anon;
grant  execute on function public.is_active_account() to authenticated;

revoke execute on function public.current_access() from public, anon;
grant  execute on function public.current_access() to authenticated;

-- has_role / has_any_role keep their 0001 grants (authenticated only, PUBLIC/anon revoked).
-- Re-assert them so this file is self-describing about the intended end state.
revoke execute on function public.has_role(text) from public, anon;
grant  execute on function public.has_role(text) to authenticated;
revoke execute on function public.has_any_role(text[]) from public, anon;
grant  execute on function public.has_any_role(text[]) to authenticated;
