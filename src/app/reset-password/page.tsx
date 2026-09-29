"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard } from "@/components/auth/auth-card";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    window.setTimeout(() => {
      router.push("/login");
    }, 300);
  }

  return (
    <AuthCard title="Reset your password" description="Choose a new password for your existing account.">
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <small className="text-xs text-muted-foreground">At least 12 characters, including letters and numbers.</small>
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Please wait…" : "Save new password"}
        </Button>
      </form>
      <a href="/login" className="mt-4 block text-center text-sm font-medium text-primary hover:underline">
        Back to staff login
      </a>
    </AuthCard>
  );
}
