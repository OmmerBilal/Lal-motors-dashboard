"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Dismantling v2 client. Every call is a database RPC that checks the caller's role and assignment itself,
 * so these wrappers only shape the request and the reply. Role checks are never repeated here.
 */

export type DismantlingTab = "eligible" | "ready" | "assigned" | "in_progress" | "completed" | "issues";

export type AdminVehicleRow = {
  vehicle_id: string;
  vin: string | null;
  lot_number: string | null;
  stock_number: string | null;
  year: number;
  make: string;
  model: string;
  auction_source: string;
  vehicle_status: string;
  received_at: string | null;
  dismantling_ready_at: string | null;
  assignment_id: string | null;
  assignment_status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | null;
  employee_id: string | null;
  employee_name: string | null;
  assigned_at: string | null;
  assigned_by_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  parts_captured: number;
  issues_flagged: number;
};

export type WorkloadRow = { employee_id: string; name: string; assigned: number; in_progress: number; completed: number };

export type EmployeeAssignmentRow = {
  assignment_id: string;
  assignment_status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED";
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
  vehicle_id: string;
  vin: string | null;
  lot_number: string | null;
  stock_number: string | null;
  year: number;
  make: string;
  model: string;
  auction_source: string;
  session_id: string | null;
  parts_captured: number;
  issues_flagged: number;
  sort_at: string;
};

export type WorkspacePart = {
  id: string;
  capture_name: string;
  capture_details: string;
  status: string;
  capture_saved_at: string | null;
  captured_at: string;
  photo_asset_ids: string[];
};

export type EmployeeWorkspace = {
  vehicle: { id: string; vin: string | null; lot_number: string | null; stock_number: string | null; year: number; make: string; model: string; auction_source: string; closed_reason: string | null; status: string };
  assignment: { id: string; status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED"; assigned_at: string; started_at: string | null; completed_at: string | null };
  session: { id: string; status: string; started_at: string; ended_at: string | null } | null;
  evidence_asset_ids: string[];
  parts: WorkspacePart[];
  issues: { id: string; issue: string; note: string; created_at: string }[];
};

export type ManagerVehicleRecord = {
  vehicle: { id: string; vin: string | null; lot_number: string | null; stock_number: string | null; year: number; make: string; model: string; auction_source: string; status: string; received_at: string | null; dismantling_ready_at: string | null; closed_reason: string | null };
  assignments: { id: string; employee_id: string; employee_name: string; assigned_by_name: string | null; assigned_at: string; status: string; started_at: string | null; completed_at: string | null; cancelled_at: string | null }[];
  history: { action: string; from_employee_id: string | null; to_employee_id: string | null; actor_name: string | null; reason: string; created_at: string }[];
  sessions: { id: string; assignment_id: string | null; employee_id: string; employee_name: string; status: string; started_at: string; ended_at: string | null; parts_captured: number }[];
  parts: {
    id: string; session_id: string | null; assignment_id: string | null; capture_name: string; capture_details: string;
    capture_saved_at: string | null; captured_at: string; captured_by: string | null; captured_by_name: string | null;
    status: string; stage: string | null; duplicate_of_part_id: string | null; not_sellable_reason: string | null; part_name: string;
    photo_asset_ids: string[];
  }[];
  issues: { id: string; session_id: string | null; issue: string; note: string; actor_name: string | null; created_at: string }[];
};

export type AssignmentResult = { assignment_id: string; vehicle_id: string; employee_id: string; status: string; idempotent_replay: boolean };

function fail(error: { message: string; hint?: string | null } | null): never {
  const err = new Error(error?.message ?? "Request failed") as Error & { hint?: string | null };
  err.hint = error?.hint ?? null;
  throw err;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) fail(error);
  return data as T;
}

const newRequestId = () => crypto.randomUUID();

