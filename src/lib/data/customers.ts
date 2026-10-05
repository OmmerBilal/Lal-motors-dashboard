"use client";

import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/lib/mock/sales";

/**
 * Customer data layer. Writes go through create_customer and update_customer, which normalize the
 * phone, report possible duplicates without writing, and record history. Reads use the lightweight
 * list for lists and the full record and history only on the detail screen.
 */

export type CustomerListRow = {
  id: string;
  customer_number: string;
  display_name: string;
  last_name: string;
  first_name: string;
  phone: string;
  email: string;
  customer_type: string;
  tax_status: string;
  has_more?: boolean;
};

export type CustomerForm = Omit<Customer, "id" | "customerNumber" | "documents" | "createdAt">;

export type DuplicateMatch = { id: string; name: string; phone: string; email: string | null };

export type SaveOutcome =
  | { outcome: "created"; customerId: string; idempotentReplay: boolean }
  | { outcome: "updated"; customerId: string }
  | { outcome: "possible_duplicate"; matches: DuplicateMatch[] };

function fail(error: { message: string; hint?: string | null } | null): never {
  throw new Error(error?.message ?? "Request failed");
}

function toPayload(form: Partial<CustomerForm>) {
  const out: Record<string, string> = {};
  const map: [keyof CustomerForm, string][] = [
    ["firstName", "first_name"],
    ["lastName", "last_name"],
    ["companyName", "company_name"],
    ["phone", "phone"],
    ["email", "email"],
    ["billingAddress", "billing_address"],
    ["shippingAddress", "shipping_address"],
    ["notes", "notes"],
    ["customerType", "customer_type"],
    ["taxStatus", "tax_status"],
  ];
  for (const [k, dbKey] of map) {
    if (form[k] !== undefined) out[dbKey] = String(form[k]);
  }
  return out;
}

/** Keyset-paged search across all matching customers. Lightweight rows only. */
export async function listCustomerPage(search: string, cursor: { last: string; first: string; id: string } | null, limit = 25) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_customers", {
    p_search: search.trim() || null,
    p_limit: limit,
    p_cursor_last: cursor?.last ?? null,
    p_cursor_first: cursor?.first ?? null,
    p_cursor_id: cursor?.id ?? null,
  });
  if (error) fail(error);
  const rows = (data ?? []) as CustomerListRow[];
  return { rows, hasMore: rows.length > 0 && !!rows[0].has_more };
}

/** Maps a list row into the Customer shape. The list carries the display name only. */
export function listRowToCustomer(r: CustomerListRow): Customer {
  return {
    id: r.id,
    customerNumber: r.customer_number,
    firstName: r.display_name,
    lastName: "",
    companyName: "",
    phone: r.phone,
    secondaryPhone: "",
    email: r.email ?? "",
    billingAddress: "",
    shippingAddress: "",
    notes: "",
    customerType: r.customer_type as Customer["customerType"],
    taxStatus: r.tax_status as Customer["taxStatus"],
    taxId: "",
    resaleCertificateNumber: "",
    exemptionExpiresAt: "",
    documents: [],
    createdAt: "",
  };
}

/** The complete record for edit and detail. Read directly under sales-staff RLS. */
export async function getCustomerRecord(id: string): Promise<Customer | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, customer_number, first_name, last_name, company_name, phone, secondary_phone, email, billing_address, shipping_address, notes, customer_type, tax_status, tax_id, resale_certificate_number, exemption_expires_at, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  return {
    id: data.id,
    customerNumber: data.customer_number,
    firstName: data.first_name,
    lastName: data.last_name,
    companyName: data.company_name,
    phone: data.phone,
    secondaryPhone: data.secondary_phone,
    email: data.email ?? "",
    billingAddress: data.billing_address,
    shippingAddress: data.shipping_address,
    notes: data.notes,
    customerType: data.customer_type,
    taxStatus: data.tax_status,
    taxId: data.tax_id,
    resaleCertificateNumber: data.resale_certificate_number,
    exemptionExpiresAt: data.exemption_expires_at ?? "",
    documents: [],
    createdAt: data.created_at,
  };
}

export async function createCustomer(form: CustomerForm, opts: { confirmNew?: boolean; requestId: string }): Promise<SaveOutcome> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_customer", {
    p_data: { ...toPayload(form), confirm_new: !!opts.confirmNew },
    p_client_request_id: opts.requestId,
  });
  if (error) fail(error);
  const r = data as { outcome: string; customer_id?: string; idempotent_replay?: boolean; matches?: DuplicateMatch[] };
  if (r.outcome === "possible_duplicate") return { outcome: "possible_duplicate", matches: r.matches ?? [] };
  return { outcome: "created", customerId: r.customer_id ?? "", idempotentReplay: !!r.idempotent_replay };
}

export async function updateCustomer(id: string, form: Partial<CustomerForm>, opts: { confirmNew?: boolean }): Promise<SaveOutcome> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_customer", {
    p_customer_id: id,
    p_data: { ...toPayload(form), confirm_new: !!opts.confirmNew },
  });
  if (error) fail(error);
  const r = data as { outcome: string; customer_id?: string; matches?: DuplicateMatch[] };
  if (r.outcome === "possible_duplicate") return { outcome: "possible_duplicate", matches: r.matches ?? [] };
  return { outcome: "updated", customerId: r.customer_id ?? id };
}

export type CustomerHistory = {
  balance_due: number;
  sales: { id: string; sale_number: string | null; total: string; amount_paid: string; balance_due: string; payment_status: string; status: string; fulfillment_status: string; created_at: string }[];
  payments: { id: string; amount: string; method: string; status: string; created_at: string; posted_at: string | null }[];
};

export async function getCustomerHistory(id: string): Promise<CustomerHistory> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("customer_history", { p_customer_id: id });
  if (error) fail(error);
  return data as CustomerHistory;
}
