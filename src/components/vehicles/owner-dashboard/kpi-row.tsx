"use client";

import { CarFront, Cog, Container, Filter, Recycle } from "lucide-react";

export type KpiItem = { label: string; value: number | string; trend: string; icon: typeof CarFront };

export function KpiRow({ items }: { items: KpiItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-border bg-card p-4">
          <span className="flex size-9 items-center justify-center rounded-md bg-accent text-primary">
            <item.icon className="size-4" />
          </span>
          <p className="mt-2 text-2xl leading-none font-semibold tabular-nums">{item.value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{item.label}</p>
          <p className="mt-1 text-[11px] font-medium text-success">{item.trend}</p>
        </div>
      ))}
    </div>
  );
}

export const kpiIcons = { CarFront, Cog, Filter, Container, Recycle };
