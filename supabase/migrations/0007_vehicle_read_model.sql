-- =====================================================================================
-- 0007 — Vehicle read model for Auction Vehicle Inventory: stage, keyset list, KPI counts.
--
-- ADDITIVE. Read-only. Runs as the CALLER (security invoker), so RLS on vehicles and
-- media_assets still decides what each role can see.
--
-- Stage mirrors src/lib/mock/vehicles.ts auctionStageInfo(), so the UI cards and table keep
-- the approved meaning:
--   closed      closed_reason is set
--   overdue     not ARRIVED, not PROBLEM, open, and purchase_date is 10+ days ago
--   transit     transport_status = IN_TRANSIT
--   available   transport_status = ARRIVED
--   waiting     everything else
--
-- List: keyset pagination on (created_at, id), newest first. The thumbnail comes from ONE
-- LEFT JOIN to media_assets on thumbnail_asset_id. Only the thumbnail variant's path is
-- returned, never the original.
-- =====================================================================================

create or replace function public.vehicle_stage(p_vehicle public.vehicles)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_vehicle.closed_reason is not null then 'closed'
    when p_vehicle.transport_status not in ('ARRIVED', 'PROBLEM')
         and (current_date - p_vehicle.purchase_date) >= 10 then 'overdue'
    when p_vehicle.transport_status = 'IN_TRANSIT' then 'transit'
    when p_vehicle.transport_status = 'ARRIVED' then 'available'
    else 'waiting'
  end;
$$;

-- KPI counts over ALL vehicles, one scan. The cards always show whole-inventory figures.
create or replace function public.vehicle_stage_counts()
returns table (total bigint, waiting bigint, transit bigint, available bigint, overdue bigint, closed bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*),
    count(*) filter (where public.vehicle_stage(v) = 'waiting'),
    count(*) filter (where public.vehicle_stage(v) = 'transit'),
    count(*) filter (where public.vehicle_stage(v) = 'available'),
    count(*) filter (where public.vehicle_stage(v) = 'overdue'),
    count(*) filter (where public.vehicle_stage(v) = 'closed')
  from public.vehicles v;
$$;

-- Keyset list. p_cursor_created_at / p_cursor_id are both null for the first page.
create or replace function public.list_vehicles(
  p_stage            text default null,
  p_auction_source   text default null,
  p_search           text default null,
  p_limit            int  default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_id        uuid default null
)
returns table (
  id uuid, vin text, lot_number text, stock_number text, auction_source text,
  year int, make text, model text, "trim" text, status text, transport_status text,
  purchase_date date, purchase_price numeric, total_landed_cost numeric,
  pickup_location_name text, closed_reason text, carrier_id uuid, receiving_status text,
  thumbnail_path text, thumbnail_bucket text, stage text,
  created_at timestamptz, has_more boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with page as (
    select v.*, public.vehicle_stage(v) as stage
      from public.vehicles v
     where (p_stage is null or public.vehicle_stage(v) = p_stage)
       and (p_auction_source is null or v.auction_source = p_auction_source)
       and (p_search is null or p_search = '' or
            v.vin ilike '%' || p_search || '%' or
            v.stock_number ilike '%' || p_search || '%' or
            v.lot_number ilike '%' || p_search || '%' or
            v.make ilike '%' || p_search || '%' or
            v.model ilike '%' || p_search || '%')
       and (p_cursor_created_at is null or (v.created_at, v.id) < (p_cursor_created_at, p_cursor_id))
     order by v.created_at desc, v.id desc
     limit least(greatest(coalesce(p_limit, 25), 1), 100) + 1
  ),
  numbered as (
    select page.*, row_number() over (order by created_at desc, id desc) as rn from page
  )
  select
    n.id, n.vin, n.lot_number, n.stock_number, n.auction_source,
    n.year, n.make, n.model, n."trim", n.status, n.transport_status,
    n.purchase_date, n.purchase_price, n.total_landed_cost,
    n.pickup_location_name, n.closed_reason, n.carrier_id, n.receiving_status,
    m.storage_path, m.bucket, n.stage,
    n.created_at,
    exists (select 1 from numbered x where x.rn = least(greatest(coalesce(p_limit, 25), 1), 100) + 1) as has_more
  from numbered n
  left join public.media_assets m on m.id = n.thumbnail_asset_id and m.variant = 'thumbnail'
  where n.rn <= least(greatest(coalesce(p_limit, 25), 1), 100)
  order by n.created_at desc, n.id desc;
$$;

-- Privileges: authenticated only (RLS still applies inside, because these are invoker functions).
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.vehicle_stage(public.vehicles)',
    'public.vehicle_stage_counts()',
    'public.list_vehicles(text, text, text, int, timestamptz, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
