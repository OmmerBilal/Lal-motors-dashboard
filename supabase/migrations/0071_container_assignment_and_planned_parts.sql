-- =====================================================================================
-- 0071 — Containers: management creates and assigns a container; planned parts reserve inventory;
--        the assigned loader confirms loaded quantities; Finish Loading exports what was loaded and
--        releases the rest. ADDITIVE on top of 0040–0069. Existing containers are preserved.
--
--   1. container_jobs: assigned loader, assigned by/at, loading finished by, parts_planning flag.
--      Every existing container is assigned to the loader who opened it (created_by); parts_planning stays false
--      for legacy containers, so they show "no structured loaded-part list recorded".
--   2. container_planned_items: one row per inventory part planned for a container. It references the SAME
--      parts row (no copy). status: planned (holds stock) | removed (hold released) | finalized (loading finished).
--   3. Stock: a planned quantity is a hold. _available_quantity and _sync_part_operational_status subtract
--      active holds, so Sales (reserve / fulfill) cannot use units planned for a container.
--   4. Access: loaders see and change only containers assigned to them (RLS on container_jobs and container_events,
--      helper checks in every loader RPC, and the media rules). Management (owner, engineer_admin, export_manager)
--      keeps full access. The loader cannot open a container, nor change anything after loading is finished.
--   5. Finish Loading (container_loader_finish): transactional and idempotent. Exports the loaded quantity from
--      parts.quantity, marks the planned line finalized, releases unused holds, writes part_operations history.
--   6. Invoice lines may reference a finalized planned line (source_item_id), so the draft can be prefilled from
--      the actual loaded parts. Prices are never taken from Parts Inventory.
-- =====================================================================================

-- 1. Columns --------------------------------------------------------------------------------
alter table public.container_jobs add column assigned_loader_id uuid references public.profiles(id);
alter table public.container_jobs add column assigned_by uuid references public.profiles(id);
alter table public.container_jobs add column assigned_at timestamptz;
alter table public.container_jobs add column loading_finished_by uuid references public.profiles(id);
alter table public.container_jobs add column parts_planning boolean not null default false;
create index container_jobs_assigned_loader_idx on public.container_jobs (assigned_loader_id);

update public.container_jobs c
   set assigned_loader_id = c.created_by, assigned_by = c.created_by, assigned_at = c.created_at
 where c.assigned_loader_id is null
   and c.created_by is not null
   and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                where ur.user_id = c.created_by and r.key = 'container_loading');

-- 2. Planned parts -----------------------------------------------------------------------------
create table public.container_planned_items (
  id              uuid primary key default gen_random_uuid(),
  container_id    uuid not null references public.container_jobs(id),
  part_id         uuid not null references public.parts(id),
  planned_qty     int not null check (planned_qty > 0),
  loaded_qty      int not null default 0 check (loaded_qty >= 0),
  released_qty    int,
  status          text not null default 'planned' check (status in ('planned', 'removed', 'finalized')),
  added_by        uuid references public.profiles(id),
  added_by_name   text not null,
  added_at        timestamptz not null default now(),
  removed_at      timestamptz,
  finalized_at    timestamptz,
  finalized_by    uuid references public.profiles(id),
  constraint container_planned_loaded_chk check (loaded_qty <= planned_qty),
  constraint container_planned_released_chk check (released_qty is null or released_qty >= 0)
);
comment on table public.container_planned_items is
  'Planned inventory for a container. Each row references the SAME parts row (no copy). A planned row is a stock hold '
  'while status = planned. Loading finished turns it into finalized (exported loaded_qty, released_qty returned to stock).';
create unique index container_planned_one_active_key on public.container_planned_items (container_id, part_id) where status = 'planned';
create index container_planned_part_idx on public.container_planned_items (part_id) where status = 'planned';
create index container_planned_container_idx on public.container_planned_items (container_id, added_at);
alter table public.container_planned_items enable row level security;   -- no policies: RPC and definer use only
revoke all on public.container_planned_items from public, anon, authenticated;

