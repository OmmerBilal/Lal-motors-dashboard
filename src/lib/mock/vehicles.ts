/**
 * One VIN = one master vehicle record. This type is the single shared shape used by
 * Auction Vehicle Inventory, Central Dispatch / Transportation, and Vehicle Receiving &
 * Arrival — all three modules read/write the same VehicleRecord via VehicleDataProvider
 * instead of keeping their own disconnected mock datasets.
 */

export type TransportStatus =
  | "NEED_TRANSPORT"
  | "READY_TO_POST"
  | "POSTED_TO_CD"
  | "ASSIGNED"
  | "IN_TRANSIT"
  | "ARRIVED"
  | "PROBLEM";

export type ClosedReason = "Scrapped" | "Sold Complete" | "Exported" | "Other";

export type VehicleRecord = {
  id: string;
  auctionSource: string;
  vin: string;
  lotNumber: string;
  stockNumber: string;
  auctionItemNumber: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  engine: string;
  mileage: string;
  mileageStatus: string;
  titleStatus: string;
  location: string;
  purchasePrice: string;
  invoiceAmount: string;
  balanceDue: string;
  auctionFees: string;
  transportationCost: string;
  saleDate: string;
  pickupPin: string;
  pickupStatus: string;
  pickupDeadline: string;
  damageInfo: string;
  transportInfo: string;
  status: string;
  assignedId: string | null;
  assignedName: string | null;
  arrivalDate: string | null;
  createdAt: string;
  unverifiedFields: string[];

  // --- Transportation / Central Dispatch (shared master-record fields) ---
  pickupLocationName: string;
  pickupAddress: string;
  transportStatus: TransportStatus;
  transportPrice: string;
  carrierId: string | null;
  carrierName: string | null;
  transportProblem: string | null;

  // --- Auction Inventory lifecycle ---
  closedReason: ClosedReason | null;
  closedNote: string | null;

  // --- Vehicle Receiving & Arrival ---
  receivingStatus: "not_received" | "received";
  receivedBy: string | null;
  receivedAt: string | null;
  arrivalPhotos: { id: string; label: string; takenAt: string }[];
};

export const vehicleFieldOrder = [
  "auctionSource",
  "vin",
  "lotNumber",
  "stockNumber",
  "auctionItemNumber",
  "year",
  "make",
  "model",
  "trim",
  "engine",
  "mileage",
  "mileageStatus",
  "titleStatus",
  "location",
  "purchasePrice",
  "invoiceAmount",
  "balanceDue",
  "auctionFees",
  "transportationCost",
  "saleDate",
  "pickupPin",
  "pickupStatus",
  "pickupDeadline",
  "damageInfo",
  "transportInfo",
] as const;

export const vehicleFieldLabels: Record<string, string> = {
  auctionSource: "Auction source",
  vin: "VIN",
  lotNumber: "Lot #",
  stockNumber: "Stock #",
  auctionItemNumber: "Auction Item #",
  year: "Year",
  make: "Make",
  model: "Model",
  trim: "Trim",
  engine: "Engine",
  mileage: "Mileage",
  mileageStatus: "Odometer status",
  titleStatus: "Title",
  location: "Branch / location",
  purchasePrice: "Purchase amount",
  invoiceAmount: "Invoice amount",
  balanceDue: "Balance due",
  auctionFees: "Buyer fees",
  transportationCost: "Transport cost",
  saleDate: "Sale / win date",
  pickupPin: "Pickup PIN",
  pickupStatus: "Pickup status",
  pickupDeadline: "Pickup deadline",
  damageInfo: "Damage",
  transportInfo: "Transportation",
};

export const emptyVehicleDraft: Record<string, string> = Object.fromEntries(
  vehicleFieldOrder.map((key) => [key, ""])
);

export const vehicleStatusOptions = [
  "Purchased",
  "Awaiting Dispatch",
  "Assigned",
  "Awaiting Pickup",
  "Picked Up",
  "Awaiting Transport",
  "In Transit",
  "Arrived",
  "Available at Yard",
  "Ready for Processing",
  "Processing",
  "Dismantled",
];

export const vehicleTitle = (v: Partial<VehicleRecord>) =>
  `${v.year || ""} ${v.make || ""} ${v.model || ""}`.trim() || "Vehicle needs review";

