// Final security attack matrix — direct RPC misuse as each role over the real DEV database (supabase-js, real sessions).
// Every probe targets a non-existent id, so no data can change even if a check were missing. A probe counts as DENIED
// only when the call fails with a role or permission reason. A "not found" answer means the role got past the role
// check, so it is reported as a failure of the matrix for roles that must be refused.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));

const ZERO = "00000000-0000-4000-8000-000000000000";
const ROLES = ["dismantling", "scrap_driver", "container_loading", "employee", "receiving", "auction", "manager", "export_manager", "owner", "engineer_admin"];

// Probe: function, args, and the roles that MUST be refused for that function.
const PROBES = [
  // Scrap office operations: the documented office rule (owner, engineer_admin, manager, auction) is probed for the
  // roles outside it. The auction role is part of the documented rule, so it is NOT listed here (see the report).
  { fn: "scrap_manager_approve_load", args: { p_load_id: ZERO }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "receiving", "export_manager"] },
  { fn: "scrap_manager_correct_financials", args: { p_load_id: ZERO, p_weight: 1, p_rate: 1, p_amount_override: null, p_reason: "matrix probe" }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "receiving", "export_manager"] },
  { fn: "scrap_manager_record_payment", args: { p_driver_id: ZERO, p_load_ids: [], p_amount_received: 1, p_method: "cash", p_reference: "", p_notes: "", p_payment_date: null, p_client_request_id: null }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "receiving", "export_manager"] },
  { fn: "void_payment", args: { p_payment_id: ZERO, p_reason: "matrix probe" }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "receiving", "auction"] },
  { fn: "export_finalize_invoice", args: { p_invoice_id: ZERO, p_client_request_id: null }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "receiving", "auction", "manager"] },
  { fn: "export_reverse_payment", args: { p_payment_id: ZERO, p_reason: "matrix probe", p_client_request_id: null }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "receiving", "auction", "manager"] },
  { fn: "export_get_container", args: { p_container_id: ZERO }, deny: ["dismantling", "scrap_driver", "employee", "receiving", "auction", "manager"] },
  { fn: "approve_dismantled_part", args: { p_part_id: ZERO }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "receiving", "auction", "export_manager"] },
  { fn: "close_vehicle", args: { p_vehicle_id: ZERO, p_reason: "Other", p_note: "matrix probe" }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "export_manager", "receiving", "auction"] },
  { fn: "reopen_vehicle", args: { p_vehicle_id: ZERO, p_note: "matrix probe" }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "export_manager", "receiving", "auction"] },
  { fn: "mark_part_not_sellable", args: { p_part_id: ZERO, p_reason: "matrix probe" }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "receiving", "auction", "export_manager"] },
  { fn: "dismantling_employee_counts", args: { p_from: "2026-01-01T00:00:00Z", p_to: "2026-01-02T00:00:00Z" }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "receiving", "auction", "export_manager"] },
  { fn: "vehicle_decide_completion", args: { p_completion_id: ZERO, p_decision: "approved", p_reason: "" }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "receiving", "auction", "export_manager"] },
  { fn: "vehicle_apply_merge", args: { p_vehicle_id: ZERO, p_expected_updated_at: "2026-01-01T00:00:00Z", p_changes: { make: "x" } }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "export_manager"] },
  { fn: "update_customer", args: { p_customer_id: ZERO, p_data: { notes: "matrix probe" } }, deny: ["dismantling", "scrap_driver", "container_loading", "receiving", "auction", "export_manager"] },
  { fn: "assign_carrier_items", args: { p_carrier_id: ZERO, p_items: [] }, deny: ["dismantling", "scrap_driver", "container_loading", "employee", "export_manager"] },
];

const DENY_WORDS = /forbidden|permission|not allowed|may not|cannot|only a|only an|role|42501|not permitted|not authorised|not authorized/i;
function classify(res) {
  if (!res.error) return { denied: false, why: "call succeeded (no error)" };
  const msg = res.error.message ?? "";
  if (/not found|does not exist|could not find/i.test(msg)) return { denied: false, why: "passed the role check: " + msg.slice(0, 80) };
  return { denied: DENY_WORDS.test(msg) || res.error.code === "42501", why: msg.slice(0, 100) };
}

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

const sessions = {};
for (const role of ROLES) {
  if (!byRole[role]) continue;
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await c.auth.signInWithPassword({ email: byRole[role].email, password: byRole[role].password });
  if (error) { console.log(`FAIL | sign-in ${role}: ${error.message}`); process.exit(1); }
  sessions[role] = c;
}

for (const probe of PROBES) {
  for (const role of probe.deny) {
    if (!sessions[role]) continue;
    const res = await sessions[role].rpc(probe.fn, probe.args);
    const r = classify(res);
    check(`${role} is refused ${probe.fn}`, r.denied, r.why);
  }
}

// Forbidden role reads of the mutation-only AI tool path are refused in the route gate (JSON 401/403); covered by route-gate.
// Confidential export reads: a manager without export access sees no container payload.
if (sessions.manager) {
  const res = await sessions.manager.rpc("export_list_containers", { p_limit: 5 });
  check("manager reading the export list is refused or gets no confidential rows", !!res.error || (res.data ?? []).length === 0, res.error?.message ?? `rows=${(res.data ?? []).length}`);
}

console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
