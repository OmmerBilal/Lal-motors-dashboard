-- =====================================================================================
-- 0026 — Parts Inventory: sellability fix, zero-quantity-visible list and detail reads, and
--        processing mutations that write part_operations history.
--
-- ADDITIVE. 0001–0025 are not edited. _available_quantity is re-defined here.
--
-- Sellability (fixes a real gap found while reviewing this module):
--   _available_quantity (0004) counted quantity minus reservations for ANY part, so a rejected,
--   duplicate or not-sellable part with quantity 1 could be reserved for a sale. A part is now
--   sellable only when status = approved AND stage = ready_for_sale AND it is not marked
--   not-sellable. Every sale path (create_sale, reserve_stock) inherits this through
--   _available_quantity.
--
-- Roles:
--   reviewers  owner, engineer_admin, manager: everything below.
--   warehouse  employee (Warehouse Employee): name, category, condition, part number, test,
--              location fields, notes, and the in_processing stage. Cannot set price, core
--              charge, SKU, sale channels, ready-for-sale, or not-sellable.
--   dismantling, scrap, container, export, receiving, auction: no access to Parts Inventory.
--
-- Every mutation writes one part_operations row (business history) and one audit row.
-- Quantity is never changed here; sales and stock RPCs own quantity.
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- 1. Sellability: only approved, ready-for-sale, non-not-sellable parts have stock to sell.
-- ---------------------------------------------------------------------------------------
create or replace function public._available_quantity(p_part_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p.status = 'approved' and p.stage = 'ready_for_sale' and p.not_sellable_reason is null
             then p.quantity - coalesce((
                    select sum(r.quantity) from public.inventory_reservations r
                     where r.part_id = p.id and r.status = 'active'
                  ), 0)
           else 0
         end
    from public.parts p
   where p.id = p_part_id;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------------------
create or replace function public._parts_actor_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select string_agg(r.key, ',' order by r.key)
      from public.user_roles ur join public.roles r on r.id = ur.role_id
     where ur.user_id = auth.uid()
  ), 'none');
$$;

-- Parts Inventory readers: owner, engineer_admin, manager, employee (Warehouse Employee).
create or replace function public._parts_require_staff()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'employee');
end;
$$;

create or replace function public._parts_is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role('owner', 'engineer_admin', 'manager');
$$;

