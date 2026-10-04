"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSale,
  fulfillSale,
  getSaleDetail,
  getSalesSettings,
  listCustomerQuotes,
  listSalePage,
  releaseSale,
  reserveSale,
  searchSellableParts,
  updateSalesSettings,
  type SaleListRow,
  type SaleLineInput,
  type SaleMode,
  type SalesSettings,
} from "@/lib/data/sales";

export const salesKeys = {
  all: ["sales"] as const,
  list: (search: string, status: string | null) => ["sales", "list", search, status ?? "all"] as const,
  detail: (id: string) => ["sales", "detail", id] as const,
  settings: ["sales", "settings"] as const,
  customerQuotes: (customerId: string) => ["sales", "customer-quotes", customerId] as const,
};

export const partKeys = {
  sellable: (search: string) => ["parts", "sellable", search] as const,
};

/** Keyset-paged sales list. */
export function useSaleList(search: string, status: string | null) {
  return useInfiniteQuery({
    queryKey: salesKeys.list(search, status),
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => listSalePage(search, status, pageParam),
    getNextPageParam: (page) => {
      if (!page.hasMore || page.rows.length === 0) return undefined;
      const last: SaleListRow = page.rows[page.rows.length - 1];
      return { createdAt: last.created_at, id: last.id };
    },
  });
}

export function useSaleDetail(id: string | null) {
  return useQuery({
    queryKey: salesKeys.detail(id ?? ""),
    queryFn: () => getSaleDetail(id ?? ""),
    enabled: !!id,
  });
}

export function useSellableParts(search: string) {
  return useQuery({
    queryKey: partKeys.sellable(search),
    queryFn: () => searchSellableParts(search),
    placeholderData: keepPreviousData,
  });
}

export function useSalesSettings() {
  return useQuery({ queryKey: salesKeys.settings, queryFn: getSalesSettings, staleTime: 60_000 });
}

export function useCustomerQuotes(customerId: string | null) {
  return useQuery({
    queryKey: salesKeys.customerQuotes(customerId ?? ""),
    queryFn: () => listCustomerQuotes(customerId ?? ""),
    enabled: !!customerId,
  });
}

/** A sale changes the sales lists, the sellable part counts and the customer's quotes. */
export function useCreateSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { customerId: string; lines: SaleLineInput[]; mode: SaleMode; discount: number; notes: string; clientRequestId: string }) =>
      createSale(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salesKeys.all });
      queryClient.invalidateQueries({ queryKey: ["parts", "sellable"] });
    },
  });
}

/** Reserve, release and fulfill change stock and the sale's reservation and fulfillment state. */
export function useSaleStockAction() {
  const queryClient = useQueryClient();
  const invalidate = (saleId: string) => {
    queryClient.invalidateQueries({ queryKey: salesKeys.detail(saleId) });
    queryClient.invalidateQueries({ queryKey: ["sales", "list"] });
    queryClient.invalidateQueries({ queryKey: ["parts", "sellable"] });
  };
  return {
    reserve: useMutation({ mutationFn: reserveSale, onSuccess: (_r, id) => invalidate(id) }),
    release: useMutation({ mutationFn: releaseSale, onSuccess: (_r, id) => invalidate(id) }),
    fulfill: useMutation({ mutationFn: fulfillSale, onSuccess: (_r, id) => invalidate(id) }),
  };
}

export function useUpdateSalesSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SalesSettings>) => updateSalesSettings(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: salesKeys.settings }),
  });
}
