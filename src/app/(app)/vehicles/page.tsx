"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { VehicleWorkspace } from "@/components/vehicles/vehicle-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

function VehiclesPageInner() {
  const { user } = useEffectiveUser();
  const searchParams = useSearchParams();
  const initialVehicleId = searchParams.get("open");

  return <VehicleWorkspace user={user} initialVehicleId={initialVehicleId} />;
}

export default function VehiclesPage() {
  return (
    <Suspense fallback={null}>
      <VehiclesPageInner />
    </Suspense>
  );
}
