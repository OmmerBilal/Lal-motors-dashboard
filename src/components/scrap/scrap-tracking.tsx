"use client";

import type { User } from "@/lib/types";
import { ScrapDriverHome } from "@/components/scrap/driver/scrap-driver-home";
import { ScrapManagerDashboard } from "@/components/scrap/manager/scrap-manager-dashboard";

/** Role router for /scrap. A Scrap Driver gets the evidence-only app; management roles get the dashboard. */
export function ScrapTracking({ user, onOpenUsers }: { user: User; onOpenUsers?: () => void }) {
  if (user.role === "scrap_driver") {
    return <ScrapDriverHome user={user} />;
  }
  return <ScrapManagerDashboard user={user} onOpenUsers={onOpenUsers} />;
}
