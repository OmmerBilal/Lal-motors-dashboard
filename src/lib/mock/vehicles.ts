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

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

export const vehicles: VehicleRecord[] = [
  {
    id: "veh-1001",
    auctionSource: "Copart",
    vin: "1FTFW1ET5DFC10312",
    lotNumber: "48213077",
    stockNumber: "ST-1001",
    auctionItemNumber: "A-9928",
    year: "2018",
    make: "Ford",
    model: "F-150",
    trim: "XLT",
    engine: "3.5L V6",
    mileage: "112400",
    mileageStatus: "Actual",
    titleStatus: "Salvage",
    location: "LAL Motors Yard",
    purchasePrice: "6200",
    invoiceAmount: "6450",
    balanceDue: "0",
    auctionFees: "480",
    transportationCost: "375",
    saleDate: daysAgo(46).slice(0, 10),
    pickupPin: "5521",
    pickupStatus: "Picked up",
    pickupDeadline: daysAgo(40).slice(0, 10),
    damageInfo: "Front end collision",
    transportInfo: "Assigned to Southeast Auto Transport",
    status: "Processing",
    assignedId: "u-yard",
    assignedName: "Tyler Brooks",
    arrivalDate: daysAgo(41).slice(0, 10),
    createdAt: daysAgo(46),
    unverifiedFields: [],
    pickupLocationName: "Copart - Atlanta, GA",
    pickupAddress: "3850 Highway 41 S, Atlanta, GA 30349",
    transportStatus: "ARRIVED",
    transportPrice: "375",
    carrierId: "car-1",
    carrierName: "Southeast Auto Transport",
    transportProblem: null,
    closedReason: null,
    closedNote: null,
    receivingStatus: "received",
    receivedBy: "Tyler Brooks",
    receivedAt: daysAgo(41).slice(0, 10),
    arrivalPhotos: [],
  },
  {
    id: "veh-1002",
    auctionSource: "IAA",
    vin: "3GNAXUEV5LL118842",
    lotNumber: "77120094",
    stockNumber: "ST-1002",
    auctionItemNumber: "",
    year: "2020",
    make: "Chevrolet",
    model: "Equinox",
    trim: "LT",
    engine: "1.5L I4",
    mileage: "58200",
    mileageStatus: "Actual",
    titleStatus: "Clean",
    location: "LAL Motors Yard",
    purchasePrice: "8900",
    invoiceAmount: "9120",
    balanceDue: "0",
    auctionFees: "560",
    transportationCost: "410",
    saleDate: daysAgo(12).slice(0, 10),
    pickupPin: "",
    pickupStatus: "Awaiting pickup",
    pickupDeadline: daysAgo(-2).slice(0, 10),
    damageInfo: "Rear end damage",
    transportInfo: "",
    status: "Awaiting Pickup",
    assignedId: "u-auction",
    assignedName: "Carlos Mendez",
    arrivalDate: null,
    createdAt: daysAgo(12),
    unverifiedFields: ["pickupPin"],
    pickupLocationName: "IAA - Orlando, FL",
    pickupAddress: "5900 Cargo Rd, Orlando, FL 32824",
    transportStatus: "ASSIGNED",
    transportPrice: "410",
    carrierId: "car-2",
    carrierName: "Interstate Carriers LLC",
    transportProblem: null,
    closedReason: null,
    closedNote: null,
    receivingStatus: "not_received",
    receivedBy: null,
    receivedAt: null,
    arrivalPhotos: [],
  },
  {
    id: "veh-1003",
    auctionSource: "Copart",
    vin: "2T1BURHE0JC014477",
    lotNumber: "51882201",
    stockNumber: "ST-1003",
    auctionItemNumber: "A-9955",
    year: "2019",
    make: "Toyota",
    model: "Corolla",
    trim: "LE",
    engine: "1.8L I4",
    mileage: "89100",
    mileageStatus: "Actual",
    titleStatus: "Rebuilt",
    location: "LAL Motors Yard",
    purchasePrice: "5400",
    invoiceAmount: "5600",
    balanceDue: "0",
    auctionFees: "410",
    transportationCost: "300",
    saleDate: daysAgo(3).slice(0, 10),
    pickupPin: "8834",
    pickupStatus: "In transit",
    pickupDeadline: daysAgo(-5).slice(0, 10),
    damageInfo: "Side impact",
    transportInfo: "Carrier dispatched via Central Dispatch",
    status: "In Transit",
    assignedId: "u-auction",
    assignedName: "Carlos Mendez",
    arrivalDate: null,
    createdAt: daysAgo(3),
    unverifiedFields: [],
    pickupLocationName: "Copart - Savannah, GA",
    pickupAddress: "410 Cargo Loop, Savannah, GA 31408",
    transportStatus: "IN_TRANSIT",
    transportPrice: "300",
    carrierId: "car-2",
    carrierName: "Interstate Carriers LLC",
    transportProblem: null,
    closedReason: null,
    closedNote: null,
    receivingStatus: "not_received",
    receivedBy: null,
    receivedAt: null,
    arrivalPhotos: [],
  },
  {
    id: "veh-1004",
    auctionSource: "Copart",
    vin: "1HGCV1F34LA012933",
    lotNumber: "48311209",
    stockNumber: "ST-1004",
    auctionItemNumber: "",
    year: "2021",
    make: "Honda",
    model: "Accord",
    trim: "Sport",
    engine: "1.5L Turbo",
    mileage: "41200",
    mileageStatus: "Actual",
    titleStatus: "Salvage",
    location: "LAL Motors Yard",
    purchasePrice: "10800",
    invoiceAmount: "11050",
    balanceDue: "0",
    auctionFees: "610",
    transportationCost: "395",
    saleDate: daysAgo(60).slice(0, 10),
    pickupPin: "4471",
    pickupStatus: "Picked up",
    pickupDeadline: daysAgo(52).slice(0, 10),
    damageInfo: "Hail damage",
    transportInfo: "",
    status: "Ready for Processing",
    assignedId: "u-yard",
    assignedName: "Tyler Brooks",
    arrivalDate: daysAgo(50).slice(0, 10),
    createdAt: daysAgo(60),
    unverifiedFields: [],
    pickupLocationName: "Copart - Jacksonville, FL",
    pickupAddress: "9700 Pritchard Rd, Jacksonville, FL 32219",
    transportStatus: "ARRIVED",
    transportPrice: "395",
    carrierId: null,
    carrierName: "Self Pickup",
    transportProblem: null,
    closedReason: null,
    closedNote: null,
    receivingStatus: "received",
    receivedBy: "Tyler Brooks",
    receivedAt: daysAgo(50).slice(0, 10),
    arrivalPhotos: [],
  },
  {
    id: "veh-1005",
    auctionSource: "Manheim",
    vin: "",
    lotNumber: "",
    stockNumber: "ST-1005",
    auctionItemNumber: "",
    year: "2017",
    make: "Nissan",
    model: "Altima",
    trim: "SV",
    engine: "2.5L I4",
    mileage: "",
    mileageStatus: "Unknown",
    titleStatus: "Pending",
    location: "LAL Motors Yard",
    purchasePrice: "3100",
    invoiceAmount: "",
    balanceDue: "",
    auctionFees: "",
    transportationCost: "",
    saleDate: daysAgo(1).slice(0, 10),
    pickupPin: "",
    pickupStatus: "",
    pickupDeadline: "",
    damageInfo: "",
    transportInfo: "",
    status: "Purchased",
    assignedId: null,
    assignedName: null,
    arrivalDate: null,
    createdAt: daysAgo(1),
    unverifiedFields: ["vin", "lotNumber", "mileage", "invoiceAmount", "balanceDue", "auctionFees"],
    pickupLocationName: "Manheim - Atlanta, GA",
    pickupAddress: "6789 Jonesboro Rd, Atlanta, GA 30315",
    transportStatus: "NEED_TRANSPORT",
    transportPrice: "",
    carrierId: null,
    carrierName: null,
    transportProblem: null,
    closedReason: null,
    closedNote: null,
    receivingStatus: "not_received",
    receivedBy: null,
    receivedAt: null,
    arrivalPhotos: [],
  },
  {
    id: "veh-1006",
    auctionSource: "Copart",
    vin: "5YJ3E1EA7KF317654",
    lotNumber: "48401877",
    stockNumber: "ST-1006",
    auctionItemNumber: "A-9980",
    year: "2019",
    make: "Tesla",
    model: "Model 3",
    trim: "Standard Range",
    engine: "Electric",
    mileage: "38900",
    mileageStatus: "Actual",
    titleStatus: "Salvage",
    location: "LAL Motors Yard",
    purchasePrice: "14200",
    invoiceAmount: "14550",
    balanceDue: "0",
    auctionFees: "720",
    transportationCost: "460",
    saleDate: daysAgo(90).slice(0, 10),
    pickupPin: "1290",
    pickupStatus: "Picked up",
    pickupDeadline: daysAgo(83).slice(0, 10),
    damageInfo: "Battery pack flagged",
    transportInfo: "",
    status: "Processing",
    assignedId: "u-yard",
    assignedName: "Tyler Brooks",
    arrivalDate: daysAgo(81).slice(0, 10),
    createdAt: daysAgo(90),
    unverifiedFields: [],
    pickupLocationName: "Copart - Tampa, FL",
    pickupAddress: "5220 Orient Rd, Tampa, FL 33578",
    transportStatus: "ARRIVED",
    transportPrice: "460",
    carrierId: "car-1",
    carrierName: "Southeast Auto Transport",
    transportProblem: null,
    closedReason: null,
    closedNote: null,
    receivingStatus: "received",
    receivedBy: "Tyler Brooks",
    receivedAt: daysAgo(81).slice(0, 10),
    arrivalPhotos: [],
  },
  {
    id: "veh-1007",
    auctionSource: "IAA",
    vin: "1C4RJFAG9GC412903",
    lotNumber: "77209341",
    stockNumber: "ST-1007",
    auctionItemNumber: "",
    year: "2016",
    make: "Jeep",
    model: "Grand Cherokee",
    trim: "Limited",
    engine: "3.6L V6",
    mileage: "134700",
    mileageStatus: "Actual",
    titleStatus: "Salvage",
    location: "LAL Motors Yard",
    purchasePrice: "4700",
    invoiceAmount: "4900",
    balanceDue: "0",
    auctionFees: "390",
    transportationCost: "340",
    saleDate: daysAgo(28).slice(0, 10),
    pickupPin: "6602",
    pickupStatus: "Picked up",
    pickupDeadline: daysAgo(21).slice(0, 10),
    damageInfo: "Mechanical / engine",
    transportInfo: "",
    status: "Available at Yard",
    assignedId: "u-yard",
    assignedName: "Tyler Brooks",
    arrivalDate: daysAgo(20).slice(0, 10),
    createdAt: daysAgo(28),
    unverifiedFields: [],
    pickupLocationName: "IAA - Jacksonville, FL",
    pickupAddress: "11985 New Kings Rd, Jacksonville, FL 32254",
    transportStatus: "ARRIVED",
    transportPrice: "340",
    carrierId: null,
    carrierName: "A1 Transport",
    transportProblem: null,
    closedReason: null,
    closedNote: null,
    receivingStatus: "received",
    receivedBy: "Tyler Brooks",
    receivedAt: daysAgo(20).slice(0, 10),
    arrivalPhotos: [],
  },
  {
    id: "veh-1008",
    auctionSource: "Copart",
    vin: "WBAJA5C5XJWC12456",
    lotNumber: "48522190",
    stockNumber: "ST-1008",
    auctionItemNumber: "A-9994",
    year: "2015",
    make: "BMW",
    model: "5 Series",
    trim: "528i",
    engine: "2.0L Turbo",
    mileage: "101300",
    mileageStatus: "Actual",
    titleStatus: "Rebuilt",
    location: "LAL Motors Yard",
    purchasePrice: "5100",
    invoiceAmount: "5300",
    balanceDue: "0",
    auctionFees: "400",
    transportationCost: "320",
    saleDate: daysAgo(52).slice(0, 10),
    pickupPin: "3391",
    pickupStatus: "Picked up",
    pickupDeadline: daysAgo(45).slice(0, 10),
    damageInfo: "All over",
    transportInfo: "",
    status: "Processing",
    assignedId: "u-yard",
    assignedName: "Tyler Brooks",
    arrivalDate: daysAgo(44).slice(0, 10),
    createdAt: daysAgo(52),
    unverifiedFields: [],
    pickupLocationName: "Copart - Atlanta, GA",
    pickupAddress: "3850 Highway 41 S, Atlanta, GA 30349",
    transportStatus: "ARRIVED",
    transportPrice: "320",
    carrierId: "car-1",
    carrierName: "Southeast Auto Transport",
    transportProblem: null,
    closedReason: null,
    closedNote: null,
    receivingStatus: "received",
    receivedBy: "Tyler Brooks",
    receivedAt: daysAgo(44).slice(0, 10),
    arrivalPhotos: [],
  },
];

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

