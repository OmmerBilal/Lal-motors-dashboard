// Module 02 browser smoke with real Playwright viewports (innerWidth is checked per width).
// Flow: Central Dispatch -> pickup groups -> open a group -> select a vehicle -> post preview (Not Connected, writes
// nothing: the posted count in the database must not change) -> dispatch dialog opens -> overflow checked each step.
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
const WIDTHS = (process.env.WIDTHS || "390,1440").split(",").map(Number);
const shotDir = path.join(process.env.TEMP || ROOT, "ux-m02");
fs.mkdirSync(shotDir, { recursive: true });

const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const postedCount = async () => Number((await db.query("select count(*)::int c from public.vehicles where transport_status='POSTED_TO_CD'")).rows[0].c);

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

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await context.addCookies(chunks.map(([name, v]) => ({ name, value: v, url: BASE })));
  const page = await context.newPage();
  await page.goto(BASE + "/central-dispatch", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByText("Central Dispatch / Transportation").first().waitFor({ timeout: 60_000 });
  await page.getByText("Not Connected · UI Preview").first().waitFor({ timeout: 20_000 });
  check(`"Not Connected · UI Preview" is visible at ${width}px`, true);
  await overflow(page, "dispatch home", width);

  // Open the first pickup group; its vehicles load on demand.
  const openBtn = page.locator('button[aria-label^="Open "]:not([aria-label="Open navigation"])').first();
  await openBtn.waitFor({ timeout: 30_000 });
  await openBtn.click();
  const vehicleCheckbox = page.locator('table [role="checkbox"]').first();
  await vehicleCheckbox.waitFor({ timeout: 30_000 });
  await overflow(page, "opened pickup group", width);
  await vehicleCheckbox.click();

  // Bulk actions appear and are tappable.
  const postBtn = page.getByRole("button", { name: "Post to Central Dispatch" }).first();
  await postBtn.waitFor({ timeout: 10_000 });
  const h = await postBtn.evaluate((el) => el.getBoundingClientRect().height);
  check(`"Post to Central Dispatch" is a tappable size at ${width}px`, h >= 40, `height=${h}`);
  await overflow(page, "selection bar", width);

  // The post preview writes nothing: the posted count stays the same.
  const before = await postedCount();
  await postBtn.click();
  await page.getByText("Not Connected · UI Preview.").first().waitFor({ timeout: 10_000 });
  check(`post preview states Not Connected at ${width}px`, true);
  await overflow(page, "post preview", width);
  await page.getByRole("button", { name: "Close", exact: true }).first().click();
  const after = await postedCount();
  check(`posting preview changes no vehicle status at ${width}px`, before === after, `posted before=${before} after=${after}`);

  // Dispatch to carrier dialog opens with the selected vehicle.
  await page.getByRole("button", { name: "Dispatch to Carrier" }).first().click();
  await page.getByRole("heading", { name: "Dispatch to Carrier" }).waitFor({ timeout: 10_000 });
  await overflow(page, "dispatch dialog", width);
  await page.keyboard.press("Escape");

  await page.screenshot({ path: path.join(shotDir, `dispatch-${width}.png`) });
  await context.close();
  console.log(`measured width ${width}px`);
}

await db.end();
await browser.close();
console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
console.log(`screenshots: ${shotDir}`);
process.exit(fail === 0 ? 0 : 1);
