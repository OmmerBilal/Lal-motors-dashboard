// Module 01 — safe existing-vehicle merge over the real DEV database, through supabase-js as real roles.
// Fixtures are TEST-MRG-* vehicles created through intake; each test vehicle is left in place (no hard delete).
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
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
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

const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
const vin = ("TMRG" + tag + "00000000").slice(0, 17);
const made = await mgr.rpc("match_or_create_vehicle", { p_vin: vin, p_lot_number: "", p_stock_number: "", p_auction_source: "Copart", p_fields: { make: "TestMake", model: "TestModel", year: 2019 } });
check("fixture: intake creates a merge test vehicle", !made.error, made.error?.message ?? "");
const id = (await db.query("select id from public.vehicles where vin=$1", [vin])).rows[0].id;
const current = async () => (await db.query("select updated_at::text as updated_at, make, lot_number, stock_number, location from public.vehicles where id=$1", [id])).rows[0];

// Stale: compare at version A, change the row, then try to merge with A.
const before = await current();
const edit = await mgr.rpc("vehicle_edit_fields", { p_vehicle_id: id, p_fields: { location: "Yard A" } });
check("fixture: an edit moves the row forward", !edit.error, edit.error?.message ?? "");
const stale = await mgr.rpc("vehicle_apply_merge", { p_vehicle_id: id, p_expected_updated_at: before.updated_at, p_changes: { make: "Merged" } });
check("a merge against an old comparison is refused as STALE", !!stale.error && /STALE/.test(stale.error.message), stale.error?.message ?? "no error");
const unchangedMake = (await current()).make;
check("the refused stale merge changed nothing", unchangedMake !== "Merged");

// Fresh comparison: merge is applied only for chosen fields.
const fresh = await current();
const ok = await mgr.rpc("vehicle_apply_merge", { p_vehicle_id: id, p_expected_updated_at: fresh.updated_at, p_changes: { make: "Merged Make", model: "Merged Model" } });
check("a fresh merge applies the chosen fields", !ok.error && ok.data?.make === "Merged Make" && ok.data?.model === "Merged Model", ok.error?.message ?? "");
const mergeEvent = (await db.query("select count(*)::int c from public.vehicle_events where vehicle_id=$1 and action='DETAILS_EDITED' and note like 'Edited: make%'", [id])).rows[0].c;
check("the merge writes an edit event naming the fields", mergeEvent >= 1);
const mergeAudit = (await db.query("select count(*)::int c from public.audit_logs where entity_type='vehicle' and entity_id=$1 and action='vehicle.merged'", [id])).rows[0].c;
check("the merge is written to the audit log", mergeAudit >= 1);

// VIN can never be merged.
const v2 = await current();
const vinMerge = await mgr.rpc("vehicle_apply_merge", { p_vehicle_id: id, p_expected_updated_at: v2.updated_at, p_changes: { vin: "CHANGED00000000000" } });
check("VIN cannot be merged", !!vinMerge.error && /VIN/.test(vinMerge.error.message));

// Lot/stock fill only when blank.
const lot = await mgr.rpc("vehicle_apply_merge", { p_vehicle_id: id, p_expected_updated_at: (await current()).updated_at, p_changes: { lot_number: "LOT" + tag } });
check("a blank lot number can be filled by a merge", !lot.error && (await current()).lot_number === "LOT" + tag, lot.error?.message ?? "");
const lot2 = await mgr.rpc("vehicle_apply_merge", { p_vehicle_id: id, p_expected_updated_at: (await current()).updated_at, p_changes: { lot_number: "OTHER" + tag } });
check("an existing lot number is never replaced by a merge", !!lot2.error && /already set/.test(lot2.error.message));

// Protected fields are not in the merge whitelist.
const prot = await mgr.rpc("vehicle_apply_merge", { p_vehicle_id: id, p_expected_updated_at: (await current()).updated_at, p_changes: { status: "Completed" } });
check("status cannot be merged", !!prot.error && /cannot be edited here/.test(prot.error.message));
const prot2 = await mgr.rpc("vehicle_apply_merge", { p_vehicle_id: id, p_expected_updated_at: (await current()).updated_at, p_changes: { transport_price: 1 } });
check("transport price cannot be merged", !!prot2.error);

// Role and empty checks.
const sc = await scrap.rpc("vehicle_apply_merge", { p_vehicle_id: id, p_expected_updated_at: (await current()).updated_at, p_changes: { make: "x" } });
check("scrap driver cannot merge", !!sc.error);
const empty = await mgr.rpc("vehicle_apply_merge", { p_vehicle_id: id, p_expected_updated_at: (await current()).updated_at, p_changes: {} });
check("an empty merge is refused", !!empty.error);

// Closed vehicles are not merged until reopened.
await mgr.rpc("close_vehicle", { p_vehicle_id: id, p_reason: "Other", p_note: "merge test close " + tag });
const cl = await mgr.rpc("vehicle_apply_merge", { p_vehicle_id: id, p_expected_updated_at: (await current()).updated_at, p_changes: { make: "closed" } });
check("a closed vehicle refuses a merge", !!cl.error && /closed/.test(cl.error.message));
await mgr.rpc("reopen_vehicle", { p_vehicle_id: id, p_note: "merge test reopen " + tag });

console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail === 0 ? 0 : 1);
