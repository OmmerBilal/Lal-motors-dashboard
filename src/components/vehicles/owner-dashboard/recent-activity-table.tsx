"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { History } from "lucide-react";

export type ActivityRow = { id: string; when: string; employee: string; activity: string; details: string; vehicleId?: string };

export function RecentActivityTable({
  rows,
  onViewAll,
  onOpenVehicle,
}: {
  rows: ActivityRow[];
  onViewAll: () => void;
  onOpenVehicle: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Recent Activity (All Employees)</h3>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Date &amp; Time</th>
                <th className="pb-2 font-medium">Employee</th>
                <th className="pb-2 font-medium">Activity</th>
                <th className="pb-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => r.vehicleId && onOpenVehicle(r.vehicleId)}
                  className={r.vehicleId ? "cursor-pointer hover:bg-accent/30" : undefined}
                >
                  <td className="py-2 pr-3 text-xs whitespace-nowrap text-muted-foreground">{r.when}</td>
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{r.employee}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.activity}</td>
                  <td className="py-2 text-muted-foreground">{r.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={History} title="No activity recorded yet." />
      )}
      <Button variant="ghost" size="sm" className="mt-3" onClick={onViewAll}>
        View All Activity
      </Button>
    </div>
  );
}
