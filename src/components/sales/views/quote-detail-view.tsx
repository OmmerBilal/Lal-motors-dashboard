"use client";

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/status-badge";
import { QuoteItemsEditor, TotalsBlock } from "@/components/sales/shared";
import { useSalesData } from "@/components/sales/sales-data-context";
import { itemTotals, usd, type SaleItem } from "@/lib/mock/sales";

export function QuoteDetailView({
  quoteId,
  manager,
  onBack,
  onConverted,
}: {
  quoteId: string;
  manager: boolean;
  onBack: () => void;
  onConverted: (saleId: string) => void;
}) {
  const { getQuote, getCustomer, updateQuoteItems, setQuoteStatus, convertQuote } = useSalesData();
  const quote = getQuote(quoteId);
  const [busy, setBusy] = useState(false);
  const [localItems, setLocalItems] = useState<SaleItem[]>(quote?.items ?? []);

  if (!quote) return null;
  const customer = getCustomer(quote.customerId);
  const editable = quote.status === "DRAFT" || quote.status === "SENT";
  const totals = itemTotals(localItems, quote.discount, quote.taxRate);

  function saveChanges() {
    updateQuoteItems(quote!.id, localItems);
    toast.success("Quote changes saved");
  }

  function handleConvert() {
    if (!window.confirm("Finalize this sale and update inventory?")) return;
    setBusy(true);
    const saleId = convertQuote(quote!.id);
    setBusy(false);
    toast.success("Sale finalized");
    onConverted(saleId);
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ChevronLeft className="size-4" /> Quotes
      </button>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{quote.quoteNumber}</h3>
            <p className="text-sm text-muted-foreground">
              {customer?.companyName || `${customer?.firstName} ${customer?.lastName}`} · <StatusBadge>{quote.status}</StatusBadge>
            </p>
          </div>
          <b className="text-lg">{usd(totals.total)}</b>
        </div>

        <QuoteItemsEditor items={localItems} editable={editable} onChange={setLocalItems} />
        <TotalsBlock subtotal={totals.subtotal} discount={totals.discount} tax={totals.tax} taxRate={quote.taxRate} total={totals.total} />

        {editable && (
          <Button variant="outline" size="sm" className="mt-4" onClick={saveChanges}>
            Save Quote Changes
          </Button>
        )}

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          {quote.status === "DRAFT" && (
            <>
              <Button variant="outline" onClick={() => setQuoteStatus(quote!.id, "SENT")}>
                Mark Sent
              </Button>
              {manager && <Button onClick={() => setQuoteStatus(quote!.id, "APPROVED")}>Manager Approve</Button>}
            </>
          )}
          {quote.status === "APPROVED" && manager && (
            <Button disabled={busy} onClick={handleConvert}>
              Finalize Sale & Update Inventory
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
