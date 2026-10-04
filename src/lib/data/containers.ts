import { createClient } from "@/lib/supabase/client";

/**
 * Container loading (Module 12) and export management (Module 13). Every call is an RPC (migrations
 * 0040–0041). The database checks the role, the state and the arithmetic. This layer only sends the
 * request and returns the server's answer. The loader types carry no export fields at all.
 */

export type ContainerStatus = "loading" | "ready_for_invoice" | "on_the_way" | "closed";
export const CONTAINER_STATUS_LABEL: Record<ContainerStatus, string> = {
  loading: "Loading",
  ready_for_invoice: "Ready for Invoice",
  on_the_way: "On the Way",
  closed: "Closed",
};

export type LoaderContainer = {
  id: string;
  t_ref: string;
  container_number: string | null;
  number_confirmed: boolean;
  status: ContainerStatus;
  started_at: string | null;
  finished_at: string | null;
  loading_list_confirmed: boolean;
  created_at: string;
  last_update_at: string;
  number_photos: number;
  loading_photos: number;
  final_list_photos: number;
};

export type Page<T> = { rows: T[]; has_more: boolean };

export type PhotoRef = { id: string; role: "number_photo" | "loading_photo" | "final_list"; created_at: string };

export type LoaderDetail = {
  container: LoaderContainer;
  photos: PhotoRef[];
  events: { action: string; actor_name: string; note: string; created_at: string }[];
};

// ------------------------------------------------------------------ export management types
export type ExportInvoiceLine = { description: string; quantity: number; unit_price: number; category: string | null; condition: string | null; line_total: number };
export type ConsigneeSnapshot = { id: string; company: string; contact: string; address: string; city: string; state_province: string; country: string; phone: string; email: string };
export type ExportInvoice = {
  id: string;
  container_id: string;
  t_ref: string;
  invoice_number: string | null;
  status: "Draft" | "Review" | "Finalized";
  finalized_at: string | null;
  notes: string;
  currency: string;
  consignee_id: string | null;
  consignee: ConsigneeSnapshot | null;
  items: ExportInvoiceLine[];
  revision_count: number;
  total: number;
  paid: number;
  balance: number;
};
export type Consignee = { id: string; company: string; contact: string; address: string; city: string; state_province: string; country: string; phone: string; email: string };
export type ExportContainerRow = {
  id: string;
  t_ref: string;
  container_number: string | null;
  status: ContainerStatus;
  loading_list_confirmed: boolean;
  finished_at: string | null;
  created_at: string;
  consignee_company: string | null;
  invoice_status: "Draft" | "Review" | "Finalized" | null;
  invoice_number: string | null;
  invoice_total: string | null;
  balance: string | null;
  paid: string | null;
  ship_date: string | null;
  shipping_reference: string;
};
export type ExportDetail = {
  container: {
    id: string; t_ref: string; container_number: string | null; status: ContainerStatus; number_confirmed: boolean;
    started_at: string | null; finished_at: string | null; loading_list_confirmed: boolean; closed_at: string | null;
    closed_by: string | null; close_override_reason: string | null; created_at: string;
  };
  shipping: { destination_country: string; destination_port: string; trucking_company: string; consignee_id: string | null; ship_date: string | null; eta: string | null; shipping_note: string; shipping_reference: string; shipped_at: string | null } | null;
  consignee: Consignee | null;
  invoice: ExportInvoice | null;
  revisions: { revision_number: number; reason: string; saved_at: string; saved_by: string | null }[];
  payments: { id: string; payment_date: string; amount: number; type: string; method: string; reference_number: string; correction_of: string | null; correction_reason: string | null; reversed: boolean; created_at: string }[];
  events: { action: string; actor_name: string; note: string; created_at: string }[];
  photos: PhotoRef[];
};
export type ExportCounts = { all: number; loading: number; ready_for_invoice: number; on_the_way: number; closed: number };
export type ExportBucket = "all" | "loading" | "ready_for_invoice" | "on_the_way" | "closed";

export const PAYMENT_TYPES = ["Deposit", "Additional Deposit", "Final Payment", "Adjustment"] as const;
export const PAYMENT_METHODS = ["Wire", "ACH", "Check", "Cash", "Other"] as const;

export function containersErrorMessage(error: { code?: string; message?: string } | null): string {
  if (!error) return "The request failed. Nothing was saved.";
  if (error.code === "42501" || /permission denied/i.test(error.message ?? "")) return "Your role cannot do this. Nothing was saved.";
  if (error.code === "28000") return "Your session has ended. Sign in again.";
  return error.message || "The request failed. Nothing was saved.";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(containersErrorMessage(error));
  return data as T;
}

