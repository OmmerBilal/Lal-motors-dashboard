-- ---------------------------------------------------------------------------------------
-- 0077 — Admin-created accounts: forced password change on first login. ADDITIVE.
--
-- Replaces invite-by-email with owner-created accounts: the owner types a name, email,
-- temporary password and role for a new employee (src/app/api/team/create-user), the Auth
-- Admin API creates the auth.users row directly (email_confirm: true, no email sent), and
-- the new account is marked must_change_password = true. The employee signs in with that
-- password and is forced to set their own before reaching any app screen.
--
-- Existing accounts are explicitly NOT affected: backfilled to false below, and nothing in
-- this file or team_invite_member's removal changes an existing row's flag.
-- ---------------------------------------------------------------------------------------

alter table public.profiles add column must_change_password boolean not null default false;

-- Backfill: every row that existed before this migration is explicitly false. (The column
-- default already makes this true for all current rows; the explicit UPDATE documents that
-- as a verified fact of this migration, not an assumption, per guide §15 rule 10.)
update public.profiles set must_change_password = false where must_change_password is distinct from false;

comment on column public.profiles.must_change_password is
  'True only for an account the owner just created with a temporary password '
  '(src/app/api/team/create-user/route.ts). Cleared by clear_must_change_password() the '
  'moment the user sets their own password on first login. Never set for an existing account.';

-- Caller clears ONLY their own flag, after auth.updateUser() has already changed their
-- password client-side. This is the sole write path to the column: profiles_owner_write
-- (0001) requires is_owner() for any other update to profiles, and no policy lets a non-
-- owner write their own row's must_change_password directly.
create or replace function public.clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  update public.profiles set must_change_password = false, updated_at = now()
    where id = auth.uid() and must_change_password = true;
end;
$$;
comment on function public.clear_must_change_password() is
  'Caller clears their own must_change_password flag after changing their password. No arguments: always auth.uid().';

revoke execute on function public.clear_must_change_password() from public, anon;
grant execute on function public.clear_must_change_password() to authenticated;
