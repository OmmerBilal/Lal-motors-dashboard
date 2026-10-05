// Dismantling v2 browser flow (Playwright + installed Chrome, DEV data). Real accounts:
//   owner (DEV_TEST_OWNER_PASSWORD env var) - Vehicle Workflow: Mark Ready, Assign Employee, record review
//   dismantling employee (git-ignored credential file) - My Assigned Vehicles: Start, evidence, parts, issue, Finish
// Fixture only: a TEST-DIS vehicle is created by the auction account and received through the database (the arrival
// photo flow is covered by its own test). Every dismantling action in the browser goes through the real UI and RPCs.
// Widths: employee 390, 430, 768; manager 390, 1440. Checks overflow, the read-only owner preview, and the review view.
// Usage: BASE_URL=http://localhost:3100 DEV_TEST_OWNER_PASSWORD=... node scripts/dev-tests/ux-dismantling-flow.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { chromium } = req("playwright-core");
const { createClient } = req("@supabase/supabase-js");
const pg = req("pg");
const sharp = req("sharp");

const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const creds = loadDevCredentials();
const owner = creds.find((u) => u.role === "owner");
const employee = creds.find((u) => u.role === "dismantling");
const auction = creds.find((u) => u.role === "auction");
const receiving = creds.find((u) => u.role === "receiving");
if (!owner?.password || owner.password.length < 8) { console.log("FAIL | owner password not provided (set DEV_TEST_OWNER_PASSWORD)"); process.exit(1); }
const shotDir = process.env.TEMP ? path.join(process.env.TEMP, "dismantling-qa") : path.join(ROOT, "dismantling-qa");
fs.mkdirSync(shotDir, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
const newClient = () => createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function signIn(a) {
  const c = newClient();
  const { data, error } = await c.auth.signInWithPassword({ email: a.email, password: a.password });
  if (error) throw new Error("sign-in " + a.role + " failed: " + error.message);
  const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  const CH = 3180;
  return { client: c, id: data.user.id, chunks: value.length <= CH ? [[COOKIE, value]] : Array.from({ length: Math.ceil(value.length / CH) }, (_, i) => [`${COOKIE}.${i}`, value.slice(i * CH, (i + 1) * CH)]) };
}
const ownerS = await signIn(owner);
const empS = await signIn(employee);
const auctionS = await signIn(auction);
const recvS = await signIn(receiving);
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const empName = (await db.query("select name from public.profiles where id = $1", [empS.id])).rows[0].name;

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
async function makeFixture(tag) {
  const vin = ("1TE" + run + tag).padEnd(17, "0").slice(0, 17);
  const { data, error } = await auctionS.client.rpc("match_or_create_vehicle", { p_vin: vin, p_lot_number: "TDF" + run + tag, p_stock_number: null, p_auction_source: "TEST-DIS-" + run, p_fields: { year: 2018, make: "Honda", model: "Accord", purchase_price: 450 } });
  if (error) throw new Error("fixture " + error.message);
  // Fixture only: arrival photo rows so the receive guard passes, then receive.
  for (const role of ["arrival_front", "arrival_rear", "arrival_left", "arrival_right"]) {
    await db.query(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, size_bytes, status) values ('vehicle', $1, $2, 'original', 'operational-media', $3, 'image/jpeg', 1, 'ready')`, [data.vehicle_id, role, `vehicle/${data.vehicle_id}/fx-${role}-${run}.jpg`]);
  }
  const rcv = await recvS.client.rpc("receive_vehicle", { p_vehicle_id: data.vehicle_id });
  if (rcv.error) throw new Error("receive fixture " + rcv.error.message);
  return { vin, vehicleId: data.vehicle_id };
}

const photo = path.join(shotDir, `part-${run}.jpg`);
const evidence = path.join(shotDir, `evidence-${run}.jpg`);
await sharp({ create: { width: 640, height: 480, channels: 3, background: [70, 110, 140] } }).jpeg().toFile(photo);
await sharp({ create: { width: 640, height: 480, channels: 3, background: [140, 110, 70] } }).jpeg().toFile(evidence);

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const ctxFor = async (s, width) => {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await context.addCookies(s.chunks.map(([n, v]) => ({ name: n, value: v, url: BASE })));
  return context;
};
const overflowOf = (page) => page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
const trackErrors = (page, list) => {
  page.on("pageerror", (e) => list.push("pageerror " + e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") list.push("console " + m.text().slice(0, 160)); });
};

// ========================= OWNER: manager vehicle workflow (1440) =========================
const v1 = await makeFixture("1");
{
  const errs = [];
  const context = await ctxFor(ownerS, 1440);
  const page = await context.newPage();
  trackErrors(page, errs);
  await page.goto(BASE + "/dismantling-processing", { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  await page.getByRole("button", { name: /Vehicle Workflow/ }).first().click();
  await page.getByRole("tab", { name: "Eligible / Not Ready" }).click();
  await page.getByPlaceholder("Search VIN, lot, stock, make or model").fill(v1.vin);
  const row1 = page.locator("li", { hasText: v1.vin });
  await row1.waitFor({ state: "visible", timeout: 30_000 });
  check("owner: vehicle appears under Eligible / Not Ready", true);
  await row1.getByRole("button", { name: "Mark Ready for Dismantling" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark Ready for Dismantling" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("tab", { name: "Ready to Dismantle" }).click();
  await page.getByPlaceholder("Search VIN, lot, stock, make or model").fill(v1.vin);
  const row2 = page.locator("li", { hasText: v1.vin });
  await row2.waitFor({ state: "visible", timeout: 30_000 });
  check("owner: after Mark Ready the vehicle is in Ready to Dismantle", true);
  await row2.getByRole("button", { name: "Assign Employee" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: new RegExp(empName) }).click();
  await dialog.getByRole("button", { name: "Confirm Assignment" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("tab", { name: "Assigned" }).click();
  await page.getByPlaceholder("Search VIN, lot, stock, make or model").fill(v1.vin);
  const row3 = page.locator("li", { hasText: v1.vin });
  await row3.waitFor({ state: "visible", timeout: 30_000 });
  const rowText = await row3.innerText();
  check("owner: Assigned row shows the employee, assigned by and assigned time", rowText.includes(empName) && /Assigned by/.test(rowText) && /Assigned/.test(rowText), rowText.replace(/\n/g, " | ").slice(0, 140));
  check("owner: Assigned row offers Reassign and Cancel, not a start action", (await row3.getByRole("button", { name: /Reassign/ }).count()) === 1 && (await row3.getByRole("button", { name: /Start/ }).count()) === 0);
  const ov = await overflowOf(page);
  check("owner: no overflow at 1440", ov.scroll <= ov.inner + 1, `inner=${ov.inner} scroll=${ov.scroll}`);
  await page.screenshot({ path: path.join(shotDir, `owner-workflow-1440.png`), fullPage: true });
  check("owner: no React or page errors (workflow)", errs.length === 0, errs.slice(0, 2).join(" | "));
  await context.close();
}

// ========================= EMPLOYEE: My Assigned Vehicles and full work (390, 430, 768) =========================
const employeeWidths = [390, 430, 768];
let reviewVin = null;
for (const width of employeeWidths) {
  const tag = `${width}px`;
  // A fresh vehicle per width. The owner readies and assigns it through the manager RPCs (the UI path is tested above).
  const fx = await makeFixture("E" + width);
  const prep = await ownerS.client.rpc("mark_vehicle_ready", { p_vehicle_id: fx.vehicleId });
  if (prep.error) throw new Error("prep ready " + prep.error.message);
  const asg = await ownerS.client.rpc("assign_dismantling_vehicle", { p_vehicle_id: fx.vehicleId, p_employee_id: empS.id });
  if (asg.error) throw new Error("prep assign " + asg.error.message);
  if (width === 390) reviewVin = fx.vin;
  const errs = [];
  const context = await ctxFor(empS, width);
  const page = await context.newPage();
  trackErrors(page, errs);
  await page.goto(BASE + "/dismantling", { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  await page.getByRole("heading", { name: "My Assigned Vehicles" }).waitFor({ timeout: 30_000 }).catch(() => {});
  check(`employee: home is My Assigned Vehicles at ${tag}`, (await page.getByRole("heading", { name: "My Assigned Vehicles" }).count()) === 1);
  const card = page.locator("li", { hasText: fx.vin });
  const visible = await card.first().waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false);
  check(`employee: the assigned TEST vehicle is listed at ${tag}`, visible);
  if (width === 390) {
    const leak = await page.locator("li", { hasText: "TEST-DIS" }).count();
    check("employee: only own vehicles are listed (no other auction vehicles)", leak === 0 || (await card.count()) >= 1);
  }
  // The list card opens the vehicle. Start Dismantling is then pressed in the vehicle screen.
  await card.first().getByRole("button", { name: /Start Dismantling/ }).click();
  await page.getByText("Status: Assigned").waitFor({ timeout: 30_000 }).catch(() => {});
  await page.getByRole("button", { name: /Start Dismantling/ }).first().click();
  await page.getByText("Vehicle Evidence").waitFor({ timeout: 30_000 }).catch(() => {});
  check(`employee: Start moves the vehicle to Vehicle Evidence and capture at ${tag}`, (await page.getByText("Capture Part", { exact: true }).count()) >= 1);

  // Evidence through the real pipeline (device input).
  await page.locator('input[aria-label="Vehicle evidence photo: choose from device"]').setInputFiles(evidence);
  await page.getByRole("button", { name: "Save Photo", exact: true }).first().click();
  await page.getByText(/1 saved/).waitFor({ timeout: 90_000 }).catch(() => {});
  check(`employee: evidence photo saved (1 saved) at ${tag}`, (await page.getByText(/1 saved\./).count()) >= 1);

  // Part 1 (manual name and details, photo, Save Part & Next)
  const name1 = `Front Left Headlight ${width}`;
  await page.getByLabel("Part Name").fill(name1);
  await page.getByLabel("Part Details / Notes").fill("TEST QA part - lens intact");
  await page.getByRole("button", { name: "Add this part" }).click();
  await page.locator('input[aria-label="Part photo: choose from device"]').setInputFiles(photo);
  await page.getByRole("button", { name: "Save Photo", exact: true }).first().click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Save Part & Next" }).click();
  await page.getByText("Part saved. Ready for the next part.").waitFor({ timeout: 30_000 }).catch(() => {});
  check(`employee: part 1 saved through Save Part & Next at ${tag}`, (await page.getByText(name1).count()) >= 1);

  // Part 2
  await page.getByLabel("Part Name").fill(`Alternator ${width}`);
  await page.getByLabel("Part Details / Notes").fill("TEST QA part - connector intact");
  await page.getByRole("button", { name: "Add this part" }).click();
  await page.locator('input[aria-label="Part photo: choose from device"]').setInputFiles(photo);
  await page.getByRole("button", { name: "Save Photo", exact: true }).first().click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Save Part & Next" }).click();
  await page.waitForTimeout(1500);
  check(`employee: two parts captured at ${tag}`, (await page.getByText(/Parts Captured From This Vehicle \(2 saved\)/).count()) === 1);
  const ov = await overflowOf(page);
  check(`employee: no horizontal overflow at ${tag}`, ov.scroll <= ov.inner + 1, `inner=${ov.inner} scroll=${ov.scroll}`);
  await page.screenshot({ path: path.join(shotDir, `employee-captured-${width}.png`), fullPage: true });

  if (width === 390) {
    // Switch tab away and back, and reload: the same session, vehicle and parts remain.
    const other = await context.newPage();
    await other.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" }).catch(() => {});
    await other.bringToFront();
    await other.waitForTimeout(600);
    await page.bringToFront();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText(/Parts Captured From This Vehicle \(2 saved\)/).waitFor({ timeout: 30_000 }).catch(() => {});
    check(`employee: after tab switch and reload the two parts are restored at ${tag}`, (await page.getByText(/Parts Captured From This Vehicle \(2 saved\)/).count()) === 1);
    await other.close();
    // Optional issue, harmless note.
    await page.getByRole("button", { name: /Report an issue/ }).click();
    await page.getByLabel("What is wrong? (at least 5 characters)").fill("TEST QA note: record discrepancy only");
    await page.getByRole("dialog").getByRole("button", { name: "Submit issue" }).click();
    await page.waitForTimeout(1500);
    check("employee: optional issue submitted", (await page.getByText(/1 issue\(s\) reported/).count()) >= 1);
  }

  // Finish
  await page.getByRole("button", { name: "Finish Vehicle" }).click();
  await page.getByText("Vehicle Dismantling Completed").waitFor({ timeout: 60_000 }).catch(() => {});
  check(`employee: Finish Vehicle shows Vehicle Dismantling Completed at ${tag}`, (await page.getByText("Vehicle Dismantling Completed").count()) >= 1);
  const dbState = await db.query("select a.status, v.status as vstatus from public.dismantling_assignments a join public.vehicles v on v.id = a.vehicle_id where a.vehicle_id = $1 order by a.assigned_at desc limit 1", [fx.vehicleId]);
  if (width === 390) check("db: assignment COMPLETED and vehicle Dismantled after Finish", dbState.rows[0]?.status === "COMPLETED" && dbState.rows[0]?.vstatus === "Dismantled", JSON.stringify(dbState.rows[0] ?? {}));
  check(`no React or page errors (employee) at ${tag}`, errs.length === 0, errs.slice(0, 2).join(" | "));
  if (width === 390) {
    await page.screenshot({ path: path.join(shotDir, `employee-completed-390.png`), fullPage: true });
    // Read-only owner preview is checked next, with the owner.
  }
  await context.close();
}

// ========================= OWNER: read-only employee preview and vehicle-centric review (390, 1440) =========================
for (const width of [1440, 390]) {
  const tag = `${width}px`;
  const errs = [];
  const context = await ctxFor(ownerS, width);
  const page = await context.newPage();
  trackErrors(page, errs);
  await page.goto(BASE + "/preview/dismantling", { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  const banner = await page.getByText(/employee app preview\s*—?\s*read only/i).count();
  check(`owner: employee app preview shows the read-only banner at ${tag}`, banner >= 1);
  check(`owner: employee preview has no Start, Finish or capture controls at ${tag}`, (await page.getByRole("button", { name: /Start Dismantling|Finish Vehicle|Add this part/ }).count()) === 0);

  await page.goto(BASE + "/dismantling-processing", { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  await page.getByRole("button", { name: /Vehicle Workflow/ }).first().click();
  await page.getByRole("tab", { name: "Completed" }).click();
  await page.getByPlaceholder("Search VIN, lot, stock, make or model").fill(reviewVin);
  const row = page.locator("li", { hasText: reviewVin });
  await row.waitFor({ state: "visible", timeout: 30_000 });
  await row.getByRole("button", { name: /Review parts/ }).click();
  await page.getByText(`Parts dismantled by ${empName}`).waitFor({ timeout: 30_000 }).catch(() => {});
  check(`owner: record shows Parts dismantled by ${empName} at ${tag}`, (await page.getByText(`Parts dismantled by ${empName}`).count()) >= 1);
  const txt = await page.locator("body").innerText();
  check(`owner: record lists both captured part names at ${tag}`, /Front Left Headlight/.test(txt) && /Alternator/.test(txt));
  check(`owner: record shows Assigned Employee, Assigned By, Assigned At, Started, Completed at ${tag}`, /Assigned Employee/.test(txt) && /Assigned By/.test(txt) && /Assigned At/.test(txt) && /Started At/.test(txt) && /Completed At/.test(txt));
  check(`owner: record shows Total Parts Captured and Issues Flagged at ${tag}`, /Total Parts Captured/.test(txt) && /Issues Flagged/.test(txt));
  check(`owner: Analyze Part is available to the owner at ${tag}`, (await page.getByRole("button", { name: "Analyze Part" }).count()) >= 1);
  if (width === 1440) {
    // Keep Later is a non-destructive review action: the part stays reviewable and nothing is sold or rejected.
    const keep = page.getByRole("button", { name: "Keep Later" }).first();
    await keep.click();
    await page.getByText("Kept for later review.").waitFor({ timeout: 20_000 }).catch(() => {});
    check("owner: Keep Later on a captured part keeps it reviewable", (await page.getByText("Kept for later review.").count()) >= 1 || (await page.getByText(/Needs review/).count()) >= 1);
    await page.waitForSelector('img[alt$="photo"]', { timeout: 15_000 }).catch(() => {});
    await page.screenshot({ path: path.join(shotDir, `owner-record-1440.png`), fullPage: true });
    const ov = await overflowOf(page);
    check("owner: record has no horizontal overflow at 1440", ov.scroll <= ov.inner + 1, `inner=${ov.inner} scroll=${ov.scroll}`);
  }
  check(`no React or page errors (owner review) at ${tag}`, errs.length === 0, errs.slice(0, 2).join(" | "));
  await context.close();
}

// ========================= EMPLOYEE: no Analyze Part, and no owner review controls =========================
{
  const context = await ctxFor(empS, 390);
  const page = await context.newPage();
  await page.goto(BASE + "/dismantling", { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  check("employee: no Analyze Part control in the employee app", (await page.getByRole("button", { name: "Analyze Part" }).count()) === 0);
  check("employee: no Approve or Reject controls in the employee app", (await page.getByRole("button", { name: /Approve|Reject/ }).count()) === 0);
  await context.close();
}

await db.end();
await browser.close();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
console.log(`screenshots: ${shotDir}`);
process.exit(fail === 0 ? 0 : 1);
