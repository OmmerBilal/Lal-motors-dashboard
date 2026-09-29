"use client";

import { ShieldCheck } from "lucide-react";
import { auditLogs } from "@/lib/mock/audit";

export function AuditView() {
  const sorted = [...auditLogs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border p-4">
        <h3 className="text-sm font-semibold">Complete Audit Log</h3>
        <p className="text-xs text-muted-foreground">Every create, edit, photo upload and deletion</p>
      </div>
      <div className="divide-y divide-border">
        {sorted.map((l) => (
          <div key={l.id} className="flex items-center gap-3 px-4 py-3">
            <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <b className="block text-sm">{l.summary}</b>
              <small className="text-xs text-muted-foreground">
                {l.userName} · {l.userRole} · {l.action}
              </small>
            </span>
            <time className="shrink-0 text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</time>
          </div>
        ))}
      </div>
    </div>
  );
}
