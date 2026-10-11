"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTeamMutations } from "@/lib/query/team";
import { ASSIGNABLE_ROLES, roleLabels, type Role } from "@/lib/types";

const MIN_PASSWORD_LENGTH = 8;

/**
 * Owner creates a real login directly: name, email, a temporary password they choose, and a role.
 * There is no invite email — the owner hands the password to the employee, who is forced to set
 * their own on first sign-in (profiles.must_change_password, cleared by ForcedPasswordChange).
 */
export function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { createUser } = useTeamMutations();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("employee");

  function reset() {
    setName("");
    setEmail("");
    setPassword("");
    setRole("employee");
  }

  function send() {
    createUser.mutate(
      { name: name.trim(), email: email.trim(), password, role },
      {
        onSuccess: (result) => {
          toast.success(
            `Account created for ${result.name} (${result.email}) as ${roleLabels[result.role as Role] ?? result.role}. ` +
              `Share the login with the employee — they'll be asked to set a new password on first login.`,
          );
          reset();
          onOpenChange(false);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  const canSubmit = name.trim().length >= 2 && email.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
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
            <Label>Password</Label>
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters. Share it with the employee directly.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole((v as Role) ?? "employee")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLabels[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            The account is created immediately with this password. The employee will be asked to set their own password the first time they log in.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={createUser.isPending || !canSubmit} onClick={send}>
            {createUser.isPending ? "Creating…" : "Create user"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
