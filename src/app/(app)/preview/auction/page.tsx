"use client";

import { VehicleWorkspace } from "@/components/vehicles/vehicle-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

export default function PreviewAuctionPage() {
  const { user } = useEffectiveUser();
  return <VehicleWorkspace user={user} />;
}