-- Guard: a closed line never changes; a loaded quantity changes only while the container is loading.
create or replace function public._container_planned_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op = 'INSERT' then
    select status into v_status from public.container_jobs where id = new.container_id;
    if v_status is distinct from 'loading' then
      raise exception 'this container is no longer loading; parts cannot be planned' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.status <> 'planned' then
    raise exception 'this planned line is closed and cannot change' using errcode = 'P0001';
  end if;
  if new.container_id <> old.container_id or new.part_id <> old.part_id or new.planned_qty <> old.planned_qty then
    raise exception 'the planned part and quantity are fixed once planned; remove the line and plan it again' using errcode = 'P0001';
  end if;
  if new.loaded_qty is distinct from old.loaded_qty then
    select status into v_status from public.container_jobs where id = old.container_id;
    if v_status is distinct from 'loading' then
      raise exception 'loaded quantities are fixed once loading is finished' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public._container_planned_guard() from public, anon, authenticated;
create trigger container_planned_items_guard before insert or update on public.container_planned_items
  for each row execute function public._container_planned_guard();

-- 3. Stock holds (the same availability architecture as sales reservations) ----------------------------
create or replace function public._available_quantity(p_part_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p.status = 'approved' and p.stage = 'ready_for_sale' and p.not_sellable_reason is null
             then p.quantity
                  - coalesce((select sum(r.quantity) from public.inventory_reservations r
                               where r.part_id = p.id and r.status = 'active'), 0)
                  - coalesce((select sum(i.planned_qty) from public.container_planned_items i
                               where i.part_id = p.id and i.status = 'planned'), 0)
           else 0
         end
    from public.parts p
   where p.id = p_part_id;
$$;

create or replace function public._sync_part_operational_status(p_part_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty int;
  v_status text;
  v_active int;
begin
  select quantity, operational_status into v_qty, v_status from public.parts where id = p_part_id;
  if v_status not in ('AVAILABLE', 'RESERVED', 'SOLD') then
    return;
  end if;
  select coalesce(sum(quantity), 0) into v_active
    from public.inventory_reservations
   where part_id = p_part_id and status = 'active';
  v_active := v_active + coalesce((select sum(i.planned_qty) from public.container_planned_items i
                                    where i.part_id = p_part_id and i.status = 'planned'), 0);
  update public.parts
     set operational_status = case
           when v_qty = 0 then 'SOLD'
           when v_qty - v_active <= 0 then 'RESERVED'
           else 'AVAILABLE'
         end,
         updated_at = now()
   where id = p_part_id;
end;
$$;

-- 4. Access helpers --------------------------------------------------------------------------------
-- Management (owner, engineer_admin, export_manager) sees every container. A loader sees only containers assigned to them.
create or replace function public._container_access(p_container_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_export_authorized()
      or exists (select 1 from public.container_jobs c where c.id = p_container_id and c.assigned_loader_id = auth.uid());
$$;
revoke execute on function public._container_access(uuid) from public, anon, authenticated;

create or replace function public._container_require_access(p_container_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.container_jobs where id = p_container_id) then
    raise exception 'container not found' using errcode = '22023';
  end if;
  if not public._container_access(p_container_id) then
    raise exception 'forbidden: this container is not assigned to you' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public._container_require_access(uuid) from public, anon, authenticated;

create or replace function public._container_active_loader_name(p_loader_id uuid)
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
   where p.id = p_loader_id
     and p.account_status = 'active'
     and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                  where ur.user_id = p.id and r.key = 'container_loading');
  if v_name is null then
    raise exception 'choose an active Container Loader' using errcode = '22023';
  end if;
  return v_name;
end;
$$;
revoke execute on function public._container_active_loader_name(uuid) from public, anon, authenticated;

create or replace function public._container_planned_count(p_container_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case when public._container_access(p_container_id) then
           (select count(*)::int from public.container_planned_items i
             where i.container_id = p_container_id and i.status in ('planned', 'finalized'))
         else 0 end;
$$;
revoke execute on function public._container_planned_count(uuid) from public, anon;
grant execute on function public._container_planned_count(uuid) to authenticated;

-- 5. Row access: a loader reads only their own containers and their history -----------------------------
drop policy if exists container_jobs_staff_read on public.container_jobs;
create policy container_jobs_scoped_read on public.container_jobs
  for select using (public.is_export_authorized() or assigned_loader_id = auth.uid());

drop policy if exists container_events_domain_read on public.container_events;
drop policy if exists container_events_domain_insert on public.container_events;
create policy container_events_scoped_read on public.container_events
  for select using (public.is_export_authorized() or exists (
    select 1 from public.container_jobs c where c.id = container_id and c.assigned_loader_id = auth.uid()));

grant select (assigned_loader_id, assigned_at) on public.container_jobs to authenticated;

-- Media: evidence only for containers the caller can access; a loader's planned part photos are visible to them.
create or replace function public._container_media_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if new.owner_type <> 'container' then
    return new;
  end if;
  if new.role not in ('number_photo', 'loading_photo', 'final_list') then
    raise exception 'unknown container photo role' using errcode = '22023';
  end if;
  if public.is_export_authorized() then
    return new;
  end if;
  if not public._container_access(new.owner_id) then
    raise exception 'forbidden: this container is not assigned to you' using errcode = '42501';
  end if;
  select status into v_status from public.container_jobs where id = new.owner_id;
  if v_status is distinct from 'loading' then
    raise exception 'this container is no longer loading; evidence cannot be added' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

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
      then public.has_any_role('owner', 'engineer_admin', 'manager')
        or exists (select 1 from public.dismantling_sessions s where s.id = p_owner_id and s.employee_id = auth.uid() and public.has_any_role('dismantling'))
    when p_owner_type = 'part'
      then public.is_parts_staff()
        or exists (select 1 from public.parts p join public.dismantling_sessions s on s.id = p.dismantling_session_id
                    where p.id = p_owner_id and s.employee_id = auth.uid() and public.has_any_role('dismantling'))
        or exists (select 1 from public.container_planned_items i join public.container_jobs c on c.id = i.container_id
                    where i.part_id = p_owner_id and i.status in ('planned', 'finalized') and c.assigned_loader_id = auth.uid())
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
      then public._container_access(p_owner_id)
    when p_owner_type in ('export_invoice', 'export_payment')
      then public.is_export_authorized()
    else false
  end;
end;
$$;
revoke execute on function public.can_access_media(text, uuid) from public, anon;
grant execute on function public.can_access_media(text, uuid) to authenticated;

-- 6. Read models ------------------------------------------------------------------------------------
create or replace view public.container_loader_v with (security_invoker = true) as
select c.id,
       c.t_ref,
       c.container_number,
       c.number_confirmed,
       c.status,
       c.started_at,
       c.finished_at,
       c.loading_list_confirmed,
       c.created_at,
       c.last_update_at,
       (select count(*)::int from public.media_assets m where m.owner_type = 'container' and m.owner_id = c.id
          and m.role = 'number_photo' and m.variant = 'original' and m.status = 'ready') as number_photos,
       (select count(*)::int from public.media_assets m where m.owner_type = 'container' and m.owner_id = c.id
          and m.role = 'loading_photo' and m.variant = 'original' and m.status = 'ready') as loading_photos,
       (select count(*)::int from public.media_assets m where m.owner_type = 'container' and m.owner_id = c.id
          and m.role = 'final_list' and m.variant = 'original' and m.status = 'ready') as final_list_photos,
       c.assigned_loader_id,
       c.assigned_at,
       public._container_planned_count(c.id) as planned_items
  from public.container_jobs c;

-- ------------------------------------------------------------------------------------------------
-- 7. Management RPCs
-- ------------------------------------------------------------------------------------------------

-- Active Container Loaders for the picker. Names and ids only.
create or replace function public.export_list_loaders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public._export_require();
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name), '[]'::jsonb)
    into v
    from public.profiles p
   where p.account_status = 'active'
     and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                  where ur.user_id = p.id and r.key = 'container_loading');
  return v;
