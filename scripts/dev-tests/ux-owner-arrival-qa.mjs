// Owner QA for Receiving (Playwright + installed Chrome, DEV data). Uses the OWNER account (password from the
// DEV_TEST_OWNER_PASSWORD environment variable, never a file). Per width, on a fresh TEST-ARR vehicle:
//   Auction -> Receive Vehicle -> exact vehicle preselected
//   select Front, Rear, Left, Right (not saved) -> "4 selected · 0 saved", Confirm disabled
//   Save Photo on each -> N / 4 saved after each, Confirm enabled at 4 / 4 (DOM check)
//   tab away and back at 2 / 4 -> state kept, no session loader
//   reload -> 4 / 4 still shown from the server
// At WIDTHS (default 390,430,768,1440). At 1440 it also performs one real Confirm Arrival and checks the result,
// the Auction row, the second attempt in the UI, and the receive_vehicle replay and refusal.
// Usage: BASE_URL=http://localhost:3100 DEV_TEST_OWNER_PASSWORD=... node scripts/dev-tests/ux-owner-arrival-qa.mjs
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
const sharp = req("sharp");
const pg = req("pg");

const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const WIDTHS = (process.env.WIDTHS || "390,430,768,1440").split(",").map(Number);
const CONFIRM_WIDTH = 1440;
const creds = loadDevCredentials();
const owner = creds.find((u) => u.role === "owner");
const auctionAccount = creds.find((u) => u.role === "auction");
const engineer = creds.find((u) => u.role === "engineer_admin");
if (!owner?.password || owner.password.length < 8) { console.log("FAIL | owner password not provided (set DEV_TEST_OWNER_PASSWORD)"); process.exit(1); }
const shotDir = process.env.TEMP ? path.join(process.env.TEMP, "owner-qa") : path.join(ROOT, "owner-qa");
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
  const chunks = value.length <= CH ? [[COOKIE, value]] : Array.from({ length: Math.ceil(value.length / CH) }, (_, i) => [`${COOKIE}.${i}`, value.slice(i * CH, (i + 1) * CH)]);
  return { client: c, chunks };
}

const ownerSession = await signIn(owner);
const auctionSession = await signIn(auctionAccount);
const engineerSession = await signIn(engineer);
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
async function makeFixture(tag) {
  const vin = ("1TR" + run + tag).padEnd(17, "0").slice(0, 17);
  const { data, error } = await auctionSession.client.rpc("match_or_create_vehicle", { p_vin: vin, p_lot_number: "TQ" + run + tag, p_stock_number: null, p_auction_source: "TEST-ARR-" + run, p_fields: { year: 2021, make: "Ford", model: "Escape", purchase_price: 500 } });
  if (error) throw new Error("fixture " + error.message);
  return { vin, vehicleId: data.vehicle_id };
}

// Test JPEGs, one per slot, so each selection is a distinct local file.
const imgs = {};
for (const id of ["front", "rear", "left", "right"]) {
  imgs[id] = path.join(shotDir, `photo-${id}-${run}.jpg`);
  await sharp({ create: { width: 640, height: 480, channels: 3, background: id === "front" ? [90, 120, 150] : id === "rear" ? [120, 90, 150] : id === "left" ? [150, 120, 90] : [90, 150, 120] } }).jpeg().toFile(imgs[id]);
}

const SLOTS = [["Front View", "front"], ["Rear View", "rear"], ["Left Side", "left"], ["Right Side", "right"]];
const progressRe = (n) => new RegExp(`^${n} / 4 saved$`);
const overflowOf = (page) => page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
const countOf = (page, text) => page.getByText(text, { exact: true }).count();
const confirmBtn = (page) => page.getByRole("button", { name: /Confirm Arrival/ }).first();

async function dbMediaSummary(vehicleId) {
  const { rows } = await db.query(`select owner_type, owner_id, role, status, variant from public.media_assets where owner_id = $1 and role like 'arrival%' and variant = 'original' order by role`, [vehicleId]);
  return rows.map((r) => ({ owner_type: r.owner_type, same_vehicle: r.owner_id === vehicleId, role: r.role, status: r.status, variant: r.variant }));
}

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

