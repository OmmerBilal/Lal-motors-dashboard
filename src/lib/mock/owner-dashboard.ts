import type { VehicleRecord, VehicleEvent } from "@/lib/mock/vehicles";
import { computeDaysOpen } from "@/lib/mock/vehicles";

export type VehicleStage = "purchased" | "inTransit" | "arrived" | "processing" | "waitingReview" | "completed";

export const stageOrder: VehicleStage[] = ["purchased", "inTransit", "arrived", "processing", "waitingReview", "completed"];

export const stageMeta: Record<VehicleStage, { label: string; color: string; subtitle: string }> = {
  purchased: { label: "Purchased", color: "#86b6ef", subtitle: "Newly acquired, awaiting pickup" },
  inTransit: { label: "In Transit", color: "#3987e5", subtitle: "On the way to the yard" },
  arrived: { label: "Arrived", color: "#1c5cab", subtitle: "At the yard, ready to start" },
  processing: { label: "Processing", color: "#104281", subtitle: "Being dismantled for parts" },
  waitingReview: { label: "Waiting Review", color: "#fab219", subtitle: "Submitted, needs manager approval" },
  completed: { label: "Completed", color: "#0ca30c", subtitle: "Fully processed and closed out" },
};

const inTransitStatuses = ["Awaiting Dispatch", "Assigned", "Awaiting Pickup", "Picked Up", "Awaiting Transport", "In Transit"];
const arrivedStatuses = ["Arrived", "Available at Yard"];

export function vehicleStage(v: VehicleRecord, events: VehicleEvent[]): VehicleStage {
  if (events.some((e) => e.vehicleId === v.id && e.action === "COMPLETION_APPROVED")) return "completed";
  if (v.status === "Ready for Processing") return "waitingReview";
  if (v.status === "Processing") return "processing";
  if (arrivedStatuses.includes(v.status)) return "arrived";
  if (inTransitStatuses.includes(v.status)) return "inTransit";
  return "purchased";
}

export function computeStageCounts(vehicles: VehicleRecord[], events: VehicleEvent[]): Record<VehicleStage, number> {
  const counts = { purchased: 0, inTransit: 0, arrived: 0, processing: 0, waitingReview: 0, completed: 0 };
  for (const v of vehicles) counts[vehicleStage(v, events)] += 1;
  return counts;
}

export type ExceptionRow = { id: string; label: string; count: number };

export function computeExceptions(vehicles: VehicleRecord[], events: VehicleEvent[]): ExceptionRow[] {
  return [
    { id: "overdue", label: "Vehicles over 40 days", count: vehicles.filter((v) => computeDaysOpen(v) >= 40).length },
    { id: "needsAttention", label: "Missing evidence", count: vehicles.filter((v) => v.unverifiedFields.length > 0).length },
    {
      id: "highValue",
      label: "High-value parts",
      count: events.filter((e) => e.action === "PART_REMOVED" && e.highValue && !e.disposition).length,
    },
    {
      id: "converters",
      label: "Unmatched converters",
      count: events.filter((e) => e.action === "PART_REMOVED" && e.partType?.toLowerCase().includes("converter") && !e.disposition).length,
    },
    { id: "awaitingDispatch", label: "Awaiting dispatch", count: vehicles.filter((v) => ["Purchased", "Awaiting Dispatch"].includes(v.status)).length },
  ];
}
