// Targeted Module 08 check: POS add-to-cart only. In-stock fixture part must be addable and the zero-stock
// fixture must stay disabled. Each card is found by its exact SKU and checked against the fixture part id.
// Fixtures are created through real RPCs, the same way as e2e-sales-payments.mjs. Run with the app on E2E_BASE_URL.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const { chromium } = req("playwright-core");
const pg = req("pg");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
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
const newClient = () => createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function signIn(role) {
  const u = byRole[role];
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  return c;
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); return { data, error, msg: error?.message ?? "" }; };

// ------------------------------------------------------------------ fixtures (RPC + capture path)
const S = {};
for (const r of ["manager", "employee", "dismantling", "auction"]) S[r] = await signIn(r);
const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const tag = "E2E" + run;
const SRC = "E2ESRC-" + run;

async function sellablePart(n, price, qty = 1) {
  const vin = ("1E2" + run + String(n).padStart(8, "0")).slice(0, 17);
  const v = await rpc(S.auction, "match_or_create_vehicle", { p_vin: vin, p_lot_number: null, p_stock_number: "E" + run + n, p_auction_source: SRC, p_fields: { year: 2015, make: "Subaru", model: "Impreza", purchase_price: 200 } });
  if (v.error) throw new Error("vehicle: " + v.msg);
  const s = await rpc(S.dismantling, "start_dismantling_session", { p_vehicle_id: v.data.vehicle_id });
  const b = await rpc(S.dismantling, "begin_dismantled_part", { p_session_id: s.data.session_id, p_client_request_id: crypto.randomUUID() });
  const pid = b.data.part_id;
  await q(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, status) values ('part', $1, 'capture', 'original', 'operational-media', $2, 'image/jpeg', 'ready')`, [pid, `e2e/${run}/${n}.jpg`]);
  const ap = await rpc(S.manager, "approve_dismantled_part", { p_part_id: pid });
  if (ap.error) throw new Error("approve: " + ap.msg);
  await rpc(S.manager, "update_part_fields", { p_part_id: pid, p_fields: { part_name: `${tag} Part ${n}`, price, location: "E2E " + n, test_status: "Tested", stock_sku: `E2E-${run}-${n}` } });
  await rpc(S.employee, "set_part_stage", { p_part_id: pid, p_stage: "in_processing" });
  const r = await rpc(S.manager, "set_part_stage", { p_part_id: pid, p_stage: "ready_for_sale" });
  if (r.error) throw new Error("ready: " + r.msg);
  if (qty !== 1) await db.query("update public.parts set quantity = $2 where id = $1", [pid, qty]);
  return pid;
}
const custRes = await rpc(S.manager, "create_customer", { p_data: { first_name: "Main", last_name: tag, phone: "555" + String(Math.floor(1000000 + Math.random() * 8999999)), confirm_new: true }, p_client_request_id: crypto.randomUUID() });
if (custRes.error) throw new Error("customer: " + custRes.msg);
const customerId = custRes.data.customer_id;
const P_IN = await sellablePart(2, 25, 1);   // in stock: quantity 1, available 1
const P_ZERO = await sellablePart(3, 15, 0); // zero stock: visible, Out of Stock, not addable
console.log(`fixtures: customer ${tag}, in-stock part ${P_IN} (E2E-${run}-2), zero part ${P_ZERO} (E2E-${run}-3)`);

// ------------------------------------------------------------------ browser
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false });
await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 180000 });
await page.fill("#email", byRole.manager.email);
await page.fill("#password", byRole.manager.password);
await page.getByRole("button", { name: "Log in", exact: true }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 });
await page.goto(BASE + "/sales", { waitUntil: "domcontentloaded", timeout: 180000 });
await page.getByRole("button", { name: "Sales Desk", exact: true }).waitFor({ timeout: 120000 });

// Select the customer: wait for the real list_customers response, click the option row by fixture id, then
// require the selected-customer header to show the fixture name. Same helper as e2e-sales-payments.mjs.
{
  const resp = page.waitForResponse((r) => r.url().includes("list_customers"), { timeout: 60000 });
  await page.getByPlaceholder("Name, phone, company or email").fill(tag);
  await resp;
  const option = page.locator(`[data-testid="pos-customer-option"][data-customer-id="${customerId}"]`);
  await option.waitFor({ timeout: 60000 });
  await option.click();
  await page.getByRole("button", { name: "Change", exact: true }).waitFor({ timeout: 15000 });
  await page.getByText(tag).first().waitFor({ timeout: 15000 });
}

const posCard = (sku) => page.locator(`[data-testid="pos-part-card"][data-sku="${sku}"]`);
async function search(name, sku) {
  const resp = page.waitForResponse((r) => r.url().includes("search_sellable_parts"), { timeout: 60000 });
  await page.getByPlaceholder("Part name, SKU or OEM number").fill(name);
  await resp;
  await posCard(sku).waitFor({ timeout: 60000 });
  return posCard(sku);
}

// 1. zero-stock fixture: visible, Out of Stock, Add disabled, and it is the fixture part
const zeroSku = `E2E-${run}-3`;
const zero = await search(`${tag} Part 3`, zeroSku);
await zero.getByText("Out of Stock", { exact: true }).waitFor({ timeout: 60000 });
check("zero-stock card is the fixture part (part id)", (await zero.getAttribute("data-part-id")) === P_ZERO, zeroSku);
check("zero-stock part shows Out of Stock", (await zero.getByText("Out of Stock", { exact: true }).count()) === 1);
const zeroAddDisabled = await zero.getByRole("button", { name: "Add", exact: true }).isDisabled();
check("zero-stock part Add is disabled", zeroAddDisabled === true);

// 2. in-stock fixture: its own card by SKU, Add enabled, identity matches
const inSku = `E2E-${run}-2`;
const inCard = await search(`${tag} Part 2`, inSku);
const addIn = inCard.getByRole("button", { name: "Add", exact: true });
check("in-stock card is the fixture part (part id)", (await inCard.getAttribute("data-part-id")) === P_IN, inSku);
check("in-stock card shows In stock", (await inCard.getByText("In stock · 1", { exact: true }).count()) === 1);
const inAddEnabled = await addIn.isEnabled();
check("in-stock part Add is enabled", inAddEnabled === true);
await shot("pos-targeted-before-add");
if (inAddEnabled) {
  await addIn.click();
  // The cart line is identified by its part id and SKU, not by the name (the result card also shows the name)
  const cartLine = page.locator(`[data-testid="pos-cart-line"][data-sku="${inSku}"]`);
  await cartLine.waitFor({ timeout: 30000 });
  check("cart has exactly one line for the in-stock fixture", (await cartLine.count()) === 1);
  check("cart line is the in-stock fixture part (part id)", (await cartLine.getAttribute("data-part-id")) === P_IN);
  check("cart line shows the fixture name", (await cartLine.getByText(`${tag} Part 2`, { exact: true }).count()) === 1);
  check("zero-stock fixture was not added to the cart", (await page.locator(`[data-testid="pos-cart-line"][data-sku="${zeroSku}"]`).count()) === 0);
}
await shot("pos-targeted-after-add");

// 3. zero-stock stays disabled after the add
// Search by SKU: a new query key, so the backend is asked again (a repeated name would be served from cache)
const zeroAfter = await search(zeroSku, zeroSku);
check("zero-stock Add still disabled after the add", (await zeroAfter.getByRole("button", { name: "Add", exact: true }).isDisabled()) === true);
check("zero-stock card identity still the fixture part", (await zeroAfter.getAttribute("data-part-id")) === P_ZERO);

// Database check: the in-stock part is still available and unchanged by adding to the cart (nothing consumed)
const qty = (await q("select quantity from public.parts where id=$1", [P_IN]))[0].quantity;
check("adding to the cart did not consume stock", qty === 1, `quantity=${qty}`);

console.log(`\n${pass} passed, ${fail} failed`);
await ctx.close();
await browser.close();
await db.end();
process.exit(fail ? 1 : 0);
