// Module 09 — Payments RPC and security tests (migrations 0004 payment RPCs, 0032 read models/guards).
// Real signed-in sessions against DEV. Sales and customers are created here and removed at the end.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const pg = req("pg");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
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

const S = {};
for (const r of ["manager", "owner", "engineer_admin", "employee", "dismantling", "receiving", "scrap_driver", "container_loading"]) S[r] = await signIn(r);

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const tag = "MPAY" + run;
const customers = [], sales = [], payments = [];

const custA = (await q(`insert into public.customers (first_name, last_name, phone, phone_normalized) values ('Pay', $1, '555-0701', '5550701') returning id`, [tag]))[0].id;
const custB = (await q(`insert into public.customers (first_name, last_name, phone, phone_normalized) values ('Other', $1, '555-0702', '5550702') returning id`, [tag]))[0].id;
customers.push(custA, custB);

// Sale fixtures use manual lines so no part stock is involved. Totals are read from the database.
async function makeSale(customerId, price) {
  const r = await rpc(S.manager, "create_sale", { p_customer_id: customerId, p_lines: [{ description: "Pay fixture", quantity: 1, unit_price: price, discount: 0 }], p_mode: "draft", p_client_request_id: crypto.randomUUID(), p_notes: "", p_discount: 0 });
  if (r.error) throw new Error("sale fixture: " + r.msg);
  sales.push(r.data.sale_id);
  return r.data.sale_id;
}
const saleRow = async (id) => (await q("select total, amount_paid, balance_due, payment_status from public.sales where id=$1", [id]))[0];

const saleA = await makeSale(custA, 100);
const saleA2 = await makeSale(custA, 50);
const saleB = await makeSale(custB, 80);
const totalA = Number((await saleRow(saleA)).total);

// 1. authorized create -> PENDING
const reqCreate = crypto.randomUUID();
const p1 = await rpc(S.manager, "create_payment", { p_customer_id: custA, p_amount: "60.00", p_method: "CASH", p_reference: "t1", p_notes: "", p_client_request_id: reqCreate });
check("1. manager creates a payment as PENDING", !p1.error && p1.data?.status === "pending", p1.msg);
const pay1 = p1.data?.id; payments.push(pay1);

// 3. pending does not change any sale balance
const afterCreate = await saleRow(saleA);
check("3. pending payment leaves the sale balance unchanged", Number(afterCreate.amount_paid) === 0 && Number(afterCreate.balance_due) === totalA, JSON.stringify(afterCreate));

// 2. unauthorized roles cannot create payments
for (const [label, c] of [["dismantling", S.dismantling], ["receiving", S.receiving], ["scrap driver", S.scrap_driver], ["container loader", S.container_loading], ["warehouse", S.employee]]) {
  const r = await rpc(c, "create_payment", { p_customer_id: custA, p_amount: "5.00", p_method: "CASH", p_reference: "", p_notes: "", p_client_request_id: crypto.randomUUID() });
  check(`2. ${label} cannot create a payment`, r.code === "42501", `code=${r.code}`);
}
{
  const anon = newClient();
  const r = await rpc(anon, "create_payment", { p_customer_id: custA, p_amount: "5.00", p_method: "CASH", p_reference: "", p_notes: "", p_client_request_id: crypto.randomUUID() });
  check("   anonymous create is refused", !!r.error, r.msg.slice(0, 60));
}
// 15. direct table insert is blocked (0032 revokes it)
{
  const direct = await S.manager.from("payments").insert({ customer_id: custA, amount: 1, method: "CASH", status: "posted" }).select("id");
  check("15. direct INSERT into payments is blocked", !!direct.error, direct.error?.message?.slice(0, 60) ?? "inserted");
  if (direct.data?.length) payments.push(direct.data[0].id);
  const upd = await S.manager.from("payments").update({ status: "posted", amount: 999 }).eq("id", pay1).select("id");
  check("15. direct UPDATE of a payment is blocked", !!upd.error || (upd.data?.length ?? 0) === 0, upd.error?.message?.slice(0, 60) ?? `rows=${upd.data?.length}`);
  const amt = await S.manager.from("sales").update({ amount_paid: 999 }).eq("id", saleA).select("id");
  check("15. direct UPDATE of sale amount_paid is blocked", !!amt.error || (amt.data?.length ?? 0) === 0);
}