for (const width of WIDTHS) {
  const tag = `${width}px`;
  console.log(`\n=== owner, ${tag} ===`);
  const { vin, vehicleId } = await makeFixture(String(width));
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await context.addCookies(ownerSession.chunks.map(([n, v]) => ({ name: n, value: v, url: BASE })));
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror " + e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") problems.push("console " + m.text().slice(0, 160)); });

  // 1. Auction -> Receive Vehicle, as the owner (the Auction route is /preview/auction for owner).
  await page.goto(BASE + "/preview/auction", { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  await page.getByPlaceholder("Search by VIN, Lot #, Stock #, Make, Model…").fill(vin);
  const row = page.locator("tbody tr", { hasText: vin });
  await row.waitFor({ state: "visible", timeout: 30_000 });
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Receive Vehicle" }).click();
  await page.waitForURL(`**/vehicle-receiving?vehicle=${vehicleId}`, { timeout: 30_000 }).catch(() => {});
  check(`owner: Auction Receive Vehicle opens the exact vehicle at ${tag}`, page.url().endsWith(`/vehicle-receiving?vehicle=${vehicleId}`), page.url().split("?")[1] ?? "");
  await page.waitForFunction((v) => document.querySelector("#vin-manual")?.value === v, vin, { timeout: 30_000 }).catch(() => {});
  await page.getByText(progressRe(0)).waitFor({ timeout: 30_000 }).catch(() => {});
  check(`owner: starts at 0 / 4 saved with Confirm disabled at ${tag}`, (await countOf(page, "0 / 4 saved")) === 1 && (await confirmBtn(page)).isDisabled().catch(() => false));
  await page.screenshot({ path: path.join(shotDir, `owner-${width}-1-empty.png`), fullPage: true });

  // 2. Select all four, do not save. Nothing may count as saved.
  for (const [label, id] of SLOTS) {
    await page.locator(`input[aria-label="${label}: choose from device"]`).setInputFiles(imgs[id]);
  }
  await page.getByText("NOT SAVED YET", { exact: true }).nth(3).waitFor({ timeout: 15_000 }).catch(() => {});
  check(`owner: four selected shows "4 selected · 0 saved" at ${tag}`, (await page.getByText(/4 selected · 0 saved/).count()) === 1);
  check(`owner: four selected are "NOT SAVED YET" (4) at ${tag}`, (await countOf(page, "NOT SAVED YET")) === 4);
  check(`owner: four selected keep Confirm disabled at ${tag}`, await confirmBtn(page).isDisabled().catch(() => false));
  check(`owner: four selected show Save Photo on each slot at ${tag}`, (await page.getByRole("button", { name: "Save Photo", exact: true }).count()) === 4);
  await page.screenshot({ path: path.join(shotDir, `owner-${width}-2-selected.png`), fullPage: true });

  // 3. Save each. After each successful save, the saved count goes up and the slot leaves NOT SAVED YET.
  const sequence = [];
  for (let i = 0; i < 4; i++) {
    const n = i + 1;
    await page.getByRole("button", { name: "Save Photo", exact: true }).first().click();
    sequence.push(`save#${n} clicked`);
    const uploading = await page.getByText(/Uploading/).first().waitFor({ timeout: 4_000 }).then(() => true).catch(() => false);
    if (uploading) sequence.push("uploading shown");
    const reached = await page.getByText(progressRe(n)).waitFor({ timeout: 90_000 }).then(() => true).catch(() => false);
    check(`owner: ${n} / 4 saved after save #${n} at ${tag}`, reached);
    const unsaved = await countOf(page, "NOT SAVED YET");
    check(`owner: ${4 - n} still NOT SAVED YET after save #${n} at ${tag}`, unsaved === 4 - n, `count=${unsaved}`);
    if (n < 4) check(`owner: Confirm still disabled at ${n} / 4 at ${tag}`, await confirmBtn(page).isDisabled().catch(() => false));
    sequence.push(`${n} / 4 saved`);

    if (n === 2) {
      // 3b. Tab away and back at 2 / 4: the same workflow, selection, saved photos and progress remain.
      const other = await context.newPage();
      await other.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" }).catch(() => {});
      await other.bringToFront();
      await other.waitForTimeout(800);
      await page.bringToFront();
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await page.waitForTimeout(1500);
      const sessionLoader = await page.getByText("Loading session…").count();
      check(`owner: tab back at 2 / 4 keeps progress and vehicle at ${tag}`, (await countOf(page, "2 / 4 saved")) === 1 && (await page.locator("#vin-manual").inputValue()) === vin);
      check(`owner: tab back shows no full-screen session loader at ${tag}`, sessionLoader === 0);
      await other.close();
    }
  }
  console.log("  observed sequence:", sequence.join(" -> "));
  check(`owner: Confirm Arrival enabled at 4 / 4 without refresh at ${tag}`, await confirmBtn(page).isEnabled().catch(() => false));
  check(`owner: "All required arrival photos saved" shows at ${tag}`, (await page.getByText(/All required arrival photos saved/).count()) >= 1);
  const ov = await overflowOf(page);
  check(`owner: no horizontal overflow at ${tag}`, ov.scroll <= ov.inner + 1, `inner=${ov.inner} scroll=${ov.scroll}`);
  await page.screenshot({ path: path.join(shotDir, `owner-${width}-3-four-of-four.png`), fullPage: true });

  // 4. Database: four canonical originals on this vehicle, ready.
  const media = await dbMediaSummary(vehicleId);
  const canonical = ["arrival_front", "arrival_left", "arrival_rear", "arrival_right"];
  const okRows = canonical.every((r) => media.some((m) => m.role === r && m.same_vehicle && m.status === "ready" && m.owner_type === "vehicle" && m.variant === "original"));
  check(`db: four canonical arrival originals, same vehicle, ready at ${tag}`, okRows, media.map((m) => `${m.role}:${m.status}`).join(" "));

  // 5. Reload: the four slots and 4 / 4 come back from the server.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction((v) => document.querySelector("#vin-manual")?.value === v, vin, { timeout: 30_000 }).catch(() => {});
  await page.getByText(progressRe(4)).waitFor({ timeout: 30_000 }).catch(() => {});
  check(`owner: after reload 4 / 4 and Confirm enabled at ${tag}`, (await countOf(page, "4 / 4 saved")) === 1 && (await confirmBtn(page).isEnabled().catch(() => false)));
  check(`owner: after reload four slots show Saved at ${tag}`, (await page.getByText("✓ Saved", { exact: true }).count()) >= 4);

  // 6. Confirm Arrival, once, on the dedicated fixture for the confirm width.
  if (width === CONFIRM_WIDTH) {
    const before = Number((await page.getByText("Arrived Today", { exact: true }).locator("xpath=preceding-sibling::b").textContent()).trim());
    await confirmBtn(page).click();
    const confirmed = await page.getByText("Vehicle Successfully Checked In!").waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
    check(`owner: Confirm Arrival shows Arrival Confirmed at ${tag}`, confirmed);
    let after = before;
    for (let t = 0; t < 40 && after === before; t++) {
      await page.waitForTimeout(500);
      after = Number((await page.getByText("Arrived Today", { exact: true }).locator("xpath=preceding-sibling::b").textContent()).trim());
    }
    check(`owner: Arrived Today increases by one (${before} -> ${after}) at ${tag}`, after === before + 1);
    const { rows } = await db.query("select received_at is not null as received, receiving_status, status, closed_reason from public.vehicles where id = $1", [vehicleId]);
    check(`db: received_at set and receiving_status received at ${tag}`, rows[0]?.received === true && rows[0]?.receiving_status === "received", JSON.stringify({ receiving_status: rows[0]?.receiving_status, status: rows[0]?.status }));
    await page.screenshot({ path: path.join(shotDir, `owner-${width}-4-confirmed.png`), fullPage: true });

    // Auction no longer offers Receive Vehicle for this vehicle.
    await page.goto(BASE + "/preview/auction", { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
    await page.getByPlaceholder("Search by VIN, Lot #, Stock #, Make, Model…").fill(vin);
    const r2 = page.locator("tbody tr", { hasText: vin });
    await r2.waitFor({ state: "visible", timeout: 30_000 });
    await r2.getByRole("button", { name: "More actions" }).click();
    check("owner: Auction no longer offers Receive Vehicle after receipt", (await page.getByRole("menuitem", { name: "Receive Vehicle" }).count()) === 0);
    await page.keyboard.press("Escape");

    // Second attempt in the UI: the deep link shows the vehicle as already received and offers no Confirm.
    await page.goto(`${BASE}/vehicle-receiving?vehicle=${vehicleId}`, { waitUntil: "networkidle" });
    await page.waitForFunction((v) => document.querySelector("#vin-manual")?.value === v, vin, { timeout: 30_000 }).catch(() => {});
    const already = await page.getByText("Already Received", { exact: true }).waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    check("owner: second attempt in the UI shows Already Received with no Confirm", already && (await page.getByRole("button", { name: /Confirm Arrival/ }).count()) === 0);

    // Second attempt at the server. The same employee gets the existing result (retry-safe replay). A different employee is refused.
    const replay = await ownerSession.client.rpc("receive_vehicle", { p_vehicle_id: vehicleId });
    check("db: owner second receive_vehicle returns the existing result (idempotent replay)", !replay.error && replay.data?.idempotent_replay === true, replay.error?.message ?? JSON.stringify(replay.data));
    const other = await engineerSession.client.rpc("receive_vehicle", { p_vehicle_id: vehicleId });
    check("db: another employee's receive_vehicle is refused", !!other.error && /already received by another employee/.test(other.error.message), other.error?.message ?? "no error");
  }

  check(`no React or page errors at ${tag}`, problems.length === 0, problems.slice(0, 3).join(" | "));
  await context.close();
}

// 7. Desktop webcam: Take Photo opens the live camera, capture goes through the same save path.
{
  console.log("\n=== owner desktop webcam (fake camera device) ===");
  const { vin, vehicleId } = await makeFixture("CAM");
  const camBrowser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const context = await camBrowser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera"] });
  await context.addCookies(ownerSession.chunks.map(([n, v]) => ({ name: n, value: v, url: BASE })));
  const page = await context.newPage();
  await page.goto(`${BASE}/vehicle-receiving?vehicle=${vehicleId}`, { waitUntil: "networkidle" });
  await page.waitForFunction((v) => document.querySelector("#vin-manual")?.value === v, vin, { timeout: 30_000 }).catch(() => {});
  const frontCell = page.locator("[data-slot-state]", { hasText: "Front View" });
  await frontCell.getByRole("button", { name: "Take Photo", exact: true }).click();
  const dialogOpen = await page.getByText("Take photo: Front View").waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
  check("webcam: Take Photo opens the camera dialog on desktop", dialogOpen);
  const live = await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Capture Photo")); return !!b && !b.disabled; }, null, { timeout: 20_000 }).then(() => true).catch(() => false);
  check("webcam: live preview starts and Capture Photo is enabled", live);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Capture Photo" }).click();
  const notSaved = await frontCell.getByText("NOT SAVED YET", { exact: true }).waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
  check("webcam: captured frame shows as a selected photo, NOT SAVED YET", notSaved);
  check("webcam: nothing is saved before Save Photo", (await countOf(page, "0 / 4 saved")) === 1);
  await frontCell.getByRole("button", { name: "Save Photo", exact: true }).click();
  check("webcam: captured photo saves through the same path (1 / 4 saved)", (await page.getByText(progressRe(1)).waitFor({ timeout: 90_000 }).then(() => true).catch(() => false)));
  const media = await dbMediaSummary(vehicleId);
  check("db: webcam photo persisted as arrival_front original, ready", media.some((m) => m.role === "arrival_front" && m.status === "ready" && m.same_vehicle));
  await page.screenshot({ path: path.join(shotDir, `owner-webcam-1440.png`), fullPage: true });
  await camBrowser.close();

  // Camera unavailable: no crash, a clear message, and Choose from Device still works.
  const fresh = await makeFixture("NCAM");
  const noCam = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await noCam.addCookies(ownerSession.chunks.map(([n, v]) => ({ name: n, value: v, url: BASE })));
  const p2 = await noCam.newPage();
  const probs = [];
  p2.on("pageerror", (e) => probs.push(e.message.slice(0, 120)));
  await p2.addInitScript(() => { Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true }); });
  await p2.goto(`${BASE}/vehicle-receiving?vehicle=${fresh.vehicleId}`, { waitUntil: "networkidle" });
  await p2.waitForFunction((v) => document.querySelector("#vin-manual")?.value === v, fresh.vin, { timeout: 30_000 }).catch(() => {});
  await p2.locator("[data-slot-state]", { hasText: "Front View" }).getByRole("button", { name: "Take Photo", exact: true }).click();
  const msg = await p2.getByText("Camera unavailable. Choose a photo from your device instead.").waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
  check("webcam: unavailable camera shows the clear message, no crash", msg && probs.length === 0, probs.join(" | "));
  await noCam.close();
}

await db.end();
await browser.close();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
console.log(`screenshots: ${shotDir}`);
process.exit(fail === 0 ? 0 : 1);
