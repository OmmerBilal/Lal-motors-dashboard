"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  driverAttachCheckPhoto,
  driverAttachPhoto,
  driverCompleteLoad,
  driverCreateCheck,
  driverCreateLoad,
  driverGetLoad,
  driverListLoads,
  driverMarkDelivered,
  fetchScrapThumbnailUrls,
  managerApproveLoad,
  managerAssignDriver,
  managerAttachPaymentProof,
  managerCorrectFinancials,
  managerCorrectPayment,
  managerCreateLoad,
  managerCreateRim,
  managerDailyClose,
  managerDailyClosePreview,
  managerGetLoad,
  managerGetRim,
  managerListChecks,
  managerListDiscrepancies,
  managerListDrivers,
  managerListLoads,
  managerListPayments,
  managerListRim,
  managerOpenDiscrepancy,
  managerRecordPayment,
  managerRecordRimReturn,
  managerReport,
  managerResolveDiscrepancy,
  managerSetAmountOverride,
  managerSetMeasurement,
  managerSummary,
  type DiscrepancyKind,
  type LoadBucket,
  type ManagerLoad,
  type PaymentMethod,
} from "@/lib/data/scrap";

/** Every scrap query lives under ["scrap", ...]. Invalidation is limited to this subtree. */
export const scrapKeys = {
  all: ["scrap"] as const,
  driverLoads: ["scrap", "driver", "loads"] as const,
  summary: (from: string, to: string) => ["scrap", "manager", "summary", from, to] as const,
  loads: (filter: object) => ["scrap", "manager", "loads", filter] as const,
  load: (id: string) => ["scrap", "manager", "load", id] as const,
  payments: ["scrap", "manager", "payments"] as const,
  checks: (unlinked: boolean) => ["scrap", "manager", "checks", unlinked] as const,
  discrepancies: (status: string) => ["scrap", "manager", "discrepancies", status] as const,
  rim: (status: string) => ["scrap", "manager", "rim", status] as const,
  rimOne: (id: string) => ["scrap", "manager", "rim-one", id] as const,
  closePreview: (date: string) => ["scrap", "manager", "close", date] as const,
  report: (from: string, to: string, driver: string | null) => ["scrap", "manager", "report", from, to, driver] as const,
  thumbs: (ids: string[]) => ["scrap", "thumbs", ids.join(",")] as const,
};

/** Invalidate the scrap subtree after a change. Other modules' caches are untouched. */
export function invalidateScrap(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: scrapKeys.all });
}

// ------------------------------------------------------------------ driver
export function useDriverLoads() {
  return useInfiniteQuery({
    queryKey: scrapKeys.driverLoads,
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => driverListLoads(pageParam),
    getNextPageParam: (page) => {
      if (!page.has_more || page.rows.length === 0) return undefined;
      const last = page.rows[page.rows.length - 1];
      return { createdAt: last.created_at, id: last.id };
    },
  });
}

export function useDriverLoad(id: string | null) {
  return useQuery({ queryKey: ["scrap", "driver", "load", id ?? ""], queryFn: () => driverGetLoad(id ?? ""), enabled: !!id });
}


export function useDriverMutations() {
  const qc = useQueryClient();
  const done = () => invalidateScrap(qc);
  return {
    createLoad: useMutation({ mutationFn: (requestId: string) => driverCreateLoad(requestId), onSuccess: done }),
    attachPhoto: useMutation({
      mutationFn: (p: { loadId: string; kind: "load" | "ticket"; mediaId: string }) => driverAttachPhoto(p.loadId, p.kind, p.mediaId),
      onSuccess: done,
    }),
    markDelivered: useMutation({ mutationFn: (loadId: string) => driverMarkDelivered(loadId), onSuccess: done }),
    completeLoad: useMutation({ mutationFn: (loadId: string) => driverCompleteLoad(loadId), onSuccess: done }),
    createCheck: useMutation({ mutationFn: (requestId: string) => driverCreateCheck(requestId), onSuccess: done }),
    attachCheckPhoto: useMutation({
      mutationFn: (p: { checkId: string; mediaId: string }) => driverAttachCheckPhoto(p.checkId, p.mediaId),
      onSuccess: done,
    }),
  };
}

// ------------------------------------------------------------------ management reads
export function useManagerSummary(from: string, to: string) {
  return useQuery({ queryKey: scrapKeys.summary(from, to), queryFn: () => managerSummary(from, to), enabled: !!from && !!to });
}

