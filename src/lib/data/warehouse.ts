import { createClient } from "@/lib/supabase/client";

/**
 * Warehouse Employee App data access (migrations 0074–0075). Every call is an RPC. The database decides who may read
 * or place a part, and it writes the location history. This layer only sends the request and returns the server's answer.
 * Warehouse rows carry no price or cost fields.
 */

export type WarehousePart = {
  id: string;
  part_name: string;
  stock_sku: string | null;
  part_number: string | null;
  quantity: number;
  location: string | null;
  status: string;
  operational_status: string;
  thumbnail_asset_id: string | null;
  updated_at: string;
};

export type WarehouseHistoryRow = {
  action: string;
  previous_location: string | null;
  new_location: string | null;
  note: string;
  actor_name: string;
  actor_role: string;
  created_at: string;
};

export type WarehouseDetail = {
  part: WarehousePart & { source_vin: string | null; source_lot: string | null; vehicle_id: string | null; inventory_source: string | null; can_place: boolean };
  history: WarehouseHistoryRow[];
};

export type WarehouseSummary = { pending: number; stored: number };

export const OPERATIONAL_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  RESERVED: "Reserved",
  SOLD: "Sold out",
  MISSING: "Missing",
  DAMAGED: "Damaged",
  RETURNED: "Returned",
};

export function warehouseErrorMessage(error: { code?: string; message?: string } | null): string {
  if (!error) return "The request failed. Nothing was saved.";
  if (error.code === "42501" || /permission denied/i.test(error.message ?? "")) return "Your role cannot do this. Nothing was saved.";
  if (error.code === "28000") return "Your session has ended. Sign in again.";
  return error.message || "The request failed. Nothing was saved.";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(warehouseErrorMessage(error));
  return data as T;
}

export const warehouseSummary = () => rpc<WarehouseSummary>("warehouse_summary", {});
export const warehouseList = (view: "pending" | "stored", after: string | null, limit = 25) =>
  rpc<{ rows: WarehousePart[]; has_more: boolean }>("warehouse_list", { p_view: view, p_after: after, p_limit: limit });
export const warehouseSearch = (query: string) => rpc<WarehousePart[]>("warehouse_search", { p_query: query, p_limit: 25 });
export const warehouseGet = (partId: string) => rpc<WarehouseDetail>("warehouse_get_part", { p_part_id: partId });
export const warehouseSetLocation = (partId: string, location: string) =>
  rpc<WarehouseDetail>("warehouse_set_location", { p_part_id: partId, p_location: location });
