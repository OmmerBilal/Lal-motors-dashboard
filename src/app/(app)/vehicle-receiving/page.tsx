"use client";

import { Suspense } from "react";
import { VehicleReceiving } from "@/components/vehicle-receiving/vehicle-receiving";
import { useEffectiveUser } from "@/lib/effective-user";

export default function VehicleReceivingPage() {
  const { user } = useEffectiveUser();
  // The Auction deep link reads ?vehicle= with useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <VehicleReceiving user={user} />
    </Suspense>
  );
}
