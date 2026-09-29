"use client";

import { useMemo, useState } from "react";
import { MapPin, Search, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/patterns/metric-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useDispatchData } from "@/components/central-dispatch/dispatch-data-context";

const today = () => new Date().toISOString().slice(0, 10);

export function HomeView({
  canEdit,
  selected,
  onSelectedChange,
  onOpenJob,
  onArrive,
  onCreateDispatch,
  onRedispatch,
}: {
  canEdit: boolean;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  onOpenJob: (id: string) => void;
  onArrive: (vehicleId: string) => void;
  onCreateDispatch: () => void;
  onRedispatch: (vehicleId: string) => void;
}) {
  const { vehicles, jobs, carriers } = useDispatchData();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(
    () => ({
      awaitingDispatch: vehicles.filter((v) => !v.dispatchId && ["Purchased", "Awaiting Dispatch"].includes(v.status)).length,
      awaitingPickup: vehicles.filter((v) => v.dispatchStatus === "Awaiting Pickup").length,
      inTransit: vehicles.filter((v) => v.dispatchStatus === "In Transit").length,
      partial: jobs.filter((j) => j.status === "Partial Delivery").length,
      arrivedToday: vehicles.filter((v) => v.status === "Arrived" && v.arrivalDate === today()).length,
      missing: vehicles.filter((v) => v.dispatchId && v.dispatchStatus !== "Arrived").length,
    }),
    [vehicles, jobs]
  );

  const metrics: { id: string; label: string; value: number }[] = [
    { id: "awaitingDispatch", label: "Awaiting Dispatch", value: counts.awaitingDispatch },
    { id: "Awaiting Pickup", label: "Awaiting Pickup", value: counts.awaitingPickup },
    { id: "In Transit", label: "In Transit", value: counts.inTransit },
    { id: "partial", label: "Partial Deliveries", value: counts.partial },
    { id: "arrivedToday", label: "Arrived Today", value: counts.arrivedToday },
    { id: "missing", label: "Missing / Pending Vehicles", value: counts.missing },
  ];

  const filtered = useMemo(() => {
    let list = vehicles;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((v) => `${v.lotNumber} ${v.vin} ${v.make} ${v.model}`.toLowerCase().includes(q));
    }
    if (filter === "all") return list;
    if (filter === "missing") return list.filter((v) => v.dispatchId && v.dispatchStatus !== "Arrived");
    if (filter === "partial") return list.filter((v) => jobs.some((j) => j.status === "Partial Delivery" && v.dispatchId === j.id && v.dispatchStatus !== "Arrived"));
    if (filter === "awaitingDispatch") return list.filter((v) => !v.dispatchId && ["Purchased", "Awaiting Dispatch"].includes(v.status));
    if (filter === "arrivedToday") return list.filter((v) => v.status === "Arrived" && v.arrivalDate === today());
    return list.filter((v) => v.status === filter);
  }, [vehicles, jobs, query, filter]);

  const chosenTotal = filtered.filter((v) => selected.includes(v.id));

  const funnel = {
    purchased: vehicles.length,
    dispatched: vehicles.filter((v) => v.dispatchId).length,
    arrived: vehicles.filter((v) => ["Arrived", "Available at Yard", "Processing"].includes(v.status)).length,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m) => (
          <MetricCard key={m.id} label={m.label} value={m.value} active={filter === m.id} onClick={() => setFilter(m.id)} />
        ))}
      </div>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Vehicles · {filtered.length}</h3>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Find vehicle by Lot or VIN"
              placeholder="Search Lot # or VIN"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Select</th>
                <th className="p-3">Lot # / VIN</th>
                <th className="p-3">Vehicle</th>
                <th className="p-3">Pickup</th>
                <th className="p-3">Status</th>
                <th className="p-3">Carrier / dispatch</th>
                <th className="p-3">Arrival</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((v) => (
                <tr key={v.id}>
                  <td className="p-3">
                    {canEdit && (
                      <Checkbox
                        aria-label={`Select ${v.lotNumber || v.vin}`}
                        checked={selected.includes(v.id)}
                        disabled={!!v.dispatchId && !["Cancelled", "Arrived"].includes(v.dispatchStatus || "")}
                        onCheckedChange={(c) => onSelectedChange(c ? [...selected, v.id] : selected.filter((x) => x !== v.id))}
                      />
                    )}
                  </td>
                  <td className="p-3">
                    {v.lotNumber || "—"}
                    <br />
                    <span className="text-xs text-muted-foreground">{v.vin || "—"}</span>
                  </td>
                  <td className="p-3">
                    {v.year} {v.make} {v.model}
                  </td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" /> {v.location || "—"}
                    </span>
                  </td>
                  <td className="p-3">
                    <StatusBadge>{v.status}</StatusBadge>
                  </td>
                  <td className="p-3">
                    {v.dispatchId ? (
                      <div className="flex flex-col items-start gap-1">
                        <button className="text-xs font-medium text-primary hover:underline" onClick={() => onOpenJob(v.dispatchId!)}>
                          {v.company || "Carrier"} · {v.dispatchDate}
                        </button>
                        {["Assigned", "Awaiting Pickup"].includes(v.status) && canEdit && (
                          <Button size="sm" variant="outline" onClick={() => onRedispatch(v.id)}>
                            Re-Dispatch Vehicle
                          </Button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Awaiting Dispatch</span>
                    )}
                  </td>
                  <td className="p-3">
                    {v.status === "In Transit" && (
                      <Button size="sm" onClick={() => onArrive(v.id)}>
                        Confirm Arrival
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selected.length > 0 && chosenTotal.length > 0 && (
          <Button className="mt-3" onClick={onCreateDispatch}>
            Create Dispatch — {selected.length} selected
          </Button>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Active Dispatches</h3>
        <div className="space-y-1.5">
          {jobs.map((j) => (
            <button
              key={j.id}
              onClick={() => onOpenJob(j.id)}
              className="flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left hover:bg-accent/30"
            >
              <Truck className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <b className="block text-sm">
                  {j.company} · {j.driver}
                </b>
                <small className="text-xs text-muted-foreground">
                  {j.items.filter((i) => i.status === "Arrived").length} of {j.items.length} delivered · $
                  {j.items.reduce((s, i) => s + i.price, 0).toFixed(2)}
                </small>
              </span>
              <StatusBadge>{j.status === "Partial Delivery" ? "PARTIAL DELIVERY" : j.status}</StatusBadge>
            </button>
          ))}
          {!jobs.length && <p className="text-sm text-muted-foreground">No active dispatches.</p>}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Carrier Directory · {carriers.length}</h3>
        <div className="divide-y divide-border">
          {carriers.map((c) => (
            <details key={c.id} className="py-2">
              <summary className="cursor-pointer text-sm font-medium">
                {c.company} · {c.driver || "Driver pending"}
              </summary>
              <p className="mt-1 text-xs text-muted-foreground">
                {c.phone || "No phone"} · {c.email || "No email"} · MC/DOT {c.mcDot || "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.address} {c.notes}
              </p>
            </details>
          ))}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Purchased {funnel.purchased} → Dispatched {funnel.dispatched} → Arrived {funnel.arrived}
      </p>
    </div>
  );
}
