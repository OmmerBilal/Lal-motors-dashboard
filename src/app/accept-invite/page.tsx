"use client";

import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";

/**
 * Invitation activation. The invite record exists in the database (team_invite_member), but the email link and the
 * password step run through the Supabase Auth invite flow, which is NOT CONNECTED. Until it is, this page makes no
 * claim that an account was activated and does not accept a password.
 */
function AcceptInviteInner() {
  return (
    <AuthCard title="Accept your invitation" description="Invitation activation is not connected yet.">
      <div className="mt-6 space-y-4">
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          Invitation activation — <b>NOT CONNECTED</b>. Your account is not activated by this page. Ask the owner to confirm your access.
        </p>
        <a href="/login" className="block">
          <Button variant="outline" className="w-full">Back to staff login</Button>
        </a>
      </div>
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
