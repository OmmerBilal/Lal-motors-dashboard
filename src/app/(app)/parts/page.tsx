"use client";

import { PartsWorkspace } from "@/components/parts/parts-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

export default function PartsPage() {
  const { user } = useEffectiveUser();
  return <PartsWorkspace user={user} />;
}
