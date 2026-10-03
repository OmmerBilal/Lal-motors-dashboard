-- =====================================================================================
-- 0005 — Keep parts.operational_status in sync with reservations, for EVERY write path.
--
-- ADDITIVE. 0004 is not edited.
--
-- Found by scripts/dev-tests/rpc-money-stock.mjs: create_sale in 'reserve' mode inserted
-- active reservations but did not refresh the part's operational_status, so a fully reserved
-- part still read AVAILABLE. Rather than patch each RPC, one AFTER trigger on
-- inventory_reservations refreshes the status whenever a reservation is inserted or its
-- status changes. Every current and future path is then covered.
-- =====================================================================================

create or replace function public._trg_sync_part_status_from_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._sync_part_operational_status(new.part_id);
  return null;
end;
$$;

revoke execute on function public._trg_sync_part_status_from_reservation() from public, anon, authenticated;

drop trigger if exists inventory_reservations_sync_part_status on public.inventory_reservations;
create trigger inventory_reservations_sync_part_status
  after insert or update of status on public.inventory_reservations
  for each row execute function public._trg_sync_part_status_from_reservation();
