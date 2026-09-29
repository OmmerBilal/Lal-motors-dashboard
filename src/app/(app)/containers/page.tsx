"use client";

import { ContainersWorkspace } from "@/components/containers/containers-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

export default function ContainersPage() {
  const { user } = useEffectiveUser();
  return <ContainersWorkspace user={user} />;
}
