"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRecentVehicleEvents } from "@/lib/query/vehicle-workspace";

/** Filters map to real event actions. The filter runs on the server, so paging stays correct. */
const categories: { id: string; label: string; actions?: string[] }[] = [
  { id: "", label: "All actions" },
  { id: "parts", label: "Parts removed", actions: ["PART_REMOVED"] },
  { id: "exceptions", label: "Issues", actions: ["ISSUE_FLAGGED"] },
  { id: "completion", label: "Completion", actions: ["COMPLETION_SUBMITTED", "COMPLETION_NEEDS_CORRECTION", "COMPLETION_APPROVED", "COMPLETION_CREDIT"] },
];

export function ActivityView({
  onOpenVehicle,
  initialEventType,
}: {
  onOpenVehicle: (id: string) => void;
  initialEventType: string;
}) {
  const initial = categories.some((c) => c.id === initialEventType) ? initialEventType : "";
  const [category, setCategory] = useState(initial);
  const selected = categories.find((c) => c.id === category) ?? categories[0];
  const feed = useRecentVehicleEvents({ actions: selected.actions });
  const rows = feed.data?.pages.flat() ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <Button key={c.id || "all"} size="sm" variant={category === c.id ? "default" : "outline"} onClick={() => setCategory(c.id)}>
            {c.label}
          </Button>
        ))}
      </div>

      {feed.isPending && <p className="text-sm text-muted-foreground" aria-live="polite">Loading activity…</p>}
      {feed.isError && (
        <p role="alert" className="text-sm text-destructive">
          {feed.error instanceof Error ? feed.error.message : "Activity could not be loaded."}
        </p>
      )}

      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {rows.map((e) => (
          <button
            key={e.id}
            onClick={() => onOpenVehicle(e.vehicle_id)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/30"
          >
            <span className="min-w-0">
              <b className="text-sm">{e.action.replaceAll("_", " ")}</b>
              {e.note && <span className="text-sm"> · {e.note}</span>}
              <br />
              <small className="text-xs text-muted-foreground">
                {e.actor_name ?? "Unknown"} · {new Date(e.created_at).toLocaleString()}
              </small>
            </span>
          </button>
        ))}
        {feed.isSuccess && rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No matching activity yet.</p>}
      </div>

      {feed.hasNextPage && (
        <Button variant="outline" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
          {feed.isFetchingNextPage ? "Loading…" : "Load more actions"}
        </Button>
      )}
    </div>
  );
}
