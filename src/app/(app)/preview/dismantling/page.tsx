"use client";

import { DismantlingWorkspace } from "@/components/dismantling/dismantling-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

export default function PreviewDismantlingPage() {
  const { user } = useEffectiveUser();
  return <DismantlingWorkspace user={user} />;
}
