// Scrap Operations data model.
//
// Driver side only ever captures PHOTOS (load photo, ticket photo, check photo).
// Weight / rate / amount / approval / payment are manager-entered and manager-owned —
// never editable or visible from the driver UI. See `toDriverSafeLoad` below, which is
// the one place driver-facing components are allowed to read a ScrapLoad through.

export type ScrapPhoto = { id: string; takenAt: string };

function photo(takenAt: string): ScrapPhoto {
  return { id: `ph-${Math.random().toString(36).slice(2, 9)}`, takenAt };
}

// "ticket_missing" is intentionally NOT a stored state — see effectiveLoadStatus().
export type ScrapLoadStatus = "new" | "ready_for_review" | "approved" | "closed";

export type ScrapLoad = {
  id: string;
  driverId: string;
  driverName: string;
  loadDate: string; // local business day, YYYY-MM-DD
  createdAt: string;
  loadPhoto: ScrapPhoto | null;
  ticketPhoto: ScrapPhoto | null;
  status: ScrapLoadStatus;
  weight: number | null;
  rate: number | null;
  amount: number | null;
  managerNotes: string;
  paymentId: string | null;
};

export type PaymentMethod = "Check" | "ACH" | "Wire" | "Other";

export type ScrapPayment = {
  id: string;
  driverId: string;
  driverName: string;
  linkedLoadIds: string[];
  paymentDate: string;
  amountReceived: number;
  method: PaymentMethod;
  referenceNumber: string;
  proofPhoto: ScrapPhoto | null;
  notes: string;
  enteredByName: string;
  createdAt: string;
  discrepancyReason: string | null;
  discrepancyApprovedBy: string | null;
};

export type RimReturn = {
  id: string;
  aluminumReturned: number;
  steelReturned: number;
  photo: ScrapPhoto | null;
  notes: string;
  employeeName: string;
  createdAt: string;
};

export type RimObligation = {
  id: string;
  customerId: string;
  tiresQty: number;
  aluminumOwed: number;
  steelOwed: number;
  pickupPhoto: ScrapPhoto | null;
  employeeName: string;
  createdAt: string;
  notes: string;
  returns: RimReturn[];
};

/** A driver-photographed check, captured before a manager has reconciled it into a
 * ScrapPayment. Driver never enters amount/loads — just the photo (B11). */
export type DriverCheckSubmission = {
  id: string;
  driverId: string;
  driverName: string;
  photo: ScrapPhoto;
  createdAt: string;
  linkedPaymentId: string | null;
};

export type ScrapAuditEvent = {
  id: string;
  createdAt: string;
  actorName: string;
  action: string;
  summary: string;
};

export type DailyCloseRecord = {
  id: string;
  date: string;
  closedByName: string;
  closedAt: string;
  overrideReason: string | null;
  totals: { loads: number; approvedLoads: number; weight: number; amount: number; paymentsReceived: number };
};

export const paymentMethods: PaymentMethod[] = ["Check", "ACH", "Wire", "Other"];

export function localDay(date: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function hoursAgo(n: number) {
  return new Date(Date.now() - n * 3600000);
}
function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000);
}

const todayStr = localDay();
const yesterdayStr = localDay(new Date(Date.now() - 86400000));

// --- Derivation helpers (status, amounts, aging) ------------------------------------

/** Driver-safe projection — never leaks weight/rate/amount/managerNotes/payment linkage. */
export function toDriverSafeLoad(load: ScrapLoad) {
  return {
    id: load.id,
    loadDate: load.loadDate,
    createdAt: load.createdAt,
    hasLoadPhoto: !!load.loadPhoto,
    hasTicketPhoto: !!load.ticketPhoto,
    displayStatus: driverDisplayStatus(load),
  };
}

export function driverDisplayStatus(load: ScrapLoad): "Load Photo Saved" | "Ticket Photo Saved" | "Complete" {
  if (load.ticketPhoto) return load.status === "new" ? "Ticket Photo Saved" : "Complete";
  return "Load Photo Saved";
}

/** Manager-facing lifecycle label. "Ticket Missing" is computed, not stored — a load
 * that's still "new" with no ticket by the next business day is flagged automatically. */
export function effectiveLoadStatus(load: ScrapLoad): ScrapLoadStatus | "ticket_missing" {
  if (load.status === "new" && !load.ticketPhoto && load.loadDate < todayStr) return "ticket_missing";
  return load.status;
}

export const loadStatusLabels: Record<ScrapLoadStatus | "ticket_missing", string> = {
  new: "New",
  ticket_missing: "Ticket Missing",
  ready_for_review: "Ready for Review",
  approved: "Approved",
  closed: "Closed",
};

export function loadAmount(load: ScrapLoad): number {
  if (load.weight != null && load.rate != null) return Math.round(load.weight * load.rate * 100) / 100;
  return load.amount ?? 0;
}

