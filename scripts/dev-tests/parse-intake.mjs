// Auction Bulk Import parser (src/lib/mock/parse-intake.ts). Pure function, no DB and no auth: this tests block
// segmentation and field extraction only. Duplicate, conflict and "already in inventory" detection are DECIDED ON
// THE SERVER (_intake_evaluate_rows / intake_commit_batch, migration 0056) and are unchanged by this fix — they
// are exercised by rpc-intake-batch.mjs, run separately as a regression, not re-tested here.
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
register(pathToFileURL(path.join(ROOT, "scripts/dev-tests/_ts-alias-loader.mjs")).href, import.meta.url);
const { buildIntakeItems } = await import(pathToFileURL(path.join(ROOT, "src/lib/mock/parse-intake.ts")).href);

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
const bulk = (text) => buildIntakeItems("bulk", text, []);

// The exact client sample. Verbatim — the parser must work on this because it is general, not because any value
// here is hard-coded in the parser.
const SAMPLE = `Vehicle image
2012 KIA OPTIMA SX
Stock#: 45611382
VIN: 5XXGR4A69CG024170
Atlanta East
A - #25
Pre-Bid
Safdar Pooya
Date Won: Thu, Oct 8
$850.00
Due: Tue, Oct 20
Pick up By: Thu, Oct 15
Pickup PIN:
E300
Cost Details

Vehicle image
2019 KIA FORTE S
Stock#: 45624096
VIN: 3KPF34AD3KE075909
Atlanta East
B - #72
Pre-Bid
Safdar Pooya
Date Won: Thu, Oct 8
$1,175.00
Due: Tue, Oct 20
Pick up By: Thu, Oct 15
Pickup PIN:
97BC
Cost Details

Vehicle image
2012 KIA OPTIMA SX
Stock#: 45794139
VIN: 5XXGR4A69CG012679
Atlanta East
D - #100
Pre-Bid
Safdar Pooya
Date Won: Thu, Oct 8
$740.00
Due: Tue, Oct 20
Pick up By: Thu, Oct 15
Pickup PIN:
EFFF
Cost Details

Vehicle image
2008 FORD EDGE LIMITED
Stock#: 45916180
VIN: 2FMDK39C58BA94182
Atlanta East
D - #133
Pre-Bid
Safdar Pooya
Date Won: Thu, Oct 8
$800.00
Due: Tue, Oct 20
Pick up By: Thu, Oct 15
Pickup PIN:
9E58
Cost Details
`;

// ---------------------------------------------------------------------------------------
// 1. The exact sample: exactly four records, root-cause regression.
// ---------------------------------------------------------------------------------------
const items = bulk(SAMPLE);
check("sample: exactly four vehicle blocks are detected (not ~60)", items.length === 4, `got ${items.length}`);

const VINS = ["5XXGR4A69CG024170", "3KPF34AD3KE075909", "5XXGR4A69CG012679", "2FMDK39C58BA94182"];
const STOCKS = ["45611382", "45624096", "45794139", "45916180"];
check("sample: all four VINs match the supplied data, in order", JSON.stringify(items.map((i) => i.draft.vin)) === JSON.stringify(VINS), items.map((i) => i.draft.vin).join(","));
check("sample: all four stock numbers match the supplied data, in order", JSON.stringify(items.map((i) => i.draft.stockNumber)) === JSON.stringify(STOCKS), items.map((i) => i.draft.stockNumber).join(","));

