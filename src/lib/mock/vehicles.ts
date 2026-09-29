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
  },
];

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
  | "DISPOSITION";

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
