"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/mock/sales";
import { invoiceTotal, paymentsTotal, derivePaymentStatus, type Consignee, type ContainerJob, type ExportInvoice, type ExportPayment } from "@/lib/mock/containers";

/** Real printable commercial-invoice document — not a screenshot of app UI. Wrapped in
 * `.print-area` (see globals.css `@media print`), the same isolation pattern used by
 * `components/sales/pos/print/print-document.tsx`, so printing shows ONLY this document —
 * no sidebar, header or app chrome. Handles long invoices by letting the rows table paginate
 * naturally (`page-break-inside: avoid` per row from the shared print CSS) while the totals
 * block stays with the last rows via `break-inside: avoid`. */
export function InvoicePrint({
  invoice,
  job,
  consignee,
  payments,
  onClose,
}: {
  invoice: ExportInvoice;
  job: ContainerJob;
  consignee: Consignee | undefined;
  payments: ExportPayment[];
  onClose: () => void;
}) {
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    function afterPrint() {
      onClose();
    }
    window.addEventListener("afterprint", afterPrint);
    return () => window.removeEventListener("afterprint", afterPrint);
  }, [onClose]);

  const total = invoiceTotal(invoice.items);
  const paid = paymentsTotal(payments);
  const balance = total - paid;
  const status = derivePaymentStatus(total, paid, payments);
  const buyer = invoice.consigneeSnapshot || consignee;
  const date = invoice.finalizedAt || invoice.createdAt;

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-6 print:hidden">
        <div className="w-full max-w-3xl rounded-lg bg-white p-4 text-black shadow-xl">
          <div className="mb-3 flex justify-end gap-2">
            <Button size="sm" onClick={() => window.print()}>
              Print
            </Button>
            <Button size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
          <InvoiceDocument invoice={invoice} job={job} buyer={buyer} total={total} paid={paid} balance={balance} status={status} date={date} />
        </div>
      </div>
      <div className="print-area hidden print:block">
        <InvoiceDocument invoice={invoice} job={job} buyer={buyer} total={total} paid={paid} balance={balance} status={status} date={date} />
      </div>
    </>
  );
}

function InvoiceDocument({
  invoice,
  job,
  buyer,
  total,
  paid,
  balance,
  status,
  date,
}: {
  invoice: ExportInvoice;
  job: ContainerJob;
  buyer: Consignee | undefined;
  total: number;
  paid: number;
  balance: number;
  status: string;
  date: string;
}) {
  return (
    <article aria-label="Commercial invoice" className="mx-auto max-w-[800px] p-6 text-sm text-black">
      <div className="flex items-start justify-between border-b-2 border-black pb-4">
        <div>
          <h1 className="text-2xl font-bold">LAL MOTORS INC.</h1>
          <p className="text-sm">Used Auto Parts Export · Global Parts. Reliable Supply.</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">COMMERCIAL INVOICE</p>
          <p className="text-xs">{invoice.status.toUpperCase()}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3 text-xs">
        <div>
          <b className="block text-neutral-500">INVOICE #</b>
          {invoice.invoiceNumber}
        </div>
        <div>
          <b className="block text-neutral-500">INVOICE DATE</b>
          {date ? new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"}
        </div>
        <div>
          <b className="block text-neutral-500">T REFERENCE</b>
          {job.tRef}
        </div>
        <div>
          <b className="block text-neutral-500">CONTAINER #</b>
          {job.containerNumber}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-6 text-xs">
        <div>
          <b className="block text-neutral-500">SELLER / EXPORTER</b>
          <p className="mt-0.5">LAL Motors Inc.</p>
          <p>Jacksonville, FL, USA</p>
        </div>
        <div>
          <b className="block text-neutral-500">CONSIGNEE / BUYER</b>
          {buyer ? (
            <>
              <p className="mt-0.5">{buyer.company}</p>
              {buyer.contact && <p>{buyer.contact}</p>}
              {buyer.address && <p>{buyer.address}</p>}
              <p>
                {[buyer.city, buyer.stateProvince, buyer.country].filter(Boolean).join(", ")}
              </p>
              {buyer.phone && <p>{buyer.phone}</p>}
            </>
          ) : (
            <p className="mt-0.5">To be confirmed</p>
          )}
        </div>
      </div>

      <table className="mt-6 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1.5">#</th>
            <th className="py-1.5">DESCRIPTION</th>
            <th className="py-1.5 text-right">QTY</th>
            <th className="py-1.5 text-right">UNIT PRICE</th>
            <th className="py-1.5 text-right">LINE TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((it, i) => (
            <tr key={it.id} className="border-b border-black/15" style={{ breakInside: "avoid" }}>
              <td className="py-1">{i + 1}</td>
              <td className="py-1">
                {it.description}
                {it.condition && <span className="text-neutral-500"> — {it.condition}</span>}
              </td>
              <td className="py-1 text-right">{it.quantity}</td>
              <td className="py-1 text-right">{usd(it.unitPrice)}</td>
              <td className="py-1 text-right">{usd(it.quantity * it.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end" style={{ breakInside: "avoid" }}>
        <div className="w-72 space-y-1 text-sm">
          <div className="flex justify-between border-t border-black pt-1 text-base font-bold">
            <span>Invoice Total ({invoice.currency})</span>
            <span>{usd(total)}</span>
          </div>
          <div className="flex justify-between">
            <span>Payments Received</span>
            <span>{usd(paid)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>Balance Due</span>
            <span>{usd(balance)}</span>
          </div>
          <div className="mt-1 text-right text-xs font-semibold uppercase">{status}</div>
        </div>
      </div>

      {invoice.notes && (
        <div className="mt-6 border-t border-black/20 pt-3 text-xs" style={{ breakInside: "avoid" }}>
          <b>Notes</b>
          <p>{invoice.notes}</p>
        </div>
      )}

      <footer className="mt-8 flex justify-between border-t border-black/20 pt-2 text-xs text-neutral-500" style={{ breakInside: "avoid" }}>
        <span>LAL MOTORS INC. · COMMERCIAL INVOICE</span>
        <span>
          {invoice.invoiceNumber} · {job.tRef}
        </span>
      </footer>
    </article>
  );
}
