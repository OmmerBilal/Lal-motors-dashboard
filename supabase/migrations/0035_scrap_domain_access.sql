-- ---------------------------------------------------------------------------------------
-- 0035 — Scrap Driver + Scrap Management (Modules 10/11): schema, guards and access.
--
-- ADDITIVE ONLY. 0001–0034 are not edited. This file:
--   1. adds the columns the workflow needs (delivered/completed stamps, idempotency keys,
--      rim obligation status, daily close blockers snapshot);
--   2. adds the structured history and discrepancy tables (append-only where it matters);
--   3. adds server guards: legal load status transitions, over-return protection for rim
--      returns, and append-only history (a correction is a new row, never an edit);
--   4. tightens access. Scrap Driver loses every direct INSERT/UPDATE on scrap tables and
--      every read of payments, checks and tire/rim data; all driver writes go through the
--      RPCs in 0036 (which check the caller and the current state). Office roles keep read
--      access through the same helpers, and their writes also go through RPCs.
--
-- Business date: load_date and daily close use America/New_York, the yard's day. Stored
-- server-side, never taken from a device clock.
-- ---------------------------------------------------------------------------------------

-- 1. Columns -------------------------------------------------------------------------------
alter table public.scrap_loads add column delivered_at timestamptz;
alter table public.scrap_loads add column completed_at timestamptz;
alter table public.scrap_loads add column completed_by uuid references public.profiles(id);

alter table public.scrap_load_financials add column amount_override_reason text;

alter table public.scrap_payments add column client_request_id uuid;
create unique index scrap_payments_client_request_key on public.scrap_payments (client_request_id) where client_request_id is not null;

-- A check is created first (so its photo can be uploaded against it), then the photo is attached.
alter table public.driver_check_submissions alter column photo_asset_id drop not null;
alter table public.driver_check_submissions add column client_request_id uuid;
create unique index driver_check_submissions_client_request_key on public.driver_check_submissions (client_request_id) where client_request_id is not null;

alter table public.rim_obligations add column status text not null default 'open' check (status in ('open', 'completed'));
alter table public.rim_obligations add column completed_at timestamptz;
alter table public.rim_obligations add column client_request_id uuid;
create unique index rim_obligations_client_request_key on public.rim_obligations (client_request_id) where client_request_id is not null;

alter table public.rim_returns add column client_request_id uuid;
create unique index rim_returns_client_request_key on public.rim_returns (client_request_id) where client_request_id is not null;

alter table public.daily_closes add column blockers jsonb not null default '[]'::jsonb;

-- 2. New tables ----------------------------------------------------------------------------

-- Load-level history. Append-only. Every state change and every financial measurement or
-- correction writes one row (old and new values in detail), so nothing is silently overwritten.
create table public.scrap_load_events (
  id             uuid primary key default gen_random_uuid(),
  scrap_load_id  uuid not null references public.scrap_loads(id),
  event_type     text not null check (event_type in (
                   'load_created', 'load_photo_attached', 'delivered', 'ticket_attached', 'completed',
                   'measurement_recorded', 'financials_corrected', 'approved',
                   'payment_linked', 'payment_unlinked', 'discrepancy_opened', 'discrepancy_resolved')),
  from_status    text,
  to_status      text,
  actor_id       uuid references public.profiles(id),
  actor_name     text not null,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index scrap_load_events_load_idx on public.scrap_load_events (scrap_load_id, created_at);

-- Structured discrepancies. One OPEN discrepancy per kind per load or payment (partial unique
-- indexes below), so a repeated report cannot stack duplicates.
create table public.scrap_discrepancies (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in (
                       'ticket_missing', 'ticket_photo_mismatch', 'payment_mismatch', 'unresolved_amount',
                       'missing_check_evidence', 'incomplete_load_evidence', 'other')),
  status             text not null default 'open' check (status in ('open', 'resolved')),
  scrap_load_id      uuid references public.scrap_loads(id),
  scrap_payment_id   uuid references public.scrap_payments(id),
  driver_id          uuid references public.profiles(id),
  note               text not null check (char_length(btrim(note)) >= 5),
  opened_by          uuid references public.profiles(id),
  opened_by_name     text not null,
  opened_at          timestamptz not null default now(),
  resolved_by        uuid references public.profiles(id),
  resolved_by_name   text,
  resolved_at        timestamptz,
  resolution_note    text,
  constraint scrap_discrepancy_target_chk check (scrap_load_id is not null or scrap_payment_id is not null),
  constraint scrap_discrepancy_resolution_chk check (
    (status = 'open' and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null and resolution_note is not null and char_length(btrim(resolution_note)) >= 5))
);
create unique index scrap_discrepancy_open_load_key on public.scrap_discrepancies (kind, scrap_load_id) where status = 'open' and scrap_load_id is not null;
create unique index scrap_discrepancy_open_payment_key on public.scrap_discrepancies (kind, scrap_payment_id) where status = 'open' and scrap_payment_id is not null;
create index scrap_discrepancies_status_idx on public.scrap_discrepancies (status, opened_at);

