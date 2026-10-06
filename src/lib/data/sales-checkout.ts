"use client";

import { createClient } from "@/lib/supabase/client";
import type { SaleLineInput, SaleMode } from "@/lib/data/sales";

/**
 * Front-desk checkout and customer payments. Each call is one database function that does all of its work in one
 * transaction. Totals, balances and statuses come back from the server; the screen shows those, not its own math.
 */

export type CheckoutMethod = "CASH" | "CARD" | "CHECK" | "BANK_TRANSFER" | "OTHER";

export const CHECKOUT_METHODS: { value: CheckoutMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "CHECK", label: "Check" },
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "OTHER", label: "Other" },
];

export type CheckoutResult = {
  sale_id: string;
  sale_number: string;
  customer_id: string;
  total: string;
  amount_paid: string;
  balance_due: string;
  payment_status: "UNPAID" | "PARTIAL" | "PAID";
  fulfillment_status: string;
  sale_status: string;
  payment_id: string | null;
  idempotent_replay: boolean;
};

export type OutstandingSale = {
  sale_id: string;
  sale_number: string;
  sale_date: string;
  total: string;
  amount_paid: string;
  balance_due: string;
  payment_status: string;
};

export type Outstanding = { customer_id: string; total_outstanding: string; sales: OutstandingSale[] };

export type ReceivePaymentResult = {
  payment_id: string;
  received: string;
  applied: { sale_id: string; sale_number: string; amount: string }[];
  remaining_outstanding: string;
  idempotent_replay: boolean;
};

function fail(error: { message: string; hint?: string | null } | null): never {
  const err = new Error(error?.message ?? "Request failed") as Error & { hint?: string | null };
  err.hint = error?.hint ?? null;
  throw err;
}

/** Sale (any mode) and an optional payment, allocated and posted to this sale in one transaction. */
export async function createSaleWithPayment(args: {
  customerId: string;
  lines: SaleLineInput[];
  mode: SaleMode;
  discount: number;
  notes: string;
  clientRequestId: string;
  amountPaid: number;
  method: CheckoutMethod | null;
  reference: string;
  paymentRequestId: string;
}): Promise<CheckoutResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_sale_with_payment", {
    p_customer_id: args.customerId,
    p_lines: args.lines,
    p_mode: args.mode,
    p_discount: args.discount,
    p_notes: args.notes,
    p_client_request_id: args.clientRequestId,
    p_amount_paid: args.amountPaid,
    p_method: args.method,
    p_reference: args.reference,
    p_payment_request_id: args.paymentRequestId,
  });
  if (error) fail(error);
  return data as CheckoutResult;
}

export async function getCustomerOutstanding(customerId: string): Promise<Outstanding> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("customer_outstanding", { p_customer_id: customerId });
  if (error) fail(error);
  return data as Outstanding;
}

/** One payment, applied to the oldest open sales first and posted in the same action. */
export async function receiveCustomerPayment(args: {
  customerId: string;
  amount: number;
  method: CheckoutMethod;
  reference: string;
  notes: string;
  clientRequestId: string;
}): Promise<ReceivePaymentResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("receive_customer_payment", {
    p_customer_id: args.customerId,
    p_amount: args.amount,
    p_method: args.method,
    p_reference: args.reference,
    p_notes: args.notes,
    p_client_request_id: args.clientRequestId,
  });
  if (error) fail(error);
  return data as ReceivePaymentResult;
}

/** Plain-language payment status for a sale, from the server status and the balance. */
export function paymentStatusText(status: string) {
  if (status === "PAID") return "PAID";
  if (status === "PARTIAL") return "PARTIALLY PAID";
  return "UNPAID";
}