create or replace function public._parts_history(p_part public.parts, p_action text, p_note text,
                                                  p_prev_status text, p_new_status text,
                                                  p_prev_loc text, p_new_loc text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.part_operations (part_id, action_type, previous_location, new_location, previous_status, new_status,
                                      quantity_delta, previous_quantity, new_quantity, note, actor_id, actor_name, actor_role)
  values (p_part.id, p_action, p_prev_loc, p_new_loc, p_prev_status, p_new_status,
          0, p_part.quantity, p_part.quantity, coalesce(nullif(btrim(p_note), ''), p_action), auth.uid(),
          coalesce((select name from public.profiles where id = auth.uid()), 'unknown'), public._parts_actor_role());
end;
$$;

create or replace function public._parts_load(p_part_id uuid)
returns public.parts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
begin
  perform public._parts_require_staff();
  select * into v_part from public.parts where id = p_part_id for update;
  if not found then
    raise exception 'part not found' using errcode = '22023';
  end if;
  return v_part;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Read models
-- ---------------------------------------------------------------------------------------

-- Keyset list. Quantity 0 rows are always included (never filtered out). The UI shows "Out of Stock".
create or replace function public.list_parts(
  p_search text default null,
  p_stage text default null,
  p_status text default null,
  p_operational text default null,
  p_limit int default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid, part_name text, category text, part_number text, status text, stage text,
  operational_status text, quantity int, price numeric, stock_sku text,
  location_label text, source_vin text, source_lot text, vehicle_id uuid,
  created_at timestamptz, out_of_stock boolean,
  thumbnail_path text, thumbnail_bucket text, has_more boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_q text := btrim(coalesce(p_search, ''));
begin
  perform public._parts_require_staff();
  return query
  with page as (
    select p.*
      from public.parts p
     where (v_q = '' or
            p.part_name ilike '%' || v_q || '%' or
            p.part_number ilike '%' || v_q || '%' or
            p.stock_sku ilike '%' || v_q || '%' or
            p.source_vin ilike '%' || v_q || '%' or
            p.source_lot ilike '%' || v_q || '%')
       and (p_stage is null or p.stage = p_stage)
       and (p_status is null or p.status = p_status)
       and (p_operational is null or p.operational_status = p_operational)
       and (p_cursor_created_at is null or (p.created_at, p.id) < (p_cursor_created_at, p_cursor_id))
     order by p.created_at desc, p.id desc
     limit v_limit + 1
  ),
  numbered as (select page.*, row_number() over (order by page.created_at desc, page.id desc) as rn from page)
  select n.id, n.part_name, n.category, n.part_number, n.status, n.stage,
         n.operational_status, n.quantity, n.price, n.stock_sku,
         concat_ws(' / ', nullif(n.location, ''), nullif(n.zone, ''), nullif(n.rack, ''), nullif(n.shelf, ''), nullif(n.bin, '')),
         n.source_vin, n.source_lot, n.vehicle_id, n.created_at,
         (n.quantity = 0),
         m.storage_path, m.bucket,
         exists (select 1 from numbered x where x.rn = v_limit + 1)
    from numbered n
    left join public.media_assets m
      on m.id = n.thumbnail_asset_id and m.variant = 'thumbnail' and m.status = 'ready'
   where n.rn <= v_limit
   order by n.created_at desc, n.id desc;
end;
$$;

-- One part, on demand: donor vehicle, session, photos (ids only), and history.
create or replace function public.get_part_detail(p_part_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_part public.parts%rowtype;
  v_vehicle jsonb := null;
  v_session jsonb := null;
  v_photos jsonb;
  v_history jsonb;
begin
  perform public._parts_require_staff();
  select * into v_part from public.parts where id = p_part_id;
  if not found then
    raise exception 'part not found' using errcode = '22023';
  end if;

  if v_part.vehicle_id is not null then
    select jsonb_build_object('id', v.id, 'vin', v.vin, 'lot_number', v.lot_number, 'stock_number', v.stock_number,
                              'label', concat_ws(' ', v.year::text, v.make, v.model), 'auction_source', v.auction_source)
      into v_vehicle from public.vehicles v where v.id = v_part.vehicle_id;
  end if;

  if v_part.dismantling_session_id is not null then
    select jsonb_build_object('id', s.id, 'status', s.status, 'started_at', s.started_at, 'ended_at', s.ended_at,
                              'employee_name', coalesce(pr.name, 'Unknown employee'))
      into v_session
      from public.dismantling_sessions s
      left join public.profiles pr on pr.id = s.employee_id
     where s.id = v_part.dismantling_session_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('media_id', m.id, 'role', m.role, 'created_at', m.created_at)
                            order by m.created_at), '[]'::jsonb)
    into v_photos
    from public.media_assets m
   where m.owner_type = 'part' and m.owner_id = p_part_id and m.variant = 'original' and m.status = 'ready';

  select coalesce(jsonb_agg(h order by h.created_at desc), '[]'::jsonb) into v_history
    from (select po.action_type, po.note, po.previous_status, po.new_status, po.previous_location, po.new_location,
                 po.actor_name, po.actor_role, po.created_at
            from public.part_operations po
           where po.part_id = p_part_id
           order by po.created_at desc
           limit 100) h;

  return jsonb_build_object(
    'part', jsonb_build_object(
      'id', v_part.id, 'part_name', v_part.part_name, 'category', v_part.category, 'part_number', v_part.part_number,
      'condition', v_part.condition, 'test_status', v_part.test_status, 'test_notes', v_part.test_notes,
      'status', v_part.status, 'stage', v_part.stage, 'operational_status', v_part.operational_status,
      'quantity', v_part.quantity, 'out_of_stock', v_part.quantity = 0,
      'price', v_part.price, 'core_charge', v_part.core_charge, 'has_core_charge', v_part.has_core_charge,
      'sale_channels', to_jsonb(v_part.sale_channels), 'stock_sku', v_part.stock_sku,
      'location', v_part.location, 'zone', v_part.zone, 'rack', v_part.rack, 'shelf', v_part.shelf, 'bin', v_part.bin,
      'part_notes', v_part.part_notes, 'description', v_part.description,
      'not_sellable_reason', v_part.not_sellable_reason, 'duplicate_of_part_id', v_part.duplicate_of_part_id,
      'source_vin', v_part.source_vin, 'source_lot', v_part.source_lot,
      'created_at', v_part.created_at, 'approved_at', v_part.approved_at),
    'donor_vehicle', v_vehicle,
    'session', v_session,
    'photos', v_photos,
    'history', v_history);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Processing mutations (each writes part_operations + audit)
-- ---------------------------------------------------------------------------------------

-- Field edits. Warehouse may edit descriptive and location fields; reviewers may also set price,
-- core charge, SKU and sale channels. Quantity, status, stage and operational state are NOT here.
create or replace function public.update_part_fields(p_part_id uuid, p_fields jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
  v_key text;
  v_reviewer boolean := public._parts_is_reviewer();
  v_warehouse_keys text[] := array['part_name', 'category', 'condition', 'part_number', 'test_status', 'test_notes',
                                   'location', 'zone', 'rack', 'shelf', 'bin', 'part_notes'];
  v_reviewer_keys text[] := array['price', 'core_charge', 'has_core_charge', 'stock_sku', 'sale_channels',
                                  'description', 'fitment_status'];
  v_price numeric;
  v_core numeric;
  v_sku text;
  v_channel text;
  v_prev_loc text;
  v_changed text[] := '{}';
begin
  v_part := public._parts_load(p_part_id);
  if v_part.status <> 'approved' then
    raise exception 'only an approved part can be processed (status is %)', v_part.status using errcode = 'P0001', hint = 'NOT_APPROVED';
  end if;
  if p_fields is null or p_fields = '{}'::jsonb then
    raise exception 'nothing to change' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key = any(v_warehouse_keys) then
      null;
    elsif v_key = any(v_reviewer_keys) then
      if not v_reviewer then
        raise exception 'only a reviewer may set %', v_key using errcode = '42501', hint = 'REVIEWER_ONLY';
      end if;
    else
      raise exception 'field % cannot be changed here', v_key using errcode = '22023';
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
  if p_fields ? 'fitment_status' and (p_fields->>'fitment_status') not in ('verification_required', 'verified') then
    raise exception 'unknown fitment status' using errcode = '22023';
  end if;
  if p_fields ? 'part_name' and btrim(p_fields->>'part_name') = '' then
    raise exception 'part name cannot be empty' using errcode = '22023';
  end if;
  if p_fields ? 'stock_sku' then
    v_sku := btrim(p_fields->>'stock_sku');
    if v_sku <> '' then
      if char_length(v_sku) > 40 or v_sku !~ '^[A-Za-z0-9-]+$' then
        raise exception 'SKU may use letters, numbers and dashes only (40 characters max)' using errcode = '22023';
      end if;
      if exists (select 1 from public.parts where stock_sku = v_sku and id <> p_part_id) then
        raise exception 'this SKU is already used by another part' using errcode = 'P0001', hint = 'SKU_TAKEN';
      end if;
    end if;
  end if;
  if p_fields ? 'sale_channels' then
    for v_channel in select jsonb_array_elements_text(p_fields->'sale_channels') loop
      if v_channel not in ('In-Store', 'eBay', 'Export') then
        raise exception 'unknown sale channel %', v_channel using errcode = '22023';
      end if;
    end loop;
  end if;

  v_prev_loc := v_part.location;
  foreach v_key in array (select array_agg(k) from jsonb_object_keys(p_fields) k) loop
    v_changed := v_changed || v_key;
  end loop;

  update public.parts
     set part_name = coalesce(nullif(btrim(p_fields->>'part_name'), ''), part_name),
         category = coalesce(p_fields->>'category', category),
         condition = coalesce(p_fields->>'condition', condition),
         part_number = coalesce(p_fields->>'part_number', part_number),
         test_status = coalesce(p_fields->>'test_status', test_status),
         test_notes = coalesce(p_fields->>'test_notes', test_notes),
         location = coalesce(p_fields->>'location', location),
         zone = coalesce(p_fields->>'zone', zone),
         rack = coalesce(p_fields->>'rack', rack),
         shelf = coalesce(p_fields->>'shelf', shelf),
         bin = coalesce(p_fields->>'bin', bin),
         part_notes = coalesce(p_fields->>'part_notes', part_notes),
         price = coalesce(v_price, price),
         core_charge = case when p_fields ? 'core_charge' and (p_fields->>'core_charge') = '' then null
                            when v_core is not null then v_core else core_charge end,
         has_core_charge = coalesce((p_fields->>'has_core_charge')::boolean, has_core_charge),
         stock_sku = case when p_fields ? 'stock_sku' then nullif(btrim(p_fields->>'stock_sku'), '') else stock_sku end,
         sale_channels = case when p_fields ? 'sale_channels'
                              then array(select jsonb_array_elements_text(p_fields->'sale_channels'))
                              else sale_channels end,
         description = coalesce(p_fields->>'description', description),
         fitment_status = coalesce(p_fields->>'fitment_status', fitment_status)
   where id = p_part_id
   returning * into v_part;

  perform public._parts_history(v_part, 'FIELD_UPDATE',
    coalesce(p_note, 'Updated: ' || array_to_string(v_changed, ', ')),
    null, null, v_prev_loc, v_part.location);
  perform public.write_audit_log('part.update_fields', 'part', p_part_id,
    'Part processing fields updated', jsonb_build_object('fields', to_jsonb(v_changed)), p_note, null);

  return jsonb_build_object('part_id', v_part.id, 'changed', to_jsonb(v_changed));
end;
$$;

-- Stage transitions. Ready for sale needs the reviewer and the required processing data.
create or replace function public.set_part_stage(p_part_id uuid, p_stage text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
  v_prev text;
  v_reviewer boolean := public._parts_is_reviewer();
begin
  v_part := public._parts_load_for_stage(p_part_id);
  v_prev := v_part.stage;
  if v_part.status <> 'approved' then
    raise exception 'only an approved part has a processing stage (status is %)', v_part.status using errcode = 'P0001', hint = 'NOT_APPROVED';
  end if;
  if v_part.not_sellable_reason is not null and p_stage <> 'in_processing' then
    raise exception 'this part is marked not sellable; reopen it to processing first' using errcode = 'P0001', hint = 'NOT_SELLABLE';
  end if;
  if p_stage = v_prev then
    return jsonb_build_object('part_id', v_part.id, 'stage', v_part.stage, 'idempotent_replay', true);
  end if;

  if p_stage not in ('needs_processing', 'in_processing', 'ready_for_sale') then
    raise exception 'unknown processing stage' using errcode = '22023';
  end if;

  if v_prev = 'needs_processing' and p_stage = 'in_processing' then
    null; -- warehouse or reviewer
  elsif v_prev = 'in_processing' and p_stage = 'ready_for_sale' then
    if not v_reviewer then
      raise exception 'only a reviewer may mark a part ready for sale' using errcode = '42501', hint = 'REVIEWER_ONLY';
    end if;
    if char_length(btrim(v_part.part_name)) = 0 then
      raise exception 'name the part before it is ready for sale' using errcode = 'P0001', hint = 'NOT_READY';
    end if;
    if v_part.price <= 0 then
      raise exception 'set a price above zero before it is ready for sale' using errcode = 'P0001', hint = 'NOT_READY';
    end if;
    if btrim(v_part.location) = '' and btrim(v_part.bin) = '' then
      raise exception 'record where the part is stored before it is ready for sale' using errcode = 'P0001', hint = 'NOT_READY';
    end if;
    if v_part.test_status is null then
      raise exception 'record a test result before it is ready for sale' using errcode = 'P0001', hint = 'NOT_READY';
    end if;
  elsif v_prev = 'ready_for_sale' and p_stage = 'in_processing' then
    if not v_reviewer then
      raise exception 'only a reviewer may reopen a ready part' using errcode = '42501', hint = 'REVIEWER_ONLY';
    end if;
  elsif v_prev = 'in_processing' and p_stage = 'needs_processing' then
    if not v_reviewer then
      raise exception 'only a reviewer may send a part back' using errcode = '42501', hint = 'REVIEWER_ONLY';
    end if;
  else
    raise exception 'cannot move a part from % to %', v_prev, p_stage using errcode = 'P0001', hint = 'INVALID_TRANSITION';
  end if;

  update public.parts set stage = p_stage where id = p_part_id returning * into v_part;
  perform public._parts_history(v_part, 'STAGE_CHANGE', coalesce(p_note, v_prev || ' to ' || p_stage), v_prev, p_stage, null, null);
  perform public.write_audit_log('part.stage', 'part', p_part_id, 'Processing stage ' || v_prev || ' -> ' || p_stage,
    jsonb_build_object('from', v_prev, 'to', p_stage), p_note, null);
  return jsonb_build_object('part_id', v_part.id, 'stage', v_part.stage, 'idempotent_replay', false);
end;
$$;

-- Loads a part for a stage change (staff roles, row lock).
create or replace function public._parts_load_for_stage(p_part_id uuid)
returns public.parts
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._parts_load(p_part_id);
end;
$$;

-- Not sellable: reviewers only. Refused while stock is reserved, so no reservation is left dangling.
create or replace function public.mark_part_not_sellable(p_part_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
  v_active int;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  v_part := public._parts_load(p_part_id);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a reason of at least 5 characters is required' using errcode = '22023';
  end if;
  if v_part.status <> 'approved' then
    raise exception 'only an approved part can be marked not sellable (status is %)', v_part.status using errcode = 'P0001', hint = 'NOT_APPROVED';
  end if;
  if v_part.not_sellable_reason is not null then
    return jsonb_build_object('part_id', v_part.id, 'idempotent_replay', true);
  end if;
  select count(*) into v_active from public.inventory_reservations where part_id = p_part_id and status = 'active';
  if v_active > 0 then
    raise exception 'release the active reservation first (% reserved)', v_active using errcode = 'P0001', hint = 'RESERVED';
  end if;

  update public.parts
     set stage = 'not_sellable', not_sellable_reason = btrim(p_reason),
         not_sellable_notes = btrim(p_reason), not_sellable_by = auth.uid(), not_sellable_at = now()
   where id = p_part_id
   returning * into v_part;
  perform public._parts_history(v_part, 'NOT_SELLABLE', btrim(p_reason), null, null, null, null);
  perform public.write_audit_log('part.not_sellable', 'part', p_part_id, 'Part marked not sellable',
    jsonb_build_object('reason', btrim(p_reason)), btrim(p_reason), null);
  return jsonb_build_object('part_id', v_part.id, 'stage', 'not_sellable', 'idempotent_replay', false);
end;
$$;

-- Reopen a not-sellable part to processing (reviewers only; clears the reason, keeps history).
create or replace function public.reopen_part_processing(p_part_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  v_part := public._parts_load(p_part_id);
  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'a note of at least 5 characters is required' using errcode = '22023';
  end if;
  if v_part.not_sellable_reason is null then
    return jsonb_build_object('part_id', v_part.id, 'stage', v_part.stage, 'idempotent_replay', true);
  end if;
  update public.parts
     set stage = 'in_processing', not_sellable_reason = null, not_sellable_notes = '',
         not_sellable_by = null, not_sellable_at = null
   where id = p_part_id
   returning * into v_part;
  perform public._parts_history(v_part, 'REOPENED', btrim(p_note), 'not_sellable', 'in_processing', null, null);
  perform public.write_audit_log('part.reopen', 'part', p_part_id, 'Part reopened to processing',
    '{}'::jsonb, btrim(p_note), null);
  return jsonb_build_object('part_id', v_part.id, 'stage', v_part.stage, 'idempotent_replay', false);
end;
$$;

-- Operational state for damage / missing / returned. Quantity never changes here.
create or replace function public.set_part_operational_status(p_part_id uuid, p_status text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts%rowtype;
  v_prev text;
  v_active int;
begin
  v_part := public._parts_load(p_part_id);
  v_prev := v_part.operational_status;
  if p_status not in ('DAMAGED', 'RETURNED', 'MISSING') then
    raise exception 'set DAMAGED, RETURNED or MISSING here (AVAILABLE, RESERVED and SOLD follow stock movements)' using errcode = '22023';
  end if;
  if (p_status = 'RETURNED') and not public._parts_is_reviewer() then
    raise exception 'only a reviewer may record a return' using errcode = '42501', hint = 'REVIEWER_ONLY';
  end if;
  if v_part.status in ('rejected', 'duplicate') then
    raise exception 'a % part keeps its MISSING state', v_part.status using errcode = 'P0001', hint = 'TERMINAL_STATE';
  end if;
  if p_status = v_prev then
    return jsonb_build_object('part_id', v_part.id, 'operational_status', v_prev, 'idempotent_replay', true);
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'add a note describing the change' using errcode = '22023';
  end if;
  select count(*) into v_active from public.inventory_reservations where part_id = p_part_id and status = 'active';
  if v_active > 0 then
    raise exception 'release the active reservation first (% reserved)', v_active using errcode = 'P0001', hint = 'RESERVED';
  end if;

  update public.parts set operational_status = p_status where id = p_part_id returning * into v_part;
  perform public._parts_history(v_part, 'OPERATIONAL_STATUS', btrim(p_note), v_prev, p_status, null, null);
  perform public.write_audit_log('part.operational_status', 'part', p_part_id,
    'Operational state ' || v_prev || ' -> ' || p_status, jsonb_build_object('from', v_prev, 'to', p_status), btrim(p_note), null);
  return jsonb_build_object('part_id', v_part.id, 'operational_status', p_status, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------------------------
revoke execute on function public._parts_require_staff() from public, anon, authenticated;
revoke execute on function public._parts_is_reviewer() from public, anon, authenticated;
revoke execute on function public._parts_actor_role() from public, anon, authenticated;
revoke execute on function public._parts_history(public.parts, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public._parts_load(uuid) from public, anon, authenticated;
revoke execute on function public._parts_load_for_stage(uuid) from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.list_parts(text, text, text, text, int, timestamptz, uuid)',
    'public.get_part_detail(uuid)',
    'public.update_part_fields(uuid, jsonb, text)',
    'public.set_part_stage(uuid, text, text)',
    'public.mark_part_not_sellable(uuid, text)',
    'public.reopen_part_processing(uuid, text)',
    'public.set_part_operational_status(uuid, text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
