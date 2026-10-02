"use client";

import { ShieldAlert } from "lucide-react";
import type { User } from "@/lib/types";
import { EmptyState } from "@/components/patterns/empty-state";
import { ExportManagementView } from "@/components/containers/export-management-view";
import { ContainerLoadingView } from "@/components/containers/container-loading-view";

const exportAuthorizedRoles = new Set(["owner", "engineer_admin", "export_manager"]);

export function ContainersWorkspace({ user, previewMode = false }: { user: User; previewMode?: boolean }) {
  if (user.role === "container_loading") {
    return <ContainerLoadingView user={user} previewMode={previewMode} />;
  }
  if (exportAuthorizedRoles.has(user.role)) {
    return <ExportManagementView user={user} />;
  }
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Containers & Export is restricted"
      description="Your role doesn't have access to the Container Export module. Front Desk Managers don't receive Export access by default — ask an Owner or Export Manager."
    />
  );
}
