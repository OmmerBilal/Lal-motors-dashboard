"use client";

import type { User } from "@/lib/types";
import { ScrapDriverHome } from "@/components/scrap/driver/scrap-driver-home";
import { ScrapManagerDashboard } from "@/components/scrap/manager/scrap-manager-dashboard";

/** Role router for /scrap. ScrapDataProvider is mounted once at the root app layout. */
export function ScrapTracking({
  user,
  onOpenUsers,
  previewDriverId,
  previewMode = false,
}: {
  user: User;
  onOpenUsers?: () => void;
  initialLoadId?: string;
  previewDriverId?: string;
  previewMode?: boolean;
}) {
  if (user.role === "scrap_driver") {
    return <ScrapDriverHome user={user} previewMode={previewMode} previewDriverId={previewDriverId} />;
  }
  return <ScrapManagerDashboard user={user} onOpenUsers={onOpenUsers} />;
}
