"use client";

import { createClient } from "@/lib/supabase/client";
import { salesErrorMessage } from "@/lib/data/sales";
import type { PaymentMethod } from "@/lib/mock/sales";

/**
 * Payment data layer. Lifecycle: create (pending) → allocate (bookkeeping only) → post (changes sale
 * money, atomically) → void (reverses it for posted payments, admin only). The browser never computes
 * balances or statuses. Every figure comes back from the database.
 */

export type PaymentStatus = "pending" | "posted" | "void";

export type PaymentListRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string;
  created_at: string;
  posted_at: string | null;
  allocated_total: string;
  has_more?: boolean;
};

export type PaymentDetail = {
  payment: {
    id: string;
    customer_id: string;
    amount: string;
    method: PaymentMethod;
    reference: string;
    notes: string;
    status: PaymentStatus;
    created_at: string;
    posted_at: string | null;
    voided_at: string | null;
    void_reason: string | null;
    allocated_total: string;
    unallocated_amount: string;
  };
  customer: { id: string; customer_number: string; name: string; phone: string } | null;
  allocations: {
    id: string;
    sale_id: string;
    sale_number: string | null;
    sale_total: string;
    sale_amount_paid: string;
    sale_balance_due: string;
    sale_payment_status: string;
    amount: string;
    created_at: string;
  }[];
  viewer_is_admin: boolean;
  history: { action: string; summary: string; actor_name: string | null; actor_role: string | null; created_at: string }[];
};

export type SalePaymentRow = {
  payment_id: string;
  allocation_id: string;
  allocated_amount: string;
  payment_status: PaymentStatus;
  method: PaymentMethod;
  payment_amount: string;
  created_at: string;
  posted_at: string | null;
};

function fail(error: { code?: string; hint?: string | null; message?: string } | null): never {
  throw new Error(salesErrorMessage(error));
}

export async function listPaymentPage(
  search: string,
  status: PaymentStatus | null,
  cursor: { createdAt: string; id: string } | null,
  limit = 25,
  range?: { from: string | null; to: string | null }
): Promise<{ rows: PaymentListRow[]; hasMore: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_payments", {
    p_search: search.trim() || null,
    p_status: status,
    p_limit: limit,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_from: range?.from ?? null,
    p_to: range?.to ?? null,
  });
  if (error) fail(error);
  const rows = (data ?? []) as PaymentListRow[];
  return { rows, hasMore: rows.length > 0 && !!rows[0].has_more };
}

export type PaymentsSummary = {
  total_count: number;
  total_amount: string;
  posted_count: number;
  posted_amount: string;
  pending_count: number;
  pending_amount: string;
  void_count: number;
  void_amount: string;
};

/** Range totals for the Payments KPI row — payments_summary (migration 0079), the same
 * created_at predicate list_payments filters by, so the tiles and the list agree for the same range. */
export async function getPaymentsSummary(range: { from: string | null; to: string | null }): Promise<PaymentsSummary> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("payments_summary", { p_from: range.from, p_to: range.to });
  if (error) fail(error);
  const row = (Array.isArray(data) ? data[0] : data) as PaymentsSummary | undefined;
  return (
    row ?? {
      total_count: 0,
      total_amount: "0",
      posted_count: 0,
      posted_amount: "0",
      pending_count: 0,
      pending_amount: "0",
      void_count: 0,
      void_amount: "0",
    }
  );
}

export async function getPaymentDetail(id: string): Promise<PaymentDetail> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_payment_detail", { p_payment_id: id });
  if (error) fail(error);
  return data as PaymentDetail;
}

export async function listSalePayments(saleId: string): Promise<SalePaymentRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_sale_payments", { p_sale_id: saleId });
  if (error) fail(error);
  return (data ?? []) as SalePaymentRow[];
}

export async function createPayment(args: {
  customerId: string;
  amount: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
  clientRequestId: string;
}): Promise<{ id: string; status: PaymentStatus; amount: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_payment", {
    p_customer_id: args.customerId,
    p_amount: args.amount,
    p_method: args.method,
    p_reference: args.reference,
    p_notes: args.notes,
    p_client_request_id: args.clientRequestId,
  });
  if (error) fail(error);
  return data as { id: string; status: PaymentStatus; amount: string };
}

export async function allocatePayment(args: { paymentId: string; saleId: string; amount: string }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("allocate_payment", {
    p_payment_id: args.paymentId,
    p_sale_id: args.saleId,
    p_amount: args.amount,
  });
  if (error) fail(error);
  return data as { allocation_id: string; idempotent_replay: boolean };
}

export async function postPayment(paymentId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("post_payment", { p_payment_id: paymentId });
  if (error) fail(error);
  return data as { payment: { status: PaymentStatus }; sales: { sale_id: string; amount_paid: string; balance_due: string; payment_status: string }[] };
}

export async function voidPayment(paymentId: string, reason: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("void_payment", { p_payment_id: paymentId, p_reason: reason });
  if (error) fail(error);
  return data as { status: PaymentStatus };
}
