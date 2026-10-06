// Module 08 — Quotes and Sales RPC tests (migrations 0029, 0030). Real signed-in sessions against DEV.
// Fixture parts go through the real capture -> photo -> approval -> processing path. Fixture
// quantities are set directly in the test database where a specific stock state is needed.
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
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
async function signIn(role) {
  const u = byRole[role];
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  return c;
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); return { data, error, code: error?.code, hint: error?.hint, msg: error?.message ?? "" }; };

const S = {};
for (const r of ["manager", "owner", "engineer_admin", "employee", "dismantling", "receiving", "scrap_driver", "auction"]) S[r] = await signIn(r);

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const tag = "MSALES" + run;
const SRC = "MSTEST-" + run;
const vehicles = [], sessions = [], parts = [], media = [], customers = [], quotes = [], sales = [];

// Builds one sellable part through the real path: capture, photo, approve, process, ready.
async function sellablePart(n, { price = 50, qty = 1, ready = true } = {}) {
  const vin = ("1MS" + run + String(n).padStart(8, "0")).slice(0, 17);
  const v = await rpc(S.auction, "match_or_create_vehicle", { p_vin: vin, p_lot_number: null, p_stock_number: "MS" + run + n, p_auction_source: SRC, p_fields: { year: 2014, make: "Subaru", model: "Forester", purchase_price: 200 } });
  if (v.error) throw new Error("vehicle: " + v.msg);
  vehicles.push(v.data.vehicle_id);
  // v2: work starts only from an assignment. Fixture: arrival photos, receive, ready and assign as the owner.
  for (const role of ["arrival_front", "arrival_rear", "arrival_left", "arrival_right"]) {
    await q(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, size_bytes, status) values ('vehicle', $1, $2, 'original', 'operational-media', $3, 'image/jpeg', 1, 'ready')`, [v.data.vehicle_id, role, `vehicle/${v.data.vehicle_id}/prep-${role}-${crypto.randomUUID()}.jpg`]);
  }
  const prepRecv = await rpc(S.owner, "receive_vehicle", { p_vehicle_id: v.data.vehicle_id });
  if (prepRecv.error) throw new Error("prep receive: " + prepRecv.msg);
  const prepReady = await rpc(S.owner, "mark_vehicle_ready", { p_vehicle_id: v.data.vehicle_id });
  if (prepReady.error) throw new Error("prep ready: " + prepReady.msg);
  const dismEmail = creds.find((u) => u.role === "dismantling").email;
  const dismId = (await q("select id from public.profiles where email = $1", [dismEmail]))[0].id;
  const prepAssign = await rpc(S.owner, "assign_dismantling_vehicle", { p_vehicle_id: v.data.vehicle_id, p_employee_id: dismId });
  if (prepAssign.error) throw new Error("prep assign: " + prepAssign.msg);
  const s = await rpc(S.dismantling, "start_dismantling_session", { p_vehicle_id: v.data.vehicle_id });
  sessions.push(s.data.session_id);
  const b = await rpc(S.dismantling, "begin_dismantled_part", { p_session_id: s.data.session_id, p_client_request_id: crypto.randomUUID(), p_capture_name: "TEST part", p_capture_details: "TEST capture details" });
  const pid = b.data.part_id;
  parts.push(pid);
  const [m] = await q(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, status) values ('part', $1, 'capture', 'original', 'operational-media', $2, 'image/jpeg', 'ready') returning id`, [pid, `test/${run}/${n}.jpg`]);
  media.push(m.id);
  const ap = await rpc(S.manager, "approve_dismantled_part", { p_part_id: pid });
  if (ap.error) throw new Error("approve: " + ap.msg);
  await rpc(S.manager, "update_part_fields", { p_part_id: pid, p_fields: { part_name: tag + "-P" + n, price, location: "Shelf " + n, test_status: "Tested", stock_sku: "MS-" + run + "-" + n } });
  if (ready) {
    await rpc(S.employee, "set_part_stage", { p_part_id: pid, p_stage: "in_processing" });
    const r = await rpc(S.manager, "set_part_stage", { p_part_id: pid, p_stage: "ready_for_sale" });
    if (r.error) throw new Error("ready: " + r.msg);
  }
  if (qty !== 1) await db.query("update public.parts set quantity = $2 where id = $1", [pid, qty]);
  return pid;
}

