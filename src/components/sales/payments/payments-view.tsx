"use client";

import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { ChevronLeft, CircleCheck, CircleDollarSign, CircleSlash, Plus, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, type StatusTone } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { MetricCard } from "@/components/patterns/metric-card";
import { PaymentCreateDialog } from "@/components/sales/payments/payment-create-dialog";
import { rangeToIso } from "@/components/sales/shared";
import { DateRangePicker } from "@/components/vehicles/owner-dashboard/date-range-picker";
import { useCustomerHistory } from "@/lib/query/customers";
import { usePaymentList, usePaymentDetail, usePaymentsSummary, useAllocatePayment, usePostPayment, useVoidPayment } from "@/lib/query/payments";
import { usd } from "@/lib/mock/sales";
import { salesErrorMessage } from "@/lib/data/sales";
import type { PaymentStatus } from "@/lib/data/payments";

const statusTone: Record<PaymentStatus, StatusTone> = { pending: "warning", posted: "success", void: "neutral" };
const statusWord: Record<PaymentStatus, string> = { pending: "Pending", posted: "Posted", void: "Void" };
const AMOUNT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

/** Lightweight list. Allocations and history load only on the detail screen. */
export function PaymentsList({ onOpen, manager }: { onOpen: (id: string) => void; manager: boolean }) {
  const [q, setQ] = useState("");
  // Front desk sees posted payments by default. Pending items are shown as a banner only when something needs attention.
  const [status, setStatus] = useState<PaymentStatus | null>("posted");
  const [createOpen, setCreateOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  // Half-open ISO [from, to) the list and the summary RPC both filter created_at by — undefined
  // range (nothing picked yet) means "all time" for both, so they always agree.
  const range = useMemo(() => rangeToIso(dateRange), [dateRange]);
  const list = usePaymentList(q.trim(), status, range);
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const pendingCheck = usePaymentList("", "pending");
  const pendingCount = pendingCheck.data?.pages.flatMap((p) => p.rows).length ?? 0;
  const summary = usePaymentsSummary(range);
  const s = summary.data;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard icon={Receipt} tone="info" label="Total Received" value={s ? usd(s.posted_amount) : "—"} hint={s ? `${s.posted_count} posted` : "Loading…"} />
        <MetricCard icon={CircleDollarSign} tone="warning" label="Pending" value={s ? usd(s.pending_amount) : "—"} hint={s ? `${s.pending_count} pending` : "Loading…"} />
        <MetricCard icon={CircleSlash} tone="neutral" label="Void" value={s ? usd(s.void_amount) : "—"} hint={s ? `${s.void_count} void` : "Loading…"} />
        <MetricCard icon={CircleCheck} tone="success" label="All Payments" value={s ? s.total_count : "—"} hint="in selected range" />
      </div>

      {pendingCount > 0 && status !== "pending" && (
        <button
          onClick={() => setStatus("pending")}
          className="flex w-full items-center justify-between rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-left text-sm"
        >
          <span><b>{pendingCount}</b> pending payment{pendingCount === 1 ? "" : "s"} need attention</span>
          <span className="text-xs font-semibold text-primary">Review</span>
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker value={dateRange} onChange={setDateRange} />
        <Input className="h-9 max-w-xs text-sm" placeholder="Customer name or reference" value={q} onChange={(e) => setQ(e.target.value)} />
        {([null, "pending", "posted", "void"] as const).map((st) => (
          <Button key={st ?? "all"} size="sm" variant={status === st ? "default" : "outline"} onClick={() => setStatus(st)}>
            {st ? statusWord[st] : "All"}
          </Button>
        ))}
        {manager && (
          <Button size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> Add payment
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        {list.isPending && <p className="p-4 text-sm text-muted-foreground">Loading payments…</p>}
        {list.isError && <p className="p-4 text-sm text-destructive">{list.error.message}</p>}
        {!list.isPending && !list.isError && rows.length === 0 && (
          <div className="p-6">
            <EmptyState title="No payments match." />
          </div>
        )}
        <div className="divide-y divide-border">
          {rows.map((p) => (
            <button key={p.id} onClick={() => onOpen(p.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Receipt className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm">{p.customer_name}</b>
                <small className="block truncate text-xs text-muted-foreground">
                  {p.method.replace(/_/g, " ").toLowerCase()} · allocated {usd(p.allocated_total)} · {new Date(p.created_at).toLocaleDateString()}
                </small>
              </span>
              <StatusBadge className="shrink-0" tone={statusTone[p.status]}>{statusWord[p.status]}</StatusBadge>
              <b className="shrink-0 text-sm whitespace-nowrap">{usd(p.amount)}</b>
            </button>
          ))}
        </div>
        {list.hasNextPage && (
          <div className="border-t border-border p-3">
            <Button variant="outline" size="sm" className="w-full" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              {list.isFetchingNextPage ? "Loading…" : "Load more payments"}
            </Button>
          </div>
        )}
      </div>

      <PaymentCreateDialog open={createOpen} onOpenChange={setCreateOpen} customerId={null} customerName="" onCreated={onOpen} />
    </div>
  );
}

/** One payment. Pending payments can be allocated, posted or voided. Posted payments can only be reversed, by an admin. */
export function PaymentDetailPanel({ paymentId, manager, onBack, onOpenSale }: { paymentId: string; manager: boolean; onBack: () => void; onOpenSale: (saleId: string) => void }) {
  const detailQuery = usePaymentDetail(paymentId);
  const detail = detailQuery.data;
  const customerId = detail?.payment.customer_id ?? null;
  const history = useCustomerHistory(customerId);
  const allocate = useAllocatePayment();
  const post = usePostPayment();
  const voidPay = useVoidPayment();
  const [allocSale, setAllocSale] = useState<string>("");
  const [allocAmount, setAllocAmount] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [showVoid, setShowVoid] = useState(false);

  if (detailQuery.isPending) return <p className="py-6 text-center text-sm text-muted-foreground">Loading payment…</p>;
  if (detailQuery.isError) return <p className="py-6 text-center text-sm text-destructive">{detailQuery.error.message}</p>;
  if (!detail) return null;

  const p = detail.payment;
  const saleIds = detail.allocations.map((a) => a.sale_id);
  const busy = allocate.isPending || post.isPending || voidPay.isPending;
  const unallocated = Number(p.unallocated_amount);
  const canAct = manager && p.status === "pending";
  const canVoid = manager && (p.status === "pending" || (p.status === "posted" && detail.viewer_is_admin));
  // Only sales that can still take money. The server applies the exact outstanding rule.
  const openSales = (history.data?.sales ?? []).filter((s) => Number(s.balance_due) > 0 && s.status !== "CANCELLED");

  async function allocateNow() {
    if (!allocSale) return toast.error("Choose a sale.");
    if (!AMOUNT_PATTERN.test(allocAmount) || Number(allocAmount) <= 0) return toast.error("Enter an amount greater than zero, up to two decimals.");
    try {
      await allocate.mutateAsync({ paymentId, saleId: allocSale, amount: allocAmount });
      toast.success("Allocated. The sale balance does not change until the payment is posted.");
      setAllocAmount("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : salesErrorMessage(null));
    }
  }

  async function postNow() {
    if (!window.confirm(`Post ${usd(p.amount)} to the allocated sales? This changes their paid and balance amounts.`)) return;
    try {
      await post.mutateAsync({ paymentId, customerId: p.customer_id, saleIds });
      toast.success("Payment posted. Sale balances updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : salesErrorMessage(null));
    }
  }

  async function voidNow() {
    if (voidReason.trim().length < 5) return toast.error("Give a reason of at least 5 characters.");
    const posted = p.status === "posted";
    if (!window.confirm(posted ? "Reverse this posted payment? The allocated sales will be restored. The record stays in history." : "Void this pending payment? The record stays in history.")) return;
    try {
      await voidPay.mutateAsync({ paymentId, reason: voidReason.trim(), customerId: p.customer_id, saleIds });
      toast.success(posted ? "Payment reversed and voided" : "Payment voided");
      setShowVoid(false);
      setVoidReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : salesErrorMessage(null));
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ChevronLeft className="size-4" /> Payments
      </button>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{detail.customer?.name ?? "Customer"}</h3>
            <p className="text-sm text-muted-foreground">
              {p.method.replace(/_/g, " ").toLowerCase()} · <StatusBadge tone={statusTone[p.status]}>{statusWord[p.status]}</StatusBadge>
            </p>
          </div>
          <b className="text-lg">{usd(p.amount)}</b>
        </div>

        <div className="grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-3">
          <div>
            <small className="block text-xs text-muted-foreground">Allocated</small>
            <b>{usd(p.allocated_total)}</b>
          </div>
          <div>
            <small className="block text-xs text-muted-foreground">Unallocated</small>
            <b>{usd(p.unallocated_amount)}</b>
          </div>
          <div>
            <small className="block text-xs text-muted-foreground">Posted</small>
            <b>{p.posted_at ? new Date(p.posted_at).toLocaleString() : "Not posted"}</b>
          </div>
        </div>
        {p.status === "pending" && <p className="mt-2 text-xs text-muted-foreground">Pending. Sale balances do not change until this payment is posted.</p>}
        {p.status === "void" && <p className="mt-2 text-xs text-muted-foreground">Void: {p.void_reason ?? ""}</p>}
        {(p.reference || p.notes) && (
          <p className="mt-2 text-sm">
            {p.reference && <span className="block">Reference: {p.reference}</span>}
            {p.notes && <span className="block text-muted-foreground">{p.notes}</span>}
          </p>
        )}

        <div className="mt-4 border-t border-border pt-4">
          <h4 className="mb-2 text-sm font-semibold">Allocations</h4>
          {detail.allocations.length === 0 && <p className="text-sm text-muted-foreground">Not allocated to any sale yet.</p>}
          <div className="divide-y divide-border rounded-md border border-border">
            {detail.allocations.map((a) => (
              <button key={a.id} onClick={() => onOpenSale(a.sale_id)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent/30">
                <span>
                  <b>{a.sale_number ?? "Sale"}</b>
                  <small className="block text-xs text-muted-foreground">
                    Sale total {usd(a.sale_total)} · balance {usd(a.sale_balance_due)} · {a.sale_payment_status}
                  </small>
                </span>
                <b>{usd(a.amount)}</b>
              </button>
            ))}
          </div>
        </div>

        {canAct && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <h4 className="text-sm font-semibold">Allocate to a sale</h4>
            {openSales.length === 0 && <p className="text-sm text-muted-foreground">This customer has no open sales.</p>}
            {unallocated > 0 && openSales.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-3">
                <Select value={allocSale} onValueChange={(v) => setAllocSale(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sale" />
                  </SelectTrigger>
                  <SelectContent>
                    {openSales.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.sale_number ?? "Sale"} · balance {usd(s.balance_due)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input inputMode="decimal" placeholder={`Up to ${usd(unallocated)}`} value={allocAmount} onChange={(e) => setAllocAmount(e.target.value)} />
                <Button variant="outline" disabled={busy} onClick={allocateNow}>
                  {allocate.isPending ? "Allocating…" : "Allocate"}
                </Button>
              </div>
            )}
            <div>
              <Button disabled={busy || unallocated !== 0 || detail.allocations.length === 0} onClick={postNow}>
                {post.isPending ? "Posting…" : "Post payment"}
              </Button>
              {unallocated !== 0 && <p className="mt-1 text-xs text-muted-foreground">Allocate the full amount before posting.</p>}
            </div>
          </div>
        )}

        {canVoid && (
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            {!showVoid ? (
              <Button variant="outline" size="sm" onClick={() => setShowVoid(true)}>
                {p.status === "posted" ? "Reverse & void (admin)" : "Void payment"}
              </Button>
            ) : (
              <div className="space-y-2">
                <Textarea rows={2} placeholder="Reason (required, at least 5 characters)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                <div className="flex gap-2">
                  <Button variant="destructive" size="sm" disabled={busy} onClick={voidNow}>
                    {voidPay.isPending ? "Saving…" : p.status === "posted" ? "Reverse and void" : "Void"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowVoid(false)}>
                    Cancel
                  </Button>
                </div>
                {p.status === "posted" && <p className="text-xs text-muted-foreground">Reversal restores the amount on each allocated sale. Nothing is deleted.</p>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-4">
          <h3 className="text-sm font-semibold">History</h3>
        </div>
        <div className="divide-y divide-border">
          {detail.history.map((h, i) => (
            <div key={i} className="px-4 py-2 text-sm">
              <span className="block">{h.summary}</span>
              <small className="text-xs text-muted-foreground">
                {h.actor_name ?? "System"} · {new Date(h.created_at).toLocaleString()}
              </small>
            </div>
          ))}
          {detail.history.length === 0 && <p className="p-4 text-sm text-muted-foreground">No history yet.</p>}
        </div>
      </div>
    </div>
  );
}
