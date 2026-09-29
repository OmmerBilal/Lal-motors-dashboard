import type { ReactNode } from "react";

export function AuthCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-brand text-lg font-bold text-brand-foreground">L</div>
            <div>
              <p className="text-sm font-semibold tracking-wide">LAL MOTORS</p>
              <p className="text-[10px] font-medium tracking-[0.15em] text-muted-foreground uppercase">Staff Access</p>
            </div>
          </div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          {children}
        </div>
      </div>
    </main>
  );
}
