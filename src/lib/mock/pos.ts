import type { SaleItem } from "@/lib/mock/sales";

/**
 * Display-only totals for the POS preview and print. The database computes the saved sale's totals;
 * this mirrors the same formula (tax = taxable × rate ÷ 100, rate as a percent) so the preview matches.
 */
export function computePosTotals(input: {
  items: SaleItem[];
  discount: number;
  coreCharge: number;
  taxRate: number;
  depositApplied: number;
  amountPaid: number;
}) {
  const subtotal = input.items.reduce((s, i) => s + i.quantity * i.unitPrice - (i.discount || 0), 0);
  const taxable = Math.max(0, subtotal - input.discount);
  const tax = taxable * (input.taxRate / 100);
  const grandTotal = subtotal - input.discount + input.coreCharge + tax;
  const balanceDue = Math.max(0, grandTotal - input.depositApplied - input.amountPaid);
  return { subtotal, tax, grandTotal, balanceDue };
}
