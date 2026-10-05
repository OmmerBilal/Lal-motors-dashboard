"use client";

import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { useRecentActivity } from "@/lib/query/team";
import { yardDay } from "@/components/scrap/scrap-shared";

/** The audit trail for the last 7 days, newest first, from the audit log. Bounded to 50 rows. */
export function AuditView() {
  const log = useRecentActivity(yardDay(6), yardDay());
  const rows = log.data ?? [];

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border p-4">
        <h3 className="text-sm font-semibold">Audit Log</h3>
        <p className="text-xs text-muted-foreground">Last 7 days · the 50 most recent changes</p>
      </div>
      {log.isPending && <p className="p-4 text-sm text-muted-foreground">Loading audit log…</p>}
      {log.isError && <p className="p-4 text-sm text-destructive">{log.error.message}</p>}
      {log.isSuccess && !rows.length && <EmptyState title="No audit entries in the last 7 days." />}
      <div className="divide-y divide-border">
        {rows.map((l) => (
          <div key={l.id} className="flex items-center gap-3 px-4 py-3">
            <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <b className="block text-sm">{l.summary}</b>
              <small className="text-xs text-muted-foreground">
                {l.actor_name} · {l.action}
              </small>
            </span>
            <time className="shrink-0 text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</time>
          </div>
        ))}
      </div>
    </div>
  );
}
