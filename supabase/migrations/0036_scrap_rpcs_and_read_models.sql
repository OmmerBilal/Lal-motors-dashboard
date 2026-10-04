-- ---------------------------------------------------------------------------------------
-- 0036 — Scrap Driver + Scrap Management: read models and transactional RPCs.
--
-- ADDITIVE. Depends on 0035. Every state-changing operation is a SECURITY DEFINER RPC that:
--   1. authenticates the caller and checks the role (driver or scrap office);
--   2. locks the rows it changes and validates the CURRENT state;
--   3. calculates money and totals on the server (NUMERIC, never client-supplied);
--   4. writes the load event / audit row in the same transaction;
--   5. returns the truthful server state, and is replay-safe where a client request id is given.
--
-- Error codes: 28000 unauthenticated, 42501 forbidden, 22023 invalid input or not found,
-- P0001 state conflict (illegal transition, closed day, already done).
-- ---------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------
-- 1. Read models
-- ---------------------------------------------------------------------------------------

-- Driver-safe projection. NO financial columns, no payment link, no discrepancy data.
-- security_invoker: the caller's RLS (scrap_loads_read) limits it to the driver's own loads.
create or replace view public.scrap_loads_driver_v with (security_invoker = true) as
select sl.id,
       sl.driver_id,
       sl.load_date,
       sl.created_at,
       sl.delivered_at,
       sl.completed_at,
       sl.status,
       case
         when sl.status = 'new' and sl.delivered_at is null then 'saved'
         when sl.status = 'new' and sl.ticket_photo_asset_id is null then 'awaiting_ticket'
         when sl.status = 'new' then 'ticket_attached'
         else 'complete'
       end as driver_state,
       (sl.load_photo_asset_id is not null) as has_load_photo,
       (sl.ticket_photo_asset_id is not null) as has_ticket_photo,
       sl.load_photo_asset_id,
       sl.ticket_photo_asset_id
  from public.scrap_loads sl;
comment on view public.scrap_loads_driver_v is
  'Driver-facing load projection. Deliberately has no weight, rate, amount, notes or payment columns.';

-- Management projection. Owner-definer read model: NOT granted to clients, read only by the
-- scrap_manager_* RPCs, which check is_scrap_office() first.
create or replace view public.scrap_loads_manager_v as
select sl.id,
       sl.driver_id,
       p.name as driver_name,
       sl.load_date,
       sl.created_at,
       sl.delivered_at,
       sl.completed_at,
       sl.status,
       case
         when sl.status = 'new' and sl.delivered_at is null then 'in_progress'
         when sl.status = 'new' and sl.ticket_photo_asset_id is null and sl.load_date < public._scrap_business_date() then 'ticket_missing'
         when sl.status = 'new' and sl.ticket_photo_asset_id is null then 'awaiting_ticket'
         when sl.status = 'new' then 'ready_to_complete'
         else sl.status
       end as state,
       (sl.load_photo_asset_id is not null) as has_load_photo,
       (sl.ticket_photo_asset_id is not null) as has_ticket_photo,
       sl.load_photo_asset_id,
       sl.ticket_photo_asset_id,
       f.weight,
       f.rate,
       f.amount,
       f.amount_override_reason,
       f.manager_notes,
       f.payment_id,
       case
         when sl.status = 'closed' then 'paid'
         when f.payment_id is not null and exists (
              select 1 from public.scrap_discrepancies d
               where d.kind = 'payment_mismatch' and d.status = 'open' and d.scrap_payment_id = f.payment_id) then 'mismatch'
         when sl.status = 'approved' then 'payment_pending'
         else 'not_due'
       end as payment_status,
       (select count(*)::int from public.scrap_discrepancies d
         where d.status = 'open'
           and (d.scrap_load_id = sl.id or (f.payment_id is not null and d.scrap_payment_id = f.payment_id))) as open_discrepancies
  from public.scrap_loads sl
  join public.profiles p on p.id = sl.driver_id
  left join public.scrap_load_financials f on f.scrap_load_id = sl.id;

revoke all on public.scrap_loads_manager_v from public, anon, authenticated;
revoke all on public.scrap_loads_driver_v from public, anon;
grant select on public.scrap_loads_driver_v to authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. Internal helpers (never granted to clients)
-- ---------------------------------------------------------------------------------------

