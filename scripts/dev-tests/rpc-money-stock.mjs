// Business RPC tests for payments and stock (migration 0004). Runs against DEV through the real
// PostgREST API with real signed-in sessions, plus direct catalog checks as the DB owner.
// Creates its own customer, parts and sales, and removes them at the end.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
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
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const creds = loadDevCredentials();
const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));

const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

async function signIn(role) {
  const u = byRole[role];
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  return c;
}
const rpc = async (c, fn, args) => {
  const { data, error } = await c.rpc(fn, args);
  return { data, error, code: error?.code, msg: error?.message ?? "" };
};
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

const sessions = {};
for (const r of ["manager", "owner", "engineer_admin", "employee", "scrap_driver", "export_manager"]) sessions[r] = await signIn(r);
const mgr = sessions.manager;
const owner = sessions.owner;

// ---- Fixtures (created as DB owner; RPCs are then exercised as real users) -------------
const tag = "RPCTEST-" + crypto.randomUUID().slice(0, 8);
const [cust] = await q(`insert into public.customers (first_name, last_name, phone, phone_normalized) values ('Rpc', $1, '555-0100', '5550100') returning id`, [tag]);
const [cust2] = await q(`insert into public.customers (first_name, last_name, phone, phone_normalized) values ('Rpc2', $1, '555-0101', '5550101') returning id`, [tag]);
const partA = (await q(`insert into public.parts (part_name, status, stage, quantity, price, operational_status) values ($1,'approved','ready_for_sale',1,50,'AVAILABLE') returning id`, [tag + "-A"]))[0].id;
const partB = (await q(`insert into public.parts (part_name, status, stage, quantity, price, operational_status) values ($1,'approved','ready_for_sale',2,40,'AVAILABLE') returning id`, [tag + "-B"]))[0].id;
const partC = (await q(`insert into public.parts (part_name, status, stage, quantity, price, operational_status) values ($1,'approved','ready_for_sale',1,30,'AVAILABLE') returning id`, [tag + "-C"]))[0].id;
const createdSales = [];
const createdPayments = [];

const qty = async (id) => (await q("select quantity, operational_status from public.parts where id=$1", [id]))[0];
const avail = async (id) => (await q("select public._available_quantity($1) as a", [id]))[0].a;
const activeRes = async (saleId) => (await q("select count(*)::int c from public.inventory_reservations where sale_id=$1 and status='active'", [saleId]))[0].c;
const saleRow = async (id) => (await q("select * from public.sales where id=$1", [id]))[0];

// =========================== A. AUTHORIZATION ===========================
{
  const lines = [{ description: "Labor", quantity: 1, unit_price: 10 }];
  let r = await rpc(sessions.employee, "create_sale", { p_customer_id: cust.id, p_lines: lines, p_mode: "draft" });
  check("employee cannot create a sale", r.code === "42501", `code=${r.code}`);
  r = await rpc(sessions.scrap_driver, "create_payment", { p_customer_id: cust.id, p_amount: 5, p_method: "CASH" });
  check("scrap driver cannot create a payment", r.code === "42501", `code=${r.code}`);
  r = await rpc(sessions.export_manager, "reserve_stock", { p_sale_id: cust.id });
  check("export manager cannot reserve stock (not sales staff)", r.code === "42501", `code=${r.code}`);
  r = await rpc(sessions.engineer_admin, "create_payment", { p_customer_id: cust.id, p_amount: 1, p_method: "CASH" });
  check("engineer admin (sales-side) may create a payment", !r.error, r.msg);
  if (r.data?.id) createdPayments.push(r.data.id);
  const anon = createClient(SUPA, PUB, { auth: { persistSession: false } });
  r = await rpc(anon, "create_payment", { p_customer_id: cust.id, p_amount: 1, p_method: "CASH" });
  check("anonymous caller is refused", !!r.error, r.msg.slice(0, 60));
  r = await rpc(mgr, "void_payment", { p_payment_id: createdPayments[0] ?? cust.id, p_reason: "test reason" });
  check("manager (sales staff) voids a pending payment", !r.error, r.msg);
}

