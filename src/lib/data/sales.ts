"use client";

import { createClient } from "@/lib/supabase/client";
import type { SaleItem } from "@/lib/mock/sales";

/**
 * Sales data layer. Every money figure comes from the server: the browser sends lines, the database
 * prices, taxes and totals them, and writes the sale in one transaction. Reads are keyset-paged
 * lightweight rows for lists and the full read model for the detail screen.
 */

export type SaleMode = "draft" | "reserve" | "fulfill_now";

export type SaleListRow = {
  id: string;
  sale_number: string | null;
  customer_id: string;
  customer_name: string;
  created_at: string;
  total: string;
  amount_paid: string;
  balance_due: string;
  payment_status: string;
  fulfillment_status: string;
  status: string;
  has_more?: boolean;
};

export type SaleLineRow = {
  id: string;
  part_id: string | null;
  stock_sku: string;
  description: string;
  quantity: number;
  unit_price: string;
  discount: string;
  line_total: string;
  stock_action: string;
  previous_quantity: number | null;
  new_quantity: number | null;
};

export type ReservationRow = {
  id: string;
  part_id: string;
  sale_item_id: string;
  quantity: number;
  status: string;
  reserved_at: string;
  released_at: string | null;
  fulfilled_at: string | null;
};

export type SaleDetail = {
  sale: {
    id: string;
    sale_number: string | null;
    status: string;
    fulfillment_status: string;
    payment_status: string;
    created_at: string;
    finalized_at: string | null;
    notes: string;
    subtotal: string;
    discount: string;
    tax_rate: string;
    tax: string;
    total: string;
    amount_paid: string;
    balance_due: string;
  };
  customer: { id: string; customer_number: string; name: string; phone: string; email: string | null; tax_status: string } | null;
  lines: SaleLineRow[];
  reservations: ReservationRow[];
  quote: { id: string; quote_number: string; status: string } | null;
  payment_allocation_count: number;
  history: { action: string; summary: string; actor_name: string | null; actor_role: string | null; created_at: string }[];
};

export type SellablePart = {
  id: string;
  part_name: string;
  stock_sku: string;
  price: string;
  quantity: number;
  available: number;
  out_of_stock: boolean;
  thumbnail_path: string | null;
  thumbnail_bucket: string | null;
};

export type SalesSettings = { taxRate: number; taxLabel: string; businessName: string; businessAddress: string; businessPhone: string };

export type SaleLineInput = { part_id?: string; description?: string; quantity: number; unit_price: number; discount: number };

/** Turns a Postgres or PostgREST error into a message a person can act on. Server messages are safe to show. */
export function salesErrorMessage(error: { code?: string; hint?: string | null; message?: string } | null): string {
  if (!error) return "The request failed. Nothing was saved.";
  if (error.code === "42501") return "Your role cannot do this. Nothing was saved.";
  switch (error.hint) {
    case "OUT_OF_STOCK":
      return "Not enough stock for one of the parts. Nothing was saved.";
    case "NOT_SELLABLE":
      return "A part on this sale is not sellable right now. Nothing was saved.";
    case "QUOTE_LOCKED":
      return "This quote can no longer be edited.";
    case "INVALID_TRANSITION":
      return "That quote status change is not allowed.";
    case "QUOTE_NOT_CONVERTIBLE":
      return "This quote cannot be converted to a sale.";
    case "CUSTOMER_MISSING":
      return "The customer on this quote no longer exists.";
    default:
      return error.message || "The request failed. Nothing was saved.";
  }
}

function fail(error: { code?: string; hint?: string | null; message?: string } | null): never {
  throw new Error(salesErrorMessage(error));
}

/** Cart lines to the server shape. Part lines send the part id; manual lines send a description. */
export function cartToLines(items: SaleItem[]): SaleLineInput[] {
  return items.map((i) => {
    const base = { quantity: i.quantity, unit_price: i.unitPrice, discount: i.discount || 0 };
    return i.partId && !i.manual ? { part_id: i.partId, description: i.description, ...base } : { description: i.description, ...base };
  });
}

