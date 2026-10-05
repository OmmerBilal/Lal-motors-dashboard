import { createClient } from "@/lib/supabase/client";

/**
 * Team management and employee activity (Module 15). Every call is an owner-only RPC (migrations 0043–0046).
 * The database checks the caller, the target account and the rules; this layer only sends and displays.
 */
export type TeamMember = {
  id: string;
  name: string;
  email: string;
  account_status: "active" | "disabled" | "removed";
  roles: string[];
  last_seen_at: string | null;
  created_at: string;
};
export type PendingInvite = { id: string; email: string; name: string; role: string; invited_at: string; invited_by_name: string };
export type EmployeeActivity = {
  profile_id: string; name: string; account_status: string; roles: string[];
  vehicle_events: number; sessions_started: number; sessions_completed: number; parts_captured: number;
  part_reviews: number; scrap_loads: number; container_actions: number;
};
export type AuditItem = {
  id: string; actor_name: string; actor_id: string | null; action: string; entity_type: string; entity_id: string;
  summary: string; created_at: string;
};
export type DayActivity = {
  parts: { id: string; part_name: string; status: string; created_at: string; vehicle_id: string }[];
  actions: { id: string; action: string; created_at: string; vehicle_id: string }[];
};

export function teamErrorMessage(error: { code?: string; message?: string } | null): string {
  if (!error) return "The request failed. Nothing was saved.";
  if (error.code === "42501" || /permission denied/i.test(error.message ?? "")) return "Only the owner can manage accounts. Nothing was saved.";
  if (error.code === "28000") return "Your session has ended. Sign in again.";
  return error.message || "The request failed. Nothing was saved.";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(teamErrorMessage(error));
  return data as T;
}

export const teamMembers = () => rpc<TeamMember[]>("team_list_members", {});
export const teamInvites = () => rpc<PendingInvite[]>("team_list_invites", {});
export const employeeActivity = (from: string, to: string) => rpc<EmployeeActivity[]>("employee_activity_summary", { p_from: from, p_to: to });
export const recentActivity = (from: string, to: string, limit = 50, actorId: string | null = null) =>
  rpc<AuditItem[]>("employee_recent_activity", { p_from: from, p_to: to, p_limit: limit, p_actor: actorId });
export const dayActivity = (profileId: string, date: string) => rpc<DayActivity>("employee_day_activity", { p_profile: profileId, p_date: date });
export const setMemberRole = (profileId: string, roleKey: string) => rpc<{ changed: boolean }>("team_set_role", { p_profile: profileId, p_role_key: roleKey });
export const setAccountStatus = (profileId: string, status: "active" | "disabled") => rpc<{ changed: boolean }>("team_set_account_status", { p_profile: profileId, p_status: status });
export const removeMember = (profileId: string, reason: string) => rpc<{ changed: boolean }>("team_remove_member", { p_profile: profileId, p_reason: reason });
export const inviteMember = (p: { email: string; name: string; roleKey: string; requestId: string }) =>
  rpc<{ id: string; email_delivery: string; replay: boolean }>("team_invite_member", { p_email: p.email, p_name: p.name, p_role_key: p.roleKey, p_client_request_id: p.requestId });
export const cancelInvite = (inviteId: string) => rpc<{ changed: boolean }>("team_cancel_invite", { p_invite: inviteId });
