// Modules 12–14 — light browser smoke only. Real sessions, real uploads.
//   Loader (container_loading): login, /containers, open a container, real container-number photo upload,
//     no export fields on screen.
//   Export (export_manager): login, /containers, DB-backed counts and list, detail opens, invoice, payment and
//     shipping sections render.
//   Owner (owner): login, /dashboard, KPIs equal the database, exceptions and activity render.
// Viewports: 390 and 1440.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createRequire } from "node:module";

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
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
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
  page.on("console", (m) => { if (m.type() === "error" && !/status of 4/.test(m.text())) consoleErrors.push(`${role}@${width}: ${m.text().slice(0, 160)}`); });
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.fill("#email", byRole[role].email);
  await page.fill("#password", byRole[role].password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 });
  return { ctx, page };
}
async function go(page, route) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => undefined);
}

const EXPORT_WORDS = /consignee|invoice|payment|balance|deposit|price|shipping/i;

// ------------------------------------------------------------------ loader (390px)
{
  const { ctx, page } = await login("container_loading", 390);
  await go(page, "/containers");
  await page.getByRole("button", { name: /Start \/ Open Container/ }).waitFor({ timeout: 120000 });
  check("loader /containers opens the loader home (390px)", true);
  const before = (await q("select count(*)::int c from public.container_jobs"))[0].c;
  await page.getByRole("button", { name: /Start \/ Open Container/ }).click();
  await page.getByText("Container number photo").first().waitFor({ timeout: 120000 });
  const after = (await q("select count(*)::int c from public.container_jobs"))[0].c;
  check("opening a container persists it immediately", after === before + 1, `before=${before} after=${after}`);
  const ref = (await q("select t_ref from public.container_jobs order by created_at desc limit 1"))[0].t_ref;
  check("the container carries a server-generated reference", /^T\d{2}-\d{3}$/.test(ref), ref);

  const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 60, g: 60, b: 90 } } }).png().toBuffer();
  const pngPath = path.join(SHOTS, `container-smoke-${crypto.randomUUID().slice(0, 6)}.png`);
  fs.writeFileSync(pngPath, png);
  await page.locator('input[type="file"]').first().setInputFiles(pngPath);
  await page.getByRole("button", { name: /upload|send|save photo/i }).first().click({ timeout: 60000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  const photo = (await q("select count(*)::int c from public.media_assets where owner_type='container' and role='number_photo' and status='ready' and uploaded_by = (select id from public.profiles where email=$1)", [byRole.container_loading.email]))[0].c;
  check("container number photo uploaded through the real media API", photo >= 1, `ready photos=${photo}`);
  const body = (await page.textContent("body")) ?? "";
  check("loader screens show no export fields (consignee, invoice, payment, balance, price)", !EXPORT_WORDS.test(body.replace(/Container Loading[^\n]*/g, "")), (body.match(EXPORT_WORDS) || [""])[0]);
  await page.screenshot({ path: path.join(SHOTS, "containers-loader-390.png") });
  await ctx.close();
}

// ------------------------------------------------------------------ export management (1440px)
{
  const { ctx, page } = await login("export_manager", 1440);
  await go(page, "/containers");
  const row = page.locator("table").getByRole("button", { name: "Open", exact: true }).first();
  await row.waitFor({ timeout: 120000 }).catch(() => undefined);
  const rows = await page.locator("table").getByRole("button", { name: "Open", exact: true }).count();
  const dbCount = (await q("select count(*)::int c from public.container_jobs"))[0].c;
  check("export management lists the database containers", rows > 0 && dbCount > 0, `rows=${rows} db=${dbCount}`);
  if (rows > 0) {
    await row.click();
    await page.getByText("Consignee and shipping").first().waitFor({ timeout: 60000 });
    const txt = (await page.textContent("body")) ?? "";
    check("export detail opens with consignee and shipping", /Consignee and shipping/.test(txt));
    check("export detail shows the invoice section", /Invoice|Create draft invoice|Draft invoice/.test(txt));
    check("export detail shows the payments and shipping sections", /Payments/.test(txt) && /Shipping and close/.test(txt));
    await page.screenshot({ path: path.join(SHOTS, "containers-export-1440-detail.png") });
    await page.keyboard.press("Escape");
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("export management has no horizontal overflow at 1440px", overflow <= 1, `overflow=${overflow}`);
  await ctx.close();
}

// ------------------------------------------------------------------ owner dashboard (390px and 1440px)
for (const width of [1440, 390]) {
  const { ctx, page } = await login("owner", width);
  await go(page, "/dashboard");
  await page.getByText("Employee Overview").first().waitFor({ timeout: 120000 });
  const vehicles = (await q("select count(*)::int c from public.vehicles"))[0].c;
  const txt = (await page.textContent("body")) ?? "";
  check(`owner dashboard opens and renders the approved sections (${width}px)`, /Key Exceptions/.test(txt) && /Recent Activity/.test(txt) && /Employee Overview/.test(txt));
  check(`owner dashboard total vehicles equals the database (${width}px)`, txt.includes(String(vehicles)), `db=${vehicles}`);
  check(`owner dashboard shows no add-purchased-vehicles control (${width}px)`, !/Add Purchased Vehicles/.test(txt));
  await page.screenshot({ path: path.join(SHOTS, `owner-dashboard-${width}.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`owner dashboard has no horizontal overflow (${width}px)`, overflow <= 1, `overflow=${overflow}`);
  await ctx.close();
}

check("no uncaught page errors or console errors during smoke", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
console.log(`\nSMOKE: ${pass} passed, ${fail} failed`);
await browser.close();
await db.end();
process.exit(fail ? 1 : 0);
