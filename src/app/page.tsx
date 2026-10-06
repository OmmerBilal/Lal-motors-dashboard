"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSessionState } from "@/lib/session";
import { homeForRole } from "@/lib/auth/route-access";

/** Public entry point. It reads the whole session state, so signed-out and profile-loading are handled, not thrown on. */
export default function RootPage() {
  const session = useSessionState();
  const router = useRouter();
  const role = session.user?.role;

  useEffect(() => {
    if (session.status === "signed-in" && role) router.replace(homeForRole(role));
    else if (session.status === "signed-out") router.replace("/login");
  }, [session.status, role, router]);

  return null;
}
