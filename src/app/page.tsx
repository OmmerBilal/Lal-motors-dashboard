"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";

export default function RootPage() {
  const { user } = useSession();
  const router = useRouter();

  useEffect(() => {
    router.replace(user.role === "owner" ? "/dashboard" : "/vehicles");
  }, [user.role, router]);

  return null;
}
