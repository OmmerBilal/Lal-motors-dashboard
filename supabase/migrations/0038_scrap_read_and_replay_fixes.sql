-- ---------------------------------------------------------------------------------------
-- 0038 — Scrap: fixes found by the RPC suite (rpc-scrap.mjs). ADDITIVE: replaces functions only.
--
--   1. The driver read RPCs (list loads, get load, list checks) were SECURITY INVOKER and called
--      _scrap_require_driver(), whose EXECUTE is (correctly) revoked from clients. They failed with
--      "permission denied" for the driver. They are now SECURITY DEFINER with the same explicit
--      filter on auth.uid(), so a driver still sees only their own rows.
--   2. Payment and correction replays returned the bare payment row, while the first call returns
--      { payment, expected_total, mismatch }. A replay now returns the same shape.
-- ---------------------------------------------------------------------------------------

create or replace function public.scrap_driver_list_loads(
  p_limit          int default 25,
  p_before_created timestamptz default null,
  p_before_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_rows jsonb;
  v_more boolean;
begin
  perform public._scrap_require_driver();
  with page as (
    select v.* from public.scrap_loads_driver_v v
     where v.driver_id = auth.uid()
       and (p_before_created is null or (v.created_at, v.id) < (p_before_created, p_before_id))
     order by v.created_at desc, v.id desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(to_jsonb(x) - 'rn' order by x.created_at desc, x.id desc) filter (where x.rn <= v_limit), '[]'::jsonb),
         coalesce(bool_or(x.rn > v_limit), false)
    into v_rows, v_more
    from (select p.*, row_number() over (order by p.created_at desc, p.id desc) as rn from page p) x;
  return jsonb_build_object('rows', v_rows, 'has_more', v_more);
end;
$$;

create or replace function public.scrap_driver_get_load(p_load_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  perform public._scrap_require_driver();
  select to_jsonb(v) into r from public.scrap_loads_driver_v v where v.id = p_load_id and v.driver_id = auth.uid();
  if r is null then
    raise exception 'load not found' using errcode = '22023';
  end if;
  return r;
end;
$$;

create or replace function public.scrap_driver_list_checks(p_limit int default 25)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._scrap_require_driver();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'created_at', c.created_at, 'has_photo', c.photo_asset_id is not null) order by c.created_at desc)
      from (select * from public.driver_check_submissions where driver_id = auth.uid() order by created_at desc
             limit least(greatest(coalesce(p_limit, 25), 1), 50)) c
  ), '[]'::jsonb);
end;
$$;

-- Same result shape for a first call and a replay: { payment, expected_total, mismatch, replay }.
create or replace function public._scrap_payment_result(p_payment_id uuid, p_replay boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'payment', to_jsonb(p),
    'expected_total', coalesce((select sum(f.amount) from public.scrap_payment_loads pl
                                  join public.scrap_load_financials f on f.scrap_load_id = pl.scrap_load_id
                                 where pl.payment_id = p.id), 0),
    'mismatch', exists (select 1 from public.scrap_discrepancies d
                         where d.scrap_payment_id = p.id and d.kind = 'payment_mismatch' and d.status = 'open'),
    'replay', p_replay)
    from public.scrap_payments p where p.id = p_payment_id;
$$;
revoke execute on function public._scrap_payment_result(uuid, boolean) from public, anon, authenticated;

