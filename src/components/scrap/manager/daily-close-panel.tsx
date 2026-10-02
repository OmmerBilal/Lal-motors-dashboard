"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useScrapData } from "@/components/scrap/scrap-data-context";
import { effectiveLoadStatus, loadAmount, paymentIsMismatched, localDay } from "@/lib/mock/scrap";

export function DailyClosePanel({ actorName }: { actorName: string }) {
  const { loads, payments, drivers, dailyCloses, performDailyClose } = useScrapData();
  const [open, setOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const date = localDay();

  const dayLoads = useMemo(() => loads.filter((l) => l.loadDate === date), [loads, date]);
  const missing = dayLoads.filter((l) => effectiveLoadStatus(l) === "ticket_missing" || !l.loadPhoto);
  const mismatches = payments.filter((p) => p.linkedLoadIds.some((id) => dayLoads.some((l) => l.id === id)) && paymentIsMismatched(p, loads));
  const alreadyClosed = dailyCloses.find((c) => c.date === date);

  const byDriver = drivers.map((d) => {
    const driverLoads = dayLoads.filter((l) => l.driverId === d.id);
    return {
      ...d,
      loads: driverLoads.length,
      weight: driverLoads.reduce((n, l) => n + (l.weight || 0), 0),
      amount: driverLoads.reduce((n, l) => n + loadAmount(l), 0),
      issues: driverLoads.filter((l) => effectiveLoadStatus(l) === "ticket_missing").length,
    };
  });

  function attemptClose(reason?: string) {
    const result = performDailyClose({ date, closedByName: actorName, overrideReason: reason });
    if (!result.ok) {
      toast.error(result.reason || "Cannot close day yet");
      return;
    }
    toast.success(`${date} closed`);
    setOpen(false);
    setOverrideReason("");
  }

  const blocked = missing.length > 0 || mismatches.length > 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Daily Summary &amp; Close</h3>
        <Button size="sm" onClick={() => setOpen(true)} disabled={!!alreadyClosed}>
          <ClipboardCheck className="size-4" /> {alreadyClosed ? "Day Closed" : "Daily Close"}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {byDriver.map((d) => (
          <div key={d.id} className="rounded-md border border-border p-2.5 text-center">
            <p className="text-sm font-semibold">{d.loads}</p>
            <p className="text-[11px] text-muted-foreground">{d.name.split(" ")[0]} loads</p>
            <p className="text-xs text-muted-foreground">
              {d.weight.toLocaleString()} lbs · ${d.amount.toFixed(2)}
            </p>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Daily Close — {date}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <Row label="Total loads" value={dayLoads.length} />
            <Row label="Approved" value={dayLoads.filter((l) => l.status === "approved" || l.status === "closed").length} />
            <Row label="Missing evidence" value={missing.length} danger={missing.length > 0} />
            <Row label="Payment mismatches" value={mismatches.length} danger={mismatches.length > 0} />
            {blocked && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                <span>Unresolved evidence or mismatches exist. Provide an override reason to close anyway (recorded in the audit trail).</span>
              </div>
            )}
            {blocked && <Textarea rows={2} placeholder="Override reason (required)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={blocked && !overrideReason.trim()} onClick={() => attemptClose(blocked ? overrideReason.trim() : undefined)}>
              <CheckCircle2 className="size-4" /> Confirm Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {alreadyClosed && (
        <p className="mt-3 text-xs text-muted-foreground">
          <StatusBadge tone="success">CLOSED</StatusBadge> by {alreadyClosed.closedByName} at {new Date(alreadyClosed.closedAt).toLocaleTimeString()}
          {alreadyClosed.overrideReason && ` — override: ${alreadyClosed.overrideReason}`}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <b className={danger ? "text-destructive" : ""}>{value}</b>
    </div>
  );
}