// =========================== B. VALIDATION ===========================
{
  const bad = [
    ["zero amount", { p_customer_id: cust.id, p_amount: 0, p_method: "CASH" }],
    ["three decimals", { p_customer_id: cust.id, p_amount: 10.123, p_method: "CASH" }],
    ["unknown method", { p_customer_id: cust.id, p_amount: 10, p_method: "BITCOIN" }],
    ["unknown customer", { p_customer_id: crypto.randomUUID(), p_amount: 10, p_method: "CASH" }],
  ];
  for (const [label, args] of bad) {
    const r = await rpc(mgr, "create_payment", args);
    check(`create_payment rejects ${label}`, r.code === "22023", `code=${r.code}`);
  }
  const badSales = [
    ["no lines", { p_customer_id: cust.id, p_lines: [], p_mode: "draft" }],
    ["zero quantity", { p_customer_id: cust.id, p_lines: [{ description: "x", quantity: 0, unit_price: 1 }], p_mode: "draft" }],
    ["negative price", { p_customer_id: cust.id, p_lines: [{ description: "x", quantity: 1, unit_price: -1 }], p_mode: "draft" }],
    ["unknown mode", { p_customer_id: cust.id, p_lines: [{ description: "x", quantity: 1, unit_price: 1 }], p_mode: "maybe" }],
  ];
  for (const [label, args] of badSales) {
    const r = await rpc(mgr, "create_sale", args);
    check(`create_sale rejects ${label}`, r.code === "22023", `code=${r.code}`);
  }
}

// =========================== C. PAYMENT LIFECYCLE (E2E TEST 4) ===========================
{
  // Labor-only sale: no stock involved. Total 120.00
  const s = await rpc(mgr, "create_sale", { p_customer_id: cust.id, p_lines: [{ description: "Install", quantity: 1, unit_price: 120 }], p_mode: "draft" });
  check("create draft sale (no stock), total 120", Number(s.data?.total) === 120, s.msg);
  const saleId = s.data.sale_id;
  createdSales.push(saleId);

  const p = await rpc(mgr, "create_payment", { p_customer_id: cust.id, p_amount: 50, p_method: "CARD", p_client_request_id: crypto.randomUUID() });
  check("create payment -> PENDING", p.data?.status === "pending", JSON.stringify(p.data));
  const payId = p.data.id; createdPayments.push(payId);
  let sr = await saleRow(saleId);
  check("pending payment does not change sale balance", Number(sr.amount_paid) === 0 && Number(sr.balance_due) === 120 && sr.payment_status === "UNPAID");

  const al = await rpc(mgr, "allocate_payment", { p_payment_id: payId, p_sale_id: saleId, p_amount: 50 });
  check("allocate payment", !al.error, al.msg);
  sr = await saleRow(saleId);
  check("allocation alone does not change sale balance", Number(sr.amount_paid) === 0 && Number(sr.balance_due) === 120);

  const dup = await rpc(mgr, "allocate_payment", { p_payment_id: payId, p_sale_id: saleId, p_amount: 50 });
  check("retry allocation is idempotent (no double allocation)", !dup.error && dup.data?.idempotent_replay === true, dup.msg);
  const dupDiff = await rpc(mgr, "allocate_payment", { p_payment_id: payId, p_sale_id: saleId, p_amount: 40 });
  check("same pair with a different amount is rejected", dupDiff.code === "P0001", `code=${dupDiff.code}`);

  const post = await rpc(mgr, "post_payment", { p_payment_id: payId });
  check("post payment", !post.error, post.msg);
  sr = await saleRow(saleId);
  check("posting moves amount_paid=50, balance_due=70, PARTIAL", Number(sr.amount_paid) === 50 && Number(sr.balance_due) === 70 && sr.payment_status === "PARTIAL", `paid=${sr.amount_paid} bal=${sr.balance_due} st=${sr.payment_status}`);
  const again = await rpc(mgr, "post_payment", { p_payment_id: payId });
  check("posting twice is rejected", again.code === "P0001", `code=${again.code}`);

  const direct = await mgr.from("payments").update({ amount: 999 }).eq("id", payId).select("id");
  check("direct update of a posted payment is blocked", !!direct.error || (direct.data?.length ?? 0) === 0, direct.error?.message?.slice(0, 60) ?? "rows=0");

  const voidMgr = await rpc(mgr, "void_payment", { p_payment_id: payId, p_reason: "wrong customer" });
  check("manager cannot reverse a POSTED payment (owner/engineer only)", voidMgr.code === "42501", `code=${voidMgr.code}`);
  const voidOwner = await rpc(owner, "void_payment", { p_payment_id: payId, p_reason: "wrong customer" });
  check("owner reverses a posted payment with reason", !voidOwner.error, voidOwner.msg);
  sr = await saleRow(saleId);
  check("reversal restores sale to 0 paid / 120 due / UNPAID", Number(sr.amount_paid) === 0 && Number(sr.balance_due) === 120 && sr.payment_status === "UNPAID");
  const voidAgain = await rpc(owner, "void_payment", { p_payment_id: payId, p_reason: "wrong customer" });
  check("void retry is idempotent", !voidAgain.error && voidAgain.data?.status === "void", voidAgain.msg);
  const noReason = await rpc(owner, "void_payment", { p_payment_id: payId, p_reason: "ab" });
  check("void without a real reason is rejected", noReason.code === "22023", `code=${noReason.code}`);
}

