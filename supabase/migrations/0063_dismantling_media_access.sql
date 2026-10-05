-- =====================================================================================
-- 0063 — Media access for the dismantling workflow. ADDITIVE: replaces one function body. 0001–0062 are not edited.
--
-- can_access_media() (0035) gave dismantling staff every session and part photo, and gave a dismantling employee
-- no access to a captured part's photos at all (part photos need parts staff). The new rule:
--   * dismantling_session: review roles (owner, engineer_admin, manager) read; the session's own employee reads
--     and writes its evidence. Other dismantling employees get nothing.
--   * part: parts staff as before; plus the employee of the part's dismantling session (their capture photos).
-- All other owner types keep their previous branches unchanged.
-- =====================================================================================

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
