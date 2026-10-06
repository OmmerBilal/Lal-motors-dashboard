"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { warehouseGet, warehouseList, warehouseSearch, warehouseSetLocation, warehouseSummary, type WarehousePart } from "@/lib/data/warehouse";

/** Every warehouse query lives under ["warehouse", ...]. Invalidation is limited to this subtree. */
export const warehouseKeys = {
  all: ["warehouse"] as const,
  summary: ["warehouse", "summary"] as const,
  list: (view: string) => ["warehouse", "list", view] as const,
  search: (q: string) => ["warehouse", "search", q] as const,
  part: (id: string) => ["warehouse", "part", id] as const,
};

export function invalidateWarehouse(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: warehouseKeys.all });
}

export function useWarehouseSummary() {
  return useQuery({ queryKey: warehouseKeys.summary, queryFn: warehouseSummary });
}

export function useWarehouseList(view: "pending" | "stored") {
  return useInfiniteQuery({
    queryKey: warehouseKeys.list(view),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => warehouseList(view, pageParam),
    getNextPageParam: (page) => (page.has_more && page.rows.length ? page.rows[page.rows.length - 1].id : undefined),
  });
}

export function useWarehouseSearch(term: string) {
  return useQuery({
    queryKey: warehouseKeys.search(term),
    queryFn: () => warehouseSearch(term),
    enabled: term.length >= 2,
    placeholderData: (prev) => prev,
  });
}

export function useWarehousePart(id: string | null) {
  return useQuery({ queryKey: warehouseKeys.part(id ?? ""), queryFn: () => warehouseGet(id ?? ""), enabled: !!id });
}

export function useSetWarehouseLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { partId: string; location: string }) => warehouseSetLocation(p.partId, p.location),
    onSuccess: () => invalidateWarehouse(qc),
  });
}

export type { WarehousePart };
