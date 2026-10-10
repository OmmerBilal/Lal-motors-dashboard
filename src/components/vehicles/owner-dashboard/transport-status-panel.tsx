"use client";

import { CalendarCheck2, PackageCheck, Truck, Warehouse } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type TransportStatusCounts = { inTransit: number; arrivingToday: number; atYard: number; dispatched: number };

const rows: { key: keyof TransportStatusCounts; label: string; icon: LucideIcon; color: string }[] = [
  { key: "inTransit", label: "In Transit", icon: Truck, color: "text-primary" },
  { key: "arrivingToday", label: "Arriving Today", icon: CalendarCheck2, color: "text-warning-foreground" },
  { key: "atYard", label: "At Yard", icon: Warehouse, color: "text-success" },
  { key: "dispatched", label: "Dispatched", icon: PackageCheck, color: "text-violet-600 dark:text-violet-400" },
];

/** "Transport Status" — real counts from dispatch_stage_counts (In Transit / Dispatched = assigned-to-carrier /
 * At Yard = arrived) and vehicles_arrived_today_count (Arriving Today). */
export function TransportStatusPanel({ counts }: { counts: TransportStatusCounts }) {
  return (
    <div className="h-full rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Transport Status</h3>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 rounded-lg bg-background px-3 py-2.5">
            <r.icon className={`size-4.5 shrink-0 ${r.color}`} />
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">{r.label}</span>
            <b className="text-lg tabular-nums">{counts[r.key]}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