/** Lines from the server read model to the cart shape the screens render. */
export function linesToItems(lines: SaleLineRow[]): SaleItem[] {
  return lines.map((l) => ({
    id: l.id,
    manual: !l.part_id,
    partId: l.part_id ?? undefined,
    stockSku: l.stock_sku || "MANUAL",
    description: l.description,
    quantity: l.quantity,
    unitPrice: Number(l.unit_price),
    discount: Number(l.discount),
  }));
}

export async function listSalePage(
  search: string,
  status: string | null,
  cursor: { createdAt: string; id: string } | null,
  limit = 25
): Promise<{ rows: SaleListRow[]; hasMore: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_sales", {
    p_search: search.trim() || null,
    p_status: status,
    p_limit: limit,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
  });
  if (error) fail(error);
  const rows = (data ?? []) as SaleListRow[];
  return { rows, hasMore: rows.length > 0 && !!rows[0].has_more };
}

export async function getSaleDetail(id: string): Promise<SaleDetail> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_sale_detail", { p_sale_id: id });
  if (error) fail(error);
  return data as SaleDetail;
}

export async function createSale(args: {
  customerId: string;
  lines: SaleLineInput[];
  mode: SaleMode;
  discount: number;
  notes: string;
  clientRequestId: string;
}): Promise<{ sale_id: string; sale_number: string; total: string; fulfillment_status: string; idempotent_replay: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_sale", {
    p_customer_id: args.customerId,
    p_lines: args.lines,
    p_mode: args.mode,
    p_client_request_id: args.clientRequestId,
    p_notes: args.notes,
    p_discount: args.discount,
    p_quote_id: null,
  });
  if (error) fail(error);
  return data;
}

export async function reserveSale(saleId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("reserve_stock", { p_sale_id: saleId });
  if (error) fail(error);
  return data as { reserved_lines: number };
}

export async function releaseSale(saleId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("release_reservation", { p_sale_id: saleId });
  if (error) fail(error);
  return data as { released: number };
}

export async function fulfillSale(saleId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("fulfill_sales_order", { p_sale_id: saleId });
  if (error) fail(error);
  return data as { fulfilled_lines: number };
}

/** Part search for the sale. Only sellable parts appear; zero-stock parts show as out of stock. */
export async function searchSellableParts(search: string, limit = 20): Promise<SellablePart[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("search_sellable_parts", { p_search: search.trim() || null, p_limit: limit });
  if (error) fail(error);
  return (data ?? []) as SellablePart[];
}

export async function listCustomerQuotes(customerId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_customer_quotes", { p_customer_id: customerId, p_limit: 50 });
  if (error) fail(error);
  return (data ?? []) as { id: string; quote_number: string; status: string; total: string; created_at: string; converted_sale_id: string | null }[];
}

type SettingsRow = { tax_rate: string; tax_label: string; business_name: string; business_address: string; business_phone: string };

export async function getSalesSettings(): Promise<SalesSettings | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sales_settings")
    .select("tax_rate, tax_label, business_name, business_address, business_phone")
    .eq("id", 1)
    .maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  const row = data as SettingsRow;
  return {
    taxRate: Number(row.tax_rate),
    taxLabel: row.tax_label,
    businessName: row.business_name,
    businessAddress: row.business_address,
    businessPhone: row.business_phone,
  };
}

/** Owner and engineer admin only: the database enforces it through the sales_settings write policy. */
export async function updateSalesSettings(patch: Partial<SalesSettings>) {
  const supabase = createClient();
  const row: Partial<SettingsRow> = {};
  if (patch.taxRate !== undefined) row.tax_rate = String(patch.taxRate);
  if (patch.taxLabel !== undefined) row.tax_label = patch.taxLabel;
  if (patch.businessName !== undefined) row.business_name = patch.businessName;
  if (patch.businessAddress !== undefined) row.business_address = patch.businessAddress;
  if (patch.businessPhone !== undefined) row.business_phone = patch.businessPhone;
  const { data, error } = await supabase.from("sales_settings").update(row).eq("id", 1).select("id");
  if (error) fail(error);
  if (!data?.length) throw new Error("Your role cannot change sales settings. Nothing was saved.");
}