// =========================== D. ALLOCATION RULES ===========================
{
  const s = await rpc(mgr, "create_sale", { p_customer_id: cust.id, p_lines: [{ description: "Labor", quantity: 1, unit_price: 100 }], p_mode: "draft" });
  createdSales.push(s.data.sale_id);
  const p = await rpc(mgr, "create_payment", { p_customer_id: cust.id, p_amount: 30, p_method: "CASH" });
  createdPayments.push(p.data.id);
  const over = await rpc(mgr, "allocate_payment", { p_payment_id: p.data.id, p_sale_id: s.data.sale_id, p_amount: 31 });
  check("allocation above payment amount is rejected", over.code === "P0001", `code=${over.code}`);

  const other = await rpc(mgr, "create_payment", { p_customer_id: cust2.id, p_amount: 10, p_method: "CASH" });
  createdPayments.push(other.data.id);
  const cross = await rpc(mgr, "allocate_payment", { p_payment_id: other.data.id, p_sale_id: s.data.sale_id, p_amount: 10 });
  check("payment from a different customer cannot be allocated", cross.code === "P0001", `code=${cross.code}`);

  const partial = await rpc(mgr, "allocate_payment", { p_payment_id: p.data.id, p_sale_id: s.data.sale_id, p_amount: 30 });
  check("allocate the full payment to the sale", !partial.error, partial.msg);
  const post = await rpc(mgr, "post_payment", { p_payment_id: other.data.id });
  check("posting a payment with no allocation is rejected", post.code === "P0001", `code=${post.code}`);
  await rpc(mgr, "void_payment", { p_payment_id: other.data.id, p_reason: "test cleanup" });
}

// =========================== E. CONCURRENCY: two payments race for the last outstanding amount ===========================
{
  const s = await rpc(mgr, "create_sale", { p_customer_id: cust.id, p_lines: [{ description: "Race", quantity: 1, unit_price: 120 }], p_mode: "draft" });
  createdSales.push(s.data.sale_id);
  const p1 = await rpc(mgr, "create_payment", { p_customer_id: cust.id, p_amount: 80, p_method: "CASH" });
  const p2 = await rpc(mgr, "create_payment", { p_customer_id: cust.id, p_amount: 80, p_method: "CASH" });
  createdPayments.push(p1.data.id, p2.data.id);
  const mgr2 = await signIn("manager");
  const [r1, r2] = await Promise.all([
    rpc(mgr, "allocate_payment", { p_payment_id: p1.data.id, p_sale_id: s.data.sale_id, p_amount: 80 }),
    rpc(mgr2, "allocate_payment", { p_payment_id: p2.data.id, p_sale_id: s.data.sale_id, p_amount: 80 }),
  ]);
  const ok = [r1, r2].filter((r) => !r.error).length;
  check("parallel allocations: exactly one succeeds (outstanding 120, each 80)", ok === 1, `succeeded=${ok}`);
  const sumAlloc = (await q("select coalesce(sum(amount),0)::numeric s from public.payment_allocations where sale_id=$1", [s.data.sale_id]))[0].s;
  check("allocations on the sale never exceed its total", Number(sumAlloc) <= 120, `sum=${sumAlloc}`);
  await rpc(mgr, "void_payment", { p_payment_id: p1.data.id, p_reason: "race test cleanup" });
  await rpc(mgr, "void_payment", { p_payment_id: p2.data.id, p_reason: "race test cleanup" });
}

