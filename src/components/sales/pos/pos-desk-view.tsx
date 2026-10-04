"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CustomerModal } from "@/components/sales/customer-modal";
import { CustomerDetailView } from "@/components/sales/views/customer-detail-view";
import { CustomerStep } from "@/components/sales/pos/customer-step";
import { FindPartsStep } from "@/components/sales/pos/find-parts-step";
import { ManualItemPanel } from "@/components/sales/pos/manual-item-panel";
import { CurrentSaleStep } from "@/components/sales/pos/current-sale-step";
import { PaymentStep, type CompletedSale } from "@/components/sales/pos/payment-step";
import { LowerInfoArea } from "@/components/sales/pos/lower-info-area";
import { AdvancedActionsBar } from "@/components/sales/pos/advanced-actions-bar";
import { ReturnsPanel } from "@/components/sales/pos/returns-panel";
import { ReceiptPrint, InvoicePrint, type PrintSaleData } from "@/components/sales/pos/print/print-document";
import { saleDetailToPrintData } from "@/components/sales/pos/print/sale-print-data";
import { usd, type Customer, type SaleItem } from "@/lib/mock/sales";
import { computePosTotals } from "@/lib/mock/pos";
import type { User } from "@/lib/types";
import { cartToLines, getSaleDetail, listSalePage, salesErrorMessage, type SellablePart, type SaleMode } from "@/lib/data/sales";
import { getQuoteDetail, quoteItemsToCart } from "@/lib/data/quotes";
import { useCustomerRecord } from "@/lib/query/customers";
import { useCreateSale, useSalesSettings } from "@/lib/query/sales";
import { useCreateQuote, useQuoteList } from "@/lib/query/quotes";

