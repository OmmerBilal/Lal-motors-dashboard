"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { User } from "@/lib/types";

const dateRanges = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "quarter", label: "This quarter" },
];

const locations = [
  { id: "all", label: "All Locations" },
  { id: "yard", label: "LAL Motors Yard" },
  { id: "auction", label: "Auction Lots" },
];

export function DashboardHeader({ user, notificationCount }: { user: User; notificationCount: number }) {
  const [range, setRange] = useState("week");
  const [location, setLocation] = useState("all");

  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Welcome, {user.name.split(" ")[0]}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Here&apos;s what&apos;s happening across LAL Motors today.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={range} onValueChange={(v) => setRange(v ?? "week")}>
          <SelectTrigger className="w-[140px]" aria-label="Date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dateRanges.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={location} onValueChange={(v) => setLocation(v ?? "all")}>
          <SelectTrigger className="w-[150px]" aria-label="Location">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          aria-label={`${notificationCount} notifications`}
          className="relative flex size-8 items-center justify-center rounded-md border border-border bg-card hover:bg-accent/40"
        >
          <Bell className="size-4" />
          {notificationCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
          <div className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {user.name[0]}
          </div>
          <span className="hidden text-sm font-medium sm:inline">{user.name}</span>
        </div>
      </div>
    </div>
  );
}
