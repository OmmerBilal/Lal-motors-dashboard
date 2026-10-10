"use client";

import { useEffect, useState } from "react";
import { Bell, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { roleLabels, type User } from "@/lib/types";

/**
 * Top bar: a wide global search (visual only in this pass — no cross-entity search RPC exists yet to wire it
 * to; see the project guide), a notifications bell with the real count, the signed-in user's avatar/name/role,
 * and a live clock. Replaces the previous date-range + fake location-filter header; the date-ranged KPIs that
 * header drove are not part of the new 6-tile layout (see owner-dashboard.tsx), so no range picker is needed here.
 */
export function DashboardHeader({ user, notificationCount }: { user: User; notificationCount: number }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="relative min-w-[200px] flex-1 sm:max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search vehicles, parts, customers…" className="h-10 pl-9" aria-label="Global search" />
      </div>

      <div className="flex items-center gap-3">
        {now && (
          <span className="hidden text-sm text-muted-foreground md:block" suppressHydrationWarning>
            {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ·{" "}
            {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
        )}
        <button
          type="button"
          aria-label={`${notificationCount} notifications`}
          className="relative flex size-10 items-center justify-center rounded-full border border-border bg-background hover:bg-accent/40"
        >
          <Bell className="size-4.5" />
          {notificationCount > 0 && (
            <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2 rounded-full border border-border bg-background py-1 pr-3 pl-1">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {user.name.charAt(0)}
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block text-sm font-medium leading-tight">{user.name}</span>
            <span className="block text-[11px] leading-tight text-muted-foreground">{roleLabels[user.role]}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
