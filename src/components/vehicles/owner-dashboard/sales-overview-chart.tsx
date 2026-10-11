"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cash } from "@/lib/mock/vehicles";
import type { SalesByDayPoint } from "@/lib/data/owner-dashboard";

const PERIODS = [
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
];

/** "Sales Overview" — a plain CSS/SVG bar chart (no new charting dependency; this app already hand-rolls its
 * one other chart, vehicles-by-stage-chart.tsx, the same way), over real daily totals from ownerSalesByDay. */
export function SalesOverviewChart({
  days,
  onDaysChange,
  points,
}: {
  days: number;
  onDaysChange: (days: number) => void;
  points: SalesByDayPoint[];
}) {
  const max = Math.max(1, ...points.map((p) => p.total));
  // Thin out labels so they don't collide at 30/90 days: show every Nth date.
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <div className="h-full rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Sales Overview</h3>
        <Select value={String(days)} onValueChange={(v) => onDaysChange(Number(v) || 7)}>
          <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Sales overview period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {points.some((p) => p.total > 0) ? (
        <div className="flex h-40 items-end gap-[3px]">
          {points.map((p, i) => (
            // h-full here matters: a percentage `height` only resolves against a parent with a definite
            // height, and without it this wrapper (a flex item with no height of its own) collapses to
            // 0, which collapsed the bar inside it to 0 too — no bars ever rendered, regardless of data.
            <div key={p.date} className="group relative h-full flex-1">
              <div
                className="absolute inset-x-0 bottom-0 w-full rounded-t-sm bg-primary transition-colors group-hover:bg-primary/80"
                style={{ height: `${Math.max(2, (p.total / max) * 100)}%` }}
                title={`${new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${cash(p.total)}`}
              />
              {i % labelEvery === 0 && (
                <span className="absolute top-full mt-1 block w-full truncate text-center text-[9px] text-muted-foreground">
                  {new Date(p.date).toLocaleDateString(undefined, { day: "numeric" })}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">No sales recorded in this period.</p>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        Total: <b className="text-foreground">{cash(points.reduce((s, p) => s + p.total, 0))}</b> over {points.length} days
      </p>
    </div>
  );
}
