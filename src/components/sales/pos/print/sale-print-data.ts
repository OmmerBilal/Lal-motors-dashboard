import { emptyCustomer, type Customer } from "@/lib/mock/sales";
import { linesToItems, type SaleDetail, type SalesSettings } from "@/lib/data/sales";
import type { PrintSaleData } from "@/components/sales/pos/print/print-document";

/** A saved sale from the read model, shaped for the print documents. Totals are re-derived by the print formula. */
export function saleDetailToPrintData(d: SaleDetail, employeeName: string, settings: SalesSettings | null): PrintSaleData {
  const customer: Customer | null = d.customer
    ? {
        ...emptyCustomer,
        id: d.customer.id,
        customerNumber: d.customer.customer_number,
        firstName: d.customer.name,
        lastName: "",
        phone: d.customer.phone ?? "",
        email: d.customer.email ?? "",
        taxStatus: d.customer.tax_status as Customer["taxStatus"],
        documents: [],
        createdAt: "",
      }
    : null;
  return {
    saleNumber: d.sale.sale_number ?? "—",
    invoiceNumber: d.sale.sale_number ?? "—",
    date: d.sale.created_at,
    employeeName,
    customer,
    items: linesToItems(d.lines),
    discount: Number(d.sale.discount),
    coreCharge: 0,
    depositApplied: 0,
    taxRate: Number(d.sale.tax_rate),
    notes: d.sale.notes ?? "",
    amountPaid: Number(d.sale.amount_paid),
    businessName: settings?.businessName ?? "",
    taxLabel: settings?.taxLabel ?? "",
  };
}
