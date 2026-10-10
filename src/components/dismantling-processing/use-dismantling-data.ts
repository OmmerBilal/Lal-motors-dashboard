"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { VehicleEvent, VehicleRecord } from "@/lib/mock/vehicles";
import { vehicleRowToRecord } from "@/lib/data/vehicle-record";
import {
  getEmployeeCounts,
  getProcessingSummary,
  listApprovedPartsForVehicles,
  listCompletions,
  listEmployeeParts,
  listReviewQueuePage,
  listRoster,
  listVehicleHistory,
  listVehiclesByIds,
  type QueueRow,
  type WindowPart,
} from "@/lib/data/processing";

/**
 * Processing reads. Counts come from database aggregates. Lists are bounded: the review queue is keyset-paged,
 * today's completions are capped to the day, and an employee's parts load only on that employee's screen.
 * Nothing loads a year of parts into the browser.
 */

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

/** Period bounds relative to a fixed instant, so the same render always computes the same range. */
export function periodRangeAt(nowMs: number, period: PeriodId, custom?: { from?: string; to?: string }): { from: number; to: number } {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === "today") return { from: startOfToday, to: nowMs };
  if (period === "week") return { from: nowMs - 7 * 86400000, to: nowMs };
  if (period === "month") return { from: nowMs - 30 * 86400000, to: nowMs };
  const from = custom?.from ? new Date(custom.from).getTime() : startOfToday;
  const to = custom?.to ? new Date(custom.to).getTime() + 86399999 : nowMs;
  return { from, to };
}

export function periodRange(period: PeriodId, custom?: { from?: string; to?: string }): { from: number; to: number } {
  return periodRangeAt(Date.now(), period, custom);
}

/** Period bounds as ISO strings, for query keys/args — shared so two hooks asked for the same period produce the
 * exact same cache key and therefore the exact same numbers (one request, not two that could drift apart). */
function periodIsoRange(anchor: number, period: PeriodId, custom?: { from?: string; to?: string }): { from: string; to: string } {
  const r = periodRangeAt(anchor, period, custom);
  return { from: new Date(r.from).toISOString(), to: new Date(r.to + 1).toISOString() };
}

/** "Today" / "this week" / "this month" / "in range" — lowercase, mid-sentence (e.g. "3 cars today"). */
export function periodPhrase(period: PeriodId): string {
  if (period === "today") return "today";
  if (period === "week") return "this week";
  if (period === "month") return "this month";
  return "in range";
}

/** "Today" / "This Week" / "This Month" / "Selected Range" — title case, for card headings. */
export function periodTitle(period: PeriodId): string {
  if (period === "today") return "Today";
  if (period === "week") return "This Week";
  if (period === "month") return "This Month";
  return "Selected Range";
}

/** Keys for the processing namespace only. Decisions invalidate this namespace, nothing else. */
export const processingKeys = {
  all: ["processing"] as const,
  queue: () => [...processingKeys.all, "queue"] as const,
  summary: (from: string, to: string) => [...processingKeys.all, "summary", from, to] as const,
  counts: (from: string, to: string) => [...processingKeys.all, "counts", from, to] as const,
  completions: (from: string, to: string) => [...processingKeys.all, "completions", from, to] as const,
  approved: (ids: string) => [...processingKeys.all, "approved", ids] as const,
  employeeParts: (employeeId: string, from: string, to: string) => [...processingKeys.all, "employee-parts", employeeId, from, to] as const,
  roster: () => [...processingKeys.all, "roster"] as const,
  vehicles: (ids: string) => [...processingKeys.all, "vehicles", ids] as const,
  history: (vehicleId: string) => [...processingKeys.all, "history", vehicleId] as const,
};

/** Upper bound for "all open items": the review queue has no date window, so the summary is asked for a wide range. */
const WIDE_DAYS = 400;

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
      partType: row.vehicle_label || "Dismantled part",
      highValue: false,
      status: row.status,
      hasPhoto: true,
    },
    vehicle,
    employeeName: row.employee_name,
    kind: row.status === "duplicate" ? "possible_duplicate" : "needs_review",
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

