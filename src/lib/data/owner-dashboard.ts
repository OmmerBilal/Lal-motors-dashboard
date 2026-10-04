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
