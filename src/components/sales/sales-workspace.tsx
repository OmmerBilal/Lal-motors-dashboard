"use client";

import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { ShoppingCart, FileText, Receipt, CheckCircle2, CircleDollarSign, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { MetricCard } from "@/components/patterns/metric-card";
import type { User } from "@/lib/types";
import { PosDeskView } from "@/components/sales/pos/pos-desk-view";
import { CustomersView } from "@/components/sales/views/customers-view";
import { CustomerDetailView } from "@/components/sales/views/customer-detail-view";
import { QuoteDetailView } from "@/components/sales/views/quote-detail-view";
import { SaleDetailView } from "@/components/sales/views/sale-detail-view";
import { AiView } from "@/components/sales/views/ai-view";
import { SettingsView } from "@/components/sales/views/settings-view";
import { CustomerModal } from "@/components/sales/customer-modal";
import { PaymentsList, PaymentDetailPanel } from "@/components/sales/payments/payments-view";
import { rangeToIso } from "@/components/sales/shared";
import { DateRangePicker } from "@/components/vehicles/owner-dashboard/date-range-picker";
import { usd, type Customer } from "@/lib/mock/sales";
import { useQuoteList } from "@/lib/query/quotes";
import { useSaleList, useSalesSummary } from "@/lib/query/sales";
import { useCustomerRecord } from "@/lib/query/customers";
import type { QuoteStatus } from "@/lib/data/quotes";
import type { SaleListRow } from "@/lib/data/sales";

type View = "desk" | "customers" | "customer" | "quotes" | "quote" | "sales" | "sale" | "payments" | "payment" | "ai" | "settings";

const quoteStatuses: (QuoteStatus | null)[] = [null, "DRAFT", "SENT", "APPROVED", "CONVERTED"];
// The sales list filters on the sale's own status. Payment status is shown per row.
const saleStatuses: { value: string | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "CANCELLED", label: "Cancelled" },
];

function ListHeader({ title, count, children }: { title: string; count: number; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{count} record(s) loaded</p>
      </div>
      {children}
    </div>
  );
}

function QuotesList({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<QuoteStatus | null>(null);
  const list = useQuoteList(q.trim(), status);
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];
  return (
    <div className="rounded-lg border border-border bg-card">
      <ListHeader title="Quotes" count={rows.length}>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-8 w-48 text-xs" placeholder="Quote #, name" value={q} onChange={(e) => setQ(e.target.value)} />
          {quoteStatuses.map((s) => (
            <Button key={s ?? "all"} size="sm" variant={status === s ? "default" : "outline"} className="h-8 text-xs" onClick={() => setStatus(s)}>
              {s ?? "All"}
            </Button>
          ))}
        </div>
      </ListHeader>
      {list.isPending && <p className="p-4 text-sm text-muted-foreground">Loading quotes…</p>}
      {list.isError && <p className="p-4 text-sm text-destructive">{list.error.message}</p>}
      {!list.isPending && !list.isError && rows.length === 0 && (
        <div className="p-6">
          <EmptyState icon={FileText} title="No quotes match." />
        </div>
      )}
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <button key={r.id} onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <b className="block text-sm">{r.quote_number}</b>
              <small className="text-xs text-muted-foreground">
                {r.customer_name} · {r.status}
              </small>
            </span>
            <b className="text-sm">{usd(r.total)}</b>
          </button>
        ))}
      </div>
      {list.hasNextPage && (
        <div className="border-t border-border p-3">
          <Button variant="outline" size="sm" className="w-full" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            {list.isFetchingNextPage ? "Loading…" : "Load more quotes"}
          </Button>
        </div>
      )}
    </div>
  );
}

const SALE_PAYMENT_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  PAID: "success",
  PARTIAL: "warning",
  UNPAID: "danger",
};

