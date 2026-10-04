-- =====================================================================================
-- 0017 — abandon_dismantled_part(): corrected to satisfy the parts schema.
--
-- ADDITIVE. 0016 is applied and is not edited. This re-defines abandon_dismantled_part.
--
-- Found by rpc-dismantling.mjs: a rejected part must not be operationally AVAILABLE
-- (parts_rejected_duplicate_not_sellable_chk), and a not_sellable stage needs a reason
-- (parts_not_sellable_consistency_chk). An abandoned capture never became inventory, so it is
-- marked rejected, stage not_sellable with a reason, and operational status MISSING. Nothing is
-- deleted, and the row stays as history.
-- =====================================================================================

create or replace function public.abandon_dismantled_part(p_part_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
  v_s public.dismantling_sessions%rowtype;
  v_ready int;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'dismantling');

  select * into v_part from public.parts where id = p_part_id for update;
  if not found then
    raise exception 'part not found' using errcode = '22023';
  end if;
  if v_part.dismantling_session_id is null then
    raise exception 'this part was not captured in a dismantling session' using errcode = 'P0001';
  end if;
  v_s := public._dismantling_owned_session(v_part.dismantling_session_id);

  if v_part.status = 'rejected' then
    return jsonb_build_object('part_id', v_part.id, 'status', v_part.status, 'idempotent_replay', true);
  end if;
  if v_part.status <> 'captured' then
    raise exception 'only an unreviewed capture can be abandoned' using errcode = 'P0001';
  end if;
  select count(*) into v_ready from public.media_assets
   where owner_type = 'part' and owner_id = p_part_id and variant = 'original' and status = 'ready';
  if v_ready > 0 then
    raise exception 'this capture already has a photo and cannot be abandoned' using errcode = 'P0001';
  end if;

  update public.parts
     set status = 'rejected',
         stage = 'not_sellable',
         not_sellable_reason = 'Capture abandoned before photo upload',
         not_sellable_by = auth.uid(),
         operational_status = 'MISSING'
   where id = p_part_id;

  update public.vehicle_events set status = 'abandoned', note = 'Capture abandoned before photo upload'
   where id = v_part.source_vehicle_event_id;

  perform public.write_audit_log('dismantling.part_abandon', 'part', p_part_id,
    'Part capture abandoned before photo upload', '{}'::jsonb, null, null);

  return jsonb_build_object('part_id', p_part_id, 'status', 'rejected', 'idempotent_replay', false);
end;
$$;

revoke execute on function public.abandon_dismantled_part(uuid) from public, anon;
grant execute on function public.abandon_dismantled_part(uuid) to authenticated;
