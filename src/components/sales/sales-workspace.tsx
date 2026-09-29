"use client";

import { useState } from "react";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { User } from "@/lib/types";
import { SalesDataProvider, useSalesData } from "@/components/sales/sales-data-context";
import { DeskView } from "@/components/sales/views/desk-view";
import { CustomersView } from "@/components/sales/views/customers-view";
import { CustomerDetailView } from "@/components/sales/views/customer-detail-view";
import { ListPanel } from "@/components/sales/shared";
import { QuoteDetailView } from "@/components/sales/views/quote-detail-view";
import { SaleDetailView } from "@/components/sales/views/sale-detail-view";
import { AiView } from "@/components/sales/views/ai-view";
import { SettingsView } from "@/components/sales/views/settings-view";
import { CustomerModal } from "@/components/sales/customer-modal";
import { itemTotals, saleBalance, type Customer } from "@/lib/mock/sales";

type View = "desk" | "customers" | "customer" | "quotes" | "quote" | "sales" | "sale" | "ai" | "settings";

function WorkspaceBody({ user, initialCustomerId }: { user: User; initialCustomerId?: string | null }) {
  const manager = user.role !== "employee";
  const { quotes, sales, payments, getCustomer } = useSalesData();
  const [view, setView] = useState<View>(initialCustomerId ? "customer" : "desk");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(initialCustomerId ?? null);
  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null);
  const [activeSaleId, setActiveSaleId] = useState<string | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const tabs: { id: View; label: string }[] = [
    { id: "desk", label: "Sales Desk" },
    { id: "customers", label: "Customers" },
    { id: "quotes", label: "Quotes" },
    { id: "sales", label: "Sales & Invoices" },
    { id: "ai", label: "Sales AI Manager" },
    ...(user.role === "owner" || user.role === "engineer_admin" ? [{ id: "settings" as View, label: "Tax Settings" }] : []),
  ];

  function openCustomer(id: string) {
    setActiveCustomerId(id);
    setView("customer");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-lg bg-brand p-5 text-brand-foreground">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-accent-gold uppercase">Sales Operations</p>
          <h2 className="mt-1 text-xl font-semibold">Customers & Sales</h2>
          <p className="mt-1 text-sm text-brand-foreground/70">Customer → Quote → Sale → Payment → Invoice</p>
        </div>
        <ShoppingCart className="hidden size-12 text-accent-gold/60 sm:block" />
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Button key={t.id} size="sm" variant={view === t.id ? "default" : "outline"} onClick={() => setView(t.id)}>
            {t.label}
          </Button>
        ))}
      </div>

      {view === "desk" && (
        <DeskView
          manager={manager}
          selectedCustomer={selectedCustomer}
          onSelectCustomer={setSelectedCustomer}
          onNewCustomer={() => {
            setEditingCustomer(null);
            setCustomerModalOpen(true);
          }}
          onQuoteCreated={(id) => {
            setActiveQuoteId(id);
            setView("quote");
          }}
          onSaleCreated={(id) => {
            setActiveSaleId(id);
            setView("sale");
          }}
        />
      )}

      {view === "customers" && (
        <CustomersView
          onOpen={openCustomer}
          onNew={() => {
            setEditingCustomer(null);
            setCustomerModalOpen(true);
          }}
        />
      )}

      {view === "customer" && activeCustomerId && (
        <CustomerDetailView
          customerId={activeCustomerId}
          onBack={() => setView("customers")}
          onEdit={() => {
            setEditingCustomer(getCustomer(activeCustomerId) ?? null);
            setCustomerModalOpen(true);
          }}
          onStartSale={() => {
            const c = getCustomer(activeCustomerId);
            if (c) {
              setSelectedCustomer(c);
              setView("desk");
            }
          }}
          onOpenQuote={(id) => {
            setActiveQuoteId(id);
            setView("quote");
          }}
          onOpenSale={(id) => {
            setActiveSaleId(id);
            setView("sale");
          }}
        />
      )}

      {view === "quotes" && (
        <ListPanel
          title="Quotes"
          rows={quotes}
          onOpen={(id) => {
            setActiveQuoteId(id);
            setView("quote");
          }}
          getNumber={(q) => q.quoteNumber}
          getSubtitle={(q) => {
            const c = getCustomer(q.customerId);
            return `${c?.companyName || `${c?.firstName} ${c?.lastName}`} · ${q.status}`;
          }}
          getTotal={(q) => itemTotals(q.items, q.discount, q.taxRate).total}
        />
      )}

      {view === "quote" && activeQuoteId && (
        <QuoteDetailView
          quoteId={activeQuoteId}
          manager={manager}
          onBack={() => setView("quotes")}
          onConverted={(saleId) => {
            setActiveSaleId(saleId);
            setView("sale");
          }}
        />
      )}

      {view === "sales" && (
        <ListPanel
          title="Finalized Sales & Invoices"
          rows={sales}
          onOpen={(id) => {
            setActiveSaleId(id);
            setView("sale");
          }}
          getNumber={(s) => s.saleNumber}
          getSubtitle={(s) => {
            const c = getCustomer(s.customerId);
            return `${c?.companyName || `${c?.firstName} ${c?.lastName}`} · ${saleBalance(s, payments).paymentStatus}`;
          }}
          getTotal={(s) => saleBalance(s, payments).total}
        />
      )}

      {view === "sale" && activeSaleId && <SaleDetailView saleId={activeSaleId} manager={manager} onBack={() => setView("sales")} />}

      {view === "ai" && <AiView />}

      {view === "settings" && <SettingsView manager={manager} />}

      <CustomerModal
        open={customerModalOpen}
        onOpenChange={setCustomerModalOpen}
        editing={editingCustomer}
        manager={manager}
        onSaved={openCustomer}
      />
    </div>
  );
}

export function SalesWorkspace({ user, initialCustomerId }: { user: User; initialCustomerId?: string | null }) {
  return (
    <SalesDataProvider>
      <WorkspaceBody user={user} initialCustomerId={initialCustomerId} />
    </SalesDataProvider>
  );
}
