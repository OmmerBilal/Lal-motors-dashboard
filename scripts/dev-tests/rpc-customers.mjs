// Customer RPC tests (migration 0024). Real signed-in sessions against DEV.
// Creates its own customers and sales; removes them at the end.
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
async function signIn(role) {
  const u = byRole[role];
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  return c;
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); return { data, error, code: error?.code, hint: error?.hint, msg: error?.message ?? "" }; };

const S = {};
for (const r of ["manager", "owner", "engineer_admin", "employee", "dismantling", "scrap_driver", "receiving"]) S[r] = await signIn(r);

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const tag = "CUSTTEST-" + run;
const createdCustomers = [];
const createdSales = [];

// =========================== A. ROLE MATRIX ===========================
for (const [label, c] of [["warehouse employee", S.employee], ["dismantling employee", S.dismantling], ["scrap driver", S.scrap_driver], ["receiving", S.receiving]]) {
  const r = await rpc(c, "create_customer", { p_data: { first_name: "X", phone: "5559990000" } });
  check(`${label} cannot create a customer`, r.code === "42501", `code=${r.code}`);
  const l = await rpc(c, "list_customers", { p_search: null, p_limit: 5, p_cursor_last: null, p_cursor_first: null, p_cursor_id: null });
  check(`${label} cannot list customers`, l.code === "42501", `code=${l.code}`);
}

// =========================== B. VALIDATION ===========================
{
  const bad = [
    ["no name at all", { phone: "5551230000" }],
    ["phone too short", { first_name: "A", phone: "12" }],
    ["invalid email", { first_name: "A", phone: "5551230001", email: "not-an-email" }],
    ["unknown customer type", { first_name: "A", phone: "5551230002", customer_type: "vip" }],
    ["unknown tax status", { first_name: "A", phone: "5551230003", tax_status: "maybe" }],
  ];
  for (const [label, data] of bad) {
    const r = await rpc(S.manager, "create_customer", { p_data: data });
    check(`create rejects ${label}`, r.code === "22023", `code=${r.code}`);
  }
}

// =========================== C. NORMALIZATION ===========================
{
  const n1 = (await q("select public.normalize_phone($1) p", ["(555) 019-9999"]))[0].p;
  check("phone normalizes to digits", n1 === "5550199999", n1);
  const n2 = (await q("select public.normalize_phone($1) p", ["+1 555-019-9999"]))[0].p;
  check("leading country code 1 is removed", n2 === "5550199999", n2);
}

// =========================== D. CREATE, DUPLICATE HINTS, IDEMPOTENCY ===========================
let custA;
{
  const r = await rpc(S.manager, "create_customer", { p_data: { first_name: "Dana", last_name: tag, phone: "(555) 019-9999", email: "Dana." + run + "@Example.com" } });
  check("create a customer", r.data?.outcome === "created", r.msg || JSON.stringify(r.data));
  custA = r.data.customer_id; createdCustomers.push(custA);
  const row = (await q("select phone_normalized, email from public.customers where id=$1", [custA]))[0];
  check("stored phone is normalized and email lower-cased", row.phone_normalized === "5550199999" && row.email === ("dana." + run.toLowerCase() + "@example.com"), JSON.stringify(row));
  const retry = await rpc(S.manager, "create_customer", { p_data: { first_name: "Dana", last_name: tag, phone: "(555) 019-9999" }, p_client_request_id: crypto.randomUUID() });
  createdCustomers.push(retry.data?.customer_id);
  const rid = crypto.randomUUID();
  const first = await rpc(S.manager, "create_customer", { p_data: { first_name: "Eli", last_name: tag, phone: "5550300001" }, p_client_request_id: rid });
  createdCustomers.push(first.data?.customer_id);
  const again = await rpc(S.manager, "create_customer", { p_data: { first_name: "Eli", last_name: tag, phone: "5550300001" }, p_client_request_id: rid });
  check("retried create with the same request id returns the same customer", again.data?.customer_id === first.data?.customer_id && again.data?.idempotent_replay === true);
  const dupPhone = await rpc(S.manager, "create_customer", { p_data: { first_name: "Other", last_name: tag, phone: "1 (555) 019-9999" } });
  check("same phone (different formatting) is a possible duplicate, not created", dupPhone.data?.outcome === "possible_duplicate" && dupPhone.data.matches?.length >= 1, JSON.stringify(dupPhone.data ?? dupPhone.msg));
  const n = (await q("select count(*)::int c from public.customers where last_name=$1 and first_name='Other'", [tag]))[0].c;
  check("duplicate refusal wrote no row", n === 0, `rows=${n}`);
  const dupEmail = await rpc(S.manager, "create_customer", { p_data: { first_name: "Mail", last_name: tag, phone: "5550300777", email: "DANA." + run + "@example.com" } });
  check("same email in different case is a possible duplicate", dupEmail.data?.outcome === "possible_duplicate");
  const confirmed = await rpc(S.manager, "create_customer", { p_data: { first_name: "Other", last_name: tag, phone: "5550199999", confirm_new: true } });
  createdCustomers.push(confirmed.data?.customer_id);
  check("a confirmed duplicate is created on purpose (never silent)", confirmed.data?.outcome === "created");
  const reused = await rpc(S.owner, "create_customer", { p_data: { first_name: "Other", last_name: tag, phone: "5550199999" } });
  check("a retried create with the same duplicate data is still refused without confirm", reused.data?.outcome === "possible_duplicate");
}