export const cash = (n: unknown) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Number(n) || 0
  );



// --- Shared carrier directory (used by Central Dispatch, referenced by VehicleRecord.carrierId) ---

export type Carrier = {
  id: string;
  company: string;
  driver: string;
  phone: string;
  email: string;
  address: string;
  mcDot: string;
  notes: string;
  active: boolean;
};


// --- Transportation / Central Dispatch helpers ---

export const transportStatusLabels: Record<TransportStatus, string> = {
  NEED_TRANSPORT: "Need Transport",
  READY_TO_POST: "Ready to Post",
  POSTED_TO_CD: "Posted to Central Dispatch",
  ASSIGNED: "Assigned to Carrier",
  IN_TRANSIT: "In Transit",
  ARRIVED: "Arrived",
  PROBLEM: "Problem",
};

export const transportStatusTone: Record<TransportStatus, "neutral" | "info" | "success" | "warning" | "danger" | "brand"> = {
  NEED_TRANSPORT: "neutral",
  READY_TO_POST: "info",
  POSTED_TO_CD: "info",
  ASSIGNED: "brand",
  IN_TRANSIT: "warning",
  ARRIVED: "success",
  PROBLEM: "danger",
};

export const closedReasonOptions: ClosedReason[] = ["Scrapped", "Sold Complete", "Exported", "Other"];

export const transportProblemReasons = [
  "Carrier canceled",
  "Carrier did not pick up",
  "Pickup refused",
  "Wrong PIN",
  "Invalid PIN",
  "Vehicle not ready",
  "Vehicle cannot be located",
  "Other transportation problem",
];

/** Days since purchase/sale — used for both the Auction "Overdue 10+ Days" card and Dispatch's Days column. */
export function computeTransportDays(v: VehicleRecord) {
  return Math.max(0, Math.floor((Date.now() - new Date(v.saleDate || v.createdAt).getTime()) / 86400000));
}

export function isTransportOverdue(v: VehicleRecord) {
  return (
    v.transportStatus !== "ARRIVED" &&
    v.transportStatus !== "PROBLEM" &&
    !v.closedReason &&
    computeTransportDays(v) >= 10
  );
}

export function computeAuctionInventoryStats(list: VehicleRecord[]) {
  const open = list.filter((v) => !v.closedReason);
  return {
    total: list.length,
    waitingArrival: open.filter((v) => v.transportStatus !== "ARRIVED" && !isTransportOverdue(v)).length,
    inTransit: open.filter((v) => v.transportStatus === "IN_TRANSIT").length,
    availableInYard: open.filter((v) => v.transportStatus === "ARRIVED").length,
    overdue: open.filter(isTransportOverdue).length,
    closed: list.filter((v) => v.closedReason).length,
  };
}

export function computeDispatchStats(list: VehicleRecord[]) {
  const open = list.filter((v) => !v.closedReason);
  return {
    needTransport: open.filter((v) => v.transportStatus === "NEED_TRANSPORT").length,
    postedToCd: open.filter((v) => v.transportStatus === "POSTED_TO_CD").length,
    assigned: open.filter((v) => v.transportStatus === "ASSIGNED").length,
    inTransit: open.filter((v) => v.transportStatus === "IN_TRANSIT").length,
    arrived: open.filter((v) => v.transportStatus === "ARRIVED").length,
    overdue: open.filter(isTransportOverdue).length,
    problems: open.filter((v) => v.transportStatus === "PROBLEM").length,
  };
}

export type PickupGroup = { name: string; address: string; vehicles: VehicleRecord[] };

export function groupByPickupLocation(list: VehicleRecord[]): PickupGroup[] {
  const map = new Map<string, PickupGroup>();
  for (const v of list) {
    const key = v.pickupLocationName || "Unknown Location";
    if (!map.has(key)) map.set(key, { name: key, address: v.pickupAddress, vehicles: [] });
    map.get(key)!.vehicles.push(v);
  }
  return [...map.values()].sort((a, b) => b.vehicles.length - a.vehicles.length);
}

export type AuctionStage = "waiting" | "transit" | "available" | "overdue" | "closed";

