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

export type PartPhoto = { id: string; type: "capture" | "source" | "final" };

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
];
