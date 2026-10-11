-- ---------------------------------------------------------------------------------------
-- 0078 — A scrap driver can never create their own load. ADDITIVE (create-or-replace only).
--
-- Bug: scrap_driver_create_load (migration 0036) let a scrap_driver mint a brand-new load
-- for themselves, and migration 0070's comment even says "Driver-created loads keep
-- working" when office-assign was added. That contradicts the module's actual design
-- (§4.7 of the project guide): office creates a load and assigns it to a driver
-- (scrap_manager_create_load, is_scrap_office-gated); the driver only ever confirms a load
-- that already exists. The frontend's "New Load" action (which called this RPC) is removed
-- in this same change; this migration closes the server-side path independently, since the
-- database must enforce this regardless of what the client does.
--
-- The function is kept (not dropped) so a stale client/replay gets a clear, safe rejection
-- instead of "function does not exist". It is gated with the SAME is_scrap_office() check
-- the legitimate office create path uses (_scrap_require_office, migration 0035) — which
-- already excludes scrap_driver — and then unconditionally refuses, because the real
-- create-and-assign path is scrap_manager_create_load, not this one, for ANY caller.
-- ---------------------------------------------------------------------------------------

create or replace function public.scrap_driver_create_load(p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Rejects a scrap_driver caller with 42501 (is_scrap_office() does not include scrap_driver).
  perform public._scrap_require_office();
  -- Even an office caller is refused: this RPC is retired. Use scrap_manager_create_load,
  -- which creates the load AND assigns a real driver in one step.
  raise exception 'loads are created and assigned by office staff (scrap_manager_create_load), not this action' using errcode = 'P0001';
end;
$$;
comment on function public.scrap_driver_create_load(uuid) is
  'Retired: a scrap driver never creates their own load. Kept only so a stale call fails '
  'clearly (42501 for a driver, since is_scrap_office() excludes that role; P0001 otherwise) '
  'instead of erroring with "function does not exist". Use scrap_manager_create_load.';
