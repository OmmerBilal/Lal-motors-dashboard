-- =====================================================================================
-- 0008 — Vehicle list: carrier filter + carrier company, and filter options.
--
-- ADDITIVE. 0007 is not edited. list_vehicles is re-created with a new signature because
-- the transporter filter and the carrier name must come from the database, not from client
-- filtering (client-side filtering breaks keyset pagination).
-- =====================================================================================

drop function if exists public.list_vehicles(text, text, text, int, timestamptz, uuid);

create or replace function public.list_vehicles(
  p_stage             text default null,
  p_auction_source    text default null,
  p_search            text default null,
  p_limit             int  default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid default null,
  p_carrier_id        uuid default null
)
returns table (
  id uuid, vin text, lot_number text, stock_number text, auction_source text,
  year int, make text, model text, "trim" text, status text, transport_status text,
  purchase_date date, purchase_price numeric, total_landed_cost numeric,
  pickup_location_name text, closed_reason text, carrier_id uuid, carrier_company text,
  receiving_status text, thumbnail_path text, thumbnail_bucket text, stage text,
  created_at timestamptz, has_more boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with lim as (
    select least(greatest(coalesce(p_limit, 25), 1), 100) as n
  ),
  page as (
    select v.*, public.vehicle_stage(v) as stage
      from public.vehicles v
     where (p_stage is null or public.vehicle_stage(v) = p_stage)
       and (p_auction_source is null or v.auction_source = p_auction_source)
       and (p_carrier_id is null or v.carrier_id = p_carrier_id)
       and (p_search is null or p_search = '' or
            v.vin ilike '%' || p_search || '%' or
            v.stock_number ilike '%' || p_search || '%' or
            v.lot_number ilike '%' || p_search || '%' or
            v.make ilike '%' || p_search || '%' or
            v.model ilike '%' || p_search || '%')
       and (p_cursor_created_at is null or (v.created_at, v.id) < (p_cursor_created_at, p_cursor_id))
     order by v.created_at desc, v.id desc
     limit (select n + 1 from lim)
  ),
  numbered as (
    select page.*, row_number() over (order by created_at desc, id desc) as rn from page
  )
  select
    n.id, n.vin, n.lot_number, n.stock_number, n.auction_source,
    n.year, n.make, n.model, n."trim", n.status, n.transport_status,
    n.purchase_date, n.purchase_price, n.total_landed_cost,
    n.pickup_location_name, n.closed_reason, n.carrier_id, c.company,
    n.receiving_status, m.storage_path, m.bucket, n.stage,
    n.created_at,
    exists (select 1 from numbered x where x.rn = (select n from lim) + 1) as has_more
  from numbered n
  left join public.carriers c on c.id = n.carrier_id
  left join public.media_assets m on m.id = n.thumbnail_asset_id and m.variant = 'thumbnail'
  where n.rn <= (select n from lim)
  order by n.created_at desc, n.id desc;
$$;

-- Distinct auction sources and active carriers for the filter dropdowns. Small result, one call.
create or replace function public.vehicle_filter_options()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'auction_sources', coalesce((select jsonb_agg(s order by s) from (select distinct auction_source as s from public.vehicles where auction_source <> '') x), '[]'::jsonb),
    'carriers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'company', company) order by company) from public.carriers where active), '[]'::jsonb)
  );
$$;

revoke execute on function public.list_vehicles(text, text, text, int, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.list_vehicles(text, text, text, int, timestamptz, uuid, uuid) to authenticated;
revoke execute on function public.vehicle_filter_options() from public, anon;
grant execute on function public.vehicle_filter_options() to authenticated;
