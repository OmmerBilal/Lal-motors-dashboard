// Module 08 + 09 browser E2E and responsive QA. Local Chromium via playwright-core against the running app
// (npm run dev, port from E2E_BASE_URL). Fixtures are created through real RPCs and the capture path.
// Database values are read back through the verifier connection; the UI is never trusted for money.
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
await sellablePart(3, 15, 0);        // zero stock: visible, Out of Stock, not addable
await sellablePart(4, 80, 5);       // extra stock for quantity checks
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
// Waits on real state transitions: customer selected, search response received, exact card rendered.
async function selectCustomer(page, t) {
  await page.getByPlaceholder("Name, phone, company or email").fill(t);
  // Retry the click: the result list can re-render while the search settles. Success = the "Change" button.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const btn = page.getByRole("button", { name: new RegExp(t) }).first();
    await btn.waitFor({ timeout: 60000 });
    await btn.click();
    const selected = await page.getByRole("button", { name: "Change", exact: true }).waitFor({ timeout: 15000 }).then(() => true, () => false);
    if (selected) return;
  }
  throw new Error("customer could not be selected for " + t);
}
function partCard(page, name) {
  return page.locator("div.rounded-lg").filter({ has: page.getByText(name, { exact: true }) }).first();
}
async function searchPart(page, name) {
  const resp = page.waitForResponse((r) => r.url().includes("search_sellable_parts"), { timeout: 60000 });
  await page.getByPlaceholder("Part name, SKU or OEM number").fill(name);
  await resp;
  await partCard(page, name).waitFor({ timeout: 60000 });
  return partCard(page, name);
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
  await selectCustomer(page, tag);
  await (await searchPart(page, `${tag} Part 1`)).getByRole("button", { name: "Add", exact: true }).click();
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
  await gotoSales(page);
  await selectCustomer(page, tag);
  const zeroCard = await searchPart(page, `${tag} Part 3`);
  await zeroCard.getByText("Out of Stock", { exact: true }).waitFor({ timeout: 60000 });
  check("M8 POS zero-stock part visible as Out of Stock and not addable", (await zeroCard.getByRole("button", { name: "Add", exact: true }).isDisabled()) === true);
  await page.getByPlaceholder("Part name, SKU or OEM number").fill(`${tag} Part 2`);
  // Select the Add button inside the card whose exact name is this fixture part (not the previous search's card).
  const card2 = page.locator("div.rounded-lg").filter({ has: page.getByText(`${tag} Part 2`, { exact: true }) }).first();
  await card2.getByRole("button", { name: "Add", exact: true }).waitFor({ timeout: 60000 });
  await card2.getByRole("button", { name: "Add", exact: true }).click();
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
  // Parts inventory still contains the row and says Out of Stock
  await page.goto(BASE + "/parts", { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.getByRole("button", { name: "Parts Inventory", exact: true }).click();
  await page.getByPlaceholder(/Search by SKU/).fill(`E2E-${run}-2`);
  const oosVisible = await page.getByText("Out of Stock", { exact: true }).first().waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  check("M8 Parts Inventory keeps the part and shows Out of Stock", oosVisible);
  await shot(page, "m8-parts-oos");
  await ctx.close();
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
const respPay = await rpc(S.manager, "create_payment", { p_customer_id: customerId, p_amount: "5.00", p_method: "CASH", p_reference: "resp", p_notes: "", p_client_request_id: crypto.randomUUID() });
if (respPay.error) throw new Error("responsive payment: " + respPay.msg);
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
  await ctx.close();
}

await browser.close();
await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
