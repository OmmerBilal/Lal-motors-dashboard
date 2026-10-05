// Module 07 browser smoke (Customers in Sales) at real viewports (innerWidth checked per width).
// Read-only: open Sales, go to Customers, check the search field and no page overflow.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

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
const creds = loadDevCredentials();
const account = creds.find((u) => u.role === "manager");
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const WIDTHS = (process.env.WIDTHS || "390,1440").split(",").map(Number);

// A fresh sign-in per width: refresh tokens rotate, so one session cannot be shared across two browser contexts.
async function chunksForSession() {
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw new Error("sign-in: " + error.message);
  const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  const CHUNK = 3180;
  return value.length <= CHUNK ? [[COOKIE, value]] : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => [`${COOKIE}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK)]);
}

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  const chunks = await chunksForSession();
  await context.addCookies(chunks.map(([name, v]) => ({ name, value: v, url: BASE })));
  const page = await context.newPage();
  await page.goto(BASE + "/sales", { waitUntil: "domcontentloaded", timeout: 60_000 });
  const tab = page.locator('button:has-text("Customers")').first();
  await tab.waitFor({ state: "attached", timeout: 60_000 });
  await tab.click({ timeout: 15_000 }).catch(async () => { await tab.evaluate((el) => el.click()); });
  await page.waitForTimeout(1500);
  const search = page.getByPlaceholder("Name, phone, email, company, Customer ID or Tax ID").locator("visible=true").first();
  const hasSearch = await search.count();
  if (hasSearch) {
    await search.fill("zz-no-such-customer");
    await page.waitForTimeout(1000);
    check(`customer search field accepts input at ${width}px`, (await search.inputValue()) === "zz-no-such-customer");
  } else {
    check(`customer search field is reachable at ${width}px (open Customers first)`, false, "not on the default view");
  }
  const m = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  check(`sales and customers at ${width}px have no page overflow`, m.scroll <= m.inner + 1 && m.inner === width, `innerWidth=${m.inner} scrollWidth=${m.scroll}`);
  await context.close();
  console.log(`measured width ${width}px`);
}

await browser.close();
console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
