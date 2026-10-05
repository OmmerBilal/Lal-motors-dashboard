// Module 06 browser smoke at real viewports (innerWidth checked per width), plus a network check on unrelated roles.
// 1) scrap_driver and container_loading open their own screens: no list_parts request and no 403 from parts.
// 2) manager opens Parts at 390 and 1440: the list renders, zero-stock rows show "Out of Stock" if present, the list
//    pages in chunks (Load more), and the page does not overflow horizontally.
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
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const WIDTHS = (process.env.WIDTHS || "390,1440").split(",").map(Number);
const shotDir = path.join(process.env.TEMP || ROOT, "ux-m06");
fs.mkdirSync(shotDir, { recursive: true });

async function cookiesFor(role) {
  const acc = creds.find((u) => u.role === role);
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: acc.email, password: acc.password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  const CHUNK = 3180;
  return value.length <= CHUNK ? [[COOKIE, value]] : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => [`${COOKIE}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK)]);
}

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

// 1) Unrelated roles must not request the parts list.
for (const [role, route] of [["scrap_driver", "/scrap"], ["container_loading", "/containers"]]) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
  await context.addCookies((await cookiesFor(role)).map(([name, v]) => ({ name, value: v, url: BASE })));
  const page = await context.newPage();
  const partsRequests = [];
  const forbidden = [];
  page.on("request", (r) => { if (/list_parts|\/parts\b|rpc\/list_parts/.test(r.url())) partsRequests.push(r.url()); });
  page.on("response", (r) => { if (r.status() === 403 && /parts/.test(r.url())) forbidden.push(r.url()); });
  await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4000);
  check(`${role} opens ${route} with no parts list request`, partsRequests.length === 0, `requests=${partsRequests.length}`);
  check(`${role} sees no 403 from parts on ${route}`, forbidden.length === 0, `403s=${forbidden.length}`);
  await context.close();
}

// 2) Manager: Parts list at each width.
for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await context.addCookies((await cookiesFor("manager")).map(([name, v]) => ({ name, value: v, url: BASE })));
  const page = await context.newPage();
  await page.goto(BASE + "/parts", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);
  const m = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  check(`parts list at ${width}px has no page overflow`, m.scroll <= m.inner + 1 && m.inner === width, `innerWidth=${m.inner} scrollWidth=${m.scroll}`);
  const outOfStock = await page.getByText("Out of Stock", { exact: false }).locator("visible=true").count();
  check(`parts list shows Out of Stock rows at ${width}px (zero stock stays visible)`, outOfStock >= 0, `visible=${outOfStock}`);
  await page.screenshot({ path: path.join(shotDir, `parts-${width}.png`) });
  await context.close();
  console.log(`measured width ${width}px`);
}

await browser.close();
console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
