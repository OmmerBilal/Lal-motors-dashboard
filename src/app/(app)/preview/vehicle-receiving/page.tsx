"use client";

import { VehicleReceiving } from "@/components/vehicle-receiving/vehicle-receiving";
import { useEffectiveUser } from "@/lib/effective-user";

export default function PreviewVehicleReceivingPage() {
  const { user } = useEffectiveUser();
  return <VehicleReceiving user={user} />;
}
