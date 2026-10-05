"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Client-side vehicle service. Every call goes through a database RPC or read-model function
 * using the signed-in session, so the database decides authorization, never this file.
 */

export type VehicleStage = "waiting" | "transit" | "available" | "overdue" | "closed";

export type VehicleListRow = {
  id: string;
  vin: string | null;
  lot_number: string | null;
  stock_number: string | null;
  auction_source: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  engine: string;
  arrival_date: string | null;
  received_at: string | null;
  status: string;
  transport_status: string;
  purchase_date: string;
  purchase_price: string;
  total_landed_cost: string;
  pickup_location_name: string;
  pickup_address: string;
  pickup_pin: string;
  transport_price: string | null;
  transport_problem: string | null;
  closed_reason: string | null;
  carrier_id: string | null;
  carrier_company: string | null;
  receiving_status: string;
  thumbnail_path: string | null;
  thumbnail_bucket: string | null;
  stage: VehicleStage;
  created_at: string;
};

export type VehicleListFilters = {
  stage: VehicleStage | null;
  auctionSource: string | null;
  carrierId: string | null;
  search: string;
  limit?: number;
};

export type VehicleListCursor = { createdAt: string; id: string } | null;

export type VehicleKpis = {
  total: number;
  waiting: number;
  transit: number;
  available: number;
  overdue: number;
  closed: number;
};

export type VehicleFilterOptions = {
  auction_sources: string[];
  carriers: { id: string; company: string }[];
};

export class VehicleServiceError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.code = code;
  }
}

function fail(error: { message: string; code?: string } | null): never {
  throw new VehicleServiceError(error?.message ?? "Request failed", error?.code);
}

export async function listVehicles(filters: VehicleListFilters, cursor: VehicleListCursor) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_vehicles", {
    p_stage: filters.stage,
    p_auction_source: filters.auctionSource,
    p_search: filters.search.trim() || null,
    p_limit: filters.limit ?? 25,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_carrier_id: filters.carrierId,
  });
  if (error) fail(error);
  const rows = (data ?? []) as (VehicleListRow & { has_more: boolean })[];
  const hasMore = rows.length > 0 && rows[0].has_more;
  return { rows: rows.map((r) => ({ ...r, has_more: undefined }) as unknown as VehicleListRow), hasMore };
}

export async function getVehicleKpis(): Promise<VehicleKpis> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("vehicle_stage_counts");
  if (error) fail(error);
  const row = (data as Record<string, number | string>[])[0];
  return {
    total: Number(row.total),
    waiting: Number(row.waiting),
    transit: Number(row.transit),
    available: Number(row.available),
    overdue: Number(row.overdue),
    closed: Number(row.closed),
  };
}

export async function getVehicleFilterOptions(): Promise<VehicleFilterOptions> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("vehicle_filter_options");
  if (error) fail(error);
  return data as VehicleFilterOptions;
}

export async function closeVehicle(input: { vehicleId: string; reason: string; note: string }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("close_vehicle", {
    p_vehicle_id: input.vehicleId,
    p_reason: input.reason,
    p_note: input.note,
  });
  if (error) fail(error);
  return data as { vehicle_id: string; status: string; closed_reason: string; idempotent_replay: boolean };
}

export async function reopenVehicle(input: { vehicleId: string; note: string }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("reopen_vehicle", {
    p_vehicle_id: input.vehicleId,
    p_note: input.note,
  });
  if (error) fail(error);
  return data as { vehicle_id: string; status: string; idempotent_replay: boolean };
}

export type IntakeMatchStatus = "new" | "existing" | "conflict" | "duplicate" | "invalid";

/** The subset of an intake draft the database needs for identity matching and creation. */
export type IntakeDraftInput = {
  vin?: string;
  lotNumber?: string;
  stockNumber?: string;
  auctionSource?: string;
  auctionItemNumber?: string;
  year?: string;
  make?: string;
  model?: string;
  trim?: string;
  engine?: string;
  mileage?: string;
  titleStatus?: string;
  location?: string;
  purchasePrice?: string;
  auctionFees?: string;
  transportationCost?: string;
};

export async function previewVehicleMatch(draft: IntakeDraftInput): Promise<{ status: IntakeMatchStatus; vehicle_id?: string; reason?: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("find_vehicle_match", {
    p_vin: draft.vin || null,
    p_lot_number: draft.lotNumber || null,
    p_stock_number: draft.stockNumber || null,
    p_auction_source: draft.auctionSource || null,
  });
  if (error) fail(error);
  return data as { status: IntakeMatchStatus; vehicle_id?: string; reason?: string };
}

export type IntakeCommitResult = { created: number; existing: number; conflicts: number; duplicates: number; invalid: number; failed: number; messages: string[] };

/** Row-level answer from the server's batch check (same rules as the commit). Read-only. */
export type BatchRowResult = { index: number; status: IntakeMatchStatus; vehicle_id?: string | null; reason?: string | null; duplicate_of?: number | null };

