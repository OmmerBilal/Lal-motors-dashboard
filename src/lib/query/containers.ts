"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  containerClose,
  containerOnTheWay,
  consigneeList,
  consigneeSave,
  exportCounts,
  exportGet,
  exportList,
  invoiceCreate,
  invoiceFinalize,
  invoiceReview,
  invoiceRevise,
  invoiceSaveDraft,
  loaderConfirmNumber,
  loaderFinish,
  loaderGet,
  loaderList,
  loaderOpen,
  paymentRecord,
  paymentReverse,
  shippingSave,
  type ExportBucket,
} from "@/lib/data/containers";

export const containerKeys = {
  all: ["containers"] as const,
  loaderList: (status: string) => ["containers", "loader", "list", status] as const,
  loader: (id: string) => ["containers", "loader", "detail", id] as const,
  exportCounts: ["containers", "export", "counts"] as const,
  exportList: (bucket: ExportBucket) => ["containers", "export", "list", bucket] as const,
  exportDetail: (id: string) => ["containers", "export", "detail", id] as const,
  consignees: (search: string | null) => ["containers", "consignees", search ?? ""] as const,
  photo: (id: string, variant: string) => ["containers", "photo", id, variant] as const,
};

/** Only the containers subtree is invalidated. Other modules' caches are untouched. */
export function invalidateContainers(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: containerKeys.all });
}

// ------------------------------------------------------------------ loader reads
export function useLoaderList(status: "open" | "ready" | "all") {
  return useInfiniteQuery({
    queryKey: containerKeys.loaderList(status),
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => loaderList(status, pageParam),
    getNextPageParam: (page) => {
      if (!page.has_more || page.rows.length === 0) return undefined;
      const last = page.rows[page.rows.length - 1];
      return { createdAt: last.created_at, id: last.id };
    },
  });
}

export function useLoaderDetail(id: string | null) {
  return useQuery({ queryKey: containerKeys.loader(id ?? ""), queryFn: () => loaderGet(id ?? ""), enabled: !!id });
}

export function useLoaderMutations() {
  const qc = useQueryClient();
  const done = () => invalidateContainers(qc);
  return {
    open: useMutation({ mutationFn: (requestId: string) => loaderOpen(requestId), onSuccess: done }),
    confirmNumber: useMutation({ mutationFn: (p: { id: string; number: string }) => loaderConfirmNumber(p.id, p.number), onSuccess: done }),
    finish: useMutation({ mutationFn: (p: { id: string; requestId: string }) => loaderFinish(p.id, p.requestId), onSuccess: done }),
  };
}

// ------------------------------------------------------------------ export reads
export function useExportCounts() {
  return useQuery({ queryKey: containerKeys.exportCounts, queryFn: exportCounts, staleTime: 30_000 });
}

export function useExportList(bucket: ExportBucket) {
  return useInfiniteQuery({
    queryKey: containerKeys.exportList(bucket),
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => exportList(bucket, pageParam),
    getNextPageParam: (page) => {
      if (!page.has_more || page.rows.length === 0) return undefined;
      const last = page.rows[page.rows.length - 1];
      return { createdAt: last.created_at, id: last.id };
    },
  });
}

export function useExportDetail(id: string | null) {
  return useQuery({ queryKey: containerKeys.exportDetail(id ?? ""), queryFn: () => exportGet(id ?? ""), enabled: !!id });
}

export function useConsignees(search: string | null) {
  return useQuery({ queryKey: containerKeys.consignees(search), queryFn: () => consigneeList(search), staleTime: 60_000 });
}

export function useExportMutations() {
  const qc = useQueryClient();
  const done = () => invalidateContainers(qc);
  return {
    saveConsignee: useMutation({ mutationFn: consigneeSave, onSuccess: done }),
    saveShipping: useMutation({ mutationFn: shippingSave, onSuccess: done }),
    createInvoice: useMutation({ mutationFn: (p: { containerId: string; requestId: string }) => invoiceCreate(p.containerId, p.requestId), onSuccess: done }),
    saveDraft: useMutation({ mutationFn: invoiceSaveDraft, onSuccess: done }),
    review: useMutation({ mutationFn: (invoiceId: string) => invoiceReview(invoiceId), onSuccess: done }),
    finalize: useMutation({ mutationFn: (p: { invoiceId: string; requestId: string }) => invoiceFinalize(p.invoiceId, p.requestId), onSuccess: done }),
    revise: useMutation({ mutationFn: invoiceRevise, onSuccess: done }),
    recordPayment: useMutation({ mutationFn: paymentRecord, onSuccess: done }),
    reversePayment: useMutation({ mutationFn: paymentReverse, onSuccess: done }),
    onTheWay: useMutation({ mutationFn: containerOnTheWay, onSuccess: done }),
    close: useMutation({ mutationFn: containerClose, onSuccess: done }),
  };
}
