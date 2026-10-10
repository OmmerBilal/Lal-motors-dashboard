"use client";

import { Activity, ClipboardCheck, Flag, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import type { LucideIcon } from "lucide-react";

export type TimelineItem = { id: string; time: string; title: string; subtitle: string; vehicleId?: string };

function iconFor(title: string): LucideIcon {
  const t = title.toLowerCase();
  if (t.includes("part")) return Wrench;
  if (t.includes("status") || t.includes("complete")) return ClipboardCheck;
  if (t.includes("flag") || t.includes("issue")) return Flag;
  return Activity;
}

/** "Today's Activities" — a compact timeline of today's real vehicle_events (owner_dashboard_activity). */
export function ActivityTimeline({
  items,
  onViewAll,
  onOpenVehicle,
}: {
  items: TimelineItem[];
  onViewAll: () => void;
  onOpenVehicle: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Today&apos;s Activities</h3>
      {items.length ? (
        <ol className="flex-1 space-y-3">
          {items.map((item) => {
            const Icon = iconFor(item.title);
            return (
              <li key={item.id} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                  <Icon className="size-4" />
                </span>
                <button
                  className={`min-w-0 flex-1 text-left ${item.vehicleId ? "cursor-pointer hover:text-primary" : "cursor-default"}`}
                  onClick={() => item.vehicleId && onOpenVehicle(item.vehicleId)}
                  disabled={!item.vehicleId}
                >
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
                  <p className="text-[11px] text-muted-foreground/70">{item.time}</p>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="flex-1">
          <EmptyState icon={Activity} title="No activity yet today." />
        </div>
      )}
      <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={onViewAll}>
        View All
      </Button>
    </div>
  );
}
