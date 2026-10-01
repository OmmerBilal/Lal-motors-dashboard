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
import { PaymentStep } from "@/components/sales/pos/payment-step";
import { LowerInfoArea } from "@/components/sales/pos/lower-info-area";
import { AdvancedActionsBar } from "@/components/sales/pos/advanced-actions-bar";
import { ReturnsPanel } from "@/components/sales/pos/returns-panel";
import { useSalesData } from "@/components/sales/sales-data-context";
import { ReceiptPrint, InvoicePrint, type PrintSaleData } from "@/components/sales/pos/print/print-document";
import type { Customer, PaymentMethod, SaleItem } from "@/lib/mock/sales";
import type { PartSearchResult } from "@/lib/mock/pos";
import { computePosTotals } from "@/lib/mock/pos";
import type { User } from "@/lib/types";

export function PosDeskView({ user, initialCustomerId }: { user: User; initialCustomerId?: string | null }) {
  const { customers, settings, createQuote, quotes, sales, payments, completePosSale, recordPayment, getCustomer } = useSalesData();

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    () => customers.find((c) => c.id === initialCustomerId) ?? null
  );
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerPrefill, setCustomerPrefill] = useState<Record<string, string> | undefined>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadQuoteOpen, setLoadQuoteOpen] = useState(false);

  const [items, setItems] = useState<SaleItem[]>([]);
  const [selectedPart, setSelectedPart] = useState<PartSearchResult | null>(null);
  const [discount, setDiscount] = useState(0);
  const [coreCharge, setCoreCharge] = useState(0);
  const [depositApplied, setDepositApplied] = useState(0);
  const [notes, setNotes] = useState("");
  const [taxExempt, setTaxExempt] = useState(false);
  const [overridePrice, setOverridePrice] = useState(false);

  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [tendered, setTendered] = useState("");
  const [completedSaleId, setCompletedSaleId] = useState<string | null>(null);
  const [paidAmount, setPaidAmount] = useState(0);
  const [printMode, setPrintMode] = useState<"receipt" | "invoice" | null>(null);
  const [overridePrintData, setOverridePrintData] = useState<PrintSaleData | null>(null);

  const effectiveTaxExempt = taxExempt || selectedCustomer?.taxStatus === "exempt";
  const taxRate = effectiveTaxExempt ? 0 : settings.taxRate;
  const totals = computePosTotals({ items, discount, coreCharge, taxRate, depositApplied, amountPaid: 0 });
  const tenderedNum = Number(tendered) || 0;
  const canComplete = items.length > 0 && !!selectedCustomer && (method !== "CASH" || tenderedNum >= totals.balanceDue);

  function addPart(result: PartSearchResult) {
    const { part } = result;
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
        stockSku: part.stockSku || "",
        description: part.draft.partName || part.draft.title || "Part",
        quantity: 1,
        unitPrice: Number(part.draft.price) || 0,
        discount: 0,
        availableQuantity: part.quantity,
      },
    ]);
    setSelectedPart(result);
    toast.success(`${part.stockSku || "Part"} added to sale`);
  }

  function addManualItem(input: { description: string; price: number; quantity: number }) {
    setItems((xs) => [
      ...xs,
      { id: `manual-${Date.now()}`, manual: true, stockSku: "MANUAL", description: input.description, quantity: input.quantity, unitPrice: input.price, discount: 0 },
    ]);
    toast.success("Manual item added to sale");
  }

  function resetTransaction() {
    setItems([]);
    setSelectedPart(null);
    setDiscount(0);
    setCoreCharge(0);
    setDepositApplied(0);
    setNotes("");
    setTaxExempt(false);
    setOverridePrice(false);
    setMethod("CASH");
    setTendered("");
    setCompletedSaleId(null);
    setPaidAmount(0);
  }

  function clearSale() {
    if (!items.length) return;
    if (!window.confirm("Clear the current sale? This cannot be undone.")) return;
    resetTransaction();
  }

  function voidSale() {
    if (!window.confirm("Void this entire sale and start over?")) return;
    resetTransaction();
    setSelectedCustomer(null);
  }

  function saveQuote() {
    if (!selectedCustomer) return toast.error("Select a customer first.");
    if (!items.length) return toast.error("Add at least one item.");
    const id = createQuote(selectedCustomer.id, items, notes);
    const quote = quotes.find((q) => q.id === id);
    toast.success(`${quote?.quoteNumber || "Quote"} saved`);
    resetTransaction();
  }

  function loadQuote(quoteId: string) {
    const quote = quotes.find((q) => q.id === quoteId);
    if (!quote) return;
    const customer = customers.find((c) => c.id === quote.customerId) || null;
    setSelectedCustomer(customer);
    setItems(quote.items);
    setDiscount(quote.discount);
    setNotes(quote.notes);
    setLoadQuoteOpen(false);
    toast.success(`${quote.quoteNumber} loaded into the current sale`);
  }

  function completeSale() {
    if (!selectedCustomer) return;
    const saleId = completePosSale({
      customerId: selectedCustomer.id,
      items,
      discount,
      coreCharge,
      depositApplied,
      notes,
      taxExempt: effectiveTaxExempt,
    });
    const paid = method === "CASH" ? Math.min(tenderedNum, totals.balanceDue) : totals.balanceDue;
    if (paid > 0) recordPayment(saleId, paid, method, "", notes);
    setCompletedSaleId(saleId);
    setPaidAmount(paid);
    toast.success("Sale completed (demo record — no real payment captured)");
  }

  function printDocument(mode: "receipt" | "invoice") {
    setOverridePrintData(null);
    setPrintMode(mode);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  function printLastInvoice() {
    const last = [...sales].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    if (!last) {
      toast.error("No finalized sales yet.");
      return;
    }
    const paid = payments.filter((p) => p.saleId === last.id).reduce((s, p) => s + p.amount, 0) + (last.depositApplied || 0);
    setOverridePrintData({
      saleNumber: last.saleNumber,
      invoiceNumber: last.invoiceNumber,
      date: last.createdAt,
      employeeName: user.name,
      customer: getCustomer(last.customerId) || null,
      items: last.items,
      discount: last.discount,
      coreCharge: last.coreCharge || 0,
      depositApplied: last.depositApplied || 0,
      taxRate: last.taxRate,
      notes: last.notes || "",
      method: "CASH",
      amountPaid: paid,
      businessName: settings.businessName,
      taxLabel: settings.taxLabel,
    });
    setPrintMode("invoice");
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  const completedSale = completedSaleId ? sales.find((s) => s.id === completedSaleId) : undefined;
  const printData: PrintSaleData = overridePrintData || {
    saleNumber: completedSale?.saleNumber || "—",
    invoiceNumber: completedSale?.invoiceNumber || "—",
    date: completedSale?.createdAt || new Date().toISOString(),
    employeeName: user.name,
    customer: selectedCustomer,
    items,
    discount,
    coreCharge,
    depositApplied,
    taxRate,
    notes,
    method,
    amountPaid: paidAmount,
    businessName: settings.businessName,
    taxLabel: settings.taxLabel,
  };

  const draftQuotes = quotes.filter((q) => q.status === "DRAFT" || q.status === "SENT");

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-12">
        <div className="xl:col-span-3">
          <CustomerStep
            selectedCustomer={selectedCustomer}
            onSelectCustomer={setSelectedCustomer}
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
          <FindPartsStep selectedPartId={selectedPart?.part.id ?? null} onSelectPart={setSelectedPart} onAddPart={addPart} />
        </div>
        <div className="xl:col-span-3">
          <CurrentSaleStep
            items={items}
            onUpdateQuantity={(id, qty) => setItems((xs) => xs.map((i) => (i.id === id ? { ...i, quantity: Math.max(1, qty) } : i)))}
            onRemove={(id) => setItems((xs) => xs.filter((i) => i.id !== id))}
            onUpdatePrice={(id, price) => setItems((xs) => xs.map((i) => (i.id === id ? { ...i, unitPrice: Math.max(0, price) } : i)))}
            overridePrice={overridePrice}
            discount={discount}
            coreCharge={coreCharge}
            depositApplied={depositApplied}
            notes={notes}
            taxRate={taxRate}
            amountPaid={0}
            onSetDiscount={setDiscount}
            onSetCoreCharge={setCoreCharge}
            onSetDeposit={setDepositApplied}
            onSetNotes={setNotes}
            onClearSale={clearSale}
            onSaveQuote={saveQuote}
            onLoadQuote={() => setLoadQuoteOpen(true)}
          />
        </div>
        <div className="space-y-4 xl:col-span-2">
          <ManualItemPanel onAdd={addManualItem} />
          <ReturnsPanel />
        </div>
      </div>

      <PaymentStep
        balanceDue={totals.balanceDue}
        method={method}
        onSelectMethod={setMethod}
        tendered={tendered}
        onChangeTendered={setTendered}
        completedSaleId={completedSaleId}
        onCompleteSale={completeSale}
        onNewSale={resetTransaction}
        canComplete={canComplete}
        onPrintReceipt={() => printDocument("receipt")}
        onPrintInvoice={() => printDocument("invoice")}
      />

      <LowerInfoArea selected={selectedPart} />

      <AdvancedActionsBar
        taxExempt={taxExempt}
        onToggleTaxExempt={() => setTaxExempt((v) => !v)}
        overridePrice={overridePrice}
        onToggleOverridePrice={() => setOverridePrice((v) => !v)}
        onVoidSale={voidSale}
        onViewHistory={() => (selectedCustomer ? setHistoryOpen(true) : toast.error("Select a customer first."))}
        onPrintLastInvoice={printLastInvoice}
      />

      <CustomerModal
        open={customerModalOpen}
        onOpenChange={setCustomerModalOpen}
        editing={editingCustomer}
        manager
        prefill={customerPrefill}
        onSaved={(id) => {
          const c = customers.find((x) => x.id === id);
          if (c) setSelectedCustomer(c);
        }}
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
                loadQuote(id);
                setHistoryOpen(false);
              }}
              onOpenSale={() => {
                toast.info("Opening a finalized sale from history is view-only in the Sales & Invoices tab.");
                setHistoryOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={loadQuoteOpen} onOpenChange={setLoadQuoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Load a saved quote</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            {draftQuotes.map((q) => {
              const c = customers.find((x) => x.id === q.customerId);
              return (
                <button key={q.id} onClick={() => loadQuote(q.id)} className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent/40">
                  <span>
                    <b>{q.quoteNumber}</b> <span className="text-muted-foreground">· {c?.companyName || `${c?.firstName} ${c?.lastName}`}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{q.items.length} item(s)</span>
                </button>
              );
            })}
            {!draftQuotes.length && <p className="text-sm text-muted-foreground">No open quotes to load.</p>}
          </div>
        </DialogContent>
      </Dialog>

      {printMode === "receipt" && <ReceiptPrint data={printData} />}
      {printMode === "invoice" && <InvoicePrint data={printData} />}
    </div>
  );
}
