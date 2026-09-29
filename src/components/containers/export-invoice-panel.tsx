"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usd } from "@/lib/mock/sales";
import type { ContainerJob } from "@/lib/mock/containers";
import { useContainersData } from "@/components/containers/containers-data-context";
import { InvoicePrint } from "@/components/containers/invoice-print";

export function ExportInvoicePanel({ job }: { job: ContainerJob }) {
  const { getInvoice, createInvoice, runAiDraft, updateInvoice, setInvoiceItems, saveInvoice } = useContainersData();
  const invoice = getInvoice(job.id);
  const [showPreview, setShowPreview] = useState(false);

  if (!invoice) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Export invoice · {job.containerNumber}</h3>
        <Button onClick={() => createInvoice(job.id)}>Create invoice draft</Button>
      </div>
    );
  }

  const total = invoice.items.reduce((n, it) => n + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
  const hasLoadingList = job.files.some((f) => f.kind === "loading_list");
  const readOnly = invoice.status === "Final";

  function ai() {
    runAiDraft(job.id);
    toast.success("AI draft ready for review");
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Export invoice · {job.containerNumber}</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        {invoice.invoiceNumber} · {invoice.status}
      </p>

      {invoice.status === "Draft" && (
        <div className="mb-3">
          <Button variant="outline" size="sm" disabled={!hasLoadingList} onClick={ai}>
            Process this loading list for container {job.containerNumber}
          </Button>
          {invoice.needsReview.length > 0 && (
            <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
              <b className="block">Needs manager review</b>
              {invoice.needsReview.map((r, i) => (
                <p key={i}>{r}</p>
              ))}
              <p className="mt-1 text-muted-foreground">Verify all prices and quantities before finalizing.</p>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {(["consignee", "destination", "currency", "notes"] as const).map((k) => (
          <div key={k} className="space-y-1.5">
            <Label className="capitalize">{k}</Label>
            <Input disabled={readOnly} value={invoice[k] || ""} onChange={(e) => updateInvoice(invoice.id, { [k]: e.target.value })} />
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {invoice.items.map((it, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-border p-2.5 sm:grid-cols-6">
            <Input
              aria-label="Description"
              disabled={readOnly}
              placeholder="Description"
              className="sm:col-span-2"
              value={it.description}
              onChange={(e) => setInvoiceItems(invoice.id, invoice.items.map((v, j) => (j === i ? { ...v, description: e.target.value } : v)))}
            />
            <Input
              aria-label="Category"
              disabled={readOnly}
              placeholder="Category"
              value={it.category || ""}
              onChange={(e) => setInvoiceItems(invoice.id, invoice.items.map((v, j) => (j === i ? { ...v, category: e.target.value } : v)))}
            />
            <Input
              aria-label="Condition / notes"
              disabled={readOnly}
              placeholder="Condition"
              value={it.condition || ""}
              onChange={(e) => setInvoiceItems(invoice.id, invoice.items.map((v, j) => (j === i ? { ...v, condition: e.target.value } : v)))}
            />
            <Input
              aria-label="Quantity"
              type="number"
              min={1}
              disabled={readOnly}
              value={it.quantity}
              onChange={(e) => setInvoiceItems(invoice.id, invoice.items.map((v, j) => (j === i ? { ...v, quantity: Number(e.target.value) } : v)))}
            />
            <div className="flex items-center gap-2">
              <Input
                aria-label="Unit price"
                type="number"
                min={0}
                step="0.01"
                disabled={readOnly}
                value={it.unitPrice}
                onChange={(e) => setInvoiceItems(invoice.id, invoice.items.map((v, j) => (j === i ? { ...v, unitPrice: Number(e.target.value) } : v)))}
              />
              {!readOnly && (
                <button onClick={() => setInvoiceItems(invoice.id, invoice.items.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {!readOnly && (
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setInvoiceItems(invoice.id, [...invoice.items, { description: "", quantity: 1, unitPrice: 0 }])}>
          + Invoice line
        </Button>
      )}

      <p className="mt-3 text-base font-semibold">
        Total: {usd(total)} {invoice.currency}
      </p>

      {invoice.status === "Draft" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => saveInvoice(invoice.id, false)}>
            Save draft
          </Button>
          <Button disabled={!invoice.items.length || invoice.items.some((it) => !it.description.trim())} onClick={() => saveInvoice(invoice.id, true)}>
            Finalize invoice
          </Button>
        </div>
      )}
      {invoice.status === "Final" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "Hide preview" : "Preview invoice"}
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            Print / Save PDF
          </Button>
          <a
            className="inline-flex items-center text-sm font-medium text-primary hover:underline"
            href={`mailto:?subject=${encodeURIComponent("LAL Motors export invoice " + invoice.invoiceNumber)}&body=${encodeURIComponent(
              "Please see export invoice " + invoice.invoiceNumber + " for container " + job.containerNumber + ". Attach the downloaded PDF before sending."
            )}`}
          >
            Prepare email
          </a>
        </div>
      )}

      {invoice.status === "Final" && showPreview && <InvoicePrint invoice={invoice} job={job} items={invoice.items} preview />}
      {invoice.status === "Final" && <InvoicePrint invoice={invoice} job={job} items={invoice.items} />}
    </div>
  );
}
