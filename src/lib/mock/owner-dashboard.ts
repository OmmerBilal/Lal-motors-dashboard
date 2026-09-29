import type { VehicleRecord, VehicleEvent } from "@/lib/mock/vehicles";
import { computeDaysOpen } from "@/lib/mock/vehicles";

export type VehicleStage = "purchased" | "inTransit" | "arrived" | "processing" | "waitingReview" | "completed";

export const stageOrder: VehicleStage[] = ["purchased", "inTransit", "arrived", "processing", "waitingReview", "completed"];

export const stageMeta: Record<VehicleStage, { label: string; color: string; subtitle: string }> = {
  purchased: { label: "Purchased", color: "#2563eb", subtitle: "Newly acquired, awaiting pickup" },
  inTransit: { label: "In Transit", color: "#d97706", subtitle: "On the way to the yard" },
  arrived: { label: "Arrived", color: "#0d9488", subtitle: "At the yard, ready to start" },
  processing: { label: "Processing", color: "#7c3aed", subtitle: "Being dismantled for parts" },
  waitingReview: { label: "Waiting Review", color: "#ea580c", subtitle: "Submitted, needs manager approval" },
  completed: { label: "Completed", color: "#16a34a", subtitle: "Fully processed and closed out" },
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

export type ExceptionSeverity = "critical" | "warning";

export type ExceptionRow = { id: string; label: string; count: number; severity: ExceptionSeverity };

export function computeExceptions(vehicles: VehicleRecord[], events: VehicleEvent[]): ExceptionRow[] {
  return [
    {
      id: "overdue",
      label: "Vehicles over 40 days",
      count: vehicles.filter((v) => computeDaysOpen(v) >= 40).length,
      severity: "critical",
    },
    {
      id: "needsAttention",
      label: "Missing evidence",
      count: vehicles.filter((v) => v.unverifiedFields.length > 0).length,
      severity: "critical",
    },
    {
      id: "highValue",
      label: "High-value parts",
      count: events.filter((e) => e.action === "PART_REMOVED" && e.highValue && !e.disposition).length,
      severity: "critical",
    },
    {
      id: "converters",
      label: "Unmatched converters",
      count: events.filter((e) => e.action === "PART_REMOVED" && e.partType?.toLowerCase().includes("converter") && !e.disposition).length,
      severity: "critical",
    },
    {
      id: "awaitingDispatch",
      label: "Awaiting dispatch",
      count: vehicles.filter((v) => ["Purchased", "Awaiting Dispatch"].includes(v.status)).length,
      severity: "warning",
    },
  ];
}

export function inDateRange(date: string | Date, from?: Date, to?: Date): boolean {
  if (!from) return true;
  const t = new Date(date).getTime();
  const fromStart = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const toEnd = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999).getTime() : fromStart + 86399999;
  return t >= fromStart && t <= toEnd;
}
