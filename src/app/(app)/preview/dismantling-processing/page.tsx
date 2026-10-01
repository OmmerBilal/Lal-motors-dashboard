"use client";

import { DismantlingProcessingWorkspace } from "@/components/dismantling-processing/dismantling-processing-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

export default function PreviewDismantlingProcessingPage() {
  const { user } = useEffectiveUser();
  return <DismantlingProcessingWorkspace user={user} />;
}
