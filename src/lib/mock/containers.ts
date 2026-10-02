// Container Export Management + Employee Container Loading shared data model.
//
// Confidentiality design: `ContainerJob` holds only operational/loading data (safe for the
// Container Loading Employee role). Consignees, invoices and payments live in SEPARATE arrays
// keyed by id/containerId rather than embedded on the job, so a loading-employee component tree
// that only ever touches `jobs` (via `toLoaderSafeContainer`) never has confidential data in its
// props/state to begin with — it isn't just hidden with CSS. See `toLoaderSafeContainer` below.

export type ContainerStatus = "loading" | "ready_for_invoice" | "on_the_way" | "closed";

export const containerStatusLabels: Record<ContainerStatus, string> = {
  loading: "Loading / Open",
  ready_for_invoice: "Ready for Invoice",
  on_the_way: "On the Way",
  closed: "Closed",
};

export type ContainerFileKind = "number_photo" | "loading_photo" | "final_list" | "document";

export type ContainerFile = {
  id: string;
  kind: ContainerFileKind;
  filename: string;
  caption: string;
  isImage: boolean;
  employeeName: string;
  createdAt: string;
};

export type ContainerEvent = { id: string; createdAt: string; userName: string; action: string; note: string };

export type Consignee = {
  id: string;
  company: string;
  contact: string;
  address: string;
  city: string;
  stateProvince: string;
  country: string;
  phone: string;
  email: string;
};

export const emptyConsignee: Omit<Consignee, "id"> = {
  company: "",
  contact: "",
  address: "",
  city: "",
  stateProvince: "",
  country: "",
  phone: "",
  email: "",
};

export type ExportLine = { id: string; description: string; quantity: number; unitPrice: number; category?: string; condition?: string };

export type ContainerJob = {
  id: string;
  tRef: string;
  containerNumber: string;
  numberConfirmed: boolean;
  status: ContainerStatus;
  destinationCountry: string;
  destinationPort: string;
  truckingCompany: string;
  consigneeId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  shipDate: string | null;
  eta: string | null;
  shippingNote: string;
  notes: string;
  createdByName: string;
  lastUpdateAt: string;
  files: ContainerFile[];
  loadingListDraft: ExportLine[];
  loadingListConfirmed: boolean;
  events: ContainerEvent[];
  closedAt: string | null;
  closedByName: string | null;
  closeOverrideReason: string | null;
};

/** Operational-only view of a container — the shape the Container Loading Employee UI is built
 * from. Confidential fields (consignee, destination economics, pricing, invoice, payments) are
 * never copied onto it. */
export type LoaderSafeContainer = {
  id: string;
  tRef: string;
  containerNumber: string;
  numberConfirmed: boolean;
  status: ContainerStatus;
  startedAt: string | null;
  finishedAt: string | null;
  files: ContainerFile[];
  loadingListConfirmed: boolean;
};

export function toLoaderSafeContainer(j: ContainerJob): LoaderSafeContainer {
  return {
    id: j.id,
    tRef: j.tRef,
    containerNumber: j.containerNumber,
    numberConfirmed: j.numberConfirmed,
    status: j.status,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    files: j.files,
    loadingListConfirmed: j.loadingListConfirmed,
  };
}

export type InvoiceStatus = "Draft" | "Review" | "Finalized";

export type ExportInvoiceRevision = {
  id: string;
  savedAt: string;
  savedBy: string;
  reason: string;
  items: ExportLine[];
  consigneeSnapshot: Consignee | null;
};

export type ExportInvoice = {
  id: string;
  containerId: string;
  tRef: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  consigneeId: string | null;
  consigneeSnapshot: Consignee | null;
  destination: string;
  currency: string;
  notes: string;
  items: ExportLine[];
  needsReview: string[];
  createdAt: string;
  finalizedAt: string | null;
  revisions: ExportInvoiceRevision[];
};

export type PaymentType = "Deposit" | "Additional Deposit" | "Final Payment" | "Adjustment";
export type PaymentMethod = "Wire" | "ACH" | "Check" | "Cash" | "Other";
export type PaymentStatus = "No Payment" | "Deposit Received" | "Partially Paid" | "Paid in Full";

