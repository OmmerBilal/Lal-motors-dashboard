"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  allocatePayment,
  createPayment,
  getPaymentDetail,
  getPaymentsSummary,
  listPaymentPage,
  listSalePayments,
  postPayment,
  voidPayment,
  type PaymentListRow,
  type PaymentStatus,
} from "@/lib/data/payments";
import type { PaymentMethod } from "@/lib/mock/sales";
import { salesKeys } from "@/lib/query/sales";
import { customerKeys } from "@/lib/query/customers";

type IsoRange = { from: string | null; to: string | null };

export const paymentKeys = {
  all: ["payments"] as const,
  list: (search: string, status: PaymentStatus | null, range: IsoRange) =>
    ["payments", "list", search, status ?? "all", range.from ?? "", range.to ?? ""] as const,
  summary: (range: IsoRange) => ["payments", "summary", range.from ?? "", range.to ?? ""] as const,
  detail: (id: string) => ["payments", "detail", id] as const,
  forSale: (saleId: string) => ["payments", "sale", saleId] as const,
};

export function usePaymentList(search: string, status: PaymentStatus | null, range: IsoRange = { from: null, to: null }) {
  return useInfiniteQuery({
    queryKey: paymentKeys.list(search, status, range),
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => listPaymentPage(search, status, pageParam, 25, range),
    getNextPageParam: (page) => {
      if (!page.hasMore || page.rows.length === 0) return undefined;
      const last: PaymentListRow = page.rows[page.rows.length - 1];
      return { createdAt: last.created_at, id: last.id };
    },
  });
}

/** Range totals for the Payments KPI row — same range the list above uses, so they agree. */
export function usePaymentsSummary(range: IsoRange) {
  return useQuery({
    queryKey: paymentKeys.summary(range),
    queryFn: () => getPaymentsSummary(range),
  });
}

export function usePaymentDetail(id: string | null) {
  return useQuery({ queryKey: paymentKeys.detail(id ?? ""), queryFn: () => getPaymentDetail(id ?? ""), enabled: !!id });
}

export function useSalePayments(saleId: string | null) {
  return useQuery({ queryKey: paymentKeys.forSale(saleId ?? ""), queryFn: () => listSalePayments(saleId ?? ""), enabled: !!saleId });
}

/** A pending payment changes no sale. It only adds to the payment list and the customer's history. */
export function useCreatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { customerId: string; amount: string; method: PaymentMethod; reference: string; notes: string; clientRequestId: string }) =>
      createPayment(args),
    onSuccess: (_r, args) => {
      queryClient.invalidateQueries({ queryKey: ["payments", "list"] });
      queryClient.invalidateQueries({ queryKey: customerKeys.history(args.customerId) });
    },
  });
}

/** Allocation is bookkeeping. It refreshes the payment and the Sale's payment list, not the Sale's money. */
export function useAllocatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { paymentId: string; saleId: string; amount: string }) => allocatePayment(args),
    onSuccess: (_r, args) => {
      queryClient.invalidateQueries({ queryKey: paymentKeys.detail(args.paymentId) });
      queryClient.invalidateQueries({ queryKey: paymentKeys.forSale(args.saleId) });
      queryClient.invalidateQueries({ queryKey: ["payments", "list"] });
    },
  });
}

/** Posting and voiding change the money on each allocated sale. Only those sales and this customer refresh. */
function invalidateMoneyChange(
  queryClient: ReturnType<typeof useQueryClient>,
  paymentId: string,
  customerId: string,
  saleIds: string[]
) {
  queryClient.invalidateQueries({ queryKey: paymentKeys.detail(paymentId) });
  queryClient.invalidateQueries({ queryKey: ["payments", "list"] });
  queryClient.invalidateQueries({ queryKey: customerKeys.history(customerId) });
  for (const saleId of saleIds) {
    queryClient.invalidateQueries({ queryKey: paymentKeys.forSale(saleId) });
    queryClient.invalidateQueries({ queryKey: salesKeys.detail(saleId) });
  }
  queryClient.invalidateQueries({ queryKey: ["sales", "list"] });
}

export function usePostPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { paymentId: string; customerId: string; saleIds: string[] }) => postPayment(args.paymentId),
    onSuccess: (_r, args) => invalidateMoneyChange(queryClient, args.paymentId, args.customerId, args.saleIds),
  });
}

export function useVoidPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { paymentId: string; reason: string; customerId: string; saleIds: string[] }) => voidPayment(args.paymentId, args.reason),
    onSuccess: (_r, args) => invalidateMoneyChange(queryClient, args.paymentId, args.customerId, args.saleIds),
  });
}
