// QA round: tab visibility keeps module state, Auction "Receive Vehicle" deep link, same-batch duplicates in Bulk Paste,
// and no React render-phase errors through Bulk Paste -> Review -> Confirm. Real browser (Chrome) against the DEV build.
// Writes: one DEV vehicle in the completion step (fresh TBATQ VIN). Nothing else is created. No vehicle is received.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

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
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;

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

// React errors and warnings. Resource 404s are not React errors and are not collected.
const reactErrors = [];
const REACT_PATTERN = /Cannot update a component|while rendering|Each child in a list|Warning: |Minified React error|Hydration failed|Maximum update depth/;
function watch(page, tag) {
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && REACT_PATTERN.test(m.text())) reactErrors.push(`${tag}: ${m.text().slice(0, 180)}`); });
  page.on("pageerror", (e) => reactErrors.push(`${tag} pageerror: ${e.message.slice(0, 180)}`));
}

async function openAs(role, width, route) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 });
  await context.addCookies((await chunksFor(role)).map(([name, v]) => ({ name, value: v, url: BASE })));
  const page = await context.newPage();
  watch(page, `${role}-${width}`);
  await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60_000 });
  return { context, page };
}

// Real focus change is not available to automation, so this dispatches the same events a tab switch fires.
async function visibilityCycle(page) {
  await page.evaluate(async () => {
    const set = (v) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => v === "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    set("hidden");
    await new Promise((r) => setTimeout(r, 400));
    set("visible");
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 2000));
  });
}
async function watchSessionFlash(page) {
  await page.evaluate(() => {
    window.__flash = 0;
    new MutationObserver(() => { if (document.body && /Loading session/.test(document.body.innerText)) window.__flash++; })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
const sessionFlashes = (page) => page.evaluate(() => window.__flash ?? -1);
async function markNode(page, selector, key) { await page.evaluate(([s, k]) => { window[k] = document.querySelector(s); }, [selector, key]); }
const sameNode = (page, selector, key) => page.evaluate(([s, k]) => !!window[k] && window[k] === document.querySelector(s), [selector, key]);

// VIN characters exclude I, O and Q, so the generated VINs are valid and parse as identifiers.
const VIN_ALPHABET = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
const randomVin = (prefix) => prefix + Array.from({ length: 17 - prefix.length }, () => VIN_ALPHABET[Math.floor(Math.random() * VIN_ALPHABET.length)]).join("");
const tag = Date.now().toString(36).toUpperCase().slice(-6);
const vinDup = randomVin("TZWD");
const vinNew = randomVin("TZWN");
const DUP_TEXT = [`${vinDup} 2020 Honda Accord White`, `${vinDup} 2020 Honda Accord Red`].join("\n");

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

// Database truth used to choose real vehicles for the deep-link checks. Read-only.
const eligible = (await db.query(`select id, vin from public.vehicles where closed_reason is null and receiving_status='not_received' and status <> 'Dismantled' and transport_status <> 'ARRIVED' and vin is not null and vin <> '' order by created_at desc limit 1`)).rows[0];
const dismantled = (await db.query(`select id, vin from public.vehicles where status='Dismantled' and vin is not null and vin <> '' order by created_at desc limit 1`)).rows[0];
const receivedRow = (await db.query(`select id, vin from public.vehicles where receiving_status='received' and closed_reason is null and vin is not null and vin <> '' order by created_at desc limit 1`)).rows[0];
check("DEV has an eligible Waiting/Transit vehicle to use", !!eligible, eligible ? "" : "no open not-received vehicle");

for (const width of [390, 1440]) {
  // 1) Auction intake: draft, review and Back survive a tab switch; no session reset.
  {
    const { context, page } = await openAs("auction", width, "/vehicles");
    await page.getByRole("button", { name: /Bulk Paste/ }).first().click();
    const area = page.locator("#intake-source");
    await area.waitFor({ timeout: 60_000 });
    await area.fill("DRAFT KEEP " + tag);
    await markNode(page, "#intake-source", "__area");
    const urlBefore = page.url();
    await watchSessionFlash(page);
    await visibilityCycle(page);
    check(`[${width}] intake: visibility cycle keeps route and typed draft`, page.url() === urlBefore && (await area.inputValue()) === "DRAFT KEEP " + tag, page.url());
    check(`[${width}] intake: no "Loading session" flash and same DOM node (no remount)`, (await sessionFlashes(page)) === 0 && (await sameNode(page, "#intake-source", "__area")), `flashes=${await sessionFlashes(page)}`);

    // 2) Same-batch duplicate: same VIN White then Red must not produce two ready rows.
    await area.fill(DUP_TEXT);
    await page.getByRole("button", { name: "Check vehicles" }).click();
    await page.getByText("Confirm & Add Verified Vehicles").first().waitFor({ timeout: 90_000 });
    const noneSelected = await page.getByRole("button", { name: /Confirm & Add Verified Vehicles \(0\)/ }).count();
    check(`[${width}] bulk duplicate pair (same VIN, White/Red): nothing ready to add`, noneSelected === 1, `confirm(0) buttons=${noneSelected}`);
    const dupLabels = await page.getByText(/DUPLICATE IN BATCH|conflict/i).count();
    check(`[${width}] bulk duplicate pair is labelled duplicate or conflict`, dupLabels >= 1, `labels=${dupLabels}`);

    // 3) Review focus away and return keeps the review and its node.
    await markNode(page, "main", "__main");
    await watchSessionFlash(page);
    await visibilityCycle(page);
    const stillReview = await page.getByText("Confirm & Add Verified Vehicles").first().isVisible();
    check(`[${width}] review: focus away and return keeps the review`, stillReview && (await sessionFlashes(page)) === 0, `visible=${stillReview} flashes=${await sessionFlashes(page)}`);
    await context.close();
  }

  // 4) Auction Receive Vehicle: eligible row opens Vehicle Receiving with the same vehicle preselected.
  if (eligible) {
    const { context, page } = await openAs("engineer_admin", width, "/vehicles");
    await page.getByPlaceholder("Search by VIN").fill(eligible.vin);
    const row = page.locator("tr", { hasText: eligible.vin }).first();
    await row.waitFor({ timeout: 45_000 });
    const btn = row.getByRole("button", { name: "Receive Vehicle" });
    check(`[${width}] eligible Waiting/Transit row offers Receive Vehicle`, (await btn.count()) === 1);
    await btn.click();
    await page.waitForURL(/vehicle-receiving\?vehicle=/, { timeout: 30_000 });
    check(`[${width}] Receive opens Vehicle Receiving with the same vehicle id`, page.url().endsWith("vehicle=" + eligible.id), page.url().split("?")[1]);
    await page.waitForFunction((v) => document.querySelector("#vin-manual")?.value === v, eligible.vin, { timeout: 30_000 }).catch(() => {});
    const preset = await page.locator("#vin-manual").inputValue().catch(() => "");
    check(`[${width}] VIN is preselected from the database, not retyped`, preset === eligible.vin, `value=${preset}`);
    await context.close();
  }

  // 5) Role and state rules on the Auction row.
  {
    const { context, page } = await openAs("auction", width, "/vehicles");
    if (eligible) {
      await page.getByPlaceholder("Search by VIN").fill(eligible.vin);
      const row = page.locator("tr", { hasText: eligible.vin }).first();
      await row.waitFor({ timeout: 45_000 }).catch(() => {});
      check(`[${width}] auction role (no receive right) sees no Receive Vehicle`, (await row.getByRole("button", { name: "Receive Vehicle" }).count()) === 0);
    }
    await context.close();
  }
  if (dismantled) {
    const { context, page } = await openAs("engineer_admin", width, "/vehicles");
    await page.getByPlaceholder("Search by VIN").fill(dismantled.vin);
    const row = page.locator("tr", { hasText: dismantled.vin }).first();
    const listed = await row.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
    check(`[${width}] dismantled vehicle has no Receive Vehicle`, listed && (await row.getByRole("button", { name: "Receive Vehicle" }).count()) === 0, listed ? "" : "row not listed");
    await context.close();
  }
  if (receivedRow) {
    const { context, page } = await openAs("engineer_admin", width, "/vehicles");
    await page.getByPlaceholder("Search by VIN").fill(receivedRow.vin);
    const row = page.locator("tr", { hasText: receivedRow.vin }).first();
    const listed = await row.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
    check(`[${width}] received vehicle shows Received and no Receive Vehicle`, listed && (await row.getByText("Received", { exact: true }).count()) === 1 && (await row.getByRole("button", { name: "Receive Vehicle" }).count()) === 0, listed ? "" : "row not listed");
    await context.close();
  }

  // 6) Receiving: the preselected vehicle survives a tab switch (receiving photo step), route unchanged.
  if (eligible) {
    const { context, page } = await openAs("receiving", width, `/vehicle-receiving?vehicle=${eligible.id}`);
    await page.waitForFunction((v) => document.querySelector("#vin-manual")?.value === v, eligible.vin, { timeout: 45_000 }).catch(() => {});
    const urlBefore = page.url();
    await watchSessionFlash(page);
    await visibilityCycle(page);
    const stillSelected = (await page.locator("#vin-manual").inputValue().catch(() => "")) === eligible.vin;
    check(`[${width}] receiving: visibility cycle keeps the preselected vehicle and route`, urlBefore.startsWith(BASE + "/vehicle-receiving") && stillSelected && page.url() === urlBefore);
    check(`[${width}] receiving: no session reset`, (await sessionFlashes(page)) === 0, `flashes=${await sessionFlashes(page)}`);
    await context.close();
  }

  // 7) Dismantling employee: visibility cycle keeps the screen content and route.
  {
    const { context, page } = await openAs("dismantling", width, "/dismantling");
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    const before = await page.evaluate(() => document.querySelector("main")?.innerText ?? "");
    const urlBefore = page.url();
    await watchSessionFlash(page);
    await visibilityCycle(page);
    const after = await page.evaluate(() => document.querySelector("main")?.innerText ?? "");
    check(`[${width}] dismantling: starts on /dismantling and keeps route and content through the cycle`, urlBefore === BASE + "/dismantling" && page.url() === urlBefore && before === after, `url=${page.url()}`);
    check(`[${width}] dismantling: no session reset`, (await sessionFlashes(page)) === 0);
    await context.close();
  }
  console.log(`measured width ${width}px`);
}

// 8) Completion path at 1440 only (writes one DEV vehicle): Bulk Paste -> Review -> Confirm, no React errors, no navigation.
{
  const { context, page } = await openAs("auction", 1440, "/vehicles");
  const errorsBefore = reactErrors.length;
  await page.getByRole("button", { name: /Bulk Paste/ }).first().click();
  const area = page.locator("#intake-source");
  await area.waitFor({ timeout: 60_000 });
  await area.fill(`${vinNew} 2021 Toyota Camry White`);
  const urlBefore = page.url();
  await page.getByRole("button", { name: "Check vehicles" }).click();
  await page.getByRole("button", { name: /Confirm & Add Verified Vehicles \(1\)/ }).waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: /Confirm & Add Verified Vehicles \(1\)/ }).click();
  await page.getByText(/created/).first().waitFor({ timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const created = Number((await db.query("select count(*)::int c from public.vehicles where vin=$1", [vinNew])).rows[0].c);
  check("completion: Confirm added the one new vehicle", created === 1, `rows=${created}`);
  check("completion: no unexpected navigation", page.url() === urlBefore, page.url());
  check("completion: 0 React render or console errors during Bulk Paste -> Review -> Confirm", reactErrors.length === errorsBefore, reactErrors.slice(errorsBefore).join(" || ").slice(0, 400));
  await context.close();
}

// 9) Genuine sign-out still redirects to /login.
{
  const { context, page } = await openAs("engineer_admin", 1440, "/vehicles");
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(/\/login/, { timeout: 30_000 }).catch(() => {});
  check("genuine sign-out redirects to /login", /\/login/.test(page.url()), page.url());
  await context.close();
}

await db.end();
await browser.close();
console.log(`React console and render errors recorded: ${reactErrors.length}`);
for (const line of reactErrors) console.log(`  recorded: ${line}`);
console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
