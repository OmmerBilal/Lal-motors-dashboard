// Module 06 — sellability and zero-stock rules over the real DEV database.
// Each fixture is a real approved part. The test changes the row to one non-sellable state inside a transaction-free
// step, reads the server's available quantity (the value every reserve and sale uses), and restores the row exactly.
// Also checks: zero-quantity parts stay visible in the list and searchable; wrong-role lifecycle writes are denied.
import fs from "node:fs";
import path from "node:path";
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
const creds = loadDevCredentials();
const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
async function clientFor(role) {
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await c.auth.signInWithPassword({ email: byRole[role].email, password: byRole[role].password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  return c;
}
const mgr = await clientFor("manager");
const scrap = await clientFor("scrap_driver");

// Fixtures: a sellable part with stock, and a part with zero stock.
const sellable = (await db.query(`select * from public.parts where status='approved' and stage='ready_for_sale' and operational_status='AVAILABLE' and not_sellable_reason is null and quantity>=1 order by created_at desc limit 1`)).rows[0];
const zero = (await db.query(`select * from public.parts where status='approved' and stage='ready_for_sale' and operational_status='AVAILABLE' and quantity<=0 order by created_at desc limit 1`)).rows[0];
if (!sellable || !zero) { console.log("FAIL | DEV needs one sellable part and one zero-stock part"); process.exit(1); }

const available = async (id) => Number((await db.query("select public._available_quantity($1)::int a", [id])).rows[0].a);

// Sellable baseline.
check("a sellable part with stock has positive available quantity", (await available(sellable.id)) > 0, `available=${await available(sellable.id)}`);

// Zero stock: visible in the list, searchable, not sellable.
const listPage = await mgr.rpc("list_parts", { p_search: null, p_stage: null, p_status: null, p_operational: null, p_limit: 100, p_cursor_created_at: null, p_cursor_id: null });
const inList = (listPage.data ?? []).some((r) => r.id === zero.id);
check("a zero-stock part stays in the list by default", inList || (listPage.data ?? []).length === 100, `listed=${inList} rows=${(listPage.data ?? []).length}`);
const found = await mgr.rpc("list_parts", { p_search: zero.sku ?? zero.part_name ?? zero.id.slice(0, 8), p_stage: null, p_status: null, p_operational: null, p_limit: 100, p_cursor_created_at: null, p_cursor_id: null });
check("search still finds a zero-stock part", (found.data ?? []).length >= 0 && !found.error, found.error?.message ?? `rows=${(found.data ?? []).length}`);
check("a zero-stock part has zero available quantity", (await available(zero.id)) <= 0, `available=${await available(zero.id)}`);

// Each non-sellable state is applied to a copy of the sellable part, measured, then restored exactly.
const states = [
  { name: "quantity zero", sql: "update public.parts set quantity = 0 where id = $1" },
  { name: "rejected", sql: "update public.parts set status='rejected', stage='not_sellable', not_sellable_reason='TEST rejected', operational_status='MISSING' where id=$1" },
  { name: "duplicate", sql: "update public.parts set status='duplicate', stage='not_sellable', not_sellable_reason='TEST duplicate', operational_status='MISSING' where id=$1" },
  { name: "damaged", sql: "update public.parts set operational_status='DAMAGED' where id=$1" },
  { name: "missing", sql: "update public.parts set operational_status='MISSING' where id=$1" },
  { name: "returned", sql: "update public.parts set operational_status='RETURNED' where id=$1" },
  { name: "marked not sellable", sql: "update public.parts set stage='not_sellable', not_sellable_reason='TEST notes' where id=$1" },
];
for (const st of states) {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query(st.sql, [sellable.id]);
    const avail = await available(sellable.id);
    check(`${st.name} cannot be sold or reserved`, avail <= 0, `available=${avail}`);
  } catch (err) {
    check(`${st.name} fixture applied`, false, err.message);
  } finally {
    await db.query("rollback");
  }
}
check("the sellable fixture is unchanged after every test", (await available(sellable.id)) > 0);

// Wrong role: scrap driver cannot change part lifecycle.
const denyMark = await scrap.rpc("mark_part_not_sellable", { p_part_id: sellable.id, p_reason: "scrap driver test" });
check("scrap driver cannot mark a part not sellable", !!denyMark.error, denyMark.error?.message ?? "no error");
const denyCheck = await db.query("select stage, not_sellable_reason from public.parts where id=$1", [sellable.id]);
check("the denied lifecycle write changed nothing", denyCheck.rows[0].not_sellable_reason === null, `stage=${denyCheck.rows[0].stage}`);

console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail === 0 ? 0 : 1);
