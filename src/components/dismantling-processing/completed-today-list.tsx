"use client";

import { useState } from "react";
import { ArrowLeft, CarFront, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { useDismantlingProcessingData } from "@/components/dismantling-processing/use-dismantling-data";

export function CompletedTodayList({ onBack, onOpenVehicle }: { onBack: () => void; onOpenVehicle: (vehicleId: string) => void }) {
  const { completedToday } = useDismantlingProcessingData();
  const [query, setQuery] = useState("");

  const filtered = completedToday.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.vehicle.vin.toLowerCase().includes(q) ||
      c.vehicle.stockNumber.toLowerCase().includes(q) ||
      c.vehicle.lotNumber.toLowerCase().includes(q) ||
      c.vehicle.make.toLowerCase().includes(q) ||
      c.vehicle.model.toLowerCase().includes(q) ||
      c.employeeName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" /> Back
      </Button>

      <div>
        <h3 className="text-lg font-semibold">Completed Today</h3>
        <p className="text-sm text-muted-foreground">
          {completedToday.length} vehicle{completedToday.length === 1 ? "" : "s"} completed today.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search VIN, stock #, employee..." className="pl-9" />
      </div>

      {!filtered.length && <EmptyState icon={CarFront} title="No vehicles found" description="No completed vehicles match this search." />}

      <div className="space-y-2">
        {filtered.map((c) => (
          <button
            key={c.vehicle.id}
            onClick={() => onOpenVehicle(c.vehicle.id)}
            className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40"
          >
            <span className="flex aspect-[4/3] w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground">
              <CarFront className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <b className="text-sm">
                  {c.vehicle.year} {c.vehicle.make} {c.vehicle.model}
                </b>
                <StatusBadge tone="success">Completed</StatusBadge>
                {c.reviewCount > 0 && <StatusBadge tone="warning">{`${c.reviewCount} needs review`}</StatusBadge>}
              </span>
              <span className="block text-xs text-muted-foreground">
                VIN {c.vehicle.vin} · Stock {c.vehicle.stockNumber || c.vehicle.lotNumber || "—"} · Dismantled by {c.employeeName}
              </span>
              <span className="block text-xs text-muted-foreground">
                Completed {new Date(c.completedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} ·{" "}
                {c.partsCount} parts captured · {c.approvedPartsCount} approved
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