/** Simplified yard-facing stage for the Auction Inventory status cards/table (distinct from the more granular Central Dispatch transportStatus). */
export function auctionStageInfo(v: VehicleRecord): {
  stage: AuctionStage;
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger" | "brand";
} {
  if (v.closedReason) return { stage: "closed", label: "Closed / Removed", tone: "neutral" };
  if (isTransportOverdue(v)) return { stage: "overdue", label: "Overdue", tone: "danger" };
  if (v.transportStatus === "IN_TRANSIT") return { stage: "transit", label: "In Transit", tone: "info" };
  if (v.transportStatus === "ARRIVED") return { stage: "available", label: "Available", tone: "success" };
  return { stage: "waiting", label: "Waiting Arrival", tone: "warning" };
}

/** Copart uses the Lot #, IAA uses the Stock # for the combined transportation table column. */
export function lotOrStockDisplay(v: VehicleRecord) {
  const isCopart = v.auctionSource?.toLowerCase().includes("copart");
  return isCopart ? v.lotNumber || "—" : v.stockNumber || v.lotNumber || "—";
}

export type VehicleEventAction =
  | "STATUS"
  | "ASSIGN"
  | "START"
  | "PART_REMOVED"
  | "PHOTO"
  | "COMPLETION_SUBMITTED"
  | "COMPLETION_NEEDS_CORRECTION"
  | "COMPLETION_APPROVED"
  | "COMPLETION_CREDIT"
  | "DISPOSITION"
  | "ISSUE_FLAGGED"
  | "REVIEW_APPROVED"
  | "REVIEW_EDITED_APPROVED"
  | "REVIEW_MARKED_DUPLICATE"
  | "REVIEW_REJECTED"
  | "REVIEW_KEPT_FOR_LATER";

export type VehicleEvent = {
  id: string;
  vehicleId: string;
  action: VehicleEventAction;
  actorId: string;
  actorName: string;
  createdAt: string;
  note?: string;
  partType?: string;
  highValue?: boolean;
  disposition?: string;
  location?: string;
  status?: string;
  hasPhoto?: boolean;
  partId?: string;
};



export type CompletionSubmission = {
  submissionId: string;
  vehicleId: string;
  employeeName: string;
  submittedAt: string;
  vin: string;
  lotNumber: string;
  stockNumber: string;
  year: string;
  make: string;
  model: string;
  partCount: number;
  converterCount: number;
  custodyExceptions: number;
  note: string;
};


export type YardCorrection = {
  submissionId: string;
  vehicleId: string;
  lotNumber: string;
  year: string;
  make: string;
  model: string;
  reason: string;
};


export type IntakeDraft = Partial<Record<(typeof vehicleFieldOrder)[number], string>> & {
  uncertainFields?: string[];
};

export type IntakeItem = {
  id: string;
  draft: IntakeDraft;
  errors: string[];
  match: { status: "new" | "existing" | "conflict"; vehicle?: { id: string } };
  sourceExcerpt?: string;
};

export type IntakeBatch = {
  id: string;
  method: "bulk" | "single" | "scan" | "manual";
  vehicleCount: number;
  status: "pending" | "confirmed";
  createdAt: string;
};


export function computeDaysOpen(v: VehicleRecord) {
  return Math.max(0, Math.floor((Date.now() - new Date(v.createdAt).getTime()) / 86400000));
}


export function filterVehicles(list: VehicleRecord[], filter: string, events: VehicleEvent[] = []) {
  switch (filter) {
    case "processing":
      return list.filter((v) => v.status === "Processing");
    case "overdue":
      return list.filter((v) => computeDaysOpen(v) >= 40);
    case "history":
      return list.filter((v) =>
        events.some((e) => e.vehicleId === v.id && ["COMPLETION_SUBMITTED", "COMPLETION_APPROVED"].includes(e.action))
      );
    case "awaitingArrival":
      return list.filter((v) => ["Picked Up", "Awaiting Transport", "In Transit"].includes(v.status));
    case "readyForProcessing":
      return list.filter((v) => v.status === "Ready for Processing");
    case "needsAttention":
      return list.filter((v) => !v.vin || !v.lotNumber);
    case "completedToday":
      return list.filter((v) => v.status === "Ready for Processing" && computeDaysOpen(v) === 0);
    case "all":
      return list;
    case "active":
    default:
      return list.filter((v) => v.status !== "Processing");
  }
}