-- 3. Guards -------------------------------------------------------------------------------

-- Legal load status transitions only. Entry points (RPCs) also check this; the trigger means a
-- direct UPDATE by any role cannot skip the workflow either.
create or replace function public._scrap_load_transition_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if not (
         (old.status = 'new' and new.status = 'ready_for_review')
      or (old.status = 'ready_for_review' and new.status in ('approved', 'new'))
      or (old.status = 'approved' and new.status = 'closed')
    ) then
      raise exception 'invalid scrap load status change: % to %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public._scrap_load_transition_guard() from public, anon, authenticated;
create trigger scrap_loads_transition_guard
  before update of status on public.scrap_loads
  for each row execute function public._scrap_load_transition_guard();

-- Rim returns: over-return and returns after completion are rejected under a row lock on the
-- obligation, so two concurrent returns cannot both pass the check.
create or replace function public._rim_return_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owed_al   int;
  v_owed_st   int;
  v_status    text;
  v_ret_al    int;
  v_ret_st    int;
begin
  select aluminum_owed, steel_owed, status into v_owed_al, v_owed_st, v_status
    from public.rim_obligations where id = new.obligation_id for update;
  if v_status = 'completed' then
    raise exception 'this tire/rim obligation is already completed' using errcode = '22023';
  end if;
  select coalesce(sum(aluminum_returned), 0), coalesce(sum(steel_returned), 0)
    into v_ret_al, v_ret_st
    from public.rim_returns where obligation_id = new.obligation_id;
  if new.aluminum_returned + v_ret_al > v_owed_al or new.steel_returned + v_ret_st > v_owed_st then
    raise exception 'over-return: more aluminum or steel than is still owed' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function public._rim_return_guard() from public, anon, authenticated;
create trigger rim_returns_guard
  before insert on public.rim_returns
  for each row execute function public._rim_return_guard();

create or replace function public._rim_return_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owed_al int;
  v_owed_st int;
  v_ret_al  int;
  v_ret_st  int;
begin
  select aluminum_owed, steel_owed into v_owed_al, v_owed_st
    from public.rim_obligations where id = new.obligation_id;
  select coalesce(sum(aluminum_returned), 0), coalesce(sum(steel_returned), 0)
    into v_ret_al, v_ret_st
    from public.rim_returns where obligation_id = new.obligation_id;
  if v_ret_al >= v_owed_al and v_ret_st >= v_owed_st then
    update public.rim_obligations set status = 'completed', completed_at = now() where id = new.obligation_id;
  end if;
  return null;
end;
$$;
revoke execute on function public._rim_return_complete() from public, anon, authenticated;
create trigger rim_returns_complete
  after insert on public.rim_returns
  for each row execute function public._rim_return_complete();

