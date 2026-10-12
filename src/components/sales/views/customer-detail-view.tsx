"use client";

import { useState } from "react";
import { useCustomerRecord, useCustomerHistory } from "@/lib/query/customers";
import { useCustomerOutstanding, useCustomerQuotes } from "@/lib/query/sales";
import { ReceivePaymentDialog } from "@/components/sales/views/receive-payment-dialog";
import { usd } from "@/lib/mock/sales";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HistoryPanel } from "@/components/sales/shared";

export function CustomerDetailView({
  customerId,
  onBack,
  onEdit,
  onStartSale,
  onOpenQuote,
  onOpenSale,
}: {
  customerId: string;
  onBack: () => void;
  onEdit: () => void;
  /** Omitted for a role that doesn't have Sales Desk access from this workspace (owner/admin) — the button is hidden rather than reaching a view that no longer has a tab. */
  onStartSale?: () => void;
  onOpenQuote: (id: string) => void;
  onOpenSale: (id: string) => void;
}) {
  const recordQuery = useCustomerRecord(customerId);
  const historyQuery = useCustomerHistory(customerId);
  const quotesQuery = useCustomerQuotes(customerId);
  const outstandingQuery = useCustomerOutstanding(customerId);
  const outstanding = outstandingQuery.data;
  const [receiveOpen, setReceiveOpen] = useState(false);
  const customer = recordQuery.data ?? null;
  if (!customer) return null;

  const customerQuotes = quotesQuery.data ?? [];
  const customerSales = historyQuery.data?.sales ?? [];
  const customerPayments = historyQuery.data?.payments ?? [];

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ChevronLeft className="size-4" /> Customers
      </button>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{customer.companyName || `${customer.firstName} ${customer.lastName}`}</h3>
            <p className="text-sm text-muted-foreground">
              {customer.customerNumber ? customer.customerNumber + " · " : ""}Tax status on file: {customer.taxStatus}
            </p>
          </div>
          <div className="flex gap-2">
            {onStartSale && (
              <Button variant="outline" size="sm" onClick={onStartSale}>
                Start Sale
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            ["Phone", customer.phone],
            ["Secondary", customer.secondaryPhone],
            ["Email", customer.email],
            ["Billing", customer.billingAddress],
            ["Shipping", customer.shippingAddress],
            ["Tax ID", customer.taxId],
            ["Resale certificate", customer.resaleCertificateNumber],
            ["Notes", customer.notes],
          ].map(([k, v]) => (
            <div key={k}>
              <small className="block text-xs text-muted-foreground">{k}</small>
              <b className="text-sm">{v || "—"}</b>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Documents: Not Connected. A resale certificate cannot be attached yet.</p>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <small className="block text-xs text-muted-foreground">Total Outstanding Balance</small>
            <b className="text-xl tabular-nums">{usd(outstanding?.total_outstanding ?? 0)}</b>
          </div>
          <Button size="sm" disabled={!outstanding || Number(outstanding.total_outstanding) <= 0} onClick={() => setReceiveOpen(true)}>
            Receive Payment
          </Button>
        </div>
        {outstandingQuery.isPending && <p className="p-4 text-sm text-muted-foreground">Loading balance…</p>}
        {outstanding && outstanding.sales.length === 0 && <p className="p-4 text-sm text-muted-foreground">No outstanding sales.</p>}
        {outstanding && outstanding.sales.length > 0 && (
          <div className="divide-y divide-border">
            {outstanding.sales.map((o) => (
              <div key={o.sale_id} className="grid grid-cols-2 gap-x-3 px-4 py-2.5 text-sm sm:grid-cols-5">
                <b>Sale {o.sale_number}</b>
                <span className="text-muted-foreground">{new Date(o.sale_date).toLocaleDateString()}</span>
                <span className="tabular-nums">Total {usd(o.total)}</span>
                <span className="tabular-nums">Paid {usd(o.amount_paid)}</span>
                <span className="font-semibold tabular-nums text-warning-foreground">Balance {usd(o.balance_due)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {outstanding && (
        <ReceivePaymentDialog
          open={receiveOpen}
          onOpenChange={setReceiveOpen}
          customerId={customerId}
          customerName={customer.companyName || `${customer.firstName} ${customer.lastName}`.trim()}
          outstanding={Number(outstanding.total_outstanding)}
          sales={outstanding.sales}
        />
      )}

      <HistoryPanel
        title="Quotes"
        rows={customerQuotes}
        onOpen={onOpenQuote}
        getNumber={(q) => q.quote_number}
        getSubtitle={(q) => q.status}
        getTotal={(q) => Number(q.total)}
      />
      <HistoryPanel
        title="Sales / Invoices"
        rows={customerSales}
        onOpen={onOpenSale}
        getNumber={(s) => s.sale_number ?? s.id.slice(0, 8)}
        getSubtitle={(s) => s.payment_status}
        getTotal={(s) => Number(s.total)}
      />
      <HistoryPanel
        title="Payments"
        rows={customerPayments}
        getNumber={(p) => p.id.slice(0, 8)}
        getSubtitle={(p) => p.method}
        getTotal={(p) => Number(p.amount)}
      />
    </div>
  );
}