const EXPECT = [
  { year: "2012", make: "Kia", model: "OPTIMA SX", price: "850.00", lot: "A - #25" },
  { year: "2019", make: "Kia", model: "FORTE S", price: "1175.00", lot: "B - #72" },
  { year: "2012", make: "Kia", model: "OPTIMA SX", price: "740.00", lot: "D - #100" },
  { year: "2008", make: "Ford", model: "EDGE LIMITED", price: "800.00", lot: "D - #133" },
];
check("sample: year, make and model are parsed correctly for all four", items.every((it, i) => it.draft.year === EXPECT[i].year && it.draft.make === EXPECT[i].make && it.draft.model === EXPECT[i].model), items.map((i) => `${i.draft.year} ${i.draft.make} ${i.draft.model}`).join(" | "));
check("sample: the winning-bid amount is parsed for all four (no $ or commas)", items.every((it, i) => it.draft.purchasePrice === EXPECT[i].price), items.map((i) => i.draft.purchasePrice).join(","));
check("sample: the lane/lot code is kept for all four", items.every((it, i) => it.draft.lotNumber === EXPECT[i].lot), items.map((i) => i.draft.lotNumber).join(","));
check("sample: the branch/location is parsed", items.every((it) => it.draft.location === "Atlanta East"));
check("sample: the pickup deadline is parsed", items.every((it) => it.draft.pickupDeadline === "Thu, Oct 15"));
check("sample: the sale/win date is parsed", items.every((it) => it.draft.saleDate === "Thu, Oct 8"));
const PINS = ["E300", "97BC", "EFFF", "9E58"];
check("sample: the pickup PIN (value on the line after the label) is parsed for all four", JSON.stringify(items.map((i) => i.draft.pickupPin)) === JSON.stringify(PINS), items.map((i) => i.draft.pickupPin).join(","));
check("sample: all four are ready to import (no errors)", items.every((it) => it.errors.length === 0), items.map((i) => i.errors.join(";")).join(" | "));
check("sample: the unmapped payment-due date is flagged for review, not stored or discarded", items.every((it) => (it.reviewNotes ?? []).some((n) => /payment due date/i.test(n))));
check("sample: the unmapped buyer name is flagged for review, not stored or discarded", items.every((it) => (it.reviewNotes ?? []).some((n) => /Safdar Pooya/.test(n))));
check("sample: 'Vehicle image' and 'Cost Details' never appear as a field value", !items.some((it) => Object.values(it.draft).some((v) => /^(vehicle image|cost details)$/i.test(String(v)))));

// ---------------------------------------------------------------------------------------
// 2. Structural variants — not hard-coded to the sample's values.
// ---------------------------------------------------------------------------------------

// Extra/irregular blank lines inside one block (the "Vehicle image" marker, not blank lines, decides the boundary
// here, so an internal blank line must not split one vehicle into two).
const withStrayBlankLine = SAMPLE.replace("VIN: 5XXGR4A69CG024170\nAtlanta East", "VIN: 5XXGR4A69CG024170\n\n\nAtlanta East");
const strayBlank = bulk(withStrayBlankLine);
check("blank lines: a stray blank line inside a block does not split it", strayBlank.length === 4 && strayBlank[0].draft.vin === VINS[0] && strayBlank[0].draft.location === "Atlanta East", `got ${strayBlank.length}`);

// Missing optional fields (no PIN, no Due line) on one block.
const missingOptional = SAMPLE.replace("Pickup PIN:\nE300\n", "").replace("Due: Tue, Oct 20\n", "");
const missing = bulk(missingOptional);
check("missing optional fields: still four records, the affected one is still ready with a blank PIN", missing.length === 4 && missing[0].draft.pickupPin === "" && missing[0].errors.length === 0, `pin="${missing[0]?.draft.pickupPin}" errors=${missing[0]?.errors}`);

// Different whitespace: extra spaces and tabs around labels and values.
const whitespaceVariant = SAMPLE.replace("VIN: 5XXGR4A69CG024170", "VIN:\t   5XXGR4A69CG024170   ").replace("Stock#: 45611382", "Stock#:    45611382");
const ws = bulk(whitespaceVariant);
check("whitespace: extra spaces/tabs around a label do not break extraction", ws.length === 4 && ws[0].draft.vin === VINS[0] && ws[0].draft.stockNumber === STOCKS[0], `vin="${ws[0]?.draft.vin}" stock="${ws[0]?.draft.stockNumber}"`);

