export const partFieldOrder = [
  "sourceVin",
  "sourceLot",
  "partName",
  "category",
  "partNumber",
  "sideLocation",
  "condition",
  "fitment",
  "fitmentStatus",
  "title",
  "description",
  "keywords",
  "price",
  "location",
] as const;

export type PartFieldKey = (typeof partFieldOrder)[number];

export const partFieldLabels: Record<PartFieldKey, string> = {
  sourceVin: "Source VIN",
  sourceLot: "Source Lot #",
  partName: "Part name",
  category: "Category",
  partNumber: "Part / OEM number",
  sideLocation: "Side / location",
  condition: "Condition",
  fitment: "Fitment / interchange",
  fitmentStatus: "Fitment status",
  title: "Inventory title",
  description: "Description",
  keywords: "Searchable keywords",
  price: "Price",
  location: "Storage location",
};

export type PartStatus = "captured" | "draft_ready" | "manager_review" | "approved";

export type PartDraft = Partial<Record<PartFieldKey, string>> & { needsReview?: string[] };

export type PartPhoto = { id: string; type: "capture" | "source" | "final"; url?: string };

/** Parts Inventory processing lifecycle (post-approval). Independent of the old pre-inventory
 * capture/draft/review PartStatus pipeline above — a part reaches Parts Inventory with
 * status "approved" (either through that old pipeline, or auto-sourced from an approved
 * Dismantling removal) and then moves through this stage machine. */
export type PartStage = "needs_processing" | "in_processing" | "ready_for_sale" | "not_sellable";

export const partStageLabels: Record<PartStage, string> = {
  needs_processing: "Needs Processing",
  in_processing: "In Processing",
  ready_for_sale: "Ready for Sale",
  not_sellable: "Not Sellable",
};

export type TestStatus = "Not Tested" | "Tested" | "Failed";
export const testStatusOptions: TestStatus[] = ["Not Tested", "Tested", "Failed"];

export const partConditionOptions = ["Excellent", "Good", "Fair", "Damaged"] as const;

export const saleChannelOptions = ["In-Store", "eBay", "Export"] as const;

export const notSellableReasons = [
  "Damaged beyond use",
  "Recalled part",
  "Lost / missing",
  "Quality hold",
  "Other",
] as const;

export type PartDonorInfo = {
  vehicleId: string;
  vin: string;
  stockNumber: string;
  year: string;
  make: string;
  model: string;
  engine?: string;
  yardLocation?: string;
  employeeId: string;
  employeeName: string;
  dismantlingEventId: string;
  approvedAt: string;
};

export type PartNotSellable = {
  reason: string;
  notes?: string;
  markedBy: string;
  markedAt: string;
};

export type PartHistoryEntry = {
  id: string;
  actionType: string;
  previousLocation: string | null;
  newLocation: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  previousQuantity: number | null;
  newQuantity: number | null;
  userName: string;
  createdAt: string;
  note?: string;
};

export type PartLog = { action: string; userName: string; createdAt: string; summary: string };

export type PartRecord = {
  id: string;
  status: PartStatus;
  capturedByName: string;
  createdAt: string;
  photos: PartPhoto[];
  draft: PartDraft;
  stockSku: string | null;
  operationalStatus: string;
  quantity: number;
  zone: string;
  rack: string;
  shelf: string;
  bin: string;
  history: PartHistoryEntry[];
  logs: PartLog[];
  stage: PartStage;
  partCode: string;
  donor?: PartDonorInfo | null;
  partNotes?: string;
  testStatus?: TestStatus;
  testNotes?: string;
  coreCharge?: string;
  hasCoreCharge?: boolean;
  saleChannels?: string[];
  notSellable?: PartNotSellable | null;
};

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

export const operationalStatusOptions = ["AVAILABLE", "RESERVED", "SOLD", "DAMAGED", "RETURNED", "MISSING"];