// =========================== F. STOCK: RESERVE -> RELEASE -> RESERVE -> FULFILL (E2E TEST 2) ===========================
let reserveSale;
{
  const s = await rpc(mgr, "create_sale", { p_customer_id: cust.id, p_lines: [{ part_id: partA, description: "Part A", quantity: 1, unit_price: 50 }], p_mode: "reserve", p_client_request_id: crypto.randomUUID() });
  check("create sale in RESERVE mode", !s.error, s.msg);
  reserveSale = s.data.sale_id; createdSales.push(reserveSale);
  let qa = await qty(partA);
  check("physical quantity stays 1 after reserve", qa.quantity === 1, `qty=${qa.quantity}`);
  check("active reservation = 1 and available-to-sell = 0", (await activeRes(reserveSale)) === 1 && (await avail(partA)) === 0);
  check("operational status shows RESERVED", qa.operational_status === "RESERVED", qa.operational_status);

  const second = await rpc(mgr, "create_sale", { p_customer_id: cust2.id, p_lines: [{ part_id: partA, description: "Part A", quantity: 1, unit_price: 50 }], p_mode: "reserve" });
  check("second sale cannot oversell (insufficient stock)", second.code === "P0001", `code=${second.code}`);

  const rel = await rpc(mgr, "release_reservation", { p_sale_id: reserveSale });
  check("release reservation", !rel.error && rel.data?.released === 1, rel.msg);
  check("release restores availability to 1", (await avail(partA)) === 1 && (await activeRes(reserveSale)) === 0);
  qa = await qty(partA);
  check("release sets operational status back to AVAILABLE", qa.operational_status === "AVAILABLE", qa.operational_status);

  const res = await rpc(mgr, "reserve_stock", { p_sale_id: reserveSale });
  check("reserve again after release", !res.error && res.data?.reserved_lines === 1, res.msg);

  const f = await rpc(mgr, "fulfill_sales_order", { p_sale_id: reserveSale });
  check("fulfill sales order", !f.error && f.data?.fulfilled_lines === 1, f.msg);
  qa = await qty(partA);
  check("fulfilled: part quantity 0, operational status SOLD", qa.quantity === 0 && qa.operational_status === "SOLD", `qty=${qa.quantity} st=${qa.operational_status}`);
  const sr = await saleRow(reserveSale);
  check("sale fulfillment_status = fulfilled", sr.fulfillment_status === "fulfilled", sr.fulfillment_status);
  const fulfilledRows = (await q("select count(*)::int c from public.inventory_reservations where sale_id=$1 and status='fulfilled'", [reserveSale]))[0].c;
  const releasedRows = (await q("select count(*)::int c from public.inventory_reservations where sale_id=$1 and status='released'", [reserveSale]))[0].c;
  check("reservation is fulfilled and the earlier released one is kept as history", fulfilledRows === 1 && releasedRows === 1, `fulfilled=${fulfilledRows} released=${releasedRows}`);
  const still = (await q("select count(*)::int c from public.parts where id=$1", [partA]))[0].c;
  check("sold-out part row still exists (Out of Stock, never deleted)", still === 1);
  const again = await rpc(mgr, "fulfill_sales_order", { p_sale_id: reserveSale });
  check("fulfill retry is idempotent (no double deduction)", !again.error && again.data?.idempotent_replay === true && (await qty(partA)).quantity === 0);
}

// =========================== G. FULFILL NOW: immediate consumption, no reserve step ===========================
{
  const s = await rpc(mgr, "create_sale", { p_customer_id: cust.id, p_lines: [{ part_id: partB, description: "Part B", quantity: 1, unit_price: 40 }], p_mode: "fulfill_now", p_client_request_id: crypto.randomUUID() });
  check("fulfill-now sale created", !s.error, s.msg);
  createdSales.push(s.data.sale_id);
  const qb = await qty(partB);
  check("fulfill-now consumes stock immediately (2 -> 1)", qb.quantity === 1, `qty=${qb.quantity}`);
  check("fulfill-now writes no reservation", (await activeRes(s.data.sale_id)) === 0);
  const sr = await saleRow(s.data.sale_id);
  check("fulfill-now line marks sale fulfilled", sr.fulfillment_status === "fulfilled", sr.fulfillment_status);
}

