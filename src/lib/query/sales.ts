"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSaleWithPayment, getCustomerOutstanding, receiveCustomerPayment, type CheckoutResult } from "@/lib/data/sales-checkout";
import { customerKeys } from "@/lib/query/customers";
import {
  createSale,
  fetchPosThumbnailUrls,
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

/** The desk searches only after two characters. Nothing is requested for an empty or one-character search. */
export function useSellableParts(search: string) {
  const term = search.trim();
  return useQuery({
    queryKey: partKeys.sellable(term),
    queryFn: () => searchSellableParts(term),
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
  });
}

/** Sale and optional payment in one step. Sale lists, customer history and the sellable list refresh. */
export function useCheckoutSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: Parameters<typeof createSaleWithPayment>[0]): Promise<CheckoutResult> => createSaleWithPayment(args),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: salesKeys.all });
      queryClient.invalidateQueries({ queryKey: ["parts", "sellable"] });
      queryClient.invalidateQueries({ queryKey: customerKeys.history(args.customerId) });
      queryClient.invalidateQueries({ queryKey: ["customers", "outstanding", args.customerId] });
    },
  });
}

export function useCustomerOutstanding(customerId: string | null | undefined) {
  return useQuery({
    queryKey: ["customers", "outstanding", customerId ?? ""],
    queryFn: () => getCustomerOutstanding(customerId as string),
    enabled: !!customerId,
  });
}

/** A receipt changes that customer's outstanding balance, history and sales. Nothing else. */
export function useReceiveCustomerPayment(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: Parameters<typeof receiveCustomerPayment>[0]) => receiveCustomerPayment(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers", "outstanding", customerId] });
      queryClient.invalidateQueries({ queryKey: customerKeys.history(customerId) });
      queryClient.invalidateQueries({ queryKey: salesKeys.all });
    },
  });
}

/** Thumbnails for the visible results only. Signed URLs are short-lived, so the cache is short too. */
export function usePosThumbnails(partIds: string[]) {
  const key = [...partIds].sort().join(",");
  return useQuery({
    queryKey: ["parts", "thumbnails", key],
    queryFn: () => fetchPosThumbnailUrls(partIds),
    enabled: partIds.length > 0,
    staleTime: 60_000,
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
