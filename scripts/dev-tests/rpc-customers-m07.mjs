// Module 07 — customer master rules over the real DEV database, through supabase-js as real roles.
// Covers phone normalization on the server, duplicate candidates with explicit confirmation, edit denial and audit,
// keyset paging without repeats, customer history on demand, and tolerance of a null customer_number.
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

const tag = crypto.randomUUID().slice(0, 6).toUpperCase();
const phone = "(555) 010-" + String(Math.floor(1000 + Math.random() * 8999));
const first = "M07" + tag;

// Phone normalization on the server: digits only in the stored normalized column.
const made = await mgr.rpc("create_customer", { p_data: { first_name: first, last_name: "Test", phone }, p_client_request_id: crypto.randomUUID() });
check("a customer is created with a formatted phone", !made.error, made.error?.message ?? "");
const row = (await db.query("select id, phone_normalized, customer_number from public.customers where first_name=$1", [first])).rows[0];
check("the phone is stored normalized (digits only)", row && /^\d+$/.test(row.phone_normalized) && row.phone_normalized.length >= 7, `normalized=${row?.phone_normalized}`);
check("no customer number is invented on create", row && row.customer_number === null, `customer_number=${row?.customer_number}`);

// Duplicate candidate: the same phone is reported, not silently merged, and needs an explicit confirmation.
const dup = await mgr.rpc("create_customer", { p_data: { first_name: "M07" + tag + "dup", last_name: "Person", phone }, p_client_request_id: crypto.randomUUID() });
const dupOutcome = dup.data?.outcome;
check("a second customer with the same phone is reported as a possible duplicate", dupOutcome === "possible_duplicate", `outcome=${dupOutcome} error=${dup.error?.message ?? ""}`);
const dupRows = await db.query("select count(*)::int c from public.customers where first_name=$1", ["M07" + tag + "dup"]);
check("the duplicate candidate is not created until confirmed", Number(dupRows.rows[0].c) === 0);
const confirmed = await mgr.rpc("create_customer", { p_data: { first_name: "M07" + tag + "dup", last_name: "Person", phone, confirm_new: true }, p_client_request_id: crypto.randomUUID() });
check("an explicit confirmation creates the customer", !confirmed.error && confirmed.data?.outcome === "created", confirmed.error?.message ?? confirmed.data?.outcome ?? "");

// Edit: allowed by a manager and audited; denied for a role without customer access.
const edit = await mgr.rpc("update_customer", { p_customer_id: row.id, p_data: { notes: "M07 note " + tag } });
check("a manager edits an allowed field", !edit.error, edit.error?.message ?? "");
const audit = (await db.query("select count(*)::int c from public.audit_logs where entity_type='customer' and entity_id=$1 and action like 'customer.%'", [row.id])).rows[0].c;
check("the customer edit is audited", Number(audit) >= 1, `audit rows=${audit}`);
const denied = await scrap.rpc("update_customer", { p_customer_id: row.id, p_data: { notes: "scrap attempt" } });
check("a scrap driver cannot edit a customer", !!denied.error);
const notesNow = (await db.query("select notes from public.customers where id=$1", [row.id])).rows[0].notes;
check("the denied edit changed nothing", notesNow !== "scrap attempt");

// History loads on demand for one customer and tolerates a null number.
const hist = await mgr.rpc("customer_history", { p_customer_id: row.id });
check("customer history loads for a customer with no number", !hist.error && hist.data !== null, hist.error?.message ?? "");

// Keyset paging: every customer appears once across pages of 2.
const seen = new Set();
let cursor = null, dupes = 0, pages = 0;
for (;;) {
  const page = await mgr.rpc("list_customers", { p_search: "M07" + tag, p_limit: 2, p_cursor_last: cursor?.last ?? null, p_cursor_first: cursor?.first ?? null, p_cursor_id: cursor?.id ?? null });
  if (page.error) { check("customer search pages respond", false, page.error.message); break; }
  pages++;
  const rows = page.data ?? [];
  for (const r of rows) { if (seen.has(r.id)) dupes++; seen.add(r.id); }
  const more = rows.length && rows[0].has_more;
  if (!more || rows.length === 0 || pages > 50) break;
  const tail = rows[rows.length - 1];
  cursor = { last: tail.last_name, first: tail.first_name, id: tail.id };
}
check("customer search pages without repeats", dupes === 0, `pages=${pages} found=${seen.size}`);
check("customer search finds the test customers by name", seen.size >= 2, `found=${seen.size}`);

// Phone search finds by normalized digits.
const byPhone = await mgr.rpc("list_customers", { p_search: row.phone_normalized, p_limit: 10, p_cursor_last: null, p_cursor_first: null, p_cursor_id: null });
check("customer search by phone digits finds the customer", (byPhone.data ?? []).some((r) => r.id === row.id), byPhone.error?.message ?? "");

console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail === 0 ? 0 : 1);