export function formatPartLocation(p: PartRecord): string {
  const segments = [
    ["Zone", p.zone],
    ["Rack", p.rack],
    ["Shelf", p.shelf],
    ["Bin", p.bin],
  ].filter(([, v]) => v);
  return segments.length ? segments.map(([k, v]) => `${k} ${v}`).join(" / ") : "Location not assigned";
}

export function generateAiDraft(): PartDraft {
  return {
    sourceVin: "",
    sourceLot: "",
    partName: "Unidentified part",
    category: "Uncategorized",
    partNumber: "",
    sideLocation: "",
    condition: "Used",
    fitment: "FITMENT VERIFICATION REQUIRED",
    fitmentStatus: "verification_required",
    title: "Untitled part — needs manager review",
    description: "AI could not confidently identify this part from the evidence photos.",
    keywords: "",
    price: "0",
    location: "Parts Inventory",
    needsReview: ["partName", "category", "partNumber", "fitment", "title", "description", "keywords", "price"],
  };
}

export const parts: PartRecord[] = [
  {
    id: "part-1",
    stage: "needs_processing",
    partCode: "PC-1001",
    status: "captured",
    capturedByName: "Jamal Reeves",
    createdAt: daysAgo(1),
    photos: [
      { id: "p1a", type: "capture" },
      { id: "p1b", type: "source" },
    ],
    draft: {},
    stockSku: null,
    operationalStatus: "AVAILABLE",
    quantity: 1,
    zone: "",
    rack: "",
    shelf: "",
    bin: "",
    history: [],
    logs: [{ action: "CAPTURED", userName: "Jamal Reeves", createdAt: daysAgo(1), summary: "Part and source photos linked" }],
  },
  {
    id: "part-2",
    stage: "needs_processing",
    partCode: "PC-1002",
    status: "captured",
    capturedByName: "Jamal Reeves",
    createdAt: daysAgo(1),
    photos: [
      { id: "p2a", type: "capture" },
      { id: "p2b", type: "source" },
    ],
    draft: {},
    stockSku: null,
    operationalStatus: "AVAILABLE",
    quantity: 1,
    zone: "",
    rack: "",
    shelf: "",
    bin: "",
    history: [],
    logs: [{ action: "CAPTURED", userName: "Jamal Reeves", createdAt: daysAgo(1), summary: "Part and source photos linked" }],
  },
  {
    id: "part-3",
    stage: "needs_processing",
    partCode: "PC-1003",
    status: "draft_ready",
    capturedByName: "Jamal Reeves",
    createdAt: daysAgo(3),
    photos: [
      { id: "p3a", type: "capture" },
      { id: "p3b", type: "source" },
    ],
    draft: {
      sourceVin: "1FTFW1ET5DFC10312",
      partName: "Alternator",
      category: "Electrical",
      partNumber: "AL-2891",
      sideLocation: "Driver side",
      condition: "Used",
      fitment: "FITMENT VERIFICATION REQUIRED",
      fitmentStatus: "verification_required",
      title: "2018 Ford F-150 Alternator",
      description: "Tested working alternator pulled from a 2018 F-150 XLT.",
      keywords: "ford f150 alternator electrical",
      price: "85",
      location: "Parts Inventory",
      needsReview: ["fitment"],
    },
    stockSku: null,
    operationalStatus: "AVAILABLE",
    quantity: 1,
    zone: "",
    rack: "",
    shelf: "",
    bin: "",
    history: [],
    logs: [
      { action: "CAPTURED", userName: "Jamal Reeves", createdAt: daysAgo(3), summary: "Part and source photos linked" },
      { action: "AI_DRAFTED", userName: "Denise Ford", createdAt: daysAgo(2), summary: "AI draft generated from evidence" },
    ],
  },
  {
    id: "part-4",
    stage: "needs_processing",
    partCode: "PC-1004",
    status: "manager_review",
    capturedByName: "Jamal Reeves",
    createdAt: daysAgo(4),
    photos: [
      { id: "p4a", type: "capture" },
      { id: "p4b", type: "source" },
    ],
    draft: {
      sourceVin: "3GNAXUEV5LL118842",
      partName: "Headlight assembly",
      category: "Lighting",
      partNumber: "HL-4471",
      sideLocation: "Passenger side",
      condition: "Used",
      fitment: "FITMENT VERIFICATION REQUIRED",
      fitmentStatus: "verification_required",
      title: "2020 Chevrolet Equinox Headlight Assembly",
      description: "Passenger side headlight, minor scuff on housing.",
      keywords: "chevrolet equinox headlight lighting",
      price: "120",
      location: "Parts Inventory",
      needsReview: [],
    },
    stockSku: null,
    operationalStatus: "AVAILABLE",
    quantity: 1,
    zone: "",
    rack: "",
    shelf: "",
    bin: "",
    history: [],
    logs: [
      { action: "CAPTURED", userName: "Jamal Reeves", createdAt: daysAgo(4), summary: "Part and source photos linked" },
      { action: "AI_DRAFTED", userName: "Denise Ford", createdAt: daysAgo(3), summary: "AI draft generated from evidence" },
      { action: "REVIEW_STARTED", userName: "Denise Ford", createdAt: daysAgo(2), summary: "Manager review started" },
    ],
  },
  {
    id: "part-5",
    stage: "ready_for_sale",
    partCode: "SKU-10045",
    status: "approved",
    capturedByName: "Tyler Brooks",
    createdAt: daysAgo(38),
    photos: [
      { id: "p5a", type: "capture" },
      { id: "p5b", type: "source" },
      { id: "p5c", type: "final" },
    ],
    draft: {
      sourceVin: "1FTFW1ET5DFC10312",
      partName: "Catalytic converter",
      category: "Emissions",
      partNumber: "CC-5510",
      sideLocation: "Underbody",
      condition: "Used",
      fitment: "Fits 2015-2020 Ford F-150 3.5L V6",
      fitmentStatus: "verified",
      title: "2018 Ford F-150 Catalytic Converter",
      description: "OEM catalytic converter, verified fitment for 2015-2020 F-150 3.5L.",
      keywords: "ford f150 catalytic converter emissions",
      price: "410",
      location: "Parts Inventory · Zone C",
      needsReview: [],
    },
    stockSku: "SKU-10045",
    operationalStatus: "AVAILABLE",
    quantity: 1,
    zone: "C",
    rack: "3",
    shelf: "2",
    bin: "B",
    history: [
      {
        id: "h1",
        actionType: "APPROVED",
        previousLocation: null,
        newLocation: "Parts Inventory · Zone C",
        previousStatus: null,
        newStatus: "AVAILABLE",
        previousQuantity: null,
        newQuantity: 1,
        userName: "Denise Ford",
        createdAt: daysAgo(35),
      },
    ],
    logs: [
      { action: "CAPTURED", userName: "Tyler Brooks", createdAt: daysAgo(38), summary: "Part and source photos linked" },
      { action: "AI_DRAFTED", userName: "Denise Ford", createdAt: daysAgo(37), summary: "AI draft generated from evidence" },
      { action: "APPROVED", userName: "Denise Ford", createdAt: daysAgo(35), summary: "Approved to Parts Inventory · SKU-10045" },
    ],
  },
  {
    id: "part-6",
    stage: "ready_for_sale",
    partCode: "SKU-10012",
    status: "approved",
    capturedByName: "Tyler Brooks",
    createdAt: daysAgo(80),
    photos: [
      { id: "p6a", type: "capture" },
      { id: "p6b", type: "source" },
      { id: "p6c", type: "final" },
    ],
    draft: {
      sourceVin: "5YJ3E1EA7KF317654",
      partName: "Battery module",
      category: "Electrical",
      partNumber: "BM-5490",
      sideLocation: "Underbody",
      condition: "Used",
      fitment: "Fits 2018-2020 Tesla Model 3 Standard Range",
      fitmentStatus: "verified",
      title: "2019 Tesla Model 3 Battery Module",
      description: "Tested module pulled from flagged-battery Model 3.",
      keywords: "tesla model 3 battery module ev",
      price: "1450",
      location: "Parts Inventory · Zone A",
      needsReview: [],
    },
    stockSku: "SKU-10012",
    operationalStatus: "RESERVED",
    quantity: 1,
    zone: "A",
    rack: "1",
    shelf: "1",
    bin: "A",
    history: [
      {
        id: "h2",
        actionType: "APPROVED",
        previousLocation: null,
        newLocation: "Parts Inventory · Zone A",
        previousStatus: null,
        newStatus: "AVAILABLE",
        previousQuantity: null,
        newQuantity: 1,
        userName: "Denise Ford",
        createdAt: daysAgo(78),
      },
      {
        id: "h3",
        actionType: "STATUS_CHANGE",
        previousLocation: "Parts Inventory · Zone A",
        newLocation: "Parts Inventory · Zone A",
        previousStatus: "AVAILABLE",
        newStatus: "RESERVED",
        previousQuantity: 1,
        newQuantity: 1,
        userName: "Denise Ford",
        createdAt: daysAgo(10),
        note: "Reserved for quote Q-2291",
      },
    ],
    logs: [
      { action: "CAPTURED", userName: "Tyler Brooks", createdAt: daysAgo(80), summary: "Part and source photos linked" },
      { action: "APPROVED", userName: "Denise Ford", createdAt: daysAgo(78), summary: "Approved to Parts Inventory · SKU-10012" },
    ],
  },
  {
    id: "part-7",
    stage: "ready_for_sale",
    partCode: "SKU-10001",
    status: "approved",
    capturedByName: "Tyler Brooks",
    createdAt: daysAgo(120),
    photos: [
      { id: "p7a", type: "capture" },
      { id: "p7b", type: "source" },
      { id: "p7c", type: "final" },
    ],
    draft: {
      sourceVin: "1GKS1BKC5FR123456",
      partName: "Transmission assembly",
      category: "Drivetrain",
      partNumber: "TR-9981",
      sideLocation: "N/A",
      condition: "Used",
      fitment: "Fits 2015-2017 GMC Yukon 5.3L V8",
      fitmentStatus: "verified",
      title: "2016 GMC Yukon Transmission Assembly",
      description: "Tested, shifts cleanly, verified fitment.",
      keywords: "gmc yukon transmission drivetrain",
      price: "950",
      location: "Parts Inventory · Zone B",
      needsReview: [],
    },
    stockSku: "SKU-10001",
    operationalStatus: "SOLD",
    quantity: 0,
    zone: "B",
    rack: "2",
    shelf: "1",
    bin: "C",
    testStatus: "Tested",
    history: [
      {
        id: "h4",
        actionType: "APPROVED",
        previousLocation: null,
        newLocation: "Parts Inventory · Zone B",
        previousStatus: null,
        newStatus: "AVAILABLE",
        previousQuantity: null,
        newQuantity: 1,
        userName: "Denise Ford",
        createdAt: daysAgo(118),
      },
      {
        id: "h5",
        actionType: "STATUS_CHANGE",
        previousLocation: "Parts Inventory · Zone B",
        newLocation: "Parts Inventory · Zone B",
        previousStatus: "AVAILABLE",
        newStatus: "SOLD",
        previousQuantity: 1,
        newQuantity: 0,
        userName: "Denise Ford",
        createdAt: daysAgo(14),
        note: "Sold via Sales Desk",
      },
    ],
    logs: [
      { action: "CAPTURED", userName: "Tyler Brooks", createdAt: daysAgo(120), summary: "Part and source photos linked" },
      { action: "APPROVED", userName: "Denise Ford", createdAt: daysAgo(118), summary: "Approved to Parts Inventory · SKU-10001" },
      { action: "SOLD", userName: "Denise Ford", createdAt: daysAgo(14), summary: "Marked sold via Sales Desk" },
    ],
  },
  {
    id: "part-8",
    stage: "not_sellable",
    partCode: "SKU-10002",
    status: "approved",
    capturedByName: "Jamal Reeves",
    createdAt: daysAgo(22),
    photos: [
      { id: "p8a", type: "capture" },
      { id: "p8b", type: "source" },
      { id: "p8c", type: "final" },
    ],
    draft: {
      sourceVin: "3VWD07AJ5EM123456",
      partName: "Airbag module",
      category: "Safety",
      partNumber: "AB-7712",
      sideLocation: "Driver side",
      condition: "Used",
      fitment: "Fits 2014-2018 Volkswagen Jetta",
      fitmentStatus: "verified",
      title: "2015 Volkswagen Jetta Airbag Module",
      description: "Pulled from a non-deployed unit.",
      keywords: "volkswagen jetta airbag safety",
      price: "60",
      location: "Parts Inventory · Zone D",
      needsReview: [],
    },
    stockSku: "SKU-10002",
    operationalStatus: "DAMAGED",
    quantity: 1,
    zone: "D",
    rack: "1",
    shelf: "3",
    bin: "A",
    testStatus: "Failed",
    testNotes: "Fault code present on bench test — unsafe to resell.",
    notSellable: {
      reason: "Recalled part",
      notes: "Manufacturer recall bulletin #AB-7712-R1 — hold until destroyed.",
      markedBy: "Denise Ford",
      markedAt: daysAgo(3),
    },
    history: [
      {
        id: "h6",
        actionType: "APPROVED",
        previousLocation: null,
        newLocation: "Parts Inventory · Zone D",
        previousStatus: null,
        newStatus: "AVAILABLE",
        previousQuantity: null,
        newQuantity: 1,
        userName: "Denise Ford",
        createdAt: daysAgo(20),
      },
    ],
    logs: [
      { action: "CAPTURED", userName: "Jamal Reeves", createdAt: daysAgo(22), summary: "Part and source photos linked" },
      { action: "APPROVED", userName: "Denise Ford", createdAt: daysAgo(20), summary: "Approved to Parts Inventory · SKU-10002" },
      { action: "NOT_SELLABLE", userName: "Denise Ford", createdAt: daysAgo(3), summary: "Removed from sellable inventory — Recalled part" },
    ],
  },
  {
    id: "part-9",
    stage: "in_processing",
    partCode: "SKU-10003",
    status: "approved",
    capturedByName: "Tyler Brooks",
    createdAt: daysAgo(2),
    photos: [
      { id: "p9a", type: "capture" },
      { id: "p9b", type: "source" },
    ],
    draft: {
      sourceVin: "1HGCV1F34LA123456",
      partName: "Door assembly — front left",
      category: "Body",
      partNumber: "",
      sideLocation: "Driver side",
      condition: "Used",
      fitment: "FITMENT VERIFICATION REQUIRED",
      fitmentStatus: "verification_required",
      title: "",
      description: "",
      keywords: "",
      price: "",
      location: "",
      needsReview: ["partNumber", "fitment", "title", "price"],
    },
    stockSku: "SKU-10003",
    operationalStatus: "AVAILABLE",
    quantity: 1,
    zone: "C",
    rack: "1",
    shelf: "",
    bin: "",
    testStatus: "Not Tested",
    history: [
      {
        id: "h7",
        actionType: "APPROVED",
        previousLocation: null,
        newLocation: null,
        previousStatus: null,
        newStatus: "AVAILABLE",
        previousQuantity: null,
        newQuantity: 1,
        userName: "Denise Ford",
        createdAt: daysAgo(2),
      },
    ],
    logs: [
      { action: "CAPTURED", userName: "Tyler Brooks", createdAt: daysAgo(2), summary: "Part and source photos linked" },
      { action: "APPROVED", userName: "Denise Ford", createdAt: daysAgo(2), summary: "Approved to Parts Inventory · SKU-10003" },
      { action: "IN_PROCESSING", userName: "Denise Ford", createdAt: daysAgo(1), summary: "Condition & location partially recorded" },
    ],
  },
];
