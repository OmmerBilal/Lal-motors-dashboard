-- =====================================================================================
-- 0027 — Parts Inventory read model carries the fields the approved screens display, and field
-- edits accept the remaining draft fields (side, fitment, title, keywords).
--
-- ADDITIVE. 0026 is applied and not edited. update_part_fields is re-defined with the extra
-- allowed keys. list_parts is re-created with the extra columns (drop and create, same meaning).
-- =====================================================================================

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
  v_warehouse_keys text[] := array['part_name', 'category', 'condition', 'part_number', 'side_location', 'fitment', 'test_status', 'test_notes',
                                   'location', 'zone', 'rack', 'shelf', 'bin', 'part_notes'];
  v_reviewer_keys text[] := array['price', 'core_charge', 'has_core_charge', 'stock_sku', 'sale_channels',
                                  'title', 'description', 'keywords', 'fitment_status'];
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
         side_location = coalesce(p_fields->>'side_location', side_location),
         fitment = coalesce(p_fields->>'fitment', fitment),
         title = coalesce(p_fields->>'title', title),
         keywords = coalesce(p_fields->>'keywords', keywords),
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

revoke execute on function public.update_part_fields(uuid, jsonb, text) from public, anon;
grant execute on function public.update_part_fields(uuid, jsonb, text) to authenticated;

drop function if exists public.list_parts(text, text, text, text, int, timestamptz, uuid);

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
  id uuid, part_name text, category text, part_number text, side_location text, condition text,
  fitment text, fitment_status text, title text, description text, keywords text,
  status text, stage text, not_sellable_reason text, operational_status text, quantity int,
  price numeric, core_charge numeric, has_core_charge boolean, sale_channels text[], stock_sku text,
  location text, zone text, rack text, shelf text, bin text,
  test_status text, test_notes text, part_notes text,
  source_vin text, source_lot text, vehicle_id uuid, created_at timestamptz, out_of_stock boolean,
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
  select n.id, n.part_name, n.category, n.part_number, n.side_location, n.condition,
         n.fitment, n.fitment_status, n.title, n.description, n.keywords,
         n.status, n.stage, n.not_sellable_reason, n.operational_status, n.quantity,
         n.price, n.core_charge, n.has_core_charge, n.sale_channels, n.stock_sku,
         n.location, n.zone, n.rack, n.shelf, n.bin,
         n.test_status, n.test_notes, n.part_notes,
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

revoke execute on function public.list_parts(text, text, text, text, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_parts(text, text, text, text, int, timestamptz, uuid) to authenticated;
