// Receive Vehicle browser smoke (Playwright + installed Chrome, DEV data). Signs in as ROLE (default owner) and uses
// /preview/auction, the Auction route the owner's sidebar opens. Checks, at 390px and 1440px:
//   - an eligible Waiting Arrival vehicle shows Receive Vehicle in its row Actions menu and on its detail page
//   - Receive Vehicle opens /vehicle-receiving?vehicle=<same id>, with that VIN already filled in (nothing is saved)
//   - a received, closed and dismantled vehicle do not show Receive Vehicle
//   - no horizontal page overflow
// Read-only against the database: it only navigates. Fixtures are picked from DEV rows at run time.
// Usage: BASE_URL=http://localhost:3100 node scripts/dev-tests/ux-receive-smoke.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { chromium } = req("playwright-core");
const { createClient } = req("@supabase/supabase-js");
const pg = req("pg");

const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
// ROLE picks the account. The owner password comes from DEV_TEST_OWNER_PASSWORD; other roles use dev-test-credentials.json.
const roleName = process.env.ROLE || "owner";
const account = loadDevCredentials().find((u) => u.role === roleName);
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const WIDTHS = [390, 1440];
const shotDir = process.env.TEMP ? path.join(process.env.TEMP, "ux-shots") : path.join(ROOT, "ux-shots");
fs.mkdirSync(shotDir, { recursive: true });

// Fixtures from the DEV database: one per state. Each must have a VIN so the Auction search can find it.
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const pick = async (where) => (await db.query(`select id, vin from public.vehicles where vin is not null and ${where} order by created_at desc limit 1`)).rows[0];
const fixtures = {
  eligible: await pick("status = 'Purchased' and transport_status = 'NEED_TRANSPORT' and receiving_status = 'not_received' and closed_reason is null"),
  received: await pick("receiving_status = 'received' and closed_reason is null"),
  closed: await pick("closed_reason is not null"),
  dismantled: await pick("status = 'Dismantled' and closed_reason is null"),
};
await db.end();
for (const [name, f] of Object.entries(fixtures)) if (!f) { console.log(`FAIL | no DEV fixture for ${name}`); process.exit(1); }

const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const { data, error } = await c.auth.signInWithPassword({ email: account.email, password: account.password });
if (error) { console.log("FAIL | sign-in"); process.exit(1); }
const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
const CHUNK = 3180;
const chunks = value.length <= CHUNK ? [[COOKIE, value]] : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => [`${COOKIE}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK)]);

const browser = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

async function openRowMenu(page, vin) {
  const row = page.locator("tbody tr", { hasText: vin });
  await row.waitFor({ state: "visible", timeout: 30_000 });
  await row.getByRole("button", { name: "More actions" }).click();
  return row;
}

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await context.addCookies(chunks.map(([name, v]) => ({ name, value: v, url: BASE })));
  const page = await context.newPage();
  const tag = `${width}px`;

  await page.goto(BASE + "/preview/auction", { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  const overflow = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  check(`/preview/auction has no overflow at ${tag}`, overflow.scroll <= overflow.inner + 1, `inner=${overflow.inner} scroll=${overflow.scroll}`);

  // Eligible vehicle: row menu offers Receive Vehicle.
  await page.getByPlaceholder("Search by VIN, Lot #, Stock #, Make, Model…").fill(fixtures.eligible.vin);
  let row = await openRowMenu(page, fixtures.eligible.vin);
  const menuItem = page.getByRole("menuitem", { name: "Receive Vehicle" });
  check(`eligible Waiting Arrival row menu shows Receive Vehicle at ${tag}`, await menuItem.isVisible().catch(() => false));
  await page.screenshot({ path: path.join(shotDir, `receive-row-menu-${width}.png`) });
  if (await menuItem.isVisible().catch(() => false)) {
    await menuItem.click();
    await page.waitForURL(`**/vehicle-receiving?vehicle=${fixtures.eligible.id}`, { timeout: 30_000 }).catch(() => {});
    check(`Receive Vehicle navigates to /vehicle-receiving?vehicle=<same id> at ${tag}`, page.url().endsWith(`/vehicle-receiving?vehicle=${fixtures.eligible.id}`), page.url());
    const vinField = page.locator("#vin-manual");
    await vinField.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    await page.waitForFunction((vin) => document.querySelector("#vin-manual")?.value === vin, fixtures.eligible.vin, { timeout: 30_000 }).catch(() => {});
    check(`Receiving shows the same VIN already selected at ${tag}`, (await vinField.inputValue().catch(() => "")) === fixtures.eligible.vin);
    const recvOverflow = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
    check(`/vehicle-receiving has no overflow at ${tag}`, recvOverflow.scroll <= recvOverflow.inner + 1, `inner=${recvOverflow.inner} scroll=${recvOverflow.scroll}`);
    await page.screenshot({ path: path.join(shotDir, `receive-deep-link-${width}.png`) });
  }

  // Detail: View on the eligible row shows Receive Vehicle.
  await page.goto(BASE + "/preview/auction", { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  await page.getByPlaceholder("Search by VIN, Lot #, Stock #, Make, Model…").fill(fixtures.eligible.vin);
  row = page.locator("tbody tr", { hasText: fixtures.eligible.vin });
  await row.waitFor({ state: "visible", timeout: 30_000 });
  await row.getByRole("button", { name: "View", exact: true }).click();
  const detailReceive = page.getByRole("button", { name: "Receive Vehicle", exact: true });
  await detailReceive.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  check(`eligible vehicle detail shows Receive Vehicle at ${tag}`, await detailReceive.isVisible().catch(() => false));
  const detailOverflow = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  check(`vehicle detail has no overflow at ${tag}`, detailOverflow.scroll <= detailOverflow.inner + 1, `inner=${detailOverflow.inner} scroll=${detailOverflow.scroll}`);

  // Not eligible: received, closed, dismantled never show Receive Vehicle in the row menu.
  for (const name of ["received", "closed", "dismantled"]) {
    await page.goto(BASE + "/preview/auction", { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
    await page.getByPlaceholder("Search by VIN, Lot #, Stock #, Make, Model…").fill(fixtures[name].vin);
    await openRowMenu(page, fixtures[name].vin);
    const shown = await page.getByRole("menuitem", { name: "Receive Vehicle" }).isVisible().catch(() => false);
    check(`${name} vehicle does not show Receive Vehicle at ${tag}`, !shown);
    await page.keyboard.press("Escape");
  }
  await context.close();
}
await browser.close();
console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
console.log(`screenshots: ${shotDir}`);
process.exit(fail === 0 ? 0 : 1);
