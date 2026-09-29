export const containerStatusOptions = ["Planned", "Loading", "Loaded", "Completed"];

export type ContainerFile = { id: string; kind: "loading_photo" | "loading_list" | "document"; filename: string; isImage: boolean };

export type ContainerEvent = { id: string; createdAt: string; userName: string; action: string; note: string };

export type ContainerJob = {
  id: string;
  containerNumber: string;
  truckingCompany: string;
  destinationCountry: string;
  destinationPort: string;
  consignee: string;
  loadingDate: string;
  totalCost: number;
  depositPaid: number;
  finalPayment: number;
  status: string;
  assignedEmployeeId: string | null;
  files: ContainerFile[];
  events: ContainerEvent[];
};

export const emptyContainer: Omit<ContainerJob, "id" | "files" | "events"> = {
  containerNumber: "",
  truckingCompany: "",
  destinationCountry: "",
  destinationPort: "",
  consignee: "",
  loadingDate: "",
  totalCost: 0,
  depositPaid: 0,
  finalPayment: 0,
  status: "Planned",
  assignedEmployeeId: null,
};

export const containerFieldOrder: [keyof typeof emptyContainer, string][] = [
  ["containerNumber", "Container number"],
  ["truckingCompany", "Trucking / logistics company"],
  ["destinationCountry", "Destination country"],
  ["destinationPort", "Destination port"],
  ["consignee", "Consignee"],
  ["loadingDate", "Pickup / loading date"],
  ["totalCost", "Total cost"],
  ["depositPaid", "Deposit paid"],
  ["finalPayment", "Final payment"],
];

export type ExportLine = { description: string; quantity: number; unitPrice: number; category?: string; condition?: string };

export type ExportInvoice = {
  id: string;
  containerId: string;
  invoiceNumber: string;
  status: "Draft" | "Final";
  consignee: string;
  destination: string;
  currency: string;
  notes: string;
  items: ExportLine[];
  needsReview: string[];
  finalizedAt: string | null;
  createdAt: string;
};

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

export const containerJobs: ContainerJob[] = [
  {
    id: "cont-1",
    containerNumber: "LALU4471982",
    truckingCompany: "Southeast Auto Transport",
    destinationCountry: "Jamaica",
    destinationPort: "Kingston",
    consignee: "Caribbean Auto Parts Ltd.",
    loadingDate: daysAgo(6).slice(0, 10),
    totalCost: 3200,
    depositPaid: 1600,
    finalPayment: 0,
    status: "Loaded",
    assignedEmployeeId: "u-employee",
    files: [
      { id: "f1", kind: "loading_photo", filename: "loading-1.jpg", isImage: true },
      { id: "f2", kind: "loading_list", filename: "loading-list.pdf", isImage: false },
    ],
    events: [
      { id: "e1", createdAt: daysAgo(6), userName: "Jamal Reeves", action: "STARTED", note: "Began loading container" },
      { id: "e2", createdAt: daysAgo(5), userName: "Jamal Reeves", action: "PHOTO", note: "Loading progress photo added" },
      { id: "e3", createdAt: daysAgo(4), userName: "Denise Ford", action: "STATUS", note: "Marked Loaded" },
    ],
  },
  {
    id: "cont-2",
    containerNumber: "MSCU9012334",
    truckingCompany: "Interstate Carriers LLC",
    destinationCountry: "Honduras",
    destinationPort: "Puerto Cortés",
    consignee: "",
    loadingDate: daysAgo(1).slice(0, 10),
    totalCost: 2800,
    depositPaid: 0,
    finalPayment: 0,
    status: "Loading",
    assignedEmployeeId: "u-employee",
    files: [{ id: "f3", kind: "loading_photo", filename: "loading-2.jpg", isImage: true }],
    events: [{ id: "e4", createdAt: daysAgo(1), userName: "Jamal Reeves", action: "STARTED", note: "Began loading container" }],
  },
  {
    id: "cont-3",
    containerNumber: "TCLU5521190",
    truckingCompany: "",
    destinationCountry: "",
    destinationPort: "",
    consignee: "",
    loadingDate: "",
    totalCost: 0,
    depositPaid: 0,
    finalPayment: 0,
    status: "Planned",
    assignedEmployeeId: null,
    files: [],
    events: [],
  },
];

export const exportInvoices: ExportInvoice[] = [
  {
    id: "inv-1",
    containerId: "cont-1",
    invoiceNumber: "EXP-5501",
    status: "Final",
    consignee: "Caribbean Auto Parts Ltd.",
    destination: "Kingston, Jamaica",
    currency: "USD",
    notes: "Freight prepaid. Buyer to arrange customs clearance.",
    items: [
      { description: "2018 Ford F-150 Alternator", quantity: 2, unitPrice: 85, category: "Electrical", condition: "Used, tested" },
      { description: "2018 Ford F-150 Catalytic Converter", quantity: 1, unitPrice: 410, category: "Emissions", condition: "Used, verified fitment" },
      { description: "Assorted body panels", quantity: 6, unitPrice: 60, category: "Body", condition: "Used" },
    ],
    needsReview: [],
    finalizedAt: daysAgo(3),
    createdAt: daysAgo(5),
  },
];