export type ExportPayment = {
  id: string;
  invoiceId: string;
  date: string;
  amount: number;
  type: PaymentType;
  method: PaymentMethod;
  referenceNumber: string;
  notes: string;
  proofFilename: string | null;
  enteredBy: string;
  createdAt: string;
  correction: { originalAmount: number; reason: string; correctedBy: string; correctedAt: string } | null;
};

export function invoiceTotal(items: ExportLine[]): number {
  return items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
}

export function paymentsTotal(payments: ExportPayment[]): number {
  return payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
}

export function derivePaymentStatus(total: number, paid: number, payments: ExportPayment[]): PaymentStatus {
  if (paid <= 0) return "No Payment";
  if (paid >= total && total > 0) return "Paid in Full";
  const onlyDeposits = payments.length > 0 && payments.every((p) => p.type === "Deposit" || p.type === "Additional Deposit");
  return onlyDeposits ? "Deposit Received" : "Partially Paid";
}

let tRefSeq = 29;
export function nextTRef(): string {
  return `T${tRefSeq++}`;
}

let containerNumSeq = 1;
let invoiceSeq = 5502;
let idSeq = 1;
function nextId(prefix: string) {
  return `${prefix}-${idSeq++}`;
}

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString();
}
function daysFromNow(n: number) {
  return new Date(Date.now() + n * 86400000).toISOString();
}

export const consignees: Consignee[] = [
  { id: "cg-1", company: "Kazim Sharif Co.", contact: "Kazim Sharif", address: "Al Quoz Industrial 3", city: "Dubai", stateProvince: "Dubai", country: "UAE", phone: "+971 4 555 0101", email: "kazim@kazimsharif.ae" },
  { id: "cg-2", company: "Al Futtaim", contact: "Rashid Al Futtaim", address: "Jebel Ali Free Zone", city: "Jebel Ali", stateProvince: "Dubai", country: "UAE", phone: "+971 4 555 0102", email: "trade@alfuttaim.ae" },
  { id: "cg-3", company: "Global Trading", contact: "Fahad Al Sabah", address: "Shuwaikh Industrial Area", city: "Kuwait City", stateProvince: "", country: "Kuwait", phone: "+965 2222 0103", email: "ops@globaltrading.kw" },
  { id: "cg-4", company: "Middle East Motors", contact: "Youssef Al Thani", address: "Industrial Area St 44", city: "Doha", stateProvince: "", country: "Qatar", phone: "+974 4444 0104", email: "parts@memotors.qa" },
  { id: "cg-5", company: "Sharjah Auto Parts", contact: "Omar Hadid", address: "Industrial Area 12", city: "Sharjah", stateProvince: "Sharjah", country: "UAE", phone: "+971 6 555 0105", email: "sales@sharjahautoparts.ae" },
  { id: "cg-6", company: "Arabian Parts LLC", contact: "Saud Al Qahtani", address: "2nd Industrial City", city: "Riyadh", stateProvince: "Riyadh", country: "Saudi Arabia", phone: "+966 11 555 0106", email: "import@arabianparts.sa" },
  { id: "cg-7", company: "Iraq Motors", contact: "Hassan Jabbar", address: "Al Zaafaraniya Industrial", city: "Baghdad", stateProvince: "", country: "Iraq", phone: "+964 1 555 0107", email: "sales@iraqmotors.iq" },
  { id: "cg-8", company: "Shamal Trading", contact: "Tariq Al Shamsi", address: "Umm Ramool", city: "Dubai", stateProvince: "Dubai", country: "UAE", phone: "+971 4 555 0108", email: "info@shamaltrading.ae" },
  { id: "cg-9", company: "Horizon Motors", contact: "Khaled Nasser", address: "Industrial Area St 21", city: "Doha", stateProvince: "", country: "Qatar", phone: "+974 4444 0109", email: "parts@horizonmotors.qa" },
  { id: "cg-10", company: "Kabul Parts", contact: "Rahim Noorzai", address: "Jalalabad Road", city: "Kabul", stateProvince: "", country: "Afghanistan", phone: "+93 70 555 0110", email: "rahim@kabulparts.af" },
];

