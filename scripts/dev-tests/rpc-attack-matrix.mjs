// Strict security attack matrix — direct RPC and AI-route misuse as each role over the real DEV database and dev server.
//
// Expected outcomes are EXPLICIT per (operation, role):
//   ALLOW  the role passes the authorization check. Proven by: the call does not fail with SQLSTATE 42501 (authorization)
//          or 28000 (unauthenticated). A business answer such as "not found" is the expected ALLOW answer for the
//          placeholder id used here. ALLOW probes run only where the placeholder id guarantees no write.
//   DENY   the role is refused by authorization. Proven ONLY by SQLSTATE 42501 (insufficient privilege), which the
//          role helpers raise. Message text is never used to decide a denial.
//
// Mutating operations on roles that must be DENIED are probed with a placeholder id. Guards run before any lookup,
// so a denied role cannot change data. Operations whose allowed roles would write on the placeholder are not probed
// for ALLOW and are marked "not exercised" in the report.
//
// AI tools (HTTP): ALLOW = HTTP 200 kind "read". DENY = HTTP 403 with error.category "forbidden" from the server's
// role check (the same controlled answer the tool registry returns).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const creds = loadDevCredentials();
const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;

const ZERO = "00000000-0000-4000-8000-000000000000";
const ROLES = ["owner", "engineer_admin", "manager", "export_manager", "auction", "dismantling", "scrap_driver", "container_loading", "employee", "receiving"];
const OFFICE = ["owner", "engineer_admin", "manager"];
const EXPORT = ["owner", "engineer_admin", "export_manager"];
const SALES = ["owner", "engineer_admin", "manager"];

// Each probe names the roles that must be ALLOWED. Every other role in ROLES is expected to be DENIED (42501).
const PROBES = [
  { id: "scrap: approve a load", fn: "scrap_manager_approve_load", args: { p_load_id: ZERO }, allow: OFFICE, probeAllow: true },
  { id: "scrap: correct financials", fn: "scrap_manager_correct_financials", args: { p_load_id: ZERO, p_weight: 1, p_rate: 1, p_amount_override: null, p_reason: "matrix probe" }, allow: OFFICE, probeAllow: true },
  { id: "scrap: record payment", fn: "scrap_manager_record_payment", args: { p_driver_id: ZERO, p_load_ids: [], p_amount_received: 1, p_method: "cash", p_reference: "", p_notes: "", p_payment_date: null, p_client_request_id: null }, allow: OFFICE, probeAllow: false },
  // Closing a clean day is an office action. Only an override of open blockers is limited to owner and engineer_admin,
  // and that override is not probed here (it would write). The ALLOW set is probed for DENY only, never called for ALLOW.
  { id: "scrap: daily close (clean day, office)", fn: "scrap_manager_daily_close", args: { p_date: "2026-01-01", p_override_reason: null }, allow: OFFICE, probeAllow: false },
  { id: "scrap: management summary (read)", fn: "scrap_manager_summary", args: { p_from: "2026-01-01", p_to: "2026-01-01" }, allow: OFFICE, probeAllow: true },
  { id: "container: financial read (container detail)", fn: "export_get_container", args: { p_container_id: ZERO }, allow: EXPORT, probeAllow: true },
  { id: "container: export list (read)", fn: "export_list_containers", args: { p_bucket: "open", p_limit: 5, p_before_created: null, p_before_id: null }, allow: EXPORT, probeAllow: true },
  { id: "invoice: finalize", fn: "export_finalize_invoice", args: { p_invoice_id: ZERO, p_client_request_id: ZERO }, allow: EXPORT, probeAllow: true },
  { id: "invoice: revise", fn: "export_revise_invoice", args: { p_invoice_id: ZERO, p_reason: "matrix probe", p_consignee_id: null, p_lines: [], p_client_request_id: ZERO }, allow: EXPORT, probeAllow: true },
  { id: "export payment: record", fn: "export_record_payment", args: { p_invoice_id: ZERO, p_amount: 1, p_type: "payment", p_method: "cash", p_payment_date: null, p_reference: "", p_notes: "", p_client_request_id: ZERO }, allow: EXPORT, probeAllow: true },
  { id: "export payment: reverse", fn: "export_reverse_payment", args: { p_payment_id: ZERO, p_reason: "matrix probe", p_client_request_id: ZERO }, allow: EXPORT, probeAllow: true },
  { id: "payment: void (sales)", fn: "void_payment", args: { p_payment_id: ZERO, p_reason: "matrix probe" }, allow: SALES, probeAllow: true },
  { id: "sales: reserve stock", fn: "reserve_stock", args: { p_sale_id: ZERO }, allow: SALES, probeAllow: true },
  { id: "sales: fulfil order", fn: "fulfill_sales_order", args: { p_sale_id: ZERO }, allow: SALES, probeAllow: true },
  { id: "customer: update", fn: "update_customer", args: { p_customer_id: ZERO, p_data: { notes: "matrix probe" } }, allow: SALES, probeAllow: true },
  { id: "vehicle lifecycle: close", fn: "close_vehicle", args: { p_vehicle_id: ZERO, p_reason: "Other", p_note: "matrix probe" }, allow: OFFICE, probeAllow: true },
  { id: "vehicle lifecycle: reopen", fn: "reopen_vehicle", args: { p_vehicle_id: ZERO, p_note: "matrix probe" }, allow: OFFICE, probeAllow: true },
  { id: "vehicle: merge into existing", fn: "vehicle_apply_merge", args: { p_vehicle_id: ZERO, p_expected_updated_at: "2026-01-01T00:00:00Z", p_changes: { make: "matrix" } }, allow: ["owner", "engineer_admin", "manager", "auction"], probeAllow: true },
  { id: "completion: decide", fn: "vehicle_decide_completion", args: { p_completion_id: ZERO, p_decision: "approved", p_reason: "" }, allow: OFFICE, probeAllow: true },
  { id: "part lifecycle: approve", fn: "approve_dismantled_part", args: { p_part_id: ZERO }, allow: OFFICE, probeAllow: true },
  { id: "part lifecycle: mark not sellable", fn: "mark_part_not_sellable", args: { p_part_id: ZERO, p_reason: "matrix probe" }, allow: OFFICE, probeAllow: true },
  { id: "part: detail read", fn: "get_part_detail", args: { p_part_id: ZERO }, allow: [...OFFICE, "employee"], probeAllow: true },
  { id: "team: employee counts (read)", fn: "dismantling_employee_counts", args: { p_from: "2026-01-01T00:00:00Z", p_to: "2026-01-02T00:00:00Z" }, allow: OFFICE, probeAllow: true },
];

