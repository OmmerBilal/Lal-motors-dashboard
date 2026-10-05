// Module 01 — vehicle workspace authority over the real DEV database. Every call is made through supabase-js as a
// signed-in role, so RLS and each RPC's own role check run for real. Fixtures are labelled TEST-VEH-* and the
// closed test vehicle is reopened at the end.
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
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

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
const recv = await clientFor("receiving");
const auction = await clientFor("auction");

// Fixture: one open test vehicle, created through the real intake RPC.
const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
const vin = ("TEST" + tag + "0000000000").slice(0, 17);
const created = await mgr.rpc("match_or_create_vehicle", { p_vin: vin, p_lot_number: "L" + tag, p_stock_number: "S" + tag, p_auction_source: "Copart", p_fields: { make: "TestMake", model: "TestModel", year: 2019 } });
check("fixture: intake creates a test vehicle through match_or_create_vehicle", !created.error, created.error?.message ?? "");
const vehicleId = (await q("select id from public.vehicles where vin = $1", [vin]))[0]?.id;
if (!vehicleId) { console.log("FAIL | fixture vehicle not found"); process.exit(1); }

// ------------------------------------------------------------------ vehicle_get
const got = await mgr.rpc("vehicle_get", { p_vehicle_id: vehicleId });
check("manager reads one vehicle with its stage", !got.error && got.data?.id === vehicleId && typeof got.data?.stage === "string", got.error?.message ?? "");
const gotScrap = await scrap.rpc("vehicle_get", { p_vehicle_id: vehicleId });
check("scrap driver cannot open a vehicle record", !!gotScrap.error, gotScrap.error?.message ?? "no error");
const missing = await mgr.rpc("vehicle_get", { p_vehicle_id: "00000000-0000-4000-8000-000000000000" });
check("unknown vehicle is reported, not invented", !!missing.error && /not found/.test(missing.error.message));

// ------------------------------------------------------------------ vehicle_edit_fields
const idEdit = await mgr.rpc("vehicle_edit_fields", { p_vehicle_id: vehicleId, p_fields: { vin: "CHANGED" + tag } });
check("identity (VIN) cannot be changed by the detail edit", !!idEdit.error && /cannot be edited here/.test(idEdit.error.message));
const statusEdit = await mgr.rpc("vehicle_edit_fields", { p_vehicle_id: vehicleId, p_fields: { status: "Completed" } });
check("status cannot be set by the detail edit", !!statusEdit.error && /cannot be edited here/.test(statusEdit.error.message));
const badYear = await mgr.rpc("vehicle_edit_fields", { p_vehicle_id: vehicleId, p_fields: { year: "20x9" } });
check("a malformed year is refused", !!badYear.error && /four digits/.test(badYear.error.message));
const badMileage = await mgr.rpc("vehicle_edit_fields", { p_vehicle_id: vehicleId, p_fields: { mileage: "12.5k" } });
check("a malformed mileage is refused", !!badMileage.error && /whole miles/.test(badMileage.error.message));
const empty = await mgr.rpc("vehicle_edit_fields", { p_vehicle_id: vehicleId, p_fields: {} });
check("an empty edit is refused", !!empty.error);
const scrapEdit = await scrap.rpc("vehicle_edit_fields", { p_vehicle_id: vehicleId, p_fields: { make: "Nope" } });
check("scrap driver cannot edit vehicle details", !!scrapEdit.error);
const good = await mgr.rpc("vehicle_edit_fields", { p_vehicle_id: vehicleId, p_fields: { make: "Edited Make", mileage: "12345", year: "2020" } });
check("a valid edit saves to the same record", !good.error && good.data?.make === "Edited Make" && good.data?.mileage === 12345 && good.data?.year === 2020, good.error?.message ?? "");
const editEvent = await q("select action, note from public.vehicle_events where vehicle_id=$1 and action='DETAILS_EDITED' order by created_at desc limit 1", [vehicleId]);
check("the edit writes one DETAILS_EDITED event naming the fields", editEvent.length === 1 && /make/.test(editEvent[0].note) && /mileage/.test(editEvent[0].note));
const editAudit = await q("select action from public.audit_logs where entity_type='vehicle' and entity_id=$1 and action='vehicle.details_edited'", [vehicleId]);
check("the edit is written to the audit log", editAudit.length >= 1);

// ------------------------------------------------------------------ vehicle_add_note
const badAction = await mgr.rpc("vehicle_add_note", { p_vehicle_id: vehicleId, p_action: "STATUS", p_note: "x" });
check("only notes and issue flags can be recorded here", !!badAction.error && /cannot be recorded here/.test(badAction.error.message));
const noNote = await mgr.rpc("vehicle_add_note", { p_vehicle_id: vehicleId, p_action: "NOTE", p_note: "   " });
check("an empty note is refused", !!noNote.error && /1 to 500/.test(noNote.error.message));
const note = await mgr.rpc("vehicle_add_note", { p_vehicle_id: vehicleId, p_action: "NOTE", p_note: "Test note " + tag });
check("a note is recorded as an event", !note.error, note.error?.message ?? "");
const noteEvent = await q("select count(*)::int c from public.vehicle_events where vehicle_id=$1 and action='NOTE' and note=$2", [vehicleId, "Test note " + tag]);
check("the note event exists exactly once", Number(noteEvent[0].c) === 1);
const flag = await recv.rpc("vehicle_add_note", { p_vehicle_id: vehicleId, p_action: "ISSUE_FLAGGED", p_note: "Flag " + tag });
check("receiving can flag an issue on an open vehicle", !flag.error, flag.error?.message ?? "");
const scrapNote = await scrap.rpc("vehicle_add_note", { p_vehicle_id: vehicleId, p_action: "NOTE", p_note: "nope" });
check("scrap driver cannot add vehicle notes", !!scrapNote.error);

