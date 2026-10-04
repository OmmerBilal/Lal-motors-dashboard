import { createClient } from "@/lib/supabase/client";

/**
 * Scrap Driver and Scrap Management data access. Every call goes to an RPC (migrations 0035–0038),
 * which checks the caller's role and the current state in the database. Nothing here decides an
 * amount, a status transition, a remaining quantity or a close: this layer only sends the request
 * and returns the server's answer.
 */

export type ScrapLoadStatus = "new" | "ready_for_review" | "approved" | "closed";
export type DriverState = "saved" | "awaiting_ticket" | "ticket_attached" | "complete";
export type ManagerLoadState = "in_progress" | "awaiting_ticket" | "ticket_missing" | "ready_to_complete" | ScrapLoadStatus;
export type PaymentStatus = "not_due" | "payment_pending" | "mismatch" | "paid";
export type PaymentMethod = "Check" | "ACH" | "Wire" | "Other";
export const PAYMENT_METHODS: PaymentMethod[] = ["Check", "ACH", "Wire", "Other"];

export type DriverLoad = {
  id: string;
  driver_id: string;
  load_date: string;
  created_at: string;
  delivered_at: string | null;
  completed_at: string | null;
  status: ScrapLoadStatus;
  driver_state: DriverState;
  has_load_photo: boolean;
  has_ticket_photo: boolean;
  load_photo_asset_id: string | null;
  ticket_photo_asset_id: string | null;
};

export type ManagerLoad = DriverLoad & {
  driver_name: string;
  state: ManagerLoadState;
  weight: number | null;
  rate: number | null;
  amount: number | null;
  amount_override_reason: string | null;
  manager_notes: string | null;
  payment_id: string | null;
  payment_status: PaymentStatus;
  open_discrepancies: number;
};

export type LoadEvent = {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_name: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export type DiscrepancyKind =
  | "ticket_missing" | "ticket_photo_mismatch" | "payment_mismatch" | "unresolved_amount"
  | "missing_check_evidence" | "incomplete_load_evidence" | "other";
export type Discrepancy = {
  id: string;
  kind: DiscrepancyKind;
  status: "open" | "resolved";
  scrap_load_id: string | null;
  scrap_payment_id: string | null;
  driver_id: string | null;
  note: string;
  opened_by_name: string;
  opened_at: string;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
};

export type LoadDetail = {
  load: ManagerLoad;
  events: LoadEvent[];
  discrepancies: Discrepancy[];
  payment: {
    id: string;
    payment_date: string;
    amount_received: number;
    method: PaymentMethod;
    reference_number: string;
    proof_asset_id: string | null;
    correction_of: string | null;
  } | null;
};

export type Payment = {
  id: string;
  driver_id: string;
  driver_name: string;
  payment_date: string;
  amount_received: number;
  method: PaymentMethod;
  reference_number: string;
  proof_asset_id: string | null;
  notes: string;
  correction_of: string | null;
  correction_reason: string | null;
  created_at: string;
  load_count: number;
  load_ids: string[];
  expected_total: number;
  has_open_discrepancy: boolean;
};

export type CheckRow = { id: string; driver_id: string; driver_name: string; created_at: string; has_photo: boolean; photo_asset_id: string | null; linked_payment_id: string | null };

export type RimReturn = { id: string; aluminum_returned: number; steel_returned: number; notes: string; photo_asset_id: string | null; created_at: string };
export type RimObligation = {
  id: string;
  customer_id: string;
  customer_name: string;
  tires_qty: number;
  aluminum_owed: number;
  steel_owed: number;
  aluminum_returned: number;
  steel_returned: number;
  aluminum_remaining: number;
  steel_remaining: number;
  status: "open" | "completed";
  completed_at: string | null;
  notes: string;
  created_at: string;
  last_activity_at: string;
  returns: RimReturn[];
};

export type DailyClose = { id: string; close_date: string; closed_at: string; override_reason: string | null; totals: Record<string, number>; blockers: { kind: string; count: number; sample_ids: string[] }[] };
export type ClosePreview = {
  date: string;
  closed: boolean;
  blockers: { kind: string; count: number; sample_ids: string[] }[];
  loads: number;
  completed: number;
  weight: number;
  amount: number;
  payments_received: number;
};

export type Summary = {
  range: { from: string; to: string };
  loads_in_range: number;
  completed_in_range: number;
  weight_in_range: number;
  amount_in_range: number;
  payments_received_in_range: number;
  open_now: number;
  awaiting_ticket_now: number;
  ticket_missing_now: number;
  needs_review_now: number;
  payment_pending_now: number;
  discrepancies_open_now: number;
  tire_rim_open_obligations: number;
  tire_rim_remaining_aluminum: number;
  tire_rim_remaining_steel: number;
  day_closed_today: boolean;
  by_driver: { driver_id: string; name: string; loads: number; completed: number; weight: number; amount: number }[];
};

export type Report = {
  range: { from: string; to: string };
  loads: number;
  completed: number;
  weight: number;
  amount: number;
  reconciliation: Record<string, number>;
  discrepancies_opened: number;
  discrepancies_open_now: number;
  payments_received: number;
  tire_rim_outstanding_aluminum: number;
  tire_rim_outstanding_steel: number;
  by_driver: { driver_id: string; name: string; loads: number; completed: number; weight: number; amount: number }[];
  daily_closes: { date: string; override: boolean }[];
};

export type Page<T> = { rows: T[]; has_more: boolean };

const ROLE_MESSAGE = "Your role cannot do this. Nothing was saved.";

/** Server messages are written by the RPCs and are safe to show. A permission error gets one fixed sentence. */
export function scrapErrorMessage(error: { code?: string; message?: string } | null): string {
  if (!error) return "The request failed. Nothing was saved.";
  if (error.code === "42501" || /permission denied/i.test(error.message ?? "")) return ROLE_MESSAGE;
  if (error.code === "28000") return "Your session has ended. Sign in again.";
  return error.message || "The request failed. Nothing was saved.";
}

function fail(error: { code?: string; message?: string } | null): never {
  throw new Error(scrapErrorMessage(error));
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error);
  return data as T;
}

