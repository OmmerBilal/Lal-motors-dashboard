"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addCarrier,
  assignCarrierItems,
  getDispatchCounts,
  listAllVehicles,
  listCarriers,
  postToCentralDispatchLocal,
  updateTransportStatus,
} from "@/lib/data/vehicles";
import { vehicleKeys } from "@/lib/query/vehicles";

/** Dispatch keys live under the vehicle namespace, so one vehicle change invalidates only what it affects. */
export const dispatchKeys = {
  vehicles: () => [...vehicleKeys.all, "dispatch", "vehicles"] as const,
  counts: () => [...vehicleKeys.all, "dispatch", "counts"] as const,
  carriers: () => ["carriers"] as const,
};

export function useDispatchVehicles() {
  return useQuery({ queryKey: dispatchKeys.vehicles(), queryFn: listAllVehicles });
}

export function useDispatchCounts() {
  return useQuery({ queryKey: dispatchKeys.counts(), queryFn: getDispatchCounts });
}

export function useCarriers() {
  return useQuery({ queryKey: dispatchKeys.carriers(), queryFn: listCarriers, staleTime: 5 * 60_000 });
}

/** Dispatch changes: the dispatch lists, dispatch counts and the shared vehicle lists/KPIs. Nothing else. */
function invalidateDispatch(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: dispatchKeys.vehicles() });
  queryClient.invalidateQueries({ queryKey: dispatchKeys.counts() });
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

export function usePostToCentralDispatch() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: postToCentralDispatchLocal, onSuccess: () => invalidateDispatch(queryClient) });
}

export function useAddCarrier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addCarrier,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dispatchKeys.carriers() }),
  });
}
