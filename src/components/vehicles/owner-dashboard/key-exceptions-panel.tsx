"use client";

import { AlertTriangle, FileWarning, Gem, Recycle, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <div className="flex-1 space-y-1">
        {rows.map((row) => {
          const Icon = rowIcon[row.id] ?? AlertTriangle;
          return (
            <button
              key={row.id}
              onClick={() => onSelect(row.id)}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent/40"
            >
              <Icon className="size-4 shrink-0 text-warning-foreground" />
              <span className="min-w-0 flex-1 text-sm">{row.label}</span>
              <b className="text-sm tabular-nums">{row.count}</b>
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
