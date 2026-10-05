"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getArrivedTodayCount, receiveVehicleNow } from "@/lib/data/receiving";
import { vehicleKeys } from "@/lib/query/vehicles";

export const receivingKeys = {
  arrivedToday: () => ["receiving", "arrived-today"] as const,
};

/** Vehicles received today, from the database. Refreshed when a receipt succeeds. */
export function useArrivedTodayCount() {
  return useQuery({ queryKey: receivingKeys.arrivedToday(), queryFn: getArrivedTodayCount });
}

/** Receiving changes the vehicle lists and KPIs, that vehicle's detail, and today's arrival count. Nothing else. */
export function useReceiveVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vehicleId: string) => receiveVehicleNow(vehicleId),
    onSuccess: (_data, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.kpis() });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.detail(vehicleId) });
      queryClient.invalidateQueries({ queryKey: receivingKeys.arrivedToday() });
    },
  });
}
