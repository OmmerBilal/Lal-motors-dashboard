"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mockUsers } from "@/lib/mock/users";
import { roleLabels } from "@/lib/types";
import { useSession } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const { setUserId } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function signInAs(id: string) {
    setUserId(id);
    const match = mockUsers.find((u) => u.id === id);
    router.push(match?.role === "owner" ? "/dashboard" : "/vehicles");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const match = mockUsers.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!match) {
      setError("No matching staff account. Choose a demo account below instead.");
      return;
    }
    signInAs(match.id);
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
            <Button type="submit" className="w-full">
              Log in
            </Button>
          </form>
        </div>
        <div className="rounded-xl border border-dashed border-border bg-card/60 p-5">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Demo accounts · UI preview only
          </p>
          <div className="mt-3 grid gap-1.5">
            {mockUsers.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => signInAs(u.id)}
                className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="font-medium">{u.name}</span>
                <span className="text-xs text-muted-foreground">{roleLabels[u.role]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
