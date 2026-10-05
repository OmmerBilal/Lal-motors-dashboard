"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AiCommandCenter } from "@/components/ai/ai-command-center";
import { useSession } from "@/lib/session";

const ALLOWED = ["owner", "engineer_admin", "manager", "export_manager"];

export default function AiCommandCenterPage() {
  const { user } = useSession();
  const router = useRouter();
  const allowed = ALLOWED.includes(user.role);

  useEffect(() => {
    if (!allowed) router.replace("/vehicles");
  }, [allowed, router]);

  if (!allowed) return null;
  return <AiCommandCenter role={user.role} />;
}