// ------------------------------------------------------------------ Scrap Driver
export const driverCreateLoad = (requestId: string) => rpc<DriverLoad>("scrap_driver_create_load", { p_client_request_id: requestId });
export const driverAttachPhoto = (loadId: string, kind: "load" | "ticket", mediaId: string) =>
  rpc<DriverLoad>("scrap_driver_attach_photo", { p_load_id: loadId, p_kind: kind, p_media_id: mediaId });
export const driverMarkDelivered = (loadId: string) => rpc<DriverLoad>("scrap_driver_mark_delivered", { p_load_id: loadId });
export const driverCompleteLoad = (loadId: string) => rpc<DriverLoad>("scrap_driver_complete_load", { p_load_id: loadId });
export const driverCreateCheck = (requestId: string) => rpc<{ id: string; created_at: string; has_photo: boolean }>("scrap_driver_create_check", { p_client_request_id: requestId });
export const driverAttachCheckPhoto = (checkId: string, mediaId: string) => rpc<{ id: string; has_photo: boolean }>("scrap_driver_attach_check_photo", { p_check_id: checkId, p_media_id: mediaId });
export const driverListLoads = (cursor: { createdAt: string; id: string } | null, limit = 25) =>
  rpc<Page<DriverLoad>>("scrap_driver_list_loads", { p_limit: limit, p_before_created: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null });
export const driverGetLoad = (loadId: string) => rpc<DriverLoad>("scrap_driver_get_load", { p_load_id: loadId });
export const driverListChecks = () => rpc<{ id: string; created_at: string; has_photo: boolean }[]>("scrap_driver_list_checks", { p_limit: 25 });

// ------------------------------------------------------------------ Scrap Management: reads
export const managerSummary = (from: string, to: string) => rpc<Summary>("scrap_manager_summary", { p_from: from, p_to: to });

export type LoadBucket = "all" | "open" | "awaiting_ticket" | "needs_review" | "completed" | "discrepancy" | "unpaid";
export function managerListLoads(
  filter: { bucket: LoadBucket; from?: string | null; to?: string | null; driverId?: string | null },
  cursor: { date: string; createdAt: string; id: string } | null,
  limit = 25
) {
  return rpc<Page<ManagerLoad>>("scrap_manager_list_loads", {
    p_bucket: filter.bucket,
    p_from: filter.from ?? null,
    p_to: filter.to ?? null,
    p_driver: filter.driverId ?? null,
    p_limit: limit,
    p_before_date: cursor?.date ?? null,
    p_before_created: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
  });
}
export const managerGetLoad = (loadId: string) => rpc<LoadDetail>("scrap_manager_get_load", { p_load_id: loadId });
export const managerListPayments = (cursor: { createdAt: string; id: string } | null, limit = 25) =>
  rpc<Page<Payment>>("scrap_manager_list_payments", { p_limit: limit, p_before_created: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null });
export const managerListChecks = (unlinkedOnly: boolean) => rpc<CheckRow[]>("scrap_manager_list_checks", { p_unlinked_only: unlinkedOnly, p_limit: 50 });
export const managerListDiscrepancies = (status: "open" | "resolved" | "all") => rpc<Discrepancy[]>("scrap_manager_list_discrepancies", { p_status: status, p_limit: 100 });
export const managerListRim = (status: "open" | "completed" | "all", cursor: { createdAt: string; id: string } | null, limit = 25) =>
  rpc<Page<RimObligation>>("scrap_manager_list_rim_obligations", { p_status: status, p_limit: limit, p_before_created: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null });
