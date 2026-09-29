import { parts, type PartRecord } from "@/lib/mock/parts";
import { vehicles, vehicleTitle, type VehicleRecord } from "@/lib/mock/vehicles";
import type { Payment, SaleItem } from "@/lib/mock/sales";

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

export type ReturnReason = "defective" | "wrong_part" | "changed_mind" | "warranty" | "other";
export type ReturnDisposition = "restock" | "damaged" | "hold";

export const returnReasonLabels: Record<ReturnReason, string> = {
  defective: "Defective part",
  wrong_part: "Wrong part ordered",
  changed_mind: "Customer changed mind",
  warranty: "Warranty claim",
  other: "Other",
};

export const returnDispositionLabels: Record<ReturnDisposition, string> = {
  restock: "Restock",
  damaged: "Damaged",
  hold: "Hold for inspection",
};

export type ReturnRecord = {
  id: string;
  returnNumber: string;
  saleId: string;
  saleNumber: string;
  itemDescription: string;
  reason: ReturnReason;
  disposition: ReturnDisposition;
  refundMethod: Payment["method"];
  refundAmount: number;
  status: "pending" | "processed";
  createdAt: string;
};

export const returns: ReturnRecord[] = [];

/** Approved parts enriched with their donor vehicle, joined read-only by VIN. Neither source module is modified. */
export function findDonorVehicle(part: PartRecord): VehicleRecord | undefined {
  const vin = part.draft.sourceVin;
  if (!vin) return undefined;
  return vehicles.find((v) => v.vin === vin);
}

export type PartSearchResult = {
  part: PartRecord;
  donor: VehicleRecord | undefined;
  donorLabel: string;
};

export function approvedPartResults(): PartSearchResult[] {
  return parts
    .filter((p) => p.status === "approved")
    .map((p) => {
      const donor = findDonorVehicle(p);
      return { part: p, donor, donorLabel: donor ? vehicleTitle(donor) : "Donor vehicle not linked" };
    });
}

export type PartFilters = { year: string; make: string; model: string; category: string; q: string };

export const emptyPartFilters: PartFilters = { year: "", make: "", model: "", category: "", q: "" };

export function filterPartResults(results: PartSearchResult[], filters: PartFilters): PartSearchResult[] {
  return results.filter(({ part, donor, donorLabel }) => {
    if (filters.year && donor?.year !== filters.year) return false;
    if (filters.make && donor?.make.toLowerCase() !== filters.make.toLowerCase()) return false;
    if (filters.model && donor?.model.toLowerCase() !== filters.model.toLowerCase()) return false;
    if (filters.category && part.draft.category?.toLowerCase() !== filters.category.toLowerCase()) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      const haystack = [part.stockSku, part.draft.partName, part.draft.title, part.draft.partNumber, part.draft.sourceVin, part.draft.sourceLot, donorLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function partFilterOptions(results: PartSearchResult[]) {
  const years = new Set<string>();
  const makes = new Set<string>();
  const models = new Set<string>();
  const categories = new Set<string>();
  for (const { part, donor } of results) {
    if (donor?.year) years.add(donor.year);
    if (donor?.make) makes.add(donor.make);
    if (donor?.model) models.add(donor.model);
    if (part.draft.category) categories.add(part.draft.category);
  }
  return {
    years: [...years].sort(),
    makes: [...makes].sort(),
    models: [...models].sort(),
    categories: [...categories].sort(),
  };
}

/** Mock "AI" extraction from a scanned customer ID / document. No real OCR — a plausible canned draft for review. */
export function mockExtractCustomerDocument(fileName: string) {
  return {
    firstName: "Jordan",
    lastName: "Reyes",
    phone: "(904) 555-4471",
    email: "",
    billingAddress: "2200 Blanding Blvd, Jacksonville, FL",
    sourceFile: fileName,
    confidence: "Fields below are a preview only — review and correct before saving.",
  };
}

/** Mock "AI photo search" — returns a small canned subset of approved parts, standing in for a real vision search. */
export function mockAiPartSearch(): PartSearchResult[] {
  return approvedPartResults().slice(0, 2);
}
