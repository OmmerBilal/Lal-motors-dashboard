"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { listCompletedVehicles, profileNames } from "@/lib/data/vehicle-workspace";

/** Approved completions in the period, grouped by the employee who submitted them. Read from the database. */
export function CompletionGroupView({
  period,
  employeeId,
  onOpenVehicle,
  onChangeEmployee,
}: {
  period: "week" | "month";
  employeeId: string | null;
  onOpenVehicle: (id: string) => void;
  onChangeEmployee: (id: string | null) => void;
}) {
  const completed = useQuery({
    queryKey: ["vehicles", "completed", period],
    queryFn: () => listCompletedVehicles(new Date(Date.now() - (period === "month" ? 30 : 7) * 86400000).toISOString()),
  });
  const rows = useMemo(() => completed.data?.rows ?? [], [completed.data]);
  const submitterIds = useMemo(() => [...new Set(rows.map((r) => r.submitted_by).filter((x): x is string => Boolean(x)))], [rows]);
  const names = useQuery({
    queryKey: ["vehicles", "completed-names", submitterIds.join(",")],
    queryFn: () => profileNames(submitterIds),
    enabled: submitterIds.length > 0,
  });
  const byEmployee = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r) => map.set(r.submitted_by ?? "", (map.get(r.submitted_by ?? "") || 0) + 1));
    return [...map.entries()].map(([id, completedCount]) => ({
      id,
      name: (id && names.data?.[id]) || "Unknown employee",
      completed: completedCount,
    }));
  }, [rows, names.data]);

  const scoped = employeeId ? rows.filter((r) => r.submitted_by === employeeId) : rows;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">
        Completed this {period} · {scoped.length} vehicles
      </h3>
      <p className="text-sm text-muted-foreground">Approved completions, grouped by the employee who submitted them.</p>
      {completed.isPending && <p className="text-sm text-muted-foreground">Loading completions…</p>}
      {completed.isError && <p role="alert" className="text-sm text-destructive">Completions could not be loaded.</p>}
      {completed.data?.truncated && (
        <p className="text-xs text-warning-foreground">Showing the most recent 500 completions for this period.</p>
      )}

      {employeeId ? (
        <>
          <Button variant="outline" size="sm" onClick={() => onChangeEmployee(null)}>
            All employees
          </Button>
          <div className="space-y-2">
            {scoped.map((r) => (
              <div key={r.id} className="rounded-lg border border-border bg-card p-3">
                <div className="min-w-0 flex-1">
                  <b className="block text-sm">
                    {r.vehicles ? [r.vehicles.year, r.vehicles.make, r.vehicles.model].filter(Boolean).join(" ") : "Vehicle"}
                  </b>
                  <small className="text-xs text-muted-foreground">
                    VIN {r.vehicles?.vin || "—"} · Lot {r.vehicles?.lot_number || "—"} · {new Date(r.decided_at).toLocaleString()} ·{" "}
                    {r.vehicles?.status}
                  </small>
                  <div>
                    <button className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => onOpenVehicle(r.vehicle_id)}>
                      Open exact vehicle, parts and audit history
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {byEmployee.map((e) => (
            <button
              key={e.id || "unknown"}
              onClick={() => onChangeEmployee(e.id || null)}
              className="rounded-lg border border-border bg-card p-4 text-left hover:border-primary/40"
            >
              <b className="block text-sm">{e.name}</b>
              <span className="text-xs text-muted-foreground">{e.completed} vehicles completed</span>
            </button>
          ))}
        </div>
      )}

      {completed.isSuccess && !scoped.length && (
        <EmptyState title="No completions in this period" description="Approved completions are grouped by employee here." />
      )}
    </div>
  );
}
