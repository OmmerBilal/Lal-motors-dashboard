"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CarFront,
  ChevronRight,
  Cpu,
  Filter,
  Image as ImageIcon,
  Lightbulb,
  MoreHorizontal,
  RectangleHorizontal,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterPills } from "@/components/patterns/search-bar";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { useDismantlingProcessingData, type PeriodId } from "@/components/dismantling-processing/use-dismantling-data";
import {
  categoryBucket,
  categoryBucketLabels,
  categoryBucketOrder,
  detailedCategoryLabel,
} from "@/lib/mock/dismantling-processing";
import { PhotoGalleryDialog, type PhotoTile } from "@/components/dismantling-processing/photo-gallery-dialog";

const periods: { id: PeriodId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "custom", label: "Custom" },
];

const bucketIconClass: Record<string, string> = {
  Headlights: "bg-amber-500/10 text-amber-600",
  Converters: "bg-emerald-500/10 text-emerald-600",
  Modules: "bg-indigo-500/10 text-indigo-600",
  Bumpers: "bg-sky-500/10 text-sky-600",
  Other: "bg-muted text-muted-foreground",
};

const bucketIcon: Record<string, LucideIcon> = {
  Headlights: Lightbulb,
  Converters: Filter,
  Modules: Cpu,
  Bumpers: RectangleHorizontal,
  Other: MoreHorizontal,
};

export function EmployeeDetail({
  employeeId,
  employeeName,
  onBack,
  onOpenVehicle,
}: {
  employeeId: string;
  employeeName: string;
  onBack: () => void;
  onOpenVehicle: (vehicleId: string) => void;
}) {
  const { completionsForEmployee, partsForEmployee } = useDismantlingProcessingData();
  const [period, setPeriod] = useState<PeriodId>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [tab, setTab] = useState<"vehicles" | "parts">("vehicles");
  const [galleryOpen, setGalleryOpen] = useState(false);

  const vehicleCompletions = useMemo(
    () => completionsForEmployee(employeeId, period, { from: customFrom, to: customTo }),
    [completionsForEmployee, employeeId, period, customFrom, customTo]
  );
  const partsCaptured = useMemo(
    () => partsForEmployee(employeeId, period, { from: customFrom, to: customTo }),
    [partsForEmployee, employeeId, period, customFrom, customTo]
  );

  const bucketCounts = useMemo(() => {
    const counts: Record<string, number> = { Headlights: 0, Converters: 0, Modules: 0, Bumpers: 0, Other: 0 };
    for (const p of partsCaptured) {
      if (!p.partType) continue;
      counts[categoryBucket(p.partType)] += 1;
    }
    return counts;
  }, [partsCaptured]);

  const detailedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of partsCaptured) {
      if (!p.partType) continue;
      const label = detailedCategoryLabel(p.partType);
      counts[label] = (counts[label] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [partsCaptured]);

  const tiles: PhotoTile[] = [
    ...vehicleCompletions.map((c) => ({ id: `veh-${c.vehicle.id}`, label: `${c.vehicle.make} ${c.vehicle.model} photo`, kind: "vehicle" as const })),
    ...partsCaptured.map((p, i) => ({ id: p.id, label: p.partType || `Part photo ${i + 1}`, kind: "part" as const })),
  ];

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" /> Back
      </Button>

      <div className="flex items-center gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
          {employeeName.charAt(0)}
        </span>
        <div>
          <h3 className="text-xl font-bold">{employeeName}</h3>
          <p className="text-sm text-muted-foreground">
            {vehicleCompletions.length} car{vehicleCompletions.length === 1 ? "" : "s"} completed{" "}
            {period === "today" ? "today" : period === "week" ? "this week" : period === "month" ? "this month" : "in range"}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <FilterPills options={periods} value={period} onChange={(v) => setPeriod(v as PeriodId)} />
        {period === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-auto" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-auto" />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="button" size="sm" variant={tab === "vehicles" ? "default" : "outline"} className="flex-1 sm:flex-none" onClick={() => setTab("vehicles")}>
          Vehicles ({vehicleCompletions.length})
        </Button>
        <Button type="button" size="sm" variant={tab === "parts" ? "default" : "outline"} className="flex-1 sm:flex-none" onClick={() => setTab("parts")}>
          Parts Summary
        </Button>
      </div>

      {tab === "vehicles" && (
        <div className="space-y-2">
          {!vehicleCompletions.length && (
            <EmptyState icon={CarFront} title="No vehicles in range" description="This employee has no completed vehicles for the selected period." />
          )}
          {vehicleCompletions.map((c) => (
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
                </span>
                <span className="block text-xs text-muted-foreground">
                  VIN {c.vehicle.vin} · Stock {c.vehicle.stockNumber || c.vehicle.lotNumber || "—"} · {c.partsCount} parts
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {tab === "parts" && (
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Total Parts Pulled by {employeeName}</h4>
              <Button variant="outline" size="sm" onClick={() => setGalleryOpen(true)}>
                <ImageIcon className="size-4" /> View Photos
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {categoryBucketOrder.map((bucket) => {
                const Icon = bucketIcon[bucket];
                return (
                  <div key={bucket} className="rounded-lg border border-border bg-card p-3 text-center">
                    <span className={`mx-auto mb-1.5 flex size-9 items-center justify-center rounded-full ${bucketIconClass[bucket]}`}>
                      <Icon className="size-4" />
                    </span>
                    <p className="text-xl font-bold leading-none">{bucketCounts[bucket]}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{categoryBucketLabels[bucket]}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold">Part category breakdown</h4>
            {!detailedCounts.length && <p className="text-sm text-muted-foreground">No parts captured for this period.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {detailedCounts.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                  <span>{label}</span>
                  <b>{count}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <PhotoGalleryDialog open={galleryOpen} onOpenChange={setGalleryOpen} title={`${employeeName} — Photos`} tiles={tiles} />
    </div>
  );
}