end;
$$;

-- New container: the internal LAL reference is generated here. The loader is required; the rest is optional.
create or replace function public.export_create_container(
  p_loader_id          uuid,
  p_consignee_id       uuid,
  p_destination_country text,
  p_destination_port   text,
  p_trucking_company   text,
  p_shipping_note      text,
  p_client_request_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_ref  text;
  v_name text;
begin
  perform public._export_require();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  select id into v_id from public.container_jobs where client_request_id = p_client_request_id;
  if v_id is not null then
    return public.export_get_container(v_id);  -- replay
  end if;
  v_name := public._container_active_loader_name(p_loader_id);
  if p_consignee_id is not null and not exists (select 1 from public.consignees where id = p_consignee_id) then
    raise exception 'choose a consignee from the list' using errcode = '22023';
  end if;

  v_ref := public._container_next_ref();
  insert into public.container_jobs (t_ref, status, started_at, created_by, assigned_loader_id, assigned_by, assigned_at,
                                     last_update_at, client_request_id, parts_planning)
  values (v_ref, 'loading', now(), auth.uid(), p_loader_id, auth.uid(), now(), now(), p_client_request_id, true)
  returning id into v_id;
  insert into public.container_shipping_info (container_id, destination_country, destination_port, trucking_company, consignee_id, shipping_note)
  values (v_id, btrim(coalesce(p_destination_country, '')), btrim(coalesce(p_destination_port, '')),
          btrim(coalesce(p_trucking_company, '')), p_consignee_id, btrim(coalesce(p_shipping_note, '')));
  perform public._container_event(v_id, 'created', 'Container ' || v_ref || ' created for loading');
  perform public._container_event(v_id, 'loader_assigned', 'Assigned to ' || v_name);
  return public.export_get_container(v_id);
end;
$$;

-- Reassign the loader. Only while the container is loading and the loader has not started (no evidence, no loaded units).
create or replace function public.export_assign_loader(p_container_id uuid, p_loader_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c      public.container_jobs%rowtype;
  v_name text;
  v_from text;
begin
  perform public._export_require();
  select * into c from public.container_jobs where id = p_container_id for update;
  if not found then
    raise exception 'container not found' using errcode = '22023';
  end if;
  if c.assigned_loader_id = p_loader_id then
    return public.export_get_container(p_container_id);
  end if;
  v_name := public._container_active_loader_name(p_loader_id);
  if c.status <> 'loading' then
    raise exception 'only a container that is still loading can change its loader' using errcode = 'P0001';
  end if;
  if c.number_confirmed or exists (select 1 from public.media_assets m where m.owner_type = 'container' and m.owner_id = p_container_id)
     or exists (select 1 from public.container_planned_items i where i.container_id = p_container_id and i.loaded_qty > 0) then
    raise exception 'the loader cannot change after loading has started' using errcode = 'P0001';
  end if;
  select name into v_from from public.profiles where id = c.assigned_loader_id;
  update public.container_jobs set assigned_loader_id = p_loader_id, assigned_by = auth.uid(), assigned_at = now(), last_update_at = now()
   where id = p_container_id;
  perform public._container_event(p_container_id, 'loader_reassigned',
    'Loader changed from ' || coalesce(v_from, 'unassigned') || ' to ' || v_name);
  return public.export_get_container(p_container_id);
end;
$$;

-- Inventory search for planned parts. Bounded (20), sellable, with available stock; never preloads the inventory.
create or replace function public.export_container_search_parts(p_container_id uuid, p_search text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := btrim(coalesce(p_search, ''));
  v jsonb;
begin
  perform public._export_require();
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.exact desc, x.part_name, x.id), '[]'::jsonb) into v
    from (
      select p.id, p.part_name, p.stock_sku, p.part_number, p.location,
             public._available_quantity(p.id) as available,
             (p.stock_sku = v_q) as exact
        from public.parts p
       where public._part_is_sellable_state(p)
         and (p.stock_sku = v_q or p.part_name ilike '%' || v_q || '%'
              or p.stock_sku ilike '%' || v_q || '%' or p.part_number ilike '%' || v_q || '%')
         and public._available_quantity(p.id) > 0
         and not exists (select 1 from public.container_planned_items i
                          where i.container_id = p_container_id and i.part_id = p.id and i.status = 'planned')
       order by (p.stock_sku = v_q) desc, p.part_name, p.id
       limit 20
    ) x;
  return v;
end;
$$;

-- Plan a part for a container: reserves the planned quantity. Refused when it exceeds what is available.
create or replace function public.export_container_add_planned(p_container_id uuid, p_part_id uuid, p_quantity int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c     public.container_jobs%rowtype;
  p     public.parts%rowtype;
  v_avail int;
  v_actor text;
begin
  perform public._export_require();
  select * into c from public.container_jobs where id = p_container_id for update;
  if not found then
    raise exception 'container not found' using errcode = '22023';
  end if;
  if c.status <> 'loading' then
    raise exception 'parts can be planned only while the container is loading' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'the planned quantity must be at least 1' using errcode = '22023';
  end if;
  select * into p from public.parts where id = p_part_id for update;
  if not found then
    raise exception 'part not found' using errcode = '22023';
  end if;
  if not public._part_is_sellable_state(p) then
    raise exception 'this part is not sellable right now' using errcode = '22023';
  end if;
  if exists (select 1 from public.container_planned_items i where i.container_id = p_container_id and i.part_id = p_part_id and i.status = 'planned') then
    raise exception 'this part is already planned for this container' using errcode = '22023';
  end if;
  v_avail := public._available_quantity(p_part_id);
  if p_quantity > v_avail then
    raise exception 'only % available right now; plan no more than that', v_avail using errcode = '22023';
  end if;
  select name into v_actor from public.profiles where id = auth.uid();
  insert into public.container_planned_items (container_id, part_id, planned_qty, added_by, added_by_name)
  values (p_container_id, p_part_id, p_quantity, auth.uid(), coalesce(v_actor, 'unknown'));
  perform public._sync_part_operational_status(p_part_id);
  perform public._container_event(p_container_id, 'part_planned',
    p.part_name || ' (' || coalesce(p.stock_sku, 'no SKU') || ') planned: ' || p_quantity);
  return public.container_planned_items(p_container_id);
end;
$$;

-- Remove a planned part before loading. Releases its hold. Refused once the loader has confirmed any quantity.
create or replace function public.export_container_remove_planned(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.container_planned_items%rowtype;
  c public.container_jobs%rowtype;
  p public.parts%rowtype;
begin
  perform public._export_require();
  select * into i from public.container_planned_items where id = p_item_id for update;
  if not found then
    raise exception 'planned line not found' using errcode = '22023';
  end if;
  select * into c from public.container_jobs where id = i.container_id for update;
  if c.status <> 'loading' then
    raise exception 'loading has finished; planned parts can no longer change' using errcode = 'P0001';
  end if;
  if i.status <> 'planned' then
    raise exception 'this line is already closed' using errcode = 'P0001';
  end if;
  if i.loaded_qty > 0 then
    raise exception 'the loader has confirmed a loaded quantity for this part; the loader must set it to 0 first' using errcode = 'P0001';
  end if;
  update public.container_planned_items set status = 'removed', removed_at = now() where id = p_item_id;
  select * into p from public.parts where id = i.part_id;
  perform public._sync_part_operational_status(i.part_id);
  perform public._container_event(i.container_id, 'part_removed',
    p.part_name || ' (' || coalesce(p.stock_sku, 'no SKU') || ') removed from the plan');
  return public.container_planned_items(i.container_id);
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- 8. Shared read: the planned parts of a container. Management sees stock detail; a loader sees only what they need.
-- ------------------------------------------------------------------------------------------------
create or replace function public.container_planned_items(p_container_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c      public.container_jobs%rowtype;
  v_items jsonb;
  v_export boolean := public.is_export_authorized();
begin
  perform public._container_require_access(p_container_id);
  select * into c from public.container_jobs where id = p_container_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'part_id', i.part_id, 'part_name', p.part_name, 'stock_sku', p.stock_sku,
           'planned_qty', i.planned_qty, 'loaded_qty', i.loaded_qty, 'released_qty', i.released_qty,
           'status', i.status, 'added_at', i.added_at, 'finalized_at', i.finalized_at)
           || case when v_export then jsonb_build_object(
                'part_number', p.part_number, 'location', p.location,
                'available', public._available_quantity(p.id), 'inventory_source', p.inventory_source,
                'added_by_name', i.added_by_name)
              else '{}'::jsonb end
           order by i.added_at, i.id), '[]'::jsonb)
    into v_items
    from public.container_planned_items i
    join public.parts p on p.id = i.part_id
   where i.container_id = p_container_id and i.status in ('planned', 'finalized');
  return jsonb_build_object(
    'container', jsonb_build_object(
       'id', c.id, 'status', c.status, 'parts_planning', c.parts_planning,
       'assigned_loader_id', c.assigned_loader_id,
       'assigned_loader_name', (select name from public.profiles where id = c.assigned_loader_id),
       'assigned_at', c.assigned_at, 'finished_at', c.finished_at),
    'items', v_items,
    'planned_total', coalesce((select sum(i.planned_qty) from public.container_planned_items i where i.container_id = p_container_id and i.status in ('planned','finalized')), 0),
    'loaded_total', coalesce((select sum(i.loaded_qty) from public.container_planned_items i where i.container_id = p_container_id and i.status in ('planned','finalized')), 0));
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- 9. Loader RPCs (scoped to the assigned loader)
-- ------------------------------------------------------------------------------------------------

-- Loaders no longer open containers: management creates and assigns them.
revoke execute on function public.container_loader_open(uuid) from authenticated;

create or replace function public.container_loader_list(
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
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_rows jsonb;
  v_more boolean;
begin
  perform public._container_require_staff();
  if p_status not in ('open', 'ready', 'all') then
    raise exception 'unknown list' using errcode = '22023';
  end if;
  with page as (
    select v.* from public.container_loader_v v
     where public._container_access(v.id)
       and (p_status = 'all'
            or (p_status = 'open' and v.status = 'loading')
            or (p_status = 'ready' and v.status <> 'loading'))
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

create or replace function public.container_loader_get(p_container_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
begin
  perform public._container_require_staff();
  perform public._container_require_access(p_container_id);
  v_row := public._container_loader_row(p_container_id);
  return jsonb_build_object(
    'container', v_row,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'created_at', m.created_at) order by m.created_at)
                          from public.media_assets m
                         where m.owner_type = 'container' and m.owner_id = p_container_id
                           and m.variant = 'original' and m.status = 'ready'), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actor_name', e.actor_name, 'note', e.note, 'created_at', e.created_at) order by e.created_at desc)
                          from (select * from public.container_events where container_id = p_container_id order by created_at desc limit 50) e), '[]'::jsonb)
  );
