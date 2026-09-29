import type { VehicleRecord } from "@/lib/mock/vehicles";
import { vehicleFieldOrder } from "@/lib/mock/vehicles";
import type { IntakeMethod } from "@/components/vehicles/vehicle-workspace";
import type { IntakeItem } from "@/lib/mock/vehicles";

const knownMakes = [
  "Ford",
  "Chevrolet",
  "Toyota",
  "Honda",
  "Nissan",
  "Jeep",
  "BMW",
  "Tesla",
  "Hyundai",
  "Kia",
  "Dodge",
  "GMC",
  "Mercedes-Benz",
  "Audi",
  "Subaru",
  "Lexus",
  "Mazda",
  "Volkswagen",
];

function parseLine(line: string, index: number): IntakeItem["draft"] {
  const draft: Record<string, string> = {};
  const uncertain: string[] = [];

  const vinMatch = line.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i);
  draft.vin = vinMatch?.[0]?.toUpperCase() || "";
  if (!draft.vin) uncertain.push("vin");

  const lotMatch = line.match(/lot\s*#?\s*([A-Z0-9-]{5,})/i) || line.match(/\b\d{7,9}\b/);
  draft.lotNumber = lotMatch ? lotMatch[1] || lotMatch[0] : "";
  if (!draft.lotNumber) uncertain.push("lotNumber");

  const yearMatch = line.match(/\b(19|20)\d{2}\b/);
  draft.year = yearMatch?.[0] || "";
  if (!draft.year) uncertain.push("year");

  const makeMatch = knownMakes.find((m) => new RegExp(`\\b${m}\\b`, "i").test(line));
  draft.make = makeMatch || "";
  if (makeMatch) {
    const after = line.slice(line.toLowerCase().indexOf(makeMatch.toLowerCase()) + makeMatch.length).trim();
    draft.model = after.split(/[\s,·-]+/).filter(Boolean)[0] || "";
  } else {
    draft.model = "";
  }
  if (!draft.make) uncertain.push("make");
  if (!draft.model) uncertain.push("model");

  const mileageMatch = line.match(/\b(\d{2,3}[, ]?\d{3})\s*(mi|miles)?\b/i);
  draft.mileage = mileageMatch ? mileageMatch[1].replace(/[, ]/g, "") : "";
  if (!draft.mileage) uncertain.push("mileage");

  const priceMatch = line.match(/\$\s?([\d,]+)/);
  draft.purchasePrice = priceMatch ? priceMatch[1].replace(/,/g, "") : "";
  if (!draft.purchasePrice) uncertain.push("purchasePrice");

  for (const key of vehicleFieldOrder) {
    if (!(key in draft)) {
      draft[key] = "";
      if (!["auctionItemNumber", "trim", "engine", "damageInfo", "transportInfo", "pickupPin", "pickupStatus", "pickupDeadline", "invoiceAmount", "balanceDue", "auctionFees", "transportationCost", "saleDate"].includes(key)) {
        uncertain.push(key);
      }
    }
  }
  draft.auctionSource = draft.auctionSource || "Copart";
  draft.mileageStatus = draft.mileageStatus || "Unknown";
  draft.titleStatus = draft.titleStatus || "Pending";
  draft.location = draft.location || "LAL Motors Yard";
  draft.stockNumber = draft.stockNumber || `ST-PEND-${index + 1}`;

  return { ...draft, uncertainFields: uncertain };
}

function scanCannedItem(): IntakeItem["draft"] {
  return {
    auctionSource: "Copart",
    vin: "5FNRL6H50CB405213",
    lotNumber: "48930215",
    stockNumber: "ST-PEND-1",
    auctionItemNumber: "",
    year: "2018",
    make: "Honda",
    model: "Odyssey",
    trim: "",
    engine: "",
    mileage: "96500",
    mileageStatus: "Actual",
    titleStatus: "Pending",
    location: "LAL Motors Yard",
    purchasePrice: "4300",
    invoiceAmount: "",
    balanceDue: "",
    auctionFees: "",
    transportationCost: "",
    saleDate: new Date().toISOString().slice(0, 10),
    pickupPin: "",
    pickupStatus: "",
    pickupDeadline: "",
    damageInfo: "",
    transportInfo: "",
    uncertainFields: ["trim", "engine", "invoiceAmount", "balanceDue", "auctionFees", "transportationCost"],
  };
}

export function buildIntakeItems(
  method: IntakeMethod,
  sourceText: string,
  existingVehicles: VehicleRecord[]
): IntakeItem[] {
  let drafts: IntakeItem["draft"][] = [];

  if (method === "manual") {
    try {
      const parsed = JSON.parse(sourceText) as Record<string, string>;
      drafts = [{ ...parsed, uncertainFields: [] }];
    } catch {
      drafts = [parseLine(sourceText, 0)];
    }
  } else if (method === "scan") {
    drafts = [scanCannedItem()];
  } else if (method === "single") {
    drafts = [parseLine(sourceText, 0)];
  } else {
    const lines = sourceText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    drafts = (lines.length ? lines : [sourceText]).map(parseLine);
  }

  return drafts.map((draft, i) => {
    const match = existingVehicles.find(
      (v) =>
        (draft.vin && v.vin && v.vin.toUpperCase() === draft.vin.toUpperCase()) ||
        (draft.lotNumber && v.lotNumber && v.lotNumber === draft.lotNumber)
    );
    const errors: string[] = [];
    if (!draft.year || !draft.make || !draft.model) errors.push("Year, make and model need review before confirming");

    return {
      id: `item-${Date.now()}-${i}`,
      draft,
      errors,
      match: match ? { status: "existing", vehicle: { id: match.id } } : { status: "new" },
      sourceExcerpt:
        method === "scan"
          ? "Read from uploaded photo (AI preview only in this UI phase)"
          : sourceText.slice(0, 240) || "Manual entry",
    } satisfies IntakeItem;
  });
}