// =========================== H. IDEMPOTENT CREATE_SALE RETRY ===========================
{
  const reqId = crypto.randomUUID();
  const a = await rpc(mgr, "create_sale", { p_customer_id: cust.id, p_lines: [{ part_id: partB, description: "Part B", quantity: 1, unit_price: 40 }], p_mode: "fulfill_now", p_client_request_id: reqId });
  createdSales.push(a.data?.sale_id);
  const b = await rpc(mgr, "create_sale", { p_customer_id: cust.id, p_lines: [{ part_id: partB, description: "Part B", quantity: 1, unit_price: 40 }], p_mode: "fulfill_now", p_client_request_id: reqId });
  check("retried create_sale returns the same sale (no duplicate, no double stock use)", !b.error && b.data?.sale_id === a.data?.sale_id && b.data?.idempotent_replay === true);
  check("retry did not consume stock twice (2 -> 1 -> 0 total)", (await qty(partB)).quantity === 0, `qty=${(await qty(partB)).quantity}`);
}

// =========================== I. ROLLBACK: multi-line sale fails on one line -> nothing persists ===========================
{
  const reqId = crypto.randomUUID();
  const before = (await q("select quantity from public.parts where id=$1", [partC]))[0].quantity;
  const r = await rpc(mgr, "create_sale", {
    p_customer_id: cust.id,
    p_lines: [
      { part_id: partC, description: "C", quantity: 1, unit_price: 30 },
      { part_id: partB, description: "B too many", quantity: 99, unit_price: 40 },
    ],
    p_mode: "fulfill_now",
    p_client_request_id: reqId,
  });
  check("multi-line sale with one impossible line is refused", r.code === "P0001", `code=${r.code}`);
  const sales = (await q("select count(*)::int c from public.sales where client_request_id=$1", [reqId]))[0].c;
  check("rollback: no sale row persisted", sales === 0, `rows=${sales}`);
  const after = (await q("select quantity from public.parts where id=$1", [partC]))[0].quantity;
  check("rollback: first line's stock was NOT consumed", after === before, `before=${before} after=${after}`);
}

// =========================== J. CONCURRENCY: two sales race for the last unit ===========================
{
  const [s1, s2] = await Promise.all([
    rpc(mgr, "create_sale", { p_customer_id: cust.id, p_lines: [{ part_id: partC, description: "C", quantity: 1, unit_price: 30 }], p_mode: "reserve" }),
    rpc(await signIn("manager"), "create_sale", { p_customer_id: cust2.id, p_lines: [{ part_id: partC, description: "C", quantity: 1, unit_price: 30 }], p_mode: "reserve" }),
  ]);
  const ok = [s1, s2].filter((r) => !r.error);
  check("parallel reservations for the last unit: exactly one succeeds", ok.length === 1, `succeeded=${ok.length}`);
  for (const r of ok) createdSales.push(r.data.sale_id);
  const active = (await q("select count(*)::int c from public.inventory_reservations where part_id=$1 and status='active'", [partC]))[0].c;
  check("exactly one active reservation exists for the part", active === 1, `active=${active}`);
}

// =========================== CLEANUP (DEV only) ===========================
{
  const saleIds = createdSales.filter(Boolean);
  if (saleIds.length) {
    await db.query("delete from public.inventory_reservations where sale_id = any($1::uuid[])", [saleIds]);
    await db.query("delete from public.payment_allocations where sale_id = any($1::uuid[])", [saleIds]);
    await db.query("delete from public.sale_items where sale_id = any($1::uuid[])", [saleIds]);
    await db.query("delete from public.sales where id = any($1::uuid[])", [saleIds]);
  }
  const payIds = createdPayments.filter(Boolean);
  if (payIds.length) {
    await db.query("delete from public.payment_allocations where payment_id = any($1::uuid[])", [payIds]);
    await db.query("delete from public.payments where id = any($1::uuid[])", [payIds]);
  }
  await db.query("delete from public.parts where id = any($1::uuid[])", [[partA, partB, partC]]);
  await db.query("delete from public.customers where id = any($1::uuid[])", [[cust.id, cust2.id]]);
  const left = (await q("select count(*)::int c from public.customers where last_name = $1", [tag]))[0].c;
  check("cleanup removed fixtures", left === 0, `left=${left}`);
}

await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
