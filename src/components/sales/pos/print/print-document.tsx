import { usd, type Customer, type PaymentMethod, type SaleItem } from "@/lib/mock/sales";
import { computePosTotals } from "@/lib/mock/pos";

export type PrintSaleData = {
  saleNumber: string;
  invoiceNumber: string;
  date: string;
  employeeName: string;
  customer: Customer | null;
  items: SaleItem[];
  discount: number;
  coreCharge: number;
  depositApplied: number;
  taxRate: number;
  notes: string;
  method: PaymentMethod;
  amountPaid: number;
  businessName: string;
  taxLabel: string;
};

const methodLabels: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  CHECK: "Check",
  BANK_TRANSFER: "Bank Transfer",
  QR_CODE: "QR Code",
  PAYMENT_LINK: "Payment Link",
  OTHER: "Other",
};

export function ReceiptPrint({ data }: { data: PrintSaleData }) {
  const totals = computePosTotals({
    items: data.items,
    discount: data.discount,
    coreCharge: data.coreCharge,
    taxRate: data.taxRate,
    depositApplied: data.depositApplied,
    amountPaid: data.amountPaid,
  });
  const customerName = data.customer ? data.customer.companyName || `${data.customer.firstName} ${data.customer.lastName}`.trim() : "";

  return (
    <div className="print-area">
      <div className="mx-auto max-w-[300px] p-4 font-mono text-[11px] leading-snug text-black">
        <div className="text-center">
          <b className="text-sm">{data.businessName}</b>
          <p>Used Auto Parts</p>
        </div>
        <hr className="my-2 border-dashed border-black" />
        <p>Receipt #: {data.saleNumber}</p>
        <p>Invoice #: {data.invoiceNumber}</p>
        <p>Date: {new Date(data.date).toLocaleString()}</p>
        <p>Employee: {data.employeeName}</p>
        {customerName && <p>Customer: {customerName}</p>}
        <hr className="my-2 border-dashed border-black" />
        {data.items.map((item) => (
          <div key={item.id} className="mb-1 flex justify-between gap-2">
            <span className="min-w-0">
              {item.description}
              <br />
              {item.quantity} x {usd(item.unitPrice)}
            </span>
            <span className="shrink-0">{usd(item.quantity * item.unitPrice - (item.discount || 0))}</span>
          </div>
        ))}
        <hr className="my-2 border-dashed border-black" />
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{usd(totals.subtotal)}</span>
        </div>
        {data.discount > 0 && (
          <div className="flex justify-between">
            <span>Discount</span>
            <span>-{usd(data.discount)}</span>
          </div>
        )}
        {data.coreCharge > 0 && (
          <div className="flex justify-between">
            <span>Core Charge</span>
            <span>{usd(data.coreCharge)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Tax ({data.taxRate}%)</span>
          <span>{usd(totals.tax)}</span>
        </div>
        {data.depositApplied > 0 && (
          <div className="flex justify-between">
            <span>Deposit</span>
            <span>-{usd(data.depositApplied)}</span>
          </div>
        )}
        <hr className="my-2 border-dashed border-black" />
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span>{usd(totals.grandTotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>Paid ({methodLabels[data.method]})</span>
          <span>{usd(data.amountPaid)}</span>
        </div>
        <div className="flex justify-between font-bold">
          <span>Balance Due</span>
          <span>{usd(totals.balanceDue)}</span>
        </div>
        <hr className="my-2 border-dashed border-black" />
        <p className="text-center text-[10px]">
          Returns accepted within 30 days with receipt. Electrical parts are final sale. Core charges refunded upon
          return of old part.
        </p>
        <p className="mt-2 text-center text-[10px]">Thank you for your business!</p>
      </div>
    </div>
  );
}

export function InvoicePrint({ data }: { data: PrintSaleData }) {
  const totals = computePosTotals({
    items: data.items,
    discount: data.discount,
    coreCharge: data.coreCharge,
    taxRate: data.taxRate,
    depositApplied: data.depositApplied,
    amountPaid: data.amountPaid,
  });

  return (
    <div className="print-area">
      <div className="mx-auto max-w-[800px] p-8 text-black">
        <div className="flex items-start justify-between border-b-2 border-black pb-4">
          <div>
            <h1 className="text-2xl font-bold">{data.businessName}</h1>
            <p className="text-sm">Used Auto Parts · Buy · Sell · Export</p>
          </div>
          <div className="text-right text-sm">
            <p className="text-lg font-bold">INVOICE</p>
            <p>Invoice #: {data.invoiceNumber}</p>
            <p>Sale #: {data.saleNumber}</p>
            <p>{new Date(data.date).toLocaleString()}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="font-semibold text-muted-foreground">Sold By</p>
            <p>{data.employeeName}</p>
          </div>
          <div>
            <p className="font-semibold text-muted-foreground">Customer</p>
            {data.customer ? (
              <>
                <p>{data.customer.companyName || `${data.customer.firstName} ${data.customer.lastName}`}</p>
                {data.customer.phone && <p>{data.customer.phone}</p>}
                {data.customer.billingAddress && <p>{data.customer.billingAddress}</p>}
              </>
            ) : (
              <p>Walk-in customer</p>
            )}
          </div>
        </div>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-1.5">Description</th>
              <th className="py-1.5">Part / Stock #</th>
              <th className="py-1.5 text-right">Qty</th>
              <th className="py-1.5 text-right">Unit Price</th>
              <th className="py-1.5 text-right">Discount</th>
              <th className="py-1.5 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id} className="border-b border-black/20">
                <td className="py-1.5">
                  {item.description}
                  {item.manual && <span className="ml-1 text-xs">(manual item)</span>}
                </td>
                <td className="py-1.5">{item.stockSku || "—"}</td>
                <td className="py-1.5 text-right">{item.quantity}</td>
                <td className="py-1.5 text-right">{usd(item.unitPrice)}</td>
                <td className="py-1.5 text-right">{item.discount ? usd(item.discount) : "—"}</td>
                <td className="py-1.5 text-right">{usd(item.quantity * item.unitPrice - (item.discount || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{usd(totals.subtotal)}</span>
            </div>
            {data.discount > 0 && (
              <div className="flex justify-between">
                <span>Discount</span>
                <span>-{usd(data.discount)}</span>
              </div>
            )}
            {data.coreCharge > 0 && (
              <div className="flex justify-between">
                <span>Core Charge</span>
                <span>{usd(data.coreCharge)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Tax ({data.taxLabel || `${data.taxRate}%`})</span>
              <span>{usd(totals.tax)}</span>
            </div>
            {data.depositApplied > 0 && (
              <div className="flex justify-between">
                <span>Deposit / previous payment</span>
                <span>-{usd(data.depositApplied)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-black pt-1 text-base font-bold">
              <span>Grand Total</span>
              <span>{usd(totals.grandTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Paid ({methodLabels[data.method]})</span>
              <span>{usd(data.amountPaid)}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>Balance Due</span>
              <span>{usd(totals.balanceDue)}</span>
            </div>
            <div className="mt-1 text-right text-xs font-semibold uppercase">
              {totals.balanceDue <= 0 ? "Paid in Full" : data.amountPaid > 0 ? "Partial Payment" : "Unpaid"}
            </div>
          </div>
        </div>

        {data.notes && (
          <div className="mt-6 border-t border-black/20 pt-3 text-sm">
            <p className="font-semibold">Notes</p>
            <p>{data.notes}</p>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Returns accepted within 30 days with receipt. Electrical parts are final sale. Core charges refunded upon
          return of the old part. Thank you for your business!
        </p>
      </div>
    </div>
  );
}
