"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usd } from "@/lib/mock/sales";
import { CHECKOUT_METHODS, type CheckoutMethod, type OutstandingSale, type ReceivePaymentResult } from "@/lib/data/sales-checkout";
import { useReceiveCustomerPayment } from "@/lib/query/sales";

/** Oldest open sales first, the same order the server uses. Shown as a preview only; the server decides the result. */
function previewAllocation(sales: OutstandingSale[], amount: number) {
  let left = amount;
  const rows: { sale_number: string; amount: number }[] = [];
  for (const s of sales) {
    if (left <= 0) break;
    const take = Math.min(Number(s.balance_due), left);
    if (take > 0) {
      rows.push({ sale_number: s.sale_number, amount: Math.round(take * 100) / 100 });
      left = Math.round((left - take) * 100) / 100;
    }
  }
  return { rows, left };
}

/** Customer-level Receive Payment. One payment, applied to the oldest open sales and posted in the same action. */
export function ReceivePaymentDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
  outstanding,
  sales,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string;
  customerName: string;
  outstanding: number;
  sales: OutstandingSale[];
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<CheckoutMethod>("CASH");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ReceivePaymentResult | null>(null);
  const receive = useReceiveCustomerPayment(customerId);

  const value = Number(amount || 0);
  const validAmount = Number.isFinite(value) && value > 0 && Math.round(value * 100) === value * 100;
  const overOutstanding = validAmount && value > outstanding + 0.005;
  const preview = validAmount && !overOutstanding ? previewAllocation(sales, value) : null;

  async function submit() {
    try {
      const r = await receive.mutateAsync({ customerId, amount: value, method, reference, notes: note, clientRequestId: crypto.randomUUID() });
      setResult(r);
      toast.success("Payment received and posted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The payment was not received. Nothing was saved.");
    }
  }

  function close(next: boolean) {
    if (!next) {
      setAmount("");
      setReference("");
      setNote("");
      setResult(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Receive Payment</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-success">Received {usd(result.received)}. Posted.</p>
            <ul className="space-y-1">
              {result.applied.map((a) => (
                <li key={a.sale_id} className="flex justify-between">
                  <span>Sale {a.sale_number}</span>
                  <b className="tabular-nums">{usd(a.amount)}</b>
                </li>
              ))}
            </ul>
            <p>Remaining customer balance: <b className="tabular-nums">{usd(result.remaining_outstanding)}</b></p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">Customer: <b>{customerName}</b></p>
            <p className="text-sm">Outstanding: <b className="tabular-nums">{usd(outstanding)}</b></p>
            <div className="space-y-1.5">
              <label htmlFor="receive-amount" className="text-sm font-medium">Amount Received</label>
              <Input id="receive-amount" inputMode="decimal" className="h-11 text-base tabular-nums" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} />
              {overOutstanding && <p className="text-xs text-destructive">More than the outstanding balance. Reduce the amount.</p>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Payment Method</span>
                <Select value={method} onValueChange={(v) => v && setMethod(v as CheckoutMethod)}>
                  <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{CHECKOUT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="receive-ref" className="text-sm font-medium">Reference (optional)</label>
                <Input id="receive-ref" className="h-10" value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="receive-note" className="text-sm font-medium">Note (optional)</label>
              <Input id="receive-note" className="h-10" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            </div>
            {preview && preview.rows.length > 0 && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Applied to the oldest sales first</p>
                {preview.rows.map((r) => (
                  <div key={r.sale_number} className="flex justify-between"><span>Sale {r.sale_number}</span><b className="tabular-nums">{usd(r.amount)}</b></div>
                ))}
                <div className="mt-1 flex justify-between border-t border-border pt-1"><span>Remaining customer balance</span><b className="tabular-nums">{usd(outstanding - value)}</b></div>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          {result ? (
            <Button className="h-11 w-full" onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button className="h-11 w-full" disabled={!validAmount || overOutstanding || receive.isPending} onClick={submit}>
                {receive.isPending ? "Posting…" : "Receive Payment"}
              </Button>
              <Button variant="outline" className="h-11 w-full" onClick={() => close(false)}>Cancel</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
