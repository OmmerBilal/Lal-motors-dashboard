"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { VehicleWorkspace } from "@/components/vehicles/vehicle-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

function DashboardPageInner() {
  const { user } = useEffectiveUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialVehicleId = searchParams.get("open");
  const allowed = user.role === "owner";

  useEffect(() => {
    if (!allowed) router.replace("/vehicles");
  }, [allowed, router]);

  if (!allowed) return null;
  return <VehicleWorkspace user={user} initialVehicleId={initialVehicleId} />;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardPageInner />
    </Suspense>
  );
}
