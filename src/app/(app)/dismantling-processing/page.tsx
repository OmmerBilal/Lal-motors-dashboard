"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DismantlingProcessingWorkspace } from "@/components/dismantling-processing/dismantling-processing-workspace";
import { useEffectiveUser } from "@/lib/effective-user";
import { getPrimaryNav } from "@/lib/nav";

const allowedRoles = new Set(["owner", "engineer_admin", "manager"]);

export default function DismantlingProcessingPage() {
  const { user, realUser } = useEffectiveUser();
  const router = useRouter();
  const allowed = allowedRoles.has(user.role);

  useEffect(() => {
    if (!allowed) {
      router.replace(getPrimaryNav(realUser.role)[0]?.href ?? "/login");
    }
  }, [allowed, realUser.role, router]);

  if (!allowed) return null;
  return <DismantlingProcessingWorkspace user={user} />;
}