/** Open quotes the desk can load. Lines are copied into the sale; the quote itself is not changed. */
function LoadQuoteDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (id: string) => void }) {
  const quotes = useQuoteList("", null);
  const rows = (quotes.data?.pages.flatMap((p) => p.rows) ?? []).filter((q) => q.status === "DRAFT" || q.status === "SENT");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Load a saved quote</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          {rows.map((q) => (
            <button key={q.id} onClick={() => onPick(q.id)} className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent/40">
              <span>
                <b>{q.quote_number}</b> <span className="text-muted-foreground">· {q.customer_name}</span>
              </span>
              <span className="text-xs text-muted-foreground">{usd(q.total)}</span>
            </button>
          ))}
          {quotes.isPending && <p className="text-sm text-muted-foreground">Loading quotes…</p>}
          {!quotes.isPending && !rows.length && <p className="text-sm text-muted-foreground">No open quotes to load.</p>}
          {quotes.hasNextPage && (
            <button onClick={() => quotes.fetchNextPage()} className="w-full pt-2 text-xs font-semibold text-primary hover:underline">
              Load more quotes
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PosDeskView({ user, initialCustomerId }: { user: User; initialCustomerId?: string | null }) {
  // The desk keeps only the customer id. The full record is read from the database.
  const [selectedId, setSelectedId] = useState<string | null>(initialCustomerId ?? null);
  const customerQuery = useCustomerRecord(selectedId);
  const selectedCustomer: Customer | null = customerQuery.data ?? null;
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerPrefill, setCustomerPrefill] = useState<Record<string, string> | undefined>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadQuoteOpen, setLoadQuoteOpen] = useState(false);

  const settingsQuery = useSalesSettings();
  const settings = settingsQuery.data ?? null;
  const taxRate = settings?.taxRate ?? 0;

  const [items, setItems] = useState<SaleItem[]>([]);
  const [selectedPart, setSelectedPart] = useState<SellablePart | null>(null);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [overridePrice, setOverridePrice] = useState(false);
  const [mode, setMode] = useState<SaleMode>("draft");

  // One key per attempt: a retry after a lost response returns the same sale instead of a second one.
  const [saleRequestId, setSaleRequestId] = useState(() => crypto.randomUUID());
  const [quoteRequestId, setQuoteRequestId] = useState(() => crypto.randomUUID());
  const [completed, setCompleted] = useState<CompletedSale | null>(null);
  const [completedPrint, setCompletedPrint] = useState<PrintSaleData | null>(null);
  const [printMode, setPrintMode] = useState<"receipt" | "invoice" | null>(null);
  const [overridePrintData, setOverridePrintData] = useState<PrintSaleData | null>(null);

  const createSale = useCreateSale();
  const createQuote = useCreateQuote();

  const totals = computePosTotals({ items, discount, coreCharge: 0, taxRate, depositApplied: 0, amountPaid: 0 });
  const canComplete = items.length > 0 && !!selectedCustomer && !completed && !createSale.isPending;

  function addPart(part: SellablePart) {
    if (part.out_of_stock || part.available <= 0) {
      toast.error("This part is out of stock.");
      return;
    }
    if (items.some((i) => i.partId === part.id)) {
      toast.error("Part already added.");
      return;
    }
    setItems((xs) => [
      ...xs,
      {
        id: `cart-${part.id}`,
        manual: false,
        partId: part.id,
        stockSku: part.stock_sku || "",
        description: part.part_name,
        quantity: 1,
        unitPrice: Number(part.price) || 0,
        discount: 0,
        availableQuantity: part.available,
      },
    ]);
    setSelectedPart(part);
  }

  function addManualItem(input: { description: string; price: number; quantity: number }) {
    setItems((xs) => [
      ...xs,
      { id: `manual-${Date.now()}`, manual: true, stockSku: "MANUAL", description: input.description, quantity: input.quantity, unitPrice: input.price, discount: 0 },
    ]);
    toast.success("Manual item added to the sale screen");
  }

  function resetTransaction() {
    setItems([]);
    setSelectedPart(null);
    setDiscount(0);
    setNotes("");
    setOverridePrice(false);
    setMode("draft");
    setCompleted(null);
    setCompletedPrint(null);
    setSaleRequestId(crypto.randomUUID());
  }

  function clearSale() {
    if (!items.length) return;
    if (!window.confirm("Clear the current sale screen? Nothing saved on the server is affected.")) return;
    resetTransaction();
  }

  async function saveQuote() {
    if (!selectedCustomer) return toast.error("Select a customer first.");
    if (!items.length) return toast.error("Add at least one item.");
    try {
      const r = await createQuote.mutateAsync({ customerId: selectedCustomer.id, lines: cartToLines(items), discount, notes, clientRequestId: quoteRequestId });
      toast.success(`${r.quote_number} saved`);
      setQuoteRequestId(crypto.randomUUID());
      resetTransaction();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : salesErrorMessage(null));
    }
  }

  async function loadQuote(quoteId: string) {
    try {
      const d = await getQuoteDetail(quoteId);
      setSelectedId(d.customer?.id ?? null);
      setItems(quoteItemsToCart(d.items));
      setDiscount(Number(d.quote.discount));
      setNotes(d.quote.notes ?? "");
      setLoadQuoteOpen(false);
      toast.success(`${d.quote.quote_number} loaded into the sale screen`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The quote could not be loaded.");
    }
  }

  async function completeSale() {
    if (!selectedCustomer || !items.length) return;
    const lines = cartToLines(items);
    try {
      const r = await createSale.mutateAsync({
        customerId: selectedCustomer.id,
        lines,
        mode,
        discount,
        notes,
        clientRequestId: saleRequestId,
      });
      // Shown only after the server confirms the sale.
      setCompleted({ saleId: r.sale_id, saleNumber: r.sale_number, total: r.total, fulfillmentStatus: r.fulfillment_status });
      setCompletedPrint({
        saleNumber: r.sale_number,
        invoiceNumber: r.sale_number,
        date: new Date().toISOString(),
        employeeName: user.name,
        customer: selectedCustomer,
        items,
        discount,
        coreCharge: 0,
        depositApplied: 0,
        taxRate,
        notes,
        amountPaid: 0,
        businessName: settings?.businessName ?? "",
        taxLabel: settings?.taxLabel ?? "",
      });
      setSaleRequestId(crypto.randomUUID());
      toast.success(`Sale ${r.sale_number} saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : salesErrorMessage(null));
    }
  }

  function printDocument(kind: "receipt" | "invoice") {
    setOverridePrintData(null);
    setPrintMode(kind);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  async function printLastInvoice() {
    try {
      const page = await listSalePage("", null, null, 1);
      const last = page.rows[0];
      if (!last) {
        toast.error("No sales yet.");
        return;
      }
      const detail = await getSaleDetail(last.id);
      setOverridePrintData(saleDetailToPrintData(detail, user.name, settings));
      setPrintMode("invoice");
      requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The invoice could not be loaded.");
    }
  }

  const printData: PrintSaleData = overridePrintData ?? completedPrint ?? {
    saleNumber: "—",
    invoiceNumber: "—",
    date: new Date().toISOString(),
    employeeName: user.name,
    customer: selectedCustomer,
    items,
    discount,
    coreCharge: 0,
    depositApplied: 0,
    taxRate,
    notes,
    amountPaid: 0,
    businessName: settings?.businessName ?? "",
    taxLabel: settings?.taxLabel ?? "",
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-12">
        <div className="xl:col-span-3">
          <CustomerStep
            selectedCustomer={selectedCustomer}
            onSelectCustomer={(c) => setSelectedId(c?.id ?? null)}
            onNewCustomer={(prefill) => {
              setEditingCustomer(null);
              setCustomerPrefill(prefill as Record<string, string> | undefined);
              setCustomerModalOpen(true);
            }}
            onEditCustomer={() => {
              setEditingCustomer(selectedCustomer);
              setCustomerPrefill(undefined);
              setCustomerModalOpen(true);
            }}
            onViewHistory={() => setHistoryOpen(true)}
          />
        </div>
        <div className="xl:col-span-4">
          <FindPartsStep selectedPartId={selectedPart?.id ?? null} onSelectPart={setSelectedPart} onAddPart={addPart} />
        </div>
        <div className="xl:col-span-3">
          <CurrentSaleStep
            items={items}
            onUpdateQuantity={(id, qty) =>
              setItems((xs) =>
                xs.map((i) => {
                  if (i.id !== id) return i;
                  const next = Math.max(1, qty || 1);
                  return { ...i, quantity: i.manual || i.availableQuantity === undefined ? next : Math.min(next, i.availableQuantity) };
                })
              )
            }
            onRemove={(id) => setItems((xs) => xs.filter((i) => i.id !== id))}
            onUpdatePrice={(id, price) => setItems((xs) => xs.map((i) => (i.id === id ? { ...i, unitPrice: Math.max(0, price) } : i)))}
            overridePrice={overridePrice}
            discount={discount}
            notes={notes}
            taxRate={taxRate}
            totals={totals}
            onSetDiscount={setDiscount}
            onSetNotes={setNotes}
            onClearSale={clearSale}
            onSaveQuote={saveQuote}
            savingQuote={createQuote.isPending}
            onLoadQuote={() => setLoadQuoteOpen(true)}
          />
        </div>
        <div className="space-y-4 xl:col-span-2">
          <ManualItemPanel onAdd={addManualItem} />
          <ReturnsPanel />
        </div>
      </div>

      <PaymentStep
        mode={mode}
        onSelectMode={setMode}
        canComplete={canComplete}
        completing={createSale.isPending}
        completed={completed}
        onComplete={completeSale}
        onNewSale={resetTransaction}
        onPrintReceipt={() => printDocument("receipt")}
        onPrintInvoice={() => printDocument("invoice")}
      />

      <LowerInfoArea selected={selectedPart} />

      <AdvancedActionsBar
        overridePrice={overridePrice}
        onToggleOverridePrice={() => setOverridePrice((v) => !v)}
        onVoidSale={() => {
          if (window.confirm("Clear the sale screen? Nothing saved on the server is affected.")) {
            resetTransaction();
            setSelectedId(null);
          }
        }}
        onViewHistory={() => (selectedCustomer ? setHistoryOpen(true) : toast.error("Select a customer first."))}
        onPrintLastInvoice={printLastInvoice}
      />

      <CustomerModal
        open={customerModalOpen}
        onOpenChange={setCustomerModalOpen}
        editing={editingCustomer}
        manager
        prefill={customerPrefill}
        onSaved={(id) => setSelectedId(id)}
      />

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Customer History</DialogTitle>
          </DialogHeader>
          {selectedCustomer && (
            <CustomerDetailView
              customerId={selectedCustomer.id}
              onBack={() => setHistoryOpen(false)}
              onEdit={() => {
                setEditingCustomer(selectedCustomer);
                setHistoryOpen(false);
                setCustomerModalOpen(true);
              }}
              onStartSale={() => setHistoryOpen(false)}
              onOpenQuote={(id) => {
                setHistoryOpen(false);
                loadQuote(id);
              }}
              onOpenSale={() => {
                toast.info("Open finalized sales from the Sales & Invoices tab.");
                setHistoryOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <LoadQuoteDialog open={loadQuoteOpen} onOpenChange={setLoadQuoteOpen} onPick={loadQuote} />

      {printMode === "receipt" && <ReceiptPrint data={printData} />}
      {printMode === "invoice" && <InvoicePrint data={printData} />}
    </div>
  );
}