export function paymentStatusLabel(load: ScrapLoad): "No Payment" | "Payment Pending" | "Paid" {
  if (!load.paymentId) return load.status === "approved" || load.status === "closed" ? "Payment Pending" : "No Payment";
  return load.status === "closed" ? "Paid" : "Payment Pending";
}

export function paymentExpectedTotal(payment: Pick<ScrapPayment, "linkedLoadIds">, loads: ScrapLoad[]): number {
  return loads.filter((l) => payment.linkedLoadIds.includes(l.id)).reduce((sum, l) => sum + loadAmount(l), 0);
}

export function paymentIsMismatched(payment: ScrapPayment, loads: ScrapLoad[]): boolean {
  if (payment.discrepancyReason) return false; // resolved via authorized override
  const expected = paymentExpectedTotal(payment, loads);
  return Math.abs(expected - payment.amountReceived) > 0.01;
}

export function rimRemaining(obligation: RimObligation): { aluminum: number; steel: number } {
  const returnedAl = obligation.returns.reduce((n, r) => n + r.aluminumReturned, 0);
  const returnedSteel = obligation.returns.reduce((n, r) => n + r.steelReturned, 0);
  return {
    aluminum: Math.max(0, obligation.aluminumOwed - returnedAl),
    steel: Math.max(0, obligation.steelOwed - returnedSteel),
  };
}

export function rimCompletionStatus(obligation: RimObligation): "Open" | "Partial Return" | "Completed" {
  const remaining = rimRemaining(obligation);
  if (remaining.aluminum === 0 && remaining.steel === 0) return "Completed";
  if (obligation.returns.length > 0) return "Partial Return";
  return "Open";
}

export function rimLastActivityAt(obligation: RimObligation): string {
  const last = obligation.returns.at(-1);
  return last ? last.createdAt : obligation.createdAt;
}

export function rimAgingLabel(obligation: RimObligation): "Up to Date" | "3 Days" | "6 Days" | "Over 1 Week" {
  if (rimCompletionStatus(obligation) === "Completed") return "Up to Date";
  const days = Math.floor((Date.now() - new Date(rimLastActivityAt(obligation)).getTime()) / 86400000);
  if (days < 3) return "Up to Date";
  if (days < 6) return "3 Days";
  if (days < 8) return "6 Days";
  return "Over 1 Week";
}

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export type PeriodId = "today" | "week" | "month" | "custom";

export function periodRange(period: PeriodId, custom?: { from?: string; to?: string }): { from: string; to: string } {
  if (period === "today") return { from: todayStr, to: todayStr };
  if (period === "week") return { from: localDay(new Date(Date.now() - 7 * 86400000)), to: todayStr };
  if (period === "month") return { from: localDay(new Date(Date.now() - 30 * 86400000)), to: todayStr };
  return { from: custom?.from || todayStr, to: custom?.to || todayStr };
}

// --- Seed data ------------------------------------------------------------------------

const driverSeed = [
  { id: "u-driver", name: "Saeed Karimi" },
  { id: "u-driver-2", name: "Navid Farahani" },
  { id: "u-driver-3", name: "Carlos Diaz" },
  { id: "u-driver-4", name: "Mike Sanders" },
];

function buildSeedLoads(): ScrapLoad[] {
  const loads: ScrapLoad[] = [];
  const rate = 0.075;

  // Saeed — 5 completed loads today (matches the reference manager dashboard example)
  const saeedWeights = [4620, 5480, 6240, 6800, 5500];
  saeedWeights.forEach((w, i) => {
    const createdAt = hoursAgo(9 - i * 1.5).toISOString();
    loads.push({
      id: `scrap-saeed-${i}`,
      driverId: "u-driver",
      driverName: "Saeed Karimi",
      loadDate: todayStr,
      createdAt,
      loadPhoto: photo(createdAt),
      ticketPhoto: photo(createdAt),
      status: "closed",
      weight: w,
      rate,
      amount: Math.round(w * rate * 100) / 100,
      managerNotes: i === saeedWeights.length - 1 ? "Good load." : "",
      paymentId: "pay-saeed-1",
    });
  });

  // Navid — 3 loads today, approved but payment pending
  [4000, 4800, 5120].forEach((w, i) => {
    const createdAt = hoursAgo(6 - i * 1.5).toISOString();
    loads.push({
      id: `scrap-navid-${i}`,
      driverId: "u-driver-2",
      driverName: "Navid Farahani",
      loadDate: todayStr,
      createdAt,
      loadPhoto: photo(createdAt),
      ticketPhoto: photo(createdAt),
      status: "approved",
      weight: w,
      rate,
      amount: Math.round(w * rate * 100) / 100,
      managerNotes: "",
      paymentId: null,
    });
  });

  // Carlos — 2 loads, one ready for review (ticket just in), one still missing a ticket from yesterday
  loads.push({
    id: "scrap-carlos-0",
    driverId: "u-driver-3",
    driverName: "Carlos Diaz",
    loadDate: todayStr,
    createdAt: hoursAgo(3).toISOString(),
    loadPhoto: photo(hoursAgo(3).toISOString()),
    ticketPhoto: photo(hoursAgo(2.5).toISOString()),
    status: "ready_for_review",
    weight: null,
    rate: null,
    amount: null,
    managerNotes: "",
    paymentId: null,
  });
  loads.push({
    id: "scrap-carlos-1",
    driverId: "u-driver-3",
    driverName: "Carlos Diaz",
    loadDate: yesterdayStr,
    createdAt: daysAgo(1).toISOString(),
    loadPhoto: photo(daysAgo(1).toISOString()),
    ticketPhoto: null,
    status: "new",
    weight: null,
    rate: null,
    amount: null,
    managerNotes: "",
    paymentId: null,
  });

  // Mike — 1 load today, just the load photo saved
  loads.push({
    id: "scrap-mike-0",
    driverId: "u-driver-4",
    driverName: "Mike Sanders",
    loadDate: todayStr,
    createdAt: hoursAgo(1).toISOString(),
    loadPhoto: photo(hoursAgo(1).toISOString()),
    ticketPhoto: null,
    status: "new",
    weight: null,
    rate: null,
    amount: null,
    managerNotes: "",
    paymentId: null,
  });

  return loads;
}

