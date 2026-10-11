"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ASSIGNABLE_ROLES, roleLabels, type Role } from "@/lib/types";
import { useEmployeeActivity, useTeamInvites, useTeamMembers, useTeamMutations } from "@/lib/query/team";
import { CreateUserDialog } from "@/components/team/create-user-dialog";
import { EmployeeDailyActivity } from "@/components/team/employee-daily-activity";
import { yardDay } from "@/components/scrap/scrap-shared";

/** Owner team page. Members, roles and statuses are the real profile and role rows; every change is an audited RPC. */
export function TeamView() {
  const members = useTeamMembers();
  const invites = useTeamInvites();
  const activity = useEmployeeActivity(yardDay(6), yardDay());
  const { setRole, setStatus, remove, cancelInvite } = useTeamMutations();
  const [createOpen, setCreateOpen] = useState(false);
  const [activityId, setActivityId] = useState<string | null>(null);

  const countsById = useMemo(() => new Map((activity.data ?? []).map((a) => [a.profile_id, a])), [activity.data]);
  const rows = members.data ?? [];
  const activeMember = activityId ? rows.find((m) => m.id === activityId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h3 className="text-sm font-semibold">Users, roles and employee activity</h3>
            <p className="text-xs text-muted-foreground">Owner-only controls. Activity counts cover the last 7 days.</p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> Create user
          </Button>
        </div>

        {members.isPending && <p className="p-6 text-sm text-muted-foreground">Loading team…</p>}
        {members.isError && <p className="p-6 text-sm text-destructive">{members.error.message}</p>}
        <div className="divide-y divide-border">
          {rows.map((m) => {
            const c = countsById.get(m.id);
            const role = (m.roles[0] ?? "") as Role;
            const isOwner = m.roles.includes("owner");
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {m.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <b className="block text-sm">{m.name}</b>
                  <small className="block text-xs text-muted-foreground">{m.email}</small>
                  <small className="block text-xs text-muted-foreground">
                    Account: <b>{m.account_status === "active" ? "Active" : m.account_status === "disabled" ? "Disabled" : "Removed"}</b> · Last seen:{" "}
                    {m.last_seen_at ? new Date(m.last_seen_at).toLocaleString() : "Not yet"}
                  </small>
                  {c && (
                    <small className="block text-xs text-muted-foreground">
                      {c.parts_captured} parts captured · {c.vehicle_events} vehicle actions · {c.scrap_loads} scrap loads · {c.container_actions} container actions
                    </small>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setActivityId(m.id)}>
                    View daily activity
                  </Button>
                  {!isOwner && (
                    <Select
                      value={role}
                      onValueChange={(v) => v && setRole.mutate({ id: m.id, role: v }, { onSuccess: () => toast.success("Role updated."), onError: (e) => toast.error(e.message) })}
                    >
                      <SelectTrigger className="w-[190px]" aria-label={`Role for ${m.name}`}>
                        <SelectValue>{roleLabels[role] ?? role}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {roleLabels[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {!isOwner && m.account_status !== "removed" && (
                    <>
                      <Button
                        variant={m.account_status === "disabled" ? "outline" : "destructive"}
                        size="sm"
                        disabled={setStatus.isPending}
                        onClick={() =>
                          setStatus.mutate(
                            { id: m.id, status: m.account_status === "disabled" ? "active" : "disabled" },
                            { onSuccess: () => toast.success("Account updated."), onError: (e) => toast.error(e.message) }
                          )
                        }
                      >
                        {m.account_status === "disabled" ? "Enable" : "Disable"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() => {
                          const reason = window.prompt("Reason for removing this user's access (their audit history is kept):") ?? "";
                          if (reason.trim().length < 5) {
                            if (reason) toast.error("A reason of at least 5 characters is required. Nothing was changed.");
                            return;
                          }
                          remove.mutate({ id: m.id, reason }, { onSuccess: () => toast.success("Access removed. History is kept."), onError: (e) => toast.error(e.message) });
                        }}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {members.isSuccess && !rows.length && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Users className="mx-auto mb-2 size-6" /> No team members yet.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-4">
          <h3 className="text-sm font-semibold">Pending invitations</h3>
          <p className="text-xs text-muted-foreground">
            Legacy invitations created before accounts could be created directly above. Cancel any you no longer need.
          </p>
        </div>
        {invites.isPending && <p className="p-4 text-sm text-muted-foreground">Loading invitations…</p>}
        {invites.isError && <p className="p-4 text-sm text-destructive">{invites.error.message}</p>}
        {invites.isSuccess && !invites.data.length && <p className="p-4 text-sm text-muted-foreground">No pending invitations.</p>}
        <div className="divide-y divide-border">
          {(invites.data ?? []).map((i) => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <b className="block text-sm">{i.name}</b>
                <small className="block text-xs text-muted-foreground">{i.email} · {roleLabels[i.role as Role] ?? i.role}</small>
                <small className="block text-xs text-muted-foreground">Invited {new Date(i.invited_at).toLocaleString()} by {i.invited_by_name}</small>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={cancelInvite.isPending}
                onClick={() => cancelInvite.mutate(i.id, { onSuccess: () => toast.success("Invitation cancelled."), onError: (e) => toast.error(e.message) })}
              >
                Cancel invite
              </Button>
            </div>
          ))}
        </div>
      </div>

      {activeMember && <EmployeeDailyActivity member={{ id: activeMember.id, name: activeMember.name }} onClose={() => setActivityId(null)} />}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