export const managerGetRim = (id: string) => rpc<RimObligation>("scrap_manager_get_rim_obligation", { p_obligation_id: id });
export const managerDailyClosePreview = (date: string) => rpc<ClosePreview>("scrap_manager_daily_close_preview", { p_date: date });
export const managerReport = (from: string, to: string, driverId: string | null) => rpc<Report>("scrap_manager_report", { p_from: from, p_to: to, p_driver: driverId });

// ------------------------------------------------------------------ Scrap Management: writes
export const managerSetMeasurement = (p: { loadId: string; weight: number; rate: number; notes?: string }) =>
  rpc<ManagerLoad>("scrap_manager_set_measurement", { p_load_id: p.loadId, p_weight: p.weight, p_rate: p.rate, p_amount_override: null, p_override_reason: null, p_notes: p.notes ?? null });
export const managerSetAmountOverride = (p: { loadId: string; amount: number; reason: string }) =>
  rpc<ManagerLoad>("scrap_manager_set_measurement", { p_load_id: p.loadId, p_weight: null, p_rate: null, p_amount_override: p.amount, p_override_reason: p.reason, p_notes: null });
export const managerCorrectFinancials = (p: { loadId: string; weight: number | null; rate: number | null; amount: number | null; reason: string }) =>
  rpc<ManagerLoad>("scrap_manager_correct_financials", { p_load_id: p.loadId, p_weight: p.weight, p_rate: p.rate, p_amount_override: p.amount, p_reason: p.reason });
export const managerApproveLoad = (loadId: string) => rpc<ManagerLoad>("scrap_manager_approve_load", { p_load_id: loadId });
export const managerOpenDiscrepancy = (p: { kind: Exclude<DiscrepancyKind, "payment_mismatch">; loadId?: string | null; paymentId?: string | null; note: string }) =>
  rpc<Discrepancy>("scrap_manager_open_discrepancy", { p_kind: p.kind, p_load_id: p.loadId ?? null, p_payment_id: p.paymentId ?? null, p_note: p.note });
export const managerResolveDiscrepancy = (id: string, note: string) => rpc<Discrepancy>("scrap_manager_resolve_discrepancy", { p_discrepancy_id: id, p_resolution_note: note });

export type PaymentResult = { payment: { id: string; amount_received: number; reference_number: string; method: PaymentMethod }; expected_total: number; mismatch: boolean; replay: boolean };
export const managerRecordPayment = (p: {
  driverId: string; loadIds: string[]; amountReceived: number; method: PaymentMethod; reference: string; notes: string; requestId: string;
}) =>
  rpc<PaymentResult>("scrap_manager_record_payment", {
    p_driver_id: p.driverId,
    p_load_ids: p.loadIds,
    p_amount_received: p.amountReceived,
    p_method: p.method,
    p_reference: p.reference,
    p_notes: p.notes,
    p_payment_date: null,
    p_client_request_id: p.requestId,
  });
export const managerAttachPaymentProof = (paymentId: string, mediaId: string) => rpc<{ proof_asset_id: string }>("scrap_manager_attach_payment_proof", { p_payment_id: paymentId, p_media_id: mediaId });
export const managerCorrectPayment = (p: { originalId: string; amountReceived: number; loadIds: string[]; reason: string; requestId: string }) =>
  rpc<PaymentResult>("scrap_manager_correct_payment", {
    p_original_payment_id: p.originalId,
    p_amount_received: p.amountReceived,
    p_load_ids: p.loadIds,
    p_reason: p.reason,
    p_client_request_id: p.requestId,
  });

export const managerCreateRim = (p: { customerId: string; tires: number; aluminum: number; steel: number; notes: string; requestId: string }) =>
  rpc<RimObligation>("scrap_manager_create_rim_obligation", {
    p_customer_id: p.customerId,
    p_tires_qty: p.tires,
    p_aluminum_owed: p.aluminum,
    p_steel_owed: p.steel,
    p_notes: p.notes,
    p_client_request_id: p.requestId,
  });
export const managerRecordRimReturn = (p: { obligationId: string; aluminum: number; steel: number; notes: string; requestId: string }) =>
  rpc<RimObligation>("scrap_manager_record_rim_return", {
    p_obligation_id: p.obligationId,
    p_aluminum_returned: p.aluminum,
    p_steel_returned: p.steel,
    p_notes: p.notes,
    p_client_request_id: p.requestId,
  });

export const managerDailyClose = (date: string, overrideReason: string | null) => rpc<DailyClose>("scrap_manager_daily_close", { p_date: date, p_override_reason: overrideReason });

// ------------------------------------------------------------------ Thumbnails (signed, batched, server route)
export async function fetchScrapThumbnailUrls(mediaIds: string[]): Promise<Record<string, string>> {
  if (mediaIds.length === 0) return {};
  const res = await fetch("/api/media/scrap-thumbnails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaIds }),
  });
  if (!res.ok) throw new Error("Photos could not be loaded.");
  const body = (await res.json()) as { urls: Record<string, string> };
  return body.urls;
}