create or replace function public._scrap_manager_load_json(p_load_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(v) from public.scrap_loads_manager_v v where v.id = p_load_id;
$$;
revoke execute on function public._scrap_manager_load_json(uuid) from public, anon, authenticated;

-- Locks one load that belongs to the calling driver. Not found is reported the same way as
-- another driver's load, so ids cannot be probed.
create or replace function public._scrap_driver_load_locked(p_load_id uuid)
returns public.scrap_loads
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.scrap_loads%rowtype;
begin
  select * into r from public.scrap_loads where id = p_load_id and driver_id = auth.uid() for update;
  if not found then
    raise exception 'load not found' using errcode = '22023';
  end if;
  return r;
end;
$$;
revoke execute on function public._scrap_driver_load_locked(uuid) from public, anon, authenticated;

create or replace function public._scrap_check_media(
  p_media_id   uuid,
  p_owner_type text,
  p_owner_id   uuid,
  p_role       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.media_assets%rowtype;
begin
  select * into m from public.media_assets where id = p_media_id;
  if not found
     or m.owner_type <> p_owner_type
     or m.owner_id <> p_owner_id
     or m.role is distinct from p_role
     or m.variant <> 'original'
     or m.status <> 'ready'
     or m.uploaded_by is distinct from auth.uid() then
    raise exception 'the photo is not ready or does not belong to this record' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public._scrap_check_media(uuid, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. Scrap Driver RPCs (role: scrap_driver). Evidence only: no amounts, ever.
-- ---------------------------------------------------------------------------------------

create or replace function public.scrap_driver_create_load(p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_owner uuid;
begin
  perform public._scrap_require_driver();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;

  -- Replay: the same request returns the same load. Another driver's request id is refused.
  select id, driver_id into v_id, v_owner from public.scrap_loads where client_request_id = p_client_request_id;
  if v_id is not null then
    if v_owner <> auth.uid() then
      raise exception 'invalid request' using errcode = '22023';
    end if;
    return (select to_jsonb(v) from public.scrap_loads_driver_v v where v.id = v_id);
  end if;

  insert into public.scrap_loads (driver_id, load_date, status, client_request_id)
  values (auth.uid(), public._scrap_business_date(), 'new', p_client_request_id)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    -- A concurrent retry inserted it first.
    select id into v_id from public.scrap_loads where client_request_id = p_client_request_id;
    return (select to_jsonb(v) from public.scrap_loads_driver_v v where v.id = v_id);
  end if;

  perform public._scrap_record_event(v_id, 'load_created', null, 'new', '{}'::jsonb, 'Scrap load created');
  return (select to_jsonb(v) from public.scrap_loads_driver_v v where v.id = v_id);
end;
$$;

create or replace function public.scrap_driver_attach_photo(p_load_id uuid, p_kind text, p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.scrap_loads%rowtype;
  v_role text;
  v_current uuid;
begin
  perform public._scrap_require_driver();
  if p_kind not in ('load', 'ticket') then
    raise exception 'unknown photo kind' using errcode = '22023';
  end if;
  v_role := case p_kind when 'load' then 'load_photo' else 'ticket_photo' end;
  l := public._scrap_driver_load_locked(p_load_id);

  if public._scrap_day_closed(l.load_date) then
    raise exception 'this day is closed; the load can no longer change' using errcode = 'P0001';
  end if;
  if l.status <> 'new' then
    raise exception 'this load is no longer open for photos' using errcode = 'P0001';
  end if;
  if p_kind = 'load' and l.delivered_at is not null then
    raise exception 'the load photo is locked once the load is delivered' using errcode = 'P0001';
  end if;
  if p_kind = 'ticket' and l.delivered_at is null then
    raise exception 'mark the load delivered before adding the ticket' using errcode = 'P0001';
  end if;

  v_current := case p_kind when 'load' then l.load_photo_asset_id else l.ticket_photo_asset_id end;
  if v_current = p_media_id then
    return (select to_jsonb(v) from public.scrap_loads_driver_v v where v.id = p_load_id);  -- replay
  end if;
  perform public._scrap_check_media(p_media_id, 'scrap_load', p_load_id, v_role);

  if p_kind = 'load' then
    update public.scrap_loads set load_photo_asset_id = p_media_id where id = p_load_id;
    perform public._scrap_record_event(p_load_id, 'load_photo_attached', l.status, l.status, jsonb_build_object('media_id', p_media_id), 'Load photo attached');
  else
    update public.scrap_loads set ticket_photo_asset_id = p_media_id where id = p_load_id;
    perform public._scrap_record_event(p_load_id, 'ticket_attached', l.status, l.status, jsonb_build_object('media_id', p_media_id), 'Ticket photo attached');
  end if;
  return (select to_jsonb(v) from public.scrap_loads_driver_v v where v.id = p_load_id);
end;
$$;

create or replace function public.scrap_driver_mark_delivered(p_load_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.scrap_loads%rowtype;
begin
  perform public._scrap_require_driver();
  l := public._scrap_driver_load_locked(p_load_id);
  if l.delivered_at is not null then
    return (select to_jsonb(v) from public.scrap_loads_driver_v v where v.id = p_load_id);  -- replay
  end if;
  if public._scrap_day_closed(l.load_date) then
    raise exception 'this day is closed; the load can no longer change' using errcode = 'P0001';
  end if;
  if l.status <> 'new' then
    raise exception 'this load is no longer open' using errcode = 'P0001';
  end if;
  if l.load_photo_asset_id is null then
    raise exception 'take the load photo before marking the load delivered' using errcode = 'P0001';
  end if;
  update public.scrap_loads set delivered_at = now() where id = p_load_id;
  perform public._scrap_record_event(p_load_id, 'delivered', 'new', 'new', '{}'::jsonb, 'Load marked delivered');
  return (select to_jsonb(v) from public.scrap_loads_driver_v v where v.id = p_load_id);
end;
$$;

create or replace function public.scrap_driver_complete_load(p_load_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.scrap_loads%rowtype;
begin
  perform public._scrap_require_driver();
  l := public._scrap_driver_load_locked(p_load_id);
  -- Double complete is safe: an already-completed load returns its current state.
  if l.status <> 'new' then
    return (select to_jsonb(v) from public.scrap_loads_driver_v v where v.id = p_load_id);
  end if;
  if public._scrap_day_closed(l.load_date) then
    raise exception 'this day is closed; the load can no longer change' using errcode = 'P0001';
  end if;
  if l.load_photo_asset_id is null then
    raise exception 'the load photo is required before completing' using errcode = 'P0001';
  end if;
  if l.delivered_at is null then
    raise exception 'mark the load delivered before completing' using errcode = 'P0001';
  end if;
  if l.ticket_photo_asset_id is null then
    raise exception 'the ticket photo is required before completing' using errcode = 'P0001';
  end if;

  update public.scrap_loads
     set status = 'ready_for_review', completed_at = now(), completed_by = auth.uid()
   where id = p_load_id;
  perform public._scrap_record_event(p_load_id, 'completed', 'new', 'ready_for_review', '{}'::jsonb, 'Load completed by driver');
  return (select to_jsonb(v) from public.scrap_loads_driver_v v where v.id = p_load_id);
end;
$$;

-- Check evidence. A check is created first so its photo can be attached to it. The check has no
-- amount, by design: the driver never enters a financial value.
create or replace function public.scrap_driver_create_check(p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_owner uuid;
begin
  perform public._scrap_require_driver();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  select id, driver_id into v_id, v_owner from public.driver_check_submissions where client_request_id = p_client_request_id;
  if v_id is null then
    insert into public.driver_check_submissions (driver_id, client_request_id)
    values (auth.uid(), p_client_request_id)
    returning id into v_id;
    perform public.write_audit_log('scrap.check.created', 'driver_check', v_id, 'Driver check evidence created', '{}'::jsonb, null, null);
  elsif v_owner <> auth.uid() then
    raise exception 'invalid request' using errcode = '22023';
  end if;
  return (select jsonb_build_object('id', c.id, 'created_at', c.created_at, 'has_photo', c.photo_asset_id is not null)
            from public.driver_check_submissions c where c.id = v_id);
end;
$$;

create or replace function public.scrap_driver_attach_check_photo(p_check_id uuid, p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.driver_check_submissions%rowtype;
begin
  perform public._scrap_require_driver();
  select * into c from public.driver_check_submissions where id = p_check_id and driver_id = auth.uid() for update;
  if not found then
    raise exception 'check not found' using errcode = '22023';
  end if;
  if c.photo_asset_id is not null then
    if c.photo_asset_id = p_media_id then
      return jsonb_build_object('id', c.id, 'has_photo', true);  -- replay
    end if;
    raise exception 'a photo is already attached to this check' using errcode = 'P0001';
  end if;
  if public._scrap_day_closed((c.created_at at time zone 'America/New_York')::date) then
    raise exception 'this day is closed; the check can no longer change' using errcode = 'P0001';
  end if;
  perform public._scrap_check_media(p_media_id, 'driver_check', p_check_id, 'check_photo');
  update public.driver_check_submissions set photo_asset_id = p_media_id where id = p_check_id;
  perform public.write_audit_log('scrap.check.photo_attached', 'driver_check', p_check_id, 'Check photo attached', jsonb_build_object('media_id', p_media_id), null, null);
  return jsonb_build_object('id', p_check_id, 'has_photo', true);
end;
$$;

-- Driver lists are keyset-paged and limited to the caller's own rows.
create or replace function public.scrap_driver_list_loads(
  p_limit          int default 25,
  p_before_created timestamptz default null,
  p_before_id      uuid default null
)
returns jsonb
language plpgsql
security invoker
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
  select coalesce(jsonb_agg((to_jsonb(x) - 'rn') order by x.created_at desc, x.id desc) filter (where x.rn <= v_limit), '[]'::jsonb),
         coalesce(bool_or(x.rn > v_limit), false)
    into v_rows, v_more
    from (select p.*, row_number() over (order by p.created_at desc, p.id desc) as rn from page p) x;
  return jsonb_build_object('rows', v_rows, 'has_more', v_more);
end;
$$;

create or replace function public.scrap_driver_get_load(p_load_id uuid)
returns jsonb
language plpgsql
security invoker
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
security invoker
set search_path = public
as $$
begin
  perform public._scrap_require_driver();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'created_at', c.created_at, 'has_photo', c.photo_asset_id is not null) order by c.created_at desc)
      from (select * from public.driver_check_submissions where driver_id = auth.uid() order by created_at desc limit least(greatest(coalesce(p_limit, 25), 1), 50)) c
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Scrap management reads (office). Definer, after an explicit role check.
-- ---------------------------------------------------------------------------------------

create or replace function public.scrap_manager_summary(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._scrap_require_office();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'choose a date range of up to one year' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'loads_in_range', (select count(*)::int from public.scrap_loads_manager_v where load_date between p_from and p_to),
    'completed_in_range', (select count(*)::int from public.scrap_loads_manager_v where load_date between p_from and p_to and status in ('approved', 'closed')),
    'weight_in_range', coalesce((select sum(weight) from public.scrap_loads_manager_v where load_date between p_from and p_to and status in ('approved', 'closed')), 0),
    'amount_in_range', coalesce((select sum(amount) from public.scrap_loads_manager_v where load_date between p_from and p_to and status in ('approved', 'closed')), 0),
    'payments_received_in_range', coalesce((select sum(amount_received) from public.scrap_payments where payment_date between p_from and p_to and correction_of is null), 0),
    'open_now', (select count(*)::int from public.scrap_loads_manager_v where status in ('new', 'ready_for_review')),
    'awaiting_ticket_now', (select count(*)::int from public.scrap_loads_manager_v where state in ('awaiting_ticket', 'ticket_missing')),
    'ticket_missing_now', (select count(*)::int from public.scrap_loads_manager_v where state = 'ticket_missing'),
    'needs_review_now', (select count(*)::int from public.scrap_loads_manager_v where status = 'ready_for_review'),
    'payment_pending_now', (select count(*)::int from public.scrap_loads_manager_v where payment_status = 'payment_pending'),
    'discrepancies_open_now', (select count(*)::int from public.scrap_discrepancies where status = 'open'),
    'tire_rim_open_obligations', (select count(*)::int from public.rim_obligations where status = 'open'),
    'tire_rim_remaining_aluminum', coalesce((select sum(o.aluminum_owed - coalesce(r.returned, 0)) from public.rim_obligations o
         left join (select obligation_id, sum(aluminum_returned) returned from public.rim_returns group by obligation_id) r on r.obligation_id = o.id
         where o.status = 'open'), 0),
    'tire_rim_remaining_steel', coalesce((select sum(o.steel_owed - coalesce(r.returned, 0)) from public.rim_obligations o
         left join (select obligation_id, sum(steel_returned) returned from public.rim_returns group by obligation_id) r on r.obligation_id = o.id
         where o.status = 'open'), 0),
    'day_closed_today', public._scrap_day_closed(public._scrap_business_date()),
    'by_driver', coalesce((
        select jsonb_agg(jsonb_build_object('driver_id', d.driver_id, 'name', d.driver_name, 'loads', d.loads, 'completed', d.completed,
                                            'weight', d.weight, 'amount', d.amount) order by d.driver_name)
          from (
            select driver_id, driver_name, count(*)::int as loads,
                   count(*) filter (where status in ('approved', 'closed'))::int as completed,
                   coalesce(sum(weight) filter (where status in ('approved', 'closed')), 0) as weight,
                   coalesce(sum(amount) filter (where status in ('approved', 'closed')), 0) as amount
              from public.scrap_loads_manager_v
             where load_date between p_from and p_to
             group by driver_id, driver_name
          ) d
      ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- Filtered, keyset-paged load list for the management dashboard and reports.
-- p_bucket: all | open | awaiting_ticket | needs_review | completed | discrepancy | unpaid
create or replace function public.scrap_manager_list_loads(
  p_bucket         text default 'all',
  p_from           date default null,
  p_to             date default null,
  p_driver         uuid default null,
  p_limit          int default 25,
  p_before_date    date default null,
  p_before_created timestamptz default null,
  p_before_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_rows jsonb;
  v_more boolean;
begin
  perform public._scrap_require_office();
  if p_bucket not in ('all', 'open', 'awaiting_ticket', 'needs_review', 'completed', 'discrepancy', 'unpaid') then
    raise exception 'unknown list' using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and (p_to < p_from or p_to - p_from > 366) then
    raise exception 'choose a date range of up to one year' using errcode = '22023';
  end if;

  with page as (
    select v.* from public.scrap_loads_manager_v v
     where (p_from is null or v.load_date >= p_from)
       and (p_to is null or v.load_date <= p_to)
       and (p_driver is null or v.driver_id = p_driver)
       and case p_bucket
             when 'all' then true
             when 'open' then v.status in ('new', 'ready_for_review')
             when 'awaiting_ticket' then v.state in ('awaiting_ticket', 'ticket_missing')
             when 'needs_review' then v.status = 'ready_for_review'
             when 'completed' then v.status in ('approved', 'closed')
             when 'discrepancy' then v.open_discrepancies > 0
             when 'unpaid' then v.payment_status in ('payment_pending', 'mismatch')
           end
       and (p_before_created is null or (v.load_date, v.created_at, v.id) < (p_before_date, p_before_created, p_before_id))
     order by v.load_date desc, v.created_at desc, v.id desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg((to_jsonb(x) - 'rn') order by x.load_date desc, x.created_at desc, x.id desc) filter (where x.rn <= v_limit), '[]'::jsonb),
         coalesce(bool_or(x.rn > v_limit), false)
    into v_rows, v_more
    from (select p.*, row_number() over (order by p.load_date desc, p.created_at desc, p.id desc) as rn from page p) x;
  return jsonb_build_object('rows', v_rows, 'has_more', v_more);
end;
$$;

create or replace function public.scrap_manager_get_load(p_load_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_load jsonb;
begin
  perform public._scrap_require_office();
  v_load := public._scrap_manager_load_json(p_load_id);
  if v_load is null then
    raise exception 'load not found' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'load', v_load,
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'from_status', e.from_status,
                              'to_status', e.to_status, 'actor_name', e.actor_name, 'detail', e.detail, 'created_at', e.created_at)
                            order by e.created_at desc)
                          from (select * from public.scrap_load_events where scrap_load_id = p_load_id order by created_at desc limit 200) e), '[]'::jsonb),
    'discrepancies', coalesce((select jsonb_agg(to_jsonb(d) order by d.opened_at desc)
                                 from public.scrap_discrepancies d
                                where d.scrap_load_id = p_load_id
                                   or d.scrap_payment_id = (select payment_id from public.scrap_load_financials where scrap_load_id = p_load_id)), '[]'::jsonb),
    'payment', (select jsonb_build_object('id', p.id, 'payment_date', p.payment_date, 'amount_received', p.amount_received,
                         'method', p.method, 'reference_number', p.reference_number, 'proof_asset_id', p.proof_asset_id,
                         'correction_of', p.correction_of)
                  from public.scrap_load_financials f join public.scrap_payments p on p.id = f.payment_id
                 where f.scrap_load_id = p_load_id)
  );
end;
$$;

create or replace function public.scrap_manager_list_payments(p_limit int default 25, p_before_created timestamptz default null, p_before_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_rows jsonb;
  v_more boolean;
begin
  perform public._scrap_require_office();
  with page as (
    select p.id, p.driver_id, pr.name as driver_name, p.payment_date, p.amount_received, p.method, p.reference_number,
           p.proof_asset_id, p.notes, p.correction_of, p.correction_reason, p.created_at,
           (select count(*)::int from public.scrap_payment_loads pl where pl.payment_id = p.id) as load_count,
           coalesce((select sum(f.amount) from public.scrap_payment_loads pl join public.scrap_load_financials f on f.scrap_load_id = pl.scrap_load_id
                      where pl.payment_id = p.id), 0) as expected_total,
           exists (select 1 from public.scrap_discrepancies d where d.scrap_payment_id = p.id and d.status = 'open') as has_open_discrepancy
      from public.scrap_payments p
      join public.profiles pr on pr.id = p.driver_id
     where p_before_created is null or (p.created_at, p.id) < (p_before_created, p_before_id)
     order by p.created_at desc, p.id desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg((to_jsonb(x) - 'rn') order by x.created_at desc, x.id desc) filter (where x.rn <= v_limit), '[]'::jsonb),
         coalesce(bool_or(x.rn > v_limit), false)
    into v_rows, v_more
    from (select p.*, row_number() over (order by p.created_at desc, p.id desc) as rn from page p) x;
  return jsonb_build_object('rows', v_rows, 'has_more', v_more);
end;
$$;

create or replace function public.scrap_manager_list_checks(p_unlinked_only boolean default false, p_limit int default 25)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._scrap_require_office();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'driver_id', c.driver_id, 'driver_name', pr.name, 'created_at', c.created_at,
                                        'has_photo', c.photo_asset_id is not null, 'photo_asset_id', c.photo_asset_id,
                                        'linked_payment_id', c.linked_payment_id) order by c.created_at desc)
      from (select * from public.driver_check_submissions
             where not p_unlinked_only or linked_payment_id is null
             order by created_at desc limit least(greatest(coalesce(p_limit, 25), 1), 100)) c
      join public.profiles pr on pr.id = c.driver_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.scrap_manager_list_discrepancies(p_status text default 'open', p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._scrap_require_office();
  if p_status not in ('open', 'resolved', 'all') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(d) order by d.opened_at desc)
      from (select * from public.scrap_discrepancies
             where p_status = 'all' or status = p_status
             order by opened_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) d
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Management writes (office). Every one: role check, lock, state check, audit.
-- ---------------------------------------------------------------------------------------

-- Measurement from the weighing ticket. Weight x rate is calculated here, in NUMERIC.
-- Before approval only; afterwards use scrap_manager_correct_financials with a reason.
create or replace function public.scrap_manager_set_measurement(
  p_load_id         uuid,
  p_weight          numeric,
  p_rate            numeric,
  p_amount_override numeric default null,
  p_override_reason text default null,
  p_notes           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.scrap_loads%rowtype;
  f public.scrap_load_financials%rowtype;
  v_amount numeric(10,2);
  v_weight numeric(10,2);
  v_rate numeric(8,4);
  v_override_reason text;
begin
  perform public._scrap_require_office();
  select * into l from public.scrap_loads where id = p_load_id for update;
  if not found then
    raise exception 'load not found' using errcode = '22023';
  end if;
  if l.status not in ('new', 'ready_for_review') then
    raise exception 'this load is already approved; use a correction with a reason' using errcode = 'P0001';
  end if;
  if public._scrap_day_closed(l.load_date) then
    raise exception 'this day is closed; use a correction with a reason' using errcode = 'P0001';
  end if;

  if p_weight is not null and p_rate is not null then
    if p_weight <= 0 or p_rate <= 0 then
      raise exception 'weight and rate must be greater than zero' using errcode = '22023';
    end if;
    if p_amount_override is not null then
      raise exception 'an amount override is only used when weight or rate is missing' using errcode = '22023';
    end if;
    v_weight := p_weight;
    v_rate := p_rate;
    v_amount := round(p_weight * p_rate, 2);
  elsif p_amount_override is not null then
    if p_amount_override < 0 then
      raise exception 'the amount cannot be negative' using errcode = '22023';
    end if;
    if char_length(btrim(coalesce(p_override_reason, ''))) < 5 then
      raise exception 'an amount without weight and rate needs a reason of at least 5 characters' using errcode = '22023';
    end if;
    v_weight := p_weight;
    v_rate := p_rate;
    v_amount := round(p_amount_override, 2);
    v_override_reason := btrim(p_override_reason);
  else
    raise exception 'enter weight and rate, or an amount with a reason' using errcode = '22023';
  end if;

  select * into f from public.scrap_load_financials where scrap_load_id = p_load_id for update;
  insert into public.scrap_load_financials (scrap_load_id, weight, rate, amount, manager_notes, amount_override_reason, measured_by, measured_at)
  values (p_load_id, v_weight, v_rate, v_amount, coalesce(p_notes, ''), v_override_reason, auth.uid(), now())
  on conflict (scrap_load_id) do update
     set weight = excluded.weight, rate = excluded.rate, amount = excluded.amount,
         manager_notes = coalesce(p_notes, public.scrap_load_financials.manager_notes),
         amount_override_reason = excluded.amount_override_reason, measured_by = excluded.measured_by, measured_at = excluded.measured_at;

  if f.scrap_load_id is null or f.weight is distinct from v_weight or f.rate is distinct from v_rate or f.amount is distinct from v_amount then
    perform public._scrap_record_event(p_load_id, 'measurement_recorded', l.status, l.status,
      jsonb_build_object('old_weight', f.weight, 'new_weight', v_weight, 'old_rate', f.rate, 'new_rate', v_rate,
                         'old_amount', f.amount, 'new_amount', v_amount, 'override_reason', v_override_reason),
      'Weight and rate recorded', v_override_reason);
  end if;
  return public._scrap_manager_load_json(p_load_id);
end;
$$;

-- Correction of a finalized financial record. Reason required; history kept; refused while the
-- load is linked to a payment (correct the payment first, so the reconciliation cannot drift).
create or replace function public.scrap_manager_correct_financials(
  p_load_id         uuid,
  p_weight          numeric,
  p_rate            numeric,
  p_amount_override numeric default null,
  p_reason          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.scrap_loads%rowtype;
  f public.scrap_load_financials%rowtype;
  v_amount numeric(10,2);
begin
  perform public._scrap_require_office();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a correction needs a reason of at least 5 characters' using errcode = '22023';
  end if;
  select * into l from public.scrap_loads where id = p_load_id for update;
  if not found then
    raise exception 'load not found' using errcode = '22023';
  end if;
  select * into f from public.scrap_load_financials where scrap_load_id = p_load_id for update;
  if f.payment_id is not null then
    raise exception 'this load is linked to a payment; correct the payment first' using errcode = 'P0001';
  end if;
  if p_weight is not null and p_rate is not null then
    if p_weight <= 0 or p_rate <= 0 then
      raise exception 'weight and rate must be greater than zero' using errcode = '22023';
    end if;
    v_amount := round(p_weight * p_rate, 2);
  elsif p_amount_override is not null and p_amount_override >= 0 then
    v_amount := round(p_amount_override, 2);
  else
    raise exception 'enter weight and rate, or an amount' using errcode = '22023';
  end if;

  update public.scrap_load_financials
     set weight = p_weight, rate = p_rate, amount = v_amount,
         amount_override_reason = case when p_weight is null or p_rate is null then btrim(p_reason) else null end,
         measured_by = auth.uid(), measured_at = now()
   where scrap_load_id = p_load_id;
  perform public._scrap_record_event(p_load_id, 'financials_corrected', l.status, l.status,
    jsonb_build_object('old_weight', f.weight, 'new_weight', p_weight, 'old_rate', f.rate, 'new_rate', p_rate,
                       'old_amount', f.amount, 'new_amount', v_amount),
    'Financial record corrected', btrim(p_reason));
  return public._scrap_manager_load_json(p_load_id);
end;
$$;

create or replace function public.scrap_manager_approve_load(p_load_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.scrap_loads%rowtype;
  v_amount numeric(10,2);
  v_open int;
begin
  perform public._scrap_require_office();
  select * into l from public.scrap_loads where id = p_load_id for update;
  if not found then
    raise exception 'load not found' using errcode = '22023';
  end if;
  if l.status in ('approved', 'closed') then
    return public._scrap_manager_load_json(p_load_id);  -- replay
  end if;
  if l.status <> 'ready_for_review' then
    raise exception 'only a completed load can be approved' using errcode = 'P0001';
  end if;
  if public._scrap_day_closed(l.load_date) then
    raise exception 'this day is closed' using errcode = 'P0001';
  end if;
  select amount into v_amount from public.scrap_load_financials where scrap_load_id = p_load_id;
  if v_amount is null then
    raise exception 'record the weight and rate before approving' using errcode = 'P0001';
  end if;
  select count(*)::int into v_open from public.scrap_discrepancies where scrap_load_id = p_load_id and status = 'open';
  if v_open > 0 then
    raise exception 'resolve the open discrepancies on this load before approving' using errcode = 'P0001';
  end if;

  update public.scrap_loads set status = 'approved' where id = p_load_id;
  perform public._scrap_record_event(p_load_id, 'approved', 'ready_for_review', 'approved',
    jsonb_build_object('amount', v_amount), 'Load approved');
  return public._scrap_manager_load_json(p_load_id);
end;
$$;

create or replace function public.scrap_manager_open_discrepancy(
  p_kind       text,
  p_load_id    uuid default null,
  p_payment_id uuid default null,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_driver uuid;
  v_name text;
begin
  perform public._scrap_require_office();
  if p_kind not in ('ticket_missing', 'ticket_photo_mismatch', 'missing_check_evidence', 'incomplete_load_evidence', 'unresolved_amount', 'other') then
    raise exception 'this discrepancy kind is recorded by the system, not by hand' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'a discrepancy needs a note of at least 5 characters' using errcode = '22023';
  end if;
  if (p_load_id is null) = (p_payment_id is null) then
    raise exception 'a discrepancy is linked to exactly one load or one payment' using errcode = '22023';
  end if;
  if p_load_id is not null then
    select driver_id into v_driver from public.scrap_loads where id = p_load_id;
    if v_driver is null then raise exception 'load not found' using errcode = '22023'; end if;
  else
    select driver_id into v_driver from public.scrap_payments where id = p_payment_id;
    if v_driver is null then raise exception 'payment not found' using errcode = '22023'; end if;
  end if;

  select name into v_name from public.profiles where id = auth.uid();
  begin
    insert into public.scrap_discrepancies (kind, status, scrap_load_id, scrap_payment_id, driver_id, note, opened_by, opened_by_name)
    values (p_kind, 'open', p_load_id, p_payment_id, v_driver, btrim(p_note), auth.uid(), coalesce(v_name, 'unknown'))
    returning id into v_id;
  exception when unique_violation then
    -- An open discrepancy of this kind already exists for the target: return it, add nothing.
    select id into v_id from public.scrap_discrepancies
     where status = 'open' and kind = p_kind
       and (scrap_load_id is not distinct from p_load_id) and (scrap_payment_id is not distinct from p_payment_id);
    return (select to_jsonb(d) from public.scrap_discrepancies d where d.id = v_id);
  end;

  if p_load_id is not null then
    perform public._scrap_record_event(p_load_id, 'discrepancy_opened', null, null,
      jsonb_build_object('discrepancy_id', v_id, 'kind', p_kind), 'Discrepancy opened: ' || p_kind, btrim(p_note));
  else
    perform public.write_audit_log('scrap.discrepancy.opened', 'scrap_payment', p_payment_id,
      'Discrepancy opened: ' || p_kind, jsonb_build_object('discrepancy_id', v_id), btrim(p_note), null);
  end if;
  return (select to_jsonb(d) from public.scrap_discrepancies d where d.id = v_id);
end;
$$;

-- Resolving a payment mismatch closes the linked loads as paid (the variance is accepted with a
-- reason). Resolving never edits the payment or the amounts.
create or replace function public.scrap_manager_resolve_discrepancy(p_discrepancy_id uuid, p_resolution_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.scrap_discrepancies%rowtype;
  v_name text;
  r record;
begin
  perform public._scrap_require_office();
  if char_length(btrim(coalesce(p_resolution_note, ''))) < 5 then
    raise exception 'a resolution needs a note of at least 5 characters' using errcode = '22023';
  end if;
  select * into d from public.scrap_discrepancies where id = p_discrepancy_id for update;
  if not found then
    raise exception 'discrepancy not found' using errcode = '22023';
  end if;
  if d.status = 'resolved' then
    return to_jsonb(d);  -- replay
  end if;
  select name into v_name from public.profiles where id = auth.uid();

  update public.scrap_discrepancies
     set status = 'resolved', resolved_by = auth.uid(), resolved_by_name = coalesce(v_name, 'unknown'),
         resolved_at = now(), resolution_note = btrim(p_resolution_note)
   where id = d.id;

  if d.kind = 'payment_mismatch' and d.scrap_payment_id is not null then
    for r in
      select f.scrap_load_id, sl.status from public.scrap_load_financials f
        join public.scrap_loads sl on sl.id = f.scrap_load_id
       where f.payment_id = d.scrap_payment_id and sl.status = 'approved'
       for update of sl
    loop
      update public.scrap_loads set status = 'closed' where id = r.scrap_load_id;
      perform public._scrap_record_event(r.scrap_load_id, 'discrepancy_resolved', 'approved', 'closed',
        jsonb_build_object('discrepancy_id', d.id, 'kind', d.kind), 'Payment variance accepted; load closed as paid', btrim(p_resolution_note));
    end loop;
  elsif d.scrap_load_id is not null then
    perform public._scrap_record_event(d.scrap_load_id, 'discrepancy_resolved', null, null,
      jsonb_build_object('discrepancy_id', d.id, 'kind', d.kind), 'Discrepancy resolved: ' || d.kind, btrim(p_resolution_note));
  else
    perform public.write_audit_log('scrap.discrepancy.resolved', 'scrap_payment', d.scrap_payment_id,
      'Discrepancy resolved: ' || d.kind, jsonb_build_object('discrepancy_id', d.id), btrim(p_resolution_note), null);
  end if;
  return (select to_jsonb(x) from public.scrap_discrepancies x where x.id = d.id);
end;
$$;

-- Payment (check, ACH, wire, other) against one or more approved loads of one driver.
-- Total = sum of the linked loads' server-side amounts. A different received amount is recorded
-- as-is AND opens a payment_mismatch discrepancy, so it is never silently absorbed.
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
    return (select to_jsonb(p) from public.scrap_payments p where p.id = v_existing);  -- replay
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

  -- Lock the loads in a fixed order, then check each one.
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

  return jsonb_build_object('payment', to_jsonb(v_payment), 'expected_total', v_expected, 'mismatch', v_mismatch);
end;
$$;

-- Proof photo for a payment. Attachable once; the payment row is otherwise immutable (trigger).
create or replace function public.scrap_manager_attach_payment_proof(p_payment_id uuid, p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.scrap_payments%rowtype;
begin
  perform public._scrap_require_office();
  select * into p from public.scrap_payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment not found' using errcode = '22023';
  end if;
  if p.proof_asset_id is not null then
    if p.proof_asset_id = p_media_id then
      return to_jsonb(p);  -- replay
    end if;
    raise exception 'a proof photo is already attached' using errcode = 'P0001';
  end if;
  perform public._scrap_check_media(p_media_id, 'scrap_payment', p_payment_id, 'proof');
  update public.scrap_payments set proof_asset_id = p_media_id where id = p_payment_id;
  perform public.write_audit_log('scrap.payment.proof_attached', 'scrap_payment', p_payment_id, 'Payment proof attached',
    jsonb_build_object('media_id', p_media_id), null, null);
  return (select to_jsonb(x) from public.scrap_payments x where x.id = p_payment_id);
end;
$$;

-- Correction of a recorded payment: the original stays as it is, a new row references it with a
-- reason, the loads are unlinked from the original and linked to the correction, and any open
-- mismatch on the original is resolved with that reason.
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
    return (select to_jsonb(x) from public.scrap_payments x where x.id = v_existing);  -- replay
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

  -- Unlink the original's loads (they go back to approved, unpaid), then lock and check the new set.
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

  -- The original's open mismatch is superseded by the correction, with its reason.
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
  return jsonb_build_object('payment', to_jsonb(v_new), 'expected_total', v_expected, 'mismatch', v_mismatch);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Tire / rim obligations (office). Customers are the existing customers table.
-- ---------------------------------------------------------------------------------------

create or replace function public.scrap_manager_create_rim_obligation(
  p_customer_id       uuid,
  p_tires_qty         int,
  p_aluminum_owed     int,
  p_steel_owed        int,
  p_notes             text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_id uuid;
begin
  perform public._scrap_require_office();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  select id into v_existing from public.rim_obligations where client_request_id = p_client_request_id;
  if v_existing is not null then
    return public._rim_obligation_json(v_existing);  -- replay
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = '22023';
  end if;
  if coalesce(p_tires_qty, 0) < 0 or coalesce(p_aluminum_owed, 0) < 0 or coalesce(p_steel_owed, 0) < 0 then
    raise exception 'quantities cannot be negative' using errcode = '22023';
  end if;
  if coalesce(p_aluminum_owed, 0) + coalesce(p_steel_owed, 0) = 0 then
    raise exception 'enter the aluminum or steel owed' using errcode = '22023';
  end if;
  insert into public.rim_obligations (customer_id, tires_qty, aluminum_owed, steel_owed, notes, employee_id, client_request_id)
  values (p_customer_id, coalesce(p_tires_qty, 0), coalesce(p_aluminum_owed, 0), coalesce(p_steel_owed, 0), coalesce(p_notes, ''), auth.uid(), p_client_request_id)
  returning id into v_id;
  perform public.write_audit_log('scrap.rim.obligation_created', 'rim_obligation', v_id, 'Tire/rim obligation created',
    jsonb_build_object('aluminum_owed', coalesce(p_aluminum_owed, 0), 'steel_owed', coalesce(p_steel_owed, 0)), null, p_client_request_id);
  return public._rim_obligation_json(v_id);
end;
$$;

create or replace function public._rim_obligation_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', o.id,
    'customer_id', o.customer_id,
    'customer_name', public._customer_name_text(c.first_name, c.last_name, c.company_name),
    'tires_qty', o.tires_qty,
    'aluminum_owed', o.aluminum_owed,
    'steel_owed', o.steel_owed,
    'aluminum_returned', coalesce(r.al, 0),
    'steel_returned', coalesce(r.st, 0),
    'aluminum_remaining', o.aluminum_owed - coalesce(r.al, 0),
    'steel_remaining', o.steel_owed - coalesce(r.st, 0),
    'status', o.status,
    'completed_at', o.completed_at,
    'notes', o.notes,
    'created_at', o.created_at,
    'last_activity_at', coalesce(r.last_at, o.created_at),
    'returns', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'aluminum_returned', x.aluminum_returned,
                              'steel_returned', x.steel_returned, 'notes', x.notes, 'photo_asset_id', x.photo_asset_id,
                              'created_at', x.created_at) order by x.created_at)
                           from public.rim_returns x where x.obligation_id = o.id), '[]'::jsonb)
  )
  from public.rim_obligations o
  join public.customers c on c.id = o.customer_id
  left join (select obligation_id, sum(aluminum_returned) al, sum(steel_returned) st, max(created_at) last_at
               from public.rim_returns where obligation_id = p_id group by obligation_id) r on r.obligation_id = o.id
  where o.id = p_id;
$$;
revoke execute on function public._rim_obligation_json(uuid) from public, anon, authenticated;

-- A partial or final return. The obligation row is locked, so concurrent returns serialize; the
-- remaining quantity is checked before insert, and the database trigger checks it again.
create or replace function public.scrap_manager_record_rim_return(
  p_obligation_id     uuid,
  p_aluminum_returned int,
  p_steel_returned    int,
  p_notes             text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.rim_obligations%rowtype;
  v_al int;
  v_st int;
  v_remaining_al int;
  v_remaining_st int;
  v_return_id uuid;
begin
  perform public._scrap_require_office();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  -- Replay of an already-applied return: return the obligation as it is now, add nothing.
  if exists (select 1 from public.rim_returns where client_request_id = p_client_request_id) then
    return public._rim_obligation_json((select obligation_id from public.rim_returns where client_request_id = p_client_request_id));
  end if;

  select * into o from public.rim_obligations where id = p_obligation_id for update;
  if not found then
    raise exception 'obligation not found' using errcode = '22023';
  end if;
  if o.status = 'completed' then
    raise exception 'this obligation is already completed' using errcode = 'P0001';
  end if;
  v_al := coalesce(p_aluminum_returned, 0);
  v_st := coalesce(p_steel_returned, 0);
  if v_al < 0 or v_st < 0 then
    raise exception 'returned quantities cannot be negative' using errcode = '22023';
  end if;
  if v_al + v_st = 0 then
    raise exception 'enter the aluminum or steel returned' using errcode = '22023';
  end if;
  select o.aluminum_owed - coalesce(sum(aluminum_returned), 0), o.steel_owed - coalesce(sum(steel_returned), 0)
    into v_remaining_al, v_remaining_st
    from public.rim_returns where obligation_id = p_obligation_id;
  if v_al > v_remaining_al or v_st > v_remaining_st then
    raise exception 'over-return: only % aluminum and % steel remain', v_remaining_al, v_remaining_st using errcode = '22023';
  end if;

  insert into public.rim_returns (obligation_id, aluminum_returned, steel_returned, notes, employee_id, client_request_id)
  values (p_obligation_id, v_al, v_st, coalesce(p_notes, ''), auth.uid(), p_client_request_id)
  returning id into v_return_id;
  perform public.write_audit_log('scrap.rim.return_recorded', 'rim_obligation', p_obligation_id, 'Tire/rim return recorded',
    jsonb_build_object('return_id', v_return_id, 'aluminum_returned', v_al, 'steel_returned', v_st), null, p_client_request_id);
  return public._rim_obligation_json(p_obligation_id);
end;
$$;

create or replace function public.scrap_manager_list_rim_obligations(
  p_status         text default 'open',
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
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_rows jsonb;
  v_more boolean;
begin
  perform public._scrap_require_office();
  if p_status not in ('open', 'completed', 'all') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  with page as (
    select o.id, o.created_at from public.rim_obligations o
     where (p_status = 'all' or o.status = p_status)
       and (p_before_created is null or (o.created_at, o.id) < (p_before_created, p_before_id))
     order by o.created_at desc, o.id desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(public._rim_obligation_json(x.id) order by x.created_at desc, x.id desc) filter (where x.rn <= v_limit), '[]'::jsonb),
         coalesce(bool_or(x.rn > v_limit), false)
    into v_rows, v_more
    from (select p.*, row_number() over (order by p.created_at desc, p.id desc) as rn from page p) x;
  return jsonb_build_object('rows', v_rows, 'has_more', v_more);
end;
$$;

create or replace function public.scrap_manager_get_rim_obligation(p_obligation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public._scrap_require_office();
  v := public._rim_obligation_json(p_obligation_id);
  if v is null then
    raise exception 'obligation not found' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Daily close (server-authoritative). Owner and engineer admin may override, with a reason.
-- ---------------------------------------------------------------------------------------

create or replace function public._scrap_daily_blockers(p_date date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with day_loads as (
    select * from public.scrap_loads_manager_v where load_date = p_date
  ), open_disc as (
    select d.* from public.scrap_discrepancies d
     where d.status = 'open'
       and (d.scrap_load_id in (select id from day_loads)
            or d.scrap_payment_id in (select f.payment_id from public.scrap_load_financials f where f.scrap_load_id in (select id from day_loads) and f.payment_id is not null))
  )
  select coalesce(jsonb_agg(b order by b->>'kind'), '[]'::jsonb) from (
    select jsonb_build_object('kind', 'missing_load_photo', 'count', count(*)::int,
                              'sample_ids', coalesce(jsonb_agg(id) filter (where true), '[]'::jsonb)) as b
      from day_loads where not has_load_photo having count(*) > 0
    union all
    select jsonb_build_object('kind', 'incomplete_workflow', 'count', count(*)::int,
                              'sample_ids', coalesce(jsonb_agg(id), '[]'::jsonb))
      from day_loads where status = 'new' having count(*) > 0
    union all
    select jsonb_build_object('kind', 'awaiting_review', 'count', count(*)::int,
                              'sample_ids', coalesce(jsonb_agg(id), '[]'::jsonb))
      from day_loads where status = 'ready_for_review' having count(*) > 0
    union all
    select jsonb_build_object('kind', 'unresolved_discrepancy', 'count', count(*)::int,
                              'sample_ids', coalesce(jsonb_agg(id), '[]'::jsonb))
      from open_disc having count(*) > 0
  ) x;
$$;
revoke execute on function public._scrap_daily_blockers(date) from public, anon, authenticated;

create or replace function public.scrap_manager_daily_close_preview(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._scrap_require_office();
  if p_date is null or p_date > public._scrap_business_date() then
    raise exception 'a day can only be closed once it has ended' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'date', p_date,
    'closed', public._scrap_day_closed(p_date),
    'blockers', public._scrap_daily_blockers(p_date),
    'loads', (select count(*)::int from public.scrap_loads_manager_v where load_date = p_date),
    'completed', (select count(*)::int from public.scrap_loads_manager_v where load_date = p_date and status in ('approved', 'closed')),
    'weight', coalesce((select sum(weight) from public.scrap_loads_manager_v where load_date = p_date and status in ('approved', 'closed')), 0),
    'amount', coalesce((select sum(amount) from public.scrap_loads_manager_v where load_date = p_date and status in ('approved', 'closed')), 0),
    'payments_received', coalesce((select sum(amount_received) from public.scrap_payments where payment_date = p_date and correction_of is null), 0)
  );
end;
$$;

create or replace function public.scrap_manager_daily_close(p_date date, p_override_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blockers jsonb;
  v_totals jsonb;
  v_close public.daily_closes%rowtype;
  v_reason text := nullif(btrim(coalesce(p_override_reason, '')), '');
begin
  perform public._scrap_require_office();
  if p_date is null or p_date > public._scrap_business_date() then
    raise exception 'a day can only be closed once it has ended' using errcode = '22023';
  end if;
  -- Replay: a day that is already closed returns its frozen record.
  if public._scrap_day_closed(p_date) then
    select * into v_close from public.daily_closes where close_date = p_date;
    return to_jsonb(v_close);
  end if;

  v_blockers := public._scrap_daily_blockers(p_date);
  if jsonb_array_length(v_blockers) > 0 then
    if v_reason is null or char_length(v_reason) < 5 then
      raise exception 'the day cannot close yet: % open item type(s); an override needs a reason of at least 5 characters', jsonb_array_length(v_blockers)
        using errcode = 'P0001';
    end if;
    if not public.has_any_role('owner', 'engineer_admin') then
      raise exception 'only an owner or engineer admin can override a daily close' using errcode = '42501';
    end if;
  end if;

  v_totals := jsonb_build_object(
    'loads', (select count(*)::int from public.scrap_loads_manager_v where load_date = p_date),
    'completed', (select count(*)::int from public.scrap_loads_manager_v where load_date = p_date and status in ('approved', 'closed')),
    'weight', coalesce((select sum(weight) from public.scrap_loads_manager_v where load_date = p_date and status in ('approved', 'closed')), 0),
    'amount', coalesce((select sum(amount) from public.scrap_loads_manager_v where load_date = p_date and status in ('approved', 'closed')), 0),
    'payments_received', coalesce((select sum(amount_received) from public.scrap_payments where payment_date = p_date and correction_of is null), 0),
    'open_discrepancies', (select count(*)::int from public.scrap_discrepancies where status = 'open')
  );
  insert into public.daily_closes (close_date, closed_by, override_reason, totals, blockers)
  values (p_date, auth.uid(), v_reason, v_totals, v_blockers)
  returning * into v_close;

  if jsonb_array_length(v_blockers) > 0 then
    perform public.write_audit_log('scrap.daily_close.override', 'daily_close', v_close.id,
      'Daily close overridden for ' || p_date::text, jsonb_build_object('blockers', v_blockers), v_reason, null);
  end if;
  perform public.write_audit_log('scrap.daily_close', 'daily_close', v_close.id,
    'Daily close for ' || p_date::text, v_totals, v_reason, null);
  return to_jsonb(v_close);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 8. Reports (office). Aggregation happens in the database for the chosen range.
-- ---------------------------------------------------------------------------------------

create or replace function public.scrap_manager_report(p_from date, p_to date, p_driver uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._scrap_require_office();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'choose a date range of up to one year' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'loads', (select count(*)::int from public.scrap_loads_manager_v v
               where v.load_date between p_from and p_to and (p_driver is null or v.driver_id = p_driver)),
    'completed', (select count(*)::int from public.scrap_loads_manager_v v
               where v.load_date between p_from and p_to and (p_driver is null or v.driver_id = p_driver) and v.status in ('approved', 'closed')),
    'weight', coalesce((select sum(v.weight) from public.scrap_loads_manager_v v
               where v.load_date between p_from and p_to and (p_driver is null or v.driver_id = p_driver) and v.status in ('approved', 'closed')), 0),
    'amount', coalesce((select sum(v.amount) from public.scrap_loads_manager_v v
               where v.load_date between p_from and p_to and (p_driver is null or v.driver_id = p_driver) and v.status in ('approved', 'closed')), 0),
    'reconciliation', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
               select v.payment_status as k, count(*)::int as n from public.scrap_loads_manager_v v
                where v.load_date between p_from and p_to and (p_driver is null or v.driver_id = p_driver) group by v.payment_status) s),
    'discrepancies_opened', (select count(*)::int from public.scrap_discrepancies d
               where d.opened_at::date between p_from and p_to and (p_driver is null or d.driver_id = p_driver)),
    'discrepancies_open_now', (select count(*)::int from public.scrap_discrepancies d
               where d.status = 'open' and (p_driver is null or d.driver_id = p_driver)),
    'payments_received', coalesce((select sum(amount_received) from public.scrap_payments
               where payment_date between p_from and p_to and correction_of is null and (p_driver is null or driver_id = p_driver)), 0),
    'tire_rim_outstanding_aluminum', coalesce((select sum(o.aluminum_owed - coalesce(r.returned, 0)) from public.rim_obligations o
               left join (select obligation_id, sum(aluminum_returned) returned from public.rim_returns group by obligation_id) r on r.obligation_id = o.id
               where o.status = 'open'), 0),
    'tire_rim_outstanding_steel', coalesce((select sum(o.steel_owed - coalesce(r.returned, 0)) from public.rim_obligations o
               left join (select obligation_id, sum(steel_returned) returned from public.rim_returns group by obligation_id) r on r.obligation_id = o.id
               where o.status = 'open'), 0),
    'by_driver', coalesce((select jsonb_agg(jsonb_build_object('driver_id', d.driver_id, 'name', d.driver_name, 'loads', d.loads,
                              'completed', d.completed, 'weight', d.weight, 'amount', d.amount) order by d.driver_name)
              from (select driver_id, driver_name, count(*)::int loads,
                           count(*) filter (where status in ('approved', 'closed'))::int completed,
                           coalesce(sum(weight) filter (where status in ('approved', 'closed')), 0) weight,
                           coalesce(sum(amount) filter (where status in ('approved', 'closed')), 0) amount
                      from public.scrap_loads_manager_v
                     where load_date between p_from and p_to and (p_driver is null or driver_id = p_driver)
                     group by driver_id, driver_name) d), '[]'::jsonb),
    'daily_closes', coalesce((select jsonb_agg(jsonb_build_object('date', c.close_date, 'override', c.override_reason is not null) order by c.close_date)
              from public.daily_closes c where c.close_date between p_from and p_to), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 9. Grants: clients may call the RPCs; internal helpers are not granted (see above).
-- ---------------------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'scrap_driver_create_load(uuid)', 'scrap_driver_attach_photo(uuid,text,uuid)', 'scrap_driver_mark_delivered(uuid)',
    'scrap_driver_complete_load(uuid)', 'scrap_driver_create_check(uuid)', 'scrap_driver_attach_check_photo(uuid,uuid)',
    'scrap_driver_list_loads(int,timestamptz,uuid)', 'scrap_driver_get_load(uuid)', 'scrap_driver_list_checks(int)',
    'scrap_manager_summary(date,date)', 'scrap_manager_list_loads(text,date,date,uuid,int,date,timestamptz,uuid)',
    'scrap_manager_get_load(uuid)', 'scrap_manager_list_payments(int,timestamptz,uuid)', 'scrap_manager_list_checks(boolean,int)',
    'scrap_manager_list_discrepancies(text,int)', 'scrap_manager_set_measurement(uuid,numeric,numeric,numeric,text,text)',
    'scrap_manager_correct_financials(uuid,numeric,numeric,numeric,text)', 'scrap_manager_approve_load(uuid)',
    'scrap_manager_open_discrepancy(text,uuid,uuid,text)', 'scrap_manager_resolve_discrepancy(uuid,text)',
    'scrap_manager_record_payment(uuid,uuid[],numeric,text,text,text,date,uuid)', 'scrap_manager_attach_payment_proof(uuid,uuid)',
    'scrap_manager_correct_payment(uuid,numeric,uuid[],text,uuid)', 'scrap_manager_create_rim_obligation(uuid,int,int,int,text,uuid)',
    'scrap_manager_record_rim_return(uuid,int,int,text,uuid)', 'scrap_manager_list_rim_obligations(text,int,timestamptz,uuid)',
    'scrap_manager_get_rim_obligation(uuid)', 'scrap_manager_daily_close_preview(date)', 'scrap_manager_daily_close(date,text)',
    'scrap_manager_report(date,date,uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
