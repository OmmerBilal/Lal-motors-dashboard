"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { VehicleEvent, VehicleRecord } from "@/lib/mock/vehicles";
import { vehicleRowToRecord } from "@/lib/data/vehicle-record";
import {
  listAllReviewQueue,
  listCompletions,
  listRoster,
  listVehicleHistory,
  listVehiclesByIds,
  listWindowParts,
  type QueueRow,
  type WindowPart,
} from "@/lib/data/processing";

export type ReviewKind = "needs_review" | "possible_duplicate";

export type ReviewCandidate = {
  event: VehicleEvent;
  vehicle: VehicleRecord;
  employeeName: string;
  kind: ReviewKind;
};

export type CompletionRecord = {
  vehicle: VehicleRecord;
  employeeId: string;
  employeeName: string;
  startedAt: string | null;
  completedAt: string;
  partsCount: number;
  approvedPartsCount: number;
  reviewCount: number;
};

export type PeriodId = "today" | "week" | "month" | "custom";

export function periodRange(period: PeriodId, custom?: { from?: string; to?: string }): { from: number; to: number } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === "today") return { from: startOfToday, to: Date.now() };
  if (period === "week") return { from: Date.now() - 7 * 86400000, to: Date.now() };
  if (period === "month") return { from: Date.now() - 30 * 86400000, to: Date.now() };
  const from = custom?.from ? new Date(custom.from).getTime() : startOfToday;
  const to = custom?.to ? new Date(custom.to).getTime() + 86399999 : Date.now();
  return { from, to };
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/** Keys for the processing namespace only. Decisions invalidate this namespace, nothing else. */
export const processingKeys = {
  all: ["processing"] as const,
  queue: () => [...processingKeys.all, "queue"] as const,
  completions: (from: string) => [...processingKeys.all, "completions", from] as const,
  parts: (from: string) => [...processingKeys.all, "parts", from] as const,
  roster: () => [...processingKeys.all, "roster"] as const,
  vehicles: (ids: string) => [...processingKeys.all, "vehicles", ids] as const,
  history: (vehicleId: string) => [...processingKeys.all, "history", vehicleId] as const,
};

// Completions and activity are read over one year, and filtered in memory per period. Custom ranges
// older than a year are not shown here yet (documented limit).
const WINDOW_DAYS = 366;

function queueRowToCandidate(row: QueueRow, vehicle: VehicleRecord): ReviewCandidate {
  return {
    event: {
      id: row.id,
      vehicleId: row.vehicle_id,
      action: "PART_REMOVED",
      actorId: row.captured_by ?? "",
      actorName: row.employee_name,
      createdAt: row.created_at,
      partId: row.id,
      partType: "Dismantled part",
      highValue: false,
      status: row.status,
      hasPhoto: true,
    },
    vehicle,
    employeeName: row.employee_name,
    kind: "needs_review",
  };
}

function partToEvent(p: WindowPart, employeeName: string): VehicleEvent {
  return {
    id: p.id,
    vehicleId: p.vehicle_id,
    action: "PART_REMOVED",
    actorId: p.captured_by ?? "",
    actorName: employeeName,
    createdAt: p.created_at,
    partId: p.id,
    partType: p.part_name || "Dismantled part",
    highValue: false,
    status: p.status,
    disposition:
      p.status === "approved" ? "IN INVENTORY" : p.status === "duplicate" ? "POSSIBLE DUPLICATE — MANAGER REVIEW" : undefined,
    hasPhoto: true,
  };
}

