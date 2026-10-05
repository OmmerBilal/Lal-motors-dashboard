"use client";

import { useState } from "react";
import { CarFront } from "lucide-react";
import { SearchBar, FilterPills } from "@/components/patterns/search-bar";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/status-badge";
import type { VehicleStage } from "@/lib/data/vehicles";
import { useVehicleList } from "@/lib/query/vehicles";

/** Stage filters the database understands. "all" lists every vehicle, closed ones included. */
const filters: { id: "all" | VehicleStage; label: string }[] = [
  { id: "all", label: "all" },
  { id: "waiting", label: "waiting" },
  { id: "transit", label: "in transit" },
  { id: "available", label: "in yard" },
  { id: "overdue", label: "overdue 10+" },
  { id: "closed", label: "closed" },
];

function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export function ListView({
  initialFilter,
  onOpenVehicle,
}: {
  initialFilter: string;
  onOpenVehicle: (id: string) => void;
}) {
  const initialStage = filters.some((f) => f.id === initialFilter) ? (initialFilter as "all" | VehicleStage) : "all";
  const [stage, setStage] = useState<"all" | VehicleStage>(initialStage);
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");

  const list = useVehicleList({
    stage: stage === "all" ? null : stage,
    auctionSource: null,
    carrierId: null,
    search: submitted,
    limit: 25,
  });
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="space-y-4">
      <SearchBar
        value={search}
        onChange={setSearch}
        onSubmit={() => setSubmitted(search.trim())}
        placeholder="VIN, Lot #, Stock #, year, make, model"
      />
      <FilterPills
        options={filters}
        value={stage}
        onChange={(f) => setStage(f as "all" | VehicleStage)}
      />

      {list.isPending && <p className="text-sm text-muted-foreground" aria-live="polite">Loading vehicles…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-destructive">
          {list.error instanceof Error ? list.error.message : "Vehicles could not be loaded."}
        </p>
      )}

      {list.isSuccess && rows.length === 0 && (
        <EmptyState icon={CarFront} title="No vehicles found" description="Try a different filter or search term." />
      )}

      {rows.length > 0 && (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {rows.map((v) => (
            <button
              key={v.id}
              onClick={() => onOpenVehicle(v.id)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-accent/30"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <CarFront className="size-5 text-muted-foreground" />
              </div>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm">{[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}</b>
                <small className="text-xs text-muted-foreground">
                  {v.auction_source || "Auction unknown"} · Lot {v.lot_number || "—"} · VIN {v.vin || "—"}
                </small>
              </span>
              <span className="hidden shrink-0 sm:block">
                <StatusBadge>{v.status}</StatusBadge>
              </span>
              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{daysSince(v.created_at)} days</span>
            </button>
          ))}
        </div>
      )}

      {list.hasNextPage && (
        <Button variant="outline" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
          {list.isFetchingNextPage ? "Loading…" : "Load more vehicles"}
        </Button>
      )}
    </div>
  );
}