export const scrapDrivers = driverSeed;
export const scrapLoads: ScrapLoad[] = buildSeedLoads();

export const scrapPayments: ScrapPayment[] = [
  {
    id: "pay-saeed-1",
    driverId: "u-driver",
    driverName: "Saeed Karimi",
    linkedLoadIds: scrapLoads.filter((l) => l.driverId === "u-driver").map((l) => l.id),
    paymentDate: todayStr,
    amountReceived: 2148,
    method: "Check",
    referenceNumber: "1058",
    proofPhoto: photo(hoursAgo(0.5).toISOString()),
    notes: "Payment for 5 loads (Saeed)",
    enteredByName: "Denise Ford",
    createdAt: hoursAgo(0.5).toISOString(),
    discrepancyReason: null,
    discrepancyApprovedBy: null,
  },
];

// Rim tracking links to EXISTING Customers & Sales records (no second customer DB) —
// see `src/lib/mock/sales.ts`. Only 3 demo customers exist there today; all 3 are seeded
// with a rim obligation so the Tire Shop panel has real, linked data to show.
export const rimObligations: RimObligation[] = [
  {
    id: "rim-1",
    customerId: "cust-2",
    tiresQty: 10,
    aluminumOwed: 8,
    steelOwed: 2,
    pickupPhoto: photo(daysAgo(9).toISOString()),
    employeeName: "Denise Ford",
    createdAt: daysAgo(9).toISOString(),
    notes: "",
    returns: [],
  },
  {
    id: "rim-2",
    customerId: "cust-3",
    tiresQty: 4,
    aluminumOwed: 4,
    steelOwed: 0,
    pickupPhoto: photo(daysAgo(6).toISOString()),
    employeeName: "Denise Ford",
    createdAt: daysAgo(6).toISOString(),
    notes: "",
    returns: [
      { id: "rimret-1", aluminumReturned: 2, steelReturned: 0, photo: photo(daysAgo(3).toISOString()), notes: "Partial drop-off", employeeName: "Denise Ford", createdAt: daysAgo(3).toISOString() },
    ],
  },
  {
    id: "rim-3",
    customerId: "cust-1",
    tiresQty: 6,
    aluminumOwed: 0,
    steelOwed: 6,
    pickupPhoto: photo(daysAgo(14).toISOString()),
    employeeName: "Denise Ford",
    createdAt: daysAgo(14).toISOString(),
    notes: "",
    returns: [
      { id: "rimret-2", aluminumReturned: 0, steelReturned: 6, photo: photo(daysAgo(12).toISOString()), notes: "Full return", employeeName: "Denise Ford", createdAt: daysAgo(12).toISOString() },
    ],
  },
];

export const driverCheckSubmissions: DriverCheckSubmission[] = [
  { id: "chk-sub-1", driverId: "u-driver", driverName: "Saeed Karimi", photo: photo(hoursAgo(0.5).toISOString()), createdAt: hoursAgo(0.5).toISOString(), linkedPaymentId: "pay-saeed-1" },
];

export const scrapAuditEvents: ScrapAuditEvent[] = [
  { id: "sa-1", createdAt: hoursAgo(0.5).toISOString(), actorName: "Denise Ford", action: "PAYMENT_LINKED", summary: "Linked check #1058 to 5 of Saeed's loads" },
  { id: "sa-2", createdAt: daysAgo(3).toISOString(), actorName: "Denise Ford", action: "RIM_RETURN", summary: "Recorded partial rim return for Ray — 2 aluminum" },
];

export const dailyCloses: DailyCloseRecord[] = [];
