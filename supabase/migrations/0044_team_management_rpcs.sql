-- ---------------------------------------------------------------------------------------
-- 0044 — Team management RPCs and the employee day view (Module 15). ADDITIVE.
--
-- The team page previously changed roles, status and invites in browser state only, with success messages
-- that were not true. These owner-only RPCs make each change real, server-validated and audited:
--   team_set_role            single role per account (the app's model), no owner grants or demotions
--   team_set_account_status  active / disabled (disabled accounts lose access: has_role requires an active account)
--   team_remove_member       account marked removed (history is kept, never deleted)
--   team_invite_member       pending invite row (email delivery is NOT CONNECTED: no mail is sent here)
--   team_cancel_invite       pending invite -> cancelled
--   employee_day_activity    one employee's captured parts and recorded actions for one day (bounded)
--
-- Rules enforced here, not in the UI: the owner cannot change, disable or remove themselves; no owner is
-- changed or demoted through this API; no role "owner" can be granted through this API.
-- ---------------------------------------------------------------------------------------

create or replace function public._team_role_id(p_key text)
returns smallint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id smallint;
begin
  select id into v_id from public.roles where key = p_key;
  if v_id is null then
    raise exception 'unknown role' using errcode = '22023';
  end if;
  return v_id;
end;
$$;
revoke execute on function public._team_role_id(text) from public, anon, authenticated;

create or replace function public._team_check_target(p_profile uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_profile = auth.uid() then
    raise exception 'you cannot change your own account here' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'account not found' using errcode = '22023';
  end if;
  if public.has_role_on(p_profile, 'owner') then
    raise exception 'an owner account cannot be changed here' using errcode = '42501';
  end if;
  select account_status into v_status from public.profiles where id = p_profile;
  return v_status;
end;
$$;
revoke execute on function public._team_check_target(uuid) from public, anon, authenticated;

-- has_role_on: does a given profile hold a role (the existing has_role() only checks the caller).
create or replace function public.has_role_on(p_profile uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                  where ur.user_id = p_profile and r.key = p_key);
$$;
revoke execute on function public.has_role_on(uuid, text) from public, anon, authenticated;


-- Owner-only guard used by the team RPCs.
create or replace function public._team_require_owner_write()
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
    raise exception 'forbidden: only the owner manages accounts' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public._team_require_owner_write() from public, anon, authenticated;

create or replace function public.team_set_role(p_profile uuid, p_role_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role smallint;
  v_before text;
  v_name text;
begin
  perform public._team_require_owner_write();
  perform public._team_check_target(p_profile);
  if p_role_key = 'owner' then
    raise exception 'the owner role cannot be granted here' using errcode = '42501';
  end if;
  v_role := public._team_role_id(p_role_key);
  select string_agg(r.key, ',') into v_before
    from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_profile;
  if v_before = p_role_key then
    return jsonb_build_object('id', p_profile, 'roles', jsonb_build_array(p_role_key), 'changed', false);
  end if;
  delete from public.user_roles where user_id = p_profile;
  insert into public.user_roles (user_id, role_id, assigned_by) values (p_profile, v_role, auth.uid());
  select name into v_name from public.profiles where id = p_profile;
  perform public.write_audit_log('team.role.changed', 'profile', p_profile,
    'Role changed for ' || v_name, jsonb_build_object('from', v_before, 'to', p_role_key), null, null);
  return jsonb_build_object('id', p_profile, 'roles', jsonb_build_array(p_role_key), 'changed', true);
end;
$$;

create or replace function public.team_set_account_status(p_profile uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before text;
  v_name text;
begin
  perform public._team_require_owner_write();
  if p_status not in ('active', 'disabled') then
    raise exception 'status must be active or disabled' using errcode = '22023';
  end if;
  v_before := public._team_check_target(p_profile);
  if v_before = 'removed' then
    raise exception 'a removed account cannot be re-enabled here' using errcode = 'P0001';
  end if;
  if v_before = p_status then
    return jsonb_build_object('id', p_profile, 'account_status', p_status, 'changed', false);
  end if;
  update public.profiles set account_status = p_status, updated_at = now() where id = p_profile;
  select name into v_name from public.profiles where id = p_profile;
  perform public.write_audit_log('team.account_status.changed', 'profile', p_profile,
    v_name || ' is now ' || p_status, jsonb_build_object('from', v_before, 'to', p_status), null, null);
  return jsonb_build_object('id', p_profile, 'account_status', p_status, 'changed', true);
end;
$$;

create or replace function public.team_remove_member(p_profile uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before text;
  v_name text;
begin
  perform public._team_require_owner_write();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'removing an account needs a reason of at least 5 characters' using errcode = '22023';
  end if;
  v_before := public._team_check_target(p_profile);
  if v_before = 'removed' then
    return jsonb_build_object('id', p_profile, 'account_status', 'removed', 'changed', false);
  end if;
  update public.profiles set account_status = 'removed', updated_at = now() where id = p_profile;
  select name into v_name from public.profiles where id = p_profile;
  perform public.write_audit_log('team.member.removed', 'profile', p_profile,
    v_name || ' removed from the team', jsonb_build_object('from', v_before), btrim(p_reason), null);
  return jsonb_build_object('id', p_profile, 'account_status', 'removed', 'changed', true);
end;
$$;

-- Invite: records a pending invitation. No email is sent by this function (delivery is NOT CONNECTED).
create or replace function public.team_invite_member(p_email text, p_name text, p_role_key text, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_role smallint;
  v_id uuid;
begin
  perform public._team_require_owner_write();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'enter a valid email address' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'enter the person''s name' using errcode = '22023';
  end if;
  if p_role_key = 'owner' then
    raise exception 'the owner role cannot be invited' using errcode = '42501';
  end if;
  v_role := public._team_role_id(p_role_key);
  select id into v_id from public.user_invites where client_request_id = p_client_request_id;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'email_delivery', 'not_connected', 'replay', true);
  end if;
  if exists (select 1 from public.profiles where lower(email::text) = v_email) then
    raise exception 'an account already exists for that email' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_invites where lower(email::text) = v_email and status = 'pending') then
    raise exception 'an invitation is already pending for that email' using errcode = '22023';
  end if;
  insert into public.user_invites (email, name, role_id, status, invited_by)
  values (v_email, v_name, v_role, 'pending', auth.uid())
  returning id into v_id;
  perform public.write_audit_log('team.invite.created', 'user_invite', v_id,
    'Invitation recorded for ' || v_name, jsonb_build_object('role', p_role_key), null, p_client_request_id);
  return jsonb_build_object('id', v_id, 'email_delivery', 'not_connected', 'replay', false);
end;
$$;

create or replace function public.team_cancel_invite(p_invite uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public._team_require_owner_write();
  select status into v_status from public.user_invites where id = p_invite for update;
  if not found then
    raise exception 'invitation not found' using errcode = '22023';
  end if;
  if v_status = 'cancelled' then
    return jsonb_build_object('id', p_invite, 'status', 'cancelled', 'changed', false);
  end if;
  if v_status <> 'pending' then
    raise exception 'only a pending invitation can be cancelled' using errcode = 'P0001';
  end if;
  update public.user_invites set status = 'cancelled' where id = p_invite;
  perform public.write_audit_log('team.invite.cancelled', 'user_invite', p_invite, 'Invitation cancelled', '{}'::jsonb, null, null);
  return jsonb_build_object('id', p_invite, 'status', 'cancelled', 'changed', true);
end;
$$;

-- One employee's day: parts they captured and the vehicle actions they recorded. Bounded; owner only.
create or replace function public.employee_day_activity(p_profile uuid, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._team_require_owner_write();
  if p_date is null or p_date > public._scrap_business_date() then
    raise exception 'choose a day that has started' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'parts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'part_name', x.part_name, 'status', x.status,
                             'created_at', x.created_at, 'vehicle_id', x.vehicle_id) order by x.created_at desc)
                         from (select pt.id, pt.part_name, pt.status, pt.created_at, pt.vehicle_id from public.parts pt
                                where pt.captured_by = p_profile
                                  and (pt.created_at at time zone 'America/New_York')::date = p_date
                                order by pt.created_at desc limit 200) x), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'action', e.action, 'created_at', e.created_at,
                             'vehicle_id', e.vehicle_id) order by e.created_at desc)
                           from (select ve.id, ve.action, ve.created_at, ve.vehicle_id from public.vehicle_events ve
                                  where ve.actor_id = p_profile
                                    and (ve.created_at at time zone 'America/New_York')::date = p_date
                                  order by ve.created_at desc limit 200) e), '[]'::jsonb)
  );
end;
$$;


do $$
declare
  fn text;
begin
  foreach fn in array array[
    'team_set_role(uuid,text)', 'team_set_account_status(uuid,text)', 'team_remove_member(uuid,text)',
    'team_invite_member(text,text,text,uuid)', 'team_cancel_invite(uuid)', 'employee_day_activity(uuid,date)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
