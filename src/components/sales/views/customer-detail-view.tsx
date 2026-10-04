"use client";

import { useCustomerRecord, useCustomerHistory } from "@/lib/query/customers";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HistoryPanel } from "@/components/sales/shared";
import { useSalesData } from "@/components/sales/sales-data-context";
import { itemTotals } from "@/lib/mock/sales";

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
  onStartSale: () => void;
  onOpenQuote: (id: string) => void;
  onOpenSale: (id: string) => void;
}) {
  const { quotes } = useSalesData();
  const recordQuery = useCustomerRecord(customerId);
  const historyQuery = useCustomerHistory(customerId);
  const customer = recordQuery.data ?? null;
  if (!customer) return null;

  const customerQuotes = quotes.filter((q) => q.customerId === customerId);
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
              {customer.customerNumber} · {customer.taxStatus.toUpperCase()}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onStartSale}>
              Start Sale
            </Button>
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
        <label className="mt-4 inline-flex cursor-pointer items-center rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary">
          Attach resale certificate / document
          <input
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) {
                toast.info("Document upload is not connected yet.");
                toast.success("Document attached");
              }
              e.target.value = "";
            }}
          />
        </label>
        {customer.documents.length > 0 && (
          <div className="mt-2 space-y-1">
            {customer.documents.map((d) => (
              <p key={d.id} className="text-sm text-primary">
                {d.filename}
              </p>
            ))}
          </div>
        )}
      </div>

      <HistoryPanel
        title="Quotes"
        rows={customerQuotes}
        onOpen={onOpenQuote}
        getNumber={(q) => q.quoteNumber}
        getSubtitle={(q) => q.status}
        getTotal={(q) => itemTotals(q.items, q.discount, q.taxRate).total}
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
