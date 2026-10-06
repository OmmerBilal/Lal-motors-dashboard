// Front-desk sales: search, manual inventory part, checkout with partial payment, customer receive payment,
// Fulfill Now stock movement, Out of Stock visibility and overpayment refusal. Real DEV data, owner session
// (DEV_TEST_OWNER_PASSWORD). Creates TEST-SALES-* customers and parts only. Nothing is deleted.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const pg = req("pg");

const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const owner = loadDevCredentials().find((u) => u.role === "owner");
if (!owner?.password || owner.password.length < 8) { console.log("FAIL | owner password not provided (DEV_TEST_OWNER_PASSWORD)"); process.exit(1); }

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const { error: signErr } = await c.auth.signInWithPassword({ email: owner.email, password: owner.password });
if (signErr) { console.log("FAIL | owner sign-in"); process.exit(1); }

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const rpc = async (name, args) => { const r = await c.rpc(name, args); return { data: r.data, error: r.error }; };
const num = (v) => Number(v);

// A fresh customer, so every balance is deterministic.
const phone = "+1555" + String(Math.floor(1000000 + Math.random() * 8999999));
const cust = await rpc("create_customer", { p_data: { first_name: "Sales" + run, last_name: "Test", phone, email: "" }, p_client_request_id: crypto.randomUUID() });
const customerId = cust.data?.customer_id;
check("fixture: fresh TEST-SALES customer created", !!customerId, cust.error?.message ?? "");

// 1. Manual inventory part, then search.
const sku = "TSALE-" + run;
const part = await rpc("create_manual_inventory_part", { p_fields: { part_name: "Manual Test Headlight " + run, quantity: 5, price: 25, stock_sku: sku, part_notes: "TEST manual part", condition: "Used" }, p_client_request_id: crypto.randomUUID() });
const partId = part.data?.part_id;
check("manual part: created as a real inventory part with quantity 5", !!partId && num(part.data?.quantity) === 5, part.error?.message ?? "");
const src = (await db.query("select inventory_source, stage, status, operational_status from public.parts where id = $1", [partId])).rows[0];
check("manual part: source manual, approved, ready for sale", src?.inventory_source === "manual" && src?.stage === "ready_for_sale" && src?.status === "approved", JSON.stringify(src));
const dup = await rpc("create_manual_inventory_part", { p_fields: { part_name: "Dup " + run, quantity: 1, price: 1, stock_sku: sku }, p_client_request_id: crypto.randomUUID() });
check("manual part: a duplicate SKU is refused", !!dup.error && /SKU/.test(dup.error.message), dup.error?.message ?? "no error");

const empty = await rpc("search_sellable_parts", { p_search: "", p_limit: 20 });
check("search: empty query lists nothing", (empty.data ?? []).length === 0);
const one = await rpc("search_sellable_parts", { p_search: "M", p_limit: 20 });
check("search: one character lists nothing", (one.data ?? []).length === 0);
const bySku = await rpc("search_sellable_parts", { p_search: sku, p_limit: 20 });
check("search: exact SKU finds the manual part", (bySku.data ?? []).some((r) => r.id === partId));
const byName = await rpc("search_sellable_parts", { p_search: "Manual Test Headlight " + run, p_limit: 20 });
check("search: part name finds the manual part", (byName.data ?? []).some((r) => r.id === partId));

// 2. Partial checkout: total 100 (described line), paid now 40 by cash.
const saleKey = crypto.randomUUID();
const partial = await rpc("create_sale_with_payment", {
  p_customer_id: customerId, p_lines: [{ description: "TEST checkout line", quantity: 1, unit_price: 100, discount: 0 }],
  p_mode: "draft", p_discount: 0, p_notes: "", p_client_request_id: saleKey, p_amount_paid: 40, p_method: "CASH", p_reference: "", p_payment_request_id: crypto.randomUUID(),
});
const sale = partial.data;
check("checkout: partial payment saves the sale and the payment", !partial.error && !!sale?.sale_id, partial.error?.message ?? "");
const total = num(sale?.total);
check("checkout: sale total is the server total", total >= 100, `total=${total}`);
check("checkout: posted payment is 40 and remaining is total - 40", num(sale?.amount_paid) === 40 && Math.abs(num(sale?.balance_due) - (total - 40)) < 0.005 && sale?.payment_status === "PARTIAL", JSON.stringify({ paid: sale?.amount_paid, balance: sale?.balance_due, status: sale?.payment_status }));
const out1 = await rpc("customer_outstanding", { p_customer_id: customerId });
check("checkout: customer outstanding equals the remaining balance", Math.abs(num(out1.data?.total_outstanding) - (total - 40)) < 0.005, JSON.stringify(out1.data?.total_outstanding));

