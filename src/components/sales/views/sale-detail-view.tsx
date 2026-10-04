"use client";

import { useState } from "react";
import { ChevronLeft, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ItemsTable, TotalsBlock, HistoryPanel } from "@/components/sales/shared";
import { InvoicePrint } from "@/components/sales/pos/print/print-document";
import { saleDetailToPrintData } from "@/components/sales/pos/print/sale-print-data";
import { PaymentCreateDialog } from "@/components/sales/payments/payment-create-dialog";
import { usd } from "@/lib/mock/sales";
import { linesToItems, salesErrorMessage } from "@/lib/data/sales";
import { useSaleDetail, useSaleStockAction, useSalesSettings } from "@/lib/query/sales";
import { useSalePayments } from "@/lib/query/payments";

const statusLabel = (s: string) => s.replace(/_/g, " ").toLowerCase();

export function SaleDetailView({
  saleId,
  manager,
  onBack,
  onOpenPayment,
}: {
  saleId: string;
  manager: boolean;
  onBack: () => void;
  onOpenPayment: (paymentId: string) => void;
}) {
  const detailQuery = useSaleDetail(saleId);
  const settings = useSalesSettings().data ?? null;
  const payments = useSalePayments(saleId);
  const stock = useSaleStockAction();
  const [printing, setPrinting] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  if (detailQuery.isPending) return <p className="py-6 text-center text-sm text-muted-foreground">Loading sale…</p>;
  if (detailQuery.isError) return <p className="py-6 text-center text-sm text-destructive">{detailQuery.error.message}</p>;
  const detail = detailQuery.data;
  if (!detail) return null;

  const sale = detail.sale;
  const customer = detail.customer;
  const busy = stock.reserve.isPending || stock.release.isPending || stock.fulfill.isPending;
  const activeReservations = detail.reservations.filter((r) => r.status === "active").length;
  const hasDraftPartLines = detail.lines.some((l) => l.part_id && l.stock_action === "none");
  const isFulfilled = sale.fulfillment_status === "fulfilled";

  async function run(action: "reserve" | "release" | "fulfill") {
    const labels = { reserve: "Stock reserved", release: "Reservation released", fulfill: "Stock fulfilled" };
    try {
      if (action === "reserve") await stock.reserve.mutateAsync(saleId);
      if (action === "release") await stock.release.mutateAsync(saleId);
      if (action === "fulfill") await stock.fulfill.mutateAsync(saleId);
      toast.success(labels[action]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : salesErrorMessage(null));
    }
  }

  function printInvoice() {
    setPrinting(true);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  return (
    <div className="record-stack space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline print:hidden">
        <ChevronLeft className="size-4" /> Sales
      </button>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{sale.sale_number ?? "Sale"}</h3>
            <p className="text-sm text-muted-foreground">
              {customer?.name ?? "Customer"} · <StatusBadge>{sale.payment_status}</StatusBadge> · {statusLabel(sale.fulfillment_status)}
            </p>
            <p className="text-xs text-muted-foreground">Created {new Date(sale.created_at).toLocaleString()}</p>
          </div>
          <Button variant="outline" size="sm" onClick={printInvoice}>
            <Printer /> Print
          </Button>
        </div>

        {settings && (
          <div className="mb-4 rounded-md bg-muted/30 p-3 text-sm">
            <b className="block">{settings.businessName}</b>
            <span className="block text-muted-foreground">{settings.businessAddress}</span>
            <span className="block text-muted-foreground">{settings.businessPhone}</span>
          </div>
        )}

        {detail.quote && (
          <p className="mb-3 text-sm text-muted-foreground">
            From quote <b>{detail.quote.quote_number}</b> ({statusLabel(detail.quote.status)})
          </p>
        )}

        <ItemsTable items={linesToItems(detail.lines)} />
        <TotalsBlock subtotal={Number(sale.subtotal)} discount={Number(sale.discount)} tax={Number(sale.tax)} taxRate={Number(sale.tax_rate)} total={Number(sale.total)} />

        <div className="mt-5 grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-3">
          <div>
            <small className="block text-xs text-muted-foreground">Amount paid (posted only)</small>
            <b>{usd(sale.amount_paid)}</b>
          </div>
          <div>
            <small className="block text-xs text-muted-foreground">Balance due</small>
            <b>{usd(sale.balance_due)}</b>
          </div>
          <div>
            <small className="block text-xs text-muted-foreground">Payment status</small>
            <b>{sale.payment_status}</b>
          </div>
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Payments</h4>
            {manager && sale.status !== "CANCELLED" && (
              <Button variant="outline" size="sm" onClick={() => setPaymentOpen(true)}>
                Record payment
              </Button>
            )}
          </div>
          {payments.isPending && <p className="text-sm text-muted-foreground">Loading payments…</p>}
          {payments.isError && <p className="text-sm text-destructive">{payments.error.message}</p>}
          {payments.data && payments.data.length === 0 && <p className="text-sm text-muted-foreground">No payments allocated to this sale.</p>}
          {payments.data && payments.data.length > 0 && (
            <div className="divide-y divide-border rounded-md border border-border">
              {payments.data.map((p) => (
                <button
                  key={p.allocation_id}
                  onClick={() => onOpenPayment(p.payment_id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/30"
                >
                  <span>
                    <b className="block">Payment {p.payment_id.slice(0, 8)}</b>
                    <small className="text-xs text-muted-foreground">
                      {p.method.replace(/_/g, " ").toLowerCase()} · {p.payment_status}
                    </small>
                  </span>
                  <b>{usd(p.allocated_amount)}</b>
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Pending payments do not change the balance until posted.</p>
        </div>

        {manager && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4 print:hidden">
            {hasDraftPartLines && (
              <Button variant="outline" disabled={busy} onClick={() => run("reserve")}>
                Reserve stock
              </Button>
            )}
            {activeReservations > 0 && (
              <Button variant="outline" disabled={busy} onClick={() => run("release")}>
                Release reservation
              </Button>
            )}
            {activeReservations > 0 && !isFulfilled && (
              <Button disabled={busy} onClick={() => run("fulfill")}>
                Fulfill reserved stock
              </Button>
            )}
          </div>
        )}

        <div className="mt-5 border-t border-border pt-4">
          <h4 className="mb-2 text-sm font-semibold">Reservations</h4>
          {detail.reservations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reservations on this sale.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {detail.reservations.map((r) => (
                <li key={r.id}>
                  {r.quantity} × reserved · {r.status}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <HistoryPanel
        title="History"
        rows={detail.history.map((h, i) => ({ ...h, id: `${i}` }))}
        getNumber={(h) => h.summary}
        getSubtitle={(h) => `${h.actor_name ?? "System"} · ${new Date(h.created_at).toLocaleString()}`}
        getTotal={() => 0}
      />

      {printing && settings && (
        <InvoicePrint data={saleDetailToPrintData(detail, "LAL Motors Staff", settings)} />
      )}

      <PaymentCreateDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        customerId={customer?.id ?? null}
        customerName={customer?.name ?? ""}
        onCreated={(id) => onOpenPayment(id)}
      />
    </div>
  );
}