end;
$$;

create or replace function public.container_loader_confirm_number(p_container_id uuid, p_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.container_jobs%rowtype;
  v_number text := upper(btrim(coalesce(p_number, '')));
begin
  perform public._container_require_staff();
  select * into c from public.container_jobs where id = p_container_id for update;
  if not found then
    raise exception 'container not found' using errcode = '22023';
  end if;
  perform public._container_require_access(p_container_id);
  if c.status <> 'loading' then
    raise exception 'this container is no longer loading' using errcode = 'P0001';
  end if;
  if v_number !~ '^[A-Z]{4}[0-9]{7}$' then
    raise exception 'the container number must be 4 letters and 7 digits, for example MSCU1234567' using errcode = '22023';
  end if;
  if c.number_confirmed and c.container_number = v_number then
    return public._container_loader_row(p_container_id);  -- replay
  end if;
  if not exists (select 1 from public.media_assets m where m.owner_type = 'container' and m.owner_id = p_container_id
                    and m.role = 'number_photo' and m.variant = 'original' and m.status = 'ready') then
    raise exception 'take the container number photo before confirming the number' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.container_jobs where container_number = v_number and id <> p_container_id) then
    raise exception 'that container number is already used by another container' using errcode = '22023';
  end if;
  update public.container_jobs
     set container_number = v_number, number_confirmed = true, last_update_at = now()
   where id = p_container_id;
  perform public._container_event(p_container_id, 'number_confirmed', 'Container number confirmed');
  return public._container_loader_row(p_container_id);
