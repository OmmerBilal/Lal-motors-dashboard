"use client";

import { DismantlingWorkspace } from "@/components/dismantling/dismantling-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

export default function DismantlingPage() {
  const { user } = useEffectiveUser();
  return <DismantlingWorkspace user={user} />;
}
