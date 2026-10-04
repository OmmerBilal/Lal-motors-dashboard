"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCustomer,
  getCustomerHistory,
  getCustomerRecord,
  listCustomerPage,
  listEveryCustomer,
  updateCustomer,
  type CustomerForm,
  type CustomerListRow,
} from "@/lib/data/customers";

export const customerKeys = {
  all: ["customers"] as const,
  list: (search: string) => ["customers", "list", search] as const,
  record: (id: string) => ["customers", "record", id] as const,
  history: (id: string) => ["customers", "history", id] as const,
};

/** Keyset-paged list for the search screen. Each page starts from the previous page's last row. */
export function useCustomerList(search: string) {
  return useInfiniteQuery({
    queryKey: customerKeys.list(search),
    initialPageParam: null as { last: string; first: string; id: string } | null,
    queryFn: ({ pageParam }) => listCustomerPage(search, pageParam),
    getNextPageParam: (page) => {
      if (!page.hasMore || page.rows.length === 0) return undefined;
      const last: CustomerListRow = page.rows[page.rows.length - 1];
      return { last: last.last_name, first: last.first_name, id: last.id };
    },
  });
}

/** Every customer, for pickers that need the whole list (the scrap tire-shop panel). */
export function useAllCustomers() {
  return useQuery({ queryKey: ["customers", "all"], queryFn: listEveryCustomer, staleTime: 60_000 });
}

export function useCustomerRecord(id: string | null) {
  return useQuery({
    queryKey: customerKeys.record(id ?? ""),
    queryFn: () => getCustomerRecord(id ?? ""),
    enabled: !!id,
  });
}

export function useCustomerHistory(id: string | null) {
  return useQuery({
    queryKey: customerKeys.history(id ?? ""),
    queryFn: () => getCustomerHistory(id ?? ""),
    enabled: !!id,
  });
}

/** A save changes the customer lists and that customer's record and history only. */
export function useSaveCustomer() {
  const queryClient = useQueryClient();
  const invalidate = (id: string) => {
    queryClient.invalidateQueries({ queryKey: customerKeys.all });
    queryClient.invalidateQueries({ queryKey: customerKeys.record(id) });
  };
  return {
    create: useMutation({
      mutationFn: (args: { form: CustomerForm; confirmNew: boolean; requestId: string }) =>
        createCustomer(args.form, { confirmNew: args.confirmNew, requestId: args.requestId }),
      onSuccess: (r) => {
        if (r.outcome === "created") invalidate(r.customerId);
        else queryClient.invalidateQueries({ queryKey: customerKeys.all });
      },
    }),
    update: useMutation({
      mutationFn: (args: { id: string; form: Partial<CustomerForm>; confirmNew: boolean }) =>
        updateCustomer(args.id, args.form, { confirmNew: args.confirmNew }),
      onSuccess: (r, args) => {
        if (r.outcome === "updated") invalidate(args.id);
      },
    }),
  };
}