end;
$$;

-- The loaded quantity for one planned line. Only the assigned loader, only while loading, only 0..planned.
-- No stock moves here: stock is finalized once, by Finish Loading.
create or replace function public.container_loader_set_loaded(p_item_id uuid, p_loaded_qty int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.container_planned_items%rowtype;
  c public.container_jobs%rowtype;
begin
  perform public._container_require_staff();
  select * into i from public.container_planned_items where id = p_item_id for update;
  if not found then
    raise exception 'planned line not found' using errcode = '22023';
  end if;
  select * into c from public.container_jobs where id = i.container_id for update;
  perform public._container_require_access(c.id);
  if c.assigned_loader_id is distinct from auth.uid() then
    raise exception 'forbidden: only the assigned Container Loader confirms loaded quantities' using errcode = '42501';
  end if;
  if c.status <> 'loading' then
    raise exception 'this container is no longer loading' using errcode = 'P0001';
  end if;
  if i.status <> 'planned' then
    raise exception 'this line is closed' using errcode = 'P0001';
  end if;
  if p_loaded_qty is null or p_loaded_qty < 0 or p_loaded_qty > i.planned_qty then
    raise exception 'the loaded quantity must be between 0 and the planned % — ask management to add more to the plan', i.planned_qty
      using errcode = '22023';
  end if;
  update public.container_planned_items set loaded_qty = p_loaded_qty where id = p_item_id;
  return public.container_planned_items(c.id);
end;
$$;

-- Finish Loading. Atomic and idempotent: the container row is locked, a second finish returns the finished state and
-- deducts nothing. Each planned line exports its loaded quantity once and releases the rest back to stock.
create or replace function public.container_loader_finish(p_container_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c            public.container_jobs%rowtype;
  it           public.container_planned_items%rowtype;
  v_part       public.parts%rowtype;
  v_planned    int;
  v_loaded     int;
  v_actor      text;
  v_role       text;
begin
  perform public._container_require_staff();
  select * into c from public.container_jobs where id = p_container_id for update;
  if not found then
    raise exception 'container not found' using errcode = '22023';
  end if;
  perform public._container_require_access(p_container_id);
  if c.status <> 'loading' then
    return public._container_loader_row(p_container_id);  -- already finished: replay, nothing changes
  end if;
  if c.assigned_loader_id is distinct from auth.uid() then
    raise exception 'forbidden: only the assigned Container Loader finishes loading' using errcode = '42501';
  end if;
  if not c.number_confirmed or c.container_number is null then
    raise exception 'confirm the container number before finishing loading' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.media_assets m where m.owner_type = 'container' and m.owner_id = p_container_id
                    and m.role = 'loading_photo' and m.variant = 'original' and m.status = 'ready') then
    raise exception 'add at least one loading photo before finishing' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.media_assets m where m.owner_type = 'container' and m.owner_id = p_container_id
                    and m.role = 'final_list' and m.variant = 'original' and m.status = 'ready') then
    raise exception 'add the final loading list photo before finishing' using errcode = 'P0001';
  end if;

  select count(*)::int, coalesce(sum(loaded_qty), 0)::int into v_planned, v_loaded
    from public.container_planned_items where container_id = p_container_id and status = 'planned';
  if v_planned > 0 and v_loaded = 0 then
    raise exception 'enter the loaded quantity for at least one planned part before finishing' using errcode = 'P0001';
  end if;

  select name into v_actor from public.profiles where id = auth.uid();
  select public._parts_actor_role() into v_role;
  for it in
    select * from public.container_planned_items
     where container_id = p_container_id and status = 'planned'
     order by part_id
     for update
  loop
    select * into v_part from public.parts where id = it.part_id for update;
    if v_part.quantity < it.loaded_qty then
      raise exception 'the stock for % changed; the loaded quantity is more than the stock on hand', v_part.part_name using errcode = 'P0001';
    end if;
    update public.parts set quantity = quantity - it.loaded_qty where id = it.part_id;
    insert into public.part_operations (part_id, action_type, previous_quantity, new_quantity, quantity_delta, note,
                                        actor_id, actor_name, actor_role)
    values (it.part_id, 'CONTAINER_EXPORT', v_part.quantity, v_part.quantity - it.loaded_qty, -it.loaded_qty,
            'Loaded into container ' || c.t_ref || ' (planned ' || it.planned_qty || ', loaded ' || it.loaded_qty || ')',
            auth.uid(), coalesce(v_actor, 'unknown'), v_role);
    update public.container_planned_items
       set status = 'finalized', finalized_at = now(), finalized_by = auth.uid(), released_qty = it.planned_qty - it.loaded_qty
     where id = it.id;
    perform public._sync_part_operational_status(it.part_id);
  end loop;

  update public.container_jobs
     set status = 'ready_for_invoice', finished_at = now(), loading_list_confirmed = true,
         loading_finished_by = auth.uid(), last_update_at = now()
   where id = p_container_id;
  perform public._container_event(p_container_id, 'loading_finished',
    'Loading finished; ready for invoice. ' || v_loaded || ' unit(s) loaded from ' || v_planned || ' planned line(s)');
  return public._container_loader_row(p_container_id);
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- 10. Invoice: a draft line may point at a finalized planned line of the same container (prefill from loaded parts).
--     Prices are entered by management; nothing here reads Parts Inventory prices.
-- ------------------------------------------------------------------------------------------------
alter table public.export_invoice_line_items add column source_item_id uuid references public.container_planned_items(id);
create index export_invoice_line_items_source_idx on public.export_invoice_line_items (source_item_id) where source_item_id is not null;

