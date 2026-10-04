"use client";

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/status-badge";
import { QuoteItemsEditor, TotalsBlock } from "@/components/sales/shared";
import { computePosTotals } from "@/lib/mock/pos";
import { usd, type SaleItem } from "@/lib/mock/sales";
import { cartToLines, salesErrorMessage, type SaleMode } from "@/lib/data/sales";
import { quoteItemsToCart } from "@/lib/data/quotes";
import { useQuoteDetail, useUpdateQuote, useSetQuoteStatus, useConvertQuote } from "@/lib/query/quotes";

const convertModes: { id: SaleMode; label: string; confirm: string }[] = [
  { id: "draft", label: "Draft", confirm: "Create a draft sale? No stock will be held or moved." },
  { id: "reserve", label: "Reserve", confirm: "Create the sale and reserve stock for it?" },
  { id: "fulfill_now", label: "Fulfill Now", confirm: "Create the sale and consume stock now?" },
];

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
  const detailQuery = useQuoteDetail(quoteId);
  const updateQuote = useUpdateQuote();
  const setStatus = useSetQuoteStatus();
  const convert = useConvertQuote();
  // Local edits only. Null means "show the server's lines".
  const [edits, setEdits] = useState<SaleItem[] | null>(null);
  const [convertMode, setConvertMode] = useState<SaleMode>("draft");

  if (detailQuery.isPending) return <p className="py-6 text-center text-sm text-muted-foreground">Loading quote…</p>;
  if (detailQuery.isError) return <p className="py-6 text-center text-sm text-destructive">{detailQuery.error.message}</p>;
  const detail = detailQuery.data;
  if (!detail) return null;

  const quote = detail.quote;
  const customer = detail.customer;
  const editable = quote.status === "DRAFT" || quote.status === "SENT";
  const serverItems = quoteItemsToCart(detail.items);
  const localItems = edits ?? serverItems;
  const busy = updateQuote.isPending || setStatus.isPending || convert.isPending;

  // While editing, the preview uses the stored rate. The server recalculates on save.
  const preview = edits
    ? computePosTotals({ items: edits, discount: Number(quote.discount), coreCharge: 0, taxRate: Number(quote.tax_rate), depositApplied: 0, amountPaid: 0 })
    : null;
  const subtotal = preview ? preview.subtotal : Number(quote.subtotal);
  const tax = preview ? preview.tax : Number(quote.tax);
  const total = preview ? preview.grandTotal : Number(quote.total);

  async function saveChanges() {
    if (!customer) return;
    try {
      const r = await updateQuote.mutateAsync({
        quoteId,
        customerId: customer.id,
        lines: cartToLines(localItems),
        discount: Number(quote.discount),
        notes: quote.notes ?? "",
      });
      setEdits(null);
      toast.success(`${quote.quote_number} saved at ${usd(r.total)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : salesErrorMessage(null));
    }
  }

  async function changeStatus(status: "SENT" | "APPROVED" | "DECLINED") {
    try {
      await setStatus.mutateAsync({ quoteId, status });
      toast.success(`${quote.quote_number} marked ${status.toLowerCase()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : salesErrorMessage(null));
    }
  }

  async function handleConvert() {
    const option = convertModes.find((m) => m.id === convertMode);
    if (!window.confirm(option?.confirm ?? "Create the sale?")) return;
    try {
      const r = await convert.mutateAsync({ quoteId, mode: convertMode });
      toast.success(r.idempotent_replay ? "This quote already has its sale" : "Sale created from quote");
      onConverted(r.sale_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : salesErrorMessage(null));
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ChevronLeft className="size-4" /> Quotes
      </button>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{quote.quote_number}</h3>
            <p className="text-sm text-muted-foreground">
              {customer?.name ?? "Customer"} · <StatusBadge>{quote.status}</StatusBadge>
            </p>
          </div>
          <b className="text-lg">{usd(total)}</b>
        </div>

        <QuoteItemsEditor items={localItems} editable={editable && manager} onChange={setEdits} />
        <TotalsBlock subtotal={subtotal} discount={Number(quote.discount)} tax={tax} taxRate={Number(quote.tax_rate)} total={total} />
        {preview && <p className="mt-2 text-xs text-muted-foreground">Preview. The total is saved as the server calculates it.</p>}

        {editable && manager && edits && (
          <div className="mt-4 flex gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={saveChanges}>
              {updateQuote.isPending ? "Saving…" : "Save Quote Changes"}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEdits(null)}>
              Discard changes
            </Button>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          {quote.status === "DRAFT" && (
            <Button variant="outline" disabled={busy} onClick={() => changeStatus("SENT")}>
              Mark Sent
            </Button>
          )}
          {(quote.status === "DRAFT" || quote.status === "SENT") && manager && (
            <Button variant="ghost" disabled={busy} onClick={() => changeStatus("DECLINED")}>
              Decline
            </Button>
          )}
          {quote.status === "SENT" && manager && (
            <Button disabled={busy} onClick={() => changeStatus("APPROVED")}>
              Manager Approve
            </Button>
          )}
        </div>

        {quote.status === "APPROVED" && manager && (
          <div className="mt-4 space-y-2 rounded-md border border-border bg-muted/20 p-3">
            <p className="text-sm font-semibold">Create the sale</p>
            <div className="grid grid-cols-3 gap-2">
              {convertModes.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setConvertMode(m.id)}
                  className={`rounded-md border px-2 py-2 text-xs font-semibold ${convertMode === m.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <Button disabled={busy} onClick={handleConvert}>
              {convert.isPending ? "Creating sale…" : "Create Sale from Quote"}
            </Button>
          </div>
        )}

        {detail.converted_sale && (
          <div className="mt-4 flex items-center justify-between rounded-md border border-success/30 bg-success/5 p-3 text-sm">
            <span>
              Converted to sale <b>{detail.converted_sale.sale_number ?? "—"}</b>. This quote is locked.
            </span>
            <Button variant="outline" size="sm" onClick={() => onConverted(detail.converted_sale!.id)}>
              Open sale
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
