"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reason = searchParams.get("reason");
  const reasonMessage =
    reason === "disabled"
      ? "This account is disabled. Contact an administrator."
      : reason === "no-role"
        ? "Your account has no role assigned yet. Contact an administrator."
        : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setSubmitting(false);
      setError("Invalid email or password.");
      return;
    }

    const next = searchParams.get("next");
    router.push(next && next.startsWith("/") ? next : "/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-brand text-lg font-bold text-brand-foreground">
              L
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide">LAL MOTORS</p>
              <p className="text-[10px] font-medium tracking-[0.15em] text-muted-foreground uppercase">
                Staff Access
              </p>
            </div>
          </div>
          <h1 className="text-xl font-semibold">Staff login</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use your LAL Motors employee email and password.
          </p>
          {reasonMessage && (
            <p role="alert" className="mt-4 text-sm font-medium text-destructive">
              {reasonMessage}
            </p>
          )}
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Logging in…" : "Log in"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
