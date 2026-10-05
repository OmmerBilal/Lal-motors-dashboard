"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  cancelInvite, dayActivity, employeeActivity, inviteMember, recentActivity, removeMember, setAccountStatus, setMemberRole, teamInvites, teamMembers,
} from "@/lib/data/team";

export const teamKeys = {
  all: ["team"] as const,
  members: ["team", "members"] as const,
  invites: ["team", "invites"] as const,
  activity: (from: string, to: string) => ["team", "activity", from, to] as const,
  recent: (from: string, to: string) => ["team", "recent", from, to] as const,
  day: (id: string, date: string) => ["team", "day", id, date] as const,
};

/** Only the team subtree is invalidated. */
export function invalidateTeam(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: teamKeys.all });
}

export function useTeamMembers() {
  return useQuery({ queryKey: teamKeys.members, queryFn: teamMembers, staleTime: 30_000 });
}
export function useTeamInvites() {
  return useQuery({ queryKey: teamKeys.invites, queryFn: teamInvites, staleTime: 30_000 });
}
export function useEmployeeActivity(from: string, to: string) {
  return useQuery({ queryKey: teamKeys.activity(from, to), queryFn: () => employeeActivity(from, to), enabled: !!from && !!to, staleTime: 60_000 });
}
export function useRecentActivity(from: string, to: string) {
  return useQuery({ queryKey: teamKeys.recent(from, to), queryFn: () => recentActivity(from, to, 50), enabled: !!from && !!to, staleTime: 30_000 });
}
export function useDayActivity(id: string | null, date: string) {
  return useQuery({ queryKey: teamKeys.day(id ?? "", date), queryFn: () => dayActivity(id ?? "", date), enabled: !!id && !!date, staleTime: 30_000 });
}

export function useTeamMutations() {
  const qc = useQueryClient();
  const done = () => invalidateTeam(qc);
  return {
    setRole: useMutation({ mutationFn: (p: { id: string; role: string }) => setMemberRole(p.id, p.role), onSuccess: done }),
    setStatus: useMutation({ mutationFn: (p: { id: string; status: "active" | "disabled" }) => setAccountStatus(p.id, p.status), onSuccess: done }),
    remove: useMutation({ mutationFn: (p: { id: string; reason: string }) => removeMember(p.id, p.reason), onSuccess: done }),
    invite: useMutation({ mutationFn: inviteMember, onSuccess: done }),
    cancelInvite: useMutation({ mutationFn: (id: string) => cancelInvite(id), onSuccess: done }),
  };
}
