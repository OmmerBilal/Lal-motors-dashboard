"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { homeForRole } from "@/lib/auth/route-access";
import type { Role } from "@/lib/types";

const MIN_PASSWORD_LENGTH = 8;

/**
 * Mandatory first-login screen for accounts the owner just created with a temporary password
 * (profiles.must_change_password = true). SessionGate renders only this — nothing else in the
 * app, no nav, no back button — until the password is actually changed; there is no skip path.
 */
export function ForcedPasswordChange({ role, onDone }: { role: Role; onDone: () => void }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (submitting) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);
      const { error: clearError } = await supabase.rpc("clear_must_change_password");
      if (clearError) throw new Error(clearError.message);
      toast.success("Password set.");
      onDone();
      router.replace(homeForRole(role));
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Could not set your password. Try again.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <h1 className="text-lg font-semibold">Set a new password</h1>
          <p className="text-sm text-muted-foreground">
            This account was created for you with a temporary password. Choose a new password before continuing.
          </p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input
              type="password"
              autoFocus
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm password</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button className="w-full" disabled={submitting || !password || !confirm} onClick={submit}>
          {submitting ? "Saving…" : "Set password and continue"}
        </Button>
      </div>
    </div>
  );
}