export function useManagerLoads(filter: { bucket: LoadBucket; from?: string | null; to?: string | null; driverId?: string | null }) {
  return useInfiniteQuery({
    queryKey: scrapKeys.loads(filter),
    initialPageParam: null as { date: string; createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => managerListLoads(filter, pageParam),
    getNextPageParam: (page) => {
      if (!page.has_more || page.rows.length === 0) return undefined;
      const last = page.rows[page.rows.length - 1];
      return { date: last.load_date, createdAt: last.created_at, id: last.id };
    },
  });
}

export function useManagerLoad(id: string | null) {
  return useQuery({ queryKey: scrapKeys.load(id ?? ""), queryFn: () => managerGetLoad(id ?? ""), enabled: !!id });
}

export function usePaymentsList() {
  return useInfiniteQuery({
    queryKey: scrapKeys.payments,
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => managerListPayments(pageParam),
    getNextPageParam: (page) => {
      if (!page.has_more || page.rows.length === 0) return undefined;
      const last = page.rows[page.rows.length - 1];
      return { createdAt: last.created_at, id: last.id };
    },
  });
}

export function useChecksList(unlinkedOnly: boolean) {
  return useQuery({ queryKey: scrapKeys.checks(unlinkedOnly), queryFn: () => managerListChecks(unlinkedOnly) });
}

export function useDiscrepancies(status: "open" | "resolved" | "all") {
  return useQuery({ queryKey: scrapKeys.discrepancies(status), queryFn: () => managerListDiscrepancies(status) });
}

export function useRimList(status: "open" | "completed" | "all") {
  return useInfiniteQuery({
    queryKey: scrapKeys.rim(status),
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => managerListRim(status, pageParam),
    getNextPageParam: (page) => {
      if (!page.has_more || page.rows.length === 0) return undefined;
      const last = page.rows[page.rows.length - 1];
      return { createdAt: last.created_at, id: last.id };
    },
  });
}

export function useRimObligation(id: string | null) {
  return useQuery({ queryKey: scrapKeys.rimOne(id ?? ""), queryFn: () => managerGetRim(id ?? ""), enabled: !!id });
}

export function useClosePreview(date: string) {
  return useQuery({ queryKey: scrapKeys.closePreview(date), queryFn: () => managerDailyClosePreview(date), enabled: !!date });
}

export function useReport(from: string, to: string, driverId: string | null) {
  return useQuery({ queryKey: scrapKeys.report(from, to, driverId), queryFn: () => managerReport(from, to, driverId), enabled: !!from && !!to });
}

/** Signed thumbnail URLs for a page of rows. One batched request per distinct set of photos. */
export function useScrapThumbnails(mediaIds: string[]) {
  const sorted = [...new Set(mediaIds)].sort();
  return useQuery({
    queryKey: scrapKeys.thumbs(sorted),
    queryFn: () => fetchScrapThumbnailUrls(sorted),
    enabled: sorted.length > 0,
    staleTime: 60_000,
  });
}

// ------------------------------------------------------------------ management writes
export function useManagerMutations() {
  const qc = useQueryClient();
  const done = () => invalidateScrap(qc);
  return {
    setMeasurement: useMutation({
      mutationFn: (p: { loadId: string; weight: number; rate: number; notes?: string }) => managerSetMeasurement(p),
      onSuccess: done,
    }),
    setAmountOverride: useMutation({
      mutationFn: (p: { loadId: string; amount: number; reason: string }) => managerSetAmountOverride(p),
      onSuccess: done,
    }),
    correctFinancials: useMutation({
      mutationFn: (p: { loadId: string; weight: number | null; rate: number | null; amount: number | null; reason: string }) => managerCorrectFinancials(p),
      onSuccess: done,
    }),
    approve: useMutation({ mutationFn: (loadId: string) => managerApproveLoad(loadId), onSuccess: done }),
    openDiscrepancy: useMutation({
      mutationFn: (p: { kind: Exclude<DiscrepancyKind, "payment_mismatch">; loadId?: string | null; paymentId?: string | null; note: string }) => managerOpenDiscrepancy(p),
      onSuccess: done,
    }),
    resolveDiscrepancy: useMutation({
      mutationFn: (p: { id: string; note: string }) => managerResolveDiscrepancy(p.id, p.note),
      onSuccess: done,
    }),
    recordPayment: useMutation({
      mutationFn: (p: { driverId: string; loadIds: string[]; amountReceived: number; method: PaymentMethod; reference: string; notes: string; requestId: string }) =>
        managerRecordPayment(p),
      onSuccess: done,
    }),
    attachProof: useMutation({
      mutationFn: (p: { paymentId: string; mediaId: string }) => managerAttachPaymentProof(p.paymentId, p.mediaId),
      onSuccess: done,
    }),
    correctPayment: useMutation({
      mutationFn: (p: { originalId: string; amountReceived: number; loadIds: string[]; reason: string; requestId: string }) => managerCorrectPayment(p),
      onSuccess: done,
    }),
    createRim: useMutation({
      mutationFn: (p: { customerId: string; tires: number; aluminum: number; steel: number; notes: string; requestId: string }) => managerCreateRim(p),
      onSuccess: done,
    }),
    recordRimReturn: useMutation({
      mutationFn: (p: { obligationId: string; aluminum: number; steel: number; notes: string; requestId: string }) => managerRecordRimReturn(p),
      onSuccess: done,
    }),
    dailyClose: useMutation({
      mutationFn: (p: { date: string; overrideReason: string | null }) => managerDailyClose(p.date, p.overrideReason),
      onSuccess: done,
    }),
  };
}

// ------------------------------------------------------------------ office: create and assign
/** Active Scrap Drivers for the assignment picker. Office roles only; a driver never calls this. */
export function useScrapDrivers(enabled: boolean) {
  return useQuery({ queryKey: ["scrap", "manager", "drivers"] as const, queryFn: managerListDrivers, enabled, staleTime: 60_000 });
}

export function useOfficeLoadMutations() {
  const qc = useQueryClient();
  const done = () => invalidateScrap(qc);
  return {
    createLoad: useMutation({
      mutationFn: (p: { driverId: string; requestId: string }) => managerCreateLoad(p.driverId, p.requestId),
      onSuccess: done,
    }),
    assignDriver: useMutation({
      mutationFn: (p: { loadId: string; driverId: string }) => managerAssignDriver(p.loadId, p.driverId),
      onSuccess: done,
    }),
  };
}

export type { ManagerLoad };