const cust = (await q(`insert into public.customers (first_name, last_name, phone, phone_normalized) values ('Quote', $1, '555-0909', '5550909') returning id`, [tag]))[0].id;
customers.push(cust);
const cust2 = (await q(`insert into public.customers (first_name, last_name, phone, phone_normalized) values ('Other', $1, '555-0910', '5550910') returning id`, [tag]))[0].id;
customers.push(cust2);

const P1 = await sellablePart(1, { price: 50 });
const P2 = await sellablePart(2, { price: 10, qty: 2 });
const P3 = await sellablePart(3, { price: 60 });
const P4 = await sellablePart(4, { price: 70 });
const P5 = await sellablePart(5, { price: 80 });
const P6 = await sellablePart(6, { price: 90 });
const P_ZERO = await sellablePart(7, { price: 15 });
const P_NS = await sellablePart(8, { price: 25 });
const P_UNREADY = await sellablePart(9, { price: 35, ready: false });
// Zero stock: sell P_ZERO out before tests that need it.
const pz = await rpc(S.manager, "create_sale", { p_customer_id: cust2, p_lines: [{ part_id: P_ZERO, description: "zero", quantity: 1, unit_price: 15 }], p_mode: "fulfill_now" });
if (pz.error) throw new Error("zero fixture: " + pz.msg);
sales.push(pz.data.sale_id);
await rpc(S.manager, "mark_part_not_sellable", { p_part_id: P_NS, p_reason: "Fixture: not sellable" });

