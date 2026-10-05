// Module 08 + 09 browser E2E and responsive QA. Local Chromium via playwright-core against the running app
// (npm run dev, port from E2E_BASE_URL). Fixtures are created through real RPCs and the capture path.
// Database values are read back through the verifier connection; the UI is never trusted for money.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

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
const creds = loadDevCredentials();
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
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); return { data, error, code: error?.code, hint: error?.hint, msg: error?.message ?? "" }; };

// ------------------------------------------------------------------ fixtures (RPC + capture path)
const S = {};
for (const r of ["manager", "owner", "engineer_admin", "employee", "dismantling", "receiving", "scrap_driver", "container_loading", "auction"]) S[r] = await signIn(r);
const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const tag = "E2E" + run;
const SRC = "E2ESRC-" + run;
const vehicles = [], sessions = [], parts = [], media = [];

async function sellablePart(n, price, qty = 1) {
  const vin = ("1E2" + run + String(n).padStart(8, "0")).slice(0, 17);
  const v = await rpc(S.auction, "match_or_create_vehicle", { p_vin: vin, p_lot_number: null, p_stock_number: "E" + run + n, p_auction_source: SRC, p_fields: { year: 2015, make: "Subaru", model: "Impreza", purchase_price: 200 } });
  if (v.error) throw new Error("vehicle: " + v.msg);
  vehicles.push(v.data.vehicle_id);
  const s = await rpc(S.dismantling, "start_dismantling_session", { p_vehicle_id: v.data.vehicle_id });
  sessions.push(s.data.session_id);
  const b = await rpc(S.dismantling, "begin_dismantled_part", { p_session_id: s.data.session_id, p_client_request_id: crypto.randomUUID() });
  const pid = b.data.part_id; parts.push(pid);
  const [m] = await q(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, status) values ('part', $1, 'capture', 'original', 'operational-media', $2, 'image/jpeg', 'ready') returning id`, [pid, `e2e/${run}/${n}.jpg`]);
  media.push(m.id);
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
const P_QUOTE = await sellablePart(1, 50, 1);       // Module 08 quote -> reserve -> fulfill
const P_POS = await sellablePart(2, 25, 1);         // POS fulfill-now -> out of stock
// Thumbnail fixture: a real PNG in the operational bucket with a ready thumbnail variant, linked the way the
// capture completion links it. Only P_POS gets one, so the POS shows both an image and the placeholder.
const admin = createClient(SUPA, envLocal.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
const sharp = req("sharp");
async function attachThumbnail(partId) {
  const png = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 180, g: 40, b: 40 } } }).png().toBuffer();
  const storagePath = `e2e/${run}/thumb-${partId}.png`;
  const up = await admin.storage.from("operational-media").upload(storagePath, png, { contentType: "image/png", upsert: true });
  if (up.error) throw new Error("thumbnail upload: " + up.error.message);
  const [m] = await q(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, status) values ('part', $1, 'capture', 'thumbnail', 'operational-media', $2, 'image/png', 'ready') returning id`, [partId, storagePath]);
  await db.query("update public.parts set thumbnail_asset_id = $2 where id = $1", [partId, m.id]);
}
await attachThumbnail(P_POS);
const P_ZERO = await sellablePart(3, 15, 0);        // zero stock: visible, Out of Stock, not addable
const P_STOCK5 = await sellablePart(4, 80, 5);      // extra stock for the reserve / release check
// Sale with balance for Module 09 (manual line, no stock)
const balSale = await rpc(S.manager, "create_sale", { p_customer_id: customerId, p_lines: [{ description: "E2E balance sale", quantity: 1, unit_price: 100, discount: 0 }], p_mode: "draft", p_client_request_id: crypto.randomUUID(), p_notes: "", p_discount: 0 });
if (balSale.error) throw new Error("balance sale: " + balSale.msg);
const BAL_SALE = balSale.data.sale_id;
const BAL_NUMBER = (await q("select sale_number from public.sales where id=$1", [BAL_SALE]))[0].sale_number;
const balTotal = Number((await q("select total from public.sales where id=$1", [BAL_SALE]))[0].total);
// Second customer, for the wrong-customer allocation check
const other = await rpc(S.manager, "create_customer", { p_data: { first_name: "Other", last_name: "Alt" + run, phone: "556" + String(Math.floor(1000000 + Math.random() * 8999999)), confirm_new: true }, p_client_request_id: crypto.randomUUID() });
const otherId = other.data.customer_id;
await rpc(S.manager, "create_sale", { p_customer_id: otherId, p_lines: [{ description: "Other sale", quantity: 1, unit_price: 40, discount: 0 }], p_mode: "draft", p_client_request_id: crypto.randomUUID(), p_notes: "", p_discount: 0 });
console.log(`fixtures: customer ${tag}, quote part, pos part, zero part, balance sale ${balTotal}`);

