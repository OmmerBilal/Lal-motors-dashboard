import { usd } from "@/lib/mock/sales";
import type { ContainerJob, ExportInvoice, ExportLine } from "@/lib/mock/containers";

export function InvoicePrint({
  invoice,
  job,
  items,
  preview = false,
}: {
  invoice: ExportInvoice;
  job: ContainerJob;
  items: ExportLine[];
  preview?: boolean;
}) {
  const groups = new Map<string, ExportLine[]>();
  for (const item of items) {
    const category = (item.category || "Cargo items").trim() || "Cargo items";
    groups.set(category, [...(groups.get(category) || []), item]);
  }
  const date = invoice.finalizedAt || invoice.createdAt;
  const total = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);

  return (
    <article
      aria-label="Printable export commercial invoice"
      className={`mx-auto mt-6 max-w-3xl space-y-6 rounded-lg border border-border bg-white p-8 text-sm text-black ${preview ? "" : "hidden print:block"}`}
    >
      <div className="flex items-center justify-between border-b border-black/20 pb-3">
        <strong>LAL MOTORS INC.</strong>
        <span className="text-xs font-semibold tracking-widest">EXPORT INVOICE</span>
      </div>
      <div>
        <h1 className="text-xl font-bold">EXPORT COMMERCIAL INVOICE</h1>
        <p className="text-xs text-neutral-600">CONTAINER {job.containerNumber}</p>
      </div>
      <div className="grid grid-cols-3 gap-4 text-xs">
        <div>
          <b className="block">INVOICE NUMBER</b>
          <span>{invoice.invoiceNumber}</span>
        </div>
        <div>
          <b className="block">INVOICE DATE</b>
          <span>{date ? new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"}</span>
        </div>
        <div>
          <b className="block">CONTAINER / REFERENCE</b>
          <span>{job.containerNumber}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <b className="block">EXPORTER / SELLER</b>
          <p>LAL Motors Inc.</p>
        </div>
        <div>
          <b className="block">CONSIGNEE / BUYER</b>
          <p>{invoice.consignee || "To be confirmed"}</p>
        </div>
      </div>
      {[...groups].map(([category, lines]) => (
        <section key={category}>
          <h2 className="mb-1.5 text-xs font-bold tracking-wide">{category.toUpperCase()}</h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-black/30 text-left">
                <th className="py-1">#</th>
                <th className="py-1">DESCRIPTION</th>
                <th className="py-1">QTY</th>
                <th className="py-1">CONDITION / NOTES</th>
                <th className="py-1">UNIT USD</th>
                <th className="py-1">AMOUNT USD</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index} className="border-b border-black/10">
                  <td className="py-1">{index + 1}</td>
                  <td className="py-1">{line.description}</td>
                  <td className="py-1">{line.quantity}</td>
                  <td className="py-1">{line.condition || ""}</td>
                  <td className="py-1">{usd(line.unitPrice)}</td>
                  <td className="py-1">{usd(Number(line.quantity) * Number(line.unitPrice))}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1" colSpan={2}>
                  {category.toUpperCase()} SUBTOTAL
                </td>
                <td className="py-1">{lines.reduce((n, l) => n + Number(l.quantity), 0)}</td>
                <td colSpan={2}></td>
                <td className="py-1">{usd(lines.reduce((n, l) => n + Number(l.quantity) * Number(l.unitPrice), 0))}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ))}
      <div className="ml-auto max-w-xs space-y-1 text-sm">
        {[...groups].map(([category, lines]) => (
          <p key={category} className="flex justify-between">
            <span>{category}</span>
            <b>{usd(lines.reduce((n, l) => n + Number(l.quantity) * Number(l.unitPrice), 0))}</b>
          </p>
        ))}
        <p className="flex justify-between border-t border-black/30 pt-1 text-base">
          <strong>TOTAL INVOICE VALUE (USD)</strong>
          <strong>{usd(total)}</strong>
        </p>
      </div>
      <section className="border-t border-black/20 pt-3 text-xs">
        <h2 className="mb-1 font-bold">SHIPPING &amp; APPROVAL</h2>
        <p>
          Destination port: <strong>{job.destinationPort || "____________________"}</strong> &nbsp; Country:{" "}
          <strong>{job.destinationCountry || "____________________"}</strong> &nbsp; Currency: <strong>{invoice.currency || "USD"}</strong>
        </p>
        <p>Freight / payment terms: ____________________ &nbsp; Country of origin: ____________________</p>
        <p>Prepared by: ____________________ &nbsp; Approved by: ____________________ &nbsp; Date: ____________________</p>
        {invoice.notes && <p>Notes: {invoice.notes}</p>}
      </section>
      <footer className="flex justify-between border-t border-black/20 pt-2 text-xs text-neutral-500">
        <span>LAL MOTORS | EXPORT INVOICE</span>
        <span>Invoice {invoice.invoiceNumber}</span>
      </footer>
    </article>
  );
}
