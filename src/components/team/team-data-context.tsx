"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { teamMembers as seedMembers, pendingInvites, type TeamMember } from "@/lib/mock/team";
import type { Role } from "@/lib/types";

type TeamDataValue = {
  members: TeamMember[];
  updateRole: (id: string, role: Role) => void;
  toggleAccountStatus: (id: string) => void;
  removeMember: (id: string) => void;
  resendInvite: (id: string) => void;
  inviteMember: (name: string, email: string, role: Role) => void;
};

const TeamDataContext = createContext<TeamDataValue | null>(null);

export function TeamDataProvider({ children }: { children: React.ReactNode }) {
  const [members, setMembers] = useState<TeamMember[]>([...seedMembers, ...pendingInvites]);

  const updateRole = useCallback((id: string, role: Role) => {
    setMembers((xs) => xs.map((m) => (m.id === id ? { ...m, role } : m)));
  }, []);

  const toggleAccountStatus = useCallback((id: string) => {
    setMembers((xs) => xs.map((m) => (m.id === id ? { ...m, accountStatus: m.accountStatus === "disabled" ? "active" : "disabled" } : m)));
  }, []);

  const removeMember = useCallback((id: string) => {
    setMembers((xs) => xs.filter((m) => m.id !== id));
  }, []);

  const resendInvite = useCallback(() => {
    // no-op in this UI-only phase; the invite email would be resent by the backend
  }, []);

  const inviteMember = useCallback((name: string, email: string, role: Role) => {
    setMembers((xs) => [
      ...xs,
      {
        id: `u-invite-${Date.now()}`,
        name,
        email,
        role,
        partSubmissions: 0,
        submissions24h: 0,
        actionCount: 0,
        lastSubmissionAt: null,
        inviteStatus: "pending",
        accountStatus: "active",
        lastSeenAt: null,
        lastActivityAt: null,
      },
    ]);
  }, []);

  const value: TeamDataValue = { members, updateRole, toggleAccountStatus, removeMember, resendInvite, inviteMember };

  return <TeamDataContext.Provider value={value}>{children}</TeamDataContext.Provider>;
}

export function useTeamData() {
  const ctx = useContext(TeamDataContext);
  if (!ctx) throw new Error("useTeamData must be used within TeamDataProvider");
  return ctx;
}
