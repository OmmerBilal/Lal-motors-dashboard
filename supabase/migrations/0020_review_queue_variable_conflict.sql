-- =====================================================================================
-- 0020 — list_dismantling_review_queue(): fix ambiguous column references.
--
-- ADDITIVE. 0019 is applied and not edited. The RETURNS TABLE output names (id, created_at,
-- status, ...) clash with the table columns used in the body. Found by rpc-processing.mjs, which
-- returned no rows because the function raised "column reference created_at is ambiguous".
-- #variable_conflict use_column makes column names win inside the query.
-- =====================================================================================

create or replace function public.list_dismantling_review_queue(
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid, vehicle_id uuid, vin text, lot_or_stock text, vehicle_label text,
  status text, dismantling_session_id uuid, captured_by uuid, employee_name text,
  created_at timestamptz, thumbnail_path text, thumbnail_bucket text, has_more boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');
  return query
  with page as (
    select p.*
      from public.parts p
     where p.dismantling_session_id is not null
       and p.status in ('captured', 'draft_ready', 'manager_review')
       and (p_from is null or p.created_at >= p_from)
       and (p_to is null or p.created_at < p_to)
       and (p_cursor_created_at is null or (p.created_at, p.id) > (p_cursor_created_at, p_cursor_id))
     order by p.created_at, p.id
     limit v_limit + 1
  ),
  numbered as (select page.*, row_number() over (order by created_at, id) as rn from page)
  select n.id, n.vehicle_id, n.source_vin, n.source_lot,
         concat_ws(' ', v.year::text, v.make, v.model),
         n.status, n.dismantling_session_id, n.captured_by,
         coalesce(pr.name, 'Unknown employee'),
         n.created_at,
         m.storage_path, m.bucket,
         exists (select 1 from numbered x where x.rn = v_limit + 1)
    from numbered n
    join public.vehicles v on v.id = n.vehicle_id
    left join public.profiles pr on pr.id = n.captured_by
    left join public.media_assets m
      on m.owner_type = 'part' and m.owner_id = n.id and m.variant = 'thumbnail' and m.status = 'ready'
   where n.rn <= v_limit
   order by n.created_at, n.id;
end;
$$;

revoke execute on function public.list_dismantling_review_queue(timestamptz, timestamptz, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_dismantling_review_queue(timestamptz, timestamptz, int, timestamptz, uuid) to authenticated;