// ------------------------------------------------------------------ loader (Module 12)
export const loaderOpen = (requestId: string) => rpc<LoaderContainer>("container_loader_open", { p_client_request_id: requestId });
export const loaderList = (status: "open" | "ready" | "all", cursor: { createdAt: string; id: string } | null, limit = 25) =>
  rpc<Page<LoaderContainer>>("container_loader_list", { p_status: status, p_limit: limit, p_before_created: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null });
export const loaderGet = (id: string) => rpc<LoaderDetail>("container_loader_get", { p_container_id: id });
export const loaderConfirmNumber = (id: string, number: string) => rpc<LoaderContainer>("container_loader_confirm_number", { p_container_id: id, p_number: number });
export const loaderFinish = (id: string, requestId: string) => rpc<LoaderContainer>("container_loader_finish", { p_container_id: id, p_client_request_id: requestId });

// ------------------------------------------------------------------ export management (Module 13)
export const exportCounts = () => rpc<ExportCounts>("export_container_counts", {});
export const exportList = (bucket: ExportBucket, cursor: { createdAt: string; id: string } | null, limit = 25) =>
  rpc<Page<ExportContainerRow>>("export_list_containers", { p_bucket: bucket, p_limit: limit, p_before_created: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null });
export const exportGet = (id: string) => rpc<ExportDetail>("export_get_container", { p_container_id: id });
export const consigneeList = (search: string | null) => rpc<Consignee[]>("export_consignee_list", { p_search: search, p_limit: 50 });
export const consigneeSave = (p: Partial<Consignee> & { company: string; id?: string | null }) =>
  rpc<Consignee>("export_consignee_save", {
    p_id: p.id ?? null, p_company: p.company, p_contact: p.contact ?? "", p_address: p.address ?? "", p_city: p.city ?? "",
    p_state_province: p.state_province ?? "", p_country: p.country ?? "", p_phone: p.phone ?? "", p_email: p.email ?? "",
  });
export const shippingSave = (p: { containerId: string; consigneeId: string | null; destinationCountry: string; destinationPort: string; truckingCompany: string; shipDate: string | null; eta: string | null; note: string }) =>
  rpc<ExportDetail["shipping"]>("export_container_set_shipping", {
    p_container_id: p.containerId, p_consignee_id: p.consigneeId, p_destination_country: p.destinationCountry, p_destination_port: p.destinationPort,
    p_trucking_company: p.truckingCompany, p_ship_date: p.shipDate, p_eta: p.eta, p_shipping_note: p.note,
  });
export const invoiceCreate = (containerId: string, requestId: string) => rpc<ExportInvoice>("export_create_invoice", { p_container_id: containerId, p_client_request_id: requestId });
export const invoiceSaveDraft = (p: { invoiceId: string; consigneeId: string; notes: string; lines: { description: string; quantity: number; unit_price: number; category?: string; condition?: string }[] }) =>
  rpc<ExportInvoice>("export_save_invoice_draft", { p_invoice_id: p.invoiceId, p_consignee_id: p.consigneeId, p_notes: p.notes, p_lines: p.lines });
export const invoiceReview = (invoiceId: string) => rpc<ExportInvoice>("export_mark_invoice_review", { p_invoice_id: invoiceId });
export const invoiceFinalize = (invoiceId: string, requestId: string) => rpc<ExportInvoice>("export_finalize_invoice", { p_invoice_id: invoiceId, p_client_request_id: requestId });
export const invoiceRevise = (p: { invoiceId: string; reason: string; consigneeId: string; lines: { description: string; quantity: number; unit_price: number; category?: string; condition?: string }[]; requestId: string }) =>
  rpc<ExportInvoice>("export_revise_invoice", { p_invoice_id: p.invoiceId, p_reason: p.reason, p_consignee_id: p.consigneeId, p_lines: p.lines, p_client_request_id: p.requestId });
export const paymentRecord = (p: { invoiceId: string; amount: number; type: string; method: string; reference: string; notes: string; requestId: string }) =>
  rpc<{ id: string; balance: string }>("export_record_payment", {
    p_invoice_id: p.invoiceId, p_amount: p.amount, p_type: p.type, p_method: p.method, p_payment_date: null, p_reference: p.reference, p_notes: p.notes, p_client_request_id: p.requestId,
  });
export const paymentReverse = (p: { paymentId: string; reason: string; requestId: string }) =>
  rpc<{ id: string; balance: string }>("export_reverse_payment", { p_payment_id: p.paymentId, p_reason: p.reason, p_client_request_id: p.requestId });
export const containerOnTheWay = (p: { containerId: string; reference: string; requestId: string }) =>
  rpc<unknown>("export_mark_on_the_way", { p_container_id: p.containerId, p_shipping_reference: p.reference, p_client_request_id: p.requestId });
export const containerClose = (p: { containerId: string; requestId: string }) =>
  rpc<{ status: string }>("export_close_container", { p_container_id: p.containerId, p_client_request_id: p.requestId });