// ---- manager -------------------------------------------------------------------------------
export const markVehicleReady = (vehicleId: string) => rpc<{ vehicle_id: string }>("mark_vehicle_ready", { p_vehicle_id: vehicleId, p_client_request_id: newRequestId() });
export const undoVehicleReady = (vehicleId: string, reason: string) => rpc("undo_vehicle_ready", { p_vehicle_id: vehicleId, p_reason: reason });
export const assignDismantlingVehicle = (vehicleId: string, employeeId: string) =>
  rpc<AssignmentResult>("assign_dismantling_vehicle", { p_vehicle_id: vehicleId, p_employee_id: employeeId, p_client_request_id: newRequestId() });
export const reassignDismantlingAssignment = (assignmentId: string, employeeId: string, reason: string) =>
  rpc("reassign_dismantling_assignment", { p_assignment_id: assignmentId, p_employee_id: employeeId, p_reason: reason });
export const cancelDismantlingAssignment = (assignmentId: string, reason: string) => rpc("cancel_dismantling_assignment", { p_assignment_id: assignmentId, p_reason: reason });

export async function listDismantlingVehicles(tab: DismantlingTab, search: string, offset: number, limit = 50) {
  return rpc<{ rows: AdminVehicleRow[]; total: number; limit: number; offset: number }>("list_dismantling_vehicles", {
    p_tab: tab, p_search: search.trim() || null, p_limit: limit, p_offset: offset,
  });
}
export const getDismantlingWorkload = () => rpc<WorkloadRow[]>("get_dismantling_workload", {});
export const getDismantlingVehicleRecord = (vehicleId: string) => rpc<ManagerVehicleRecord>("get_dismantling_vehicle_record", { p_vehicle_id: vehicleId });

// ---- employee -------------------------------------------------------------------------------
export const listMyDismantlingAssignments = () => rpc<EmployeeAssignmentRow[]>("list_my_dismantling_assignments", { p_limit: 100 });
export const findMyDismantlingAssignment = (term: string) =>
  rpc<{ result: "found" | "not_assigned" | "not_found"; assignment_id?: string; assignment_status?: string }>("find_my_dismantling_assignment", { p_term: term });
export const getMyDismantlingWorkspace = (assignmentId: string) => rpc<EmployeeWorkspace>("get_my_dismantling_workspace", { p_assignment_id: assignmentId });
export const startDismantlingAssignment = (assignmentId: string) =>
  rpc<{ session_id: string; assignment_id: string; vehicle_id: string; status: string; idempotent_replay: boolean }>("start_dismantling_assignment", { p_assignment_id: assignmentId, p_client_request_id: newRequestId() });
export const beginDismantledPart = (sessionId: string, captureName: string, captureDetails: string) =>
  rpc<{ part_id: string; idempotent_replay: boolean }>("begin_dismantled_part", {
    p_session_id: sessionId, p_client_request_id: newRequestId(), p_capture_name: captureName, p_capture_details: captureDetails,
  });
export const updatePartCapture = (partId: string, captureName: string, captureDetails: string) =>
  rpc("update_part_capture", { p_part_id: partId, p_capture_name: captureName, p_capture_details: captureDetails });
export const saveDismantledPart = (partId: string) => rpc<{ part_id: string; capture_saved_at: string }>("save_dismantled_part", { p_part_id: partId });
export const abandonDismantledPart = (partId: string) => rpc("abandon_dismantled_part", { p_part_id: partId });
export const finishDismantlingSession = (sessionId: string) => rpc<{ session_id: string; part_photos_captured: number; idempotent_replay: boolean }>("finish_dismantling_session", { p_session_id: sessionId });
export const flagDismantlingIssue = (sessionId: string, issue: string, note: string) =>
  rpc("flag_dismantling_issue", { p_session_id: sessionId, p_issue: issue, p_note: note, p_client_request_id: newRequestId() });

export const ISSUE_TYPES = [
  "Vehicle Mismatch",
  "Unexpected Major Damage",
  "Missing Expected Component",
  "Unsafe Condition",
  "Already Partially Dismantled",
  "Record Discrepancy",
  "Other",
] as const;
