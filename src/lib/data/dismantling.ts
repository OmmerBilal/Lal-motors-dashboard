"use client";

import { createClient } from "@/lib/supabase/client";
import type { VehicleListRow } from "@/lib/data/vehicles";

/** Same list the database accepts in flag_dismantling_issue(). */
export const DISMANTLING_ISSUE_TYPES = ["Missing Parts", "Visible Damage", "Wrong Vehicle", "Safety Concern", "Other"] as const;
export type DismantlingIssueType = (typeof DISMANTLING_ISSUE_TYPES)[number];

/** Error from a dismantling RPC. `hint` is the stable business code set by the database. */
export class DismantlingError extends Error {
  readonly hint: string | undefined;
  constructor(message: string, hint: string | undefined) {
    super(message);
    this.hint = hint;
  }
}

function fail(error: { message: string; hint?: string | null } | null): never {
  throw new DismantlingError(error?.message ?? "Request failed", error?.hint ?? undefined);
}

async function findVehicleRow(term: string): Promise<VehicleListRow | null> {
  const clean = term.trim();
  if (!clean) return null;
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
  if (error) fail(error);
  const lower = clean.toLowerCase();
  const rows = (data ?? []) as VehicleListRow[];
  return (
    rows.find(
      (r) =>
        (r.vin ?? "").toLowerCase() === lower ||
        (r.stock_number ?? "").toLowerCase() === lower ||
        (r.lot_number ?? "").toLowerCase() === lower
    ) ?? null
  );
}

export type DismantlingLookup =
  | { status: "not_found" }
  | { status: "dismantled"; vehicle: VehicleListRow }
  | { status: "in_process"; vehicle: VehicleListRow; mine: boolean; startedAt: string }
  | { status: "valid"; vehicle: VehicleListRow };

/**
 * Guard states for the Find Vehicle step. A closed vehicle is treated as not found for this
 * screen, because dismantling does not apply to it. "in_process" tells the employee whether
 * the active session is their own, so they can resume it instead of being refused.
 */
export async function lookupForDismantling(term: string, userId: string): Promise<DismantlingLookup> {
  const vehicle = await findVehicleRow(term);
  if (!vehicle || vehicle.closed_reason) return { status: "not_found" };
  if (vehicle.status === "Dismantled" || vehicle.status === "Completed") return { status: "dismantled", vehicle };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("dismantling_sessions")
    .select("id, employee_id, started_at")
    .eq("vehicle_id", vehicle.id)
    .is("ended_at", null)
    .maybeSingle();
  if (error) fail(error);
  if (data) {
    return { status: "in_process", vehicle, mine: data.employee_id === userId, startedAt: data.started_at };
  }
  return { status: "valid", vehicle };
}

/** The employee's own open session, if any. Lets the app resume after a reload or a laptop restart. */
export async function resumeMyDismantlingSession(userId: string): Promise<{ sessionId: string; vehicle: VehicleListRow; startedAt: string } | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dismantling_sessions")
    .select("id, vehicle_id, started_at")
    .eq("employee_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  const { data: v, error: vErr } = await supabase.from("vehicles").select("vin").eq("id", data.vehicle_id).single();
  if (vErr || !v?.vin) return null;
  const row = await findVehicleRow(v.vin);
  if (!row || row.id !== data.vehicle_id) return null;
  return { sessionId: data.id, vehicle: row, startedAt: data.started_at };
}

/** Ready vehicle evidence photos on a session (the owner of those media rows is the session). */
export async function countSessionEvidence(sessionId: string): Promise<number> {
  const supabase = createClient();
  const { count, error } = await supabase
    .from("media_assets")
    .select("id", { count: "exact", head: true })
    .eq("owner_type", "dismantling_session")
    .eq("owner_id", sessionId)
    .eq("variant", "original")
    .eq("status", "ready");
  if (error) fail(error);
  return count ?? 0;
}

/** Parts captured in a session that already have a ready photo. Used to rebuild the list after a reload. */
export async function listSavedSessionParts(sessionId: string): Promise<{ id: string; takenAt: string }[]> {
  const supabase = createClient();
  const { data: parts, error } = await supabase
    .from("parts")
    .select("id, created_at")
    .eq("dismantling_session_id", sessionId)
    .eq("status", "captured")
    .order("created_at", { ascending: true });
  if (error) fail(error);
  const list = parts ?? [];
  if (list.length === 0) return [];
  const { data: media, error: mErr } = await supabase
    .from("media_assets")
    .select("owner_id")
    .eq("owner_type", "part")
    .in("owner_id", list.map((p) => p.id))
    .eq("variant", "original")
    .eq("status", "ready");
  if (mErr) fail(mErr);
  const withPhoto = new Set((media ?? []).map((m) => m.owner_id as string));
  return list.filter((p) => withPhoto.has(p.id)).map((p) => ({ id: p.id, takenAt: p.created_at }));
}

export async function startDismantlingSession(vehicleId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("start_dismantling_session", { p_vehicle_id: vehicleId });
  if (error) fail(error);
  return data as { session_id: string; vehicle_id: string; status: string; idempotent_replay: boolean };
}

export async function beginDismantledPart(sessionId: string, requestId: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("begin_dismantled_part", { p_session_id: sessionId, p_client_request_id: requestId });
  if (error) fail(error);
  return (data as { part_id: string }).part_id;
}

export async function abandonDismantledPart(partId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("abandon_dismantled_part", { p_part_id: partId });
  if (error) fail(error);
  return data as { part_id: string; status: string };
}

export async function finishDismantlingSession(sessionId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("finish_dismantling_session", { p_session_id: sessionId });
  if (error) fail(error);
  return data as { session_id: string; status: string; part_photos_captured: number; idempotent_replay: boolean };
}

export async function flagDismantlingIssue(input: { sessionId: string; issue: DismantlingIssueType; note: string; requestId: string }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("flag_dismantling_issue", {
    p_session_id: input.sessionId,
    p_issue: input.issue,
    p_note: input.note,
    p_client_request_id: input.requestId,
  });
  if (error) fail(error);
  return data as { event_id: string; idempotent_replay: boolean };
}
