"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Camera, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useScrapData } from "@/components/scrap/scrap-data-context";
import { loadAmount, paymentMethods, localDay, type PaymentMethod, type ScrapPayment } from "@/lib/mock/scrap";

export function PaymentPanel({ driverId, driverName, actorName }: { driverId: string; driverName: string; actorName: string }) {
  const { loads, payments, checkSubmissions, recordPayment, resolveMismatch } = useScrapData();

  const payable = useMemo(() => loads.filter((l) => l.driverId === driverId && l.status === "approved" && !l.paymentId), [loads, driverId]);
  const [selected, setSelected] = useState<string[]>([]);
  const effectiveSelected = selected.length ? selected : payable.map((l) => l.id);

  const [method, setMethod] = useState<PaymentMethod>("Check");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(localDay());
  const expected = payable.filter((l) => effectiveSelected.includes(l.id)).reduce((n, l) => n + loadAmount(l), 0);
  const [amount, setAmount] = useState(String(expected));
  const [notes, setNotes] = useState("");
  const [lastPayment, setLastPayment] = useState<ScrapPayment | null>(null);
  const [discrepancyReason, setDiscrepancyReason] = useState("");

  const pendingCheck = checkSubmissions.find((c) => c.driverId === driverId && !c.linkedPaymentId);

  function toggle(id: string) {
    setSelected((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...(xs.length ? xs : payable.map((l) => l.id)), id].filter((x, i, a) => a.indexOf(x) === i)));
  }

  function submit() {
    if (!effectiveSelected.length) return;
    const amt = Number(amount);
    const payment = recordPayment({
      driverId,
      driverName,
      linkedLoadIds: effectiveSelected,
      paymentDate,
      amountReceived: amt,
      method,
      referenceNumber: reference,
      notes,
      enteredByName: actorName,
      withProofPhoto: !!pendingCheck,
      fromCheckSubmissionId: pendingCheck?.id,
    });
    setLastPayment(payment);
    setSelected([]);
    setReference("");
    setNotes("");
    const mismatched = Math.abs(expected - amt) > 0.01;
    toast[mismatched ? "warning" : "success"](mismatched ? "Payment saved — amount mismatch needs a reason" : "Payment recorded");
  }

  const recent = payments.filter((p) => p.driverId === driverId).slice(0, 3);
  const activeMismatch = lastPayment && Math.abs(expected - lastPayment.amountReceived) > 0.01 && !lastPayment.discrepancyReason ? lastPayment : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <DollarSign className="size-4 text-success" />
        <h3 className="text-sm font-semibold">Payment for {driverName.split(" ")[0]}&apos;s Loads</h3>
      </div>

      {!payable.length ? (
        <p className="text-sm text-muted-foreground">No approved loads are awaiting payment for this driver.</p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            {payable.map((l) => (
              <label key={l.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                <Checkbox checked={effectiveSelected.includes(l.id)} onCheckedChange={() => toggle(l.id)} />
                <span className="flex-1">{new Date(l.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                <span className="tabular-nums text-muted-foreground">${loadAmount(l).toFixed(2)}</span>
              </label>
            ))}
          </div>

          {pendingCheck && (
            <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-2 text-xs text-muted-foreground">
              <Camera className="size-4" /> Using check photo submitted by driver as payment proof.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Payment Type</Label>
              <Select value={method} onValueChange={(v) => setMethod((v as PaymentMethod) ?? "Check")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reference / Check #</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Payment Date</Label>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Amount Received</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={`Payment for ${effectiveSelected.length} load(s) (${driverName.split(" ")[0]})`} />
          </div>
          <p className="text-xs text-muted-foreground">Expected from selected loads: ${expected.toFixed(2)}</p>
          <Button onClick={submit} disabled={!amount}>
            Record Payment
          </Button>
        </div>
      )}

      {activeMismatch && (
        <div className="mt-4 space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4" /> PAYMENT MISMATCH
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <span>
              Expected
              <br />
              <b className="text-sm">${expected.toFixed(2)}</b>
            </span>
            <span>
              Received
              <br />
              <b className="text-sm">${activeMismatch.amountReceived.toFixed(2)}</b>
            </span>
            <span>
              Difference
              <br />
              <b className="text-sm">${Math.abs(expected - activeMismatch.amountReceived).toFixed(2)}</b>
            </span>
          </div>
          <Textarea rows={2} placeholder="Reason for discrepancy (required to approve)" value={discrepancyReason} onChange={(e) => setDiscrepancyReason(e.target.value)} />
          <Button
            size="sm"
            variant="destructive"
            disabled={!discrepancyReason.trim()}
            onClick={() => {
              resolveMismatch(activeMismatch.id, discrepancyReason.trim(), actorName);
              setDiscrepancyReason("");
              setLastPayment(null);
              toast.success("Discrepancy approved and loads closed");
            }}
          >
            Approve Discrepancy &amp; Close
          </Button>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Recent payments</p>
          <div className="space-y-1">
            {recent.map((p) => (
              <p key={p.id} className="text-xs text-muted-foreground">
                {p.paymentDate} · {p.method} {p.referenceNumber && `#${p.referenceNumber}`} · ${p.amountReceived.toFixed(2)} · {p.linkedLoadIds.length} load(s)
                {p.discrepancyReason && " · discrepancy approved"}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
