"use client";

import { AlertTriangle, FileWarning, Gem, Recycle, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { cn } from "cn";
import type { ExceptionRow } from "@/lib/mock/owner-dashboard";

const rowIcon: Record<string, typeof AlertTriangle> = {
  overdue: AlertTriangle,
  needsAttention: FileWarning,
  highValue: Gem,
  converters: Recycle,
  awaitingDispatch: Truck,
};

/** "Recent Alerts" — the real exception counts from owner_dashboard_summary. These are live snapshot counts,
 * not individually timestamped events, so each row shows a real description instead of a fabricated time-ago. */
export function KeyExceptionsPanel({ rows, onSelect, onViewAll }: { rows: ExceptionRow[]; onSelect: (id: string) => void; onViewAll: () => void }) {
  const active = rows.filter((r) => r.count > 0);
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Recent Alerts</h3>
      {active.length ? (
        <div className="flex-1 space-y-2">
          {active.map((row) => {
            const Icon = rowIcon[row.id] ?? AlertTriangle;
            const critical = row.severity === "critical";
            return (
              <button
                key={row.id}
                onClick={() => onSelect(row.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  critical ? "border-destructive/25 bg-destructive/8 hover:bg-destructive/12" : "border-warning/30 bg-warning/10 hover:bg-warning/15"
                )}
              >
                <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", critical ? "bg-destructive/15 text-destructive" : "bg-warning/20 text-warning-foreground")}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{row.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.count} {row.count === 1 ? "item needs attention" : "items need attention"}
                  </span>
                </span>
                <b className={cn("text-lg tabular-nums", critical ? "text-destructive" : "text-warning-foreground")}>{row.count}</b>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex-1">
          <EmptyState icon={FileWarning} title="No alerts right now." />
        </div>
      )}
      <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={onViewAll}>
        View All
      </Button>
    </div>
  );
}