// =========================== QUOTE ===========================
let quoteA;
{
  // 1. authorized create with multiple lines and a labor line with a discount
  const lines = [
    { part_id: P1, quantity: 1 },
    { part_id: P2, quantity: 2 },
    { description: "Labor", quantity: 1, unit_price: 30, discount: 5 },
  ];
  const r = await rpc(S.manager, "create_quote", { p_customer_id: cust, p_lines: lines, p_discount: 0, p_notes: "Quote test" });
  check("1. manager creates a quote", !r.error && r.data?.status === "DRAFT", r.msg);
  quoteA = r.data?.quote_id; quotes.push(quoteA);
  check("   quote number comes from the database (Q-)", /^Q-\d{4,}$/.test(r.data?.quote_number ?? ""), r.data?.quote_number);
  // 5. server total: 50 + 2*10 + (30-5) = 95. Lines without a price take the part price.
  check("5. server computes the total (50 + 2x10 + 25 = 95)", Number(r.data?.total) === 95, `total=${r.data?.total}`);
}
{
  // 2. unauthorized roles
  for (const [label, c] of [["dismantling", S.dismantling], ["receiving", S.receiving], ["scrap driver", S.scrap_driver], ["warehouse", S.employee]]) {
    const r = await rpc(c, "create_quote", { p_customer_id: cust, p_lines: [{ part_id: P1, quantity: 1 }] });
    check(`2. ${label} cannot create a quote`, r.code === "42501", `code=${r.code}`);
  }
  // 3. invalid customer
  const bad = await rpc(S.manager, "create_quote", { p_customer_id: crypto.randomUUID(), p_lines: [{ part_id: P1, quantity: 1 }] });
  check("3. invalid customer refused", bad.code === "22023", `code=${bad.code}`);
  // not sellable and rejected parts cannot be quoted
  const ns = await rpc(S.manager, "create_quote", { p_customer_id: cust, p_lines: [{ part_id: P_NS, quantity: 1 }] });
  check("   a not-sellable part cannot be quoted", ns.hint === "NOT_SELLABLE", `hint=${ns.hint}`);
  const unready = await rpc(S.manager, "create_quote", { p_customer_id: cust, p_lines: [{ part_id: P_UNREADY, quantity: 1 }] });
  check("   a part not yet ready for sale cannot be quoted", unready.hint === "NOT_SELLABLE", `hint=${unready.hint}`);
  const badQty = await rpc(S.manager, "create_quote", { p_customer_id: cust, p_lines: [{ part_id: P1, quantity: 0 }] });
  check("   zero quantity refused", badQty.code === "22023");
  const badDisc = await rpc(S.manager, "create_quote", { p_customer_id: cust, p_lines: [{ description: "x", quantity: 1, unit_price: 10, discount: 50 }] });
  check("   a line discount above the line amount refused", badDisc.code === "22023");
  const badHeader = await rpc(S.manager, "create_quote", { p_customer_id: cust, p_lines: [{ description: "x", quantity: 1, unit_price: 10 }], p_discount: 999 });
  check("   a header discount above the subtotal refused", badHeader.code === "22023");
}
{
  // 6. update quote: add a line, total recalculated
  const u = await rpc(S.manager, "update_quote", { p_quote_id: quoteA, p_customer_id: cust, p_lines: [
    { part_id: P1, quantity: 1 }, { part_id: P2, quantity: 2 }, { description: "Labor", quantity: 1, unit_price: 30, discount: 5 }, { description: "Parts cleaning", quantity: 1, unit_price: 20 },
  ], p_discount: 0, p_notes: "Updated" });
  check("6. update quote replaces lines and recalculates (95 -> 115)", !u.error && Number(u.data?.total) === 115, u.msg || `total=${u.data?.total}`);
  // 7. invalid update rolls back: non-sellable part in the new lines
  const before = (await q("select count(*)::int c, sum(line_total) s from public.quote_items where quote_id=$1", [quoteA]))[0];
  const bad = await rpc(S.manager, "update_quote", { p_quote_id: quoteA, p_customer_id: cust, p_lines: [{ part_id: P1, quantity: 1 }, { part_id: P_NS, quantity: 1 }], p_discount: 0 });
  check("7. invalid update refused", bad.hint === "NOT_SELLABLE", `hint=${bad.hint}`);
  const after = (await q("select count(*)::int c, sum(line_total) s from public.quote_items where quote_id=$1", [quoteA]))[0];
  const total = (await q("select total from public.quotes where id=$1", [quoteA]))[0].total;
  check("7. rollback: the quote lines and total are unchanged", before.c === after.c && Number(before.s) === Number(after.s) && Number(total) === 115, `lines ${before.c}->${after.c}, total ${total}`);
  const wrong = await rpc(S.employee, "update_quote", { p_quote_id: quoteA, p_customer_id: cust, p_lines: [{ part_id: P1, quantity: 1 }], p_discount: 0 });
  check("   warehouse cannot edit a quote", wrong.code === "42501", `code=${wrong.code}`);
}
// Extra quotes for keyset paging and conversion tests.
const quoteB = (await rpc(S.manager, "create_quote", { p_customer_id: cust, p_lines: [{ description: "B1", quantity: 1, unit_price: 5 }] })).data.quote_id;
const quoteC = (await rpc(S.manager, "create_quote", { p_customer_id: cust, p_lines: [{ description: "C1", quantity: 1, unit_price: 6 }] })).data.quote_id;
quotes.push(quoteB, quoteC);
{
  // 8. keyset list over this customer's quotes, paged by 1
  const seen = [];
  let cur = await rpc(S.manager, "list_quotes", { p_search: tag, p_status: null, p_limit: 1, p_cursor_created_at: null, p_cursor_id: null });
  let guard = 0;
  while (cur.data?.length && guard++ < 20) {
    seen.push(...cur.data.map((r) => r.id));
    const last = cur.data[cur.data.length - 1];
    if (!last.has_more) break;
    cur = await rpc(S.manager, "list_quotes", { p_search: tag, p_status: null, p_limit: 1, p_cursor_created_at: last.created_at, p_cursor_id: last.id });
  }
  check("8. keyset quote list has no duplicates and covers the test quotes", new Set(seen).size === seen.length && [quoteA, quoteB, quoteC].every((x) => seen.includes(x)), `rows=${seen.length}`);
}
{
  // 9. detail
  const d = await rpc(S.manager, "get_quote_detail", { p_quote_id: quoteA });
  check("9. quote detail: header, customer, items and history", !d.error && d.data?.items?.length === 4 && !!d.data?.customer?.name && d.data?.history?.some((h) => h.action === "quote.create"), d.msg || JSON.stringify(d.data?.quote?.total));
}
// =========================== SALES: DRAFT / RESERVE / FULFILL NOW ===========================
{
  // 13. draft: no stock action
  const before = (await q("select quantity from public.parts where id=$1", [P3]))[0].quantity;
  const d = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P3, description: "p3", quantity: 1, unit_price: 60 }], p_mode: "draft" });
  check("13. draft sale created with a sale number", !d.error && /^S-\d{4,}$/.test(d.data?.sale_number ?? ""), d.msg || d.data?.sale_number);
  sales.push(d.data?.sale_id);
  const after = (await q("select quantity from public.parts where id=$1", [P3]))[0].quantity;
  const res = (await q("select count(*)::int c from public.inventory_reservations where sale_id=$1", [d.data?.sale_id]))[0].c;
  check("13. draft moves no stock and creates no reservation", before === after && res === 0, `qty ${before}->${after}, res=${res}`);
}
let reserveSale;
{
  // 14. reserve: physical unchanged, active reservation, available 0
  const r = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P4, description: "p4", quantity: 1, unit_price: 70 }], p_mode: "reserve" });
  check("14. reserve sale created", !r.error, r.msg);
  reserveSale = r.data?.sale_id; sales.push(reserveSale);
  const qty = (await q("select quantity from public.parts where id=$1", [P4]))[0].quantity;
  const avail = (await q("select public._available_quantity($1) a", [P4]))[0].a;
  const act = (await q("select count(*)::int c from public.inventory_reservations where sale_id=$1 and status='active'", [reserveSale]))[0].c;
  check("14. reserve: physical 1, active reservation 1, available 0", qty === 1 && act === 1 && avail === 0, `qty=${qty} res=${act} avail=${avail}`);
}
{
  // 16. release reservation
  const rel = await rpc(S.manager, "release_reservation", { p_sale_id: reserveSale });
  check("16. release reservation", !rel.error && rel.data?.released === 1, rel.msg);
  const avail = (await q("select public._available_quantity($1) a", [P4]))[0].a;
  check("16. availability returns to 1 after release", avail === 1);
  const again = await rpc(S.manager, "release_reservation", { p_sale_id: reserveSale });
  check("16. a released reservation cannot be released again", again.data?.released === 0 && again.data?.idempotent_replay === true);
  // 17. after release, reserve again then fulfill
  await rpc(S.manager, "reserve_stock", { p_sale_id: reserveSale });
  const f = await rpc(S.manager, "fulfill_sales_order", { p_sale_id: reserveSale });
  check("17. fulfill a reserved sale", !f.error && f.data?.fulfilled_lines === 1, f.msg);
  const qty = (await q("select quantity from public.parts where id=$1", [P4]))[0].quantity;
  const sst = (await q("select fulfillment_status from public.sales where id=$1", [reserveSale]))[0].fulfillment_status;
  check("17. fulfilled: quantity 0 and sale fulfilled", qty === 0 && sst === "fulfilled", `qty=${qty} st=${sst}`);
  const f2 = await rpc(S.manager, "fulfill_sales_order", { p_sale_id: reserveSale });
  check("17. a fulfilled line cannot be fulfilled twice", f2.data?.fulfilled_lines === 0 && f2.data?.idempotent_replay === true);
  const rel2 = await rpc(S.manager, "release_reservation", { p_sale_id: reserveSale });
  check("17. a fulfilled reservation cannot be released as active", rel2.data?.released === 0);
}
{
  // 15. fulfill now: immediate consumption, no reserve step
  const r = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P5, description: "p5", quantity: 1, unit_price: 80 }], p_mode: "fulfill_now" });
  sales.push(r.data?.sale_id);
  const qty = (await q("select quantity, operational_status from public.parts where id=$1", [P5]))[0];
  check("15. fulfill now consumes immediately and marks the sale fulfilled", !r.error && qty.quantity === 0 && r.data?.fulfillment_status === "fulfilled", r.msg);
}
{
  // 18. zero quantity is retained and listed as out of stock
  const row = (await rpc(S.manager, "search_sellable_parts", { p_search: "MS-" + run + "-7", p_limit: 5 })).data?.find((x) => x.id === P_ZERO);
  const dbRow = (await q("select count(*)::int c from public.parts where id=$1", [P_ZERO]))[0].c;
  check("18. zero-stock part is kept in the database", dbRow === 1);
  check("18. zero-stock part is still shown in POS search, flagged out of stock", !!row && row.out_of_stock === true && row.available === 0, JSON.stringify(row ?? "missing"));
  // 19. out of stock prevented
  const oos = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P_ZERO, description: "z", quantity: 1, unit_price: 15 }], p_mode: "reserve" });
  check("19. reserving an out-of-stock part is refused (OUT_OF_STOCK)", oos.hint === "OUT_OF_STOCK", `hint=${oos.hint}`);
}
{
  // 21. multi-line rollback (fulfill now): P6 (available) + P_ZERO (out) -> nothing persists
  const pre = (await q("select quantity from public.parts where id=$1", [P6]))[0].quantity;
  const preSales = (await q("select count(*)::int c from public.sales where customer_id=$1", [cust]))[0].c;
  const r = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P6, description: "p6", quantity: 1, unit_price: 90 }, { part_id: P_ZERO, description: "z", quantity: 1, unit_price: 15 }], p_mode: "fulfill_now" });
  check("21. multi-line sale with one out-of-stock line refused", r.hint === "OUT_OF_STOCK", `hint=${r.hint}`);
  const post = (await q("select quantity from public.parts where id=$1", [P6]))[0].quantity;
  const postSales = (await q("select count(*)::int c from public.sales where customer_id=$1", [cust]))[0].c;
  check("21. rollback: the available line was not consumed and no sale was written", pre === post && preSales === postSales, `qty ${pre}->${post}, sales ${preSales}->${postSales}`);
}
{
  // 20. last-unit race: two managers fulfil the last unit of P5-like part (fresh part, qty 1)
  const PR = await sellablePart(20, { price: 42 });
  const [a, b] = await Promise.all([
    rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: PR, description: "r", quantity: 1, unit_price: 42 }], p_mode: "fulfill_now" }),
    rpc(S.owner, "create_sale", { p_customer_id: cust2, p_lines: [{ part_id: PR, description: "r", quantity: 1, unit_price: 42 }], p_mode: "fulfill_now" }),
  ]);
  const ok = [a, b].filter((r) => !r.error);
  if (ok[0]) sales.push(ok[0].data.sale_id);
  check("20. last-unit parallel fulfil-now: exactly one succeeds", ok.length === 1, `ok=${ok.length}`);
  const qty = (await q("select quantity from public.parts where id=$1", [PR]))[0].quantity;
  check("20. no negative quantity after the race", qty === 0, `qty=${qty}`);
}
{
  // 23. duplicate client request replay
  const req1 = crypto.randomUUID();
  const P7 = await sellablePart(21, { price: 11, qty: 2 });
  const first = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P7, description: "d", quantity: 1, unit_price: 11 }], p_mode: "fulfill_now", p_client_request_id: req1 });
  const second = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P7, description: "d", quantity: 1, unit_price: 11 }], p_mode: "fulfill_now", p_client_request_id: req1 });
  sales.push(first.data?.sale_id);
  check("23. retried create_sale returns the same sale", second.data?.sale_id === first.data?.sale_id && second.data?.idempotent_replay === true);
  const qty = (await q("select quantity from public.parts where id=$1", [P7]))[0].quantity;
  check("23. retry did not consume stock twice (2 -> 1)", qty === 1, `qty=${qty}`);
}
{
  // 22. wrong role on sales writes
  for (const [label, c] of [["dismantling", S.dismantling], ["receiving", S.receiving], ["scrap driver", S.scrap_driver], ["warehouse", S.employee], ["auction", S.auction]]) {
    const r = await rpc(c, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P1, description: "x", quantity: 1, unit_price: 50 }], p_mode: "draft" });
    check(`22. ${label} cannot create a sale`, r.code === "42501", `code=${r.code}`);
  }
  const rr = await rpc(S.employee, "reserve_stock", { p_sale_id: reserveSale });
  check("22. warehouse cannot reserve stock", rr.code === "42501");
  const direct = await S.manager.from("sales").update({ amount_paid: 999 }).eq("id", reserveSale).select("id");
  check("24. direct update of amount_paid is blocked", !!direct.error || (direct.data?.length ?? 0) === 0, direct.error?.message?.slice(0, 50) ?? "rows=0");
  const direct2 = await S.manager.from("sales").update({ balance_due: 0 }).eq("id", reserveSale).select("id");
  check("24. direct update of balance_due is blocked", !!direct2.error || (direct2.data?.length ?? 0) === 0);
  const direct3 = await S.manager.from("sales").update({ payment_status: "PAID" }).eq("id", reserveSale).select("id");
  check("24. direct update of payment_status is blocked", !!direct3.error || (direct3.data?.length ?? 0) === 0);
}
// =========================== QUOTE -> SALE CONVERSION ===========================
let convertedSale;
{
  // 10. convert quote A (reserve mode)
  const c = await rpc(S.manager, "convert_quote_to_sale", { p_quote_id: quoteA, p_mode: "reserve" });
  check("10. convert quote to a sale", !c.error && !!c.data?.sale_id && c.data.idempotent_replay === false, c.msg);
  convertedSale = c.data?.sale_id; sales.push(convertedSale);
  const qrow = (await q("select status, converted_sale_id from public.quotes where id=$1", [quoteA]))[0];
  const srow = (await q("select quote_id, total, subtotal from public.sales where id=$1", [convertedSale]))[0];
  check("10. quote is CONVERTED and linked; sale carries the quote link", qrow.status === "CONVERTED" && qrow.converted_sale_id === convertedSale && srow.quote_id === quoteA);
  check("10. converted sale total matches the quote total (115)", Number(srow.total) === 115, `total=${srow.total}`);
  // 11. retry does not create a second sale
  const retry = await rpc(S.manager, "convert_quote_to_sale", { p_quote_id: quoteA, p_mode: "reserve" });
  check("11. conversion retry returns the same sale", retry.data?.sale_id === convertedSale && retry.data?.idempotent_replay === true);
  const n = (await q("select count(*)::int c from public.sales where quote_id=$1", [quoteA]))[0].c;
  check("11. exactly one sale exists for the quote", n === 1, `sales=${n}`);
  const res = (await q("select count(*)::int c from public.inventory_reservations where sale_id=$1 and status='active'", [convertedSale]))[0].c;
  check("10. conversion reserved the stock lines (P1 and P2)", res === 2, `active=${res}`);
  const edit = await rpc(S.manager, "update_quote", { p_quote_id: quoteA, p_customer_id: cust, p_lines: [{ part_id: P1, quantity: 1 }], p_discount: 0 });
  check("   a converted quote is locked", edit.hint === "QUOTE_LOCKED", `hint=${edit.hint}`);
  const detail = await rpc(S.manager, "get_sale_detail", { p_sale_id: convertedSale });
  check("   sale detail links the quote and shows the reservation state", detail.data?.quote?.id === quoteA && detail.data?.reservations?.length === 2, detail.msg);
}
{
  // 12. conversion failure rolls back everything: quote with P_ZERO fulfill-now
  const qf = (await rpc(S.manager, "create_quote", { p_customer_id: cust, p_lines: [{ part_id: P1, quantity: 1 }, { part_id: P_ZERO, quantity: 1 }] })).data.quote_id;
  quotes.push(qf);
  const preSales = (await q("select count(*)::int c from public.sales where customer_id=$1", [cust]))[0].c;
  const preQty = (await q("select quantity from public.parts where id=$1", [P1]))[0].quantity;
  const r = await rpc(S.manager, "convert_quote_to_sale", { p_quote_id: qf, p_mode: "fulfill_now" });
  check("12. conversion with an out-of-stock line is refused", r.hint === "OUT_OF_STOCK", `hint=${r.hint}`);
  const postSales = (await q("select count(*)::int c from public.sales where customer_id=$1", [cust]))[0].c;
  const postQty = (await q("select quantity from public.parts where id=$1", [P1]))[0].quantity;
  const qst = (await q("select status, converted_sale_id from public.quotes where id=$1", [qf]))[0];
  check("12. rollback: no sale, no stock move, quote still DRAFT", preSales === postSales && preQty === postQty && qst.status === "DRAFT" && qst.converted_sale_id === null, `sales ${preSales}->${postSales} qty ${preQty}->${postQty} st=${qst.status}`);
}
{
  // Quote lifecycle: DRAFT -> SENT -> APPROVED; invalid jump refused
  const ql = (await rpc(S.manager, "create_quote", { p_customer_id: cust, p_lines: [{ description: "L", quantity: 1, unit_price: 9 }] })).data.quote_id;
  quotes.push(ql);
  const jump = await rpc(S.manager, "set_quote_status", { p_quote_id: ql, p_status: "APPROVED" });
  check("   DRAFT -> APPROVED is an invalid jump", jump.hint === "INVALID_TRANSITION");
  await rpc(S.manager, "set_quote_status", { p_quote_id: ql, p_status: "SENT" });
  const ok = await rpc(S.manager, "set_quote_status", { p_quote_id: ql, p_status: "APPROVED" });
  check("   DRAFT -> SENT -> APPROVED", ok.data?.status === "APPROVED", ok.msg);
  const conv = await rpc(S.manager, "convert_quote_to_sale", { p_quote_id: ql, p_mode: "draft" });
  check("   an approved quote converts (draft mode)", !conv.error && !!conv.data?.sale_id, conv.msg);
  sales.push(conv.data?.sale_id);
}
{
  // Tax: the rate is a percent. Set 10% for this check only, then restore the empty settings state.
  const hadRow = (await q("select count(*)::int c from public.sales_settings"))[0].c;
  await db.query("insert into public.sales_settings (id, tax_rate, tax_label, business_name) values (1, 10, 'Tax', 'Test') on conflict (id) do update set tax_rate = 10");
  try {
    const t = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ description: "Taxed", quantity: 1, unit_price: 100 }], p_mode: "draft" });
    sales.push(t.data?.sale_id);
    check("tax: 100 at 10% percent gives total 110", Number(t.data?.total) === 110, `total=${t.data?.total}`);
  } finally {
    if (hadRow === 0) await db.query("delete from public.sales_settings where id = 1");
    else await db.query("update public.sales_settings set tax_rate = 0 where id = 1");
  }
}
{
  // Sales list and detail read models
  const l = await rpc(S.manager, "list_sales", { p_search: tag, p_status: null, p_limit: 2, p_cursor_created_at: null, p_cursor_id: null });
  check("sales list returns lightweight rows", !l.error && (l.data ?? []).length > 0 && !("lines" in (l.data[0] ?? {})), l.msg);
  const seen = [];
  let cur = l, guard = 0;
  while (cur.data?.length && guard++ < 30) {
    seen.push(...cur.data.map((r) => r.id));
    const last = cur.data[cur.data.length - 1];
    if (!last.has_more) break;
    cur = await rpc(S.manager, "list_sales", { p_search: tag, p_status: null, p_limit: 2, p_cursor_created_at: last.created_at, p_cursor_id: last.id });
  }
  check("sales keyset list has no duplicates", new Set(seen).size === seen.length, `rows=${seen.length}`);
  const dn = await rpc(S.dismantling, "list_sales", { p_search: null, p_status: null, p_limit: 5, p_cursor_created_at: null, p_cursor_id: null });
  check("dismantling employee cannot list sales", dn.code === "42501");
  const sd = await rpc(S.receiving, "get_sale_detail", { p_sale_id: convertedSale });
  check("receiving cannot open sale detail", sd.code === "42501");
}

