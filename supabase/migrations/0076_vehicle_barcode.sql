-- =====================================================================================
-- 0076 — Vehicle barcode: a stable, scannable, unique identifier for every vehicle.
--
-- ADDITIVE. 0001–0075 are not edited.
--
-- Rule: barcode = the VIN itself when the vehicle has a valid 17-character VIN (so the
-- manufacturer's own VIN barcode, already on the car, resolves to the same vehicle); otherwise a
-- generated code 'LAL-' + a stable token derived from the row's own id (so it never collides and
-- never changes for that row). This migration both adds the column and backfills every existing
-- vehicle in one file, then teaches match_or_create_vehicle (the only vehicle-creation path —
-- 0006, never redefined since) to assign one at creation using the exact same rule. Finally adds
-- vehicle_find_by_barcode(), a read-only lookup by barcode OR vin OR stock_number, for scan-to-open.
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- 1. Column + backfill + constraint, in that order (so the NOT NULL/UNIQUE additions never see a
--    partially-backfilled table).
-- ---------------------------------------------------------------------------------------
alter table public.vehicles add column if not exists barcode text;

update public.vehicles
   set barcode = case
     when vin is not null and char_length(btrim(vin)) = 17 and upper(btrim(vin)) !~ '[^A-HJ-NPR-Z0-9]'
       then upper(btrim(vin))
     else 'LAL-' || upper(replace(id::text, '-', ''))
   end
 where barcode is null;

alter table public.vehicles alter column barcode set not null;

create unique index if not exists vehicles_barcode_key on public.vehicles (barcode);

comment on column public.vehicles.barcode is
  'Scannable identifier: the VIN itself when valid (17 chars, no I/O/Q), otherwise LAL-<hex of the row id>. '
  'Assigned once at creation by match_or_create_vehicle and never changed afterward. Looked up by '
  'vehicle_find_by_barcode() alongside vin/stock_number, so both a printed LAL- label and the car''s own '
  'manufacturer VIN barcode resolve to the same vehicle.';