// 3. Overpayment is refused and leaves no sale behind.
const beforeCount = (await db.query("select count(*)::int n from public.sales where customer_id = $1", [customerId])).rows[0].n;
const over = await rpc("create_sale_with_payment", {
  p_customer_id: customerId, p_lines: [{ description: "TEST over line", quantity: 1, unit_price: 10, discount: 0 }],
  p_mode: "draft", p_discount: 0, p_notes: "", p_client_request_id: crypto.randomUUID(), p_amount_paid: 9999, p_method: "CASH", p_reference: "", p_payment_request_id: crypto.randomUUID(),
});
const afterCount = (await db.query("select count(*)::int n from public.sales where customer_id = $1", [customerId])).rows[0].n;
check("overpayment: refused with OVERPAYMENT", !!over.error && /OVERPAYMENT|more than the sale total/.test(over.error.message + (over.error.hint ?? "")), over.error?.message ?? "no error");
check("overpayment: no sale is left behind", afterCount === beforeCount);

// 4. Receive the remaining payment: oldest first, posted in the same action.
const remaining = num(out1.data?.total_outstanding);
const recv = await rpc("receive_customer_payment", { p_customer_id: customerId, p_amount: remaining, p_method: "CASH", p_reference: "", p_notes: "TEST receive", p_client_request_id: crypto.randomUUID() });
check("receive: remaining balance is applied and posted", !recv.error && Math.abs(num(recv.data?.received) - remaining) < 0.005, recv.error?.message ?? "");
const out2 = await rpc("customer_outstanding", { p_customer_id: customerId });
check("receive: customer outstanding is 0", num(out2.data?.total_outstanding) === 0, JSON.stringify(out2.data?.total_outstanding));
const saleAfter = (await db.query("select payment_status, balance_due from public.sales where id = $1", [sale.sale_id])).rows[0];
check("receive: sale is PAID with balance 0", saleAfter?.payment_status === "PAID" && num(saleAfter?.balance_due) === 0, JSON.stringify(saleAfter));
const posted = (await db.query("select count(*)::int n from public.payments where customer_id = $1 and status = 'posted'", [customerId])).rows[0].n;
check("receive: two posted payment records for this customer (checkout + receive)", posted === 2, `posted=${posted}`);
const overAgain = await rpc("receive_customer_payment", { p_customer_id: customerId, p_amount: 5, p_method: "CASH", p_reference: "", p_notes: "", p_client_request_id: crypto.randomUUID() });
check("receive: nothing outstanding refuses a new payment", !!overAgain.error, overAgain.error?.message ?? "no error");
const replay = await rpc("receive_customer_payment", { p_customer_id: customerId, p_amount: remaining, p_method: "CASH", p_reference: "", p_notes: "", p_client_request_id: recv.data?.payment_id ? (await db.query("select client_request_id from public.payments where id=$1", [recv.data.payment_id])).rows[0].client_request_id : crypto.randomUUID() });
check("receive: a retry with the same request is a replay, not a second payment", replay.data?.idempotent_replay === true);

// 5. Fulfill Now moves stock exactly once; a retry does not move it again.
const fulfillKey = crypto.randomUUID();
const q0 = num((await db.query("select quantity from public.parts where id = $1", [partId])).rows[0].quantity);
const ful = await rpc("create_sale_with_payment", {
  p_customer_id: customerId, p_lines: [{ part_id: partId, quantity: 2, unit_price: 25, discount: 0 }],
  p_mode: "fulfill_now", p_discount: 0, p_notes: "", p_client_request_id: fulfillKey, p_amount_paid: 0, p_method: null, p_reference: "", p_payment_request_id: null,
});
const q1 = num((await db.query("select quantity from public.parts where id = $1", [partId])).rows[0].quantity);
check("fulfill now: quantity decreases by exactly the sold amount", !ful.error && q1 === q0 - 2, `before=${q0} after=${q1} ${ful.error?.message ?? ""}`);
await rpc("create_sale_with_payment", {
  p_customer_id: customerId, p_lines: [{ part_id: partId, quantity: 2, unit_price: 25, discount: 0 }],
  p_mode: "fulfill_now", p_discount: 0, p_notes: "", p_client_request_id: fulfillKey, p_amount_paid: 0, p_method: null, p_reference: "", p_payment_request_id: null,
});
const q2 = num((await db.query("select quantity from public.parts where id = $1", [partId])).rows[0].quantity);
check("fulfill now: a retried sale does not move stock again", q2 === q1, `after retry=${q2}`);
const left = q2;
const ful2 = await rpc("create_sale_with_payment", {
  p_customer_id: customerId, p_lines: [{ part_id: partId, quantity: left, unit_price: 25, discount: 0 }],
  p_mode: "fulfill_now", p_discount: 0, p_notes: "", p_client_request_id: crypto.randomUUID(), p_amount_paid: 0, p_method: null, p_reference: "", p_payment_request_id: null,
});
check("fulfill now: selling the last units succeeds", !ful2.error, ful2.error?.message ?? "");
const zero = await rpc("search_sellable_parts", { p_search: "Manual Test Headlight " + run, p_limit: 20 });
const zeroRow = (zero.data ?? []).find((r) => r.id === partId);
check("out of stock: a zero-quantity part stays visible and is marked out of stock", !!zeroRow && zeroRow.out_of_stock === true, JSON.stringify(zeroRow ?? null));

await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
