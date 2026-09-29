"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard } from "@/components/auth/auth-card";
import { pendingInvites } from "@/lib/mock/team";

function AcceptInviteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const invite = pendingInvites.find((i) => i.id === token) ?? pendingInvites[0];
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
    <AuthCard
      title="Accept your invitation"
      description={`Welcome ${invite?.name || "to LAL Motors"}. Create your password to activate your assigned account.`}
    >
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
          {busy ? "Please wait…" : "Activate account"}
        </Button>
      </form>
      <a href="/login" className="mt-4 block text-center text-sm font-medium text-primary hover:underline">
        Back to staff login
      </a>
    </AuthCard>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteInner />
    </Suspense>
  );
}
