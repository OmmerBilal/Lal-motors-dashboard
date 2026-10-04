"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { useDiscrepancies, useManagerMutations } from "@/lib/query/scrap";

/** Every open discrepancy, across loads and payments. Resolving needs a note; the server closes the linked loads for a payment mismatch. */
export function DiscrepanciesPanel() {
  const open = useDiscrepancies("open");
  const { resolveDiscrepancy } = useManagerMutations();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const rows = open.data ?? [];

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Open discrepancies</h3>
      {open.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {open.isError && <p className="text-sm text-destructive">{open.error.message}</p>}
      {!open.isPending && rows.length === 0 && <EmptyState title="No open discrepancies." />}
      {rows.map((d) => (
        <div key={d.id} className="space-y-2 rounded-md border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{d.kind.replaceAll("_", " ")}</span>
            <StatusBadge tone={d.kind === "payment_mismatch" ? "danger" : "warning"}>
              {d.scrap_payment_id ? "PAYMENT" : "LOAD"}
            </StatusBadge>
          </div>
          <p>{d.note}</p>
          <p className="text-xs text-muted-foreground">Opened by {d.opened_by_name} · {new Date(d.opened_at).toLocaleString()}</p>
          <div className="flex gap-2">
            <Input
              className="h-8 text-xs"
              placeholder={d.kind === "payment_mismatch" ? "Why the variance is accepted (5+ characters)" : "Resolution note (5+ characters)"}
              value={notes[d.id] ?? ""}
              onChange={(e) => setNotes({ ...notes, [d.id]: e.target.value })}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={resolveDiscrepancy.isPending}
              onClick={() =>
                resolveDiscrepancy.mutate(
                  { id: d.id, note: notes[d.id] ?? "" },
                  {
                    onSuccess: () => toast.success(d.kind === "payment_mismatch" ? "Variance accepted. Linked loads are closed as paid." : "Discrepancy resolved."),
                    onError: (e) => toast.error(e.message),
                  }
                )
              }
            >
              Resolve
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