create or replace function public.scrap_manager_record_payment(
  p_driver_id       uuid,
  p_load_ids        uuid[],
  p_amount_received numeric,
  p_method          text,
  p_reference       text default '',
  p_notes           text default '',
  p_payment_date    date default null,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_payment public.scrap_payments%rowtype;
  v_expected numeric(10,2);
  v_count int;
  v_name text;
  v_mismatch boolean;
  v_id uuid;
  v_load uuid;
begin
  perform public._scrap_require_office();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  select id into v_existing from public.scrap_payments where client_request_id = p_client_request_id;
  if v_existing is not null then
    return public._scrap_payment_result(v_existing, true);  -- replay
  end if;
  if p_method not in ('Check', 'ACH', 'Wire', 'Other') then
    raise exception 'unknown payment method' using errcode = '22023';
  end if;
  if p_amount_received is null or p_amount_received < 0 then
    raise exception 'the received amount cannot be negative' using errcode = '22023';
  end if;
  if p_load_ids is null or cardinality(p_load_ids) = 0 then
    raise exception 'select at least one load' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_load_ids) x) <> cardinality(p_load_ids) then
    raise exception 'a load can only be listed once' using errcode = '22023';
  end if;

  perform 1 from public.scrap_loads where id = any(p_load_ids) order by id for update;
  select count(*)::int into v_count from public.scrap_loads l
    join public.scrap_load_financials f on f.scrap_load_id = l.id
   where l.id = any(p_load_ids) and l.driver_id = p_driver_id and l.status = 'approved' and f.payment_id is null;
  if v_count <> cardinality(p_load_ids) then
    raise exception 'every selected load must be approved, unpaid, and belong to this driver' using errcode = 'P0001';
  end if;
  select coalesce(sum(f.amount), 0) into v_expected
    from public.scrap_load_financials f where f.scrap_load_id = any(p_load_ids);

  select name into v_name from public.profiles where id = auth.uid();
  insert into public.scrap_payments (driver_id, payment_date, amount_received, method, reference_number, notes, entered_by, client_request_id)
  values (p_driver_id, coalesce(p_payment_date, public._scrap_business_date()), round(p_amount_received, 2), p_method,
          coalesce(p_reference, ''), coalesce(p_notes, ''), auth.uid(), p_client_request_id)
  returning * into v_payment;
  v_id := v_payment.id;

  insert into public.scrap_payment_loads (payment_id, scrap_load_id)
  select v_id, x from unnest(p_load_ids) x;

  v_mismatch := round(p_amount_received, 2) <> v_expected;
  foreach v_load in array p_load_ids loop
    update public.scrap_load_financials set payment_id = v_id where scrap_load_id = v_load;
    if not v_mismatch then
      update public.scrap_loads set status = 'closed' where id = v_load;
    end if;
    perform public._scrap_record_event(v_load, 'payment_linked', 'approved', case when v_mismatch then 'approved' else 'closed' end,
      jsonb_build_object('payment_id', v_id, 'method', p_method), 'Linked to a ' || p_method || ' payment');
  end loop;

  if v_mismatch then
    insert into public.scrap_discrepancies (kind, status, scrap_payment_id, driver_id, note, opened_by, opened_by_name)
    values ('payment_mismatch', 'open', v_id, p_driver_id,
            'Received ' || round(p_amount_received, 2)::text || ' but the linked loads total ' || v_expected::text,
            auth.uid(), coalesce(v_name, 'unknown'));
    perform public.write_audit_log('scrap.payment.mismatch', 'scrap_payment', v_id,
      'Payment does not match linked loads', jsonb_build_object('received', round(p_amount_received, 2), 'expected', v_expected), null, null);
  end if;
  perform public.write_audit_log('scrap.payment.recorded', 'scrap_payment', v_id, 'Scrap payment recorded',
    jsonb_build_object('amount', round(p_amount_received, 2), 'expected', v_expected, 'loads', cardinality(p_load_ids), 'method', p_method), null, p_client_request_id);

  return public._scrap_payment_result(v_id, false);
end;
$$;