-- Append-only history. Rows here are evidence: a correction is a new row that references the old one.
create or replace function public._scrap_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only; record a correction instead', tg_table_name using errcode = 'P0001';
end;
$$;
revoke execute on function public._scrap_append_only() from public, anon, authenticated;
create trigger scrap_load_events_append_only before update or delete on public.scrap_load_events
  for each row execute function public._scrap_append_only();
create trigger rim_returns_append_only before update or delete on public.rim_returns
  for each row execute function public._scrap_append_only();
create trigger daily_closes_append_only before update or delete on public.daily_closes
  for each row execute function public._scrap_append_only();

-- A posted scrap payment is immutable. The one allowed change is attaching its proof photo, and
-- only while none is attached. Everything else is a correction row (correction_of).
create or replace function public._scrap_payment_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'scrap_payments is append-only; record a correction instead' using errcode = 'P0001';
  end if;
  if old.proof_asset_id is null and new.proof_asset_id is not null
     and (new.id, new.driver_id, new.payment_date, new.amount_received, new.method, new.reference_number, new.notes,
          new.entered_by, new.discrepancy_reason, new.discrepancy_approved_by, new.correction_of, new.correction_reason,
          new.created_at, new.client_request_id)
       is not distinct from
         (old.id, old.driver_id, old.payment_date, old.amount_received, old.method, old.reference_number, old.notes,
          old.entered_by, old.discrepancy_reason, old.discrepancy_approved_by, old.correction_of, old.correction_reason,
          old.created_at, old.client_request_id) then
    return new;
  end if;
  raise exception 'scrap_payments is immutable; record a correction instead' using errcode = 'P0001';
end;
$$;
revoke execute on function public._scrap_payment_guard() from public, anon, authenticated;
create trigger scrap_payments_guard before update or delete on public.scrap_payments
  for each row execute function public._scrap_payment_guard();

-- 4. Helpers (called from the RPCs in 0036; not granted to clients) -------------------------

-- The yard's business day. Used for load_date and the daily close, server-side only.
create or replace function public._scrap_business_date()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'America/New_York')::date;
$$;
revoke execute on function public._scrap_business_date() from public, anon, authenticated;

create or replace function public._scrap_require_office()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.is_scrap_office() then
    raise exception 'forbidden: a scrap management role is required' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public._scrap_require_office() from public, anon, authenticated;

create or replace function public._scrap_require_driver()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.has_role('scrap_driver') then
    raise exception 'forbidden: a scrap driver role is required' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public._scrap_require_driver() from public, anon, authenticated;

create or replace function public._scrap_day_closed(p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.daily_closes where close_date = p_date);
$$;
revoke execute on function public._scrap_day_closed(date) from public, anon, authenticated;

