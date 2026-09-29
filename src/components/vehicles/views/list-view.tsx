"use client";

import { useMemo, useState } from "react";
import { CarFront } from "lucide-react";
import { SearchBar, FilterPills } from "@/components/patterns/search-bar";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/status-badge";
import { computeDaysOpen, filterVehicles, vehicleTitle } from "@/lib/mock/vehicles";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";

const filters = [
  { id: "active", label: "active" },
  { id: "processing", label: "processing" },
  { id: "overdue", label: "40+ days" },
  { id: "history", label: "history" },
  { id: "all", label: "all" },
];

const PAGE_SIZE = 8;

export function ListView({
  initialFilter,
  onOpenVehicle,
}: {
  initialFilter: string;
  onOpenVehicle: (id: string) => void;
}) {
  const { vehicles, events } = useVehicleData();
  const [filter, setFilter] = useState(initialFilter);
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const results = useMemo(() => {
    let base = filterVehicles(vehicles, filter, events);
    const q = search.trim().toLowerCase();
    if (q) {
      base = base.filter((v) =>
        [v.vin, v.lotNumber, v.stockNumber, v.year, v.make, v.model, v.assignedName]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q))
      );
    }
    return base;
  }, [vehicles, events, filter, search]);

  const page = results.slice(0, visible);

  return (
    <div className="space-y-4">
      <SearchBar
        value={search}
        onChange={setSearch}
        onSubmit={() => setVisible(PAGE_SIZE)}
        placeholder="VIN, Lot #, Stock #, year, make, model, employee"
      />
      <FilterPills
        options={filters}
        value={filter}
        onChange={(f) => {
          setFilter(f);
          setVisible(PAGE_SIZE);
        }}
      />

      {page.length ? (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {page.map((v) => {
            const daysOpen = computeDaysOpen(v);
            return (
              <button
                key={v.id}
                onClick={() => onOpenVehicle(v.id)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-accent/30"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                  <CarFront className="size-5 text-muted-foreground" />
                </div>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{vehicleTitle(v)}</b>
                  <small className="text-xs text-muted-foreground">
                    {v.auctionSource || "Auction unknown"} · Lot {v.lotNumber || "—"} · VIN {v.vin || "—"}
                  </small>
                </span>
                <span className="hidden shrink-0 sm:block">
                  <StatusBadge>{v.status}</StatusBadge>
                </span>
                <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                  {daysOpen} days
                  {filter === "overdue" && (
                    <>
                      <br />
                      Assigned {v.assignedName || "Unassigned"}
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={CarFront} title="No vehicles found" description="Try a different filter or search term." />
      )}

      {visible < results.length && (
        <Button variant="outline" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
          Load more vehicles ({results.length - visible} remaining)
        </Button>
      )}
    </div>
  );
}