/** Dashboard data: aggregate counts, a bounded review queue, and the period's completions (capped).
 * `period`/`custom` default to literally "today" — every existing caller that doesn't pass them keeps the exact
 * same behaviour as before. A caller that DOES pass the period currently selected elsewhere on the same page (the
 * date tabs in EmployeeDetail) gets numbers for that same range, from the same cached query, so the two can never
 * disagree. */
export function useDismantlingProcessingData(period: PeriodId = "today", custom?: { from?: string; to?: string }, anchorMs?: number) {
  // Captured once per mount, so the query keys stay stable while the screen is open. A caller showing another
  // period-aware view of the SAME range (the page passes its own shared anchor down) can pass `anchorMs` so both
  // resolve "this week"/"this month" to the exact same instant — not just the same day — and hit one cached query.
  const [localAnchor] = useState(() => Date.now());
  const anchor = anchorMs ?? localAnchor;
  const wideFrom = useMemo(() => new Date(anchor - WIDE_DAYS * 86400000).toISOString(), [anchor]);
  const nowIso = useMemo(() => new Date(anchor + 60_000).toISOString(), [anchor]);
  const customFrom = custom?.from ?? "";
  const customTo = custom?.to ?? "";
  const range = useMemo(() => periodIsoRange(anchor, period, { from: customFrom, to: customTo }), [anchor, period, customFrom, customTo]);

  const summaryQ = useQuery({
    queryKey: processingKeys.summary(wideFrom, nowIso),
    queryFn: () => getProcessingSummary(wideFrom, nowIso),
  });
  const rangeCountsQ = useQuery({
    queryKey: processingKeys.counts(range.from, range.to),
    queryFn: () => getEmployeeCounts(range.from, range.to),
  });
  const queueQ = useInfiniteQuery({
    queryKey: processingKeys.queue(),
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => listReviewQueuePage(pageParam, 25),
    getNextPageParam: (last) => {
      if (!last.hasMore || last.rows.length === 0) return undefined;
      const tail = last.rows[last.rows.length - 1];
      return { createdAt: tail.created_at, id: tail.id };
    },
  });
  const completionsQ = useQuery({
    queryKey: processingKeys.completions(range.from, range.to),
    queryFn: () => listCompletions(range.from, range.to),
  });
  const rosterQ = useQuery({ queryKey: processingKeys.roster(), queryFn: listRoster, staleTime: 5 * 60_000 });

  const queueRows = useMemo(() => queueQ.data?.pages.flatMap((p) => p.rows) ?? [], [queueQ.data]);

  const vehicleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of queueRows) ids.add(r.vehicle_id);
    for (const c of completionsQ.data ?? []) ids.add(c.vehicle_id);
    return [...ids].sort();
  }, [queueRows, completionsQ.data]);
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

  const approvedQ = useQuery({
    queryKey: processingKeys.approved(vehicleIds.join(",")),
    queryFn: () => listApprovedPartsForVehicles(vehicleIds),
    enabled: vehicleIds.length > 0,
  });

  const getVehicle = (id: string): VehicleRecord | undefined => vehicleMap.get(id);

  const reviewCandidates = useMemo<ReviewCandidate[]>(() => {
    const out: ReviewCandidate[] = [];
    for (const r of queueRows) {
      const vehicle = vehicleMap.get(r.vehicle_id);
      if (!vehicle) continue;
      out.push(queueRowToCandidate(r, vehicle));
    }
    return out;
  }, [queueRows, vehicleMap]);

  const completedInRange = useMemo<CompletionRecord[]>(() => {
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

  const roster = useMemo(
    () => (rosterQ.data ?? []).map((r) => ({ id: r.employee_id, userId: r.employee_id, name: r.name, firstName: r.name.split(" ")[0] ?? r.name })),
    [rosterQ.data]
  );

  const rangeCountsByEmployee = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of rangeCountsQ.data ?? []) m.set(c.employee_id, c.vehicles_completed);
    return m;
  }, [rangeCountsQ.data]);

  /** Approved parts for the vehicles on screen, grouped by donor. Bounded to the loaded page. */
  const approvedByVehicle = useMemo(() => {
    const m = new Map<string, WindowPart[]>();
    for (const p of approvedQ.data ?? []) {
      const list = m.get(p.vehicle_id) ?? [];
      list.push(p);
      m.set(p.vehicle_id, list);
    }
    return m;
  }, [approvedQ.data]);

  function approvedPartsForVehicle(vehicleId: string) {
    return approvedByVehicle.get(vehicleId) ?? [];
  }

  function countForEmployeeInRange(employeeId: string) {
    return rangeCountsByEmployee.get(employeeId) ?? 0;
  }

  const summary = summaryQ.data;

  return {
    roster,
    getVehicle,
    reviewCandidates,
    needsReviewCount: summary?.needs_review ?? 0,
    reviewHasMore: !!queueQ.hasNextPage,
    loadMoreReview: () => queueQ.fetchNextPage(),
    reviewLoadingMore: queueQ.isFetchingNextPage,
    /** Completions within `period`/`custom` (defaults to today). Same query the per-employee detail screen uses
     * for the same range, so the two are never out of sync. */
    completedInRange,
    completedInRangeCount: summary?.completed_in_range ?? 0,
    countForEmployeeInRange,
    approvedPartsForVehicle,
    isLoading: summaryQ.isLoading || queueQ.isLoading || rosterQ.isLoading,
    error: (summaryQ.error ?? queueQ.error ?? rosterQ.error) as Error | null,
  };
}

