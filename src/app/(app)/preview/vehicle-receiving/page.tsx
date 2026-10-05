"use client";

import { Suspense } from "react";
import { VehicleReceiving } from "@/components/vehicle-receiving/vehicle-receiving";
import { useEffectiveUser } from "@/lib/effective-user";

export default function PreviewVehicleReceivingPage() {
  const { user } = useEffectiveUser();
  return (
    <Suspense fallback={null}>
      <VehicleReceiving user={user} />
    </Suspense>
  );
}
