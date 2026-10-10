"use client";

import { createClient } from "@/lib/supabase/client";
import type { VehicleRecord } from "@/lib/mock/vehicles";

/**
 * Vehicles workspace service: one record, its event trail, its completion queue, and the checked writes for
 * detail edits, notes, intake batches and completion decisions. Every call runs as the signed-in user, so the
 * database decides who may read or change what (RLS and the RPCs' own role checks).
 */

export class VehicleWorkspaceError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.code = code;
  }
}

function fail(error: { message: string; code?: string } | null): never {
  throw new VehicleWorkspaceError(error?.message ?? "Request failed", error?.code);
}

/** The shape of one row from vehicle_get (to_jsonb of public.vehicles plus stage). */
export type VehicleRow = Record<string, unknown> & { id: string; stage: string };

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Full record for the detail screen. Fields the database does not hold are left empty, never invented. */
export function fullVehicleRecord(row: VehicleRow): VehicleRecord {
  return {
    id: row.id,
    barcode: str(row.barcode),
    auctionSource: str(row.auction_source),
    vin: str(row.vin),
    lotNumber: str(row.lot_number),
    stockNumber: str(row.stock_number),
    auctionItemNumber: str(row.auction_item_number),
    year: str(row.year),
    make: str(row.make),
    model: str(row.model),
    trim: str(row.trim),
    engine: str(row.engine),
    mileage: str(row.mileage),
    mileageStatus: str(row.mileage_status),
    titleStatus: str(row.title_status),
    location: str(row.location),
    purchasePrice: str(row.purchase_price),
    invoiceAmount: str(row.invoice_amount),
    balanceDue: str(row.balance_due),
    auctionFees: str(row.auction_fees),
    transportationCost: str(row.transportation_cost),
    saleDate: str(row.purchase_date),
    pickupPin: str(row.pickup_pin),
    pickupStatus: str(row.pickup_status),
    pickupDeadline: str(row.pickup_deadline),
    damageInfo: str(row.damage_info),
    transportInfo: str(row.transport_info),
    status: str(row.status) as VehicleRecord["status"],
    assignedId: row.assigned_id ? str(row.assigned_id) : null,
    assignedName: null,
    arrivalDate: row.arrival_date ? str(row.arrival_date) : null,
    createdAt: str(row.created_at),
    unverifiedFields: Array.isArray(row.unverified_fields) ? (row.unverified_fields as string[]) : [],
    pickupLocationName: str(row.pickup_location_name),
    pickupAddress: str(row.pickup_address),
    transportStatus: str(row.transport_status) as VehicleRecord["transportStatus"],
    transportPrice: str(row.transport_price),
    carrierId: row.carrier_id ? str(row.carrier_id) : null,
    carrierName: null,
    transportProblem: row.transport_problem ? (str(row.transport_problem) as VehicleRecord["transportProblem"]) : null,
    closedReason: row.closed_reason ? (str(row.closed_reason) as VehicleRecord["closedReason"]) : null,
    closedNote: row.closed_note ? str(row.closed_note) : null,
    receivingStatus: str(row.receiving_status) as VehicleRecord["receivingStatus"],
    receivedBy: row.received_by ? str(row.received_by) : null,
    receivedAt: row.received_at ? str(row.received_at) : null,
    arrivalPhotos: [],
  };
}

export async function getVehicleRecord(vehicleId: string): Promise<{ record: VehicleRecord; stage: string; updatedAt: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("vehicle_get", { p_vehicle_id: vehicleId });
  if (error) fail(error);
  const row = data as VehicleRow;
  return { record: fullVehicleRecord(row), stage: row.stage, updatedAt: str(row.updated_at) };
}

/** Safe existing-record merge: only the chosen fields, and only if the row is still the one that was compared. */
export async function applyVehicleMerge(input: { vehicleId: string; expectedUpdatedAt: string; changes: Record<string, string> }): Promise<VehicleRecord> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("vehicle_apply_merge", {
    p_vehicle_id: input.vehicleId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_changes: input.changes,
  });
  if (error) fail(error);
  return fullVehicleRecord(data as VehicleRow);
}

/** Descriptive edits only. Identity, status, assignment, carrier and closure are refused by the RPC. */
export async function editVehicleFields(vehicleId: string, fields: Record<string, string>): Promise<VehicleRecord> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("vehicle_edit_fields", { p_vehicle_id: vehicleId, p_fields: fields });
  if (error) fail(error);
  return fullVehicleRecord(data as VehicleRow);
}

