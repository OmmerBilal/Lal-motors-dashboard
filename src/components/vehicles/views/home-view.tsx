"use client";

import { useState } from "react";
import { Camera, CarFront, FileSearch, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MetricCard } from "@/components/patterns/metric-card";
import { EmptyState } from "@/components/patterns/empty-state";
import type { User } from "@/lib/types";
import { computeStats, statMetricLabels, vehicleTitle } from "@/lib/mock/vehicles";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";
import { EmployeeActivityPanel } from "@/components/vehicles/employee-activity-panel";
import type { IntakeMethod } from "@/components/vehicles/vehicle-workspace";

const intakeMethods: { id: IntakeMethod; label: string; description: string }[] = [
  { id: "bulk", label: "Bulk Paste", description: "Paste multiple vehicles" },
  { id: "single", label: "Single Vehicle Paste", description: "Paste one vehicle" },
  { id: "scan", label: "AI Photo / Screenshot Scan", description: "Upload or take a picture" },
  { id: "manual", label: "Manual Entry", description: "Enter without AI" },
];

const activityMetricEventType: Record<string, string> = {
  partsRemoved: "parts",
  converters: "converters",
  highValue: "highValue",
  exceptions: "exceptions",
};

export function HomeView({
  user,
  canIntake,
  isYard,
  onOpenVehicle,
  onStartIntake,
  onGoList,
  onGoActivity,
  onGoCompletionReview,
  onGoCompletionGroup,
}: {
  user: User;
  canIntake: boolean;
  isYard: boolean;
  onOpenVehicle: (id: string) => void;
  onStartIntake: (method: IntakeMethod) => void;
  onGoList: (filter: string) => void;
  onGoActivity: (actorId?: string, kind?: string) => void;
  onGoCompletionReview: () => void;
  onGoCompletionGroup: (period: "week" | "month", employeeId?: string) => void;
}) {
  const { vehicles, events, batches, completionQueue, corrections } = useVehicleData();
  const [completionSearch, setCompletionSearch] = useState("");
  const [lookupResult, setLookupResult] = useState<{ match: (typeof vehicles)[number] | null } | null>(null);

  const stats = computeStats(vehicles, user.role, events, completionQueue.length, corrections.length);
  const metricKeys = Object.keys(stats);
  const pendingBatches = batches.filter((b) => b.status !== "confirmed");

  function onMetricClick(key: string) {
    if (key === "completionWaiting") return onGoCompletionReview();
    if (key.startsWith("completed") && (user.role === "owner" || user.role === "engineer_admin")) {
      return onGoCompletionGroup(key === "completed_month" ? "month" : "week");
    }
    if (activityMetricEventType[key]) return onGoActivity(undefined, activityMetricEventType[key]);
    const filter =
      key === "total"
        ? "all"
        : key === "completedToday"
          ? "completedToday"
          : key === "overdue"
            ? "overdue"
            : key === "processing"
              ? "processing"
              : ["awaitingArrival", "readyForProcessing", "needsAttention"].includes(key)
                ? key
                : key.startsWith("completed")
                  ? "history"
                  : "active";
    onGoList(filter);
  }

  function runCompletionLookup() {
    const q = completionSearch.trim().toLowerCase();
    if (!q) return;
    const match =
      vehicles.find(
        (v) => v.vin.toLowerCase() === q || v.lotNumber.toLowerCase() === q || v.stockNumber.toLowerCase() === q
      ) ||
      vehicles.find(
        (v) =>
          v.vin.toLowerCase().includes(q) ||
          v.lotNumber.toLowerCase().includes(q) ||
          v.stockNumber.toLowerCase().includes(q)
      ) ||
      null;
    setLookupResult({ match });
  }

  return (
    <div className="space-y-6">
      {canIntake && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {intakeMethods.map((m) => (
            <button
              key={m.id}
              onClick={() => onStartIntake(m.id)}
              className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <Plus className="size-5 text-primary" />
              <span className="text-sm font-semibold">{m.label}</span>
              <span className="text-xs text-muted-foreground">{m.description}</span>
            </button>
          ))}
        </div>
      )}

      {isYard && (
        <button
          onClick={() => onGoList("active")}
          className="flex w-full flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/30 sm:max-w-xs"
        >
          <Search className="size-5 text-primary" />
          <span className="text-sm font-semibold">Find a vehicle</span>
          <span className="text-xs text-muted-foreground">Search VIN, lot or stock #</span>
        </button>
      )}

      {isYard && corrections.length > 0 && (
        <section className="rounded-lg border border-warning/40 bg-warning/10 p-4">
          <h3 className="mb-2 text-sm font-semibold">Completion needs correction · {corrections.length}</h3>
          <div className="space-y-1.5">
            {corrections.map((c) => (
              <button
                key={c.submissionId}
                onClick={() => onOpenVehicle(c.vehicleId)}
                className="block w-full rounded-md bg-background px-3 py-2 text-left text-sm hover:bg-accent/40"
              >
                <b>{vehicleTitle(c)}</b> · Lot {c.lotNumber || "—"} · {c.reason} · Open vehicle and resubmit
              </button>
            ))}
          </div>
        </section>
      )}

      {canIntake && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">What needs my action?</h3>
          <Button className="mb-3 w-full justify-start sm:w-auto" onClick={onGoCompletionReview}>
            Vehicles waiting for completion review · {completionQueue.length}
          </Button>
          <div className="flex max-w-xl items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="Find existing vehicle for completion"
                placeholder="Paste Lot #, VIN or Stock # to find existing vehicle"
                value={completionSearch}
                onChange={(e) => setCompletionSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onGoList("all")}
                className="h-9 w-full rounded-md border border-input bg-background pl-9 text-sm"
              />
            </div>
            <Button type="button" variant="secondary" onClick={() => onGoList("all")}>
              Find existing vehicle
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Open the matching record, attach completion evidence, then verify it in the review queue.
          </p>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {metricKeys.map((key) => (
          <MetricCard
            key={key}
            label={statMetricLabels[key] || key}
            value={key === "completionWaiting" ? completionQueue.length : stats[key] ?? 0}
            onClick={() => onMetricClick(key)}
          />
        ))}
      </div>

      {canIntake && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Intake batches needing review</h3>
          {pendingBatches.length ? (
            <div className="space-y-1.5">
              {pendingBatches.slice(0, 8).map((b) => (
                <button
                  key={b.id}
                  onClick={() => onStartIntake(b.method)}
                  className="block w-full rounded-md bg-muted/40 px-3 py-2 text-left text-sm hover:bg-accent/40"
                >
                  <b>{b.method.toUpperCase()}</b> · {b.vehicleCount} vehicle(s) ·{" "}
                  {new Date(b.createdAt).toLocaleString()} · Open review
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No pending intake batches.</p>
          )}
        </section>
      )}

      {canIntake && (
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Recent activity</h3>
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onGoActivity()}>
              View activity
            </Button>
          </div>
          {events.length ? (
            <div className="space-y-1.5">
              {events.slice(0, 8).map((e) => (
                <button
                  key={e.id}
                  onClick={() => onOpenVehicle(e.vehicleId)}
                  className="block w-full rounded-md bg-muted/40 px-3 py-2 text-left text-sm hover:bg-accent/40"
                >
                  <b>{e.action.replaceAll("_", " ")}</b> · {e.actorName} ·{" "}
                  {new Date(e.createdAt).toLocaleString()}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No vehicle actions recorded yet.</p>
          )}
        </section>
      )}

      {user.role === "owner" && <EmployeeActivityPanel onOpenVehicle={onOpenVehicle} />}

      {canIntake && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-1 text-sm font-semibold">Completion evidence lookup</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Paste a VIN, Lot or Stock #, or attach the employee&apos;s completion photo. AI reads the evidence
            and searches existing vehicle records only.
          </p>
          <Label className="sr-only" htmlFor="completion-lookup">
            Paste vehicle completion information
          </Label>
          <Textarea
            id="completion-lookup"
            rows={3}
            placeholder="Paste a VIN, Lot #, Stock # or completion note"
            value={completionSearch}
            onChange={(e) => {
              setCompletionSearch(e.target.value);
              setLookupResult(null);
            }}
          />
          <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-primary">
            <Camera className="size-4" /> Completion photo / screenshot
            <input type="file" accept="image/*" className="hidden" onChange={() => setLookupResult(null)} />
          </label>
          <Button className="mt-3" disabled={!completionSearch.trim()} onClick={runCompletionLookup}>
            <FileSearch /> Find matching existing vehicle
          </Button>
          {lookupResult && (
            <div className="mt-3 rounded-md border border-border bg-muted/30 p-3" role="status">
              {lookupResult.match ? (
                <button
                  onClick={() => onOpenVehicle(lookupResult.match!.id)}
                  className="flex w-full items-center gap-3 rounded-md bg-background p-2 text-left hover:bg-accent/40"
                >
                  <CarFront className="size-5 text-primary" />
                  <span>
                    <b className="block text-sm">{vehicleTitle(lookupResult.match)}</b>
                    <small className="text-xs text-muted-foreground">
                      VIN {lookupResult.match.vin || "—"} · Lot {lookupResult.match.lotNumber || "—"} · Stock{" "}
                      {lookupResult.match.stockNumber || "—"}
                    </small>
                  </span>
                  <em className="ml-auto text-xs font-medium text-primary not-italic">Open same record</em>
                </button>
              ) : (
                <p className="text-sm text-muted-foreground">No matching vehicle record found.</p>
              )}
            </div>
          )}
        </section>
      )}

      {!canIntake && !events.length && (
        <EmptyState icon={CarFront} title="No vehicle activity yet" description="Actions you record will appear here." />
      )}

      <Button className="w-full" variant="secondary" onClick={() => onGoList("active")}>
        Search vehicles
      </Button>
    </div>
  );
}