/** The draft as the server needs it: the reviewed fields plus the source line, which the duplicate check compares. */
function batchRow(d: IntakeDraftInput & { uncertainFields?: string[]; sourceText?: string }) {
  return { ...d, sourceText: d.sourceText ?? "" };
}

/** Checks a whole batch against the batch itself and the database. Nothing is written. */
export async function evaluateIntakeBatch(drafts: (IntakeDraftInput & { sourceText?: string })[]): Promise<BatchRowResult[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("intake_evaluate_batch", { p_rows: drafts.map(batchRow) });
  if (error) fail(error);
  return (data ?? []) as BatchRowResult[];
}

/**
 * Creates the new rows of a batch. The server evaluates the rows again and creates only the ones it classifies as new,
 * so a duplicate or conflicting row is never created, whatever the browser sent.
 */
export async function intakeVehicles(drafts: (IntakeDraftInput & { sourceText?: string })[]): Promise<IntakeCommitResult> {
  const supabase = createClient();
  const result: IntakeCommitResult = { created: 0, existing: 0, conflicts: 0, duplicates: 0, invalid: 0, failed: 0, messages: [] };
  const { data, error } = await supabase.rpc("intake_commit_batch", { p_rows: drafts.map(batchRow) });
  if (error) fail(error);
  const payload = data as { results: { index: number; status: string; reason?: string | null; vehicle_id?: string | null }[]; counts: Record<string, number> };
  result.created = payload.counts.created ?? 0;
  result.existing = payload.counts.existing ?? 0;
  result.conflicts = payload.counts.conflict ?? 0;
  result.duplicates = payload.counts.duplicate ?? 0;
  result.invalid = payload.counts.invalid ?? 0;
  result.failed = payload.counts.failed ?? 0;
  for (const r of payload.results) {
    if (["conflict", "duplicate", "invalid", "failed"].includes(r.status)) {
      const d = drafts[r.index];
      result.messages.push(`${d?.vin || d?.stockNumber || d?.lotNumber || "Vehicle"}: ${r.reason ?? r.status}`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------
// Central Dispatch
// ---------------------------------------------------------------------------------------

export type CarrierRecord = {
  id: string;
  company: string;
  driver: string;
  phone: string;
  email: string;
  address: string;
  mcDot: string;
  notes: string;
  active: boolean;
};

export type DispatchCounts = {
  needTransport: number;
  postedToCd: number;
  assigned: number;
  inTransit: number;
  arrived: number;
  overdue: number;
  problems: number;
};

/**
 * Every open vehicle, for pickup grouping. Pages through the keyset list until it is complete.
 * Grouping needs the full set, so this is the one place a screen loads everything. The loop
 * stops when the database says there is no next page.
 */
export async function listCarriers(): Promise<CarrierRecord[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("carriers")
    .select("id, company, driver, phone, email, address, mc_dot, notes, active")
    .order("company");
  if (error) fail(error);
  return (data ?? []).map((c) => ({
    id: c.id,
    company: c.company,
    driver: c.driver,
    phone: c.phone,
    email: c.email,
    address: c.address,
    mcDot: c.mc_dot,
    notes: c.notes,
    active: c.active,
  }));
}

export async function addCarrier(input: Omit<CarrierRecord, "id" | "active">): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("carriers")
    .insert({
      company: input.company.trim(),
      driver: input.driver.trim(),
      phone: input.phone.trim(),
      email: input.email.trim(),
      address: input.address.trim(),
      mc_dot: input.mcDot.trim(),
      notes: input.notes.trim(),
      active: true,
    })
    .select("id")
    .single();
  if (error) fail(error);
  return data.id as string;
}

export async function getDispatchCounts(): Promise<DispatchCounts> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("dispatch_stage_counts");
  if (error) fail(error);
  const r = (data as Record<string, number | string>[])[0];
  return {
    needTransport: Number(r.need_transport),
    postedToCd: Number(r.posted_to_cd),
    assigned: Number(r.assigned),
    inTransit: Number(r.in_transit),
    arrived: Number(r.arrived),
    overdue: Number(r.overdue),
    problems: Number(r.problems),
  };
}

/** Each item carries its own transport price. One atomic batch, one carrier. */
export async function assignCarrierItems(input: { carrierId: string; items: { vehicleId: string; transportPrice: number }[] }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("assign_carrier_items", {
    p_carrier_id: input.carrierId,
    p_items: input.items.map((i) => ({ vehicle_id: i.vehicleId, transport_price: i.transportPrice })),
  });
  if (error) fail(error);
  return data as { assigned: number; unchanged: number; carrier_id: string };
}

export async function updateTransportStatus(input: { vehicleId: string; to: string; note?: string }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_transport_status", {
    p_vehicle_id: input.vehicleId,
    p_to_status: input.to,
    p_problem_note: input.note ?? null,
  });
  if (error) fail(error);
  return data as { vehicle_id: string; transport_status: string; idempotent_replay: boolean };
}

