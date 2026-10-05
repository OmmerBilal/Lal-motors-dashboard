"use client";

import { useState } from "react";
import { CarFront, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import type { User } from "@/lib/types";
import { AuctionInventoryHome } from "@/components/vehicles/views/auction-inventory-home";
import { usePendingBatches, usePendingCompletions, useRecentVehicleEvents, useVehicleLookup } from "@/lib/query/vehicle-workspace";
import type { IntakeMethod } from "@/components/vehicles/vehicle-workspace";

/**
 * Vehicles home for intake roles. Every figure and list here is read from the database on demand:
 * KPIs and the vehicle list come from AuctionInventoryHome, and the panels below are small, paged reads.
 */
export function HomeView({
  canIntake,
  onOpenVehicle,
  onStartIntake,
  onGoList,
  onGoActivity,
  onGoCompletionReview,
}: {
  user: User;
  canIntake: boolean;
  onOpenVehicle: (id: string) => void;
  onStartIntake: (method: IntakeMethod) => void;
  onGoList: (filter: string) => void;
  onGoActivity: (actorId?: string, kind?: string) => void;
  onGoCompletionReview: () => void;
  onGoCompletionGroup: (period: "week" | "month", employeeId?: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const completions = usePendingCompletions();
  const batches = usePendingBatches();
  const recent = useRecentVehicleEvents();
  const lookup = useVehicleLookup(submitted);
  const recentEvents = (recent.data?.pages[0] ?? []).slice(0, 8);
  const pendingCount = completions.data?.length ?? 0;

  function runLookup() {
    setSubmitted(search.trim());
  }

  if (!canIntake) {
    return <EmptyState icon={CarFront} title="No vehicle workspace for this role" description="Ask an owner or manager for access." />;
  }

  return (
    <div className="space-y-6">
      <AuctionInventoryHome onOpenVehicle={onOpenVehicle} onStartIntake={onStartIntake} />

      <div className="border-t border-border pt-1" />

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">What needs my action?</h3>
        <Button className="mb-3 w-full justify-start sm:w-auto" onClick={onGoCompletionReview}>
          Vehicles waiting for completion review · {completions.isPending ? "…" : pendingCount}
        </Button>
        <form
          className="flex max-w-xl items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            runLookup();
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="Find existing vehicle by VIN, lot or stock"
              placeholder="VIN, Lot # or Stock # (at least 3 characters)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background pl-9 text-sm"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={search.trim().length < 3}>
            Find existing vehicle
          </Button>
        </form>
        {submitted.length >= 3 && (
          <div className="mt-3 space-y-2" role="status" aria-live="polite">
            {lookup.isPending && <p className="text-sm text-muted-foreground">Searching…</p>}
            {lookup.isError && <p role="alert" className="text-sm text-destructive">The search could not run. Try again.</p>}
            {lookup.isSuccess && lookup.data.length === 0 && <p className="text-sm text-muted-foreground">No matching vehicle record found.</p>}
            {lookup.isSuccess &&
              lookup.data.map((row) => (
                <button
                  key={row.id}
                  onClick={() => onOpenVehicle(row.id)}
                  className="flex w-full items-center gap-3 rounded-md bg-background p-2 text-left hover:bg-accent/40"
                >
                  <CarFront className="size-5 text-primary" />
                  <span className="min-w-0">
                    <b className="block truncate text-sm">{[row.year, row.make, row.model].filter(Boolean).join(" ") || "Vehicle"}</b>
                    <small className="text-xs text-muted-foreground">
                      VIN {row.vin || "—"} · Lot {row.lot_number || "—"} · Stock {row.stock_number || "—"}
                    </small>
                  </span>
                  <em className="ml-auto shrink-0 text-xs font-medium text-primary not-italic">Open same record</em>
                </button>
              ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Intake batches needing review</h3>
        {batches.isPending && <p className="text-sm text-muted-foreground">Loading batches…</p>}
        {batches.isError && <p role="alert" className="text-sm text-destructive">Batches could not be loaded.</p>}
        {batches.isSuccess && batches.data.length === 0 && <p className="text-sm text-muted-foreground">No pending intake batches.</p>}
        {batches.isSuccess && batches.data.length > 0 && (
          <div className="space-y-1.5">
            {batches.data.slice(0, 8).map((b) => (
              <button
                key={b.id}
                onClick={() => onStartIntake(b.method)}
                className="block w-full rounded-md bg-muted/40 px-3 py-2 text-left text-sm hover:bg-accent/40"
              >
                <b>{b.method.toUpperCase()}</b> · {new Date(b.created_at).toLocaleString()} · Open intake
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Recent activity</h3>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onGoActivity()}>
            View activity
          </Button>
        </div>
        {recent.isPending && <p className="text-sm text-muted-foreground">Loading activity…</p>}
        {recent.isError && <p role="alert" className="text-sm text-destructive">Activity could not be loaded.</p>}
        {recent.isSuccess && recentEvents.length === 0 && <p className="text-sm text-muted-foreground">No vehicle actions recorded yet.</p>}
        {recentEvents.length > 0 && (
          <div className="space-y-1.5">
            {recentEvents.map((e) => (
              <button
                key={e.id}
                onClick={() => onOpenVehicle(e.vehicle_id)}
                className="block w-full rounded-md bg-muted/40 px-3 py-2 text-left text-sm hover:bg-accent/40"
              >
                <b>{e.action.replaceAll("_", " ")}</b> · {e.actor_name ?? "Unknown"} · {new Date(e.created_at).toLocaleString()}
              </button>
            ))}
          </div>
        )}
      </section>

      <Button className="w-full" variant="secondary" onClick={() => onGoList("active")}>
        Search vehicles
      </Button>
    </div>
  );
}
