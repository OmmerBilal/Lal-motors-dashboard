"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { MediaCapture } from "@/components/media/media-capture";
import { usePaymentsList, useManagerLoads, useManagerMutations } from "@/lib/query/scrap";
import type { ManagerLoad, Payment, PaymentMethod } from "@/lib/data/scrap";
import { METHOD_OPTIONS, usd } from "@/components/scrap/scrap-shared";

type DriverOption = { driver_id: string; name: string };

/**
 * Payments and reconciliation. The loads offered are the server's unpaid approved loads of the chosen
 * driver. The total on screen is only a preview; the server computes the expected total and decides
 * whether a mismatch is recorded.
 */
export function PaymentsPanel({ drivers }: { drivers: DriverOption[] }) {
  return (
    <div className="space-y-4">
      <RecordPaymentForm drivers={drivers} />
      <PaymentList />
    </div>
  );
}

function RecordPaymentForm({ drivers }: { drivers: DriverOption[] }) {
  const { recordPayment } = useManagerMutations();
  const [driverId, setDriverId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("Check");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const unpaid = useManagerLoads({ bucket: "unpaid", driverId });
  const loads: ManagerLoad[] = (unpaid.data?.pages.flatMap((p) => p.rows) ?? []).filter((l) => l.status === "approved" && !l.payment_id);
  const previewTotal = loads.filter((l) => selected.includes(l.id)).reduce((n, l) => n + (l.amount ?? 0), 0);

  function toggle(id: string) {
    setSelected((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  }

  function submit() {
    if (!driverId || selected.length === 0) {
      toast.error("Choose a driver and at least one load.");
      return;
    }
    recordPayment.mutate(
      { driverId, loadIds: selected, amountReceived: Number(amount), method, reference, notes, requestId },
      {
        onSuccess: (r) => {
          if (r.mismatch) {
            toast.warning(`Payment recorded. The linked loads total ${usd(r.expected_total)}, not ${usd(Number(amount))}. A mismatch is open for review.`);
          } else {
            toast.success(`Payment recorded. ${selected.length} load(s) closed as paid.`);
          }
          setSelected([]);
          setAmount("");
          setReference("");
          setNotes("");
          setRequestId(crypto.randomUUID());
        },
        onError: (e) => toast.error(e.message),
      }
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Record a payment</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Driver</Label>
          <Select value={driverId ?? ""} onValueChange={(v) => { setDriverId(v || null); setSelected([]); }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a driver">{(v: string) => drivers.find((d) => d.driver_id === v)?.name ?? "Choose a driver"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {drivers.map((d) => (
                <SelectItem key={d.driver_id} value={d.driver_id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Method</Label>
          <Select value={method} onValueChange={(v) => setMethod((v as PaymentMethod) ?? "Check")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHOD_OPTIONS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Reference</Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check or transfer number" />
        </div>
      </div>

      {driverId && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Approved, unpaid loads</p>
          {unpaid.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!unpaid.isPending && loads.length === 0 && <p className="text-sm text-muted-foreground">No approved, unpaid loads for this driver.</p>}
          <div className="space-y-1">
            {loads.map((l) => (
              <label key={l.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
                <input type="checkbox" checked={selected.includes(l.id)} onChange={() => toggle(l.id)} />
                <span className="flex-1">{l.load_date} · {l.weight?.toLocaleString() ?? "—"} lb</span>
                <span className="tabular-nums">{usd(l.amount)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Amount received ($)</Label>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {selected.length > 0 && <p className="text-xs text-muted-foreground">Selected loads total {usd(previewTotal)} (server recalculates)</p>}
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Notes</Label>
          <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <Button className="w-full sm:w-auto" disabled={recordPayment.isPending || selected.length === 0 || !amount} onClick={submit}>
        {recordPayment.isPending ? "Recording…" : "Record payment"}
      </Button>
    </section>
  );
}

function PaymentList() {
  const payments = usePaymentsList();
  const rows: Payment[] = payments.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Payments</h3>
      {payments.isPending && <p className="text-sm text-muted-foreground">Loading payments…</p>}
      {!payments.isPending && rows.length === 0 && <EmptyState title="No payments recorded yet." />}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <PaymentRow key={p.id} payment={p} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {payments.hasNextPage && (
        <Button variant="outline" className="w-full" disabled={payments.isFetchingNextPage} onClick={() => payments.fetchNextPage()}>
          {payments.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}

function PaymentRow({ payment: p }: { payment: Payment }) {
  const [open, setOpen] = useState<null | "proof" | "correct">(null);
  const mismatch = Math.abs(p.expected_total - p.amount_received) > 0.005 && !p.correction_of;
  return (
    <>
      <TableRow>
        <TableCell>{p.payment_date}</TableCell>
        <TableCell>{p.driver_name}</TableCell>
        <TableCell>{p.method}</TableCell>
        <TableCell>{p.reference_number || "—"}</TableCell>
        <TableCell className="text-right tabular-nums">{usd(p.amount_received)}</TableCell>
        <TableCell className="text-right tabular-nums">{usd(p.expected_total)}</TableCell>
        <TableCell className="space-x-1">
          {p.correction_of && <StatusBadge tone="info">CORRECTION</StatusBadge>}
          {p.has_open_discrepancy && <StatusBadge tone="danger">MISMATCH</StatusBadge>}
          {!p.has_open_discrepancy && !mismatch && <StatusBadge tone="success">MATCHED</StatusBadge>}
        </TableCell>
        <TableCell className="space-x-1 text-right">
          {!p.proof_asset_id && (
            <Button size="sm" variant="outline" onClick={() => setOpen(open === "proof" ? null : "proof")}>
              Proof
            </Button>
          )}
          {!p.correction_of && (
            <Button size="sm" variant="outline" onClick={() => setOpen(open === "correct" ? null : "correct")}>
              Correct
            </Button>
          )}
        </TableCell>
      </TableRow>
      {open === "proof" && (
        <TableRow>
          <TableCell colSpan={8}>
            <div className="max-w-sm">
              <ProofAttach paymentId={p.id} onDone={() => setOpen(null)} />
            </div>
          </TableCell>
        </TableRow>
      )}
      {open === "correct" && (
        <TableRow>
          <TableCell colSpan={8}>
            <CorrectionInline payment={p} onDone={() => setOpen(null)} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** Proof photo: uploaded through the media API, then attached to the payment by the server (once). */
function ProofAttach({ paymentId, onDone }: { paymentId: string; onDone: () => void }) {
  const { attachProof } = useManagerMutations();
  const [mediaId, setMediaId] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <MediaCapture label="Payment proof" ownerType="scrap_payment" ownerId={paymentId} role="proof" onUploaded={(id) => setMediaId(id)} />
      <Button
        size="sm"
        disabled={!mediaId || attachProof.isPending}
        onClick={() =>
          attachProof.mutate(
            { paymentId, mediaId: mediaId! },
            { onSuccess: () => { toast.success("Proof attached to this payment."); onDone(); }, onError: (e) => toast.error(e.message) }
          )
        }
      >
        Attach proof to payment
      </Button>
    </div>
  );
}

function CorrectionInline({ payment: p, onDone }: { payment: Payment; onDone: () => void }) {
  const { correctPayment } = useManagerMutations();
  const [amount, setAmount] = useState(String(p.amount_received));
  const [reason, setReason] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Corrected amount" />
      <Input className="sm:col-span-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (at least 5 characters)" />
      <Button
        size="sm"
        disabled={correctPayment.isPending}
        onClick={() =>
          correctPayment.mutate(
            { originalId: p.id, amountReceived: Number(amount), loadIds: p.load_ids, reason, requestId },
            { onSuccess: () => { toast.success("Correction recorded. The original payment is unchanged."); onDone(); }, onError: (e) => toast.error(e.message) }
          )
        }
      >
        Record correction
      </Button>
      <p className="text-xs text-muted-foreground sm:col-span-4">The original payment stays as it is. The correction references it and re-links the same {p.load_ids.length} load(s).</p>
    </div>
  );
}
