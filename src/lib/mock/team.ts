import type { Role } from "@/lib/types";
import { mockUsers } from "@/lib/mock/users";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  partSubmissions: number;
  submissions24h: number;
  actionCount: number;
  lastSubmissionAt: string | null;
  inviteStatus: "accepted" | "pending";
  accountStatus: "active" | "disabled";
  lastSeenAt: string | null;
  lastActivityAt: string | null;
};

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

export const teamMembers: TeamMember[] = mockUsers.map((u, i) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  partSubmissions: u.role === "employee" ? 14 : 0,
  submissions24h: u.role === "employee" ? 2 : 0,
  actionCount: 20 + i * 6,
  lastSubmissionAt: u.role === "employee" ? daysAgo(0) : null,
  inviteStatus: "accepted",
  accountStatus: "active",
  lastSeenAt: daysAgo(i),
  lastActivityAt: daysAgo(i),
}));

export const pendingInvites: TeamMember[] = [
  {
    id: "u-pending-1",
    name: "Sofia Marin",
    email: "sofia@lalmotors.com",
    role: "manager",
    partSubmissions: 0,
    submissions24h: 0,
    actionCount: 0,
    lastSubmissionAt: null,
    inviteStatus: "pending",
    accountStatus: "active",
    lastSeenAt: null,
    lastActivityAt: null,
  },
];
