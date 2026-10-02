"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Printer, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/patterns/status-badge";
import { usd } from "@/lib/mock/sales";
import { useContainersData } from "@/components/containers/containers-data-context";
import { invoiceTotal, paymentsTotal, derivePaymentStatus, type ContainerJob, type ExportLine, type PaymentType, type PaymentMethod } from "@/lib/mock/containers";
import { InvoicePrint } from "@/components/containers/invoice-print";
import type { User } from "@/lib/types";

const paymentTypes: PaymentType[] = ["Deposit", "Additional Deposit", "Final Payment", "Adjustment"];
const paymentMethods: PaymentMethod[] = ["Wire", "ACH", "Check", "Cash", "Other"];

function newLine(): ExportLine {
  return { id: `ln-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, description: "", quantity: 1, unitPrice: 0, category: "", condition: "" };
}

export function InvoicePanel({ job, user }: { job: ContainerJob; user: User }) {
  const {
    getInvoiceForContainer,
    getPaymentsForInvoice,
    getConsignee,
    consignees,
    runLoadingListDraft,
    createInvoice,
    updateInvoiceMeta,
    setInvoiceItems,
    moveInvoiceToReview,
    finalizeInvoice,
    reviseFinalizedInvoice,
    addPayment,
  } = useContainersData();

  const invoice = getInvoiceForContainer(job.id);
  const payments = invoice ? getPaymentsForInvoice(invoice.id) : [];

  const [editorOpen, setEditorOpen] = useState(false);
  const [items, setItems] = useState<ExportLine[]>(invoice?.items.length ? invoice.items : [newLine()]);
  const [reviseReason, setReviseReason] = useState("");
  const [showPrint, setShowPrint] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: "", type: "Deposit" as PaymentType, method: "Wire" as PaymentMethod, referenceNumber: "", notes: "" });
  const [payError, setPayError] = useState("");
  const [payOverride, setPayOverride] = useState("");

  function openEditor() {
    setItems(invoice?.items.length ? invoice.items.map((it) => ({ ...it })) : [newLine()]);
    setEditorOpen(true);
  }

  function start() {
    if (job.status === "loading") {
      toast.error("Mark loading finished before creating an invoice.");
      return;
    }
    createInvoice(job.id);
    toast.success("Invoice draft created");
    // Open with the same prefill `createInvoice` just seeded from `job.loadingListDraft` —
    // reading it straight off the `job` prop instead of the (still-stale-until-next-render)
    // `invoice` returned by `getInvoiceForContainer` avoids a stale-closure empty editor.
    setItems(job.loadingListDraft.length ? job.loadingListDraft.map((it) => ({ ...it })) : [newLine()]);
    setEditorOpen(true);
  }

  function saveDraft() {
    if (!invoice) return;
    const invalid = items.some((it) => it.quantity <= 0 || it.unitPrice < 0 || !it.description.trim());
    if (invalid) {
      toast.error("Every row needs a description, quantity > 0 and a non-negative unit price.");
      return;
    }
    setInvoiceItems(invoice.id, items);
    toast.success("Draft saved");
  }

  function finalize() {
    if (!invoice) return;
    if (!invoice.consigneeId && !job.consigneeId) {
      toast.error("Assign a consignee to this container before finalizing.");
      return;
    }
    setInvoiceItems(invoice.id, items);
    if (invoice.status === "Draft") moveInvoiceToReview(invoice.id);
    finalizeInvoice(invoice.id, user.name);
    toast.success("Invoice finalized");
    setEditorOpen(false);
  }

  function revise() {
    if (!invoice || !reviseReason.trim()) return;
    reviseFinalizedInvoice(invoice.id, items, reviseReason.trim(), user.name);
    setReviseReason("");
    toast.success("Correction recorded — prior version preserved in history");
  }

  function openPayment() {
    setPayForm({ date: new Date().toISOString().slice(0, 10), amount: "", type: "Deposit", method: "Wire", referenceNumber: "", notes: "" });
    setPayError("");
    setPayOverride("");
    setPayOpen(true);
  }

  function submitPayment() {
    if (!invoice) return;
    const amount = Number(payForm.amount);
    if (!(amount > 0)) {
      setPayError("Enter a payment amount greater than zero.");
      return;
    }
    const proofFilename = `payment-proof-${invoice.invoiceNumber}-${payForm.referenceNumber || payments.length + 1}.jpg`;
    const res = addPayment(invoice.id, { ...payForm, amount, proofFilename }, user.name, payOverride || undefined);
    if (!res.ok) {
      setPayError(res.error || "Could not record payment");
      return;
    }
    toast.success("Payment recorded");
    setPayOpen(false);
  }

  const total = invoice ? invoiceTotal(invoice.items) : 0;
  const paid = invoice ? paymentsTotal(payments) : 0;
  const balance = total - paid;
  const payStatus = invoice ? derivePaymentStatus(total, paid, payments) : "No Payment";
  const draftTotal = invoiceTotal(items);
  const consignee = getConsignee(invoice?.consigneeId ?? job.consigneeId);

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Invoice Summary</h3>
          {invoice && <StatusBadge tone={invoice.status === "Finalized" ? "success" : invoice.status === "Review" ? "warning" : "neutral"}>{invoice.status}</StatusBadge>}
        </div>
        {!invoice ? (
          <>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="flex justify-between">
                <span>Invoice No.</span> <span>— (Not created)</span>
              </p>
              <p className="flex justify-between">
                <span>Invoice Date</span> <span>—</span>
              </p>
              <p className="flex justify-between">
                <span>Total Amount</span> <span>—</span>
              </p>
              <p className="flex justify-between">
                <span>Paid</span> <span>—</span>
              </p>
              <p className="flex justify-between">
                <span>Balance</span> <span>—</span>
              </p>
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={job.status === "loading"} onClick={start}>
                Create Invoice
              </Button>
              {job.status === "loading" && <p className="self-center text-xs text-muted-foreground">Finish loading first.</p>}
            </div>
            {job.status !== "loading" && !job.loadingListDraft.length && (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => runLoadingListDraft(job.id)}>
                <Sparkles className="size-4" /> Draft transcription (demo AI)
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="space-y-1 text-xs">
              <p className="flex justify-between">
                <span className="text-muted-foreground">Invoice No.</span> <b>{invoice.invoiceNumber}</b>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Invoice Date</span> <b>{new Date(invoice.finalizedAt || invoice.createdAt).toLocaleDateString()}</b>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Total Amount</span> <b>{usd(total)}</b>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Paid</span> <b>{usd(paid)}</b>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Balance</span> <b className={balance > 0 ? "text-destructive" : ""}>{usd(balance)}</b>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Payment Status</span> <StatusBadge tone={payStatus === "Paid in Full" ? "success" : payStatus === "No Payment" ? "neutral" : "warning"}>{payStatus}</StatusBadge>
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={openEditor}>
                {invoice.status === "Finalized" ? "View / Correct" : "Edit Invoice"}
              </Button>
              {invoice.status === "Finalized" && (
                <Button size="sm" variant="outline" onClick={() => setShowPrint(true)}>
                  <Printer className="size-4" /> View / Print
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {invoice && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Payment History</h3>
            <Button size="sm" variant="outline" onClick={openPayment}>
              <Plus className="size-4" /> Add Payment
            </Button>
          </div>
          {payments.length ? (
            <div className="space-y-1.5">
              {payments.map((p) => (
                <div key={p.id} className="rounded border border-border px-2.5 py-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">
                      {usd(p.amount)} · {p.type}
                    </span>
                    <span className="text-muted-foreground">{p.date}</span>
                  </div>
                  <div className="text-muted-foreground">
                    {p.method} · Ref {p.referenceNumber || "—"} · Added by {p.enteredBy}
                  </div>
                  {p.correction && <div className="mt-0.5 text-[11px] text-warning-foreground">Corrected from {usd(p.correction.originalAmount)} — {p.correction.reason}</div>}
                </div>
              ))}
            </div>
          ) : (
            <p className="py-3 text-center text-xs text-muted-foreground">No payments yet.</p>
          )}
        </div>
      )}

      {/* Invoice editor */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl sm:!max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Invoice {invoice?.invoiceNumber} · {job.tRef}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Consignee</Label>
                <Select
                  disabled={invoice?.status === "Finalized"}
                  value={invoice?.consigneeId || job.consigneeId || ""}
                  onValueChange={(v) => invoice && updateInvoiceMeta(invoice.id, { consigneeId: v || null })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select consignee">
                      {(value: string | null) => consignees.find((c) => c.id === value)?.company || "Select consignee"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {consignees.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.company}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Input disabled={invoice?.status === "Finalized"} value={invoice?.currency || "USD"} onChange={(e) => invoice && updateInvoiceMeta(invoice.id, { currency: e.target.value })} />
              </div>
            </div>
            {!consignee && <p className="text-xs text-warning-foreground">No consignee assigned yet — required before finalizing.</p>}

            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_70px_90px_90px_28px] gap-1.5 text-xs font-semibold text-muted-foreground">
                <span>Description</span>
                <span>Qty</span>
                <span>Unit Price</span>
                <span>Line Total</span>
                <span />
              </div>
              {items.map((it, i) => (
                <div key={it.id} className="grid grid-cols-[1fr_70px_90px_90px_28px] items-center gap-1.5">
                  <Input
                    disabled={invoice?.status === "Finalized" && !reviseReason}
                    value={it.description}
                    onChange={(e) => setItems(items.map((v, j) => (j === i ? { ...v, description: e.target.value } : v)))}
                    placeholder="Description"
                  />
                  <Input
                    disabled={invoice?.status === "Finalized" && !reviseReason}
                    type="number"
                    min={1}
                    value={it.quantity}
                    onChange={(e) => setItems(items.map((v, j) => (j === i ? { ...v, quantity: Number(e.target.value) } : v)))}
                  />
                  <Input
                    disabled={invoice?.status === "Finalized" && !reviseReason}
                    type="number"
                    min={0}
                    step="0.01"
                    value={it.unitPrice}
                    onChange={(e) => setItems(items.map((v, j) => (j === i ? { ...v, unitPrice: Number(e.target.value) } : v)))}
                  />
                  <span className="text-sm font-medium">{usd(it.quantity * it.unitPrice)}</span>
                  {(invoice?.status !== "Finalized" || reviseReason) && (
                    <button onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {(invoice?.status !== "Finalized" || reviseReason) && (
                <Button size="sm" variant="outline" onClick={() => setItems([...items, newLine()])}>
                  <Plus className="size-4" /> Add Row
                </Button>
              )}
            </div>

            <div className="flex justify-end text-base font-semibold">Invoice Total: {usd(draftTotal)}</div>

            {invoice?.status === "Finalized" && (
              <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
                <Label className="text-xs">Correction reason (required to edit a finalized invoice)</Label>
                <Textarea rows={2} value={reviseReason} onChange={(e) => setReviseReason(e.target.value)} placeholder="Explain the correction — a revision is kept, nothing is silently overwritten." />
                {invoice.revisions.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium">Revision history ({invoice.revisions.length})</summary>
                    <div className="mt-1 space-y-1">
                      {invoice.revisions.map((r) => (
                        <p key={r.id}>
                          {new Date(r.savedAt).toLocaleString()} · {r.savedBy} · {r.reason}
                        </p>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Close
            </Button>
            {invoice?.status !== "Finalized" && (
              <>
                <Button variant="outline" onClick={saveDraft}>
                  Save Draft
                </Button>
                <Button disabled={!items.length || items.some((it) => !it.description.trim())} onClick={finalize}>
                  Finalize Invoice
                </Button>
              </>
            )}
            {invoice?.status === "Finalized" && (
              <Button disabled={!reviseReason.trim()} onClick={revise}>
                Save Correction
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Payment */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" min={0} step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={payForm.type} onValueChange={(v) => setPayForm({ ...payForm, type: (v as PaymentType) || "Deposit" })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={payForm.method} onValueChange={(v) => setPayForm({ ...payForm, method: (v as PaymentMethod) || "Wire" })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentMethods.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reference #</Label>
              <Input value={payForm.referenceNumber} onChange={(e) => setPayForm({ ...payForm, referenceNumber: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} />
            </div>
            {payError && (
              <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                <p>{payError}</p>
                <Input placeholder="Authorized override reason" value={payOverride} onChange={(e) => setPayOverride(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitPayment}>{payError ? "Record with override" : "Record payment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {invoice && showPrint && <InvoicePrint invoice={invoice} job={job} consignee={consignee} payments={payments} onClose={() => setShowPrint(false)} />}
    </>
  );
}
