"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { vehicleTitle } from "@/lib/mock/vehicles";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";

const eventTypeMatch: Record<string, (action: string, partType?: string, highValue?: boolean) => boolean> = {
  parts: (action) => action === "PART_REMOVED",
  converters: (action, partType) => action === "PART_REMOVED" && !!partType?.toLowerCase().includes("converter"),
  highValue: (action, _p, highValue) => action === "PART_REMOVED" && !!highValue,
  exceptions: () => false,
};

const PAGE_SIZE = 10;

export function ActivityView({
  onOpenVehicle,
  initialEventType,
}: {
  onOpenVehicle: (id: string) => void;
  initialEventType: string;
}) {
  const { events, staff, getVehicle } = useVehicleData();
  const [assignee, setAssignee] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    let list = events;
    if (initialEventType && eventTypeMatch[initialEventType]) {
      list = list.filter((e) => eventTypeMatch[initialEventType](e.action, e.partType, e.highValue));
    }
    if (assignee) list = list.filter((e) => e.actorId === assignee);
    return list;
  }, [events, assignee, initialEventType]);

  const production = staff.filter((s) => events.some((e) => e.actorId === s.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={!assignee ? "default" : "outline"} onClick={() => setAssignee("")}>
          All employees
        </Button>
        {production.map((p) => (
          <Button key={p.id} size="sm" variant={assignee === p.id ? "default" : "outline"} onClick={() => setAssignee(p.id)}>
            {p.name}
          </Button>
        ))}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {filtered.slice(0, visible).map((e) => {
          const vehicle = getVehicle(e.vehicleId);
          return (
            <button
              key={e.id}
              onClick={() => onOpenVehicle(e.vehicleId)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/30"
            >
              <span className="min-w-0">
                <b className="text-sm">{e.action.replaceAll("_", " ")}</b>{" "}
                <span className="text-sm">{vehicle ? vehicleTitle(vehicle) : ""}</span>
                <br />
                <small className="text-xs text-muted-foreground">
                  VIN {vehicle?.vin || "—"} · Lot {vehicle?.lotNumber || "—"} · {e.actorName} ·{" "}
                  {new Date(e.createdAt).toLocaleString()}
                </small>
              </span>
            </button>
          );
        })}
        {!filtered.length && <p className="px-4 py-6 text-sm text-muted-foreground">No matching activity yet.</p>}
      </div>
      {visible < filtered.length && (
        <Button variant="outline" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
          Load more actions ({filtered.length - visible} remaining)
        </Button>
      )}
    </div>
  );
}