/** One employee's work in a period: server counts for the cards, and a capped parts list loaded on demand.
 * `anchorMs`: see useDismantlingProcessingData — pass the page's shared anchor so both resolve the period to the
 * same instant. */
export function useEmployeeWork(employeeId: string, period: PeriodId, custom?: { from?: string; to?: string }, anchorMs?: number) {
  const [localAnchor] = useState(() => Date.now());
  const anchor = anchorMs ?? localAnchor;
  const customFrom = custom?.from ?? "";
  const customTo = custom?.to ?? "";
  const { from, to } = useMemo(() => periodIsoRange(anchor, period, { from: customFrom, to: customTo }), [anchor, period, customFrom, customTo]);

  const countsQ = useQuery({
    queryKey: processingKeys.counts(from, to),
    queryFn: () => getEmployeeCounts(from, to),
  });
  const partsQ = useQuery({
    queryKey: processingKeys.employeeParts(employeeId, from, to),
    queryFn: () => listEmployeeParts(employeeId, from, to, 200),
    enabled: !!employeeId,
  });
  // The period's completions for this employee. Bounded by the chosen period; the employee's own rows only.
  const completionsQ = useQuery({
    queryKey: processingKeys.completions(from, to),
    queryFn: () => listCompletions(from, to),
    enabled: !!employeeId,
  });
  const ownCompletions = useMemo(() => (completionsQ.data ?? []).filter((c) => c.employee_id === employeeId), [completionsQ.data, employeeId]);
  const vehicleIds = useMemo(() => [...new Set(ownCompletions.map((c) => c.vehicle_id))].sort(), [ownCompletions]);
  const vehiclesQ = useQuery({
    queryKey: processingKeys.vehicles(vehicleIds.join(",")),
    queryFn: () => listVehiclesByIds(vehicleIds),
    enabled: vehicleIds.length > 0,
  });
  const vehicleMap = useMemo(() => new Map((vehiclesQ.data ?? []).map((v) => [v.id, vehicleRowToRecord(v)] as const)), [vehiclesQ.data]);
  const completions = useMemo<CompletionRecord[]>(
    () =>
      ownCompletions.flatMap((c) => {
        const vehicle = vehicleMap.get(c.vehicle_id);
        if (!vehicle) return [];
        return [{
          vehicle,
          employeeId: c.employee_id,
          employeeName: c.employee_name,
          startedAt: c.started_at,
          completedAt: c.completed_at,
          partsCount: Number(c.parts_count),
          approvedPartsCount: Number(c.approved_count),
          reviewCount: Number(c.pending_review_count),
        }];
      }),
    [ownCompletions, vehicleMap],
  );

  const counts = (countsQ.data ?? []).find((c) => c.employee_id === employeeId) ?? null;
  const name = counts?.name ?? "Unknown employee";
  const parts = useMemo(() => (partsQ.data ?? []).map((p) => partToEvent(p, name)), [partsQ.data, name]);

  return {
    counts,
    completions,
    parts,
    partsCapped: (partsQ.data ?? []).length >= 200,
    isLoading: countsQ.isLoading || partsQ.isLoading || completionsQ.isLoading,
    error: (countsQ.error ?? partsQ.error ?? completionsQ.error) as Error | null,
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