export function useDismantlingProcessingData() {
  // Captured once per mount, so query keys stay stable while the screen is open.
  const [windowStart] = useState(() => new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString());
  const [nowIso] = useState(() => new Date().toISOString());

  const queueQ = useQuery({ queryKey: processingKeys.queue(), queryFn: listAllReviewQueue });
  const completionsQ = useQuery({
    queryKey: processingKeys.completions(windowStart),
    queryFn: () => listCompletions(windowStart, nowIso),
  });
  const partsQ = useQuery({ queryKey: processingKeys.parts(windowStart), queryFn: () => listWindowParts(windowStart) });
  const rosterQ = useQuery({ queryKey: processingKeys.roster(), queryFn: listRoster, staleTime: 5 * 60_000 });

  const vehicleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of queueQ.data ?? []) ids.add(r.vehicle_id);
    for (const c of completionsQ.data ?? []) ids.add(c.vehicle_id);
    for (const p of partsQ.data ?? []) ids.add(p.vehicle_id);
    return [...ids].sort();
  }, [queueQ.data, completionsQ.data, partsQ.data]);
  const vehiclesQ = useQuery({
    queryKey: processingKeys.vehicles(vehicleIds.join(",")),
    queryFn: () => listVehiclesByIds(vehicleIds),
    enabled: vehicleIds.length > 0,
  });

  const vehicleMap = useMemo(() => {
    const m = new Map<string, VehicleRecord>();
    for (const v of vehiclesQ.data ?? []) m.set(v.id, vehicleRowToRecord(v));
    return m;
  }, [vehiclesQ.data]);

  const getVehicle = (id: string): VehicleRecord | undefined => vehicleMap.get(id);

  const reviewCandidates = useMemo<ReviewCandidate[]>(() => {
    const out: ReviewCandidate[] = [];
    for (const r of queueQ.data ?? []) {
      const vehicle = vehicleMap.get(r.vehicle_id);
      if (!vehicle) continue;
      out.push(queueRowToCandidate(r, vehicle));
    }
    return out;
  }, [queueQ.data, vehicleMap]);

  const allCompletions = useMemo<CompletionRecord[]>(() => {
    const out: CompletionRecord[] = [];
    for (const c of completionsQ.data ?? []) {
      const vehicle = vehicleMap.get(c.vehicle_id);
      if (!vehicle) continue;
      out.push({
        vehicle,
        employeeId: c.employee_id,
        employeeName: c.employee_name,
        startedAt: c.started_at,
        completedAt: c.completed_at,
        partsCount: Number(c.parts_count),
        approvedPartsCount: Number(c.approved_count),
        reviewCount: Number(c.pending_review_count),
      });
    }
    return out;
  }, [completionsQ.data, vehicleMap]);

  const completedToday = useMemo(() => allCompletions.filter((c) => isToday(c.completedAt)), [allCompletions]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rosterQ.data ?? []) m.set(r.employee_id, r.name);
    for (const c of completionsQ.data ?? []) m.set(c.employee_id, c.employee_name);
    return m;
  }, [rosterQ.data, completionsQ.data]);

  const roster = useMemo(
    () => (rosterQ.data ?? []).map((r) => ({ id: r.employee_id, userId: r.employee_id, name: r.name, firstName: r.name.split(" ")[0] ?? r.name })),
    [rosterQ.data]
  );

  function completionsForEmployee(employeeId: string, period: PeriodId, custom?: { from?: string; to?: string }) {
    const { from, to } = periodRange(period, custom);
    return allCompletions.filter((c) => {
      if (c.employeeId !== employeeId) return false;
      const t = new Date(c.completedAt).getTime();
      return t >= from && t <= to;
    });
  }

  function partsForEmployee(employeeId: string, period: PeriodId, custom?: { from?: string; to?: string }) {
    const { from, to } = periodRange(period, custom);
    return (partsQ.data ?? [])
      .filter((p) => {
        if (p.captured_by !== employeeId) return false;
        const t = new Date(p.created_at).getTime();
        return t >= from && t <= to;
      })
      .map((p) => partToEvent(p, nameById.get(employeeId) ?? "Unknown employee"));
  }

  function approvedPartsForVehicle(vehicleId: string) {
    return (partsQ.data ?? [])
      .filter((p) => p.vehicle_id === vehicleId && p.status === "approved")
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  function todayCountForEmployee(employeeId: string) {
    return completedToday.filter((c) => c.employeeId === employeeId).length;
  }

  return {
    roster,
    getVehicle,
    reviewCandidates,
    needsReviewCount: reviewCandidates.length,
    allCompletions,
    completedToday,
    completionsForEmployee,
    partsForEmployee,
    todayCountForEmployee,
    approvedPartsForVehicle,
    isLoading: queueQ.isLoading || completionsQ.isLoading || rosterQ.isLoading,
    error: (queueQ.error ?? completionsQ.error ?? rosterQ.error) as Error | null,
  };
}

/** Event history for one vehicle, loaded on the detail screen only. */
export function useVehicleHistory(vehicleId: string): VehicleEvent[] {
  const q = useQuery({
    queryKey: processingKeys.history(vehicleId),
    queryFn: () => listVehicleHistory(vehicleId),
    enabled: !!vehicleId,
  });
  return useMemo(
    () =>
      (q.data ?? []).map((e) => ({
        id: e.id,
        vehicleId: e.vehicle_id,
        action: e.action as VehicleEvent["action"],
        actorId: "",
        actorName: e.actor_name,
        createdAt: e.created_at,
        note: e.note ?? undefined,
        status: e.status ?? undefined,
        partId: e.part_ref ?? undefined,
      })),
    [q.data]
  );
}
