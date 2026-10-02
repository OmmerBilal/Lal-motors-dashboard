"use client";

import { ContainersWorkspace } from "@/components/containers/containers-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

export default function PreviewLoadingPage() {
  const { user } = useEffectiveUser();
  return <ContainersWorkspace user={user} previewMode />;
}
