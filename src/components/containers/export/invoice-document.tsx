"use client";

import { usd } from "@/components/scrap/scrap-shared";
import type { ExportInvoice } from "@/lib/data/containers";

/**
 * The invoice as a document. It is always present on the screen (hidden by the .print-area rule) and
 * is the only visible content when printing. The consignee shown is the snapshot on the invoice, not the
 * current consignee master.
 */
export function InvoiceDocument({ invoice, className = "" }: { invoice: ExportInvoice; className?: string }) {
  const c = invoice.consignee;
  return (
    <div className={`${className} rounded-lg bg-white p-6 text-black`} aria-label="Invoice document">
      <div className="flex justify-between gap-6 border-b border-neutral-300 pb-4">
        <div>
          <p className="text-lg font-bold">LAL Motors</p>
          <p className="text-xs">Container {invoice.t_ref}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">{invoice.invoice_number ?? "DRAFT"}</p>
          <p className="text-xs">{invoice.finalized_at ? `Finalized ${new Date(invoice.finalized_at).toLocaleDateString()}` : "Not finalized"}</p>
          {invoice.revision_count > 0 && <p className="text-xs">Revision {invoice.revision_count}</p>}
        </div>
      </div>
      <div className="mt-4 text-sm">
        <p className="font-semibold">Consignee</p>
        {c ? (
          <p>
            {c.company}
            <br />
            {[c.contact, c.address, [c.city, c.state_province, c.country].filter(Boolean).join(", "), c.phone, c.email].filter(Boolean).join(" · ")}
          </p>
        ) : (
          <p>—</p>
        )}
      </div>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-400 text-left">
            <th className="py-1">Description</th><th>Qty</th><th className="text-right">Unit</th><th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((i, n) => (
            <tr key={n} className="border-b border-neutral-200">
              <td className="py-1">{i.description}</td>
              <td>{i.quantity}</td>
              <td className="text-right tabular-nums">{usd(i.unit_price)}</td>
              <td className="text-right tabular-nums">{usd(i.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 ml-auto w-64 text-sm">
        <div className="flex justify-between"><span>Total</span><span className="tabular-nums">{usd(invoice.total)}</span></div>
        <div className="flex justify-between"><span>Paid</span><span className="tabular-nums">{usd(invoice.paid)}</span></div>
        <div className="flex justify-between font-bold"><span>Balance</span><span className="tabular-nums">{usd(invoice.balance)}</span></div>
      </div>
      {invoice.notes && <p className="mt-4 text-xs">{invoice.notes}</p>}
    </div>
  );
}