export const carriers: Carrier[] = [
  {
    id: "car-1",
    company: "Southeast Auto Transport",
    driver: "Mike Alvarez",
    phone: "(904) 555-0142",
    email: "dispatch@setransport.com",
    address: "1220 Freight Rd, Jacksonville, FL",
    mcDot: "MC-882140",
    notes: "Reliable, prefers morning pickups.",
    active: true,
  },
  {
    id: "car-2",
    company: "Interstate Carriers LLC",
    driver: "Dana Price",
    phone: "(912) 555-0199",
    email: "",
    address: "",
    mcDot: "MC-441098",
    notes: "",
    active: true,
  },
];

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
  | "ISSUE_FLAGGED";

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

export const vehicleEvents: VehicleEvent[] = [
  {
    id: "evt-1",
    vehicleId: "veh-1001",
    action: "START",
    actorId: "u-yard",
    actorName: "Tyler Brooks",
    createdAt: daysAgo(40),
    note: "Started dismantling",
  },
  {
    id: "evt-2",
    vehicleId: "veh-1001",
    action: "PART_REMOVED",
    actorId: "u-yard",
    actorName: "Tyler Brooks",
    createdAt: daysAgo(39),
    partType: "Catalytic converter",
    highValue: true,
    disposition: "IN INVENTORY",
    hasPhoto: true,
    partId: "PT-5510",
  },
  {
    id: "evt-3",
    vehicleId: "veh-1001",
    action: "PART_REMOVED",
    actorId: "u-yard",
    actorName: "Tyler Brooks",
    createdAt: daysAgo(38),
    partType: "Alternator",
    highValue: false,
    hasPhoto: true,
    partId: "PT-5522",
  },
  {
    id: "evt-4",
    vehicleId: "veh-1006",
    action: "START",
    actorId: "u-yard",
    actorName: "Tyler Brooks",
    createdAt: daysAgo(80),
  },
  {
    id: "evt-5",
    vehicleId: "veh-1006",
    action: "PART_REMOVED",
    actorId: "u-yard",
    actorName: "Tyler Brooks",
    createdAt: daysAgo(79),
    partType: "Battery module",
    highValue: true,
    hasPhoto: true,
    partId: "PT-5490",
  },
  {
    id: "evt-6",
    vehicleId: "veh-1008",
    action: "START",
    actorId: "u-yard",
    actorName: "Tyler Brooks",
    createdAt: daysAgo(43),
  },
  {
    id: "evt-7",
    vehicleId: "veh-1002",
    action: "STATUS",
    actorId: "u-auction",
    actorName: "Carlos Mendez",
    createdAt: daysAgo(11),
    status: "Awaiting Pickup",
  },
  {
    id: "evt-8",
    vehicleId: "veh-1003",
    action: "STATUS",
    actorId: "u-auction",
    actorName: "Carlos Mendez",
    createdAt: daysAgo(2),
    status: "In Transit",
  },
  {
    id: "evt-9",
    vehicleId: "veh-1004",
    action: "COMPLETION_SUBMITTED",
    actorId: "u-yard",
    actorName: "Tyler Brooks",
    createdAt: daysAgo(1),
    hasPhoto: true,
    note: "Vehicle finished, ready for review",
  },
];

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