// 4. allocation is bookkeeping only
const alloc1 = await rpc(S.manager, "allocate_payment", { p_payment_id: pay1, p_sale_id: saleA, p_amount: "60.00" });
check("4. allocation succeeds", !alloc1.error && alloc1.data?.idempotent_replay === false, alloc1.msg);
const afterAlloc = await saleRow(saleA);
check("4. allocation does not change the sale balance", Number(afterAlloc.amount_paid) === 0 && Number(afterAlloc.balance_due) === totalA);

// 5. same-customer rule
const wrongCust = await rpc(S.manager, "allocate_payment", { p_payment_id: pay1, p_sale_id: saleB, p_amount: "10.00" });
check("5. allocation to another customer's sale is refused", wrongCust.code === "P0001" && /different customers/.test(wrongCust.msg), wrongCust.msg.slice(0, 70));

// 6. over-allocation: more than the payment amount remaining
const overPay = await rpc(S.manager, "allocate_payment", { p_payment_id: pay1, p_sale_id: saleA2, p_amount: "5.00" });
check("6. allocation beyond the payment amount is refused", overPay.code === "P0001", overPay.msg.slice(0, 70));

// 7. over-allocation: more than the sale's outstanding balance
const payBig = await rpc(S.manager, "create_payment", { p_customer_id: custA, p_amount: "500.00", p_method: "CARD", p_reference: "big", p_notes: "", p_client_request_id: crypto.randomUUID() });
payments.push(payBig.data?.id);
const overBal = await rpc(S.manager, "allocate_payment", { p_payment_id: payBig.data.id, p_sale_id: saleA, p_amount: String(totalA + 1) });
check("7. allocation beyond the sale outstanding balance is refused", overBal.code === "P0001", overBal.msg.slice(0, 70));

// 9 (before posting). posting needs the full amount allocated
const earlyPost = await rpc(S.manager, "post_payment", { p_payment_id: payBig.data.id });
check("   posting with unallocated amount is refused", earlyPost.code === "P0001" && /allocate the full/.test(earlyPost.msg), earlyPost.msg.slice(0, 70));

// 13. idempotent retry of create and allocate
const replayCreate = await rpc(S.manager, "create_payment", { p_customer_id: custA, p_amount: "60.00", p_method: "CASH", p_reference: "t1", p_notes: "", p_client_request_id: reqCreate });
check("13. retried create_payment returns the same payment", replayCreate.data?.id === pay1, replayCreate.msg);
const replayAlloc = await rpc(S.manager, "allocate_payment", { p_payment_id: pay1, p_sale_id: saleA, p_amount: "60.00" });
check("13. retried allocate_payment is a replay, not a second row", replayAlloc.data?.idempotent_replay === true);
const allocCount = (await q("select count(*)::int c from public.payment_allocations where payment_id=$1", [pay1]))[0].c;
check("13. exactly one allocation row exists", allocCount === 1, `rows=${allocCount}`);

// 8. posting changes sale money atomically. Second allocation on a second sale to test splitting.
const alloc2 = await rpc(S.manager, "allocate_payment", { p_payment_id: pay1, p_sale_id: saleA2, p_amount: "0.00" });
check("   zero allocation refused", alloc2.code === "22023", alloc2.msg.slice(0, 60));
// Payment is 60; allocation to saleA is 60 already, so saleA2 has no room. Post now.
const post1 = await rpc(S.manager, "post_payment", { p_payment_id: pay1 });
check("8. posting a fully allocated payment succeeds", !post1.error && post1.data?.payment?.status === "posted", post1.msg);
const afterPost = await saleRow(saleA);
check("8. posting updates amount_paid, balance_due and status on the sale", Number(afterPost.amount_paid) === 60 && Number(afterPost.balance_due) === totalA - 60 && afterPost.payment_status === "PARTIAL", JSON.stringify(afterPost));

// 10. posted payments cannot be changed
const postAgain = await rpc(S.manager, "post_payment", { p_payment_id: pay1 });
check("10. posting twice is refused", postAgain.code === "P0001", postAgain.msg.slice(0, 60));
const allocPosted = await rpc(S.manager, "allocate_payment", { p_payment_id: pay1, p_sale_id: saleA2, p_amount: "1.00" });
check("10. allocating a posted payment is refused", allocPosted.code === "P0001", allocPosted.msg.slice(0, 60));

