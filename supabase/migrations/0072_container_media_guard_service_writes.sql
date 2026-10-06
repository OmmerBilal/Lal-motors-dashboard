-- =====================================================================================
-- 0072 — Container media guard: the assignment rule applies to user sessions only.
--
-- 0071 added "this container is not assigned to you" to _container_media_guard(). The server writes processed
-- photo variants (thumbnail, medium) with the service client, which has no user session (auth.uid() is null), so
-- those inserts were refused and the photo was reported as not saved. A service write is trusted server code; the
-- user-facing rules still apply to every session. The status rule (evidence only while loading) is unchanged.
-- ADDITIVE: replaces one function body.
-- =====================================================================================

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
  if auth.uid() is not null and not public._container_access(new.owner_id) then
    raise exception 'forbidden: this container is not assigned to you' using errcode = '42501';
  end if;
  select status into v_status from public.container_jobs where id = new.owner_id;
  if v_status is distinct from 'loading' then
    raise exception 'this container is no longer loading; evidence cannot be added' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