export const completionQueue: CompletionSubmission[] = [
  {
    submissionId: "sub-1",
    vehicleId: "veh-1004",
    employeeName: "Tyler Brooks",
    submittedAt: daysAgo(1),
    vin: "1HGCV1F34LA012933",
    lotNumber: "48311209",
    stockNumber: "ST-1004",
    year: "2021",
    make: "Honda",
    model: "Accord",
    partCount: 6,
    converterCount: 1,
    custodyExceptions: 0,
    note: "All parts logged, converter tagged high value.",
  },
  {
    submissionId: "sub-2",
    vehicleId: "veh-1007",
    employeeName: "Tyler Brooks",
    submittedAt: daysAgo(4),
    vin: "1C4RJFAG9GC412903",
    lotNumber: "77209341",
    stockNumber: "ST-1007",
    year: "2016",
    make: "Jeep",
    model: "Grand Cherokee",
    partCount: 4,
    converterCount: 1,
    custodyExceptions: 1,
    note: "Photo not scanned yet. Compare it directly or select AI photo check.",
  },
];

export type YardCorrection = {
  submissionId: string;
  vehicleId: string;
  lotNumber: string;
  year: string;
  make: string;
  model: string;
  reason: string;
};

export const yardCorrections: YardCorrection[] = [
  {
    submissionId: "sub-3",
    vehicleId: "veh-1008",
    lotNumber: "48522190",
    year: "2015",
    make: "BMW",
    model: "5 Series",
    reason: "VIN in photo did not match record",
  },
];

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