// ------------------------------------------------------------------ browser helpers
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
async function openApp(role, width = 1366, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.fill("#email", byRole[role].email);
  await page.fill("#password", byRole[role].password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 });
  return { ctx, page, dialogs };
}
async function gotoSales(page) {
  await page.goto(BASE + "/sales", { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.getByRole("button", { name: "Sales Desk", exact: true }).waitFor({ timeout: 120000 });
}
// Deterministic: wait for the real list_customers response for this search, then click the option row whose
// data-customer-id is the fixture customer (no retries, no first-match). Success = that customer's number is shown.
// customer_number is not assigned by create_customer (nullable, no generator), so the proof of identity is the
// fixture's unique name shown in the selected-customer header once the list is replaced by the selection.
async function selectCustomer(page, t, customerId) {
  const resp = page.waitForResponse((r) => r.url().includes("list_customers"), { timeout: 60000 });
  await page.getByPlaceholder("Name, phone, company or email").fill(t);
  await resp;
  const option = page.locator(`[data-testid="pos-customer-option"][data-customer-id="${customerId}"]`);
  await option.waitFor({ timeout: 60000 });
  await option.click();
  await page.getByRole("button", { name: "Change", exact: true }).waitFor({ timeout: 15000 });
  await page.getByText(t).first().waitFor({ timeout: 15000 });
}
// The POS result card is identified by its exact SKU (data-testid from part-result-card.tsx), never by
// text containing the name or by "first Add button": a text-based ancestor match can resolve to the whole results panel.
function posCard(page, sku) {
  return page.locator(`[data-testid="pos-part-card"][data-sku="${sku}"]`);
}
async function searchPart(page, name, sku) {
  const resp = page.waitForResponse((r) => r.url().includes("search_sellable_parts"), { timeout: 60000 });
  await page.getByPlaceholder("Part name, SKU or OEM number").fill(name);
  await resp;
  await posCard(page, sku).waitFor({ timeout: 60000 });
  return posCard(page, sku);
}
const tab = (page, name) => page.getByRole("button", { name, exact: true }).first().click();
async function toastText(page, re, t = 60000) {
  try {
    await page.getByText(re).first().waitFor({ timeout: t });
  } catch (err) {
    // Show what the page actually reported, so a failed expectation can be diagnosed from the log.
    console.log("DEBUG toasts at " + re + ": " + JSON.stringify(await page.locator("[data-sonner-toast]").allTextContents()));
    throw err;
  }
}
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false }); }

