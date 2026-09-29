"use client";

import { useState } from "react";
import { ChevronLeft, Printer, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ItemsTable, TotalsBlock } from "@/components/sales/shared";
import { useSalesData } from "@/components/sales/sales-data-context";
import { itemTotals, saleBalance, usd, type PaymentMethod } from "@/lib/mock/sales";

export function SaleDetailView({ saleId, manager, onBack }: { saleId: string; manager: boolean; onBack: () => void }) {
  const { getSale, getCustomer, payments, settings, recordPayment } = useSalesData();
  const sale = getSale(saleId);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");

  if (!sale) return null;
  const customer = getCustomer(sale.customerId);
  const totals = itemTotals(sale.items, sale.discount, sale.taxRate);
  const salePayments = payments.filter((p) => p.saleId === sale.id);
  const { balanceDue, paymentStatus } = saleBalance(sale, payments);

  function confirmPayment() {
    const value = Number(amount);
    if (!value || value <= 0) return;
    if (!window.confirm(`Record ${usd(value)} received?`)) return;
    recordPayment(sale!.id, value, method, reference, "");
    setAmount("");
    setReference("");
    toast.success("Payment recorded");
  }

  return (
    <div className="record-stack space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline print:hidden">
        <ChevronLeft className="size-4" /> Sales
      </button>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">
              {sale.invoiceNumber} · {sale.saleNumber}
            </h3>
            <p className="text-sm text-muted-foreground">
              {customer?.companyName || `${customer?.firstName} ${customer?.lastName}`} · <StatusBadge>{paymentStatus}</StatusBadge>
            </p>
          </div>
          <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        </div>

        <div className="mb-4 rounded-md bg-muted/30 p-3 text-sm">
          <b className="block">{settings.businessName}</b>
          <span className="block text-muted-foreground">{settings.businessAddress}</span>
          <span className="block text-muted-foreground">{settings.businessPhone}</span>
        </div>

        <ItemsTable items={sale.items} />
        <TotalsBlock subtotal={totals.subtotal} discount={totals.discount} tax={totals.tax} taxRate={sale.taxRate} total={totals.total} />

        <div className="mt-5 border-t border-border pt-4">
          <h4 className="mb-2 text-sm font-semibold">Payments</h4>
          <div className="space-y-1.5">
            {salePayments.map((p) => (
              <div key={p.id} className="flex justify-between text-sm">
                <span>
                  {p.paymentNumber} · {p.method}
                </span>
                <b>{usd(p.amount)}</b>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between border-t border-border pt-2 text-base">
            <strong>Balance due</strong>
            <b>{usd(balanceDue)}</b>
          </div>
        </div>

        {manager && balanceDue > 0 && (
          <div className="mt-4 grid gap-2 rounded-md border border-border bg-muted/20 p-3 print:hidden sm:grid-cols-4">
            <h4 className="text-sm font-semibold sm:col-span-4">Record authorized payment</h4>
            <Input type="number" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Select value={method} onValueChange={(v) => setMethod((v as PaymentMethod) ?? "CASH")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["CASH", "CARD", "CHECK", "OTHER"] as const).map((x) => (
                  <SelectItem key={x} value={x}>
                    {x}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Reference (no card number)" value={reference} onChange={(e) => setReference(e.target.value)} />
            <Button onClick={confirmPayment}>
              <Wallet /> Confirm Payment
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