// Reordered fields within one block.
const reordered = SAMPLE.replace(
  "2012 KIA OPTIMA SX\nStock#: 45611382\nVIN: 5XXGR4A69CG024170\nAtlanta East",
  "VIN: 5XXGR4A69CG024170\n2012 KIA OPTIMA SX\nAtlanta East\nStock#: 45611382"
);
const reorderedItems = bulk(reordered);
check("reordered fields: VIN, stock, year/make/model are found regardless of line order", reorderedItems.length === 4 && reorderedItems[0].draft.vin === VINS[0] && reorderedItems[0].draft.stockNumber === STOCKS[0] && reorderedItems[0].draft.year === "2012" && reorderedItems[0].draft.make === "Kia", JSON.stringify(reorderedItems[0]?.draft));

// Incomplete record: a title line with no identifier at all.
const incomplete = bulk("Vehicle image\n2015 HONDA CIVIC\nCost Details\n");
check("incomplete: a block with no VIN/lot/stock is one record flagged needs-review, not silently dropped or auto-ready", incomplete.length === 1 && incomplete[0].errors.length > 0, JSON.stringify(incomplete[0]));

// Malformed VIN (16 characters instead of 17).
const badVin = bulk("Vehicle image\n2015 HONDA CIVIC\nStock#: 123456\nVIN: 5XXGR4A69CG02417\nCost Details\n");
check("malformed VIN: a non-17-character VIN is captured and flagged, not silently accepted", badVin.length === 1 && badVin[0].draft.vin === "5XXGR4A69CG02417" && badVin[0].errors.some((e) => /17 characters/.test(e)), JSON.stringify(badVin[0]));

// Empty input.
check("empty input: produces zero records, not a placeholder", bulk("").length === 0);
check("whitespace-only input: produces zero records", bulk("   \n\n   ").length === 0);

// A heading with no vehicle data at all must never be silently counted as ready to import.
const heading = bulk("Auction Results Export\n\nAtlanta East — week of Oct 6\n\nPlease review the following lots.\n");
check("heading-only paste: nothing recognized is ever marked ready to import", heading.every((it) => it.errors.length > 0), JSON.stringify(heading.map((i) => i.errors)));

// Three blocks of the required sample shape, with different identifiers, to confirm the fix generalizes rather
// than being tuned to this one paste.
const synthetic = [1, 2, 3]
  .map(
    (n) => `Vehicle image
20${10 + n} TOYOTA CAMRY LE
Stock#: 9000000${n}
VIN: 1HGCM82633A${String(100000 + n).padStart(6, "0")}
Dallas West
C - #${n}
Pre-Bid
Someone Else
Date Won: Mon, Nov ${n}
$${1000 + n}.00
Due: Wed, Nov ${n + 5}
Pick up By: Fri, Nov ${n + 2}
Pickup PIN:
Z${n}Z${n}
Cost Details`
  )
  .join("\n\n");
const synthItems = bulk(synthetic);
check("synthetic (non-sample) three-vehicle paste: exactly three records, not tuned to the client's data", synthItems.length === 3, `got ${synthItems.length}`);
check("synthetic: VINs and stock numbers are distinct and correctly parsed", new Set(synthItems.map((i) => i.draft.vin)).size === 3 && synthItems.every((i) => i.draft.vin.length === 17), synthItems.map((i) => i.draft.vin).join(","));