export const intakeBatches: IntakeBatch[] = [
  { id: "batch-1", method: "bulk", vehicleCount: 3, status: "pending", createdAt: daysAgo(2) },
  { id: "batch-2", method: "scan", vehicleCount: 1, status: "pending", createdAt: daysAgo(1) },
];

export function computeDaysOpen(v: VehicleRecord) {
  return Math.max(0, Math.floor((Date.now() - new Date(v.createdAt).getTime()) / 86400000));
}

export function computeStats(
  list: VehicleRecord[],
  role: string,
  events: VehicleEvent[] = vehicleEvents,
  pendingCompletions: number = completionQueue.length,
  openCorrections: number = yardCorrections.length
): Record<string, number> {
  const active = list.filter((v) => !["Processing"].includes(v.status) && v.status !== "Sold").length;
  const processing = list.filter((v) => v.status === "Processing").length;
  const overdue = list.filter((v) => computeDaysOpen(v) >= 40).length;
  const awaitingArrival = list.filter((v) =>
    ["Picked Up", "Awaiting Transport", "In Transit"].includes(v.status)
  ).length;
  const readyForProcessing = list.filter((v) => v.status === "Ready for Processing").length;
  const needsAttention = list.filter((v) => !v.vin || !v.lotNumber).length;
  const completedToday = list.filter(
    (v) => v.status === "Ready for Processing" && computeDaysOpen(v) === 0
  ).length;
  const partsRemoved = events.filter((e) => e.action === "PART_REMOVED").length;
  const converters = events.filter(
    (e) => e.action === "PART_REMOVED" && e.partType?.toLowerCase().includes("converter")
  ).length;
  const highValue = events.filter((e) => e.action === "PART_REMOVED" && e.highValue).length;
  const exceptions = openCorrections;

  if (role === "yard") return { active, processing };
  if (role === "auction")
    return {
      total: list.length,
      active,
      awaitingArrival,
      readyForProcessing,
      processing,
      completionWaiting: pendingCompletions,
      completedToday,
      needsAttention,
      overdue,
    };
  return {
    total: list.length,
    active,
    processing,
    completed_week: 3,
    completed_month: 11,
    overdue,
    partsRemoved,
    converters,
    highValue,
    exceptions,
  };
}

export function filterVehicles(list: VehicleRecord[], filter: string, events: VehicleEvent[] = vehicleEvents) {
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

export const statMetricLabels: Record<string, string> = {
  completionWaiting: "Waiting for completion review",
  awaitingArrival: "Awaiting arrival",
  readyForProcessing: "Ready for processing",
  completedToday: "Completed today",
  needsAttention: "Missing VIN / Lot",
  total: "Total vehicles",
  active: "Active vehicles",
  processing: "Processing",
  completed_week: "Completed this week",
  completed_month: "Completed this month",
  overdue: "Vehicles 40+ days",
  partsRemoved: "Parts removed",
  converters: "Catalytic converters",
  highValue: "High-value parts",
  exceptions: "Custody exceptions",
};
