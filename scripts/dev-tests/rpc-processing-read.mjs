// Module 05 — processing read authority over the real DEV database, through supabase-js as real roles.
// Checks the employee-count aggregate against direct SQL, the period cap, role denial, and bounded review paging.
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

const from = new Date(Date.now() - 30 * 86400000).toISOString();
const to = new Date(Date.now() + 60_000).toISOString();

// Counts agree with direct SQL for every employee in the window.
const rpc = await mgr.rpc("dismantling_employee_counts", { p_from: from, p_to: to });
check("employee counts respond for a manager", !rpc.error, rpc.error?.message ?? "");
const truth = (await db.query(`
  select p.captured_by as employee_id, count(*)::int as parts_captured,
         count(*) filter (where p.status='approved')::int as parts_approved,
         count(*) filter (where p.status in ('captured','draft_ready','manager_review'))::int as parts_pending
    from public.parts p
   where p.dismantling_session_id is not null and p.captured_by is not null
     and p.created_at >= $1 and p.created_at < $2
   group by p.captured_by`, [from, to])).rows;
const byId = new Map((rpc.data ?? []).map((r) => [r.employee_id, r]));
const mismatch = truth.filter((t) => {
  const r = byId.get(t.employee_id);
  return !r || r.parts_captured !== t.parts_captured || r.parts_approved !== t.parts_approved || r.parts_pending_review !== t.parts_pending;
});
check("every employee's counts equal direct SQL", mismatch.length === 0 && byId.size === truth.length, `rows=${byId.size} truth=${truth.length} mismatches=${mismatch.length}`);

// Period cap and bad input are refused, not silently widened.
const wide = await mgr.rpc("dismantling_employee_counts", { p_from: "2000-01-01T00:00:00Z", p_to: new Date().toISOString() });
check("a period longer than 400 days is refused", !!wide.error && /400 days/.test(wide.error.message));
const inverted = await mgr.rpc("dismantling_employee_counts", { p_from: to, p_to: from });
check("an inverted period is refused", !!inverted.error);

// Only managers see employee counts.
const denied = await scrap.rpc("dismantling_employee_counts", { p_from: from, p_to: to });
check("scrap driver cannot read employee counts", !!denied.error || (denied.data ?? []).length === 0, denied.error?.message ?? `rows=${(denied.data ?? []).length}`);

// The review queue page is bounded by the requested limit and pages without repeats.
const page1 = await mgr.rpc("list_dismantling_review_queue", { p_from: null, p_to: null, p_limit: 2, p_cursor_created_at: null, p_cursor_id: null });
const rows1 = (page1.data ?? []).map((r) => ({ ...r }));
check("review page respects its limit", rows1.length <= 2, `rows=${rows1.length}`);
if (rows1.length && rows1[rows1.length - 1].has_more) {
  const last = rows1[rows1.length - 1];
  const page2 = await mgr.rpc("list_dismantling_review_queue", { p_from: null, p_to: null, p_limit: 2, p_cursor_created_at: last.created_at, p_cursor_id: last.id });
  const ids = new Set(rows1.map((r) => r.id));
  check("the next review page has no repeated items", (page2.data ?? []).every((r) => !ids.has(r.id)));
} else {
  check("review paging check skipped: queue fits one page", true, `rows=${rows1.length}`);
}

// Review rows carry lightweight fields only: no part photos or history payloads.
const sample = rows1[0];
if (sample) {
  const keys = Object.keys(sample);
  const heavy = keys.filter((k) => /photo_url|history|events|payload|signed/i.test(k));
  check("review rows carry no heavy fields", heavy.length === 0, `keys=${keys.join(",")}`);
}

console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail === 0 ? 0 : 1);
