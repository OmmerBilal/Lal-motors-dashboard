"use client";

import { useMemo } from "react";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";
import type { VehicleEvent, VehicleRecord } from "@/lib/mock/vehicles";

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

const RESOLVING_ACTIONS = new Set(["REVIEW_APPROVED", "REVIEW_EDITED_APPROVED", "REVIEW_MARKED_DUPLICATE", "REVIEW_REJECTED"]);

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

export function useDismantlingProcessingData() {
  const { events, vehicles, staff, getVehicle, recordEvent, vehicleEvents } = useVehicleData();

  const roster = useMemo(() => staff.filter((s) => s.role === "dismantling"), [staff]);

  const partRemovedEvents = useMemo(() => events.filter((e) => e.action === "PART_REMOVED"), [events]);

  const resolvedPartIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      if (RESOLVING_ACTIONS.has(e.action) && e.partId) set.add(e.partId);
    }
    return set;
  }, [events]);

  const reviewCandidates = useMemo<ReviewCandidate[]>(() => {
    const out: ReviewCandidate[] = [];
    for (const e of partRemovedEvents) {
      if (!e.partId || e.disposition === "IN INVENTORY") continue;
      if (resolvedPartIds.has(e.partId)) continue;
      const vehicle = getVehicle(e.vehicleId);
      if (!vehicle) continue;
      out.push({
        event: e,
        vehicle,
        employeeName: e.actorName,
        kind: e.disposition === "POSSIBLE DUPLICATE — MANAGER REVIEW" ? "possible_duplicate" : "needs_review",
      });
    }
    return out.sort((a, b) => (a.event.createdAt < b.event.createdAt ? 1 : -1));
  }, [partRemovedEvents, resolvedPartIds, getVehicle]);

  const completionEvents = useMemo(
    () => events.filter((e) => e.action === "STATUS" && e.status === "Dismantled"),
    [events]
  );

  const allCompletions = useMemo<CompletionRecord[]>(() => {
    const out: CompletionRecord[] = [];
    for (const e of completionEvents) {
      const vehicle = getVehicle(e.vehicleId);
      if (!vehicle) continue;
      const start = events.find((ev) => ev.vehicleId === e.vehicleId && ev.action === "START");
      const parts = partRemovedEvents.filter((p) => p.vehicleId === e.vehicleId);
      const reviewCount = reviewCandidates.filter((c) => c.vehicle.id === e.vehicleId).length;
      out.push({
        vehicle,
        employeeId: e.actorId,
        employeeName: e.actorName,
        startedAt: start?.createdAt ?? null,
        completedAt: e.createdAt,
        partsCount: parts.length,
        approvedPartsCount: parts.length - reviewCount,
        reviewCount,
      });
    }
    return out.sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
  }, [completionEvents, getVehicle, events, partRemovedEvents, reviewCandidates]);

  const completedToday = useMemo(() => allCompletions.filter((c) => isToday(c.completedAt)), [allCompletions]);

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
    return partRemovedEvents.filter((p) => {
      if (p.actorId !== employeeId) return false;
      const t = new Date(p.createdAt).getTime();
      return t >= from && t <= to;
    });
  }

  function todayCountForEmployee(employeeId: string) {
    return completedToday.filter((c) => c.employeeId === employeeId).length;
  }

  return {
    vehicles,
    getVehicle,
    recordEvent,
    roster,
    reviewCandidates,
    needsReviewCount: reviewCandidates.length,
    allCompletions,
    completedToday,
    completionsForEmployee,
    partsForEmployee,
    todayCountForEmployee,
    vehicleEvents,
  };
}
