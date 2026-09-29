"use client";

import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { roleLabels, type User } from "@/lib/types";

export type EmployeeCardData = { user: User; metrics: { label: string; value: number }[] };

export function EmployeeOverview({ employees, onOpenEmployee, onViewAll }: { employees: EmployeeCardData[]; onOpenEmployee: (id: string) => void; onViewAll: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Employee Overview</h3>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {employees.map((e) => (
          <button
            key={e.user.id}
            onClick={() => onOpenEmployee(e.user.id)}
            className="flex flex-col items-start gap-2 rounded-md border border-border p-3 text-left hover:border-primary/30 hover:bg-accent/20"
          >
            <div className="flex w-full items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {e.user.name[0]}
              </div>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm">{e.user.name}</b>
                <small className="block truncate text-xs text-muted-foreground">{roleLabels[e.user.role]}</small>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {e.metrics.map((m) => (
                <span key={m.label}>
                  <b className="text-foreground">{m.value}</b> {m.label}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" className="mt-3" onClick={onViewAll}>
        View All Employees
      </Button>
    </div>
  );
}
