"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Camera, CarFront } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterPills } from "@/components/patterns/search-bar";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";
import { vehicleTitle } from "@/lib/mock/vehicles";

const periods = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
];

const roleLabel: Record<string, string> = {
  auction: "Auction Vehicle Employee",
  manager: "Front Desk Manager",
  employee: "Warehouse Employee",
};

const categories = [
  { id: "processed", label: "Vehicles processed" },
  { id: "completed", label: "Vehicles completed" },
  { id: "parts", label: "Parts removed" },
  { id: "converters", label: "Catalytic converters" },
  { id: "highValue", label: "High-value parts" },
] as const;

function periodStart(period: string) {
  const now = new Date();
  if (period === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === "month") return now.getTime() - 30 * 86400000;
  return now.getTime() - 7 * 86400000;
}

export function EmployeeActivityPanel({ onOpenVehicle }: { onOpenVehicle: (id: string) => void }) {
  const { events, staff, getVehicle } = useVehicleData();
  const [period, setPeriod] = useState("week");
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("");

  const since = periodStart(period);
  const scopedEvents = useMemo(
    () => events.filter((e) => new Date(e.createdAt).getTime() >= since),
    [events, since]
  );

  const employees = staff.filter((s) => s.role !== "owner" && s.role !== "engineer_admin" && s.role !== "scrap_driver");

  const summaries = employees.map((person) => {
    const own = scopedEvents.filter((e) => e.actorId === person.id);
    return {
      person,
      processed: own.length,
      completed: own.filter((e) => e.action === "COMPLETION_SUBMITTED").length,
      parts: own.filter((e) => e.action === "PART_REMOVED").length,
      converters: own.filter((e) => e.action === "PART_REMOVED" && e.partType?.toLowerCase().includes("converter")).length,
      highValue: own.filter((e) => e.action === "PART_REMOVED" && e.highValue).length,
    };
  });

  const selected = summaries.find((s) => s.person.id === employeeId) || null;
  const selectedEvents = selected
    ? scopedEvents.filter((e) => {
        if (e.actorId !== selected.person.id) return false;
        if (!category) return true;
        if (category === "completed") return e.action === "COMPLETION_SUBMITTED";
        if (category === "parts") return e.action === "PART_REMOVED";
        if (category === "converters") return e.action === "PART_REMOVED" && e.partType?.toLowerCase().includes("converter");
        if (category === "highValue") return e.action === "PART_REMOVED" && e.highValue;
        return true;
      })
    : [];

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide">
          Employee activity — {period === "week" ? "This week" : period === "today" ? "Today" : "This month"}
        </h3>
        {selected && (
          <Button variant="ghost" size="sm" onClick={() => { setEmployeeId(null); setCategory(""); }}>
            <ArrowLeft className="size-4" /> All employees
          </Button>
        )}
      </div>
      {!selected && <FilterPills options={periods} value={period} onChange={setPeriod} />}

      {!selected && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((s) => (
            <button
              key={s.person.id}
              onClick={() => setEmployeeId(s.person.id)}
              className="rounded-md border border-border bg-background p-3 text-left hover:border-primary/40"
            >
              <b className="block text-sm">{s.person.name}</b>
              <span className="text-xs text-muted-foreground">{roleLabel[s.person.role] || s.person.role}</span>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span>{s.completed} completed</span>
                <span>{s.converters} converters</span>
                {s.parts > 0 && <span>{s.parts} parts removed</span>}
              </div>
            </button>
          ))}
          {!summaries.length && <p className="text-sm text-muted-foreground">No employee activity records yet.</p>}
        </div>
      )}

      {selected && (
        <div className="mt-4">
          <div className="mb-3">
            <h4 className="text-base font-semibold">{selected.person.name}</h4>
            <p className="text-xs text-muted-foreground">
              {roleLabel[selected.person.role] || selected.person.role} ·{" "}
              {period === "week" ? "This week" : period === "month" ? "This month" : "Today"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(category === c.id ? "" : c.id)}
                className={`rounded-md border p-2.5 text-left ${category === c.id ? "border-primary bg-primary/5" : "border-border bg-background"}`}
              >
                <b className="block text-lg">{selected[c.id as keyof typeof selected] as number}</b>
                <span className="text-[11px] text-muted-foreground">{c.label}</span>
              </button>
            ))}
          </div>
          <h4 className="mt-4 mb-2 text-sm font-semibold">
            {category ? categories.find((c) => c.id === category)?.label : "Activity timeline"}
          </h4>
          <div className="space-y-1.5">
            {selectedEvents.map((entry) => {
              const vehicle = getVehicle(entry.vehicleId);
              return (
                <div key={entry.id} className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    {entry.hasPhoto ? <Camera className="size-4 text-muted-foreground" /> : <CarFront className="size-4 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <b className="block text-sm">{vehicle ? vehicleTitle(vehicle) : entry.partType || "Captured part"}</b>
                    <small className="text-xs text-muted-foreground">
                      VIN {vehicle?.vin || "—"} · Lot {vehicle?.lotNumber || "—"}
                    </small>
                    <span className="block text-xs">{entry.partType || entry.action.replaceAll("_", " ")}</span>
                    <small className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</small>
                    <div>
                      <button className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => onOpenVehicle(entry.vehicleId)}>
                        Open source vehicle & history
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {!selectedEvents.length && (
              <p className="text-sm text-muted-foreground">
                No {category ? categories.find((c) => c.id === category)?.label.toLowerCase() : "vehicle actions"} for
                this employee and date range.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
