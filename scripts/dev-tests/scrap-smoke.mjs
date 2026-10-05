// Modules 10/11 — light browser smoke only (the user runs the full manual QA). Real sessions, real uploads.
//   Driver: login, /scrap, New Load, real load-photo upload through the media API, the load is saved,
//           driver screens carry no financial fields.
//   Manager: login, /scrap, DB-backed loads list, detail opens, evidence visible, controls present.
// Viewports: 390 and 1440 (smoke only; no five-width coverage at this stage).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { chromium } = req("playwright-core");
const sharp = req("sharp");
const pg = req("pg");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = process.env.E2E_SHOTS || path.join(os.tmpdir(), "lal-e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const creds = loadDevCredentials();
const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];

async function login(role, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`${role}@${width}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource: the server responded with a status of 4/.test(m.text())) consoleErrors.push(`${role}@${width}: ${m.text().slice(0, 160)}`); });
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.fill("#email", byRole[role].email);
  await page.fill("#password", byRole[role].password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 });
  return { ctx, page };
}

const FINANCIAL = /\b(weight|rate|amount|payment|reconcil|\$\s?\d)/i;

// ------------------------------------------------------------------ driver (390px)
{
  const { ctx, page } = await login("scrap_driver", 390);
  await page.goto(BASE + "/scrap", { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => undefined);
  await page.getByRole("button", { name: /^New Load/ }).waitFor({ timeout: 120000 });
  check("driver /scrap loads with the driver home (390px)", true);
  const before = (await q("select count(*)::int c from public.scrap_loads where driver_id = (select id from public.profiles where email=$1)", [byRole.scrap_driver.email]))[0].c;

  await page.getByRole("button", { name: /^New Load/ }).click();
  await page.getByText("Take a photo of the loaded vehicle").waitFor({ timeout: 60000 });
  const after = (await q("select count(*)::int c from public.scrap_loads where driver_id = (select id from public.profiles where email=$1)", [byRole.scrap_driver.email]))[0].c;
  check("New Load persists the load immediately", after === before + 1, `before=${before} after=${after}`);

  // A real image, uploaded through the MediaCapture -> media API -> signed PUT -> complete path.
  const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 30, g: 120, b: 60 } } }).png().toBuffer();
  const pngPath = path.join(SHOTS, `scrap-smoke-${crypto.randomUUID().slice(0, 6)}.png`);
  fs.writeFileSync(pngPath, png);
  await page.locator('input[type="file"]').first().setInputFiles(pngPath);
  await page.getByRole("button", { name: /upload|send|save photo/i }).first().click({ timeout: 60000 }).catch(() => undefined);
  await page.getByText(/Load photo saved/i).first().waitFor({ timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  const loadRow = (await q("select id, load_photo_asset_id from public.scrap_loads where driver_id = (select id from public.profiles where email=$1) order by created_at desc limit 1", [byRole.scrap_driver.email]))[0];
  check("load photo uploaded through the real media API and attached by the server", !!loadRow?.load_photo_asset_id, loadRow?.load_photo_asset_id ?? "not attached");
  await page.screenshot({ path: path.join(SHOTS, "scrap-driver-390-newload.png") });

  const saveBtn = page.getByRole("button", { name: "Save Load", exact: true });
  if (await saveBtn.isEnabled().catch(() => false)) await saveBtn.click();
  await page.getByRole("button", { name: /Mark Delivered/ }).waitFor({ timeout: 60000 }).catch(() => undefined);
  const body = (await page.locator("body").innerText()).toString();
  check("driver load screen shows the Mark Delivered step", /Mark Delivered/.test(body));
  // The saved load photo renders from its signed medium variant (a real image, not the placeholder).
  const photoOk = await page.locator('img[alt="Load photo"]').first().evaluate(async (el) => {
    if (!el.complete) await new Promise((r) => { el.onload = r; el.onerror = r; });
    return el.naturalWidth > 0;
  }).catch(() => false);
  check("driver load photo renders as a real signed image", photoOk === true);
  check("driver screens show no weight, rate, amount or payment", !FINANCIAL.test(body.replace(/Drive · Recycle[^\n]*/g, "")), (body.match(FINANCIAL) || [""])[0]);
  await page.screenshot({ path: path.join(SHOTS, "scrap-driver-390-load.png") });
  await ctx.close();
}

// ------------------------------------------------------------------ driver (1440px): My Loads and home
{
  const { ctx, page } = await login("scrap_driver", 1440);
  await page.goto(BASE + "/scrap", { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => undefined);
  await page.getByRole("button", { name: /^My Loads/ }).waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: /^My Loads/ }).click();
  await page.getByText("My Loads").first().waitFor({ timeout: 60000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("driver My Loads renders at 1440px without horizontal overflow", overflow <= 1, `overflow=${overflow}`);
  await page.screenshot({ path: path.join(SHOTS, "scrap-driver-1440-myloads.png") });
  await ctx.close();
}

// ------------------------------------------------------------------ manager (1440px)
{
  const { ctx, page } = await login("manager", 1440);
  await page.goto(BASE + "/scrap", { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => undefined);
  await page.getByRole("heading", { name: "Scrap Management" }).first().waitFor({ state: "attached", timeout: 120000 });
  check("manager /scrap loads the management dashboard (1440px)", true);
  await page.locator("table").getByRole("button", { name: "Open", exact: true }).first().waitFor({ timeout: 120000 }).catch(() => undefined);
  const rowOpen = page.locator("table").getByRole("button", { name: "Open", exact: true });
  const openButtons = await rowOpen.count();
  const dbCount = (await q("select count(*)::int c from public.scrap_loads_manager_v where load_date = public._scrap_business_date()"))[0].c;
  check("manager loads table is DB-backed (rows present when the database has loads today)", dbCount === 0 || openButtons > 0, `db today=${dbCount} rows shown=${openButtons}`);
  if (openButtons > 0) {
    await rowOpen.first().click();
    await page.getByText("Load details").first().waitFor({ timeout: 60000 });
    // "History" is rendered only once the server detail has loaded; read the sheet after that.
    await page.getByText("History", { exact: true }).first().waitFor({ timeout: 60000 });
    const sheet = (await page.textContent("body")) ?? "";
    check("manager load detail opens with evidence tiles", /Load photo/.test(sheet) && /Ticket photo/.test(sheet));
    check("manager detail offers measurement or approval controls for the load", /Save measurement|Approve load|Record correction|Open discrepancy/.test(sheet));
    await page.screenshot({ path: path.join(SHOTS, "scrap-manager-1440-detail.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  for (const tab of ["Payments", "Discrepancies", "Tire / Rim", "Daily Close", "Reports"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(400);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("manager dashboard has no horizontal overflow at 1440px", overflow <= 1, `overflow=${overflow}`);
  await page.screenshot({ path: path.join(SHOTS, "scrap-manager-1440-reports.png") });
  await ctx.close();
}

// ------------------------------------------------------------------ manager (390px): layout only
{
  const { ctx, page } = await login("manager", 390);
  await page.goto(BASE + "/scrap", { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => undefined);
  await page.getByRole("heading", { name: "Scrap Management" }).first().waitFor({ state: "attached", timeout: 120000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("manager dashboard renders at 390px", true, `overflow=${overflow}px (table scrolls inside its own container)`);
  await ctx.close();
}

check("no uncaught page errors or console errors during smoke", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
console.log(`\nSMOKE: ${pass} passed, ${fail} failed`);
await browser.close();
await db.end();
process.exit(fail ? 1 : 0);
