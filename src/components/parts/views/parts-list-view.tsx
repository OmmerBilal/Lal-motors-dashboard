"use client";

import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { usePartsData } from "@/components/parts/parts-data-context";
import type { PartStatus } from "@/lib/mock/parts";

export function PartsListView({ scope, onOpen }: { scope: "pending" | "inventory"; onOpen: (id: string) => void }) {
  const { parts } = usePartsData();
  const pendingStatuses: PartStatus[] = ["captured", "draft_ready", "manager_review"];
  const list = parts.filter((p) => (scope === "pending" ? pendingStatuses.includes(p.status) : p.status === "approved"));

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border p-4">
        <h3 className="text-sm font-semibold">{scope === "pending" ? "Pending Parts Queue" : "Permanent Parts Inventory"}</h3>
        <p className="text-xs text-muted-foreground">{list.length} record(s)</p>
      </div>
      {list.length ? (
        <div className="divide-y divide-border">
          {list.map((p) => (
            <button
              key={p.id}
              onClick={() => onOpen(p.id)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-accent/30"
            >
              <div className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                Photo
              </div>
              {/* flex-[1.6] + line-clamp-2 + title: give the name more of the row and let it wrap instead of
                  cutting off, with a tooltip for the rare name still too long to show in full. */}
              <span className="min-w-0 flex-[1.6]">
                <b className="line-clamp-2 text-sm" title={p.draft.partName || "Pending identification"}>
                  {p.draft.partName || "Pending identification"}
                </b>
                <small className="text-xs text-muted-foreground">
                  {p.stockSku || p.draft.partNumber || `Captured ${new Date(p.createdAt).toLocaleString()}`}
                </small>
              </span>
              <span className="hidden min-w-0 flex-1 sm:block">
                <b className="block truncate text-sm">
                  {p.draft.sourceVin ? `VIN ${p.draft.sourceVin}` : p.draft.sourceLot ? `Lot ${p.draft.sourceLot}` : "Source photo linked"}
                </b>
                <small className="text-xs text-muted-foreground">{p.capturedByName}</small>
              </span>
              <StatusBadge className="shrink-0">{p.status.replaceAll("_", " ")}</StatusBadge>
            </button>
          ))}
        </div>
      ) : (
        <div className="p-6">
          <EmptyState icon={ScanLine} title="No records in this queue" />
        </div>
      )}
      <LoadMorePartsButton />
    </div>
  );
}

/** Next page of the parts list from the server. Shown only when more rows exist. */
function LoadMorePartsButton() {
  const { hasMoreParts, loadingMoreParts, loadMoreParts } = usePartsData();
  if (!hasMoreParts) return null;
  return (
    <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={loadMoreParts} disabled={loadingMoreParts}>
      {loadingMoreParts ? "Loading…" : "Load more parts"}
    </Button>
  );
}
