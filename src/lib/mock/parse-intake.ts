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

// Fields a listing often omits. A missing one of these is ordinary, not a reason to flag the record.
const OPTIONAL_FIELDS = new Set([
  "auctionItemNumber",
  "trim",
  "engine",
  "damageInfo",
  "transportInfo",
  "pickupPin",
  "pickupStatus",
  "pickupDeadline",
  "invoiceAmount",
  "balanceDue",
  "auctionFees",
  "transportationCost",
  "saleDate",
  "mileage",
  "mileageStatus",
  "titleStatus",
  "location",
]);

// Pure separators/labels in the auction site's paste output. A line that, once trimmed, is exactly one of these
// carries no field data by itself and must never become — or be counted as — a vehicle record on its own.
const NOISE_LINES = /^(vehicle image|cost details)$/i;

/** 4 digits, 2012–2029-ish, at the very start of a line: the anchor for a "<year> <make> <model>" title line. */
const TITLE_LINE_RE = /^((?:19|20)\d{2})\s+(.+)$/;
const VEHICLE_IMAGE_RE = /^vehicle image$/i;

// ---------------------------------------------------------------------------------------
// 1. Block segmentation — find the boundary between one vehicle's lines and the next, without assuming every
//    physical line is its own record. Four strategies, tried in order of how much signal they need:
//      a) "Vehicle image" markers, when the paste repeats that label before each listing (the client's format);
//      b) blank-line runs, the ordinary paragraph separator;
//      c) repeated "<year> <word...>" title lines, for a paste with no blank lines and no image marker at all;
//      d) the whole input as one block, when none of the above gives more than one block.
// ---------------------------------------------------------------------------------------
function splitBlocks(sourceText: string): string[][] {
  const rawLines = sourceText.replace(/\r\n?/g, "\n").split("\n");
  const nonEmptyCount = rawLines.filter((l) => l.trim()).length;
  if (nonEmptyCount === 0) return [];

  const markerIdx = rawLines.reduce<number[]>((acc, l, i) => (VEHICLE_IMAGE_RE.test(l.trim()) ? [...acc, i] : acc), []);

  let blocks: string[][];
  if (markerIdx.length >= 1) {
    // (a) Each "Vehicle image" line starts a new block; anything before the first marker is its own leading block
    // (normally empty — e.g. a pasted heading with no vehicle data yet — and gets dropped once noise is stripped).
    const bounds = [0, ...markerIdx, rawLines.length];
    blocks = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const start = i === 0 ? 0 : markerIdx[i - 1];
      const end = bounds[i + 1];
      if (i === 0 && start === markerIdx[0]) continue; // no leading text before the first marker
      blocks.push(rawLines.slice(start, end));
    }
  } else if (/\n[ \t]*\n/.test(rawLines.join("\n"))) {
    // (b) Blank-line-separated paragraphs.
    blocks = sourceText
      .replace(/\r\n?/g, "\n")
      .split(/\n[ \t]*\n+/)
      .map((chunk) => chunk.split("\n"));
  } else {
    // (c) No blank lines anywhere: look for repeated title lines ("<year> <make model...>") as block anchors.
    const titleIdx = rawLines.reduce<number[]>((acc, l, i) => (TITLE_LINE_RE.test(l.trim()) ? [...acc, i] : acc), []);
    if (titleIdx.length >= 2) {
      blocks = titleIdx.map((start, i) => rawLines.slice(start, titleIdx[i + 1] ?? rawLines.length));
    } else {
      // (d) Nothing to anchor on: the whole paste is treated as one block rather than one record per line.
      blocks = [rawLines];
    }
  }

  return blocks
    .map((lines) => lines.map((l) => l.trim()).filter((l) => l && !NOISE_LINES.test(l)))
    .filter((lines) => lines.length > 0);
}

