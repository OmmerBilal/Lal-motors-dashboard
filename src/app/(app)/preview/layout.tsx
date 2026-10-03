"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { homeForRole } from "@/lib/auth/route-access";

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (user.role !== "owner") router.replace(homeForRole(user.role));
  }, [user.role, router]);

  if (user.role !== "owner") return null;
  return <>{children}</>;
}