// 9. multiple allocations: one payment across two sales, then post
const payMulti = await rpc(S.manager, "create_payment", { p_customer_id: custA, p_amount: "70.00", p_method: "CHECK", p_reference: "multi", p_notes: "", p_client_request_id: crypto.randomUUID() });
payments.push(payMulti.data.id);
const multiA = await rpc(S.manager, "allocate_payment", { p_payment_id: payMulti.data.id, p_sale_id: saleA2, p_amount: "50.00" });
const multiB = await rpc(S.manager, "allocate_payment", { p_payment_id: payMulti.data.id, p_sale_id: saleA, p_amount: "20.00" });
check("9. one payment can be split across two sales of the same customer", !multiA.error && !multiB.error, multiA.msg || multiB.msg);
const multiPost = await rpc(S.manager, "post_payment", { p_payment_id: payMulti.data.id });
const sA2 = await saleRow(saleA2);
const sA = await saleRow(saleA);
check("9. posting the split payment updates both sales", !multiPost.error && Number(sA2.amount_paid) === 50 && Number(sA.amount_paid) === 80, JSON.stringify([sA2.amount_paid, sA.amount_paid]));

// 11. concurrent post cannot double-apply
const payRace = await rpc(S.manager, "create_payment", { p_customer_id: custA, p_amount: "10.00", p_method: "CASH", p_reference: "race", p_notes: "", p_client_request_id: crypto.randomUUID() });
payments.push(payRace.data.id);
const saleR = await makeSale(custA, 100);
await rpc(S.manager, "allocate_payment", { p_payment_id: payRace.data.id, p_sale_id: saleR, p_amount: "10.00" });
const before = Number((await saleRow(saleR)).amount_paid);
const [r1, r2] = await Promise.all([rpc(S.manager, "post_payment", { p_payment_id: payRace.data.id }), rpc(S.owner, "post_payment", { p_payment_id: payRace.data.id })]);
const okCount = [r1, r2].filter((r) => !r.error).length;
const after = Number((await saleRow(saleR)).amount_paid);
check("11. concurrent post: exactly one succeeds", okCount === 1, `ok=${okCount}`);
check("11. concurrent post: the amount is applied once", after - before === 10, `delta=${after - before}`);

// 12. void rules
const shortReason = await rpc(S.manager, "void_payment", { p_payment_id: payRace.data.id, p_reason: "no" });
check("12. void with a short reason is refused", shortReason.code === "22023", shortReason.msg.slice(0, 60));
const voidPostedAsManager = await rpc(S.manager, "void_payment", { p_payment_id: pay1, p_reason: "manager tries reversal" });
check("12. manager cannot reverse a posted payment (admin only)", voidPostedAsManager.code === "42501", voidPostedAsManager.msg.slice(0, 60));
const beforeReverse = await saleRow(saleA);
const reverse = await rpc(S.owner, "void_payment", { p_payment_id: pay1, p_reason: "Test reversal of posted payment" });
check("12. owner reverses a posted payment: status void", !reverse.error && reverse.data?.status === "void", reverse.msg);
const afterReverse = await saleRow(saleA);
check("12. reversal removes exactly the reversed payment from the sale (80 -> 20, the split payment remains)", Number(beforeReverse.amount_paid) - Number(afterReverse.amount_paid) === 60 && Number(afterReverse.amount_paid) === 20 && afterReverse.payment_status === "PARTIAL", JSON.stringify(afterReverse));
const allocKept = (await q("select count(*)::int c from public.payment_allocations where payment_id=$1", [pay1]))[0].c;
check("12. allocation rows are kept after void", allocKept === 1);
const voidAgain = await rpc(S.owner, "void_payment", { p_payment_id: pay1, p_reason: "Test reversal of posted payment" });
check("12. voiding twice is a safe retry (no second reversal)", !voidAgain.error && voidAgain.data?.status === "void");
const voidPending = await rpc(S.manager, "void_payment", { p_payment_id: payBig.data.id, p_reason: "Entered in error" });
check("12. manager voids a pending payment", !voidPending.error && voidPending.data?.status === "void", voidPending.msg);
const postVoid = await rpc(S.manager, "post_payment", { p_payment_id: payBig.data.id });
check("12. a voided payment cannot be posted", postVoid.code === "P0001", postVoid.msg.slice(0, 60));

