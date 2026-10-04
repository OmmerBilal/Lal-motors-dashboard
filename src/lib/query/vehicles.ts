"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  closeVehicle,
  getVehicleFilterOptions,
  getVehicleKpis,
  listVehicles,
  reopenVehicle,
  type VehicleListCursor,
  type VehicleListFilters,
} from "@/lib/data/vehicles";

/** Stable query keys. Invalidation is targeted: a vehicle change never resets unrelated caches. */
export const vehicleKeys = {
  all: ["vehicles"] as const,
  lists: () => [...vehicleKeys.all, "list"] as const,
  list: (filters: VehicleListFilters) => [...vehicleKeys.lists(), filters] as const,
  kpis: () => [...vehicleKeys.all, "kpis"] as const,
  filterOptions: () => [...vehicleKeys.all, "filter-options"] as const,
  detail: (id: string) => [...vehicleKeys.all, "detail", id] as const,
};

/**
 * Keyset-paginated list. Each page is requested with the previous page's last row as the cursor,
 * so paging never uses OFFSET. Page N is available once pages 1 .. N-1 are loaded.
 */
export function useVehicleList(filters: VehicleListFilters) {
  return useInfiniteQuery({
    queryKey: vehicleKeys.list(filters),
    initialPageParam: null as VehicleListCursor,
    queryFn: ({ pageParam }) => listVehicles(filters, pageParam),
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.rows.length === 0) return undefined;
      const last = lastPage.rows[lastPage.rows.length - 1];
      return { createdAt: last.created_at, id: last.id };
    },
  });
}

export function useVehicleKpis() {
  return useQuery({ queryKey: vehicleKeys.kpis(), queryFn: getVehicleKpis });
}

export function useVehicleFilterOptions() {
  return useQuery({ queryKey: vehicleKeys.filterOptions(), queryFn: getVehicleFilterOptions, staleTime: 5 * 60_000 });
}

/** After a close, only the lists, KPIs and that vehicle's detail change. Filter options do not. */
export function useCloseVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: closeVehicle,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.kpis() });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.detail(variables.vehicleId) });
    },
  });
}

/** Reopening changes only the lists, KPIs and that vehicle's detail. */
export function useReopenVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reopenVehicle,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.kpis() });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.detail(variables.vehicleId) });
    },
  });
}
