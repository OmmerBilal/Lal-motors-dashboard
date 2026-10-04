-- =====================================================================================
-- 0019 — Dismantling processing: review actions on the SAME part row, plus the review queue
--        and dashboard read models.
--
-- ADDITIVE. 0001–0018 are not edited.
--
-- Review actions (reviewers only: owner, engineer_admin, manager):
--   approve_dismantled_part   captured -> approved (stage needs_processing). Idempotent.
--   edit_and_approve_part     same, plus processing fields set by the reviewer. Idempotent.
--   reject_dismantled_part    -> rejected, not_sellable, with a reason. Stays as history.
--   mark_part_duplicate       -> duplicate of an approved part, not_sellable. Stays as history.
--   keep_part_for_review      captured -> manager_review. Leaves the decision open.
--
-- Invariants:
--   * one parts row per physical part; a review never creates a second row.
--   * approving twice returns the same result; it never creates a second part.
--   * rejected and duplicate parts are never sellable (schema CHECKs, operational status MISSING).
--   * a part needs a ready photo before it can be approved.
--   * every decision writes a vehicle event (history) and one audit row.
--
-- Read models (role-checked inside the function, SECURITY DEFINER with a fixed search_path):
--   list_dismantling_review_queue   keyset list, one thumbnail join, no N+1
--   dismantling_processing_summary  one grouped read for the dashboard cards and employee activity
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- 1. Shared guards
-- ---------------------------------------------------------------------------------------
create or replace function public._review_load_part(p_part_id uuid)
returns public.parts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  select * into v_part from public.parts where id = p_part_id for update;
  if not found then
    raise exception 'part not found' using errcode = '22023';
  end if;
  if v_part.dismantling_session_id is null then
    raise exception 'this part was not captured in a dismantling session' using errcode = 'P0001';
  end if;
  return v_part;
end;
$$;

create or replace function public._review_has_ready_photo(p_part_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.media_assets m
     where m.owner_type = 'part' and m.owner_id = p_part_id
       and m.variant = 'original' and m.status = 'ready'
  );
$$;

