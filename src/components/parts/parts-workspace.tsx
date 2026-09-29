"use client";

import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { User } from "@/lib/types";
import { PartsDataProvider } from "@/components/parts/parts-data-context";
import { CaptureView } from "@/components/parts/views/capture-view";
import { PartsListView } from "@/components/parts/views/parts-list-view";
import { PartDetailView } from "@/components/parts/views/part-detail-view";

type Tab = "capture" | "pending" | "inventory";

function WorkspaceBody({ user }: { user: User }) {
  const manager = user.role !== "employee";
  const [view, setView] = useState<Tab>(user.role === "manager" || user.role === "engineer_admin" ? "pending" : "capture");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<"pending" | "inventory">("pending");

  function open(id: string, from: "pending" | "inventory") {
    setOrigin(from);
    setSelectedId(id);
  }

  if (selectedId) {
    return <PartDetailView partId={selectedId} manager={manager} origin={origin} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="space-y-5">
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
      {view === "pending" && <PartsListView scope="pending" onOpen={(id) => open(id, "pending")} />}
      {view === "inventory" && <PartsListView scope="inventory" onOpen={(id) => open(id, "inventory")} />}
    </div>
  );
}

export function PartsWorkspace({ user }: { user: User }) {
  return (
    <PartsDataProvider>
      <WorkspaceBody user={user} />
    </PartsDataProvider>
  );
}
