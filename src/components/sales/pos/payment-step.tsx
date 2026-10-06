"use client";

import { CheckCircle2, Printer, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StepHeader } from "@/components/sales/pos/step-header";
import { usd } from "@/lib/mock/sales";
import { CHECKOUT_METHODS, paymentStatusText, type CheckoutMethod } from "@/lib/data/sales-checkout";
import type { SaleMode } from "@/lib/data/sales";

const modes: { id: SaleMode; label: string; detail: string }[] = [
  { id: "draft", label: "Draft", detail: "Records the sale. No stock is held or moved." },
  { id: "reserve", label: "Reserve", detail: "Holds stock for this sale. Stock stays on hand until fulfilled." },
  { id: "fulfill_now", label: "Fulfill Now", detail: "Consumes stock immediately." },
];

/** The sale as the server confirmed it. Every figure here comes from the server reply. */
export type CompletedSale = {
  saleId: string;
  saleNumber: string;
  customerName: string;
  total: string;
  paidNow: string;
  balanceDue: string;
  paymentStatus: string;
  methodLabel: string | null;
  fulfillmentStatus: string;
};

export type PaymentDraft = { amountPaid: string; method: CheckoutMethod; reference: string };

export function PaymentStep({
  mode,
  onSelectMode,
  canComplete,
  completing,
  completed,
  grandTotal,
  payment,
  onChangePayment,
  onComplete,
  onNewSale,
  onPrintReceipt,
  onPrintInvoice,
}: {
  mode: SaleMode;
  onSelectMode: (m: SaleMode) => void;
  canComplete: boolean;
  completing: boolean;
  completed: CompletedSale | null;
  grandTotal: number;
  payment: PaymentDraft;
  onChangePayment: (next: PaymentDraft) => void;
  onComplete: () => void;
  onNewSale: () => void;
  onPrintReceipt: () => void;
  onPrintInvoice: () => void;
}) {
  if (completed) {
    const status = paymentStatusText(completed.paymentStatus);
    return (
      <div className="rounded-lg border border-success/30 bg-success/5 p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <b className="block text-base">Sale {completed.saleNumber} complete</b>
            <small className="text-xs text-muted-foreground">{completed.customerName || "Customer"} · Fulfillment {completed.fulfillmentStatus.replace(/_/g, " ").toLowerCase()}</small>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Sale #</dt><dd className="font-semibold">{completed.saleNumber}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Customer</dt><dd className="font-semibold break-words">{completed.customerName || "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Grand Total</dt><dd className="font-semibold tabular-nums">{usd(completed.total)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Paid Now</dt><dd className="font-semibold tabular-nums">{usd(completed.paidNow)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Remaining Balance</dt><dd className="font-semibold tabular-nums">{usd(completed.balanceDue)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Payment Method</dt><dd className="font-semibold">{completed.methodLabel ?? "—"}</dd></div>
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Payment Status</dt>
            <dd className={`text-base font-extrabold ${status === "PAID" ? "text-success" : status === "UNPAID" ? "text-destructive" : "text-warning-foreground"}`}>
              {status}
              {status !== "PAID" && <span className="ml-2 text-sm font-semibold text-foreground">Balance Due: {usd(completed.balanceDue)}</span>}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={onNewSale}>New Sale</Button>
          <Button variant="outline" onClick={onPrintReceipt}>
            <Printer className="size-3.5" /> Print Receipt
          </Button>
          <Button variant="outline" onClick={onPrintInvoice}>
            <Printer className="size-3.5" /> Print Full Invoice
          </Button>
        </div>
      </div>
    );
  }

  const selected = modes.find((m) => m.id === mode) ?? modes[0];
  const paid = Number(payment.amountPaid || 0);
  const validPaid = Number.isFinite(paid) && paid >= 0 && Math.round(paid * 100) === paid * 100;
  const overpaid = validPaid && paid > grandTotal + 0.005;
  const remaining = Math.max(0, grandTotal - (validPaid ? paid : 0));
  const needsMethod = validPaid && paid > 0 && !payment.method;

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
      <StepHeader step={4} icon={Wallet} title="Sale Mode & Payment" tone="success" />

      <div className="grid grid-cols-3 gap-2.5">
        {modes.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onSelectMode(m.id)}
              disabled={completing}
              className={`flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center text-xs font-semibold transition-colors ${active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary"}`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">{selected.detail}</p>

      <div className="mt-4 space-y-3 rounded-md border border-border bg-muted/30 p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Amount Due</span>
          <b className="tabular-nums">{usd(grandTotal)}</b>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="amount-paid" className="text-sm font-medium">Amount Paid</label>
          <Input
            id="amount-paid"
            inputMode="decimal"
            className="h-11 text-base tabular-nums"
            value={payment.amountPaid}
            placeholder="0.00"
            disabled={completing}
            onChange={(e) => onChangePayment({ ...payment, amountPaid: e.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={completing || grandTotal <= 0} onClick={() => onChangePayment({ ...payment, amountPaid: grandTotal.toFixed(2) })}>
              Paid in full
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={completing} onClick={() => onChangePayment({ ...payment, amountPaid: "" })}>
              Nothing paid now
            </Button>
          </div>
          {overpaid && <p className="text-xs text-destructive">The amount paid is more than the total. Reduce it.</p>}
          {!validPaid && payment.amountPaid !== "" && <p className="text-xs text-destructive">Enter an amount with at most 2 decimals.</p>}
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Remaining Balance</span>
          <b className={`tabular-nums ${remaining > 0 ? "text-warning-foreground" : "text-success"}`}>{usd(remaining)}</b>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Payment Method</span>
            <Select value={payment.method} onValueChange={(v) => v && onChangePayment({ ...payment, method: v as CheckoutMethod })} disabled={completing}>
              <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHECKOUT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {payment.method !== "CASH" && (
            <div className="space-y-1.5">
              <label htmlFor="payment-ref" className="text-sm font-medium">Reference (optional)</label>
              <Input id="payment-ref" className="h-10" value={payment.reference} maxLength={200} disabled={completing} onChange={(e) => onChangePayment({ ...payment, reference: e.target.value })} />
            </div>
          )}
        </div>
      </div>

      <Button className="mt-4 w-full text-base font-bold shadow-sm" size="lg" disabled={!canComplete || completing || overpaid || !validPaid || needsMethod} onClick={onComplete}>
        <Wallet /> {completing ? "Completing…" : "Complete Sale"}
      </Button>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        {mode === "draft" ? "Draft" : mode === "reserve" ? "Reserve" : "Fulfill Now"} and payment are saved together. Nothing is saved unless the server confirms both.
      </p>
    </div>
  );
}
