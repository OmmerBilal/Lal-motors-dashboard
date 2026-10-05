-- =====================================================================================
-- 0052 — Central Dispatch and inbound read models (Module 02). ADDITIVE: three read functions, no writes.
--
--   dispatch_pickup_groups   one summary row per pickup location for the grouped screen (keyset by group key)
--   dispatch_group_vehicles  the vehicles of one pickup location, keyset-paged (created_at, id)
--   dispatch_inbound_vehicles the receiving screen's inbound list, bounded
--
-- All three run SECURITY INVOKER, so the vehicles RLS of the caller decides what is visible. Closed vehicles are
-- excluded. The same master vehicle rows are read: no dispatch-only copy of vehicle data.
-- =====================================================================================

-- Group key: pickup location name plus address, so two locations with the same name at different addresses stay apart.
create or replace function public._dispatch_group_key(p_name text, p_address text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(btrim(p_name), ''), '(no pickup location)') || '|' || coalesce(btrim(p_address), '');
$$;

-- Tab filter shared by the summary and the vehicle page. "all" and "byLocation" mean no status filter.
create or replace function public._dispatch_tab_matches(v public.vehicles, p_tab text)
returns boolean
language sql
stable
as $$
  select case
    when p_tab is null or p_tab in ('', 'all', 'byLocation') then true
    when p_tab = 'overdue' then public.vehicle_stage(v) = 'overdue'
    when p_tab in ('NEED_TRANSPORT','READY_TO_POST','POSTED_TO_CD','ASSIGNED','IN_TRANSIT','ARRIVED','PROBLEM') then v.transport_status = p_tab
    else false
  end;
$$;

create or replace function public.dispatch_pickup_groups(
  p_tab text default 'byLocation',
  p_search text default null,
  p_auction text default null,
  p_after text default null,
  p_limit int default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select v.*, public._dispatch_group_key(v.pickup_location_name, v.pickup_address) as gkey, public.vehicle_stage(v) as stg
      from public.vehicles v
     where v.closed_reason is null
       and public._dispatch_tab_matches(v, p_tab)
       and (p_auction is null or p_auction = '' or v.auction_source = p_auction)
       and (p_search is null or p_search = '' or
            v.vin ilike '%' || p_search || '%' or v.stock_number ilike '%' || p_search || '%' or
            v.lot_number ilike '%' || p_search || '%' or v.pickup_pin ilike '%' || p_search || '%' or
            v.make ilike '%' || p_search || '%' or v.model ilike '%' || p_search || '%')
  ),
  grouped as (
    select gkey,
           max(coalesce(nullif(btrim(pickup_location_name), ''), '(no pickup location)')) as name,
           max(coalesce(btrim(pickup_address), '')) as address,
           count(*)::int as vehicle_count,
           count(*) filter (where transport_status = 'NEED_TRANSPORT')::int as need_transport,
           count(*) filter (where transport_status = 'READY_TO_POST')::int as ready_to_post,
           count(*) filter (where transport_status = 'POSTED_TO_CD')::int as posted,
           count(*) filter (where transport_status = 'ASSIGNED')::int as assigned,
           count(*) filter (where transport_status = 'IN_TRANSIT')::int as in_transit,
           count(*) filter (where transport_status = 'ARRIVED')::int as arrived,
           count(*) filter (where transport_status = 'PROBLEM')::int as problem,
           count(*) filter (where stg = 'overdue')::int as overdue
      from base
     group by gkey
  ),
  page as (
    select * from grouped
     where p_after is null or gkey > p_after
     order by gkey
     limit least(greatest(coalesce(p_limit, 50), 1), 200) + 1
  )
  select jsonb_build_object(
    'groups', coalesce((select jsonb_agg(to_jsonb(g) - 'gkey' order by g.gkey) from (select * from page order by gkey limit least(greatest(coalesce(p_limit, 50), 1), 200)) g), '[]'::jsonb),
    'has_more', (select count(*) > least(greatest(coalesce(p_limit, 50), 1), 200) from page),
    'next_after', (select gkey from (select gkey from page order by gkey limit least(greatest(coalesce(p_limit, 50), 1), 200)) x order by gkey desc limit 1)
  );
$$;

create or replace function public.dispatch_group_vehicles(
  p_group text,
  p_tab text default 'byLocation',
  p_search text default null,
  p_auction text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit int default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with lim as (select least(greatest(coalesce(p_limit, 50), 1), 200) as n),
  page as (
    select v.id, v.vin, v.lot_number, v.stock_number, v.auction_source, v.year, v.make, v.model, v."trim", v.engine,
           v.status, v.transport_status, v.purchase_date, v.purchase_price, v.total_landed_cost,
           v.pickup_location_name, v.pickup_address, v.pickup_pin, v.transport_price, v.transport_problem,
           v.closed_reason, v.arrival_date, v.received_at, v.carrier_id, c.company as carrier_company,
           v.receiving_status, v.created_at, public.vehicle_stage(v) as stage
      from public.vehicles v
      left join public.carriers c on c.id = v.carrier_id
     where v.closed_reason is null
       and public._dispatch_group_key(v.pickup_location_name, v.pickup_address) = p_group
       and public._dispatch_tab_matches(v, p_tab)
       and (p_auction is null or p_auction = '' or v.auction_source = p_auction)
       and (p_search is null or p_search = '' or
            v.vin ilike '%' || p_search || '%' or v.stock_number ilike '%' || p_search || '%' or
            v.lot_number ilike '%' || p_search || '%' or v.pickup_pin ilike '%' || p_search || '%' or
            v.make ilike '%' || p_search || '%' or v.model ilike '%' || p_search || '%')
       and (p_cursor_created_at is null or (v.created_at, v.id) < (p_cursor_created_at, p_cursor_id))
     order by v.created_at desc, v.id desc
     limit (select n + 1 from lim)
  ),
  shown as (
    select * from page order by created_at desc, id desc limit (select n from lim)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc, s.id desc) from shown s), '[]'::jsonb),
    'has_more', (select count(*) > (select n from lim) from page)
  );
$$;

create or replace function public.dispatch_inbound_vehicles(p_limit int default 200)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb)
    from (
      select v.id, v.vin, v.lot_number, v.stock_number, v.auction_source, v.year, v.make, v.model, v."trim", v.engine,
             v.status, v.transport_status, v.purchase_date, v.purchase_price, v.total_landed_cost,
             v.pickup_location_name, v.pickup_address, v.pickup_pin, v.transport_price, v.transport_problem,
             v.closed_reason, v.arrival_date, v.received_at, v.carrier_id, c.company as carrier_company,
             v.receiving_status, v.created_at, public.vehicle_stage(v) as stage
        from public.vehicles v
        left join public.carriers c on c.id = v.carrier_id
       where v.closed_reason is null
         and v.receiving_status = 'not_received'
         and v.transport_status in ('ASSIGNED', 'IN_TRANSIT')
       order by v.created_at desc, v.id desc
       limit least(greatest(coalesce(p_limit, 200), 1), 200)
    ) x;
$$;

revoke execute on function public.dispatch_pickup_groups(text, text, text, text, int) from public, anon;
revoke execute on function public.dispatch_group_vehicles(text, text, text, text, timestamptz, uuid, int) from public, anon;
revoke execute on function public.dispatch_inbound_vehicles(int) from public, anon;
grant execute on function public.dispatch_pickup_groups(text, text, text, text, int) to authenticated;
grant execute on function public.dispatch_group_vehicles(text, text, text, text, timestamptz, uuid, int) to authenticated;
grant execute on function public.dispatch_inbound_vehicles(int) to authenticated;
