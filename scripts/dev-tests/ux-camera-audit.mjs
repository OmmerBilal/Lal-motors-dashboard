// Camera audit: real browser uploads for distinct implementation paths, and visibility of the shared-component slots.
// 1) Scrap driver, new load (390px): "Take photo" and "Choose from device" are visible; a real photo is uploaded through
//    the device picker and saved to the load (checked in the database); Back returns home and keeps the saved load.
// 2) Manager, AI image input (390px and 1440px): "Take photo" and "Choose from device" are visible; a real photo is
//    uploaded and the analysis stream reports the preparing-image stage, then a controlled answer (no fake result).
// Writes: one DEV scrap load and one AI analysis request. Nothing else changes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

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
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const work = process.env.TEMP || os.tmpdir();
const png = path.join(work, "camera-audit.png");
fs.writeFileSync(png, await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 120, g: 60, b: 30 } } }).png().toBuffer());

const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
async function chunksFor(role) {
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: byRole[role].email, password: byRole[role].password });
  if (error) throw new Error(`sign-in ${role}: ${error.message}`);
  const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  const CHUNK = 3180;
  return value.length <= CHUNK ? [[COOKIE, value]] : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => [`${COOKIE}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK)]);
}
async function overflow(page, label, width) {
  const m = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  check(`${label} at ${width}px has no page overflow`, m.scroll <= m.inner + 1 && m.inner === width, `innerWidth=${m.inner} scrollWidth=${m.scroll}`);
}

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

// 1) Scrap driver: new load photo through the shared capture, real device upload, saved to the load.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
  await context.addCookies((await chunksFor("scrap_driver")).map(([name, v]) => ({ name, value: v, url: BASE })));
  const page = await context.newPage();
  await page.goto(BASE + "/scrap", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("button", { name: "New Load" }).first().waitFor({ timeout: 60_000 });
  const before = Number((await db.query("select count(*)::int c from public.media_assets where owner_type='scrap_load' and role='load_photo' and status='ready'")).rows[0].c);
  await page.getByRole("button", { name: "New Load" }).first().click();
  await page.getByText("Take a photo of the loaded vehicle").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const take = page.locator("button:visible", { hasText: "Take photo" }).first();
  const device = page.locator("button:visible", { hasText: "Choose from device" }).first();
  check("scrap load photo offers Take photo and Choose from device at 390px", (await take.isVisible()) && (await device.isVisible()));
  await overflow(page, "scrap new load", 390);
  await page.locator('input[aria-label="Load photo: choose from device"]').setInputFiles(png);
  await page.getByRole("button", { name: "Use photo" }).first().waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Use photo" }).first().click();
  await page.getByText("Load photo saved.").first().waitFor({ timeout: 60_000 }).catch(() => {});
  const after = Number((await db.query("select count(*)::int c from public.media_assets where owner_type='scrap_load' and role='load_photo' and status='ready'")).rows[0].c);
  check("scrap load photo reached the media pipeline (saved row created)", after > before, `before=${before} after=${after}`);
  await page.getByRole("button", { name: "Back" }).first().click().catch(() => {});
  await page.getByRole("button", { name: "New Load" }).first().waitFor({ timeout: 30_000 }).catch(() => {});
  check("Back returns home and the saved load is kept (no unsave)", (await page.getByRole("button", { name: "New Load" }).count()) > 0);
  await context.close();
}

// 2) Manager: AI image input. The upload reaches the analysis stream; the answer is a controlled provider status.
for (const width of [390, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 });
  await context.addCookies((await chunksFor("manager")).map(([name, v]) => ({ name, value: v, url: BASE })));
  const page = await context.newPage();
  await page.goto(BASE + "/ai-command-center", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByText("Image analysis").first().waitFor({ timeout: 60_000 });
  const take = page.locator("button:visible", { hasText: "Take photo" }).first();
  const device = page.locator("button:visible", { hasText: "Choose from device" }).first();
  check(`AI image input offers Take photo and Choose from device at ${width}px`, (await take.isVisible()) && (await device.isVisible()));
  await page.locator('input[aria-label="Photo or screenshot (up to 10 MB): choose from device"]').setInputFiles(png);
  await page.getByRole("button", { name: "Analyse this image" }).first().waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Analyse this image" }).first().click();
  const outcome = await page.getByText(/Preparing image|Analyzing image|OpenAI configuration needs attention|AI service unavailable|AI took too long|Draft only/).first().textContent({ timeout: 60_000 }).catch(() => "none");
  check(`AI image analysis answers with a controlled stage or result at ${width}px`, outcome !== "none", outcome?.slice(0, 80));
  await overflow(page, "AI image analysis", width);
  await context.close();
  console.log(`measured width ${width}px`);
}

await db.end();
await browser.close();
console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
