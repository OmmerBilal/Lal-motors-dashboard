"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { roleLabels, type Role } from "@/lib/types";
import { TeamDataProvider, useTeamData } from "@/components/team/team-data-context";
import { InviteDialog } from "@/components/team/invite-dialog";
import { EmployeeDailyActivity } from "@/components/team/employee-daily-activity";

const editableRoles: { value: Role; label: string }[] = [
  { value: "engineer_admin", label: "Engineer Admin" },
  { value: "manager", label: "Front Desk Manager" },
  { value: "employee", label: "Warehouse Employee" },
  { value: "auction", label: "Auction Vehicle Employee" },
  { value: "yard", label: "Yard Employee" },
  { value: "scrap_driver", label: "Scrap Driver" },
];

function TeamBody() {
  const { members, updateRole, toggleAccountStatus, removeMember, resendInvite } = useTeamData();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [activityId, setActivityId] = useState<string | null>(null);

  const activeMember = activityId ? members.find((m) => m.id === activityId) : null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h3 className="text-sm font-semibold">Users, roles and employee activity</h3>
            <p className="text-xs text-muted-foreground">Owner-only controls. Every submission and operational action remains attributed.</p>
          </div>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <Plus /> Invite User
          </Button>
        </div>
        <div className="divide-y divide-border">
          {members.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {m.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <b className="block text-sm">{m.name}</b>
                <small className="block text-xs text-muted-foreground">{m.email}</small>
                <small className="block text-xs text-muted-foreground">
                  {m.partSubmissions} part captures · {m.submissions24h} in last 24 hours · {m.actionCount} logged actions
                </small>
                <small className="block text-xs text-muted-foreground">
                  {m.lastSubmissionAt ? `Last capture ${new Date(m.lastSubmissionAt).toLocaleString()}` : "No captures yet"}
                </small>
                <small className="block text-xs text-muted-foreground">
                  Invite: <b>{m.inviteStatus === "pending" ? "Pending" : "Accepted"}</b> · Account:{" "}
                  <b>{m.accountStatus === "disabled" ? "Disabled" : "Active"}</b>
                </small>
                <small className="block text-xs text-muted-foreground">
                  Last login: {m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleString() : "Not yet"} · Last activity:{" "}
                  {m.lastActivityAt ? new Date(m.lastActivityAt).toLocaleString() : "None"}
                </small>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {m.inviteStatus !== "pending" && (
                  <Button variant="outline" size="sm" onClick={() => setActivityId(m.id)}>
                    View daily activity
                  </Button>
                )}
                <Select value={m.role} disabled={m.role === "owner"} onValueChange={(v) => v && updateRole(m.id, v as Role)}>
                  <SelectTrigger className="w-[190px]" aria-label={`Role for ${m.name}`}>
                    <SelectValue>{roleLabels[m.role]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {m.role === "owner" && <SelectItem value="owner">Owner / Admin</SelectItem>}
                    {editableRoles.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {m.inviteStatus === "pending" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      resendInvite(m.id);
                      toast.success("Invitation resent and audited");
                    }}
                  >
                    Resend invite
                  </Button>
                )}
                {m.role !== "owner" && (
                  <>
                    <Button
                      variant={m.accountStatus === "disabled" ? "outline" : "destructive"}
                      size="sm"
                      onClick={() => {
                        toggleAccountStatus(m.id);
                        toast.success("Account updated and audited");
                      }}
                    >
                      {m.accountStatus === "disabled" ? "Enable" : "Disable"}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        if (!window.confirm("Remove this user's access? Their audit history will be preserved.")) return;
                        removeMember(m.id);
                        toast.success("Account updated and audited");
                      }}
                    >
                      Remove
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!members.length && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Users className="mx-auto mb-2 size-6" /> No team members yet.
            </div>
          )}
        </div>
      </div>

      {activeMember && <EmployeeDailyActivity member={activeMember} onClose={() => setActivityId(null)} />}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

export function TeamView() {
  return (
    <TeamDataProvider>
      <TeamBody />
    </TeamDataProvider>
  );
}
