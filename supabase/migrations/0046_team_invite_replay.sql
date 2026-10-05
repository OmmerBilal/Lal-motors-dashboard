-- ---------------------------------------------------------------------------------------
-- 0046 — Invitation replay: team_invite_member stores the request id (replaces the 0044 definition). ADDITIVE.
-- ---------------------------------------------------------------------------------------
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
  insert into public.user_invites (email, name, role_id, status, invited_by, client_request_id)
  values (v_email, v_name, v_role, 'pending', auth.uid(), p_client_request_id)
  returning id into v_id;
  perform public.write_audit_log('team.invite.created', 'user_invite', v_id,
    'Invitation recorded for ' || v_name, jsonb_build_object('role', p_role_key), null, p_client_request_id);
  return jsonb_build_object('id', v_id, 'email_delivery', 'not_connected', 'replay', false);
end;
$$;
