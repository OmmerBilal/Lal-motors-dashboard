"use client";

import { Package } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import type { TopSellingPart } from "@/lib/data/owner-dashboard";

/** "Top Selling Parts (30 days)" — real units-sold ranking from sale_items/sales/parts (ownerTopSellingParts).
 * Shows an icon placeholder rather than a decoded photo (no signed-thumbnail resolution wired up in this pass). */
export function TopSellingParts({ parts }: { parts: TopSellingPart[] }) {
  return (
    <div className="h-full rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Top Selling Parts (30 days)</h3>
      {parts.length ? (
        <ol className="space-y-2">
          {parts.map((p, i) => (
            <li key={p.partId} className="flex items-center gap-3 rounded-lg bg-background px-3 py-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
                {i + 1}
              </span>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground">
                <Package className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
              <span className="shrink-0 text-right text-sm">
                <b className="tabular-nums">{p.quantity}</b> <span className="text-xs text-muted-foreground">sold</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon={Package} title="No parts sold in the last 30 days." />
      )}
    </div>
  );
}
