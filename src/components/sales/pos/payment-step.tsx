"use client";

import { toast } from "sonner";
import { Banknote, CheckCircle2, CircleDollarSign, CreditCard, Landmark, Link, Mail, MessageSquare, Printer, QrCode, ReceiptText, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/patterns/status-badge";
import { StepHeader } from "@/components/sales/pos/step-header";
import { usd, type PaymentMethod } from "@/lib/mock/sales";

const methods: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: "CASH", label: "Cash", icon: Banknote },
  { id: "CARD", label: "Card", icon: CreditCard },
  { id: "CHECK", label: "Check", icon: ReceiptText },
  { id: "BANK_TRANSFER", label: "Bank Transfer", icon: Landmark },
  { id: "QR_CODE", label: "QR Code", icon: QrCode },
  { id: "PAYMENT_LINK", label: "Payment Link", icon: Link },
];

export function PaymentStep({
  balanceDue,
  method,
  onSelectMethod,
  tendered,
  onChangeTendered,
  completedSaleId,
  onCompleteSale,
  onNewSale,
  canComplete,
  onPrintReceipt,
  onPrintInvoice,
}: {
  balanceDue: number;
  method: PaymentMethod;
  onSelectMethod: (m: PaymentMethod) => void;
  tendered: string;
  onChangeTendered: (v: string) => void;
  completedSaleId: string | null;
  onCompleteSale: () => void;
  onNewSale: () => void;
  canComplete: boolean;
  onPrintReceipt: () => void;
  onPrintInvoice: () => void;
}) {
  const tenderedNum = Number(tendered) || 0;
  const changeDue = method === "CASH" ? Math.max(0, tenderedNum - balanceDue) : 0;
  const status = balanceDue <= 0 ? "Paid" : method === "CASH" && tenderedNum >= balanceDue ? "Paid" : tenderedNum > 0 ? "Partial" : "Unpaid";

  function mockAction(label: string) {
    toast.info(`${label} (mock — no real delivery in this UI phase)`);
  }

  if (completedSaleId) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/5 p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <b className="block text-base">Sale completed</b>
            <small className="text-xs text-muted-foreground">Reference {completedSaleId} · demo record, no real payment was captured</small>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={onNewSale}>New Sale</Button>
          <Button variant="outline" onClick={() => mockAction("Email receipt")}>
            <Mail className="size-3.5" /> Email Receipt
          </Button>
          <Button variant="outline" onClick={() => mockAction("Text receipt")}>
            <MessageSquare className="size-3.5" /> Text Receipt
          </Button>
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

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
      <StepHeader
        step={4}
        icon={Wallet}
        title="Payment & Checkout"
        tone="success"
        action={<StatusBadge tone={status === "Paid" ? "success" : status === "Partial" ? "warning" : "neutral"}>{status}</StatusBadge>}
      />

      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
        {methods.map((m) => {
          const active = method === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onSelectMethod(m.id)}
              className={`flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs font-semibold transition-colors ${active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary"}`}
            >
              <span className={`flex size-9 items-center justify-center rounded-full ${active ? "bg-white/15" : "bg-muted"}`}>
                <m.icon className="size-4.5" />
              </span>
              {m.label}
            </button>
          );
        })}
      </div>

      {method === "CASH" && (
        <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/30 p-3.5">
          <div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Wallet className="size-3" /> Amount Due
            </p>
            <b className="text-lg tabular-nums">{usd(balanceDue)}</b>
          </div>
          <div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Banknote className="size-3" /> Amount Tendered
            </p>
            <Input type="number" min={0} step="0.01" value={tendered} onChange={(e) => onChangeTendered(e.target.value)} className="h-9" />
          </div>
          <div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <CircleDollarSign className="size-3" /> Change Due
            </p>
            <b className="text-lg tabular-nums text-success">{usd(changeDue)}</b>
          </div>
        </div>
      )}

      <Button className="mt-5 w-full text-base font-bold shadow-sm" size="lg" disabled={!canComplete} onClick={onCompleteSale}>
        <Wallet /> Complete Sale &amp; Print Invoice
      </Button>
    </div>
  );
}
