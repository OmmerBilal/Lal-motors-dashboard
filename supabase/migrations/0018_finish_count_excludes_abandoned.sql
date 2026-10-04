-- =====================================================================================
-- 0018 — finish_dismantling_session(): part count excludes abandoned captures.
--
-- ADDITIVE. 0016 is applied and not edited. Found by rpc-dismantling.mjs: the completed session
-- counted rejected (abandoned) capture rows as captured parts. Only real captures are counted now.
-- Everything else in the function is unchanged from 0016.
-- =====================================================================================

create or replace function public.finish_dismantling_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.dismantling_sessions%rowtype;
  v_evidence int;
  v_parts int;
  v_missing int;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'dismantling');

  select * into v_s from public.dismantling_sessions where id = p_session_id for update;
  if not found then
    raise exception 'dismantling session not found' using errcode = '22023';
  end if;
  if v_s.employee_id <> auth.uid() then
    raise exception 'only the employee who started this session can finish it' using errcode = '42501', hint = 'NOT_SESSION_OWNER';
  end if;

  -- Retry: an already completed session returns its result.
  if v_s.status = 'completed' then
    return jsonb_build_object('session_id', v_s.id, 'status', 'completed', 'part_photos_captured', v_s.part_photos_captured, 'idempotent_replay', true);
  end if;
  if v_s.status <> 'active' or v_s.ended_at is not null then
    raise exception 'this session is not active' using errcode = 'P0001', hint = 'SESSION_NOT_ACTIVE';
  end if;

  select count(*) into v_evidence from public.media_assets
   where owner_type = 'dismantling_session' and owner_id = p_session_id and variant = 'original' and status = 'ready';
  if v_evidence < 1 then
    raise exception 'add at least one vehicle evidence photo before finishing' using errcode = 'P0001', hint = 'NO_EVIDENCE';
  end if;

  -- Abandoned captures (rejected) are history, not captured parts.
  select count(*) into v_parts from public.parts where dismantling_session_id = p_session_id and status <> 'rejected';
  select count(*) into v_missing from public.parts p
   where p.dismantling_session_id = p_session_id
     and p.status = 'captured'
     and not exists (select 1 from public.media_assets m
                      where m.owner_type = 'part' and m.owner_id = p.id and m.variant = 'original' and m.status = 'ready');
  if v_missing > 0 then
    raise exception '% captured part(s) still need a photo: retry the upload or abandon the capture', v_missing
      using errcode = 'P0001', hint = 'PART_WITHOUT_PHOTO';
  end if;

  update public.dismantling_sessions
     set status = 'completed', ended_at = now(), part_photos_captured = v_parts
   where id = p_session_id;

  update public.vehicles set status = 'Dismantled', updated_by = auth.uid() where id = v_s.vehicle_id;

  insert into public.vehicle_events (vehicle_id, action, status, actor_id, actor_name, dismantling_session_id, note)
  values (v_s.vehicle_id, 'DISMANTLING_COMPLETED', 'Dismantled', auth.uid(), public._dismantling_actor_name(), p_session_id,
          v_parts || ' part(s) captured');

  perform public.write_audit_log('dismantling.finish', 'dismantling_session', p_session_id,
    'Dismantling session completed', jsonb_build_object('parts', v_parts, 'vehicle_id', v_s.vehicle_id), null, null);

  return jsonb_build_object('session_id', p_session_id, 'status', 'completed', 'part_photos_captured', v_parts, 'idempotent_replay', false);
end;
$$;

revoke execute on function public.finish_dismantling_session(uuid) from public, anon;
grant execute on function public.finish_dismantling_session(uuid) to authenticated;
