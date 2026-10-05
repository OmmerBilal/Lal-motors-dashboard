-- =====================================================================================
-- 0057 — Batch evaluation fix. ADDITIVE: replaces _intake_evaluate_rows only.
-- Migration 0056 appended literal values with the array || operator, which Postgres parses as array literals
-- ("malformed array literal"). The same logic now appends with array_append. Behaviour is otherwise identical.
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
    v_vin := array_append(v_vin, coalesce(public._norm_vin(r->>'vin'), ''));
    v_lot := array_append(v_lot, coalesce(public._norm_text(r->>'lotNumber'), ''));
    v_stock := array_append(v_stock, coalesce(public._norm_text(r->>'stockNumber'), ''));
    v_item := array_append(v_item, coalesce(public._norm_text(r->>'auctionItemNumber'), ''));
    v_canon := array_append(v_canon, lower(regexp_replace(coalesce(r->>'sourceText', '') || '|' || (r - 'uncertainFields' - 'sourceText')::text, '\s+', ' ', 'g')));
    v_status := array_append(v_status, 'new');
    v_reason := array_append(v_reason, ''::text);
    v_vehicle := array_append(v_vehicle, null::uuid);
    v_dup_of := array_append(v_dup_of, null::int);
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