-- One helper for every audited scrap change: a load event (for loads) plus the audit row.
create or replace function public._scrap_record_event(
  p_load_id    uuid,
  p_event      text,
  p_from       text,
  p_to         text,
  p_detail     jsonb,
  p_summary    text,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select name into v_name from public.profiles where id = auth.uid();
  insert into public.scrap_load_events (scrap_load_id, event_type, from_status, to_status, actor_id, actor_name, detail)
  values (p_load_id, p_event, p_from, p_to, auth.uid(), coalesce(v_name, 'unknown'), coalesce(p_detail, '{}'::jsonb));
  perform public.write_audit_log('scrap.' || p_event, 'scrap_load', p_load_id, p_summary, coalesce(p_detail, '{}'::jsonb), p_reason, null);
end;
$$;
revoke execute on function public._scrap_record_event(uuid, text, text, text, jsonb, text, text) from public, anon, authenticated;

-- 5. Access: tighten policies ---------------------------------------------------------------
-- Drop every existing scrap policy that let a driver write or read confidential data, then
-- recreate the minimum. RLS stays enabled on every table.

-- scrap_loads: reads only. Writes are RPC-only (driver: 0036 scrap_driver_* functions; office: scrap_manager_*).
drop policy if exists scrap_loads_driver_own on public.scrap_loads;
drop policy if exists scrap_loads_driver_insert_own on public.scrap_loads;
drop policy if exists scrap_loads_driver_update_own on public.scrap_loads;
create policy scrap_loads_read on public.scrap_loads
  for select using (driver_id = auth.uid() or public.is_scrap_office());

-- scrap_load_financials: office read only. Measurements and corrections go through RPCs.
drop policy if exists scrap_load_financials_office_only on public.scrap_load_financials;
create policy scrap_load_financials_office_read on public.scrap_load_financials
  for select using (public.is_scrap_office());

-- scrap_payments: office read only. A driver never sees a payment amount, reference or proof.
drop policy if exists scrap_payments_office_read on public.scrap_payments;
drop policy if exists scrap_payments_office_write on public.scrap_payments;
create policy scrap_payments_office_read on public.scrap_payments
  for select using (public.is_scrap_office());

drop policy if exists scrap_payment_loads_office on public.scrap_payment_loads;
create policy scrap_payment_loads_office_read on public.scrap_payment_loads
  for select using (public.is_scrap_office());

-- driver_check_submissions: office read only. A driver creates a check through an RPC and
-- attaches its photo through the media API (can_access_media checks the driver's own row).
drop policy if exists driver_check_submissions_driver_own on public.driver_check_submissions;
drop policy if exists driver_check_submissions_driver_insert on public.driver_check_submissions;
drop policy if exists driver_check_submissions_office_update on public.driver_check_submissions;
create policy driver_check_submissions_office_read on public.driver_check_submissions
  for select using (public.is_scrap_office());

-- Tire/rim: management only. A driver is not part of the tire/rim workflow.
drop policy if exists rim_obligations_domain on public.rim_obligations;
create policy rim_obligations_office_read on public.rim_obligations
  for select using (public.is_scrap_office());
drop policy if exists rim_returns_domain_read on public.rim_returns;
drop policy if exists rim_returns_domain_insert on public.rim_returns;
create policy rim_returns_office_read on public.rim_returns
  for select using (public.is_scrap_office());

drop policy if exists daily_closes_office_insert on public.daily_closes;
-- daily_closes_office_read stays.

-- New tables: office read only.
alter table public.scrap_load_events enable row level security;
alter table public.scrap_discrepancies enable row level security;
create policy scrap_load_events_office_read on public.scrap_load_events
  for select using (public.is_scrap_office());
create policy scrap_discrepancies_office_read on public.scrap_discrepancies
  for select using (public.is_scrap_office());

-- Media: scrap payment proofs and tire/rim evidence are management-only. Scrap load and check
-- evidence stays readable by the driver who owns it.
create or replace function public.can_access_media(p_owner_type text, p_owner_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return case
    when p_owner_type in ('vehicle', 'vehicle_completion', 'vehicle_intake_batch')
      then public.is_vehicle_domain_staff()
    when p_owner_type = 'dismantling_session'
      then public.is_dismantling_staff()
    when p_owner_type = 'part'
      then public.is_parts_staff()
    when p_owner_type = 'customer'
      then public.is_sales_staff()
    when p_owner_type in ('rim_obligation', 'rim_return', 'scrap_payment')
      then public.is_scrap_office()
    when p_owner_type = 'scrap_load'
      then public.is_scrap_office()
        or exists (select 1 from public.scrap_loads sl where sl.id = p_owner_id and sl.driver_id = auth.uid())
    when p_owner_type = 'driver_check'
      then public.is_scrap_office()
        or exists (select 1 from public.driver_check_submissions d where d.id = p_owner_id and d.driver_id = auth.uid())
    when p_owner_type = 'container'
      then public.is_container_staff()
    when p_owner_type in ('export_invoice', 'export_payment')
      then public.is_export_authorized()
    else false
  end;
end;
$$;
revoke execute on function public.can_access_media(text, uuid) from public, anon;
grant execute on function public.can_access_media(text, uuid) to authenticated;

-- A driver's own check is attachable by that driver only. The owner row must exist (media_owner_exists).
-- No changes to media_owner_exists: it already checks the real rows.
