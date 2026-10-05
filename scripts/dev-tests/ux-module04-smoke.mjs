// Module 04 browser smoke (Dismantling Employee App) at real viewports (innerWidth checked per width).
// Read-only: home menu -> Vehicle Dismantling find screen (scan controls honest) -> a search that is not found.
// It does not start a dismantling session, so no DEV vehicle is changed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { chromium } = req("playwright-core");
const { createClient } = req("@supabase/supabase-js");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
const account = creds.find((u) => u.role === "dismantling");
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const WIDTHS = (process.env.WIDTHS || "390,430,768").split(",").map(Number);

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
  await page.goto(BASE + "/dismantling", { waitUntil: "domcontentloaded", timeout: 60_000 });
  const vehicleBtn = page.getByRole("button", { name: /Vehicle Dismantling/ }).first();
  await vehicleBtn.waitFor({ timeout: 60_000 });
  check(`home offers Vehicle Dismantling and Quick Part Capture at ${width}px`, await page.getByText("Quick Part Capture").first().isVisible());
  await overflow(page, "dismantling home", width);
  const h = await vehicleBtn.evaluate((el) => el.getBoundingClientRect().height);
  check(`"Vehicle Dismantling" is a large touch target at ${width}px`, h >= 44, `height=${h}`);

  await vehicleBtn.click();
  await page.getByText(/Scan or search to load a vehicle/).waitFor({ timeout: 20_000 });
  const scanNotConnected = await page.getByText("Scan VIN (not connected)").count();
  check(`scan controls say they are not connected at ${width}px`, scanNotConnected > 0);
  await overflow(page, "find vehicle", width);

  const input = page.getByRole("textbox").first();
  await input.fill("ZZ-NOT-A-REAL-VIN-0000");
  await page.getByRole("button", { name: /search|find|look/i }).first().click().catch(() => input.press("Enter"));
  await page.getByText(/not found|No vehicle|couldn.t find/i).first().waitFor({ timeout: 20_000 }).catch(() => {});
  const notFound = await page.getByText(/not found|No vehicle|couldn.t find/i).count();
  check(`an unknown search reports Not Found at ${width}px`, notFound > 0);
  await overflow(page, "not found state", width);
  await page.screenshot({ path: path.join(process.env.TEMP || ROOT, `m04-${width}.png`) });
  await context.close();
  console.log(`measured width ${width}px`);
}

await browser.close();
console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
