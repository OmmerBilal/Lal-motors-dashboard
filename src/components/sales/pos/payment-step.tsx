"use client";

import { CheckCircle2, Printer, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepHeader } from "@/components/sales/pos/step-header";
import { usd } from "@/lib/mock/sales";
import type { SaleMode } from "@/lib/data/sales";

const modes: { id: SaleMode; label: string; detail: string }[] = [
  { id: "draft", label: "Draft", detail: "Records the sale. No stock is held or moved." },
  { id: "reserve", label: "Reserve", detail: "Holds stock for this sale. Stock stays on hand until fulfilled." },
  { id: "fulfill_now", label: "Fulfill Now", detail: "Consumes stock immediately." },
];

export type CompletedSale = { saleId: string; saleNumber: string; total: string; fulfillmentStatus: string };

export function PaymentStep({
  mode,
  onSelectMode,
  canComplete,
  completing,
  completed,
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
  onComplete: () => void;
  onNewSale: () => void;
  onPrintReceipt: () => void;
  onPrintInvoice: () => void;
}) {
  if (completed) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/5 p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <b className="block text-base">Sale {completed.saleNumber} saved</b>
            <small className="text-xs text-muted-foreground">
              Total {usd(completed.total)} · Fulfillment {completed.fulfillmentStatus.replace(/_/g, " ").toLowerCase()} · Payment: unpaid. Recording payments is not connected yet.
            </small>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={onNewSale}>New Sale</Button>
          <Button variant="outline" onClick={onPrintReceipt}>
            <Printer className="size-3.5" /> Print Small Receipt
          </Button>
          <Button variant="outline" onClick={onPrintInvoice}>
            <Printer className="size-3.5" /> Print Full Invoice
          </Button>
        </div>
      </div>
    );
  }

  const selected = modes.find((m) => m.id === mode) ?? modes[0];
  const actionLabel = mode === "draft" ? "Save Draft Sale" : mode === "reserve" ? "Reserve Stock & Save Sale" : "Fulfill Now & Save Sale";

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
      <StepHeader step={4} icon={Wallet} title="Sale Mode & Checkout" tone="success" />

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

      <Button className="mt-5 w-full text-base font-bold shadow-sm" size="lg" disabled={!canComplete || completing} onClick={onComplete}>
        <Wallet /> {completing ? "Saving…" : actionLabel}
      </Button>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        The sale is saved only when the server confirms it. Payment capture is not connected yet.
      </p>
    </div>
  );
}