// ------------------------------------------------------------------ closed vehicles are read-only until reopened
const closed = await mgr.rpc("close_vehicle", { p_vehicle_id: vehicleId, p_reason: "Other", p_note: "Test close " + tag });
check("fixture: manager closes the test vehicle", !closed.error, closed.error?.message ?? "");
const editClosed = await mgr.rpc("vehicle_edit_fields", { p_vehicle_id: vehicleId, p_fields: { make: "Closed edit" } });
check("a closed vehicle refuses detail edits", !!editClosed.error && /closed/.test(editClosed.error.message));
const noteClosed = await mgr.rpc("vehicle_add_note", { p_vehicle_id: vehicleId, p_action: "NOTE", p_note: "closed note" });
check("a closed vehicle refuses notes", !!noteClosed.error && /closed/.test(noteClosed.error.message));
const reopened = await mgr.rpc("reopen_vehicle", { p_vehicle_id: vehicleId, p_note: "Test reopen " + tag });
check("fixture: manager reopens the test vehicle", !reopened.error, reopened.error?.message ?? "");

// ------------------------------------------------------------------ intake_create_batch
const badMethod = await mgr.rpc("intake_create_batch", { p_method: "magic", p_source_text: "", p_count: 1 });
check("an unknown intake method is refused", !!badMethod.error && /unknown intake method/.test(badMethod.error.message));
const badCount = await mgr.rpc("intake_create_batch", { p_method: "bulk", p_source_text: "x", p_count: 500 });
check("a batch over 200 vehicles is refused", !!badCount.error && /0 to 200/.test(badCount.error.message));
const bigText = await mgr.rpc("intake_create_batch", { p_method: "bulk", p_source_text: "x".repeat(20001), p_count: 1 });
check("pasted text over 20000 characters is refused", !!bigText.error && /20000/.test(bigText.error.message));
const scrapBatch = await scrap.rpc("intake_create_batch", { p_method: "manual", p_source_text: "", p_count: 1 });
check("scrap driver cannot start an intake batch", !!scrapBatch.error);
const batch = await auction.rpc("intake_create_batch", { p_method: "single", p_source_text: "VIN " + vin, p_count: 1 });
check("auction can start a single-paste batch", !batch.error && typeof batch.data === "string", batch.error?.message ?? "");
const batchRow = batch.data ? await q("select method, status, created_by is not null as attributed from public.vehicle_intake_batches where id=$1", [batch.data]) : [];
check("the batch is stored for review and attributed to the caller", batchRow[0]?.status === "review" && batchRow[0]?.attributed === true);

// ------------------------------------------------------------------ vehicle_decide_completion (fixture completion row)
const compRow = await db.query("insert into public.vehicle_completions (vehicle_id, part_count, note) values ($1, 0, $2) returning id", [vehicleId, "TEST completion " + tag]);
const compId = compRow.rows[0].id;
const compNoReason = await mgr.rpc("vehicle_decide_completion", { p_completion_id: compId, p_decision: "needs_correction", p_reason: "" });
check("a correction decision needs a reason", !!compNoReason.error && /correction needed/.test(compNoReason.error.message));
const compAuction = await auction.rpc("vehicle_decide_completion", { p_completion_id: compId, p_decision: "approved", p_reason: "" });
check("a non-reviewer cannot decide a completion", !!compAuction.error);
const compBad = await mgr.rpc("vehicle_decide_completion", { p_completion_id: compId, p_decision: "maybe", p_reason: "" });
check("an unknown decision is refused", !!compBad.error && /approve or needs correction/.test(compBad.error.message));
const compOk = await mgr.rpc("vehicle_decide_completion", { p_completion_id: compId, p_decision: "approved", p_reason: "" });
check("a reviewer approves a pending completion", !compOk.error && compOk.data?.decision === "approved", compOk.error?.message ?? "");
const compRowNow = await q("select decision, decided_by is not null as attributed from public.vehicle_completions where id=$1", [compId]);
check("the completion is stored as approved and attributed", compRowNow[0]?.decision === "approved" && compRowNow[0]?.attributed === true);
const compAgain = await mgr.rpc("vehicle_decide_completion", { p_completion_id: compId, p_decision: "needs_correction", p_reason: "changed my mind" });
check("a decided completion cannot be decided again", !!compAgain.error && /already decided/.test(compAgain.error.message));
const compEvent = await q("select count(*)::int c from public.vehicle_events where vehicle_id=$1 and action='COMPLETION_APPROVED'", [vehicleId]);
check("the approval writes one COMPLETION_APPROVED event", Number(compEvent[0].c) === 1);

// ------------------------------------------------------------------ cleanup of the fixture completion row
await db.query("delete from public.vehicle_completions where id = $1", [compId]).catch(() => {});

console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail === 0 ? 0 : 1);
