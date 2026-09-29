"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { OwnerAiCommandCenter } from "@/components/owner-ai/owner-ai-command-center";
import { useSession } from "@/lib/session";

export default function AiCommandCenterPage() {
  const { user } = useSession();
  const router = useRouter();
  const allowed = user.role === "owner" || user.role === "engineer_admin";

  useEffect(() => {
    if (!allowed) router.replace("/vehicles");
  }, [allowed, router]);

  if (!allowed) return null;
  return <OwnerAiCommandCenter />;
}
