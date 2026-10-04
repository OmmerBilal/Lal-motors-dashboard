"use client";

import { ShieldAlert } from "lucide-react";
import type { User } from "@/lib/types";
import { EmptyState } from "@/components/patterns/empty-state";
import { ExportManagementApp } from "@/components/containers/export/export-management-app";
import { ContainerLoaderApp } from "@/components/containers/loader/container-loader-app";

const exportAuthorizedRoles = new Set(["owner", "engineer_admin", "export_manager"]);

/** Role router for /containers. A loader gets the evidence app; export-authorized roles get export management. */
export function ContainersWorkspace({ user }: { user: User }) {
  if (user.role === "container_loading") {
    return <ContainerLoaderApp />;
  }
  if (exportAuthorizedRoles.has(user.role)) {
    return <ExportManagementApp />;
  }
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Containers & Export is restricted"
      description="Your role doesn't have access to the Container Export module. Front Desk Managers don't receive Export access by default — ask an Owner or Export Manager."
    />
  );
}
