"use client";

import { CentralDispatch } from "@/components/central-dispatch/central-dispatch";
import { useEffectiveUser } from "@/lib/effective-user";

export default function CentralDispatchPage() {
  const { user } = useEffectiveUser();
  return <CentralDispatch user={user} />;
}