function SalesList({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  // Half-open ISO [from, to) the list and the summary RPC both filter created_at by — undefined
  // range (nothing picked yet) means "all time" for both, so they always agree.
  const range = useMemo(() => rangeToIso(dateRange), [dateRange]);
  const list = useSaleList(q.trim(), status, range);
  const rows: SaleListRow[] = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const summary = useSalesSummary(range);
  const s = summary.data;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard icon={Receipt} tone="info" label="Total Sales" value={s ? usd(s.total_amount) : "—"} hint={s ? `${s.total_count} sale${s.total_count === 1 ? "" : "s"}` : "Loading…"} />
        <MetricCard icon={CheckCircle2} tone="success" label="Paid" value={s ? usd(s.paid_amount) : "—"} hint={s ? `${s.paid_count} paid` : "Loading…"} />
        <MetricCard icon={CircleDollarSign} tone="warning" label="Partial / Unpaid" value={s ? usd(s.outstanding_amount) : "—"} hint={s ? `${s.outstanding_count} pending` : "Loading…"} />
        <MetricCard icon={ListChecks} tone="neutral" label="Total Records" value={s ? s.total_count : "—"} hint="in selected range" />
      </div>

      <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Sales & Invoices" count={rows.length}>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
            <Input className="h-8 w-48 text-xs" placeholder="Sale #, name" value={q} onChange={(e) => setQ(e.target.value)} />
            {saleStatuses.map((st) => (
              <Button key={st.label} size="sm" variant={status === st.value ? "default" : "outline"} className="h-8 text-xs" onClick={() => setStatus(st.value)}>
                {st.label}
              </Button>
            ))}
          </div>
        </ListHeader>
        {list.isPending && <p className="p-4 text-sm text-muted-foreground">Loading sales…</p>}
        {list.isError && <p className="p-4 text-sm text-destructive">{list.error.message}</p>}
        {!list.isPending && !list.isError && rows.length === 0 && (
          <div className="p-6">
            <EmptyState icon={ShoppingCart} title="No sales match." />
          </div>
        )}
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <button key={r.id} onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Receipt className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm">{r.sale_number ?? "Sale"}</b>
                <small className="block truncate text-xs text-muted-foreground">
                  {r.customer_name} · {new Date(r.created_at).toLocaleDateString()}
                </small>
              </span>
              <span className="hidden shrink-0 text-right sm:block">
                <StatusBadge tone={SALE_PAYMENT_TONE[r.payment_status] ?? "neutral"}>{r.payment_status}</StatusBadge>
                <small className="mt-0.5 block text-xs text-muted-foreground">{r.fulfillment_status.replace(/_/g, " ")}</small>
              </span>
              <span className="shrink-0 text-right">
                <b className="block text-sm whitespace-nowrap">{usd(r.total)}</b>
                {Number(r.balance_due) > 0 && <small className="block text-xs whitespace-nowrap text-tone-red">bal {usd(r.balance_due)}</small>}
              </span>
            </button>
          ))}
        </div>
        {list.hasNextPage && (
          <div className="border-t border-border p-3">
            <Button variant="outline" size="sm" className="w-full" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              {list.isFetchingNextPage ? "Loading…" : "Load more sales"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceBody({ user, initialCustomerId }: { user: User; initialCustomerId?: string | null }) {
  const manager = user.role !== "employee";
  // Owner/admin oversee this module but don't run day-to-day POS work here — Sales Desk, the AI
  // manager and Tax Settings are hidden from their tab list (the underlying views/RPCs are untouched
  // and still reachable by the roles that keep them, e.g. manager, below).
  const isAdmin = user.role === "owner" || user.role === "engineer_admin";
  const [view, setView] = useState<View>(initialCustomerId ? "customer" : isAdmin ? "customers" : "desk");
  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(initialCustomerId ?? null);
  const [deskCustomerId, setDeskCustomerId] = useState<string | null>(null);
  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null);
  const [activeSaleId, setActiveSaleId] = useState<string | null>(null);
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const activeCustomer = useCustomerRecord(activeCustomerId).data ?? null;

  const tabs: { id: View; label: string }[] = isAdmin
    ? [
        { id: "customers", label: "Customers" },
        { id: "quotes", label: "Quotes" },
        { id: "sales", label: "Sales & Invoices" },
        { id: "payments", label: "Payments" },
      ]
    : [
        { id: "desk", label: "Sales Desk" },
        { id: "customers", label: "Customers" },
        { id: "quotes", label: "Quotes" },
        { id: "sales", label: "Sales & Invoices" },
        { id: "payments", label: "Payments" },
        { id: "ai", label: "Sales AI Manager" },
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
          <Button
            key={t.id}
            size="sm"
            variant={view === t.id || (t.id === "payments" && view === "payment") ? "default" : "outline"}
            onClick={() => {
              if (t.id === "desk" && view !== "desk") setDeskCustomerId(null);
              setView(t.id);
            }}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {view === "desk" && <PosDeskView key={deskCustomerId ?? "desk"} user={user} initialCustomerId={deskCustomerId} />}

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
            setEditingCustomer(activeCustomer);
            setCustomerModalOpen(true);
          }}
          onStartSale={
            isAdmin
              ? undefined
              : () => {
                  setDeskCustomerId(activeCustomerId);
                  setView("desk");
                }
          }
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

      {view === "quotes" && <QuotesList onOpen={(id) => { setActiveQuoteId(id); setView("quote"); }} />}

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

      {view === "sales" && <SalesList onOpen={(id) => { setActiveSaleId(id); setView("sale"); }} />}

      {view === "sale" && activeSaleId && (
        <SaleDetailView
          saleId={activeSaleId}
          manager={manager}
          onBack={() => setView("sales")}
          onOpenPayment={(id) => {
            setActivePaymentId(id);
            setView("payment");
          }}
        />
      )}

      {view === "payments" && <PaymentsList manager={manager} onOpen={(id) => { setActivePaymentId(id); setView("payment"); }} />}

      {view === "payment" && activePaymentId && (
        <PaymentDetailPanel
          paymentId={activePaymentId}
          manager={manager}
          onBack={() => setView("payments")}
          onOpenSale={(id) => {
            setActiveSaleId(id);
            setView("sale");
          }}
        />
      )}

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
  return <WorkspaceBody user={user} initialCustomerId={initialCustomerId} />;
}