// 14. read models: keyset list, detail on demand, forbidden roles denied
const list1 = await rpc(S.manager, "list_payments", { p_search: tag, p_status: null, p_limit: 2, p_cursor_created_at: null, p_cursor_id: null });
check("14. list_payments returns lightweight rows", !list1.error && (list1.data ?? []).length > 0 && !("allocations" in (list1.data[0] ?? {})), list1.msg);
const seen = []; let cur = list1; let guard = 0;
while (cur.data?.length && guard++ < 30) {
  seen.push(...cur.data.map((r) => r.id));
  const last = cur.data[cur.data.length - 1];
  if (!last.has_more) break;
  cur = await rpc(S.manager, "list_payments", { p_search: tag, p_status: null, p_limit: 2, p_cursor_created_at: last.created_at, p_cursor_id: last.id });
}
check("14. payment keyset list has no duplicates", new Set(seen).size === seen.length && seen.length >= 4, `rows=${seen.length}`);
const det = await rpc(S.manager, "get_payment_detail", { p_payment_id: payMulti.data.id });
check("14. payment detail returns allocations and unallocated amount (numeric)", !det.error && det.data?.allocations?.length === 2 && det.data?.payment?.unallocated_amount !== undefined && Number(det.data.payment.unallocated_amount) === 0, det.msg);
const badStatus = await rpc(S.manager, "list_payments", { p_search: null, p_status: "bogus", p_limit: 2, p_cursor_created_at: null, p_cursor_id: null });
check("14. unknown status filter refused", badStatus.code === "22023");
for (const [label, c] of [["dismantling", S.dismantling], ["receiving", S.receiving], ["scrap driver", S.scrap_driver], ["container loader", S.container_loading]]) {
  const l = await rpc(c, "list_payments", { p_search: null, p_status: null, p_limit: 5, p_cursor_created_at: null, p_cursor_id: null });
  const d = await rpc(c, "get_payment_detail", { p_payment_id: pay1 });
  const sp = await rpc(c, "list_sale_payments", { p_sale_id: saleA });
  check(`14. ${label} cannot read payment data`, l.code === "42501" && d.code === "42501" && sp.code === "42501", `${l.code}/${d.code}/${sp.code}`);
  const direct = await c.from("payments").select("id").limit(1);
  check(`14. ${label} sees no payment rows directly`, (direct.data?.length ?? 0) === 0 || !!direct.error);
}

// 16. wrong roles on allocate, post, void
for (const [label, c] of [["dismantling", S.dismantling], ["receiving", S.receiving], ["scrap driver", S.scrap_driver], ["container loader", S.container_loading], ["warehouse", S.employee]]) {
  const a = await rpc(c, "allocate_payment", { p_payment_id: payRace.data.id, p_sale_id: saleA, p_amount: "1.00" });
  const p = await rpc(c, "post_payment", { p_payment_id: payRace.data.id });
  const v = await rpc(c, "void_payment", { p_payment_id: payRace.data.id, p_reason: "wrong role test" });
  check(`16. ${label} cannot allocate, post or void`, a.code === "42501" && p.code === "42501" && v.code === "42501", `${a.code}/${p.code}/${v.code}`);
}

// Customer-scoped quote list (migration 0031)
{
  const cq = await rpc(S.manager, "list_customer_quotes", { p_customer_id: custA, p_limit: 10 });
  check("0031. list_customer_quotes is staff-only and returns a list", !cq.error && Array.isArray(cq.data), cq.msg);
  const cqDenied = await rpc(S.dismantling, "list_customer_quotes", { p_customer_id: custA, p_limit: 10 });
  check("0031. dismantling cannot list customer quotes", cqDenied.code === "42501");
}

// Cleanup (DEV only)
{
  await db.query("delete from public.payment_allocations where payment_id = any($1::uuid[]) or sale_id = any($2::uuid[])", [payments, sales]);
  await db.query("delete from public.payments where id = any($1::uuid[]) or customer_id = any($2::uuid[])", [payments, customers]);
  await db.query("update public.quotes set converted_sale_id = null where converted_sale_id = any($1::uuid[])", [sales]);
  await db.query("delete from public.inventory_reservations where sale_id = any($1::uuid[])", [sales]);
  await db.query("delete from public.sale_items where sale_id = any($1::uuid[])", [sales]);
  await db.query("delete from public.sales where id = any($1::uuid[])", [sales]);
  await db.query("delete from public.customers where id = any($1::uuid[])", [customers]);
  const left = (await q("select count(*)::int c from public.payments where customer_id = any($1::uuid[])", [customers]))[0].c;
  check("cleanup removed module 09 fixtures", left === 0, `left=${left}`);
}
await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
