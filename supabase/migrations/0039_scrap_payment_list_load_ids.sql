-- ---------------------------------------------------------------------------------------
-- 0039 — Scrap: the payments read model carries the ids of the loads each payment is linked to.
-- A correction needs them (it re-links the same loads with a corrected amount). ADDITIVE: replaces one function.
-- ---------------------------------------------------------------------------------------

create or replace function public.scrap_manager_list_payments(p_limit int default 25, p_before_created timestamptz default null, p_before_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_rows jsonb;
  v_more boolean;
begin
  perform public._scrap_require_office();
  with page as (
    select p.id, p.driver_id, pr.name as driver_name, p.payment_date, p.amount_received, p.method, p.reference_number,
           p.proof_asset_id, p.notes, p.correction_of, p.correction_reason, p.created_at,
           (select count(*)::int from public.scrap_payment_loads pl where pl.payment_id = p.id) as load_count,
           (select coalesce(array_agg(pl.scrap_load_id order by pl.scrap_load_id), '{}'::uuid[]) from public.scrap_payment_loads pl where pl.payment_id = p.id) as load_ids,
           coalesce((select sum(f.amount) from public.scrap_payment_loads pl join public.scrap_load_financials f on f.scrap_load_id = pl.scrap_load_id
                      where pl.payment_id = p.id), 0) as expected_total,
           exists (select 1 from public.scrap_discrepancies d where d.scrap_payment_id = p.id and d.status = 'open') as has_open_discrepancy
      from public.scrap_payments p
      join public.profiles pr on pr.id = p.driver_id
     where p_before_created is null or (p.created_at, p.id) < (p_before_created, p_before_id)
     order by p.created_at desc, p.id desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg((to_jsonb(x) - 'rn') order by x.created_at desc, x.id desc) filter (where x.rn <= v_limit), '[]'::jsonb),
         coalesce(bool_or(x.rn > v_limit), false)
    into v_rows, v_more
    from (select p.*, row_number() over (order by p.created_at desc, p.id desc) as rn from page p) x;
  return jsonb_build_object('rows', v_rows, 'has_more', v_more);
end;
$$;
