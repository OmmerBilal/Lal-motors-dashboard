"use client";

import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session";
import type { Role, User } from "@/lib/types";

const previewSectionRole: Record<string, { role: Role; label: string }> = {
  auction: { role: "auction", label: "Auction Vehicle Inventory" },
  "front-desk": { role: "manager", label: "Front Desk Manager Portal" },
  warehouse: { role: "employee", label: "Warehouse Employee App" },
  loading: { role: "container_loading", label: "Container Loading Employee" },
  "scrap-driver": { role: "scrap_driver", label: "Scrap Driver App" },
  "vehicle-receiving": { role: "receiving", label: "Vehicle Receiving Employee" },
  dismantling: { role: "dismantling", label: "Dismantling Employee App" },
  "dismantling-processing": { role: "manager", label: "Vehicle Dismantling Processing" },
};

export function useEffectiveUser(): {
  user: User;
  realUser: User;
  isPreview: boolean;
  previewLabel?: string;
} {
  const { user } = useSession();
  const pathname = usePathname();

  if (user.role === "owner" && pathname.startsWith("/preview/")) {
    const section = pathname.split("/")[2];
    const match = previewSectionRole[section];
    if (match) {
      return {
        user: { ...user, role: match.role },
        realUser: user,
        isPreview: true,
        previewLabel: match.label,
      };
    }
  }
  return { user, realUser: user, isPreview: false };
}
