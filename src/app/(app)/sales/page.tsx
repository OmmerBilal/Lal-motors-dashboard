"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SalesWorkspace } from "@/components/sales/sales-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

function SalesPageInner() {
  const { user } = useEffectiveUser();
  const searchParams = useSearchParams();
  const initialCustomerId = searchParams.get("open");

  return <SalesWorkspace user={user} initialCustomerId={initialCustomerId} />;
}

export default function SalesPage() {
  return (
    <Suspense fallback={null}>
      <SalesPageInner />
    </Suspense>
  );
}
