"use client";

import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { User } from "@/lib/types";
import { CaptureView } from "@/components/parts/views/capture-view";
import { PartsListView } from "@/components/parts/views/parts-list-view";
import { PartDetailView } from "@/components/parts/views/part-detail-view";
import { PartsInventoryView } from "@/components/parts/views/parts-inventory-view";
import { usePartsData } from "@/components/parts/parts-data-context";
import type { PartStatus } from "@/lib/mock/parts";

type Tab = "capture" | "pending" | "inventory";

const PENDING_STATUSES: PartStatus[] = ["captured", "draft_ready", "manager_review"];

function WorkspaceBody({ user, initialPartId }: { user: User; initialPartId?: string | null }) {
  const manager = user.role !== "employee";
  const { getPart } = usePartsData();
  const initialPart = initialPartId ? getPart(initialPartId) : undefined;
  const initialIsPending = !!initialPart && PENDING_STATUSES.includes(initialPart.status);

  const [view, setView] = useState<Tab>(
    initialPart
      ? initialIsPending
        ? "pending"
        : "inventory"
      : user.role === "manager" || user.role === "engineer_admin"
        ? "pending"
        : "capture"
  );
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
            <p className="text-xs font-semibold tracking-[0.12em] text-accent-gold uppercase">
              {manager ? "Front Desk Parts Operations" : "Warehouse Employee"}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{manager ? "Pending Parts & Inventory" : "Quick Part Capture"}</h2>
            <p className="mt-1 text-sm text-brand-foreground/70">
              {manager ? "Review employee captures, use Parts AI, and approve inventory." : "Part photo → VIN/Lot photo → Save & Next"}
            </p>
          </div>
          <PackageCheck className="hidden size-12 text-accent-gold/60 sm:block" />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant={view === "capture" ? "default" : "outline"} size="sm" onClick={() => setView("capture")}>
          Quick Part Capture
        </Button>
        {manager && (
          <Button variant={view === "pending" ? "default" : "outline"} size="sm" onClick={() => setView("pending")}>
            Pending Queue
          </Button>
        )}
        {manager && (
          <Button variant={view === "inventory" ? "default" : "outline"} size="sm" onClick={() => setView("inventory")}>
            Parts Inventory
          </Button>
        )}
      </div>

      {view === "capture" && <CaptureView />}
      {view === "pending" && <PartsListView scope="pending" onOpen={(id) => setSelectedId(id)} />}
      {view === "inventory" && <PartsInventoryView manager={manager} initialPartId={initialIsPending ? null : initialPartId} />}
    </div>
  );
}

export function PartsWorkspace({ user, initialPartId }: { user: User; initialPartId?: string | null }) {
  return <WorkspaceBody user={user} initialPartId={initialPartId} />;
}
