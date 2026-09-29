export const usd = (n: unknown) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);

export type CustomerType = "retail" | "wholesale" | "business";
export type TaxStatus = "taxable" | "exempt";

export type CustomerDocument = { id: string; filename: string; type: string };

export type Customer = {
  id: string;
  customerNumber: string;
  firstName: string;
  lastName: string;
  companyName: string;
  phone: string;
  secondaryPhone: string;
  email: string;
  billingAddress: string;
  shippingAddress: string;
  notes: string;
  customerType: CustomerType;
  taxStatus: TaxStatus;
  taxId: string;
  resaleCertificateNumber: string;
  exemptionExpiresAt: string;
  documents: CustomerDocument[];
  createdAt: string;
};

export const emptyCustomer: Omit<Customer, "id" | "customerNumber" | "documents" | "createdAt"> = {
  firstName: "",
  lastName: "",
  companyName: "",
  phone: "",
  secondaryPhone: "",
  email: "",
  billingAddress: "",
  shippingAddress: "",
  notes: "",
  customerType: "retail",
  taxStatus: "taxable",
  taxId: "",
  resaleCertificateNumber: "",
  exemptionExpiresAt: "",
};

export const customerFieldOrder: [keyof typeof emptyCustomer, string][] = [
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["companyName", "Company"],
  ["phone", "Phone"],
  ["secondaryPhone", "Secondary phone"],
  ["email", "Email"],
  ["billingAddress", "Billing address"],
  ["shippingAddress", "Shipping address"],
  ["taxId", "Tax ID / EIN"],
  ["resaleCertificateNumber", "Resale certificate #"],
];

export type SaleItem = {
  id: string;
  manual: boolean;
  partId?: string;
  stockSku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  availableQuantity?: number;
};

export type QuoteStatus = "DRAFT" | "SENT" | "APPROVED" | "CONVERTED";

export type Quote = {
  id: string;
  quoteNumber: string;
  customerId: string;
  status: QuoteStatus;
  items: SaleItem[];
  discount: number;
  notes: string;
  taxRate: number;
  createdAt: string;
};

export type PaymentMethod = "CASH" | "CARD" | "CHECK" | "OTHER";

export type Payment = {
  id: string;
  paymentNumber: string;
  saleId: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  notes: string;
  createdAt: string;
};

export type SaleRecord = {
  id: string;
  saleNumber: string;
  invoiceNumber: string;
  customerId: string;
  items: SaleItem[];
  discount: number;
  taxRate: number;
  createdAt: string;
};

export function itemTotals(items: SaleItem[], discount: number, taxRate: number) {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice - (i.discount || 0), 0);
  const tax = subtotal * (taxRate / 100);
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

export function saleBalance(sale: SaleRecord, payments: Payment[]) {
  const { total } = itemTotals(sale.items, sale.discount, sale.taxRate);
  const paid = payments.filter((p) => p.saleId === sale.id).reduce((s, p) => s + p.amount, 0);
  const balanceDue = Math.max(0, total - paid);
  const paymentStatus = balanceDue <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID";
  return { total, paid, balanceDue, paymentStatus };
}

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

export const salesSettings = {
  taxRate: 7.5,
  taxLabel: "Florida 6.0% + Duval 1.5%",
  businessName: "LAL Motors",
  businessAddress: "9700 Pritchard Rd, Jacksonville, FL",
  businessPhone: "(904) 555-0100",
};

export const customers: Customer[] = [
  {
    id: "cust-1",
    customerNumber: "CU-1001",
    firstName: "Marcus",
    lastName: "Doyle",
    companyName: "",
    phone: "(904) 555-1234",
    secondaryPhone: "",
    email: "marcus.doyle@example.com",
    billingAddress: "142 Riverside Ave, Jacksonville, FL",
    shippingAddress: "142 Riverside Ave, Jacksonville, FL",
    notes: "Prefers text over phone calls.",
    customerType: "retail",
    taxStatus: "taxable",
    taxId: "",
    resaleCertificateNumber: "",
    exemptionExpiresAt: "",
    documents: [],
    createdAt: daysAgo(120),
  },
  {
    id: "cust-2",
    customerNumber: "CU-1002",
    firstName: "Angela",
    lastName: "Cho",
    companyName: "Cho Auto Recyclers LLC",
    phone: "(912) 555-8891",
    secondaryPhone: "(912) 555-2210",
    email: "angela@choauto.com",
    billingAddress: "88 Industrial Pkwy, Savannah, GA",
    shippingAddress: "88 Industrial Pkwy, Savannah, GA",
    notes: "Wholesale account — verify resale cert before tax-exempt sales.",
    customerType: "wholesale",
    taxStatus: "exempt",
    taxId: "58-1234567",
    resaleCertificateNumber: "GA-RC-88213",
    exemptionExpiresAt: "2026-12-31",
    documents: [{ id: "doc-1", filename: "resale-certificate.pdf", type: "tax_document" }],
    createdAt: daysAgo(210),
  },
  {
    id: "cust-3",
    customerNumber: "CU-1003",
    firstName: "Ray",
    lastName: "Whitfield",
    companyName: "",
    phone: "(904) 555-7790",
    secondaryPhone: "",
    email: "",
    billingAddress: "",
    shippingAddress: "",
    notes: "",
    customerType: "retail",
    taxStatus: "taxable",
    taxId: "",
    resaleCertificateNumber: "",
    exemptionExpiresAt: "",
    documents: [],
    createdAt: daysAgo(5),
  },
];

export const quotes: Quote[] = [
  {
    id: "quote-1",
    quoteNumber: "Q-2201",
    customerId: "cust-1",
    status: "DRAFT",
    items: [
      { id: "qi-1", manual: false, partId: "part-5", stockSku: "SKU-10045", description: "2018 Ford F-150 Catalytic Converter", quantity: 1, unitPrice: 410, discount: 0, availableQuantity: 1 },
    ],
    discount: 0,
    notes: "Sales Desk quote",
    taxRate: salesSettings.taxRate,
    createdAt: daysAgo(6),
  },
  {
    id: "quote-2",
    quoteNumber: "Q-2189",
    customerId: "cust-2",
    status: "APPROVED",
    items: [
      { id: "qi-2", manual: false, partId: "part-6", stockSku: "SKU-10012", description: "2019 Tesla Model 3 Battery Module", quantity: 1, unitPrice: 1450, discount: 50, availableQuantity: 1 },
    ],
    discount: 0,
    notes: "",
    taxRate: 0,
    createdAt: daysAgo(11),
  },
];

export const sales: SaleRecord[] = [
  {
    id: "sale-1",
    saleNumber: "S-3301",
    invoiceNumber: "INV-3301",
    customerId: "cust-1",
    items: [
      { id: "si-1", manual: false, partId: "part-5", stockSku: "SKU-10045", description: "2018 Ford F-150 Catalytic Converter", quantity: 1, unitPrice: 410, discount: 0 },
      { id: "si-2", manual: true, stockSku: "MANUAL", description: "Shop labor — install", quantity: 1, unitPrice: 75, discount: 0 },
    ],
    discount: 0,
    taxRate: salesSettings.taxRate,
    createdAt: daysAgo(30),
  },
];

export const payments: Payment[] = [
  {
    id: "pay-1",
    paymentNumber: "P-9001",
    saleId: "sale-1",
    amount: 300,
    method: "CARD",
    reference: "auth-4471",
    notes: "",
    createdAt: daysAgo(29),
  },
];
