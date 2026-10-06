-- =====================================================================================
-- 0068 — create_manual_inventory_part: the history row also records the actor role, as every other parts history
-- row does (part_operations.actor_role is NOT NULL). ADDITIVE: replaces one function body. 0067 is applied and not edited.
-- =====================================================================================

create or replace function public.create_manual_inventory_part(p_fields jsonb, p_client_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_fields->>'part_name', ''));
  v_qty int;
  v_price numeric;
  v_sku text := nullif(btrim(coalesce(p_fields->>'stock_sku', '')), '');
  v_part public.parts%rowtype;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');

  if p_client_request_id is not null then
    select * into v_part from public.parts where client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object('part_id', v_part.id, 'stock_sku', v_part.stock_sku, 'quantity', v_part.quantity, 'idempotent_replay', true);
    end if;
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    raise exception 'enter the part name (2 to 160 characters)' using errcode = '22023';
  end if;
  if (p_fields->>'quantity') is null or (p_fields->>'quantity')::numeric <> trunc((p_fields->>'quantity')::numeric)
     or (p_fields->>'quantity')::numeric < 0 or (p_fields->>'quantity')::numeric > 100000 then
    raise exception 'quantity must be a whole number from 0 to 100000' using errcode = '22023';
  end if;
  v_qty := (p_fields->>'quantity')::int;
  v_price := nullif(p_fields->>'price', '')::numeric;
  if v_price is null or v_price < 0 or v_price <> round(v_price, 2) then
    raise exception 'selling price must be zero or positive with at most 2 decimals' using errcode = '22023';
  end if;
  if v_sku is not null and exists (select 1 from public.parts where stock_sku = v_sku) then
    raise exception 'this SKU is already used by another part' using errcode = 'P0001', hint = 'SKU_TAKEN';
  end if;
  if char_length(coalesce(p_fields->>'part_notes', '')) > 2000 then
    raise exception 'description is too long' using errcode = '22023';
  end if;

  insert into public.parts (status, stage, operational_status, quantity, price, part_name, category, part_number,
                            condition, location, part_notes, stock_sku, inventory_source, client_request_id)
  values ('approved', 'ready_for_sale', case when v_qty = 0 then 'SOLD' else 'AVAILABLE' end, v_qty, v_price, v_name,
          coalesce(nullif(btrim(p_fields->>'category'), ''), ''),
          coalesce(nullif(btrim(p_fields->>'part_number'), ''), ''),
          coalesce(nullif(btrim(p_fields->>'condition'), ''), 'Used'),
          coalesce(nullif(btrim(p_fields->>'location'), ''), ''),
          coalesce(p_fields->>'part_notes', ''),
          v_sku, 'manual', p_client_request_id)
  returning * into v_part;

  insert into public.part_operations (part_id, action_type, new_status, quantity_delta, previous_quantity, new_quantity, note,
                                      actor_id, actor_name, actor_role)
  values (v_part.id, 'MANUAL_CREATE', 'approved', v_qty, 0, v_qty, 'Manual inventory part added', auth.uid(),
          coalesce((select name from public.profiles where id = auth.uid()), 'unknown'), public._parts_actor_role());

  perform public.write_audit_log('inventory.manual_part_create', 'part', v_part.id, 'Manual inventory part added',
    jsonb_build_object('quantity', v_qty, 'price', v_price, 'stock_sku', v_sku), null, p_client_request_id);

  return jsonb_build_object('part_id', v_part.id, 'stock_sku', v_part.stock_sku, 'quantity', v_part.quantity, 'idempotent_replay', false);
end;
$$;
