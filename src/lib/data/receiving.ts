"use client";

import { createClient } from "@/lib/supabase/client";
import type { VehicleListRow } from "@/lib/data/vehicles";

export type ReceivingLookup =
  | { status: "not_found"; vehicle: null }
  | { status: "received"; vehicle: VehicleListRow }
  | { status: "ready"; vehicle: VehicleListRow };

/**
 * Looks up a vehicle the employee typed (VIN, lot or stock number) through the same read model
 * the rest of the app uses. Classification is exact-match on the identifier, not fuzzy search.
 * No barcode reading, no OCR, no image analysis.
 */
export async function lookupForReceiving(term: string): Promise<ReceivingLookup> {
  const clean = term.trim();
  if (!clean) return { status: "not_found", vehicle: null };
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_vehicles", {
    p_stage: null,
    p_auction_source: null,
    p_search: clean,
    p_limit: 10,
    p_cursor_created_at: null,
    p_cursor_id: null,
    p_carrier_id: null,
  });
  if (error) throw new Error(error.message);
  const lower = clean.toLowerCase();
  const rows = (data ?? []) as (VehicleListRow & { has_more: boolean })[];
  const exact = rows.find(
    (r) =>
      (r.vin ?? "").toLowerCase() === lower ||
      (r.stock_number ?? "").toLowerCase() === lower ||
      (r.lot_number ?? "").toLowerCase() === lower
  );
  if (!exact) return { status: "not_found", vehicle: null };
  return exact.receiving_status === "received"
    ? { status: "received", vehicle: exact }
    : { status: "ready", vehicle: exact };
}

/**
 * Opens one vehicle by id for the Auction "Receive Vehicle" link. The id is only a pointer: the vehicle is re-read from
 * the database, so no VIN is retyped and no data from the link is trusted. Closed and dismantled vehicles are refused here
 * as well as by receive_vehicle.
 */
export async function lookupVehicleById(vehicleId: string): Promise<ReceivingLookup> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("vehicle_get", { p_vehicle_id: vehicleId });
  if (error) throw new Error(error.message);
  const row = data as VehicleListRow & { status: string; closed_reason: string | null };
  if (row.closed_reason) throw new Error("This vehicle is closed or removed and cannot be received.");
  if (row.status === "Dismantled") throw new Error("This vehicle is dismantled and cannot be received.");
  return row.receiving_status === "received"
    ? { status: "received", vehicle: row }
    : { status: "ready", vehicle: row };
}

/** Atomic server-side receipt: requires the four arrival photos and a valid lifecycle transition. */
export async function receiveVehicleNow(vehicleId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("receive_vehicle", { p_vehicle_id: vehicleId });
  if (error) throw new Error(error.message);
  return data as { vehicle_id: string; receiving_status: string; idempotent_replay: boolean };
}