// =========================== E. UPDATE ===========================
{
  const other = (await rpc(S.manager, "create_customer", { p_data: { first_name: "Fay", last_name: tag, phone: "5550400001" } })).data.customer_id;
  createdCustomers.push(other);
  const conflict = await rpc(S.manager, "update_customer", { p_customer_id: other, p_data: { phone: "(555) 019-9999" } });
  check("changing a phone to another customer's number is refused for confirmation", conflict.data?.outcome === "possible_duplicate", JSON.stringify(conflict.data ?? conflict.msg));
  const same = (await q("select phone_normalized from public.customers where id=$1", [other]))[0].phone_normalized;
  check("the refused update changed nothing", same === "5550400001");
  const ok = await rpc(S.manager, "update_customer", { p_customer_id: other, p_data: { billing_address: "1 Main St", notes: "prefers text" } });
  check("update non-conflicting fields", ok.data?.outcome === "updated", ok.msg);
  const badRole = await rpc(S.employee, "update_customer", { p_customer_id: other, p_data: { notes: "x" } });
  check("warehouse employee cannot update a customer", badRole.code === "42501");
}

// =========================== F. LIST: keyset, search, lightweight DTO ===========================
{
  const names = [];
  let cur = await rpc(S.manager, "list_customers", { p_search: tag, p_limit: 2, p_cursor_last: null, p_cursor_first: null, p_cursor_id: null });
  check("list with a search returns rows", (cur.data ?? []).length > 0, cur.msg);
  const seen = [];
  let guard = 0;
  while (cur.data?.length && guard++ < 50) {
    for (const r of cur.data) seen.push(r.id);
    if (!cur.data[cur.data.length - 1].has_more) break;
    const last = cur.data[cur.data.length - 1];
    cur = await rpc(S.manager, "list_customers", { p_search: tag, p_limit: 2, p_cursor_last: await lastName(last.id), p_cursor_first: await firstName(last.id), p_cursor_id: last.id });
  }
  check("keyset pagination over customers has no duplicates", new Set(seen).size === seen.length, `rows=${seen.length}`);
  const want = (await q("select count(*)::int c from public.customers where last_name=$1", [tag]))[0].c;
  check("paged list covers every matching customer", seen.length === want, `got=${seen.length} want=${want}`);
  const byPhone = await rpc(S.manager, "list_customers", { p_search: "(555) 019-9999", p_limit: 10, p_cursor_last: null, p_cursor_first: null, p_cursor_id: null });
  check("search by phone digits finds the normalized number", (byPhone.data ?? []).some((r) => r.id === custA), byPhone.msg);
  const dto = (await rpc(S.manager, "list_customers", { p_search: tag, p_limit: 1, p_cursor_last: null, p_cursor_first: null, p_cursor_id: null })).data?.[0] ?? {};
  check("list row is lightweight (no balance or sales fields)", !("balance_due" in dto) && !("sales" in dto) && !("total" in dto));
}

// =========================== G. HISTORY: balance from a real sale ===========================
{
  const saleRes = await rpc(S.manager, "create_sale", { p_customer_id: custA, p_lines: [{ description: "Install", quantity: 1, unit_price: 120 }], p_mode: "draft" });
  check("create a draft sale for the customer", !saleRes.error, saleRes.msg);
  createdSales.push(saleRes.data?.sale_id);
  const h = await rpc(S.manager, "customer_history", { p_customer_id: custA });
  check("history shows the sale and the balance owed (120.00)", Number(h.data?.balance_due) === 120 && (h.data?.sales ?? []).length >= 1, JSON.stringify(h.data ?? h.msg).slice(0, 160));
  const hr = await rpc(S.employee, "customer_history", { p_customer_id: custA });
  check("warehouse employee cannot read customer history", hr.code === "42501");
}

// Cleanup
{
  const sales = createdSales.filter(Boolean);
  if (sales.length) {
    await db.query("delete from public.sale_items where sale_id = any($1::uuid[])", [sales]);
    await db.query("delete from public.inventory_reservations where sale_id = any($1::uuid[])", [sales]);
    await db.query("delete from public.sales where id = any($1::uuid[])", [sales]);
  }
  const ids = createdCustomers.filter(Boolean);
  if (ids.length) await db.query("delete from public.customers where id = any($1::uuid[])", [ids]);
  const left = (await q("select count(*)::int c from public.customers where last_name = $1", [tag]))[0].c;
  check("cleanup removed test customers", left === 0, `left=${left}`);
}
await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);

async function lastName(id) { return (await q("select last_name from public.customers where id=$1", [id]))[0].last_name; }
async function firstName(id) { return (await q("select first_name from public.customers where id=$1", [id]))[0].first_name; }
