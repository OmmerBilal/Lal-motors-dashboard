"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTeamData } from "@/components/team/team-data-context";
import type { Role } from "@/lib/types";

const inviteRoles: { value: Role; label: string }[] = [
  { value: "engineer_admin", label: "Engineer Admin" },
  { value: "manager", label: "Front Desk Manager" },
  { value: "employee", label: "Warehouse Employee" },
  { value: "auction", label: "Auction Vehicle Employee" },
  { value: "yard", label: "Yard Employee" },
  { value: "scrap_driver", label: "Scrap Driver" },
];

export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { inviteMember } = useTeamData();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [sending, setSending] = useState(false);

  function send() {
    setSending(true);
    window.setTimeout(() => {
      inviteMember(name, email, role);
      setSending(false);
      setName("");
      setEmail("");
      setRole("employee");
      onOpenChange(false);
      toast.success("Invitation email sent");
    }, 300);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole((v as Role) ?? "employee")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {inviteRoles.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            We will email an invitation link. The employee will create a password and log in with their LAL Motors email.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={sending || !name.trim() || !email.trim()} onClick={send}>
            {sending ? "Sending…" : "Send Invite"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
