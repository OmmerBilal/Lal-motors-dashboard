"use client";

import { AlertTriangle, FileWarning, Gem, Recycle, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { ExceptionRow } from "@/lib/mock/owner-dashboard";

const rowIcon: Record<string, typeof AlertTriangle> = {
  overdue: AlertTriangle,
  needsAttention: FileWarning,
  highValue: Gem,
  converters: Recycle,
  awaitingDispatch: Truck,
};

export function KeyExceptionsPanel({ rows, onSelect, onViewAll }: { rows: ExceptionRow[]; onSelect: (id: string) => void; onViewAll: () => void }) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Key Exceptions</h3>
      </div>
      <div className="flex-1 space-y-1.5">
        {rows.map((row) => {
          const Icon = rowIcon[row.id] ?? AlertTriangle;
          const critical = row.severity === "critical" && row.count > 0;
          const warning = row.severity === "warning" && row.count > 0;
          return (
            <button
              key={row.id}
              onClick={() => onSelect(row.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                critical
                  ? "border-destructive/25 bg-destructive/8 hover:bg-destructive/12"
                  : warning
                    ? "border-warning/30 bg-warning/10 hover:bg-warning/15"
                    : "border-transparent hover:bg-accent/40"
              )}
            >
              <Icon className={cn("size-4 shrink-0", critical ? "text-destructive" : warning ? "text-warning-foreground" : "text-muted-foreground")} />
              <span className="min-w-0 flex-1 text-sm">{row.label}</span>
              <b className={cn("text-sm tabular-nums", critical ? "text-destructive" : warning ? "text-warning-foreground" : "text-foreground")}>
                {row.count}
              </b>
            </button>
          );
        })}
      </div>
      <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={onViewAll}>
        View All
      </Button>
    </div>
  );
}
