"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTeamMutations } from "@/lib/query/team";
import type { Role } from "@/lib/types";

const inviteRoles: { value: Role; label: string }[] = [
  { value: "engineer_admin", label: "Engineer Admin" },
  { value: "manager", label: "Front Desk Manager" },
  { value: "employee", label: "Warehouse Employee" },
  { value: "auction", label: "Auction Vehicle Employee" },
  { value: "scrap_driver", label: "Scrap Driver" },
];

export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { invite } = useTeamMutations();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  function send() {
    invite.mutate(
      { email: email.trim(), name: name.trim(), roleKey: role, requestId },
      {
        onSuccess: () => {
          toast.success("Invitation recorded. Email delivery is not connected, so no email was sent.");
          setName("");
          setEmail("");
          setRole("employee");
          setRequestId(crypto.randomUUID());
          onOpenChange(false);
        },
        onError: (e) => toast.error(e.message),
      }
    );
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
            The invitation is recorded now. Email delivery is NOT CONNECTED, so no email is sent. Share access manually until it is.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={invite.isPending || !name.trim() || !email.trim()} onClick={send}>
            {invite.isPending ? "Recording…" : "Record Invite"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
