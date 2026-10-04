"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  convertQuote,
  createQuote,
  getQuoteDetail,
  listQuotePage,
  setQuoteStatus,
  updateQuote,
  type QuoteListRow,
  type QuoteStatus,
} from "@/lib/data/quotes";
import type { SaleLineInput, SaleMode } from "@/lib/data/sales";
import { salesKeys } from "@/lib/query/sales";

export const quoteKeys = {
  all: ["quotes"] as const,
  list: (search: string, status: QuoteStatus | null) => ["quotes", "list", search, status ?? "all"] as const,
  detail: (id: string) => ["quotes", "detail", id] as const,
};

/** Keyset-paged quote list. Each page starts after the previous page's last row. */
export function useQuoteList(search: string, status: QuoteStatus | null) {
  return useInfiniteQuery({
    queryKey: quoteKeys.list(search, status),
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => listQuotePage(search, status, pageParam),
    getNextPageParam: (page) => {
      if (!page.hasMore || page.rows.length === 0) return undefined;
      const last: QuoteListRow = page.rows[page.rows.length - 1];
      return { createdAt: last.created_at, id: last.id };
    },
  });
}

export function useQuoteDetail(id: string | null) {
  return useQuery({
    queryKey: quoteKeys.detail(id ?? ""),
    queryFn: () => getQuoteDetail(id ?? ""),
    enabled: !!id,
  });
}

export function useCreateQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { customerId: string; lines: SaleLineInput[]; discount: number; notes: string; clientRequestId: string }) => createQuote(args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quoteKeys.all }),
  });
}

export function useUpdateQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateQuote,
    onSuccess: (_r, args) => {
      queryClient.invalidateQueries({ queryKey: quoteKeys.detail(args.quoteId) });
      queryClient.invalidateQueries({ queryKey: ["quotes", "list"] });
    },
  });
}

export function useSetQuoteStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { quoteId: string; status: QuoteStatus }) => setQuoteStatus(args.quoteId, args.status),
    onSuccess: (_r, args) => {
      queryClient.invalidateQueries({ queryKey: quoteKeys.detail(args.quoteId) });
      queryClient.invalidateQueries({ queryKey: ["quotes", "list"] });
    },
  });
}

/** A conversion creates a sale, reserves or consumes stock, and locks the quote. Those lists all change. */
export function useConvertQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { quoteId: string; mode: SaleMode }) => convertQuote(args.quoteId, args.mode),
    onSuccess: (_r, args) => {
      queryClient.invalidateQueries({ queryKey: quoteKeys.detail(args.quoteId) });
      queryClient.invalidateQueries({ queryKey: ["quotes", "list"] });
      queryClient.invalidateQueries({ queryKey: salesKeys.all });
      queryClient.invalidateQueries({ queryKey: ["parts", "sellable"] });
    },
  });
}
