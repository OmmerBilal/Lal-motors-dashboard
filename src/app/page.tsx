"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { homeForRole } from "@/lib/auth/route-access";

export default function RootPage() {
  const { user } = useSession();
  const router = useRouter();

  useEffect(() => {
    router.replace(homeForRole(user.role));
  }, [user.role, router]);

  return null;
}
