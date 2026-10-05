// Four arrival photos, browser (Playwright + installed Chrome, DEV data). Creates a fresh TEST-ARR vehicle, then:
//   Auction -> Receive Vehicle -> /vehicle-receiving?vehicle=<id> (exact vehicle selected)
//   uploads Front, Rear, Left and Right through the real device inputs and the real media pipeline
// and asserts after each successful save: the N/4 count, no stale "Ready to upload", and Confirm Arrival enabled
// without a refresh once 4/4 is saved. Then reloads and checks 4/4 comes back from the server. Does not confirm arrival.
// Checks at 390px and 1440px: no React/page errors, no horizontal overflow.
// Usage: BASE_URL=http://localhost:3100 ROLE=engineer_admin node scripts/dev-tests/ux-arrival-photos-smoke.mjs
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

const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const WIDTHS = [390, 1440];
const roleName = process.env.ROLE || "engineer_admin";
const creds = loadDevCredentials();
const account = creds.find((u) => u.role === roleName);
const auctionAccount = creds.find((u) => u.role === "auction");
const shotDir = process.env.TEMP ? path.join(process.env.TEMP, "ux-shots") : path.join(ROOT, "ux-shots");
fs.mkdirSync(shotDir, { recursive: true });

async function session(a) {
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: a.email, password: a.password });
  if (error) throw new Error("sign-in " + a.role + ": " + error.message);
  const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  const CH = 3180;
  return value.length <= CH ? [[COOKIE, value]] : Array.from({ length: Math.ceil(value.length / CH) }, (_, i) => [`${COOKIE}.${i}`, value.slice(i * CH, (i + 1) * CH)]);
}

// Fresh fixture per width (labelled TEST-ARR), created the same way the Auction intake does, so each pass starts at 0/4.
const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const auctionClient = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
{
  const { error } = await auctionClient.auth.signInWithPassword({ email: auctionAccount.email, password: auctionAccount.password });
  if (error) { console.log("FAIL | auction sign-in"); process.exit(1); }
}
async function makeFixture(tag) {
  const vin = ("1TB" + run + tag).padEnd(17, "0").slice(0, 17);
  const { data, error } = await auctionClient.rpc("match_or_create_vehicle", { p_vin: vin, p_lot_number: "TBARR" + run + tag, p_stock_number: null, p_auction_source: "TEST-ARR-" + run, p_fields: { year: 2021, make: "Ford", model: "Escape", purchase_price: 500 } });
  if (error) throw new Error("fixture " + error.message);
  return { vin, vehicleId: data.vehicle_id };
}

// A real JPEG for each slot, written once.
const TMP = process.env.TEMP || path.join(ROOT, "ux-shots");
const imgPath = path.join(TMP, `arrival-${run}.jpg`);
await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 120, b: 150 } } }).jpeg().toFile(imgPath);

const cookies = await session(account);
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

const SLOTS = [["Front View", "front"], ["Rear View", "rear"], ["Left Side", "left"], ["Right Side", "right"]];
const progress = (n) => new RegExp(`^${n}/4 required photos saved$`);

for (const width of WIDTHS) {
  const tag = `${width}px`;
  const { vin, vehicleId } = await makeFixture(String(width));
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await context.addCookies(cookies.map(([name, v]) => ({ name, value: v, url: BASE })));
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text().slice(0, 160)); });

  // Auction -> Receive Vehicle
  await page.goto(BASE + "/preview/auction", { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  await page.getByPlaceholder("Search by VIN, Lot #, Stock #, Make, Model…").fill(vin);
  const row = page.locator("tbody tr", { hasText: vin });
  await row.waitFor({ state: "visible", timeout: 30_000 });
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Receive Vehicle" }).click();
  await page.waitForURL(`**/vehicle-receiving?vehicle=${vehicleId}`, { timeout: 30_000 }).catch(() => {});
  check(`Auction Receive Vehicle opens the exact vehicle at ${tag}`, page.url().endsWith(`/vehicle-receiving?vehicle=${vehicleId}`), page.url());
  await page.waitForFunction((v) => document.querySelector("#vin-manual")?.value === v, vin, { timeout: 30_000 }).catch(() => {});
  const confirm = () => page.getByRole("button", { name: /Confirm Arrival/ }).first();
  await page.getByText(progress(0)).waitFor({ timeout: 30_000 }).catch(() => {});
  check(`starts at 0/4 with Confirm disabled at ${tag}`, (await page.getByText(progress(0)).count()) === 1 && (await confirm().isDisabled()));
  check(`0/4 shows the remaining-photo message at ${tag}`, (await page.getByText(/4 required photos remaining/).count()) === 1);

  for (let i = 0; i < SLOTS.length; i++) {
    const [label, id] = SLOTS[i];
    const n = i + 1;
    await page.locator(`input[aria-label="${label}: choose from device"]`).setInputFiles(imgPath);
    await page.getByRole("button", { name: "Use photo" }).first().click();
    const shown = await page.getByText(progress(n)).waitFor({ timeout: 90_000 }).then(() => true).catch(() => false);
    check(`${id}: ${n}/4 shown after the save at ${tag}`, shown);
    const staleReady = await page.getByText("Ready to upload").count();
    check(`${id}: no stale "Ready to upload" at ${tag}`, staleReady === 0, `count=${staleReady}`);
    if (n < 4) check(`${id}: Confirm still disabled at ${n}/4 at ${tag}`, await confirm().isDisabled());
  }
  check(`4/4: Confirm Arrival enabled without a refresh at ${tag}`, await confirm().isEnabled());

  const overflow = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  check(`no horizontal overflow at ${tag}`, overflow.scroll <= overflow.inner + 1, `inner=${overflow.inner} scroll=${overflow.scroll}`);
  await page.screenshot({ path: path.join(shotDir, `arrival-4of4-${width}.png`), fullPage: true });

  // Reload: the four slots and 4/4 come back from the server.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction((v) => document.querySelector("#vin-manual")?.value === v, vin, { timeout: 30_000 }).catch(() => {});
  await page.getByText(progress(4)).waitFor({ timeout: 30_000 }).catch(() => {});
  check(`after reload: 4/4 and Confirm enabled at ${tag}`, (await page.getByText(progress(4)).count()) === 1 && (await confirm().isEnabled()));

  check(`no React or page errors at ${tag}`, problems.length === 0, problems.slice(0, 3).join(" | "));
  await context.close();
}
await browser.close();
console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
console.log(`screenshots: ${shotDir}`);
process.exit(fail === 0 ? 0 : 1);