export async function addVehicleNote(input: { vehicleId: string; action: "NOTE" | "ISSUE_FLAGGED"; note: string }) {
  const supabase = createClient();
  const { error } = await supabase.rpc("vehicle_add_note", { p_vehicle_id: input.vehicleId, p_action: input.action, p_note: input.note });
  if (error) fail(error);
}

export async function createIntakeBatch(input: { method: "bulk" | "single" | "scan" | "manual"; sourceText: string; count: number }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("intake_create_batch", {
    p_method: input.method,
    p_source_text: input.sourceText,
    p_count: input.count,
  });
  if (error) fail(error);
  return data as string;
}

export type VehicleEventRow = {
  id: string;
  vehicle_id: string;
  action: string;
  note: string | null;
  status: string | null;
  actor_name: string | null;
  created_at: string;
};

const EVENT_COLUMNS = "id, vehicle_id, action, note, status, actor_name, created_at";

/** The vehicle's own trail, newest first. Read under the vehicle_events RLS policy. */
export async function listVehicleEvents(vehicleId: string, limit = 100): Promise<VehicleEventRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehicle_events")
    .select(EVENT_COLUMNS)
    .eq("vehicle_id", vehicleId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail(error);
  return (data ?? []) as VehicleEventRow[];
}

/** Recent events across vehicles, keyset-paged by created_at. The cursor is the last row's created_at. */
export async function listRecentVehicleEvents(input: { before: string | null; limit: number; actions?: string[]; actorName?: string }): Promise<VehicleEventRow[]> {
  const supabase = createClient();
  let query = supabase.from("vehicle_events").select(EVENT_COLUMNS).order("created_at", { ascending: false }).limit(input.limit);
  if (input.before) query = query.lt("created_at", input.before);
  if (input.actions?.length) query = query.in("action", input.actions);
  if (input.actorName) query = query.eq("actor_name", input.actorName);
  const { data, error } = await query;
  if (error) fail(error);
  return (data ?? []) as VehicleEventRow[];
}

export type PendingCompletion = {
  id: string;
  vehicle_id: string;
  submitted_at: string;
  part_count: number;
  converter_count: number;
  custody_exceptions: number;
  note: string;
  vehicles: { vin: string | null; year: number; make: string; model: string } | null;
};

/** Completion submissions still waiting for a reviewer decision. */
export async function listPendingCompletions(): Promise<PendingCompletion[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehicle_completions")
    .select("id, vehicle_id, submitted_at, part_count, converter_count, custody_exceptions, note, vehicles(vin, year, make, model)")
    .eq("decision", "pending")
    .order("submitted_at", { ascending: true })
    .limit(100);
  if (error) fail(error);
  return (data ?? []) as unknown as PendingCompletion[];
}

export async function decideCompletion(input: { completionId: string; decision: "approved" | "needs_correction"; reason: string }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("vehicle_decide_completion", {
    p_completion_id: input.completionId,
    p_decision: input.decision,
    p_reason: input.reason,
  });
  if (error) fail(error);
  return data as { id: string; decision: string };
}

export type PendingBatch = { id: string; method: "bulk" | "single" | "scan" | "manual"; source_text: string; created_at: string };

/** Intake batches still in review, newest first. Read under the vehicle_intake_batches RLS policy. */
export async function listPendingBatches(): Promise<PendingBatch[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehicle_intake_batches")
    .select("id, method, source_text, created_at")
    .eq("status", "review")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) fail(error);
  return (data ?? []) as PendingBatch[];
}

export type CompletedVehicle = {
  id: string;
  vehicle_id: string;
  submitted_by: string | null;
  decided_at: string;
  vehicles: { vin: string | null; lot_number: string | null; year: number; make: string; model: string; status: string } | null;
};

/** Approved completions decided since a moment, newest first. Bounded: the caller reports when the limit is reached. */
export async function listCompletedVehicles(sinceIso: string): Promise<{ rows: CompletedVehicle[]; truncated: boolean }> {
  const supabase = createClient();
  const limit = 500;
  const { data, error } = await supabase
    .from("vehicle_completions")
    .select("id, vehicle_id, submitted_by, decided_at, vehicles(vin, lot_number, year, make, model, status)")
    .eq("decision", "approved")
    .gte("decided_at", sinceIso)
    .order("decided_at", { ascending: false })
    .limit(limit);
  if (error) fail(error);
  const rows = (data ?? []) as unknown as CompletedVehicle[];
  return { rows, truncated: rows.length >= limit };
}

/** Display names for a set of profile ids (the database decides what each caller can read). */
export async function profileNames(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const supabase = createClient();
  const { data, error } = await supabase.from("profiles").select("id, name").in("id", ids);
  if (error) fail(error);
  return Object.fromEntries(((data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
}
