// Module 01 workflow browser smoke with real Playwright viewports (innerWidth is checked and reported per width).
// Flow: intake (paste) -> review -> existing-match comparison -> Back keeps the pasted text -> scan screen shows
// Take photo and Choose from device -> vehicle list -> vehicle detail. Overflow is checked on every step.
// Uses a real DEV fixture: a TMRG-* vehicle created by rpc-vehicle-merge.mjs. Run that test first.
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
const creds = loadDevCredentials();
const account = creds.find((u) => u.role === "manager");
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const WIDTHS = (process.env.WIDTHS || "390,430,768,1440").split(",").map(Number);
const shotDir = path.join(process.env.TEMP || ROOT, "ux-m01");
fs.mkdirSync(shotDir, { recursive: true });

const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const fixture = (await db.query("select vin, lot_number from public.vehicles where vin like 'TMRG%' order by created_at desc limit 1")).rows[0];
await db.end();
if (!fixture) { console.log("FAIL | no TMRG fixture; run rpc-vehicle-merge.mjs first"); process.exit(1); }

const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const { data, error } = await c.auth.signInWithPassword({ email: account.email, password: account.password });
if (error) { console.log("FAIL | sign-in"); process.exit(1); }
const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
const CHUNK = 3180;
const chunks = value.length <= CHUNK ? [[COOKIE, value]] : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => [`${COOKIE}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK)]);

const browser = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

async function overflow(page, label, width) {
  const m = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  check(`${label} at ${width}px has no page overflow`, m.scroll <= m.inner + 1 && m.inner === width, `innerWidth=${m.inner} scrollWidth=${m.scroll}`);
}

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await context.addCookies(chunks.map(([name, v]) => ({ name, value: v, url: BASE })));
  const page = await context.newPage();
  await page.goto(BASE + "/vehicles", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByText("Auction Vehicle Inventory").first().waitFor({ timeout: 60_000 });

  // Intake: single paste of the fixture's identifiers.
  await page.getByRole("button", { name: /Single Vehicle Paste/ }).first().click();
  const source = page.locator("#intake-source");
  await source.fill(`VIN ${fixture.vin} Lot ${fixture.lot_number ?? ""} 2019 Ford Focus`);
  await overflow(page, "intake (single paste)", width);
  const sizeOk = await page.getByRole("button", { name: "Check vehicles" }).evaluate((el) => el.getBoundingClientRect().height >= 40);
  check(`"Check vehicles" is a large touch target at ${width}px`, sizeOk);
  await page.getByRole("button", { name: "Check vehicles" }).click();

  // Review: the existing vehicle is found and its row can be opened for the comparison.
  await page.getByText(/vehicles detected/).waitFor({ timeout: 20_000 });
  await overflow(page, "review", width);
  await page.getByRole("button", { name: /Select/ }).first().waitFor({ timeout: 10_000 }).catch(() => {});
  const row = page.locator("button", { hasText: /EXISTING VEHICLE|CONFLICT/ }).first();
  // The match check runs after the review appears; wait for its row before opening it.
  await row.waitFor({ timeout: 60_000 });
  await row.click();
  await page.getByText("EXISTING VEHICLE FOUND").waitFor({ timeout: 20_000 });
  await overflow(page, "existing-match comparison", width);
  const keepBtn = page.getByRole("button", { name: "Keep current" }).first();
  check(`"Keep current" is tappable at ${width}px`, (await keepBtn.evaluate((el) => el.getBoundingClientRect().height)) >= 40);
  await page.screenshot({ path: path.join(shotDir, `merge-${width}.png`) });

  // Back keeps the pasted text.
  await page.getByRole("button", { name: "Back to intake (text kept)" }).click();
  const kept = await page.locator("#intake-source").inputValue().catch(() => "");
  check(`Back from review keeps the pasted text at ${width}px`, kept.includes(fixture.vin), `length=${kept.length}`);

  // Scan screen: both capture actions are visible for a manager.
  await page.getByRole("button", { name: "AI Photo / Screenshot Scan" }).first().click();
  const take = page.getByRole("button", { name: "Take photo" }).first();
  const device = page.getByRole("button", { name: "Choose from device" }).first();
  check(`"Take photo" and "Choose from device" are both visible at ${width}px`, (await take.isVisible()) && (await device.isVisible()));
  await overflow(page, "scan (photo intake)", width);

  // Vehicle list and detail.
  await page.goto(BASE + "/vehicles", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByText("Auction Vehicle Inventory").first().waitFor({ timeout: 60_000 });
  await overflow(page, "vehicle home", width);
  const view = page.getByRole("button", { name: "View", exact: true }).first();
  if (await view.count()) {
    await view.click();
    await page.getByText("Full record history").waitFor({ timeout: 20_000 });
    await overflow(page, "vehicle detail", width);
    await page.screenshot({ path: path.join(shotDir, `detail-${width}.png`) });
  }
  await context.close();
  console.log(`measured width ${width}px`);
}

await browser.close();
console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
console.log(`screenshots: ${shotDir}`);
process.exit(fail === 0 ? 0 : 1);