// ---------------------------------------------------------------------------------------
// 2. Field extraction from one block (several lines, order not guaranteed). Each matcher claims whole lines by
//    label or shape; a line nothing recognizes is simply left unclaimed — it does not break the record.
// ---------------------------------------------------------------------------------------
function parseBlock(lines: string[]): IntakeItem["draft"] & { reviewNotes: string[] } {
  const draft: Record<string, string> = {};
  const uncertain = new Set<string>();
  const reviewNotes: string[] = [];
  const claimed = new Set<number>();
  const claim = (i: number) => claimed.add(i);

  // VIN: a labeled line first (most reliable), then a bare line that is exactly a 17-character VIN-alphabet token.
  let vinRaw = "";
  lines.forEach((l, i) => {
    if (claimed.has(i)) return;
    const m = l.match(/^vin:?\s*([A-HJ-NPR-Z0-9]{8,19})\b/i);
    if (m) {
      vinRaw = m[1].toUpperCase();
      claim(i);
    }
  });
  if (!vinRaw) {
    lines.forEach((l, i) => {
      if (claimed.has(i) || vinRaw) return;
      if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(l)) {
        vinRaw = l.toUpperCase();
        claim(i);
      }
    });
  }
  draft.vin = vinRaw;
  if (vinRaw && vinRaw.length !== 17) uncertain.add("vin");

  // Stock #.
  lines.forEach((l, i) => {
    if (claimed.has(i)) return;
    const m = l.match(/^stock\s*#?:?\s*([A-Za-z0-9-]+)/i);
    if (m) {
      draft.stockNumber = m[1];
      claim(i);
    }
  });
  draft.stockNumber ??= "";

  // Lane / lot code, e.g. "A - #25", or a labeled "Lot #: ...".
  lines.forEach((l, i) => {
    if (claimed.has(i) || draft.lotNumber) return;
    const laneMatch = l.match(/^([A-Z])\s*-\s*#?\s*(\d+)/);
    const labeled = l.match(/^lot\s*#?:?\s*([A-Za-z0-9-]+)/i);
    if (laneMatch) {
      draft.lotNumber = l;
      claim(i);
    } else if (labeled) {
      draft.lotNumber = labeled[1];
      claim(i);
    }
  });
  draft.lotNumber ??= "";

  // Auction item # (rarely present; label only — never guessed from a bare number, to avoid colliding with stock/lot).
  lines.forEach((l, i) => {
    if (claimed.has(i)) return;
    const m = l.match(/^(?:auction\s*item\s*#?|item\s*#?):?\s*([A-Za-z0-9-]+)/i);
    if (m) {
      draft.auctionItemNumber = m[1];
      claim(i);
    }
  });
  draft.auctionItemNumber ??= "";

  // Year / make / model: "<year> <rest of the title>".
  lines.forEach((l, i) => {
    if (claimed.has(i) || draft.year) return;
    const m = l.match(TITLE_LINE_RE);
    if (!m) return;
    draft.year = m[1];
    const rest = m[2].trim();
    const makeMatch = knownMakes.find((mk) => new RegExp(`^${mk}\\b`, "i").test(rest));
    if (makeMatch) {
      draft.make = makeMatch;
      draft.model = rest.slice(makeMatch.length).trim();
    } else {
      const [first, ...tail] = rest.split(/\s+/);
      draft.make = first || "";
      draft.model = tail.join(" ");
    }
    claim(i);
  });
  draft.year ??= "";
  draft.make ??= "";
  draft.model ??= "";
  if (!draft.year) uncertain.add("year");
  if (!draft.make) uncertain.add("make");
  if (!draft.model) uncertain.add("model");

  // Mileage: only with an explicit "mi"/"miles" suffix, so a stock, lot or amount is never mistaken for it.
  lines.forEach((l, i) => {
    if (claimed.has(i)) return;
    const m = l.match(/\b((?:\d{1,3}(?:,\d{3})+)|\d{4,6})\s*(?:mi\b|miles\b)/i);
    if (m) {
      draft.mileage = m[1].replace(/,/g, "");
      claim(i);
    }
  });
  draft.mileage ??= "";

  // Title / odometer status and auction source: label or keyword, anywhere in the block.
  lines.forEach((l, i) => {
    if (claimed.has(i)) return;
    const title = l.match(/^title(?:\s*status)?:?\s*(.+)/i);
    if (title) {
      draft.titleStatus = title[1];
      claim(i);
      return;
    }
    const src = l.match(/\b(copart|iaa|manheim)\b/i);
    if (src && !draft.auctionSource) {
      draft.auctionSource = src[1].charAt(0).toUpperCase() + src[1].slice(1).toLowerCase();
      claim(i);
    }
  });
  draft.titleStatus ??= "";
  draft.auctionSource ??= "";
  if (!draft.auctionSource) uncertain.add("auctionSource");

  // Dated / money fields with an explicit label.
  const labeled: [RegExp, keyof typeof draft][] = [
    [/^date won:?\s*(.+)/i, "saleDate"],
    [/^due:?\s*(.+)/i, "__due__" as never],
    [/^pick\s*up\s*by:?\s*(.+)/i, "pickupDeadline"],
  ];
  lines.forEach((l, i) => {
    if (claimed.has(i)) return;
    for (const [re, key] of labeled) {
      const m = l.match(re);
      if (!m) continue;
      if (key === "__due__") {
        // "Due" in these listings is a payment due DATE, not an amount — there is no matching field in the
        // current schema (balanceDue is numeric money, not a date), so it is surfaced for review, not stored.
        reviewNotes.push(`Payment due date "${m[1].trim()}" was found but has no matching field in the current data model.`);
      } else {
        draft[key] = m[1].trim();
      }
      claim(i);
      break;
    }
  });
  draft.saleDate ??= "";
  draft.pickupDeadline ??= "";

  // Winning bid / purchase amount: a line that is (mostly) a dollar figure.
  lines.forEach((l, i) => {
    if (claimed.has(i)) return;
    const m = l.match(/^\$\s?([\d,]+(?:\.\d{2})?)\s*$/);
    if (m) {
      draft.purchasePrice = m[1].replace(/,/g, "");
      claim(i);
    }
  });
  draft.purchasePrice ??= "";
  if (!draft.purchasePrice) uncertain.add("purchasePrice");

  // Pickup PIN: a label, with the value either on the same line or (when the label line ends with nothing) the
  // next unclaimed short line.
  lines.forEach((l, i) => {
    if (claimed.has(i) || draft.pickupPin) return;
    const m = l.match(/^pickup\s*pin:?\s*(.*)$/i);
    if (!m) return;
    claim(i);
    if (m[1].trim()) {
      draft.pickupPin = m[1].trim();
      return;
    }
    const next = lines[i + 1];
    if (next !== undefined && !claimed.has(i + 1) && /^[A-Za-z0-9-]{1,12}$/.test(next)) {
      draft.pickupPin = next;
      claim(i + 1);
    }
  });
  draft.pickupPin ??= "";

  // Whatever is left, in order, is positional: in this auction site's export the branch/location, the sale
  // status (e.g. "Pre-Bid") and the buyer name appear as consecutive unlabeled lines, in that order, between the
  // VIN/stock lines and the dated fields. This is a heuristic for the GIVEN export shape, not a general rule —
  // flagged below so a reviewer can confirm it.
  const leftover = lines.filter((l, i) => !claimed.has(i));
  if (leftover[0]) {
    draft.location = leftover[0];
    uncertain.add("location");
  } else {
    draft.location ??= "";
  }
  if (leftover[1]) {
    draft.pickupStatus = leftover[1];
    uncertain.add("pickupStatus");
  } else {
    draft.pickupStatus ??= "";
  }
  if (leftover[2]) {
    reviewNotes.push(`"${leftover[2]}" was found (likely a buyer name) but there is no buyer field in the current data model.`);
  }
  for (const extra of leftover.slice(3)) {
    reviewNotes.push(`Unrecognized line: "${extra}"`);
  }

  for (const key of vehicleFieldOrder) {
    if (!(key in draft)) {
      draft[key] = "";
      if (!OPTIONAL_FIELDS.has(key)) uncertain.add(key);
    }
  }

  return { ...draft, uncertainFields: [...uncertain], reviewNotes };
}

export function buildIntakeItems(
  method: IntakeMethod,
  sourceText: string,
  existingVehicles: VehicleRecord[]
): IntakeItem[] {
  let drafts: (IntakeItem["draft"] & { reviewNotes?: string[] })[] = [];
  let excerpts: string[] = [];

  if (method === "manual") {
    try {
      const parsed = JSON.parse(sourceText) as Record<string, string>;
      drafts = [{ ...parsed, uncertainFields: [] }];
    } catch {
      const blocks = splitBlocks(sourceText);
      drafts = blocks.length ? blocks.map(parseBlock) : [parseBlock(sourceText.split("\n"))];
    }
    excerpts = [sourceText];
  } else if (method === "scan") {
    drafts = [];
  } else if (method === "single") {
    const blocks = splitBlocks(sourceText);
    drafts = blocks.length ? [parseBlock(blocks[0])] : [parseBlock(sourceText.split("\n"))];
    excerpts = [sourceText];
  } else {
    // Bulk: one or more repeated vehicle blocks, not one record per physical line.
    const blocks = splitBlocks(sourceText);
    drafts = blocks.map(parseBlock);
    excerpts = blocks.map((lines) => lines.join("\n"));
  }

  return drafts.map((draft, i) => {
    const match = existingVehicles.find(
      (v) =>
        (draft.vin && v.vin && v.vin.toUpperCase() === draft.vin.toUpperCase()) ||
        (draft.lotNumber && v.lotNumber && v.lotNumber === draft.lotNumber)
    );
    const errors: string[] = [];
    if (!draft.year || !draft.make || !draft.model) errors.push("Year, make and model need review before confirming");
    if (!draft.vin && !draft.lotNumber && !draft.stockNumber) errors.push("Enter a VIN, lot number or stock number");
    if (draft.vin && draft.vin.length !== 17) errors.push("VIN must be 17 characters");

    const { reviewNotes, ...rest } = draft;
    return {
      id: `item-${Date.now()}-${i}`,
      draft: rest,
      errors,
      match: match ? { status: "existing", vehicle: { id: match.id } } : { status: "new" },
      sourceExcerpt: excerpts[i] ?? sourceText.slice(0, 240) ?? "Manual entry",
      reviewNotes: reviewNotes?.length ? reviewNotes : undefined,
    } satisfies IntakeItem;
  });
}