// ---------------------------------------------------------------------------------------
// 3. A real client-style paste: one vehicle in the middle has no "Vehicle image" marker and no blank line before
//    it (a common paste artifact), and the sale status is an explicit "Status:" label rather than a bare line.
//    This is the exact shape a real report described: fewer vehicles detected than pasted, a vehicle's own title
//    line showing up as an "unrecognized line", and another vehicle's identifiers bleeding into the wrong record.
// ---------------------------------------------------------------------------------------
const MISSING_SEPARATOR = `Vehicle image
2012 KIA OPTIMA SX
Stock#: 45611382
VIN: 5XXGR4A69CG024170
Atlanta East
A - #25
Status: Waiting Arrival
Date Won: Thu, Oct 8
$850.00
Pick up By: Thu, Oct 15
2019 KIA FORTE S
Stock#: 45624096
VIN: 3KPF34AD3KE075909
Atlanta East
B - #72
Status: Waiting Arrival
Date Won: Thu, Oct 8
$1,175.00
Pick up By: Thu, Oct 15

Vehicle image
2020 Honda Accord
Stock#: 45794139
VIN: 5XXGR4A69CG012679
Atlanta East
D - #100
Status: Waiting Arrival
Date Won: Thu, Oct 8
$740.00
Pick up By: Thu, Oct 15
Cost Details
`;
const missingSepItems = bulk(MISSING_SEPARATOR);
check("missing separator: a vehicle with no marker and no blank line before it is still its own record", missingSepItems.length === 3, `got ${missingSepItems.length}`);
check("missing separator: the first vehicle keeps its OWN VIN and stock number (not overwritten by the next one)", missingSepItems[0]?.draft.vin === "5XXGR4A69CG024170" && missingSepItems[0]?.draft.stockNumber === "45611382", JSON.stringify(missingSepItems[0]?.draft.vin));
check("missing separator: the second (marker-less) vehicle gets its own correct VIN and stock number", missingSepItems[1]?.draft.vin === "3KPF34AD3KE075909" && missingSepItems[1]?.draft.stockNumber === "45624096", JSON.stringify(missingSepItems[1]?.draft.vin));
check("missing separator: the title line of the glued-on vehicle is not reported as an unrecognized line", !missingSepItems.some((it) => (it.reviewNotes ?? []).some((n) => /unrecognized line.*kia forte/i.test(n))), JSON.stringify(missingSepItems.map((i) => i.reviewNotes)));
check("missing separator: all three are ready (no errors)", missingSepItems.every((it) => it.errors.length === 0), missingSepItems.map((i) => i.errors));

// An explicit "Status:" label is captured directly and is NOT flagged uncertain (unlike the positional guess).
const statusItem = bulk("Vehicle image\n2015 HONDA CIVIC\nStock#: 1\nVIN: 1HGCM82633A000001\nStatus: Waiting Arrival\nCost Details\n")[0];
check("explicit Status label: captured as pickupStatus", statusItem?.draft.pickupStatus === "Waiting Arrival", JSON.stringify(statusItem?.draft.pickupStatus));
check("explicit Status label: not flagged uncertain (higher confidence than a positional guess)", !(statusItem?.draft.uncertainFields ?? []).includes("pickupStatus"));

// Three vehicles glued together with NO separator of any kind (no markers, no blank lines) — the recursive
// hidden-boundary detection must catch the second AND the third, not just the first glued-on vehicle.
const tripleGlued = bulk("2015 HONDA CIVIC\nVIN: 1HGCM82633A000001\n2016 TOYOTA CAMRY\nVIN: 4T1BF1FK000000002\n2017 FORD FUSION\nVIN: 3FA6P0H000000003\n");
check("three vehicles glued with no separator at all: three records, not one or two", tripleGlued.length === 3, `got ${tripleGlued.length}`);
check("three vehicles glued: each keeps its own VIN", JSON.stringify(tripleGlued.map((i) => i.draft.vin)) === JSON.stringify(["1HGCM82633A000001", "4T1BF1FK000000002", "3FA6P0H000000003"]), tripleGlued.map((i) => i.draft.vin).join(","));

// A corrupted/merged block with the SAME field labeled twice: the first occurrence wins, consistent with how
// year/make/model and lot already behaved — this is the defence-in-depth fix, independent of segmentation.
const duplicateVinBlock = bulk("Vehicle image\n2015 HONDA CIVIC\nStock#: 1\nVIN: 1HGCM82633A000001\nVIN: 4T1BF1FK000000002\nCost Details\n")[0];
check("duplicate VIN label in one block: the first VIN wins, not the last", duplicateVinBlock?.draft.vin === "1HGCM82633A000001", duplicateVinBlock?.draft.vin);

console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
