-- =====================================================================================
-- 0073 — Restore the sellable-state rule in _available_quantity (regression fix in 0071).
--
-- 0029 defined _available_quantity on top of _part_is_sellable_state(), so a MISSING, DAMAGED or RETURNED part
-- has no available quantity. 0071 redefined the function from the older 0026 body, which dropped that rule.
-- This restores it and keeps 0071's container holds: available = quantity - active reservations - planned
-- container holds, and only for sellable parts. ADDITIVE: replaces one function body.
-- =====================================================================================

create or replace function public._available_quantity(p_part_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
           when public._part_is_sellable_state(p) then
             p.quantity
             - coalesce((select sum(r.quantity) from public.inventory_reservations r
                          where r.part_id = p.id and r.status = 'active'), 0)
             - coalesce((select sum(i.planned_qty) from public.container_planned_items i
                          where i.part_id = p.id and i.status = 'planned'), 0)
           else 0
         end
    from public.parts p
   where p.id = p_part_id;
$$;
