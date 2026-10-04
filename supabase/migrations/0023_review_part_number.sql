-- =====================================================================================
-- 0023 — approve / edit-and-approve accept part_number (the approved edit dialog has an OEM field).
--
-- ADDITIVE. 0019 is applied and not edited. _review_approve is re-defined with part_number added
-- to the allowed processing fields. Nothing else changes.
-- =====================================================================================

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
      if v_key not in ('part_name', 'category', 'condition', 'part_number', 'test_status', 'location', 'zone', 'rack', 'shelf', 'bin',
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
         part_number = coalesce(p_fields->>'part_number', part_number),
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