function photo(kind: ContainerFileKind, caption: string, employeeName: string, createdAt: string): ContainerFile {
  return { id: nextId("f"), kind, filename: `${kind}-${nextId("img")}.jpg`, caption, isImage: kind !== "document", employeeName, createdAt };
}

function loadingPhotoSet(employeeName: string, baseDay: number, count: number): ContainerFile[] {
  const captions = ["Inside View 1", "Inside View 2", "Engine Parts", "Transmissions", "Body Parts", "Loading Process", "Rear Stack", "Side Panels"];
  const out: ContainerFile[] = [];
  for (let i = 0; i < count; i++) {
    out.push(photo("loading_photo", captions[i % captions.length], employeeName, daysAgo(baseDay - i * 0.1)));
  }
  return out;
}

function line(description: string, quantity: number, unitPrice: number, category: string, condition = "Used, tested"): ExportLine {
  return { id: nextId("ln"), description, quantity, unitPrice, category, condition };
}

type SeedSpec = {
  tRef: string;
  containerNumber: string;
  consigneeId: string;
  destinationCountry: string;
  destinationPort: string;
  status: ContainerStatus;
  shipDate: string | null;
  employeeName: string;
  photoCount: number;
  notes?: string;
  invoice?: { status: InvoiceStatus; items: ExportLine[]; payments: { amount: number; type: PaymentType; method: PaymentMethod }[] };
};

const seedSpecs: SeedSpec[] = [
  {
    tRef: "T26",
    containerNumber: "MSCU9934210",
    consigneeId: "cg-1",
    destinationCountry: "UAE",
    destinationPort: "Dubai, UAE",
    status: "loading",
    shipDate: null,
    employeeName: "Ahmed Khalil",
    photoCount: 13,
    notes: "Loading in progress. More engines and transmissions to be added.",
  },
  {
    tRef: "T25",
    containerNumber: "TGHU7654321",
    consigneeId: "cg-2",
    destinationCountry: "UAE",
    destinationPort: "Jebel Ali, UAE",
    status: "loading",
    shipDate: null,
    employeeName: "Ahmed Khalil",
    photoCount: 6,
  },
  {
    tRef: "T24",
    containerNumber: "MEDU7788123",
    consigneeId: "cg-3",
    destinationCountry: "Kuwait",
    destinationPort: "Kuwait",
    status: "ready_for_invoice",
    shipDate: null,
    employeeName: "Ahmed Khalil",
    photoCount: 18,
    invoice: { status: "Draft", items: [line("Assorted used engines", 4, 650, "Engines"), line("Transmissions, automatic", 3, 420, "Transmissions")], payments: [] },
  },
  {
    tRef: "T23",
    containerNumber: "CMAU1122334",
    consigneeId: "cg-4",
    destinationCountry: "Qatar",
    destinationPort: "Doha, Qatar",
    status: "on_the_way",
    shipDate: daysAgo(12).slice(0, 10),
    employeeName: "Jamal Reeves",
    photoCount: 20,
    invoice: {
      status: "Finalized",
      items: [line("2018 Ford F-150 Alternator", 2, 85, "Electrical"), line("Catalytic Converters, assorted", 5, 410, "Emissions"), line("Body panels, assorted", 10, 60, "Body")],
      payments: [{ amount: 1300, type: "Deposit", method: "Wire" }, { amount: 1520, type: "Final Payment", method: "Wire" }],
    },
  },
  {
    tRef: "T22",
    containerNumber: "APZU5566778",
    consigneeId: "cg-5",
    destinationCountry: "UAE",
    destinationPort: "Sharjah, UAE",
    status: "on_the_way",
    shipDate: daysAgo(14).slice(0, 10),
    employeeName: "Jamal Reeves",
    photoCount: 16,
    invoice: {
      status: "Finalized",
      items: [line("Headlight assemblies, assorted", 12, 120, "Lighting"), line("ECM / PCM modules", 6, 180, "Electronics")],
      payments: [{ amount: 1500, type: "Deposit", method: "Wire" }],
    },
  },
  {
    tRef: "T21",
    containerNumber: "MSKU3344556",
    consigneeId: "cg-6",
    destinationCountry: "Saudi Arabia",
    destinationPort: "Riyadh, Saudi Arabia",
    status: "on_the_way",
    shipDate: daysAgo(17).slice(0, 10),
    employeeName: "Jamal Reeves",
    photoCount: 14,
    invoice: { status: "Finalized", items: [line("Battery modules, EV", 3, 1450, "Electrical")], payments: [{ amount: 4350, type: "Final Payment", method: "ACH" }] },
  },
  {
    tRef: "T20",
    containerNumber: "TCNU7788990",
    consigneeId: "cg-7",
    destinationCountry: "Iraq",
    destinationPort: "Baghdad, Iraq",
    status: "ready_for_invoice",
    shipDate: null,
    employeeName: "Ahmed Khalil",
    photoCount: 10,
  },
  {
    tRef: "T19",
    containerNumber: "TRHU6677889",
    consigneeId: "cg-8",
    destinationCountry: "UAE",
    destinationPort: "Dubai, UAE",
    status: "closed",
    shipDate: daysAgo(22).slice(0, 10),
    employeeName: "Jamal Reeves",
    photoCount: 17,
    invoice: { status: "Finalized", items: [line("Assorted used auto parts per loading list", 24, 95, "Cargo items")], payments: [{ amount: 2280, type: "Final Payment", method: "Check" }] },
  },
  {
    tRef: "T18",
    containerNumber: "FCIU9988776",
    consigneeId: "cg-9",
    destinationCountry: "Qatar",
    destinationPort: "Doha, Qatar",
    status: "closed",
    shipDate: daysAgo(27).slice(0, 10),
    employeeName: "Jamal Reeves",
    photoCount: 12,
    invoice: { status: "Finalized", items: [line("Bumpers & fenders, assorted", 14, 70, "Body")], payments: [{ amount: 980, type: "Final Payment", method: "Wire" }] },
  },
  {
    tRef: "T17",
    containerNumber: "ONEU5566123",
    consigneeId: "cg-10",
    destinationCountry: "Afghanistan",
    destinationPort: "Kabul, Afghanistan",
    status: "closed",
    shipDate: daysAgo(30).slice(0, 10),
    employeeName: "Jamal Reeves",
    photoCount: 9,
    invoice: { status: "Finalized", items: [line("Starters & alternators, assorted", 18, 75, "Electrical")], payments: [{ amount: 1350, type: "Final Payment", method: "Cash" }] },
  },
];