-- ---------------------------------------------------------------------------------------
-- 2. match_or_create_vehicle — same body as 0006, with the row's id generated up front (so the
--    barcode can be computed before the insert) and a barcode column/value added to the insert.
--    Everything else — matching, locking, conflict rules, validation, the created event/audit row —
--    is byte-for-byte unchanged.
-- ---------------------------------------------------------------------------------------
create or replace function public.match_or_create_vehicle(
  p_vin            text,
  p_lot_number     text,
  p_stock_number   text,
  p_auction_source text,
  p_fields         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vin text := public._norm_vin(p_vin);
  v_lot text := public._norm_text(p_lot_number);
  v_stock text := public._norm_text(p_stock_number);
  v_source text := public._norm_text(p_auction_source);
  v_ids uuid[];
  v_row public.vehicles%rowtype;
  v_match_by text;
  v_year int;
  v_make text;
  v_model text;
  v_new public.vehicles%rowtype;
  v_id uuid := gen_random_uuid();
  v_barcode text;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager', 'auction');

  if v_vin is null and v_stock is null and v_lot is null then
    raise exception 'enter a VIN, stock number, or lot number' using errcode = '22023';
  end if;
  if v_vin is not null and char_length(v_vin) <> 17 then
    raise exception 'VIN must be 17 characters' using errcode = '22023';
  end if;
  if v_vin is not null and v_vin ~ '[IOQ]' then
    raise exception 'VIN may not contain I, O or Q' using errcode = '22023';
  end if;
  if v_lot is not null and v_source is null then
    raise exception 'a lot number needs an auction source' using errcode = '22023';
  end if;

  -- Candidate rows from every identifier. Lock them in id order so concurrent intakes serialize.
  select coalesce(array_agg(id order by id), '{}') into v_ids
    from public.vehicles
   where (v_vin is not null and vin = v_vin)
      or (v_stock is not null and stock_number = v_stock)
      or (v_lot is not null and v_source is not null and lot_number = v_lot and auction_source = v_source);

  if array_length(v_ids, 1) is not null then
    perform 1 from public.vehicles where id = any(v_ids) order by id for update;

    if array_length(v_ids, 1) > 1 then
      return jsonb_build_object('outcome', 'conflict', 'reason',
        'These identifiers point at more than one existing vehicle. Resolve the duplicate before intake.',
        'candidate_ids', v_ids);
    end if;

    select * into v_row from public.vehicles where id = v_ids[1];

    -- Contradiction check: an identifier supplied now that disagrees with the stored value.
    if v_vin is not null and v_row.vin is not null and v_row.vin <> v_vin then
      return jsonb_build_object('outcome', 'conflict', 'reason', 'Matched vehicle has a different VIN.', 'vehicle_id', v_row.id);
    end if;
    if v_stock is not null and v_row.stock_number is not null and v_row.stock_number <> v_stock then
      return jsonb_build_object('outcome', 'conflict', 'reason', 'Matched vehicle has a different stock number.', 'vehicle_id', v_row.id);
    end if;
    if v_lot is not null and v_row.lot_number is not null and v_row.lot_number <> v_lot then
      return jsonb_build_object('outcome', 'conflict', 'reason', 'Matched vehicle has a different lot number.', 'vehicle_id', v_row.id);
    end if;

    v_match_by := case
      when v_vin is not null and v_row.vin = v_vin then 'vin'
      when v_stock is not null and v_row.stock_number = v_stock then 'stock_number'
      else 'lot_and_source' end;

    return jsonb_build_object('outcome', 'existing', 'matched_by', v_match_by, 'vehicle_id', v_row.id);
  end if;

  -- No match: create. Year, make and model are required for a new record.
  v_year := nullif(p_fields->>'year', '')::int;
  v_make := public._norm_text(p_fields->>'make');
  v_model := public._norm_text(p_fields->>'model');
  if v_year is null or v_year < 1950 or v_year > 2100 then
    raise exception 'a valid model year is required for a new vehicle' using errcode = '22023';
  end if;
  if v_make is null or v_model is null then
    raise exception 'make and model are required for a new vehicle' using errcode = '22023';
  end if;

  -- Barcode: the VIN itself (already validated above — 17 chars, no I/O/Q) when present, otherwise a
  -- token derived from this row's own (pre-generated) id. Same rule as the backfill above.
  v_barcode := coalesce(v_vin, 'LAL-' || upper(replace(v_id::text, '-', '')));

  begin
    insert into public.vehicles (
      id, vin, lot_number, stock_number, auction_item_number, auction_source,
      year, make, model, trim, engine, mileage, title_status, location,
      purchase_price, auction_fees, transportation_cost, status, created_by, updated_by, barcode
    ) values (
      v_id, v_vin, v_lot, v_stock, public._norm_text(p_fields->>'auction_item_number'), coalesce(v_source, ''),
      v_year, v_make, v_model,
      coalesce(public._norm_text(p_fields->>'trim'), ''),
      coalesce(public._norm_text(p_fields->>'engine'), ''),
      nullif(p_fields->>'mileage', '')::int,
      coalesce(public._norm_text(p_fields->>'title_status'), 'Pending'),
      coalesce(public._norm_text(p_fields->>'location'), ''),
      coalesce(nullif(p_fields->>'purchase_price', '')::numeric, 0),
      coalesce(nullif(p_fields->>'auction_fees', '')::numeric, 0),
      coalesce(nullif(p_fields->>'transportation_cost', '')::numeric, 0),
      'Purchased', auth.uid(), auth.uid(), v_barcode
    ) returning * into v_new;
  exception when unique_violation then
    -- A concurrent intake created the same identity between our check and insert. Report it.
    return jsonb_build_object('outcome', 'conflict', 'reason', 'Another intake for this vehicle was saved at the same moment. Refresh and try again.');
  end;

  perform public._vehicle_event(v_new.id, 'VEHICLE_CREATED', 'Created by auction intake', 'Purchased');
  perform public.write_audit_log('vehicle.create', 'vehicle', v_new.id,
    'Vehicle created (' || coalesce(v_vin, v_stock, v_lot) || ')',
    jsonb_build_object('vin', v_vin, 'stock_number', v_stock, 'lot_number', v_lot), null, null);

  return jsonb_build_object('outcome', 'created', 'vehicle_id', v_new.id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. vehicle_find_by_barcode — read-only, same viewer roles as vehicle_get (is_vehicle_domain_staff:
--    owner, engineer_admin, manager, auction, receiving, dismantling). Trims/uppercases the input and
--    matches barcode OR vin OR stock_number, so a printed LAL- label and the car's own manufacturer
--    VIN barcode both resolve. Returns a clean {found: false} rather than an error when nothing
--    matches, and never includes rows the caller cannot already see via vehicle_get's own gate.
-- ---------------------------------------------------------------------------------------
create or replace function public.vehicle_find_by_barcode(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_row public.vehicles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.is_vehicle_domain_staff() then
    raise exception 'your role cannot look up vehicles' using errcode = '42501';
  end if;

  if v_code = '' then
    return jsonb_build_object('found', false);
  end if;

  select * into v_row from public.vehicles
   where upper(barcode) = v_code or upper(coalesce(vin, '')) = v_code or upper(coalesce(stock_number, '')) = v_code
   order by created_at desc
   limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'vehicle_id', v_row.id,
    'year', v_row.year,
    'make', v_row.make,
    'model', v_row.model,
    'vin', v_row.vin,
    'stock_number', v_row.stock_number,
    'lot_number', v_row.lot_number,
    'barcode', v_row.barcode
  );
end;
$$;
revoke execute on function public.vehicle_find_by_barcode(text) from public, anon;
grant execute on function public.vehicle_find_by_barcode(text) to authenticated;
