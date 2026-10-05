"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addCarrier,
  assignCarrierItems,
  getDispatchCounts,
  listCarriers,
  updateTransportStatus,
} from "@/lib/data/vehicles";
import {
  listGroupVehicles,
  listInboundVehicles,
  listPickupGroups,
  type DispatchFilters,
} from "@/lib/data/dispatch-read";
import { vehicleKeys } from "@/lib/query/vehicles";

/** Dispatch keys live under the vehicle namespace, so one vehicle change invalidates only what it affects. */
export const dispatchKeys = {
  groups: (filters: DispatchFilters) => [...vehicleKeys.all, "dispatch", "groups", filters] as const,
  groupVehicles: (group: string, filters: DispatchFilters) => [...vehicleKeys.all, "dispatch", "group", group, filters] as const,
  inbound: () => [...vehicleKeys.all, "inbound"] as const,
  counts: () => [...vehicleKeys.all, "dispatch", "counts"] as const,
  carriers: () => ["carriers"] as const,
};

/** One page of pickup-location summaries. Next pages use the server's group key as the cursor. */
export function usePickupGroups(filters: DispatchFilters) {
  return useInfiniteQuery({
    queryKey: dispatchKeys.groups(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listPickupGroups(filters, pageParam),
    getNextPageParam: (last) => (last.hasMore ? last.nextAfter : undefined),
  });
}

/** Vehicles of one pickup location, loaded only while the group is open. Keyset-paged on (created_at, id). */
export function useGroupVehicles(group: string, filters: DispatchFilters, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: dispatchKeys.groupVehicles(group, filters),
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => listGroupVehicles(group, filters, pageParam),
    getNextPageParam: (last) => {
      if (!last.hasMore || last.rows.length === 0) return undefined;
      const tail = last.rows[last.rows.length - 1];
      return { createdAt: tail.created_at, id: tail.id };
    },
    enabled,
  });
}

export function useInboundVehicles() {
  return useQuery({ queryKey: dispatchKeys.inbound(), queryFn: listInboundVehicles });
}

export function useDispatchCounts() {
  return useQuery({ queryKey: dispatchKeys.counts(), queryFn: getDispatchCounts });
}

export function useCarriers() {
  return useQuery({ queryKey: dispatchKeys.carriers(), queryFn: listCarriers, staleTime: 5 * 60_000 });
}

/** Dispatch changes: the dispatch lists, dispatch counts and the shared vehicle lists/KPIs. Nothing else. */
function invalidateDispatch(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: [...vehicleKeys.all, "dispatch"] });
  queryClient.invalidateQueries({ queryKey: dispatchKeys.inbound() });
  queryClient.invalidateQueries({ queryKey: vehicleKeys.lists() });
  queryClient.invalidateQueries({ queryKey: vehicleKeys.kpis() });
}

export function useAssignCarrierItems() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: assignCarrierItems, onSuccess: () => invalidateDispatch(queryClient) });
}

export function useUpdateTransportStatus() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: updateTransportStatus, onSuccess: () => invalidateDispatch(queryClient) });
}

export function useAddCarrier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addCarrier,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dispatchKeys.carriers() }),
  });
}
