"use client";

import { cn } from "cn";
import { Button } from "@/components/ui/button";

export function DriverCard({
  name,
  loadsToday,
  totalWeight,
  totalAmount,
  active,
  onViewLoads,
}: {
  name: string;
  loadsToday: number;
  totalWeight: number;
  totalAmount: number;
  active: boolean;
  onViewLoads: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border bg-card p-4 text-center shadow-xs transition-colors",
        active ? "border-primary/60 ring-1 ring-primary/30" : "border-border"
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
        {name
          .split(" ")
          .map((p) => p[0])
          .slice(0, 2)
          .join("")}
      </div>
      <p className="mt-1 text-sm font-semibold">{name}</p>
      <p className="text-lg leading-none font-semibold tabular-nums">{loadsToday}</p>
      <p className="text-[11px] text-muted-foreground">Loads Today</p>
      <p className="text-xs text-muted-foreground">
        {totalWeight.toLocaleString()} lbs · ${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
      <Button size="sm" variant={active ? "default" : "outline"} className="mt-2 w-full" onClick={onViewLoads}>
        View Loads
      </Button>
    </div>
  );
}