create or replace function public._review_event(p_part public.parts, p_action text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vehicle_events (vehicle_id, action, part_ref, status, note, actor_id, actor_name, dismantling_session_id)
  values (p_part.vehicle_id, p_action, p_part.id, p_part.status, p_note, auth.uid(),
          coalesce((select name from public.profiles where id = auth.uid()), 'unknown'),
          p_part.dismantling_session_id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. approve / edit-and-approve
-- ---------------------------------------------------------------------------------------
create or replace function public._review_approve(p_part_id uuid, p_fields jsonb, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
  v_key text;
  v_price numeric;
  v_core numeric;
begin
  v_part := public._review_load_part(p_part_id);

  if v_part.status = 'approved' then
    if p_fields is not null and p_fields <> '{}'::jsonb then
      raise exception 'this part is already approved; change processing details in Parts Inventory' using errcode = 'P0001', hint = 'ALREADY_APPROVED';
    end if;
    return jsonb_build_object('part_id', v_part.id, 'status', 'approved', 'stage', v_part.stage, 'idempotent_replay', true);
  end if;
  if v_part.status in ('rejected', 'duplicate') then
    raise exception 'this part was already % and cannot be approved', v_part.status using errcode = 'P0001', hint = 'TERMINAL_STATE';
  end if;
  if not public._review_has_ready_photo(p_part_id) then
    raise exception 'this capture has no uploaded photo yet' using errcode = 'P0001', hint = 'PART_WITHOUT_PHOTO';
  end if;

  -- Optional processing fields (only for edit-and-approve). Anything else is refused.
  if p_fields is not null then
    for v_key in select jsonb_object_keys(p_fields) loop
      if v_key not in ('part_name', 'category', 'condition', 'test_status', 'location', 'zone', 'rack', 'shelf', 'bin',
                       'price', 'core_charge', 'has_core_charge', 'stock_sku') then
        raise exception 'field % cannot be set during review', v_key using errcode = '22023';
      end if;
    end loop;
    if p_fields ? 'price' then
      v_price := (p_fields->>'price')::numeric;
      if v_price < 0 or v_price <> round(v_price, 2) then
        raise exception 'price must be zero or positive with at most 2 decimals' using errcode = '22023';
      end if;
    end if;
    if p_fields ? 'core_charge' and (p_fields->>'core_charge') <> '' then
      v_core := (p_fields->>'core_charge')::numeric;
      if v_core < 0 or v_core <> round(v_core, 2) then
        raise exception 'core charge must be zero or positive with at most 2 decimals' using errcode = '22023';
      end if;
    end if;
    if p_fields ? 'test_status' and (p_fields->>'test_status') not in ('Not Tested', 'Tested', 'Failed') then
      raise exception 'test status must be Not Tested, Tested or Failed' using errcode = '22023';
    end if;
    if p_fields ? 'part_name' and char_length(btrim(p_fields->>'part_name')) = 0 then
      raise exception 'part name cannot be empty' using errcode = '22023';
    end if;
  end if;

  update public.parts
     set status = 'approved',
         stage = 'needs_processing',
         operational_status = 'AVAILABLE',
         quantity = 1,
         approved_by = auth.uid(),
         approved_at = now(),
         part_name = coalesce(nullif(btrim(p_fields->>'part_name'), ''), part_name),
         category = coalesce(p_fields->>'category', category),
         condition = coalesce(p_fields->>'condition', condition),
         test_status = coalesce(p_fields->>'test_status', test_status),
         location = coalesce(p_fields->>'location', location),
         zone = coalesce(p_fields->>'zone', zone),
         rack = coalesce(p_fields->>'rack', rack),
         shelf = coalesce(p_fields->>'shelf', shelf),
         bin = coalesce(p_fields->>'bin', bin),
         price = coalesce(nullif(p_fields->>'price', '')::numeric, price),
         core_charge = coalesce(nullif(p_fields->>'core_charge', '')::numeric, core_charge),
         has_core_charge = coalesce((p_fields->>'has_core_charge')::boolean, has_core_charge),
         stock_sku = coalesce(p_fields->>'stock_sku', stock_sku)
   where id = p_part_id
   returning * into v_part;

  perform public._review_event(v_part, p_action, case when p_action = 'REVIEW_EDITED_APPROVED' then 'Approved after edit' else 'Approved' end);
  perform public.write_audit_log(
    case when p_action = 'REVIEW_EDITED_APPROVED' then 'part.edit_and_approve' else 'part.approve' end,
    'part', p_part_id,
    'Dismantled part approved', jsonb_build_object('fields', coalesce(p_fields, '{}'::jsonb)), null, null);

  return jsonb_build_object('part_id', v_part.id, 'status', 'approved', 'stage', v_part.stage, 'idempotent_replay', false);
end;
$$;

create or replace function public.approve_dismantled_part(p_part_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public._review_approve(p_part_id, '{}'::jsonb, 'REVIEW_APPROVED');
$$;

create or replace function public.edit_and_approve_part(p_part_id uuid, p_fields jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public._review_approve(p_part_id, coalesce(p_fields, '{}'::jsonb), 'REVIEW_EDITED_APPROVED');
$$;

-- ---------------------------------------------------------------------------------------
-- 3. reject / duplicate / keep for review
-- ---------------------------------------------------------------------------------------
create or replace function public.reject_dismantled_part(p_part_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
begin
  v_part := public._review_load_part(p_part_id);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a reason of at least 5 characters is required' using errcode = '22023';
  end if;
  if v_part.status = 'rejected' then
    return jsonb_build_object('part_id', v_part.id, 'status', 'rejected', 'idempotent_replay', true);
  end if;
  if v_part.status in ('approved', 'duplicate') then
    raise exception 'this part was already % and cannot be rejected', v_part.status using errcode = 'P0001', hint = 'TERMINAL_STATE';
  end if;

  update public.parts
     set status = 'rejected', stage = 'not_sellable', not_sellable_reason = btrim(p_reason),
         not_sellable_by = auth.uid(), operational_status = 'MISSING'
   where id = p_part_id
   returning * into v_part;

  perform public._review_event(v_part, 'REVIEW_REJECTED', btrim(p_reason));
  perform public.write_audit_log('part.reject', 'part', p_part_id, 'Dismantled part rejected (not inventory)',
    jsonb_build_object('reason', btrim(p_reason)), btrim(p_reason), null);
  return jsonb_build_object('part_id', v_part.id, 'status', 'rejected', 'idempotent_replay', false);
end;
$$;

create or replace function public.mark_part_duplicate(p_part_id uuid, p_duplicate_of uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
  v_target public.parts%rowtype;
begin
  v_part := public._review_load_part(p_part_id);
  if p_duplicate_of is null or p_duplicate_of = p_part_id then
    raise exception 'choose the approved part this duplicates' using errcode = '22023';
  end if;
  select * into v_target from public.parts where id = p_duplicate_of;
  if not found or v_target.status <> 'approved' then
    raise exception 'the part this duplicates must be an approved part' using errcode = 'P0001', hint = 'TARGET_NOT_APPROVED';
  end if;
  if v_part.status = 'duplicate' then
    return jsonb_build_object('part_id', v_part.id, 'status', 'duplicate', 'duplicate_of', v_part.duplicate_of_part_id, 'idempotent_replay', true);
  end if;
  if v_part.status in ('approved', 'rejected') then
    raise exception 'this part was already % and cannot be marked duplicate', v_part.status using errcode = 'P0001', hint = 'TERMINAL_STATE';
  end if;

  update public.parts
     set status = 'duplicate', duplicate_of_part_id = p_duplicate_of, stage = 'not_sellable',
         not_sellable_reason = 'Duplicate of an approved part', not_sellable_by = auth.uid(),
         operational_status = 'MISSING'
   where id = p_part_id
   returning * into v_part;

  perform public._review_event(v_part, 'REVIEW_MARKED_DUPLICATE', 'Duplicate of ' || p_duplicate_of::text);
  perform public.write_audit_log('part.mark_duplicate', 'part', p_part_id, 'Dismantled part marked duplicate',
    jsonb_build_object('duplicate_of', p_duplicate_of), null, null);
  return jsonb_build_object('part_id', v_part.id, 'status', 'duplicate', 'duplicate_of', p_duplicate_of, 'idempotent_replay', false);
end;
$$;

create or replace function public.keep_part_for_review(p_part_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
begin
  v_part := public._review_load_part(p_part_id);
  if v_part.status = 'manager_review' then
    return jsonb_build_object('part_id', v_part.id, 'status', 'manager_review', 'idempotent_replay', true);
  end if;
  if v_part.status not in ('captured', 'draft_ready') then
    raise exception 'only an open capture can be kept for review (status is %)', v_part.status using errcode = 'P0001';
  end if;
  update public.parts set status = 'manager_review' where id = p_part_id returning * into v_part;
  perform public._review_event(v_part, 'REVIEW_KEPT_FOR_LATER', 'Kept for later');
  return jsonb_build_object('part_id', v_part.id, 'status', 'manager_review', 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Review queue (keyset) — one thumbnail join, no per-row queries.
-- ---------------------------------------------------------------------------------------
create or replace function public.list_dismantling_review_queue(
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid, vehicle_id uuid, vin text, lot_or_stock text, vehicle_label text,
  status text, dismantling_session_id uuid, captured_by uuid, employee_name text,
  created_at timestamptz, thumbnail_path text, thumbnail_bucket text, has_more boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  return query
  with page as (
    select p.*
      from public.parts p
     where p.dismantling_session_id is not null
       and p.status in ('captured', 'draft_ready', 'manager_review')
       and (p_from is null or p.created_at >= p_from)
       and (p_to is null or p.created_at < p_to)
       and (p_cursor_created_at is null or (p.created_at, p.id) > (p_cursor_created_at, p_cursor_id))
     order by p.created_at, p.id
     limit v_limit + 1
  ),
  numbered as (select page.*, row_number() over (order by created_at, id) as rn from page)
  select n.id, n.vehicle_id, n.source_vin, n.source_lot,
         concat_ws(' ', v.year::text, v.make, v.model),
         n.status, n.dismantling_session_id, n.captured_by,
         coalesce(pr.name, 'Unknown employee'),
         n.created_at,
         m.storage_path, m.bucket,
         exists (select 1 from numbered x where x.rn = v_limit + 1)
    from numbered n
    join public.vehicles v on v.id = n.vehicle_id
    left join public.profiles pr on pr.id = n.captured_by
    left join public.media_assets m
      on m.owner_type = 'part' and m.owner_id = n.id and m.variant = 'thumbnail' and m.status = 'ready'
   where n.rn <= v_limit
   order by n.created_at, n.id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Dashboard summary: one grouped read for the cards and the employee activity.
-- ---------------------------------------------------------------------------------------
create or replace function public.dismantling_processing_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_needs_review int;
  v_completed int;
  v_captured int;
  v_employees jsonb;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');

  select count(*) into v_needs_review from public.parts p
   where p.dismantling_session_id is not null and p.status in ('captured', 'draft_ready', 'manager_review');

  select count(*) into v_completed from public.dismantling_sessions s
   where s.status = 'completed' and s.ended_at >= p_from and s.ended_at < p_to;

  select count(*) into v_captured from public.parts p
   where p.dismantling_session_id is not null and p.created_at >= p_from and p.created_at < p_to;

  select coalesce(jsonb_agg(e order by (e->>'parts')::int desc, e->>'name'), '[]'::jsonb) into v_employees
    from (
      select jsonb_build_object(
               'employee_id', x.employee_id,
               'name', coalesce(pr.name, 'Unknown employee'),
               'sessions', x.sessions,
               'parts', x.parts
             ) as e,
             x.parts, pr.name
        from (
          select s.employee_id,
                 count(distinct s.id) filter (where s.status = 'completed') as sessions,
                 count(p.id) as parts
            from public.dismantling_sessions s
            left join public.parts p
              on p.dismantling_session_id = s.id and p.created_at >= p_from and p.created_at < p_to
           where s.started_at >= p_from and s.started_at < p_to
           group by s.employee_id
        ) x
        left join public.profiles pr on pr.id = x.employee_id
    ) z;

  return jsonb_build_object(
    'needs_review', v_needs_review,
    'completed_in_range', v_completed,
    'parts_captured_in_range', v_captured,
    'employees', v_employees
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------------------
revoke execute on function public._review_load_part(uuid) from public, anon, authenticated;
revoke execute on function public._review_has_ready_photo(uuid) from public, anon, authenticated;
revoke execute on function public._review_event(public.parts, text, text) from public, anon, authenticated;
revoke execute on function public._review_approve(uuid, jsonb, text) from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.approve_dismantled_part(uuid)',
    'public.edit_and_approve_part(uuid, jsonb)',
    'public.reject_dismantled_part(uuid, text)',
    'public.mark_part_duplicate(uuid, uuid)',
    'public.keep_part_for_review(uuid)',
    'public.list_dismantling_review_queue(timestamptz, timestamptz, int, timestamptz, uuid)',
    'public.dismantling_processing_summary(timestamptz, timestamptz)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
