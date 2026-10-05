"use client";

import { Suspense } from "react";
import { DismantlingWorkspace } from "@/components/dismantling/dismantling-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

function DismantlingPageInner() {
  const { user } = useEffectiveUser();
  return <DismantlingWorkspace user={user} />;
}

export default function DismantlingPage() {
  // The open vehicle is kept in ?assignment=, so a reload returns to the same work. useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <DismantlingPageInner />
    </Suspense>
  );
}
