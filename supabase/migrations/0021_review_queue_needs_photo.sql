-- =====================================================================================
-- 0021 — The review queue and "needs review" count only include captures that HAVE a ready photo.
--
-- ADDITIVE. 0019 and 0020 are applied and not edited. Both functions are re-defined here.
--
-- A capture whose photo is still uploading is in progress, not awaiting review, and
-- approve_dismantled_part refuses it (PART_WITHOUT_PHOTO). Showing it in the queue would send the
-- manager to a dead end, so it is excluded from the queue and from the needs-review count.
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
       and exists (
         select 1 from public.media_assets ma
          where ma.owner_type = 'part' and ma.owner_id = p.id
            and ma.variant = 'original' and ma.status = 'ready'
       )
       and (p_from is null or p.created_at >= p_from)
       and (p_to is null or p.created_at < p_to)
       and (p_cursor_created_at is null or (p.created_at, p.id) > (p_cursor_created_at, p_cursor_id))
     order by p.created_at, p.id
     limit v_limit + 1
  ),
  numbered as (select page.*, row_number() over (order by page.created_at, page.id) as rn from page)
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

create or replace function public.dismantling_processing_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_needs_review int;
  v_completed int;
  v_captured int;
  v_employees jsonb;
begin
  perform public._rpc_require_roles('owner', 'engineer_admin', 'manager');

  select count(*) into v_needs_review from public.parts p
   where p.dismantling_session_id is not null
     and p.status in ('captured', 'draft_ready', 'manager_review')
     and exists (
       select 1 from public.media_assets ma
        where ma.owner_type = 'part' and ma.owner_id = p.id
          and ma.variant = 'original' and ma.status = 'ready'
     );

  select count(*) into v_completed from public.dismantling_sessions s
   where s.status = 'completed' and s.ended_at >= p_from and s.ended_at < p_to;

  select count(*) into v_captured from public.parts p
   where p.dismantling_session_id is not null and p.created_at >= p_from and p.created_at < p_to;

  select coalesce(jsonb_agg(z.e order by z.parts desc, z.name), '[]'::jsonb) into v_employees
    from (
      select x.parts, coalesce(pr.name, 'Unknown employee') as name,
             jsonb_build_object(
               'employee_id', x.employee_id,
               'name', coalesce(pr.name, 'Unknown employee'),
               'sessions', x.sessions,
               'parts', x.parts
             ) as e
        from (
          select s.employee_id,
                 count(distinct s.id) filter (where s.status = 'completed') as sessions,
                 count(p.id) as parts
            from public.dismantling_sessions s
            left join public.parts p
              on p.dismantling_session_id = s.id and p.created_at >= p_from and p.created_at < p_to
           where s.started_at >= p_from and s.started_at < p_to
           group by s.employee_id
        ) x
        left join public.profiles pr on pr.id = x.employee_id
    ) z;

  return jsonb_build_object(
    'needs_review', v_needs_review,
    'completed_in_range', v_completed,
    'parts_captured_in_range', v_captured,
    'employees', v_employees
  );
end;
$$;

revoke execute on function public.list_dismantling_review_queue(timestamptz, timestamptz, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_dismantling_review_queue(timestamptz, timestamptz, int, timestamptz, uuid) to authenticated;
revoke execute on function public.dismantling_processing_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.dismantling_processing_summary(timestamptz, timestamptz) to authenticated;