create or replace function public.scrap_manager_correct_payment(
  p_original_payment_id uuid,
  p_amount_received     numeric,
  p_load_ids            uuid[],
  p_reason              text,
  p_client_request_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.scrap_payments%rowtype;
  v_existing uuid;
  v_new public.scrap_payments%rowtype;
  v_expected numeric(10,2);
  v_count int;
  v_name text;
  v_mismatch boolean;
  v_load uuid;
begin
  perform public._scrap_require_office();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  select id into v_existing from public.scrap_payments where client_request_id = p_client_request_id;
  if v_existing is not null then
    return public._scrap_payment_result(v_existing, true);  -- replay
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a correction needs a reason of at least 5 characters' using errcode = '22023';
  end if;
  if p_amount_received is null or p_amount_received < 0 or p_load_ids is null or cardinality(p_load_ids) = 0 then
    raise exception 'enter the corrected amount and at least one load' using errcode = '22023';
  end if;
  select * into o from public.scrap_payments where id = p_original_payment_id for update;
  if not found then
    raise exception 'payment not found' using errcode = '22023';
  end if;
  if exists (select 1 from public.scrap_payments where correction_of = p_original_payment_id) then
    raise exception 'this payment was already corrected' using errcode = 'P0001';
  end if;

  perform 1 from public.scrap_loads where id in (select scrap_load_id from public.scrap_payment_loads where payment_id = p_original_payment_id)
     or id = any(p_load_ids) order by id for update;
  for v_load in select scrap_load_id from public.scrap_payment_loads where payment_id = p_original_payment_id loop
    update public.scrap_load_financials set payment_id = null where scrap_load_id = v_load;
    update public.scrap_loads set status = 'approved' where id = v_load and status = 'closed';
    perform public._scrap_record_event(v_load, 'payment_unlinked', 'closed', 'approved',
      jsonb_build_object('payment_id', p_original_payment_id), 'Unlinked by correction', btrim(p_reason));
  end loop;

  select count(*)::int into v_count from public.scrap_loads l
    join public.scrap_load_financials f on f.scrap_load_id = l.id
   where l.id = any(p_load_ids) and l.driver_id = o.driver_id and l.status = 'approved' and f.payment_id is null;
  if v_count <> cardinality(p_load_ids) then
    raise exception 'every corrected load must be approved, unpaid, and belong to the same driver' using errcode = 'P0001';
  end if;
  select coalesce(sum(f.amount), 0) into v_expected from public.scrap_load_financials f where f.scrap_load_id = any(p_load_ids);

  select name into v_name from public.profiles where id = auth.uid();
  insert into public.scrap_payments (driver_id, payment_date, amount_received, method, reference_number, notes, entered_by,
                                     correction_of, correction_reason, client_request_id)
  values (o.driver_id, public._scrap_business_date(), round(p_amount_received, 2), o.method, o.reference_number,
          'Correction of a recorded payment', auth.uid(), p_original_payment_id, btrim(p_reason), p_client_request_id)
  returning * into v_new;

  insert into public.scrap_payment_loads (payment_id, scrap_load_id) select v_new.id, x from unnest(p_load_ids) x;
  v_mismatch := round(p_amount_received, 2) <> v_expected;
  foreach v_load in array p_load_ids loop
    update public.scrap_load_financials set payment_id = v_new.id where scrap_load_id = v_load;
    if not v_mismatch then
      update public.scrap_loads set status = 'closed' where id = v_load;
    end if;
    perform public._scrap_record_event(v_load, 'payment_linked', 'approved', case when v_mismatch then 'approved' else 'closed' end,
      jsonb_build_object('payment_id', v_new.id, 'corrects', p_original_payment_id), 'Linked by payment correction', btrim(p_reason));
  end loop;

  update public.scrap_discrepancies
     set status = 'resolved', resolved_by = auth.uid(), resolved_by_name = coalesce(v_name, 'unknown'),
         resolved_at = now(), resolution_note = 'Superseded by payment correction ' || v_new.id::text
   where scrap_payment_id = p_original_payment_id and kind = 'payment_mismatch' and status = 'open';

  if v_mismatch then
    insert into public.scrap_discrepancies (kind, status, scrap_payment_id, driver_id, note, opened_by, opened_by_name)
    values ('payment_mismatch', 'open', v_new.id, o.driver_id,
            'Corrected amount ' || round(p_amount_received, 2)::text || ' vs linked loads ' || v_expected::text,
            auth.uid(), coalesce(v_name, 'unknown'));
  end if;
  perform public.write_audit_log('scrap.payment.corrected', 'scrap_payment', v_new.id, 'Scrap payment corrected',
    jsonb_build_object('corrects', p_original_payment_id, 'amount', round(p_amount_received, 2), 'expected', v_expected), btrim(p_reason), p_client_request_id);
  return public._scrap_payment_result(v_new.id, false);
end;
$$;
