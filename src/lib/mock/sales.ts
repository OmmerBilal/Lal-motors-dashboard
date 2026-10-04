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

export type PaymentMethod = "CASH" | "CARD" | "CHECK" | "BANK_TRANSFER" | "QR_CODE" | "PAYMENT_LINK" | "OTHER";

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

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
