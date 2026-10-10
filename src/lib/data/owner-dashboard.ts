import { createClient } from "@/lib/supabase/client";

/**
 * Owner Dashboard data (Module 14). Read models from migration 0042. Owner only. The database filters the
 * date range and computes every figure; the browser only displays what it receives.
 */
export type StageCounts = { purchased: number; inTransit: number; arrived: number; processing: number; waitingReview: number; completed: number };
export type ExceptionItem = { id: string; label: string; severity: "critical" | "warning"; count: number };
export type DashboardSummary = {
  stage_counts: StageCounts;
  exceptions: ExceptionItem[];
  kpis: { total_vehicles: number; parts_pulled: number; converters: number; containers_shipped: number; scrap_loads: number; scrap_loads_today: number };
  notification_count: number;
};
export type EmployeeRow = { profile_id: string; name: string; role: string; actions: number; captured: number; loads: number };
export type ActivityItem = {
  id: string; action: string; actor_name: string; created_at: string; vehicle_id: string | null; part_type: string | null; note: string | null; vehicle_title: string | null;
};

export function dashboardErrorMessage(error: { code?: string; message?: string } | null): string {
  if (!error) return "The dashboard could not be loaded.";
  if (error.code === "42501") return "Your role cannot open the owner dashboard.";
  return error.message || "The dashboard could not be loaded.";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(dashboardErrorMessage(error));
  return data as T;
}

export const ownerSummary = (from: string, to: string) => rpc<DashboardSummary>("owner_dashboard_summary", { p_from: from, p_to: to });
export const ownerEmployees = (from: string, to: string) => rpc<EmployeeRow[]>("owner_dashboard_employees", { p_from: from, p_to: to });
export const ownerActivity = (from: string, to: string, limit = 8) => rpc<ActivityItem[]>("owner_dashboard_activity", { p_from: from, p_to: to, p_limit: limit });

// ---------------------------------------------------------------------------------------
// Below: no RPC exists yet for these tiles (parts status, sales totals/history, top sellers).
// Rather than invent numbers, each reads directly from its real table through the owner's own
// RLS (parts/sales/sale_items are all readable by `owner` per `is_parts_staff()`/`is_sales_staff()`
// in migration 0001) — the same lightweight, bounded direct-read pattern already used elsewhere
// in this codebase for simple lookups (e.g. carriers in src/lib/data/vehicles.ts, sales_settings
// in src/lib/data/sales.ts). No business logic, no money calculation happens here — only counts
// and sums of rows the database has already decided this role may see.
// ---------------------------------------------------------------------------------------

export type PartsStatusCounts = { available: number; reserved: number; sold: number };

/** Real breakdown of parts.operational_status ('AVAILABLE' | 'RESERVED' | 'SOLD' are real column values). */
export async function ownerPartsStatus(): Promise<PartsStatusCounts> {
  const supabase = createClient();
  const [available, reserved, sold] = await Promise.all([
    supabase.from("parts").select("id", { count: "exact", head: true }).eq("operational_status", "AVAILABLE"),
    supabase.from("parts").select("id", { count: "exact", head: true }).eq("operational_status", "RESERVED"),
    supabase.from("parts").select("id", { count: "exact", head: true }).eq("operational_status", "SOLD"),
  ]);
  const firstError = available.error ?? reserved.error ?? sold.error;
  if (firstError) throw new Error(dashboardErrorMessage(firstError));
  return { available: available.count ?? 0, reserved: reserved.count ?? 0, sold: sold.count ?? 0 };
}

export type TodaySales = { total: number; count: number };

/** Sum and count of today's sales (local calendar day), excluding cancelled sales. */
export async function ownerTodaySales(): Promise<TodaySales> {
  const supabase = createClient();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from("sales")
    .select("total")
    .neq("status", "CANCELLED")
    .gte("created_at", startOfDay.toISOString());
  if (error) throw new Error(dashboardErrorMessage(error));
  const rows = data ?? [];
  return { total: rows.reduce((sum, r) => sum + Number(r.total), 0), count: rows.length };
}

export type SalesByDayPoint = { date: string; total: number };

/** Daily sales totals for the last `days` calendar days (including today), excluding cancelled sales. Zero-filled
 * for days with no sales, so the chart never has a gap. */
export async function ownerSalesByDay(days: number): Promise<SalesByDayPoint[]> {
  const supabase = createClient();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from("sales")
    .select("total, created_at")
    .neq("status", "CANCELLED")
    .gte("created_at", from.toISOString());
  if (error) throw new Error(dashboardErrorMessage(error));
  const byDay = new Map<string, number>();
  for (const row of data ?? []) {
    const key = new Date(row.created_at as string).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + Number(row.total));
  }
  const out: SalesByDayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, total: byDay.get(key) ?? 0 });
  }
  return out;
}

export type TopSellingPart = { partId: string; name: string; quantity: number };

/** Units sold per part over the last `days` days, ranked descending, from real sale_items joined to parts.
 * Three small bounded queries (sale ids in range -> their line items -> the named parts) rather than one
 * unbounded join, matching this app's keyset/bounded-read convention. */
export async function ownerTopSellingParts(days = 30, limit = 5): Promise<TopSellingPart[]> {
  const supabase = createClient();
  const from = new Date();
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);

  const salesQ = await supabase.from("sales").select("id").neq("status", "CANCELLED").gte("created_at", from.toISOString());
  if (salesQ.error) throw new Error(dashboardErrorMessage(salesQ.error));
  const saleIds = (salesQ.data ?? []).map((r) => r.id as string);
  if (!saleIds.length) return [];

  const itemsQ = await supabase.from("sale_items").select("part_id, quantity").in("sale_id", saleIds).not("part_id", "is", null);
  if (itemsQ.error) throw new Error(dashboardErrorMessage(itemsQ.error));
  const qtyByPart = new Map<string, number>();
  for (const item of itemsQ.data ?? []) {
    const partId = item.part_id as string | null;
    if (!partId) continue;
    qtyByPart.set(partId, (qtyByPart.get(partId) ?? 0) + Number(item.quantity));
  }
  const ranked = [...qtyByPart.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!ranked.length) return [];

  const partsQ = await supabase.from("parts").select("id, part_name").in("id", ranked.map(([id]) => id));
  if (partsQ.error) throw new Error(dashboardErrorMessage(partsQ.error));
  const nameById = new Map((partsQ.data ?? []).map((p) => [p.id as string, (p.part_name as string) || "Unnamed part"]));
  return ranked.map(([partId, quantity]) => ({ partId, name: nameById.get(partId) ?? "Unnamed part", quantity }));
}
