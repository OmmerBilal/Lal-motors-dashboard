-- =====================================================================================
-- 0011 — Read-only identity preview for intake review: find_vehicle_match().
--
-- ADDITIVE. Writes nothing. Applies the same identity rules as match_or_create_vehicle()
-- (0006), so the review screen can show new / existing / conflict before the user confirms.
-- Confirmation still goes through match_or_create_vehicle(), which re-checks under a lock.
-- =====================================================================================

create or replace function public.find_vehicle_match(
  p_vin            text,
  p_lot_number     text,
  p_stock_number   text,
  p_auction_source text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_vin text := public._norm_vin(p_vin);
  v_lot text := public._norm_text(p_lot_number);
  v_stock text := public._norm_text(p_stock_number);
  v_source text := public._norm_text(p_auction_source);
  v_ids uuid[];
  v_row public.vehicles%rowtype;
begin
  if v_vin is null and v_stock is null and v_lot is null then
    return jsonb_build_object('status', 'new');
  end if;

  select coalesce(array_agg(id order by id), '{}') into v_ids
    from public.vehicles
   where (v_vin is not null and vin = v_vin)
      or (v_stock is not null and stock_number = v_stock)
      or (v_lot is not null and v_source is not null and lot_number = v_lot and auction_source = v_source);

  if array_length(v_ids, 1) is null then
    return jsonb_build_object('status', 'new');
  end if;
  if array_length(v_ids, 1) > 1 then
    return jsonb_build_object('status', 'conflict', 'reason', 'These identifiers match more than one vehicle.');
  end if;

  select * into v_row from public.vehicles where id = v_ids[1];
  if (v_vin is not null and v_row.vin is not null and v_row.vin <> v_vin)
     or (v_stock is not null and v_row.stock_number is not null and v_row.stock_number <> v_stock)
     or (v_lot is not null and v_row.lot_number is not null and v_row.lot_number <> v_lot) then
    return jsonb_build_object('status', 'conflict', 'reason', 'The matched vehicle has a different identifier.', 'vehicle_id', v_row.id);
  end if;

  return jsonb_build_object('status', 'existing', 'vehicle_id', v_row.id);
end;
$$;

revoke execute on function public.find_vehicle_match(text, text, text, text) from public, anon;
grant execute on function public.find_vehicle_match(text, text, text, text) to authenticated;
