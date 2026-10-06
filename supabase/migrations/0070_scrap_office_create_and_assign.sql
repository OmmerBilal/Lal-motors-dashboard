-- =====================================================================================
-- 0070 — Scrap: the office creates a load and assigns the Scrap Driver.
--
-- ADDITIVE. Depends on 0035–0038. Nothing here changes a financial rule.
--   1. Records who created a load and when the driver was assigned (created_by, assigned_at).
--      Existing loads were created by their driver, so created_by = driver_id and assigned_at = created_at.
--   2. Adds the 'driver_reassigned' history event.
--   3. New RPCs (office only): scrap_manager_list_drivers, scrap_manager_create_load,
--      scrap_manager_assign_driver. A driver is assignable only while the account is ACTIVE and holds the
--      real scrap_driver role. A driver can be changed only before that driver starts the load (no load photo,
--      not delivered, still new).
--   4. Read models gain created_by_name / assigned_at (manager) and assigned_at (driver). The driver view has no money.
--
-- Driver-created loads (scrap_driver_create_load) keep working: the driver is the assignee of their own load.
-- =====================================================================================

-- 1. Columns ---------------------------------------------------------------------------
alter table public.scrap_loads add column created_by uuid references public.profiles(id);
alter table public.scrap_loads add column assigned_at timestamptz;

update public.scrap_loads
   set created_by = driver_id, assigned_at = created_at
 where assigned_at is null;

-- 2. History event ----------------------------------------------------------------------
alter table public.scrap_load_events drop constraint if exists scrap_load_events_event_type_check;
alter table public.scrap_load_events add constraint scrap_load_events_event_type_check check (event_type in (
  'load_created', 'load_photo_attached', 'delivered', 'ticket_attached', 'completed',
  'measurement_recorded', 'financials_corrected', 'approved',
  'payment_linked', 'payment_unlinked', 'discrepancy_opened', 'discrepancy_resolved',
  'driver_reassigned'));

-- 3. Helpers ------------------------------------------------------------------------------
-- Returns the driver's name only when the account is ACTIVE and holds the real scrap_driver role.
create or replace function public._scrap_active_driver_name(p_driver_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select p.name into v_name
    from public.profiles p
   where p.id = p_driver_id
     and p.account_status = 'active'
     and exists (
       select 1 from public.user_roles ur
         join public.roles r on r.id = ur.role_id
        where ur.user_id = p.id and r.key = 'scrap_driver');
  if v_name is null then
    raise exception 'choose an active Scrap Driver' using errcode = '22023';
  end if;
  return v_name;
end;
$$;
revoke execute on function public._scrap_active_driver_name(uuid) from public, anon, authenticated;

-- 4. Read models (columns appended, so existing consumers keep their shape) -----------------
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
       sl.ticket_photo_asset_id,
       sl.assigned_at
  from public.scrap_loads sl;

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
           and (d.scrap_load_id = sl.id or (f.payment_id is not null and d.scrap_payment_id = f.payment_id))) as open_discrepancies,
       sl.created_by,
       cb.name as created_by_name,
       sl.assigned_at
  from public.scrap_loads sl
  join public.profiles p on p.id = sl.driver_id
  left join public.profiles cb on cb.id = sl.created_by
  left join public.scrap_load_financials f on f.scrap_load_id = sl.id;

revoke all on public.scrap_loads_manager_v from public, anon, authenticated;
grant select on public.scrap_loads_driver_v to authenticated;

-- 5. RPCs (office only) ----------------------------------------------------------------------

-- Active Scrap Drivers for the assignment picker. Names and ids only; no contact or financial data.
create or replace function public.scrap_manager_list_drivers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public._scrap_require_office();
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name), '[]'::jsonb)
    into v
    from public.profiles p
   where p.account_status = 'active'
     and exists (
       select 1 from public.user_roles ur
         join public.roles r on r.id = ur.role_id
        where ur.user_id = p.id and r.key = 'scrap_driver');
  return v;
end;
$$;

-- New load for an assigned driver. The driver is required; the load is operational at once (status new).
create or replace function public.scrap_manager_create_load(p_driver_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_name text;
begin
  perform public._scrap_require_office();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  if p_driver_id is null then
    raise exception 'choose a Scrap Driver for this load' using errcode = '22023';
  end if;

  -- Replay: the same request returns the same load.
  select id into v_id from public.scrap_loads where client_request_id = p_client_request_id;
  if v_id is not null then
    return public._scrap_manager_load_json(v_id);
  end if;

  v_name := public._scrap_active_driver_name(p_driver_id);
  if public._scrap_day_closed(public._scrap_business_date()) then
    raise exception 'today is closed; new loads start on the next business day' using errcode = 'P0001';
  end if;

  insert into public.scrap_loads (driver_id, load_date, status, client_request_id, created_by, assigned_at)
  values (p_driver_id, public._scrap_business_date(), 'new', p_client_request_id, auth.uid(), now())
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.scrap_loads where client_request_id = p_client_request_id;
    return public._scrap_manager_load_json(v_id);
  end if;

  perform public._scrap_record_event(v_id, 'load_created', null, 'new',
    jsonb_build_object('assigned_driver_id', p_driver_id, 'assigned_driver_name', v_name),
    'Scrap load created and assigned to ' || v_name);
  return public._scrap_manager_load_json(v_id);
end;
$$;

-- Reassign before the driver starts. "Started" = a load photo exists, or delivered, or no longer new.
create or replace function public.scrap_manager_assign_driver(p_load_id uuid, p_driver_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l        public.scrap_loads%rowtype;
  v_name   text;
  v_from   text;
begin
  perform public._scrap_require_office();
  select * into l from public.scrap_loads where id = p_load_id for update;
  if not found then
    raise exception 'load not found' using errcode = '22023';
  end if;
  if l.driver_id = p_driver_id then
    return public._scrap_manager_load_json(p_load_id);  -- already assigned: no change, no event
  end if;

  v_name := public._scrap_active_driver_name(p_driver_id);
  if l.status <> 'new' or l.delivered_at is not null or l.load_photo_asset_id is not null then
    raise exception 'the driver can only be changed before the assigned driver starts this load' using errcode = 'P0001';
  end if;
  if public._scrap_day_closed(l.load_date) then
    raise exception 'this day is closed; the load can no longer change' using errcode = 'P0001';
  end if;

  select name into v_from from public.profiles where id = l.driver_id;
  update public.scrap_loads set driver_id = p_driver_id, assigned_at = now() where id = p_load_id;
  perform public._scrap_record_event(p_load_id, 'driver_reassigned', 'new', 'new',
    jsonb_build_object('from_driver_id', l.driver_id, 'from_driver_name', v_from,
                       'to_driver_id', p_driver_id, 'to_driver_name', v_name),
    'Driver changed from ' || coalesce(v_from, 'unknown') || ' to ' || v_name);
  return public._scrap_manager_load_json(p_load_id);
end;
$$;

revoke execute on function public.scrap_manager_list_drivers() from public, anon;
grant execute on function public.scrap_manager_list_drivers() to authenticated;
revoke execute on function public.scrap_manager_create_load(uuid, uuid) from public, anon;
grant execute on function public.scrap_manager_create_load(uuid, uuid) to authenticated;
revoke execute on function public.scrap_manager_assign_driver(uuid, uuid) from public, anon;
grant execute on function public.scrap_manager_assign_driver(uuid, uuid) to authenticated;
