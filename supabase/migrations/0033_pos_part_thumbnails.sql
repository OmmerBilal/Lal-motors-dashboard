-- ---------------------------------------------------------------------------------------
-- 0033 — POS part thumbnails (Module 08).
--
-- Part media is private and readable only by parts staff (media_assets RLS via can_access_media).
-- Sales staff need the thumbnail of a SELLABLE part on the POS screen. Rather than widen the media
-- policy, this function returns only the thumbnail storage location for sellable parts, to sales
-- staff only. The server route signs the URL with the service client; the browser never holds keys
-- and originals are never returned.
-- ---------------------------------------------------------------------------------------

create or replace function public.pos_part_thumbnails(p_part_ids uuid[])
returns table (part_id uuid, bucket text, storage_path text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public._rpc_require_sales_staff();
  if p_part_ids is null or array_length(p_part_ids, 1) is null then
    return;
  end if;
  if array_length(p_part_ids, 1) > 50 then
    raise exception 'at most 50 parts per request' using errcode = '22023';
  end if;
  return query
  select p.id, m.bucket::text, m.storage_path::text
    from public.parts p
    join public.media_assets m
      on m.id = p.thumbnail_asset_id and m.variant = 'thumbnail' and m.status = 'ready'
   where p.id = any(p_part_ids)
     and public._part_is_sellable_state(p);
end;
$$;

revoke execute on function public.pos_part_thumbnails(uuid[]) from public, anon;
grant execute on function public.pos_part_thumbnails(uuid[]) to authenticated;
