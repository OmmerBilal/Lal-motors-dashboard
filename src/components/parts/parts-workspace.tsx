"use client";

import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { User } from "@/lib/types";
import { PartsListView } from "@/components/parts/views/parts-list-view";
import { PartDetailView } from "@/components/parts/views/part-detail-view";
import { PartsInventoryView } from "@/components/parts/views/parts-inventory-view";
import { usePartsData } from "@/components/parts/parts-data-context";
import type { PartStatus } from "@/lib/mock/parts";

type Tab = "pending" | "inventory";

const PENDING_STATUSES: PartStatus[] = ["captured", "draft_ready", "manager_review"];

function WorkspaceBody({ user, initialPartId }: { user: User; initialPartId?: string | null }) {
  const manager = user.role !== "employee";
  const { getPart } = usePartsData();
  const initialPart = initialPartId ? getPart(initialPartId) : undefined;
  const initialIsPending = !!initialPart && PENDING_STATUSES.includes(initialPart.status);

  const [view, setView] = useState<Tab>(initialPart && !initialIsPending ? "inventory" : "pending");
  const [selectedId, setSelectedId] = useState<string | null>(initialIsPending ? (initialPartId ?? null) : null);

  if (selectedId) {
    return <PartDetailView partId={selectedId} manager={manager} origin="pending" onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="space-y-5">
      {view === "inventory" ? (
        <div>
          <h2 className="text-xl font-semibold">Parts Inventory</h2>
          <p className="mt-1 text-sm text-muted-foreground">Manage, process, and track all salvaged parts</p>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg bg-brand p-5 text-brand-foreground">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-accent-gold uppercase">Front Desk Parts Operations</p>
            <h2 className="mt-1 text-xl font-semibold">Pending Parts &amp; Inventory</h2>
            <p className="mt-1 text-sm text-brand-foreground/70">Review employee captures, and approve inventory.</p>
          </div>
          <PackageCheck className="hidden size-12 text-accent-gold/60 sm:block" />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant={view === "pending" ? "default" : "outline"} size="sm" onClick={() => setView("pending")}>
          Pending Queue
        </Button>
        {manager && (
          <Button variant={view === "inventory" ? "default" : "outline"} size="sm" onClick={() => setView("inventory")}>
            Parts Inventory
          </Button>
        )}
      </div>

      {view === "pending" && <PartsListView scope="pending" onOpen={(id) => setSelectedId(id)} />}
      {view === "inventory" && <PartsInventoryView manager={manager} initialPartId={initialIsPending ? null : initialPartId} />}
    </div>
  );
}

export function PartsWorkspace({ user, initialPartId }: { user: User; initialPartId?: string | null }) {
  return <WorkspaceBody user={user} initialPartId={initialPartId} />;
}