function buildSeed(): { jobs: ContainerJob[]; invoices: ExportInvoice[]; payments: ExportPayment[] } {
  const jobs: ContainerJob[] = [];
  const invoices: ExportInvoice[] = [];
  const payments: ExportPayment[] = [];

  seedSpecs.forEach((spec, i) => {
    const baseDay = 2 + i * 3;
    const files: ContainerFile[] = [photo("number_photo", "Container Number", spec.employeeName, daysAgo(baseDay))];
    files.push(...loadingPhotoSet(spec.employeeName, baseDay - 0.2, Math.max(0, spec.photoCount - (spec.status === "loading" ? 1 : 2))));
    const hasFinalList = spec.status !== "loading";
    if (hasFinalList) files.push(photo("final_list", "Final Loading List", spec.employeeName, daysAgo(Math.max(0, baseDay - 1))));

    const jobId = nextId("cont");
    const job: ContainerJob = {
      id: jobId,
      tRef: spec.tRef,
      containerNumber: spec.containerNumber,
      numberConfirmed: true,
      status: spec.status,
      destinationCountry: spec.destinationCountry,
      destinationPort: spec.destinationPort,
      truckingCompany: "Southeast Auto Transport",
      consigneeId: spec.consigneeId,
      startedAt: daysAgo(baseDay),
      finishedAt: spec.status === "loading" ? null : daysAgo(Math.max(0, baseDay - 1)),
      shipDate: spec.shipDate,
      eta: spec.status === "on_the_way" ? daysFromNow(10) : null,
      shippingNote: spec.status === "on_the_way" ? "Vessel booked, transit ~25 days." : "",
      notes: spec.notes || "",
      createdByName: spec.employeeName,
      lastUpdateAt: daysAgo(Math.max(0, baseDay - 1)),
      files,
      loadingListDraft: spec.invoice ? spec.invoice.items.map((it) => ({ ...it, id: nextId("ln") })) : [],
      loadingListConfirmed: hasFinalList,
      events: [
        { id: nextId("e"), createdAt: daysAgo(baseDay), userName: spec.employeeName, action: "STARTED", note: "Began loading container" },
        { id: nextId("e"), createdAt: daysAgo(Math.max(0, baseDay - 0.5)), userName: spec.employeeName, action: "PHOTO", note: `${files.length} loading photo(s) added` },
      ],
      closedAt: spec.status === "closed" ? daysAgo(Math.max(0, baseDay - 2)) : null,
      closedByName: spec.status === "closed" ? "Denise Ford" : null,
      closeOverrideReason: null,
    };

    if (spec.status !== "loading") {
      job.events.push({ id: nextId("e"), createdAt: daysAgo(Math.max(0, baseDay - 1)), userName: spec.employeeName, action: "LOADING_FINISHED", note: "Marked loading finished — moved to Ready for Invoice" });
    }
    if (spec.status === "on_the_way" || spec.status === "closed") {
      job.events.push({ id: nextId("e"), createdAt: daysAgo(Math.max(0, baseDay - 1.5)), userName: "Denise Ford", action: "INVOICE_FINALIZED", note: "Export invoice finalized" });
      job.events.push({ id: nextId("e"), createdAt: spec.shipDate ? new Date(spec.shipDate).toISOString() : daysAgo(1), userName: "Denise Ford", action: "ON_THE_WAY", note: "Marked On the Way" });
    }
    if (spec.status === "closed") {
      job.events.push({ id: nextId("e"), createdAt: job.closedAt!, userName: "Denise Ford", action: "CLOSED", note: "Container closed" });
    }

    jobs.push(job);

    if (spec.invoice) {
      const invId = nextId("inv");
      const invNumber = `EXP-${invoiceSeq++}`;
      const consignee = consignees.find((c) => c.id === spec.consigneeId) || null;
      const invStatus = spec.invoice.status;
      const inv: ExportInvoice = {
        id: invId,
        containerId: jobId,
        tRef: spec.tRef,
        invoiceNumber: invNumber,
        status: invStatus,
        consigneeId: spec.consigneeId,
        consigneeSnapshot: invStatus === "Finalized" ? consignee : null,
        destination: spec.destinationPort,
        currency: "USD",
        notes: "Freight prepaid. Buyer to arrange customs clearance.",
        items: spec.invoice.items.map((it) => ({ ...it, id: nextId("ln2") })),
        needsReview: invStatus === "Draft" ? ["unitPrice"] : [],
        createdAt: daysAgo(Math.max(0, baseDay - 1)),
        finalizedAt: invStatus === "Finalized" ? daysAgo(Math.max(0, baseDay - 1.5)) : null,
        revisions: [],
      };
      invoices.push(inv);

      spec.invoice.payments.forEach((p, pi) => {
        payments.push({
          id: nextId("pay"),
          invoiceId: invId,
          date: daysAgo(Math.max(0, baseDay - 1 - pi)).slice(0, 10),
          amount: p.amount,
          type: p.type,
          method: p.method,
          referenceNumber: `REF-${1000 + i * 10 + pi}`,
          notes: "",
          proofFilename: `payment-proof-${invNumber}-${pi + 1}.jpg`,
          enteredBy: "Denise Ford",
          createdAt: daysAgo(Math.max(0, baseDay - 1 - pi)),
          correction: null,
        });
      });
    }
  });

  containerNumSeq = jobs.length + 1;
  return { jobs, invoices, payments };
}

const seed = buildSeed();
export const containerJobs: ContainerJob[] = seed.jobs;
export const exportInvoices: ExportInvoice[] = seed.invoices;
export const exportPayments: ExportPayment[] = seed.payments;

export const emptyContainerForm = {
  containerNumber: "",
  truckingCompany: "",
  destinationCountry: "",
  destinationPort: "",
  consigneeId: null as string | null,
};

export function generateContainerNumberPlaceholder(): string {
  return `CONT${String(containerNumSeq++).padStart(7, "0")}`;
}
