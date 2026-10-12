"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSaleWithPayment, getCustomerOutstanding, receiveCustomerPayment, type CheckoutResult } from "@/lib/data/sales-checkout";
import { customerKeys } from "@/lib/query/customers";
import {
  createSale,
  fetchPosThumbnailUrls,
  fulfillSale,
  getSaleDetail,
  getSalesSettings,
  getSalesSummary,
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

type IsoRange = { from: string | null; to: string | null };

export const salesKeys = {
  all: ["sales"] as const,
  list: (search: string, status: string | null, range: IsoRange) =>
    ["sales", "list", search, status ?? "all", range.from ?? "", range.to ?? ""] as const,
  summary: (range: IsoRange) => ["sales", "summary", range.from ?? "", range.to ?? ""] as const,
  detail: (id: string) => ["sales", "detail", id] as const,
  settings: ["sales", "settings"] as const,
  customerQuotes: (customerId: string) => ["sales", "customer-quotes", customerId] as const,
};

export const partKeys = {
  sellable: (search: string) => ["parts", "sellable", search] as const,
};

/** Keyset-paged sales list, optionally bounded to a created_at range (the date-range selector). */
export function useSaleList(search: string, status: string | null, range: IsoRange = { from: null, to: null }) {
  return useInfiniteQuery({
    queryKey: salesKeys.list(search, status, range),
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => listSalePage(search, status, pageParam, 25, range),
    getNextPageParam: (page) => {
      if (!page.hasMore || page.rows.length === 0) return undefined;
      const last: SaleListRow = page.rows[page.rows.length - 1];
      return { createdAt: last.created_at, id: last.id };
    },
  });
}

/** Range totals for the Sales & Invoices KPI row — same range the list above uses, so they agree. */
export function useSalesSummary(range: IsoRange) {
  return useQuery({
    queryKey: salesKeys.summary(range),
    queryFn: () => getSalesSummary(range),
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

/**
 * Per-customer balances for a list of customer ids, for the Customers list's balance column/filter.
 * list_customers (the list RPC) carries no balance field, and the only existing balance read model,
 * customer_outstanding, is per-customer (the same one the "receive payment" flow and the customer
 * detail page already use) — so this fans out one call per id rather than inventing a new
 * calculation. Each query shares its cache key with useCustomerOutstanding above, so opening a
 * customer's detail page (or paging back to a list already fetched) costs nothing extra. Bounded to
 * the ids passed in — callers should pass only the currently-loaded page of rows, not the whole table.
 */
export function useCustomersOutstanding(customerIds: string[]) {
  const results = useQueries({
    queries: customerIds.map((id) => ({
      queryKey: ["customers", "outstanding", id],
      queryFn: () => getCustomerOutstanding(id),
      staleTime: 30_000,
    })),
  });
  const byId: Record<string, number> = {};
  results.forEach((r, i) => {
    if (r.data) byId[customerIds[i]] = Number(r.data.total_outstanding) || 0;
  });
  return { byId, isLoading: results.some((r) => r.isPending) };
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
