-- =====================================================================================
-- 0053 — Saved evidence for an owner (Receiving, Dismantling, Parts). ADDITIVE: one read function.
--
-- Returns the ready original photos attached to one owner, optionally only the roles that start with a prefix
-- (for example 'arrival_' for the four receiving slots). SECURITY INVOKER: the media_assets row policy and
-- can_access_media decide what the caller may see. Bounded: at most 100 rows.
-- =====================================================================================

create or replace function public.media_list_for_owner(
  p_owner_type text,
  p_owner_id uuid,
  p_role_prefix text default null,
  p_limit int default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb)
    from (
      select m.id, m.role, m.mime_type, m.width, m.height, m.created_at
        from public.media_assets m
       where m.owner_type = p_owner_type
         and m.owner_id = p_owner_id
         and m.variant = 'original'
         and m.status = 'ready'
         and (p_role_prefix is null or p_role_prefix = '' or m.role like p_role_prefix || '%')
       order by m.created_at desc, m.id desc
       limit least(greatest(coalesce(p_limit, 100), 1), 100)
    ) x;
$$;

revoke execute on function public.media_list_for_owner(text, uuid, text, int) from public, anon;
grant execute on function public.media_list_for_owner(text, uuid, text, int) to authenticated;