// Cleanup (DEV only). Sales and quotes are swept by fixture customer as well as by tracked id,
// so a quote or sale created by any call in this run is removed before its parts are deleted.
{
  const sa = [...new Set([...sales.filter(Boolean), ...(await q("select id from public.sales where customer_id = any($1::uuid[])", [customers])).map((r) => r.id)])];
  if (sa.length) {
    await db.query("update public.quotes set converted_sale_id = null where converted_sale_id = any($1::uuid[])", [sa]);
    await db.query("delete from public.inventory_reservations where sale_id = any($1::uuid[])", [sa]);
    await db.query("delete from public.payment_allocations where sale_id = any($1::uuid[])", [sa]);
    await db.query("delete from public.sale_items where sale_id = any($1::uuid[])", [sa]);
    await db.query("delete from public.sales where id = any($1::uuid[])", [sa]);
  }
  const qa = [...new Set([...quotes.filter(Boolean), ...(await q("select id from public.quotes where customer_id = any($1::uuid[])", [customers])).map((r) => r.id)])];
  if (qa.length) {
    await db.query("delete from public.quote_items where quote_id = any($1::uuid[])", [qa]);
    await db.query("delete from public.quotes where id = any($1::uuid[])", [qa]);
  }
  await db.query("delete from public.quote_items where part_id = any($1::uuid[])", [parts]);
  await db.query("delete from public.media_assets where id = any($1::uuid[])", [media]);
  await db.query("delete from public.part_operations where part_id = any($1::uuid[])", [parts]);
  await db.query("delete from public.parts where id = any($1::uuid[])", [parts]);
  await db.query("delete from public.vehicle_events where vehicle_id = any($1::uuid[])", [vehicles]);
  await db.query("delete from public.dismantling_sessions where id = any($1::uuid[])", [sessions]);
  await db.query("delete from public.dismantling_assignment_history where vehicle_id = any($1::uuid[])", [vehicles]);
  await db.query("delete from public.dismantling_assignments where vehicle_id = any($1::uuid[])", [vehicles]);
  await db.query("delete from public.vehicles where id = any($1::uuid[])", [vehicles]);
  await db.query("delete from public.customers where id = any($1::uuid[])", [customers]);
  const left = (await q("select count(*)::int c from public.vehicles where auction_source=$1", [SRC]))[0].c;
  check("cleanup removed module 08 fixtures", left === 0, `left=${left}`);
}
await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
