"use client";

import { createClient } from "@/lib/supabase/client";
import { salesErrorMessage, type SaleLineInput, type SaleMode } from "@/lib/data/sales";
import type { SaleItem } from "@/lib/mock/sales";

export type QuoteStatus = "DRAFT" | "SENT" | "APPROVED" | "DECLINED" | "EXPIRED" | "CONVERTED";

/**
 * Quote data layer. Quotes are priced by the database, the same as sales. A converted quote is
 * locked; conversion goes through convert_quote_to_sale, which is idempotent and atomic.
 */

export type QuoteListRow = {
  id: string;
  quote_number: string;
  customer_id: string;
  customer_name: string;
  status: QuoteStatus;
  total: string;
  created_at: string;
  converted_sale_id: string | null;
  has_more?: boolean;
};

export type QuoteItemRow = {
  id: string;
  part_id: string | null;
  stock_sku: string;
  description: string;
  quantity: number;
  unit_price: string;
  discount: string;
  line_total: string;
};

export type QuoteDetail = {
  quote: {
    id: string;
    quote_number: string;
    status: QuoteStatus;
    notes: string;
    subtotal: string;
    discount: string;
    tax_rate: string;
    tax: string;
    total: string;
    created_at: string;
    updated_at: string;
  };
  customer: { id: string; customer_number: string; name: string; phone: string; email: string | null; tax_status: string } | null;
  items: QuoteItemRow[];
  converted_sale: { id: string; sale_number: string | null; status: string } | null;
  history: { action: string; summary: string; actor_name: string | null; actor_role: string | null; created_at: string }[];
};

/** Quote lines to the cart shape the screens render. */
export function quoteItemsToCart(items: QuoteItemRow[]): SaleItem[] {
  return items.map((i) => ({
    id: i.id,
    manual: !i.part_id,
    partId: i.part_id ?? undefined,
    stockSku: i.stock_sku || "MANUAL",
    description: i.description,
    quantity: i.quantity,
    unitPrice: Number(i.unit_price),
    discount: Number(i.discount),
  }));
}

function fail(error: { code?: string; hint?: string | null; message?: string } | null): never {
  throw new Error(salesErrorMessage(error));
}

export async function listQuotePage(
  search: string,
  status: QuoteStatus | null,
  cursor: { createdAt: string; id: string } | null,
  limit = 25
): Promise<{ rows: QuoteListRow[]; hasMore: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_quotes", {
    p_search: search.trim() || null,
    p_status: status,
    p_limit: limit,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
  });
  if (error) fail(error);
  const rows = (data ?? []) as QuoteListRow[];
  return { rows, hasMore: rows.length > 0 && !!rows[0].has_more };
}

export async function getQuoteDetail(id: string): Promise<QuoteDetail> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_quote_detail", { p_quote_id: id });
  if (error) fail(error);
  return data as QuoteDetail;
}

export async function createQuote(args: {
  customerId: string;
  lines: SaleLineInput[];
  discount: number;
  notes: string;
  clientRequestId: string;
}): Promise<{ quote_id: string; quote_number: string; total: string; status: string; idempotent_replay: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_quote", {
    p_customer_id: args.customerId,
    p_lines: args.lines,
    p_discount: args.discount,
    p_notes: args.notes,
    p_client_request_id: args.clientRequestId,
  });
  if (error) fail(error);
  return data;
}

export async function updateQuote(args: { quoteId: string; customerId: string; lines: SaleLineInput[]; discount: number; notes: string }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_quote", {
    p_quote_id: args.quoteId,
    p_customer_id: args.customerId,
    p_lines: args.lines,
    p_discount: args.discount,
    p_notes: args.notes,
  });
  if (error) fail(error);
  return data as { quote_id: string; total: string };
}

export async function setQuoteStatus(quoteId: string, status: QuoteStatus) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("set_quote_status", { p_quote_id: quoteId, p_status: status });
  if (error) fail(error);
  return data as { status: QuoteStatus };
}

/** Converts an approved or open quote. A retry returns the sale already created, never a second one. */
export async function convertQuote(quoteId: string, mode: SaleMode): Promise<{ sale_id: string; sale_number: string; idempotent_replay: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("convert_quote_to_sale", { p_quote_id: quoteId, p_mode: mode });
  if (error) fail(error);
  return data;
}
