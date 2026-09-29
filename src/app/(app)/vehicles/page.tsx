"use client";

import { OwnerScrapSummary } from "@/components/vehicles/owner-scrap-summary";
import { VehicleWorkspace } from "@/components/vehicles/vehicle-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

export default function VehiclesPage() {
  const { user } = useEffectiveUser();

  return (
    <div>
      {user.role === "owner" && <OwnerScrapSummary />}
      <VehicleWorkspace user={user} />
    </div>
  );
}
