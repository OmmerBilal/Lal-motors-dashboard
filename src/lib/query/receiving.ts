"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { receiveVehicleNow } from "@/lib/data/receiving";
import { vehicleKeys } from "@/lib/query/vehicles";

/** Receiving changes the vehicle lists and KPIs, and that vehicle's detail. Nothing else. */
export function useReceiveVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vehicleId: string) => receiveVehicleNow(vehicleId),
    onSuccess: (_data, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.kpis() });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.detail(vehicleId) });
    },
  });
}
