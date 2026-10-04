"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useClosePreview, useManagerMutations } from "@/lib/query/scrap";
import { lbs, usd } from "@/components/scrap/scrap-shared";

const BLOCKER_LABEL: Record<string, string> = {
  missing_load_photo: "Loads without a load photo",
  incomplete_workflow: "Loads the driver has not completed",
  awaiting_review: "Loads awaiting manager review",
  unresolved_discrepancy: "Unresolved discrepancies",
};

/**
 * Daily Close. The server decides: it lists the blocking items for the day, refuses to close while any
 * remain, and accepts an override only from an owner or engineer admin with a reason (audited).
 * The override fields here are a convenience; the database enforces the same rule.
 */
export function DailyClosePanel({ role, defaultDate }: { role: string; defaultDate: string }) {
  const [date, setDate] = useState(defaultDate);
  const [reason, setReason] = useState("");
  const preview = useClosePreview(date);
  const { dailyClose } = useManagerMutations();
  const canOverride = role === "owner" || role === "engineer_admin";
  const p = preview.data;
  const blocked = !!p && p.blockers.length > 0;

  function close() {
    dailyClose.mutate(
      { date, overrideReason: blocked ? reason.trim() : null },
      {
        onSuccess: (c) => {
          toast.success(c.override_reason ? "Day closed with an audited override." : "Day closed.");
          setReason("");
        },
        onError: (e) => toast.error(e.message),
      }
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Daily close</h3>
          <p className="text-xs text-muted-foreground">Freezes the day&apos;s totals. Closed days cannot be changed by the driver.</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Business day</Label>
          <Input type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {preview.isPending && <p className="text-sm text-muted-foreground">Checking the day…</p>}
      {preview.isError && <p className="text-sm text-destructive">{preview.error.message}</p>}

      {p && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {p.closed ? <StatusBadge tone="success">CLOSED</StatusBadge> : <StatusBadge tone={blocked ? "warning" : "info"}>{blocked ? "OPEN ITEMS" : "READY TO CLOSE"}</StatusBadge>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
            <dt className="text-xs text-muted-foreground">Loads</dt>
            <dd className="tabular-nums">{p.loads}</dd>
            <dt className="text-xs text-muted-foreground">Completed</dt>
            <dd className="tabular-nums">{p.completed}</dd>
            <dt className="text-xs text-muted-foreground">Weight</dt>
            <dd className="tabular-nums">{lbs(p.weight)}</dd>
            <dt className="text-xs text-muted-foreground">Amount</dt>
            <dd className="tabular-nums">{usd(p.amount)}</dd>
            <dt className="text-xs text-muted-foreground">Received</dt>
            <dd className="tabular-nums">{usd(p.payments_received)}</dd>
          </dl>

          {blocked && (
            <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
              <p className="text-sm font-medium">Open items block the close</p>
              <ul className="list-inside list-disc text-sm">
                {p.blockers.map((b) => (
                  <li key={b.kind}>
                    {BLOCKER_LABEL[b.kind] ?? b.kind}: <b>{b.count}</b>
                  </li>
                ))}
              </ul>
              {canOverride ? (
                <div className="space-y-1">
                  <Label className="text-xs">Override reason (required, audited)</Label>
                  <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the day is closed with open items" />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Only an owner or engineer admin can close a day with open items.</p>
              )}
            </div>
          )}

          {!p.closed && (
            <Button
              className="w-full sm:w-auto"
              disabled={dailyClose.isPending || (blocked && (!canOverride || reason.trim().length < 5))}
              onClick={close}
            >
              {dailyClose.isPending ? "Closing…" : blocked ? "Close with override" : "Close the day"}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