// ------------------------------------------------------------------ MODULE 08 — quote path (manager)
{
  const { ctx, page } = await openApp("manager");
  await gotoSales(page);
  await selectCustomer(page, tag, customerId);
  await (await searchPart(page, `${tag} Part 1`, `E2E-${run}-1`)).getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Save as Quote", exact: true }).click();
  const saved = await page.getByText(/^Q-\d+ saved$/).first().textContent({ timeout: 60000 });
  const quoteNumber = saved.split(" ")[0];
  const qRow = (await q("select id, status, total from public.quotes where quote_number=$1", [quoteNumber]))[0];
  check("M8 POS save-as-quote: server quote number and DRAFT row", !!qRow && qRow.status === "DRAFT", quoteNumber);
  await shot(page, "m8-quote-saved");

  await tab(page, "Quotes");
  await page.getByPlaceholder("Quote #, name").fill(quoteNumber);
  await page.getByRole("button", { name: new RegExp(quoteNumber) }).first().click();
  await page.getByRole("button", { name: "Mark Sent", exact: true }).click();
  await toastText(page, /marked sent/i);
  // Edit persists after reload: raise the unit price to 60
  await page.getByLabel("Unit price").first().fill("60");
  await page.getByRole("button", { name: "Save Quote Changes", exact: true }).click();
  await toastText(page, new RegExp(quoteNumber + " saved at"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sales Desk", exact: true }).waitFor({ timeout: 120000 });
  await tab(page, "Quotes");
  await page.getByPlaceholder("Quote #, name").fill(quoteNumber);
  await page.getByRole("button", { name: new RegExp(quoteNumber) }).first().click();
  const totalAfter = Number((await q("select total from public.quotes where id=$1", [qRow.id]))[0].total);
  check("M8 quote edit persists after reload (server total 60)", totalAfter === 60, `total=${totalAfter}`);
  await page.getByRole("button", { name: "Manager Approve", exact: true }).click();
  await toastText(page, /marked approved/i);
  check("M8 approve status in database", (await q("select status from public.quotes where id=$1", [qRow.id]))[0].status === "APPROVED");

  // Convert with RESERVE
  await page.getByRole("button", { name: "Reserve", exact: true }).click();
  await page.getByRole("button", { name: "Create Sale from Quote", exact: true }).click();
  await toastText(page, /Sale created from quote/i);
  const converted = (await q("select converted_sale_id from public.quotes where id=$1", [qRow.id]))[0].converted_sale_id;
  check("M8 conversion locks quote and links sale", !!converted);
  const resCount = (await q("select count(*)::int c from public.inventory_reservations where sale_id=$1 and status='active'", [converted]))[0].c;
  check("M8 RESERVE created one active reservation", resCount === 1, `active=${resCount}`);
  await page.getByText(/reserved · active/).first().waitFor({ timeout: 60000 });
  check("M8 sale detail shows the reservation state", true);
  await shot(page, "m8-sale-reserved");

  // Duplicate conversion retry is idempotent at the backend
  const retry = await rpc(S.manager, "convert_quote_to_sale", { p_quote_id: qRow.id, p_mode: "reserve" });
  check("M8 conversion retry returns the same sale", retry.data?.sale_id === converted && retry.data?.idempotent_replay === true);

  await page.getByRole("button", { name: "Fulfill reserved stock", exact: true }).click();
  await toastText(page, /Stock fulfilled/i);
  const qtyAfter = (await q("select quantity from public.parts where id=$1", [P_QUOTE]))[0].quantity;
  check("M8 fulfill reduces quantity 1 -> 0", qtyAfter === 0, `qty=${qtyAfter}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sales Desk", exact: true }).waitFor({ timeout: 120000 });
  await tab(page, "Sales & Invoices");
  const saleNum = (await q("select sale_number from public.sales where id=$1", [converted]))[0].sale_number;
  await page.getByPlaceholder("Sale #, name").fill(saleNum);
  await page.getByRole("button", { name: new RegExp(saleNum) }).first().click();
  await page.getByText(/fulfilled/).first().waitFor({ timeout: 60000 });
  check("M8 sale state persists after reload (fulfilled)", !(await page.getByRole("button", { name: "Fulfill reserved stock", exact: true }).count()));
  // Repeated fulfill fails safely at backend
  const again = await rpc(S.manager, "fulfill_sales_order", { p_sale_id: converted });
  check("M8 repeated fulfill is safe (no extra consumption)", !again.error && again.data?.fulfilled_lines === 0, again.msg);
  check("M8 repeated fulfill did not change quantity", (await q("select quantity from public.parts where id=$1", [P_QUOTE]))[0].quantity === 0);
  await ctx.close();
}

// ------------------------------------------------------------------ MODULE 08 — POS fulfill now and out of stock
{
  const { ctx, page } = await openApp("manager");
  const mediaCalls = [];
  page.on("request", (r) => { if (r.url().includes("/api/media/")) mediaCalls.push(new URL(r.url()).pathname); });
  await gotoSales(page);
  await selectCustomer(page, tag, customerId);
  const zeroCard = await searchPart(page, `${tag} Part 3`, `E2E-${run}-3`);
  await zeroCard.getByText("Out of Stock", { exact: true }).waitFor({ timeout: 60000 });
  check("M8 POS zero-stock card is the zero-stock fixture (part id)", (await zeroCard.getAttribute("data-part-id")) === P_ZERO);
  const zeroImgs = await zeroCard.locator("img").count();
  const zeroPlaceholders = await zeroCard.locator('[aria-label="No photo"]').count();
  check("M8 POS part without a thumbnail shows the placeholder", zeroImgs === 0 && zeroPlaceholders === 1, `img=${zeroImgs} placeholder=${zeroPlaceholders}`);
  check("M8 POS zero-stock part visible as Out of Stock and not addable", (await zeroCard.getByRole("button", { name: "Add", exact: true }).isDisabled()) === true);
  // In-stock fixture (qty 1): its own card by SKU; Add must be enabled and the card must be the fixture part.
  const inStock = await searchPart(page, `${tag} Part 2`, `E2E-${run}-2`);
  const addInStock = inStock.getByRole("button", { name: "Add", exact: true });
  check("M8 POS in-stock card is the fixture part (part id)", (await inStock.getAttribute("data-part-id")) === P_POS);
  check("M8 POS in-stock part Add button is enabled", await addInStock.isEnabled(), `sku=E2E-${run}-2`);
  // Thumbnails: the part with a photo shows a real signed image; the part without one shows the placeholder
  const thumb = inStock.locator("img");
  await thumb.waitFor({ timeout: 60000 });
  const naturalWidth = await thumb.evaluate(async (el) => { if (!el.complete) await new Promise((r) => { el.onload = r; el.onerror = r; }); return el.naturalWidth; });
  check("M8 POS thumbnail renders for the part that has one", naturalWidth > 0, `naturalWidth=${naturalWidth}`);
  const thumbSrc = await thumb.getAttribute("src");
  check("M8 POS thumbnail is a signed private URL and the page holds no service key", /\/object\/sign\//.test(thumbSrc) && !(await page.content()).includes(envLocal.secret_key));
  const served = await fetch(thumbSrc);
  check("M8 POS signed thumbnail URL is served as an image", served.status === 200 && (served.headers.get("content-type") || "").startsWith("image/"), `status=${served.status}`);
  await addInStock.click();
  await page.getByRole("button", { name: "Fulfill Now", exact: true }).click();
  const submit = page.getByRole("button", { name: "Fulfill Now & Save Sale", exact: true });
  await submit.waitFor({ timeout: 30000 });
  check("M8 POS cart received the in-stock part (save enabled)", await submit.isEnabled());
  await submit.dblclick();
  await page.getByText(/Sale S-\d+ saved/).first().waitFor({ timeout: 90000 });
  const posSale = (await q("select id, sale_number from public.sales where customer_id=$1 and fulfillment_status='fulfilled' order by created_at desc limit 1", [customerId]))[0];
  const salesMade = (await q("select count(*)::int c from public.sales where customer_id=$1", [customerId]))[0].c;
  check("M8 POS double-submit creates exactly one sale", salesMade === 3, `sales for customer=${salesMade} (balance fixture, quote-converted sale, one POS sale)`);
  check("M8 POS fulfill-now consumed the unit", (await q("select quantity from public.parts where id=$1", [P_POS]))[0].quantity === 0);
  check("M8 POS sale number from server", !!posSale && /^S-\d+$/.test(posSale.sale_number));
  await shot(page, "m8-pos-fulfilled");
  // Thumbnails are one signed batch per result set (no per-card media requests, no N+1). Counted on the POS
  // screen only: the Parts Inventory page that follows also loads thumbnails and is counted separately.
  const batches = mediaCalls.filter((p) => p.endsWith("/part-thumbnails")).length;
  const perCard = mediaCalls.filter((p) => p.endsWith("/api/media/url")).length;
  check("M8 POS thumbnails are batched (no per-card media requests)", perCard === 0 && batches >= 1 && batches <= 3, `batch requests=${batches} (3 POS searches), per-card=${perCard}`);
  // Parts inventory still contains the row and says Out of Stock
  await page.goto(BASE + "/parts", { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.getByRole("button", { name: "Parts Inventory", exact: true }).click();
  await page.getByPlaceholder(/Search by SKU/).fill(`E2E-${run}-2`);
  const oosVisible = await page.getByText("Out of Stock", { exact: true }).first().waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  check("M8 Parts Inventory keeps the part and shows Out of Stock", oosVisible);
  await shot(page, "m8-parts-oos");
  await ctx.close();
}

// ------------------------------------------------------------------ MODULE 08 — RESERVE, RELEASE, repeated RELEASE (RPC + stock)
{
  const sale = await rpc(S.manager, "create_sale", { p_customer_id: customerId, p_lines: [{ part_id: P_STOCK5, description: "E2E release line", quantity: 2, unit_price: 80 }], p_mode: "draft", p_client_request_id: crypto.randomUUID(), p_notes: "", p_discount: 0 });
  if (sale.error) throw new Error("release sale: " + sale.msg);
  const RS = sale.data.sale_id;
  const res = await rpc(S.manager, "reserve_stock", { p_sale_id: RS });
  check("M8 RESERVE on a stock sale reserves the line", !res.error && res.data?.reserved_lines === 1, res.msg);
  const held = await q("select quantity, status from public.inventory_reservations where sale_id=$1", [RS]);
  check("M8 reservation holds 2 units; physical quantity unchanged", held.length === 1 && held[0].quantity === 2 && held[0].status === "active" && (await q("select quantity from public.parts where id=$1", [P_STOCK5]))[0].quantity === 5);
  const avail = Number((await q("select public._available_quantity($1) a", [P_STOCK5]))[0].a);
  check("M8 available drops to 3 while reserved", avail === 3, `available=${avail}`);
  const rel = await rpc(S.manager, "release_reservation", { p_sale_id: RS });
  check("M8 RELEASE returns the reserved stock", !rel.error && rel.data?.released === 1, rel.msg || `released=${rel.data?.released}`);
  const after = await q("select status from public.inventory_reservations where sale_id=$1", [RS]);
  check("M8 released reservation is marked released", after.length === 1 && after[0].status === "released");
  const availAfter = Number((await q("select public._available_quantity($1) a", [P_STOCK5]))[0].a);
  check("M8 available returns to 5 after RELEASE", availAfter === 5, `available=${availAfter}`);
  const rel2 = await rpc(S.manager, "release_reservation", { p_sale_id: RS });
  check("M8 repeated RELEASE is safe (nothing released twice)", !rel2.error && rel2.data?.released === 0, rel2.msg || `released=${rel2.data?.released}`);
  check("M8 repeated RELEASE leaves stock unchanged", (await q("select quantity from public.parts where id=$1", [P_STOCK5]))[0].quantity === 5);
}

// ------------------------------------------------------------------ MODULE 09 — payments (manager)
let PAY_ID;
{
  const { ctx, page } = await openApp("manager");
  await gotoSales(page);
  await tab(page, "Sales & Invoices");
  await page.getByPlaceholder("Sale #, name").fill(BAL_NUMBER);
  await page.getByRole("button", { name: new RegExp(BAL_NUMBER) }).first().click();
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await page.getByPlaceholder("0.00").fill("60");
  await page.getByPlaceholder("0.00").press("Tab");
  await page.getByRole("button", { name: "Save pending payment", exact: true }).click();
  await toastText(page, /saved as pending/i);
  await page.getByText(/Pending\. Sale balances do not change/).first().waitFor({ timeout: 60000 });
  const payRow = (await q("select id, status from public.payments where customer_id=$1 order by created_at desc limit 1", [customerId]))[0];
  PAY_ID = payRow.id;
  check("M9 create payment is PENDING in database", payRow.status === "pending");
  const balPending = (await q("select balance_due, amount_paid from public.sales where id=$1", [BAL_SALE]))[0];
  check("M9 pending leaves sale balance unchanged", Number(balPending.amount_paid) === 0 && Number(balPending.balance_due) === balTotal);
  await shot(page, "m9-pending");

  // Over-allocation and wrong-customer checks in the allocation form
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: new RegExp(BAL_NUMBER) }).first().click();
  await page.getByPlaceholder(/Up to/).fill("999");
  await page.getByRole("button", { name: "Allocate", exact: true }).click();
  await toastText(page, /exceed/i);
  check("M9 over-allocation refused with server message", true);
  await page.getByRole("combobox").first().click().catch(() => {});
  const optionsText = await page.getByRole("option").allTextContents().catch(() => []);
  check("M9 allocation picker lists only this customer's sales", optionsText.every((t) => !/Alt/.test(t)) && optionsText.length >= 1, optionsText.join(" | ").slice(0, 80));
  await page.keyboard.press("Escape");
  await page.getByRole("option").first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

  // Allocate the full amount to the balance sale
  const saleOpt = page.getByRole("option", { name: new RegExp(BAL_NUMBER) }).first();
  await page.getByRole("combobox").first().click();
  await saleOpt.click();
  await page.getByPlaceholder(/Up to/).fill("60");
  await page.getByRole("button", { name: "Allocate", exact: true }).click();
  await toastText(page, /Allocated\. The sale balance does not change/);
  const balAlloc = (await q("select balance_due, amount_paid from public.sales where id=$1", [BAL_SALE]))[0];
  check("M9 allocation leaves sale balance unchanged", Number(balAlloc.amount_paid) === 0 && Number(balAlloc.balance_due) === balTotal);
  await page.getByRole("button", { name: "Post payment", exact: true }).click();
  await toastText(page, /Payment posted/);
  const balPost = (await q("select balance_due, amount_paid, payment_status from public.sales where id=$1", [BAL_SALE]))[0];
  check("M9 post updates amount_paid and balance_due atomically", Number(balPost.amount_paid) === 60 && Number(balPost.balance_due) === balTotal - 60 && balPost.payment_status === "PARTIAL", JSON.stringify(balPost));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sales Desk", exact: true }).waitFor({ timeout: 120000 });
  await tab(page, "Payments");
  await page.getByRole("button", { name: new RegExp(tag) }).first().click();
  await page.getByText(/Posted/).first().waitFor({ timeout: 60000 });
  check("M9 posted status persists after reload", true);
  check("M9 double post is blocked (no Post button after posting)", (await page.getByRole("button", { name: "Post payment", exact: true }).count()) === 0);
  await shot(page, "m9-posted");

  // Invalid void (short reason) by manager: posted payments need an admin
  check("M9 manager does not see the admin reversal for a posted payment", (await page.getByRole("button", { name: "Reverse & void (admin)" }).count()) === 0);
  await ctx.close();
}

// ------------------------------------------------------------------ MODULE 09 — reversal by owner
{
  const { ctx, page } = await openApp("owner");
  await gotoSales(page);
  await tab(page, "Payments");
  await page.getByRole("button", { name: new RegExp(tag) }).first().click();
  await page.getByRole("button", { name: "Reverse & void (admin)", exact: true }).click();
  await page.getByPlaceholder(/Reason/).fill("no");
  await page.getByRole("button", { name: "Reverse and void", exact: true }).click();
  await toastText(page, /at least 5 characters/);
  check("M9 invalid void (short reason) refused in UI", true);
  await page.getByPlaceholder(/Reason/).fill("E2E correction test reversal");
  await page.getByRole("button", { name: "Reverse and void", exact: true }).click();
  await toastText(page, /Payment reversed and voided/);
  const rev = (await q("select amount_paid, balance_due, payment_status from public.sales where id=$1", [BAL_SALE]))[0];
  check("M9 reversal restores the sale balance", Number(rev.amount_paid) === 0 && Number(rev.balance_due) === balTotal && rev.payment_status === "UNPAID", JSON.stringify(rev));
  const hist = (await q("select count(*)::int c from public.audit_logs where entity_type='payment' and entity_id=$1", [PAY_ID]))[0].c;
  check("M9 history and audit remain after reversal", hist >= 3, `audit rows=${hist}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sales Desk", exact: true }).waitFor({ timeout: 120000 });
  await tab(page, "Payments");
  await page.getByRole("button", { name: new RegExp(tag) }).first().click();
  await page.getByText(/Void/).first().waitFor({ timeout: 60000 });
  check("M9 void state persists after reload", true);
  await shot(page, "m9-void");
  await ctx.close();
}

// ------------------------------------------------------------------ MODULE 09 — void access: posted and already-voided (RPC)
{
  // A posted payment: only owner / engineer admin may void it. Manager (sales staff, not admin) must be denied.
  const pp = await rpc(S.manager, "create_payment", { p_customer_id: customerId, p_amount: "1.00", p_method: "CASH", p_reference: "posted-probe", p_notes: "", p_client_request_id: crypto.randomUUID() });
  const POSTED = pp.data?.id ?? pp.data?.payment_id;
  if (!POSTED) throw new Error("posted probe payment: " + pp.msg + " " + JSON.stringify(pp.data));
  const al = await rpc(S.manager, "allocate_payment", { p_payment_id: POSTED, p_sale_id: BAL_SALE, p_amount: "1.00" });
  if (al.error) throw new Error("probe allocate: " + al.msg);
  const po = await rpc(S.manager, "post_payment", { p_payment_id: POSTED });
  if (po.error) throw new Error("probe post: " + po.msg);
  const mgrVoid = await rpc(S.manager, "void_payment", { p_payment_id: POSTED, p_reason: "manager probe void" });
  check("M9 posted payment: manager void denied (admin only)", !!mgrVoid.error && !mgrVoid.data, mgrVoid.code || "no error");
  const stillPosted = (await q("select status from public.payments where id=$1", [POSTED]))[0].status;
  check("M9 denied manager void left the posted payment posted", stillPosted === "posted", `status=${stillPosted}`);
  const ownerVoid = await rpc(S.owner, "void_payment", { p_payment_id: POSTED, p_reason: "owner correction probe" });
  check("M9 posted payment: owner void succeeds and restores the sale", !ownerVoid.error && ownerVoid.data?.status === "void", ownerVoid.msg);
  const restored = (await q("select amount_paid, balance_due from public.sales where id=$1", [BAL_SALE]))[0];
  check("M9 owner void of a posted payment restores the sale balance", Number(restored.amount_paid) === 0 && Number(restored.balance_due) === balTotal, JSON.stringify(restored));

  // Already voided (PAY_ID was reversed above): unauthorized roles get no data and an error; authorized retry is idempotent
  for (const role of ["receiving", "dismantling", "scrap_driver", "container_loading", "employee"]) {
    const r = await rpc(S[role], "void_payment", { p_payment_id: PAY_ID, p_reason: "retry probe" });
    check(`M9 already-voided payment: ${role} denied, no data`, !!r.error && !r.data, r.code || "no error");
  }
  const ownerRetry = await rpc(S.owner, "void_payment", { p_payment_id: PAY_ID, p_reason: "owner retry probe" });
  check("M9 already-voided payment: owner retry is idempotent (same void state)", !ownerRetry.error && ownerRetry.data?.status === "void", ownerRetry.msg || ownerRetry.data?.status);
  const mgrRetry = await rpc(S.manager, "void_payment", { p_payment_id: PAY_ID, p_reason: "manager retry probe" });
  check("M9 already-voided payment: sales-staff retry is idempotent", !mgrRetry.error && mgrRetry.data?.status === "void", mgrRetry.msg || mgrRetry.data?.status);
  const voidRows = (await q("select status, void_reason from public.payments where id=$1", [PAY_ID]))[0];
  check("M9 retries did not change the voided payment", voidRows.status === "void" && voidRows.void_reason === "E2E correction test reversal", JSON.stringify(voidRows));
}

// ------------------------------------------------------------------ security: RPC level, every role
const SECURITY = {
  "quote create": (c) => rpc(c, "create_quote", { p_customer_id: customerId, p_lines: [{ description: "x", quantity: 1, unit_price: 1 }] }),
  "sale create": (c) => rpc(c, "create_sale", { p_customer_id: customerId, p_lines: [{ description: "x", quantity: 1, unit_price: 1 }], p_mode: "draft" }),
  "reserve": (c) => rpc(c, "reserve_stock", { p_sale_id: BAL_SALE }),
  "fulfill": (c) => rpc(c, "fulfill_sales_order", { p_sale_id: BAL_SALE }),
  "payment create": (c) => rpc(c, "create_payment", { p_customer_id: customerId, p_amount: "1.00", p_method: "CASH", p_reference: "", p_notes: "", p_client_request_id: crypto.randomUUID() }),
  "payment allocate": (c) => rpc(c, "allocate_payment", { p_payment_id: PAY_ID, p_sale_id: BAL_SALE, p_amount: "1.00" }),
  "payment post": (c) => rpc(c, "post_payment", { p_payment_id: PAY_ID }),
  "payment void": (c) => rpc(c, "void_payment", { p_payment_id: PAY_ID, p_reason: "security probe" }),
  "payment read": (c) => rpc(c, "get_payment_detail", { p_payment_id: PAY_ID }),
  "sales read": (c) => rpc(c, "list_sales", { p_search: null, p_status: null, p_limit: 5, p_cursor_created_at: null, p_cursor_id: null }),
};
{
  const anon = newClient();
  for (const [name, fn] of Object.entries(SECURITY)) {
    const r = await fn(anon);
    check(`SEC anonymous denied: ${name}`, !!r.error, r.code || r.msg.slice(0, 40));
  }
  for (const role of ["receiving", "dismantling", "scrap_driver", "container_loading", "employee"]) {
    for (const [name, fn] of Object.entries(SECURITY)) {
      const r = await fn(S[role]);
      check(`SEC ${role} denied: ${name}`, !!r.error && (r.code === "42501" || r.code === "28000" || r.code === "P0001" || r.code === "42P01"), r.code || "no error");
    }
  }
  for (const [name, fn] of Object.entries(SECURITY)) {
    if (name === "payment void" || name === "payment post" || name === "payment allocate") continue;
    const r = await fn(S.manager);
    check(`SEC authorized manager accepted: ${name}`, !r.error || r.code === "22023" || r.code === "P0001", r.code || "ok");
  }
}

// ------------------------------------------------------------------ responsive QA (real viewport, same screens)
const WIDTHS = [390, 430, 768, 1366, 1440];
// A pending payment for the responsive pass: its detail shows the Allocate and Void controls.
const respPay = await rpc(S.manager, "create_payment", { p_customer_id: customerId, p_amount: "5.00", p_method: "CASH", p_reference: "resp-pending", p_notes: "", p_client_request_id: crypto.randomUUID() });
if (respPay.error) throw new Error("responsive payment: " + respPay.msg);
// A posted payment for the posted-state check at each width (allocated in full, then posted)
const respPosted = await rpc(S.manager, "create_payment", { p_customer_id: customerId, p_amount: "1.00", p_method: "CASH", p_reference: "resp-posted", p_notes: "", p_client_request_id: crypto.randomUUID() });
const RESP_POSTED = respPosted.data?.id ?? respPosted.data?.payment_id;
if (!RESP_POSTED) throw new Error("responsive posted payment: " + respPosted.msg);
if ((await rpc(S.manager, "allocate_payment", { p_payment_id: RESP_POSTED, p_sale_id: BAL_SALE, p_amount: "1.00" })).error) throw new Error("responsive allocate");
if ((await rpc(S.manager, "post_payment", { p_payment_id: RESP_POSTED })).error) throw new Error("responsive post");
// Quote detail target: the Module 08 quote
const M8_QUOTE = (await q("select quote_number from public.quotes where customer_id=$1 order by created_at asc limit 1", [customerId]))[0].quote_number;
for (const w of WIDTHS) {
  const { ctx, page } = await openApp("manager", w, 900);
  const vw = await page.evaluate(() => window.innerWidth);
  check(`RESP ${w}: viewport is ${w}px`, vw === w, `innerWidth=${vw}`);
  await gotoSales(page);
  const screens = [
    ["pos", async () => {}],
    ["quotes", async () => tab(page, "Quotes")],
    ["sales", async () => tab(page, "Sales & Invoices")],
    ["payments", async () => tab(page, "Payments")],
  ];
  for (const [name, go] of screens) {
    await go();
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`RESP ${w} ${name}: no horizontal overflow`, overflow <= 1, `overflow=${overflow}px`);
    await shot(page, `resp-${w}-${name}`);
  }
  await tab(page, "Payments");
  await page.getByRole("button", { name: "Add payment", exact: true }).click();
  await page.getByRole("dialog").waitFor({ timeout: 30000 });
  const dialogOverflow = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return 999;
    const r = d.getBoundingClientRect();
    return Math.max(0, r.right - window.innerWidth) + Math.max(0, -r.left);
  });
  check(`RESP ${w} create payment: dialog fits viewport`, dialogOverflow <= 1, `spill=${dialogOverflow}px`);
  await page.keyboard.press("Escape");
  // Quote detail (the Module 08 quote) at this width
  await tab(page, "Quotes");
  await page.getByPlaceholder("Quote #, name").fill(M8_QUOTE);
  await page.getByRole("button", { name: new RegExp(M8_QUOTE) }).first().click();
  await page.getByText(M8_QUOTE).first().waitFor({ timeout: 60000 });
  const quoteOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`RESP ${w} quote detail: no horizontal overflow`, quoteOverflow <= 1, `overflow=${quoteOverflow}px`);
  await shot(page, `resp-${w}-quote-detail`);
  // Sale detail and payment detail at this width
  await tab(page, "Sales & Invoices");
  await page.getByPlaceholder("Sale #, name").fill(BAL_NUMBER);
  await page.getByRole("button", { name: new RegExp(BAL_NUMBER) }).first().click();
  await page.getByText(BAL_NUMBER, { exact: false }).first().waitFor({ timeout: 60000 });
  const saleOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`RESP ${w} sale detail: no horizontal overflow`, saleOverflow <= 1, `overflow=${saleOverflow}px`);
  await shot(page, `resp-${w}-sale-detail`);
  await tab(page, "Payments");
  await page.getByRole("button", { name: new RegExp(tag) }).first().click();
  await page.getByText(/Allocations|Allocated/).first().waitFor({ timeout: 60000 });
  const payOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`RESP ${w} payment detail: no horizontal overflow`, payOverflow <= 1, `overflow=${payOverflow}px`);
  await shot(page, `resp-${w}-payment-detail`);
  // Pending payment: Allocate and Void controls must be reachable inside the viewport
  await tab(page, "Payments");
  await page.getByPlaceholder("Customer name or reference").fill("resp-pending");
  await page.getByRole("button", { name: new RegExp(tag) }).first().click();
  await page.getByRole("button", { name: "Void payment", exact: true }).waitFor({ timeout: 60000 });
  const allocBox = await page.getByRole("button", { name: "Allocate", exact: true }).boundingBox().catch(() => null);
  check(`RESP ${w} allocate control reachable inside viewport`, !!allocBox && allocBox.x >= 0 && allocBox.x + allocBox.width <= w + 1, allocBox ? `x=${Math.round(allocBox.x)} right=${Math.round(allocBox.x + allocBox.width)}` : "not visible");
  await page.getByRole("button", { name: "Void payment", exact: true }).click();
  await page.getByPlaceholder(/Reason/).waitFor({ timeout: 30000 });
  const voidOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const voidBox = await page.getByRole("button", { name: "Void", exact: true }).boundingBox().catch(() => null);
  check(`RESP ${w} void dialog: no overflow and action reachable`, voidOverflow <= 1 && !!voidBox && voidBox.x + voidBox.width <= w + 1, `overflow=${voidOverflow}px`);
  await shot(page, `resp-${w}-void`);
  // Posted state (the post confirmation: the payment is shown as Posted, no Post or Allocate controls)
  await page.keyboard.press("Escape");
  await tab(page, "Payments");
  await page.getByPlaceholder("Customer name or reference").fill("resp-posted");
  await page.getByRole("button", { name: new RegExp(tag) }).first().click();
  await page.getByText(/Posted/).first().waitFor({ timeout: 60000 });
  const postedOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const postControls = await page.getByRole("button", { name: "Post payment", exact: true }).count();
  check(`RESP ${w} posted payment: no overflow and no Post control`, postedOverflow <= 1 && postControls === 0, `overflow=${postedOverflow}px post-controls=${postControls}`);
  await shot(page, `resp-${w}-posted`);
  await ctx.close();
}

await browser.close();
await db.end();

const failed = fail;
console.log(`\nE2E RESULT: ${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
