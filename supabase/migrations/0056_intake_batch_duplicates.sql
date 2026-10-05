-- =====================================================================================
-- 0056 — Duplicate protection for auction intake batches (Module 01). ADDITIVE: new functions only.
--
-- A submitted batch is evaluated row by row against:
--   (a) the other rows of the SAME batch, and
--   (b) the existing vehicles in the database.
-- Authoritative identifiers are normalised first: VIN (no spaces, upper case, no I/O/Q check), lot, stock and
-- auction item number. Two rows that share any authoritative identifier are then compared on their full incoming
-- content (every parsed field plus the source line):
--   identical content  -> the first row stays the candidate ("new"); later identical rows are "duplicate"
--   different content  -> every row in that group is "conflict" (none is created until a person resolves it)
-- A row matching an existing vehicle is "existing" (never created again, never overwritten here).
-- Rows missing year, make or model, or with a malformed VIN, are "invalid".
--
-- intake_evaluate_batch is read-only. intake_commit_batch re-runs the same evaluation on the server and creates only
-- rows that are "new", through match_or_create_vehicle (which re-checks under a lock). A client cannot bypass the
-- check by sending a modified list: the duplicate test runs in this database function, not in the browser.
-- =====================================================================================

create or replace function public._intake_evaluate_rows(p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n int;
  i int;
  j int;
  r jsonb;
  v_vin text[] := '{}';
  v_lot text[] := '{}';
  v_stock text[] := '{}';
  v_item text[] := '{}';
  v_canon text[] := '{}';
  v_status text[] := '{}';
  v_reason text[] := '{}';
  v_vehicle uuid[] := '{}';
  v_dup_of int[] := '{}';
  v_found uuid;
  v_share boolean;
begin
  n := jsonb_array_length(p_rows);
  for i in 0..n-1 loop
    r := p_rows->i;
    v_vin := v_vin || coalesce(public._norm_vin(r->>'vin'), '');
    v_lot := v_lot || coalesce(public._norm_text(r->>'lotNumber'), '');
    v_stock := v_stock || coalesce(public._norm_text(r->>'stockNumber'), '');
    v_item := v_item || coalesce(public._norm_text(r->>'auctionItemNumber'), '');
    v_canon := v_canon || lower(regexp_replace(coalesce(r->>'sourceText', '') || '|' || (r - 'uncertainFields' - 'sourceText')::text, '\s+', ' ', 'g'));
    v_status := v_status || 'new';
    v_reason := v_reason || ''::text;
    v_vehicle := v_vehicle || null::uuid;
    v_dup_of := v_dup_of || null::int;
    if coalesce(nullif(btrim(r->>'year'), ''), '') = '' or coalesce(nullif(btrim(r->>'make'), ''), '') = ''
       or coalesce(nullif(btrim(r->>'model'), ''), '') = '' then
      v_status[i+1] := 'invalid';
      v_reason[i+1] := 'year, make and model are required';
    elsif v_vin[i+1] <> '' and length(v_vin[i+1]) <> 17 then
      v_status[i+1] := 'invalid';
      v_reason[i+1] := 'VIN must be 17 characters';
    elsif v_vin[i+1] = '' and v_lot[i+1] = '' and v_stock[i+1] = '' then
      v_status[i+1] := 'invalid';
      v_reason[i+1] := 'enter a VIN, lot number or stock number';
    end if;
  end loop;

  -- (a) Same batch: every pair that shares an authoritative identifier is compared on its full content.
  for i in 1..n loop
    for j in 1..i-1 loop
      if v_status[i] = 'invalid' or v_status[j] = 'invalid' then continue; end if;
      v_share := (v_vin[i] <> '' and v_vin[i] = v_vin[j])
              or (v_lot[i] <> '' and v_lot[i] = v_lot[j])
              or (v_stock[i] <> '' and v_stock[i] = v_stock[j])
              or (v_item[i] <> '' and v_item[i] = v_item[j]);
      if not v_share then continue; end if;
      if v_canon[i] = v_canon[j] then
        if v_status[i] <> 'conflict' and v_status[j] <> 'conflict' then
          v_status[i] := 'duplicate';
          v_reason[i] := 'the same vehicle appears earlier in this batch with identical details';
          v_dup_of[i] := j - 1;
        end if;
      else
        v_status[i] := 'conflict';
        v_reason[i] := 'the same identifier appears earlier in this batch with different details';
        v_dup_of[i] := j - 1;
        v_status[j] := 'conflict';
        v_reason[j] := 'the same identifier appears later in this batch with different details';
      end if;
    end loop;
  end loop;

  -- (b) Existing vehicles: a match is reported as existing and is not created again.
  for i in 1..n loop
    if v_status[i] in ('invalid', 'conflict', 'duplicate') then continue; end if;
    select v.id into v_found from public.vehicles v
     where (v_vin[i] <> '' and v.vin = v_vin[i])
        or (v_stock[i] <> '' and v.stock_number = v_stock[i])
        or (v_lot[i] <> '' and v.lot_number = v_lot[i])
     order by v.created_at desc limit 1;
    if v_found is not null then
      v_status[i] := 'existing';
      v_reason[i] := 'a vehicle with this identifier is already in inventory';
      v_vehicle[i] := v_found;
    end if;
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'index', i - 1,
             'status', v_status[i],
             'reason', nullif(v_reason[i], ''),
             'vehicle_id', v_vehicle[i],
             'duplicate_of', v_dup_of[i]
           ) order by i)
      from generate_series(1, n) i
  ), '[]'::jsonb);
