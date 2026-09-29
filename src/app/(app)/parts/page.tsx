"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PartsWorkspace } from "@/components/parts/parts-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

function PartsPageInner() {
  const { user } = useEffectiveUser();
  const searchParams = useSearchParams();
  const initialPartId = searchParams.get("open");

  return <PartsWorkspace user={user} initialPartId={initialPartId} />;
}

export default function PartsPage() {
  return (
    <Suspense fallback={null}>
      <PartsPageInner />
    </Suspense>
  );
}
