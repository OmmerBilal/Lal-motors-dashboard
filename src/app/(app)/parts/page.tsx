"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PartsWorkspace } from "@/components/parts/parts-workspace";
import { WarehouseApp } from "@/components/warehouse/warehouse-app";
import { useEffectiveUser } from "@/lib/effective-user";

function PartsPageInner() {
  const { user } = useEffectiveUser();
  const searchParams = useSearchParams();
  const initialPartId = searchParams.get("open");

  // The Warehouse Employee App is a simple location workspace. Dismantling capture and loading jobs are not here.
  if (user.role === "employee") {
    return <WarehouseApp />;
  }
  return <PartsWorkspace user={user} initialPartId={initialPartId} />;
}

export default function PartsPage() {
  return (
    <Suspense fallback={null}>
      <PartsPageInner />
    </Suspense>
  );
}
