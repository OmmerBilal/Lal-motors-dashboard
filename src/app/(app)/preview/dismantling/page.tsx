"use client";

import { Suspense } from "react";
import { DismantlingWorkspace } from "@/components/dismantling/dismantling-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

function PreviewDismantlingInner() {
  const { user } = useEffectiveUser();
  return <DismantlingWorkspace user={user} />;
}

export default function PreviewDismantlingPage() {
  return (
    <Suspense fallback={null}>
      <PreviewDismantlingInner />
    </Suspense>
  );
}