end;
$$;

create or replace function public.intake_evaluate_batch(p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_any_role('owner', 'engineer_admin', 'manager', 'auction') then
    raise exception 'forbidden: your role cannot check a vehicle intake' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'nothing to check' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception 'a batch holds up to 200 rows' using errcode = '22023';
  end if;
  return public._intake_evaluate_rows(p_rows);
end;
$$;

create or replace function public.intake_commit_batch(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eval jsonb;
  v_row jsonb;
  v_r jsonb;
  v_out jsonb := '[]'::jsonb;
  v_result jsonb;
  v_status text;
  v_counts jsonb := '{"new":0,"created":0,"existing":0,"duplicate":0,"conflict":0,"invalid":0,"failed":0}'::jsonb;
  v_key text;
begin
  if not public.has_any_role('owner', 'engineer_admin', 'manager', 'auction') then
    raise exception 'forbidden: your role cannot add vehicles' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'nothing to add' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception 'a batch holds up to 200 rows' using errcode = '22023';
  end if;

  -- The authoritative evaluation runs here, on the server, for the rows as they were submitted.
  v_eval := public._intake_evaluate_rows(p_rows);

  for v_row in select value from jsonb_array_elements(v_eval) loop
    v_r := p_rows->((v_row->>'index')::int);
    v_status := v_row->>'status';
    v_key := v_status;
    v_counts := jsonb_set(v_counts, array[v_key], to_jsonb(coalesce((v_counts->>v_key)::int, 0) + 1));

    if v_status = 'new' then
      begin
        v_result := public.match_or_create_vehicle(
          nullif(btrim(v_r->>'vin'), ''),
          nullif(btrim(v_r->>'lotNumber'), ''),
          nullif(btrim(v_r->>'stockNumber'), ''),
          nullif(btrim(v_r->>'auctionSource'), ''),
          jsonb_build_object(
            'year', v_r->>'year', 'make', v_r->>'make', 'model', v_r->>'model',
            'trim', v_r->>'trim', 'engine', v_r->>'engine', 'mileage', v_r->>'mileage',
            'auction_item_number', v_r->>'auctionItemNumber', 'title_status', v_r->>'titleStatus',
            'location', v_r->>'location', 'purchase_price', v_r->>'purchasePrice',
            'auction_fees', v_r->>'auctionFees', 'transportation_cost', v_r->>'transportationCost'
          )
        );
        if (v_result->>'outcome') = 'created' then
          v_row := v_row || jsonb_build_object('status', 'created', 'vehicle_id', v_result->>'vehicle_id');
          v_counts := jsonb_set(v_counts, '{created}', to_jsonb((v_counts->>'created')::int + 1));
        elsif (v_result->>'outcome') = 'existing' then
          v_row := v_row || jsonb_build_object('status', 'existing', 'vehicle_id', v_result->>'vehicle_id');
          v_counts := jsonb_set(v_counts, '{existing}', to_jsonb((v_counts->>'existing')::int + 1));
        else
          v_row := v_row || jsonb_build_object('status', 'conflict', 'reason', v_result->>'reason');
          v_counts := jsonb_set(v_counts, '{conflict}', to_jsonb((v_counts->>'conflict')::int + 1));
        end if;
      exception when others then
        v_row := v_row || jsonb_build_object('status', 'failed', 'reason', sqlerrm);
        v_counts := jsonb_set(v_counts, '{failed}', to_jsonb((v_counts->>'failed')::int + 1));
      end;
    end if;
    v_out := v_out || jsonb_build_array(v_row);
  end loop;

  return jsonb_build_object('results', v_out, 'counts', v_counts);
end;
$$;

revoke execute on function public._intake_evaluate_rows(jsonb) from public, anon, authenticated;
revoke execute on function public.intake_evaluate_batch(jsonb) from public, anon;
revoke execute on function public.intake_commit_batch(jsonb) from public, anon;
grant execute on function public.intake_evaluate_batch(jsonb) to authenticated;
grant execute on function public.intake_commit_batch(jsonb) to authenticated;