create or replace function public._export_invoice_view(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  inv public.export_invoices%rowtype;
  v_rev public.export_invoice_revisions%rowtype;
  v_items jsonb;
  v_snapshot jsonb;
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_revisions int;
begin
  select * into inv from public.export_invoices where id = p_invoice_id;
  if not found then
    return null;
  end if;
  select count(*)::int into v_revisions from public.export_invoice_revisions where invoice_id = p_invoice_id;
  select * into v_rev from public.export_invoice_revisions where invoice_id = p_invoice_id order by revision_number desc nulls last, saved_at desc limit 1;
  if found then
    v_items := v_rev.items_snapshot;
    v_snapshot := v_rev.consignee_snapshot;
  else
    v_items := coalesce((select jsonb_agg(jsonb_build_object('description', li.description, 'quantity', li.quantity,
                          'unit_price', li.unit_price, 'category', li.category, 'condition', li.condition,
                          'line_total', li.line_total, 'source_item_id', li.source_item_id) order by li.created_at, li.id)
                        from public.export_invoice_line_items li where li.invoice_id = p_invoice_id), '[]'::jsonb);
    v_snapshot := inv.consignee_snapshot;
  end if;
  select coalesce(sum(round((e->>'quantity')::numeric * (e->>'unit_price')::numeric, 2)), 0)::numeric(14,2)
    into v_total from jsonb_array_elements(v_items) e;
  select coalesce(sum(p.amount), 0)::numeric(14,2) into v_paid
    from public.export_payments p
   where p.invoice_id = p_invoice_id and p.correction_of is null
     and not exists (select 1 from public.export_payments r where r.correction_of = p.id);
  return jsonb_build_object(
    'id', inv.id, 'container_id', inv.container_id, 't_ref', inv.t_ref, 'invoice_number', inv.invoice_number,
    'status', inv.status, 'finalized_at', inv.finalized_at, 'notes', inv.notes, 'currency', inv.currency,
    'consignee_id', inv.consignee_id, 'consignee', v_snapshot, 'items', v_items,
    'revision_count', v_revisions, 'total', v_total, 'paid', v_paid, 'balance', v_total - v_paid);
end;
$$;

create or replace function public.export_save_invoice_draft(
  p_invoice_id  uuid,
  p_consignee_id uuid,
  p_notes       text,
  p_lines       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.export_invoices%rowtype;
begin
  perform public._export_require();
  select * into inv from public.export_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found' using errcode = '22023';
  end if;
  if inv.status = 'Finalized' then
    raise exception 'a finalized invoice cannot be edited; create a revision with a reason' using errcode = 'P0001';
  end if;
  if p_consignee_id is null or not exists (select 1 from public.consignees where id = p_consignee_id) then
    raise exception 'choose a consignee' using errcode = '22023';
  end if;
  perform public._export_check_lines(p_lines);
  if exists (
       select 1 from jsonb_to_recordset(p_lines) as r(source_item_id uuid)
        where r.source_item_id is not null
          and not exists (select 1 from public.container_planned_items i
                           where i.id = r.source_item_id and i.container_id = inv.container_id and i.status = 'finalized')) then
    raise exception 'a line refers to a part that was not loaded into this container' using errcode = '22023';
  end if;
  if exists (
       select 1 from (
         select r.source_item_id, sum(r.quantity) as q
           from jsonb_to_recordset(p_lines) as r(source_item_id uuid, quantity int)
          where r.source_item_id is not null
          group by r.source_item_id) s
         join public.container_planned_items i on i.id = s.source_item_id
        where s.q > i.loaded_qty) then
    raise exception 'invoice quantity for a loaded part is more than the quantity loaded' using errcode = '22023';
  end if;
  delete from public.export_invoice_line_items where invoice_id = p_invoice_id;
  insert into public.export_invoice_line_items (invoice_id, description, quantity, unit_price, category, condition, source_item_id)
  select p_invoice_id, btrim(r.description), r.quantity, round(r.unit_price, 2), nullif(btrim(coalesce(r.category, '')), ''),
         nullif(btrim(coalesce(r.condition, '')), ''), r.source_item_id
    from jsonb_to_recordset(p_lines) as r(description text, quantity int, unit_price numeric, category text, condition text, source_item_id uuid);
  update public.export_invoices set consignee_id = p_consignee_id, notes = coalesce(p_notes, '') where id = p_invoice_id;
  return public._export_invoice_view(p_invoice_id);
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- 11. Grants
-- ------------------------------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'export_list_loaders()', 'export_create_container(uuid,uuid,text,text,text,text,uuid)',
    'export_assign_loader(uuid,uuid)', 'export_container_search_parts(uuid,text)',
    'export_container_add_planned(uuid,uuid,int)', 'export_container_remove_planned(uuid)',
    'container_planned_items(uuid)', 'container_loader_set_loaded(uuid,int)',
    'container_loader_finish(uuid,uuid)', 'container_loader_list(text,int,timestamptz,uuid)',
    'container_loader_get(uuid)', 'container_loader_confirm_number(uuid,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
