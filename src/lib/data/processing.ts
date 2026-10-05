"use client";

import { createClient } from "@/lib/supabase/client";

/** Manager processing data. Every decision goes through a database RPC; nothing here decides. */

export type QueueRow = {
  id: string;
  vehicle_id: string;
  vin: string | null;
  lot_or_stock: string | null;
  vehicle_label: string;
  status: string;
  dismantling_session_id: string;
  captured_by: string | null;
  employee_name: string;
  created_at: string;
  thumbnail_path: string | null;
  thumbnail_bucket: string | null;
};

export type ProcessingSummary = {
  needs_review: number;
  completed_in_range: number;
  parts_captured_in_range: number;
  employees: { employee_id: string; name: string; sessions: number; parts: number }[];
};

export type CompletionRow = {
  session_id: string;
  vehicle_id: string;
  vehicle_label: string;
  vin: string;
  employee_id: string;
  employee_name: string;
  started_at: string;
  completed_at: string;
  parts_count: number;
  pending_review_count: number;
  approved_count: number;
};

export type WindowPart = {
  id: string;
  vehicle_id: string;
  captured_by: string | null;
  created_at: string;
  status: string;
  stage: string | null;
  part_name: string;
  source_vin: string | null;
  dismantling_session_id: string | null;
};

export type VehicleRow = {
  id: string;
  vin: string | null;
  year: number;
  make: string;
  model: string;
  trim: string;
  lot_number: string | null;
  stock_number: string | null;
  auction_source: string;
  location: string;
  status: string;
  closed_reason: string | null;
};

export type VehicleEventRow = {
  id: string;
  vehicle_id: string;
  action: string;
  status: string | null;
  note: string | null;
  actor_name: string;
  created_at: string;
  part_ref: string | null;
};

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? "Request failed");
}

/** Whole review queue, paged by keyset until complete. Bounded by a sane page cap. */
export async function getProcessingSummary(from: string, to: string): Promise<ProcessingSummary> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("dismantling_processing_summary", { p_from: from, p_to: to });
  if (error) fail(error);
  return data as ProcessingSummary;
}

export async function listCompletions(from: string, to: string): Promise<CompletionRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_dismantling_completions", { p_from: from, p_to: to });
  if (error) fail(error);
  return (data ?? []) as CompletionRow[];
}

export async function listRoster(): Promise<{ employee_id: string; name: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_dismantling_roster");
  if (error) fail(error);
  return (data ?? []) as { employee_id: string; name: string }[];
}

export async function listVehiclesByIds(ids: string[]): Promise<VehicleRow[]> {
  if (!ids.length) return [];
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, vin, year, make, model, trim, lot_number, stock_number, auction_source, location, status, closed_reason")
    .in("id", ids);
  if (error) fail(error);
  return (data ?? []) as VehicleRow[];
}

export async function listVehicleHistory(vehicleId: string): Promise<VehicleEventRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehicle_events")
    .select("id, vehicle_id, action, status, note, actor_name, created_at, part_ref")
    .eq("vehicle_id", vehicleId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) fail(error);
  return (data ?? []) as VehicleEventRow[];
}

export async function approveDismantledPart(partId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("approve_dismantled_part", { p_part_id: partId });
  if (error) fail(error);
  return data as { part_id: string; status: string; idempotent_replay: boolean };
}

export async function editAndApprovePart(partId: string, fields: Record<string, string | boolean>) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("edit_and_approve_part", { p_part_id: partId, p_fields: fields });
  if (error) fail(error);
  return data as { part_id: string; status: string; idempotent_replay: boolean };
}

export async function rejectDismantledPart(partId: string, reason: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("reject_dismantled_part", { p_part_id: partId, p_reason: reason });
  if (error) fail(error);
  return data as { part_id: string; status: string; idempotent_replay: boolean };
}

export async function markPartDuplicate(partId: string, duplicateOf: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("mark_part_duplicate", { p_part_id: partId, p_duplicate_of: duplicateOf });
  if (error) fail(error);
  return data as { part_id: string; status: string; idempotent_replay: boolean };
}

export async function keepPartForReview(partId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("keep_part_for_review", { p_part_id: partId });
  if (error) fail(error);
  return data as { part_id: string; status: string; idempotent_replay: boolean };
}

/** One bounded page of the review queue (keyset on created_at, id). The queue is never loaded whole. */
export async function listReviewQueuePage(cursor: { createdAt: string; id: string } | null, limit = 25) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_dismantling_review_queue", {
    p_from: null,
    p_to: null,
    p_limit: limit,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
  });
  if (error) fail(error);
  const rows = (data ?? []) as (QueueRow & { has_more: boolean })[];
  const hasMore = rows.length > 0 && rows[0].has_more;
  return { rows: rows.map((r) => ({ ...r, has_more: undefined }) as unknown as QueueRow), hasMore };
}

/** Per-employee counts for a period, computed in the database (migration 0054). */
export type EmployeeCount = {
  employee_id: string;
  name: string;
  vehicles_completed: number;
  parts_captured: number;
  parts_approved: number;
  parts_pending_review: number;
};

export async function getEmployeeCounts(from: string, to: string): Promise<EmployeeCount[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("dismantling_employee_counts", { p_from: from, p_to: to });
  if (error) fail(error);
  return (data ?? []) as EmployeeCount[];
}

/** Approved parts for a set of donor vehicles, one bounded query for the page on screen. */
export async function listApprovedPartsForVehicles(vehicleIds: string[]) {
  if (!vehicleIds.length) return [];
  const supabase = createClient();
  const { data, error } = await supabase
    .from("parts")
    .select("id, vehicle_id, captured_by, created_at, status, stage, part_name, source_vin, dismantling_session_id")
    .in("vehicle_id", vehicleIds)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) fail(error);
  return (data ?? []) as WindowPart[];
}

/** One employee's captured parts in a period, newest first, capped. Loaded only on the employee detail screen. */
export async function listEmployeeParts(employeeId: string, from: string, to: string, limit = 200) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("parts")
    .select("id, vehicle_id, captured_by, created_at, status, stage, part_name, source_vin, dismantling_session_id")
    .eq("captured_by", employeeId)
    .not("dismantling_session_id", "is", null)
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail(error);
  return (data ?? []) as WindowPart[];
}