// AI tools over HTTP. ALLOW = 200 read. DENY = 403 forbidden from the server's role check.
const AI_PROBES = [
  { id: "AI tool: find customer", body: { tool: "find_customer", arguments: { query: "zz" } }, allow: SALES },
  { id: "AI tool: management summary (owner only)", body: { tool: "get_management_summary", arguments: {} }, allow: ["owner"] },
];

const LOG_NOTE = [];
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

async function clientFor(role) {
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await c.auth.signInWithPassword({ email: byRole[role].email, password: byRole[role].password });
  if (error) throw new Error(`sign-in ${role}: ${error.message}`);
  return c;
}
async function cookieFor(role) {
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: byRole[role].email, password: byRole[role].password });
  if (error) throw new Error(`sign-in ${role}: ${error.message}`);
  const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  const CHUNK = 3180;
  return value.length <= CHUNK ? `${COOKIE}=${value}` : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => `${COOKIE}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`).join("; ");
}

const sessions = {};
for (const role of ROLES) sessions[role] = await clientFor(role);

// RPC probes. Expected per (probe, role): ALLOW or DENY. Actual: the SQLSTATE and the outcome.
const tally = { allowChecked: 0, denyChecked: 0, notExercised: 0 };
for (const probe of PROBES) {
  for (const role of ROLES) {
    const expected = probe.allow.includes(role) ? "ALLOW" : "DENY";
    if (expected === "ALLOW" && !probe.probeAllow) {
      tally.notExercised++;
      LOG_NOTE.push(`${probe.id} / ${role}: expected ALLOW, not exercised (would write on the placeholder id)`);
      continue;
    }
    const res = await sessions[role].rpc(probe.fn, probe.args);
    const code = res.error?.code ?? null;
    const actual = code === "42501" ? "DENY(42501)" : code === "28000" ? "UNAUTH(28000)" : res.error ? `PASSED-AUTH(${code ?? "error"})` : "PASSED-AUTH(no error)";
    const ok = expected === "DENY" ? code === "42501" : (code !== "42501" && code !== "28000");
    if (expected === "DENY") tally.denyChecked++; else tally.allowChecked++;
    check(`${probe.id} | ${role} | expected ${expected} | actual ${actual}`, ok, res.error ? res.error.message?.slice(0, 90) : "");
  }
}

// AI tools over HTTP.
for (const probe of AI_PROBES) {
  for (const role of ROLES) {
    const expected = probe.allow.includes(role) ? "ALLOW" : "DENY";
    const cookie = await cookieFor(role);
    const res = await fetch(BASE + "/api/ai/command", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(probe.body) });
    const json = await res.json().catch(() => ({}));
    const cat = json?.error?.category ?? json?.kind ?? "?";
    const actual = res.status === 403 && cat === "forbidden" ? "DENY(403 forbidden)" : res.status === 200 ? `PASSED-AUTH(200 ${json.kind})` : `status ${res.status} ${cat}`;
    const ok = expected === "DENY" ? res.status === 403 && cat === "forbidden" : res.status === 200;
    if (expected === "DENY") tally.denyChecked++; else tally.allowChecked++;
    check(`${probe.id} | ${role} | expected ${expected} | actual ${actual}`, ok);
  }
}

// Anonymous callers are refused before any RPC runs.
const anon = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const anonRes = await anon.rpc("scrap_manager_summary", { p_from: "2026-01-01", p_to: "2026-01-01" });
check("anonymous | scrap_manager_summary | expected DENY | actual " + (anonRes.error?.code ?? "no error"), anonRes.error?.code === "28000" || anonRes.error?.code === "42501");

console.log(`\nMATRIX: ALLOW checks ${tally.allowChecked}, DENY checks ${tally.denyChecked}, not exercised ${tally.notExercised}`);
for (const n of LOG_NOTE) console.log("NOT EXERCISED | " + n);
console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
