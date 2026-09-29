"use client";

import { useMemo } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";
import { vehicleTitle } from "@/lib/mock/vehicles";

export function CompletionGroupView({
  period,
  employeeId,
  onOpenVehicle,
  onChangeEmployee,
}: {
  period: "week" | "month";
  employeeId: string | null;
  onOpenVehicle: (id: string) => void;
  onChangeEmployee: (id: string | null) => void;
}) {
  const { events, getVehicle, staff } = useVehicleData();

  const completions = useMemo(
    () => events.filter((e) => e.action === "COMPLETION_SUBMITTED"),
    [events]
  );

  const byEmployee = useMemo(() => {
    const map = new Map<string, number>();
    completions.forEach((e) => map.set(e.actorId, (map.get(e.actorId) || 0) + 1));
    return staff
      .filter((s) => map.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, completed: map.get(s.id) || 0 }));
  }, [completions, staff]);

  const scoped = employeeId ? completions.filter((e) => e.actorId === employeeId) : completions;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">
        Completed this {period} · {scoped.length} vehicles
      </h3>
      <p className="text-sm text-muted-foreground">
        Verified completions, grouped by the yard employee who submitted the completion photo.
      </p>

      {employeeId ? (
        <>
          <Button variant="outline" size="sm" onClick={() => onChangeEmployee(null)}>
            All employees
          </Button>
          <div className="space-y-2">
            {scoped.map((e) => {
              const vehicle = getVehicle(e.vehicleId);
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                  <div className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Camera className="size-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <b className="block text-sm">{vehicle ? vehicleTitle(vehicle) : "Vehicle"}</b>
                    <small className="text-xs text-muted-foreground">
                      VIN {vehicle?.vin || "—"} · Lot {vehicle?.lotNumber || "—"} · {new Date(e.createdAt).toLocaleString()} ·{" "}
                      {vehicle?.status}
                    </small>
                    <div>
                      <button
                        className="mt-1 text-xs font-medium text-primary hover:underline"
                        onClick={() => onOpenVehicle(e.vehicleId)}
                      >
                        Open exact vehicle, parts and audit history
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {byEmployee.map((e) => (
            <button
              key={e.id}
              onClick={() => onChangeEmployee(e.id)}
              className="rounded-lg border border-border bg-card p-4 text-left hover:border-primary/40"
            >
              <b className="block text-sm">{e.name}</b>
              <span className="text-xs text-muted-foreground">{e.completed} vehicles completed</span>
            </button>
          ))}
        </div>
      )}

      {!scoped.length && (
        <EmptyState title="No completions in this period" description="Completed vehicles will be grouped by employee here." />
      )}
    </div>
  );
}
