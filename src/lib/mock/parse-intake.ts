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
//    physical line is its own record, and without assuming the WHOLE paste uses one separator consistently (a
//    real paste can lose a blank line, or be missing the "Vehicle image" marker, for just one listing — e.g. one
//    with no photo — while the rest of the paste has it; picking one strategy for the entire input misses that).
//
// Two kinds of boundary, combined:
//   "strong" (layout) starts — a "Vehicle image" marker line, or the first line after a blank-line run (including
//     line 0). These need no guessing: the paste itself marks them.
//   "hidden" (content) starts — a second "<year> <word…>" title line appearing before the next strong start, i.e.
//     with no blank line or marker in between. That shape only happens when a separator was lost between two
//     vehicles, so it is treated as a boundary too — recursively: a THIRD title with nothing between it and the
//     one just promoted to a boundary is its own boundary as well, and so on.
// A paste with clean separators for every vehicle (the common case) never triggers a hidden start at all: each
// strong-start interval then contains exactly one title line, so this reduces to "split at every marker/blank
// run" with no extra behaviour.
// ---------------------------------------------------------------------------------------
function splitBlocks(sourceText: string): string[][] {
  const rawLines = sourceText.replace(/\r\n?/g, "\n").split("\n");
  if (rawLines.every((l) => !l.trim())) return [];

  const isMarker = (i: number) => VEHICLE_IMAGE_RE.test(rawLines[i].trim());
  const isBlankParaStart = (i: number) => !!rawLines[i].trim() && (i === 0 || !rawLines[i - 1].trim());
  const isTitle = (i: number) => TITLE_LINE_RE.test(rawLines[i].trim());

  // When the paste uses "Vehicle image" markers at all, they are the strong signal and a blank line is not — a
  // stray/decorative blank line INSIDE one marker's span must not fragment that vehicle. Blank-line starts are the
  // strong signal only for a paste that never uses the marker at all.
  const usesMarkers = rawLines.some((_, i) => isMarker(i));
  const starts = new Set<number>();
  for (let i = 0; i < rawLines.length; i++) {
    if (isMarker(i) || (!usesMarkers && isBlankParaStart(i))) starts.add(i);
  }
  if (starts.size === 0) starts.add(0);

  // A start "has its title" once the first title line at or after it has been seen. A second title before the
  // next strong start becomes a new (hidden) start, and immediately counts as having its own title, so a third
  // glued-on vehicle is caught too.
  const hasTitle = new Set<number>();
  for (let i = 0; i < rawLines.length; i++) {
    if (!isTitle(i)) continue;
    const nearestStart = Math.max(...[...starts].filter((s) => s <= i));
    if (hasTitle.has(nearestStart)) {
      starts.add(i);
      hasTitle.add(i);
    } else {
      hasTitle.add(nearestStart);
    }
  }

  const sortedStarts = [...starts].sort((a, b) => a - b);
  const blocks = sortedStarts.map((s, idx) => rawLines.slice(s, sortedStarts[idx + 1] ?? rawLines.length));

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
  // The FIRST match wins (not the last) — a block should never legitimately contain two VINs; if it does (e.g. a
  // missed separator upstream), taking the first one is the safer failure, consistent with year/make/model below.
  let vinRaw = "";
  lines.forEach((l, i) => {
    if (claimed.has(i) || vinRaw) return;
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

  // Stock #. First match wins.
  lines.forEach((l, i) => {
    if (claimed.has(i) || draft.stockNumber) return;
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
    if (claimed.has(i) || draft.auctionItemNumber) return;
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

  // Sale/pickup status, when the listing labels it explicitly (e.g. "Status: Waiting Arrival", "Pickup Status:
  // ..."). Higher confidence than the positional guess further down, so it is not flagged uncertain.
  lines.forEach((l, i) => {
    if (claimed.has(i) || draft.pickupStatus) return;
    const m = l.match(/^(?:pickup\s*status|sale\s*status|status):?\s*(.+)/i);
    if (m) {
      draft.pickupStatus = m[1].trim();
      claim(i);
    }
  });

  // Dated / money fields with an explicit label. The line is claimed whether or not it is the first (and so the
  // one actually kept) match for its field, so a repeated label never turns into a stray "unrecognized line".
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
      claim(i);
      if (key === "__due__") {
        // "Due" in these listings is a payment due DATE, not an amount — there is no matching field in the
        // current schema (balanceDue is numeric money, not a date), so it is surfaced for review, not stored.
        reviewNotes.push(`Payment due date "${m[1].trim()}" was found but has no matching field in the current data model.`);
      } else if (!draft[key]) {
        draft[key] = m[1].trim();
      }
      break;
    }
  });
  draft.saleDate ??= "";
  draft.pickupDeadline ??= "";

  // Winning bid / purchase amount: a line that is (mostly) a dollar figure. First match wins.
  lines.forEach((l, i) => {
    if (claimed.has(i) || draft.purchasePrice) return;
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

  // Whatever is left, in order, is positional: in this auction site's export the branch/location and (when not
  // already found as an explicit "Status:" label above) the sale status appear as consecutive unlabeled lines,
  // followed by the buyer name, between the VIN/stock lines and the dated fields. This is a heuristic for the
  // GIVEN export shape, not a general rule — flagged below so a reviewer can confirm it. Because an explicit
  // Status: label (if found) already claimed its line above, it is no longer in `leftover` at all here, so the
  // buyer-name slot shifts left automatically — tracked explicitly via `nextSlot` rather than a fixed index.
  const leftover = lines.filter((l, i) => !claimed.has(i));
  let nextSlot = 0;
  if (leftover[nextSlot]) {
    draft.location = leftover[nextSlot];
    uncertain.add("location");
    nextSlot++;
  } else {
    draft.location ??= "";
  }
  if (!draft.pickupStatus) {
    if (leftover[nextSlot]) {
      draft.pickupStatus = leftover[nextSlot];
      uncertain.add("pickupStatus");
      nextSlot++;
    } else {
      draft.pickupStatus = "";
    }
  }
  if (leftover[nextSlot]) {
    reviewNotes.push(`"${leftover[nextSlot]}" was found (likely a buyer name) but there is no buyer field in the current data model.`);
    nextSlot++;
  }
  for (const extra of leftover.slice(nextSlot)) {
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
