// Module 03 browser smoke (receiving) with real Playwright viewports and a real media upload through the device picker.
// Flow: VIN lookup -> match -> front photo uploaded through the real media pipeline -> reload (return) -> lookup again
// -> the saved photo is shown from the server. Overflow is checked on every step. Receiving itself is NOT confirmed,
// so the fixture vehicle stays inbound (the final transaction is covered by the RPC tests).
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
const account = creds.find((u) => u.role === "receiving");
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const WIDTHS = (process.env.WIDTHS || "390,1440").split(",").map(Number);
const work = process.env.TEMP || os.tmpdir();
const shotDir = path.join(work, "ux-m03");
fs.mkdirSync(shotDir, { recursive: true });

const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const fixture = (await db.query("select id, vin from public.vehicles where closed_reason is null and receiving_status='not_received' and transport_status in ('ASSIGNED','IN_TRANSIT') order by created_at desc limit 1")).rows[0];
if (!fixture) { console.log("FAIL | no inbound fixture vehicle"); process.exit(1); }
const savedCount = async () => Number((await db.query("select count(*)::int c from public.media_assets where owner_type='vehicle' and owner_id=$1 and role='arrival_front' and variant='original' and status='ready'", [fixture.id])).rows[0].c);
const beforeSaved = await savedCount();

const png = path.join(work, "m03-front.png");
fs.writeFileSync(png, await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 30, g: 90, b: 160 } } }).png().toBuffer());

const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const { data, error } = await c.auth.signInWithPassword({ email: account.email, password: account.password });
if (error) { console.log("FAIL | sign-in"); process.exit(1); }
const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
const CHUNK = 3180;
const chunks = value.length <= CHUNK ? [[COOKIE, value]] : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => [`${COOKIE}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK)]);

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
async function overflow(page, label, width) {
  const m = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  check(`${label} at ${width}px has no page overflow`, m.scroll <= m.inner + 1 && m.inner === width, `innerWidth=${m.inner} scrollWidth=${m.scroll}`);
}
async function lookup(page) {
  await page.getByPlaceholder("17-character VIN").fill(fixture.vin);
  await page.getByRole("button", { name: "Search VIN" }).click();
  await page.getByText("Take Arrival Photos").first().waitFor({ timeout: 30_000 });
}

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await context.addCookies(chunks.map(([name, v]) => ({ name, value: v, url: BASE })));
  const page = await context.newPage();
  await page.goto(BASE + "/vehicle-receiving", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByPlaceholder("17-character VIN").waitFor({ timeout: 60_000 });
  await lookup(page);
  await overflow(page, "receiving match", width);

  const alreadySaved = (await savedCount()) > 0;
  if (!alreadySaved) {
    const take = page.locator("button:visible", { hasText: "Take photo" }).first();
    const device = page.locator("button:visible", { hasText: "Choose from device" }).first();
    check(`front slot offers "Take photo" and "Choose from device" at ${width}px`, (await take.isVisible()) && (await device.isVisible()));
    const tapH = await take.evaluate((el) => el.getBoundingClientRect().height);
    check(`"Take photo" is a tappable size at ${width}px`, tapH >= 40, `height=${tapH}`);

    // Real upload through the device picker, then "Use photo".
    await page.locator('input[aria-label="Front View: choose from device"]').setInputFiles(png);
    await page.getByRole("button", { name: "Use photo" }).first().waitFor({ timeout: 15_000 });
    await overflow(page, "photo preview", width);
    await page.getByRole("button", { name: "Use photo" }).first().click();
    await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 60_000 });
    check(`front photo upload saved through the media pipeline at ${width}px`, (await savedCount()) > beforeSaved);
  } else {
    check(`front photo already saved on the server (from an earlier width) at ${width}px`, true);
  }

  // Return: reload the page and search the same vehicle again. The saved photo must come back from the server.
  await page.goto(BASE + "/vehicle-receiving", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByPlaceholder("17-character VIN").waitFor({ timeout: 60_000 });
  await lookup(page);
  await page.getByAltText("Front View saved photo").waitFor({ timeout: 30_000 }).catch(() => {});
  const shown = await page.getByAltText("Front View saved photo").count();
  check(`saved front photo is shown again after returning at ${width}px`, shown > 0);
  await overflow(page, "receiving after return", width);
  await page.screenshot({ path: path.join(shotDir, `receiving-${width}.png`) });
  await context.close();
  console.log(`measured width ${width}px`);
}

await db.end();
await browser.close();
console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
console.log(`screenshots: ${shotDir}`);
process.exit(fail === 0 ? 0 : 1);
