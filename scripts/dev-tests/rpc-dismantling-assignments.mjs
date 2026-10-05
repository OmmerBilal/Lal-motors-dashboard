// Dismantling v2 backend: readiness, assignments, assignment-driven employee work, manager review, invariants.
// Real DEV data and real signed-in sessions (owner password from DEV_TEST_OWNER_PASSWORD; other roles from the
// git-ignored credential file). Fixtures are TEST-DIS-* vehicles. Fixture setup that has no UI path (arrival photo
// rows, a ready-state flag on a test upload) is written directly with the DB connection and is labelled as such.
//
// A second active dismantling employee is needed for the cross-employee cases. DEV has one by default, so the warehouse
// "employee" account is granted the dismantling role for this run only, and that grant is removed in a finally block.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const pg = req("pg");
const sharp = req("sharp");

const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const creds = loadDevCredentials();
const acct = (role) => creds.find((u) => u.role === role);

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
const hintOf = (err) => (err?.hint || err?.details || "") + " " + (err?.message || "");

const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

async function signIn(a) {
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: a.email, password: a.password });
  if (error) throw new Error("sign-in " + a.role + ": " + error.message);
  const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  const CH = 3180;
  const cookie = value.length <= CH ? `${COOKIE}=${value}` : Array.from({ length: Math.ceil(value.length / CH) }, (_, i) => `${COOKIE}.${i}=${value.slice(i * CH, (i + 1) * CH)}`).join("; ");
  return { client: c, cookie, id: data.user.id, role: a.role };
}

// ---- accounts -------------------------------------------------------------------------
const owner = await signIn(acct("owner") ?? (() => { throw new Error("owner password not provided: set DEV_TEST_OWNER_PASSWORD"); })());
const manager = await signIn(acct("manager"));
const engineer = await signIn(acct("engineer_admin"));
const receiving = await signIn(acct("receiving"));
const auction = await signIn(acct("auction"));
const empA = await signIn(acct("dismantling"));
const scrap = await signIn(acct("scrap_driver"));
const warehouse = await signIn(acct("employee"));

// Second dismantling employee for this run only.
const warehouseUserId = warehouse.id;
const grantB = await q(`select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = $1 and r.key = 'dismantling'`, [warehouseUserId]);
const hadDismantlingB = grantB.length > 0;
if (!hadDismantlingB) {
  await db.query(`insert into public.user_roles (user_id, role_id) select $1, id from public.roles where key = 'dismantling'`, [warehouseUserId]);
}
const empB = warehouse; // the same account, now also a dismantling employee
const cleanupB = async () => {
  if (!hadDismantlingB) await db.query(`delete from public.user_roles where user_id = $1 and role_id = (select id from public.roles where key = 'dismantling')`, [warehouseUserId]);
};

try {
// ---- fixtures -------------------------------------------------------------------------
const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const vinFor = (t) => ("1TD" + run + t).padEnd(17, "0").slice(0, 17);
async function makeVehicle(tag) {
  const { data, error } = await auction.client.rpc("match_or_create_vehicle", { p_vin: vinFor(tag), p_lot_number: "TDLOT" + run + tag, p_stock_number: null, p_auction_source: "TEST-DIS-" + run, p_fields: { year: 2019, make: "Toyota", model: "Camry", purchase_price: 400 } });
  if (error) throw new Error("fixture " + error.message);
  return data.vehicle_id;
}
// Fixture only: arrival photo rows, so receive_vehicle's four-photo guard passes on a test vehicle.
async function fixtureArrivalPhotos(vehicleId) {
  for (const role of ["arrival_front", "arrival_rear", "arrival_left", "arrival_right"]) {
    await db.query(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, size_bytes, status, uploaded_by)
      values ('vehicle', $1, $2, 'original', 'operational-media', $3, 'image/jpeg', 1, 'ready', $4)`,
      [vehicleId, role, `vehicle/${vehicleId}/fixture-${role}-${run}.jpg`, receiving.id]);
  }
}
async function receiveFixture(vehicleId) {
  await fixtureArrivalPhotos(vehicleId);
  const r = await receiving.client.rpc("receive_vehicle", { p_vehicle_id: vehicleId });
  if (r.error) throw new Error("receive fixture " + r.error.message);
}

const v1 = await makeVehicle("A1"); // main: ready, assigned, started, completed
const v2 = await makeVehicle("A2"); // not received
const v3 = await makeVehicle("A3"); // closed
const v4 = await makeVehicle("A4"); // dismantled
const v5 = await makeVehicle("A5"); // concurrency: two managers assign at once
const v6 = await makeVehicle("A6"); // reassignment before start
const v7 = await makeVehicle("A7"); // cancel before start, then return to ready
for (const v of [v1, v3, v4, v5, v6, v7]) await receiveFixture(v);
await db.query(`update public.vehicles set transport_status = 'ARRIVED' where id = $1`, [v1]);
await manager.client.rpc("close_vehicle", { p_vehicle_id: v3, p_reason: "Other", p_note: "dismantling fixture" });
await db.query(`update public.vehicles set status = 'Dismantled' where id = $1`, [v4]);

// Quick media helpers (real pipeline for uploads that matter to the policy).
const bytes = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 60, g: 90, b: 120 } } }).jpeg().toBuffer();
async function uploadThroughApi(session, ownerType, ownerId, role) {
  const clientRequestId = crypto.randomUUID();
  const t = await fetch(BASE + "/api/media/upload-ticket", { method: "POST", headers: { "content-type": "application/json", cookie: session.cookie },
    body: JSON.stringify({ ownerType, ownerId, clientRequestId, role, mimeType: "image/jpeg", sizeBytes: bytes.length }) });
  if (!t.ok) return { ok: false, stage: "ticket", status: t.status, body: await t.text() };
  const tj = await t.json();
  const put = await fetch(tj.uploadUrl, { method: "PUT", headers: { "content-type": tj.contentType, "x-upsert": "true" }, body: bytes });
  if (!put.ok) return { ok: false, stage: "transfer", status: put.status };
  const done = await fetch(BASE + "/api/media/complete", { method: "POST", headers: { "content-type": "application/json", cookie: session.cookie }, body: JSON.stringify({ mediaId: tj.mediaId }) });
  return done.ok ? { ok: true, mediaId: tj.mediaId } : { ok: false, stage: "complete", status: done.status, body: await done.text() };
}
// Fixture only: marks an uploaded test media row ready when the server cannot finish it in the test environment.
const markReady = (id) => db.query(`update public.media_assets set status = 'ready' where id = $1`, [id]);

const exp = async (promise) => { try { const r = await promise; return { ok: !r.error, data: r.data, error: r.error }; } catch (e) { return { ok: false, error: e }; } };

// =====================================================================================
// A. Readiness
// =====================================================================================
{
  const ready = await exp(manager.client.rpc("mark_vehicle_ready", { p_vehicle_id: v1 }));
  check("1. manager marks a received vehicle ready", ready.ok && !!ready.data?.dismantling_ready_at, ready.error?.message ?? "");
  const again = await exp(manager.client.rpc("mark_vehicle_ready", { p_vehicle_id: v1 }));
  check("1b. marking ready again is a replay, not a second change", again.ok && again.data?.idempotent_replay === true);
  const unrec = await exp(manager.client.rpc("mark_vehicle_ready", { p_vehicle_id: v2 }));
  check("2. unreceived vehicle cannot be marked ready", !unrec.ok && /NOT_RECEIVED|receive the vehicle/.test(hintOf(unrec.error)), unrec.error?.message ?? "");
  // v2 is unreceived, so the same vehicle with an arrival photo set but not received is still refused.
  const closed = await exp(manager.client.rpc("mark_vehicle_ready", { p_vehicle_id: v3 }));
  check("3. closed vehicle cannot be marked ready", !closed.ok && /CLOSED_VEHICLE|closed/.test(hintOf(closed.error)), closed.error?.message ?? "");
  const dismantled = await exp(manager.client.rpc("mark_vehicle_ready", { p_vehicle_id: v4 }));
  check("4. dismantled vehicle cannot be marked ready", !dismantled.ok && /ALREADY_DISMANTLED|already been dismantled/.test(hintOf(dismantled.error)), dismantled.error?.message ?? "");
  const empReady = await exp(empA.client.rpc("mark_vehicle_ready", { p_vehicle_id: v2 }));
  check("5. dismantling employee cannot mark ready", !empReady.ok, empReady.error?.message ?? "no error");
  const auditReady = await q(`select 1 from public.audit_logs where action = 'dismantling.ready' and entity_id = $1`, [v1]);
  check("audit: ready is recorded", auditReady.length >= 1);
}

// =====================================================================================
// B. Assignment rules
// =====================================================================================
let a1; // assignment id for v1
{
  const notEmp = await exp(manager.client.rpc("assign_dismantling_vehicle", { p_vehicle_id: v1, p_employee_id: manager.id }));
  check("6. only an active dismantling employee can be assigned", !notEmp.ok && /NOT_DISMANTLING_EMPLOYEE|only an active dismantling/.test(hintOf(notEmp.error)), notEmp.error?.message ?? "");
  const first = await exp(manager.client.rpc("assign_dismantling_vehicle", { p_vehicle_id: v1, p_employee_id: empA.id }));
  check("7a. manager assigns the ready vehicle to employee A", first.ok && first.data?.status === "ASSIGNED", first.error?.message ?? "");
  a1 = first.data?.assignment_id;
  const second = await exp(manager.client.rpc("assign_dismantling_vehicle", { p_vehicle_id: v1, p_employee_id: empB.id }));
  check("7b. a second active assignment on the same vehicle is refused", !second.ok && /ALREADY_ASSIGNED|already has an active assignment/.test(hintOf(second.error)), second.error?.message ?? "");
  const rows = await q(`select count(*)::int n from public.dismantling_assignments where vehicle_id = $1 and status in ('ASSIGNED','IN_PROGRESS')`, [v1]);
  check("7c. exactly one open assignment for the vehicle", rows[0].n === 1, `open=${rows[0].n}`);
  const auditAssign = await q(`select 1 from public.audit_logs where action = 'dismantling.assign' and entity_id = $1`, [a1]);
  check("8. assignment is audited (actor, vehicle, time)", auditAssign.length === 1);
  const hist = await q(`select action from public.dismantling_assignment_history where assignment_id = $1 order by created_at`, [a1]);
  check("8b. assignment history row written", hist.some((h) => h.action === "ASSIGNED"));
}

// 9. Reassignment before start, and history.
let a6;
{
  const av6 = await exp(manager.client.rpc("assign_dismantling_vehicle", { p_vehicle_id: v6, p_employee_id: empA.id }));
  const pre = await exp(manager.client.rpc("mark_vehicle_ready", { p_vehicle_id: v6 }));
  check("9-prep. vehicle A6 readied before assignment", pre.ok, pre.error?.message ?? "");
  // Re-run the assignment now that A6 is ready (the first call above was refused as not ready, and is expected to be).
  const av6b = await exp(manager.client.rpc("assign_dismantling_vehicle", { p_vehicle_id: v6, p_employee_id: empA.id }));
  a6 = av6b.data?.assignment_id;
  check("9. reassignment is allowed before start", av6b.ok && !!a6, av6.error?.message ?? "");
  const moved = await exp(manager.client.rpc("reassign_dismantling_assignment", { p_assignment_id: a6, p_employee_id: empB.id, p_reason: "Covering a colleague" }));
  check("9b. reassign to another active employee before start", moved.ok && moved.data?.employee_id === empB.id, moved.error?.message ?? "");
  const back = await exp(manager.client.rpc("reassign_dismantling_assignment", { p_assignment_id: a6, p_employee_id: empA.id, p_reason: "Returned to the original employee" }));
  check("9c. reassign back to A (history keeps both moves)", back.ok);
  const hist = await q(`select action, from_employee_id, to_employee_id from public.dismantling_assignment_history where assignment_id = $1 and action = 'REASSIGNED' order by created_at`, [a6]);
  check("9d. reassignment history records from, to and actor", hist.length === 2 && hist[0].from_employee_id === empA.id && hist[0].to_employee_id === empB.id);
}

// =====================================================================================
// C. Employee visibility and direct attacks
// =====================================================================================
let s1, parts = {};
{
  const listA = await exp(empA.client.rpc("list_my_dismantling_assignments", { p_limit: 100 }));
  const ids = (listA.data ?? []).map((r) => r.assignment_id);
  check("10. employee A lists assignments with v1 visible", ids.includes(a1), listA.error?.message ?? "");
  const owned = await q(`select id from public.dismantling_assignments where employee_id = $1`, [empA.id]);
  const ownedSet = new Set(owned.map((r) => r.id));
  check("10b. employee A's list contains only assignments that are A's", ids.every((id) => ownedSet.has(id)));
  const listManager = await exp(manager.client.rpc("list_my_dismantling_assignments", { p_limit: 100 }));
  check("10c. manager cannot use the employee list", !listManager.ok, listManager.error?.message ?? "no error");

  const other = await exp(empB.client.rpc("get_my_dismantling_workspace", { p_assignment_id: a1 }));
  check("11. another employee cannot open A's assignment", !other.ok && /not assigned to you|NOT_ASSIGNED/.test(hintOf(other.error)), other.error?.message ?? "");
  const search = await exp(empB.client.rpc("find_my_dismantling_assignment", { p_term: vinFor("A1") }));
  check("11b. search for another employee's vehicle says not assigned, no details", search.ok && search.data?.result === "not_assigned" && !("vehicle" in (search.data ?? {})));

  // 12. start ASSIGNED -> IN_PROGRESS
  const started = await exp(empA.client.rpc("start_dismantling_assignment", { p_assignment_id: a1, p_client_request_id: crypto.randomUUID() }));
  s1 = started.data?.session_id;
  check("12. start moves ASSIGNED to IN_PROGRESS with one session", started.ok && !!s1 && started.data?.status === "IN_PROGRESS", started.error?.message ?? "");
  const st = await q(`select status, started_at from public.dismantling_assignments where id = $1`, [a1]);
  check("12b. assignment row shows IN_PROGRESS and a start time", st[0]?.status === "IN_PROGRESS" && !!st[0]?.started_at);
  const sess = await q(`select assignment_id, employee_id, ended_at from public.dismantling_sessions where id = $1`, [s1]);
  check("12c. session is linked to the assignment and to the employee", sess[0]?.assignment_id === a1 && sess[0]?.employee_id === empA.id && sess[0]?.ended_at === null);

  // 13. one active session; double start is one session
  const again = await exp(empA.client.rpc("start_dismantling_assignment", { p_assignment_id: a1, p_client_request_id: crypto.randomUUID() }));
  check("13. a second Start by the same employee returns the same session", again.ok && again.data?.session_id === s1 && again.data?.idempotent_replay === true);
  const byB = await exp(empB.client.rpc("start_dismantling_assignment", { p_assignment_id: a1, p_client_request_id: crypto.randomUUID() }));
  check("13b. another employee cannot start or resume it", !byB.ok, byB.error?.message ?? "no error");
  const count = await q(`select count(*)::int n from public.dismantling_sessions where assignment_id = $1`, [a1]);
  check("13c. exactly one session for the assignment", count[0].n === 1);

  // 14. resume restores the same session
  const ws = await exp(empA.client.rpc("get_my_dismantling_workspace", { p_assignment_id: a1 }));
  check("14. refresh resumes the same session and vehicle", ws.ok && ws.data?.session?.id === s1 && ws.data?.vehicle?.vin === vinFor("A1"));

  // 15 / 16. manual part name and details
  const begin = await exp(empA.client.rpc("begin_dismantled_part", { p_session_id: s1, p_client_request_id: crypto.randomUUID(), p_capture_name: "Front Left Headlight", p_capture_details: "OEM headlight, lens intact, mounting tab damaged" }));
  parts.headlight = begin.data?.part_id;
  check("15. employee-entered part name is persisted", begin.ok && !!parts.headlight, begin.error?.message ?? "");
  const row = await q(`select capture_name, capture_details, captured_by, status from public.parts where id = $1`, [parts.headlight]);
  check("16. employee-entered part details are persisted", row[0]?.capture_details === "OEM headlight, lens intact, mounting tab damaged");
  check("18. capture provenance: captured_by is employee A and the part is captured", row[0]?.captured_by === empA.id && row[0]?.status === "captured");
  const noName = await exp(empA.client.rpc("begin_dismantled_part", { p_session_id: s1, p_client_request_id: crypto.randomUUID(), p_capture_name: "", p_capture_details: "details here" }));
  check("15b. a part without a name is refused", !noName.ok && /CAPTURE_REQUIRED|part name/.test(hintOf(noName.error)));
  const noDetails = await exp(empA.client.rpc("begin_dismantled_part", { p_session_id: s1, p_client_request_id: crypto.randomUUID(), p_capture_name: "Alternator", p_capture_details: "" }));
  check("16b. a part without details is refused", !noDetails.ok && /CAPTURE_REQUIRED|details/.test(hintOf(noDetails.error)));

  // 19. manager cannot falsify an employee capture
  const mgrCapture = await exp(manager.client.rpc("begin_dismantled_part", { p_session_id: s1, p_client_request_id: crypto.randomUUID(), p_capture_name: "Forged", p_capture_details: "Manager entered this" }));
  check("19. manager cannot capture a part under the employee's session", !mgrCapture.ok, mgrCapture.error?.message ?? "no error");
  const mgrPhoto = await exp(manager.client.rpc("abandon_dismantled_part", { p_part_id: parts.headlight }));
  check("19b. manager cannot abandon or change an employee capture", !mgrPhoto.ok, mgrPhoto.error?.message ?? "no error");

  // 17. photo ownership: the session employee may attach a part photo; the manager may not.
  const up = await uploadThroughApi(empA, "part", parts.headlight, "capture");
  check("17. employee A uploads the headlight photo through the real pipeline", up.ok, up.ok ? "" : `${up.stage} ${up.status} ${up.body ?? ""}`.slice(0, 160));
  if (up.ok) { parts.headlightPhoto = up.mediaId; }
  const mgrInsert = await exp(manager.client.from("media_assets").insert({ owner_type: "part", owner_id: parts.headlight, role: "capture", variant: "original", bucket: "operational-media", storage_path: `part/${parts.headlight}/mgr-${run}.jpg`, mime_type: "image/jpeg", size_bytes: 1, status: "processing", uploaded_by: manager.id }).select("id"));
  check("17b. manager cannot attach a photo to an employee's active capture", !!mgrInsert.error || (mgrInsert.data ?? []).length === 0, mgrInsert.error?.message ?? "");
  const mgrEvidence = await exp(manager.client.from("media_assets").insert({ owner_type: "dismantling_session", owner_id: s1, role: "vehicle_evidence", variant: "original", bucket: "operational-media", storage_path: `dismantling_session/${s1}/mgr-${run}.jpg`, mime_type: "image/jpeg", size_bytes: 1, status: "processing", uploaded_by: manager.id }).select("id"));
  check("19c. manager cannot add vehicle evidence to an employee's active session", !!mgrEvidence.error || (mgrEvidence.data ?? []).length === 0, mgrEvidence.error?.message ?? "");

  // Save part & next needs the name, details and a ready photo.
  if (up.ok) await markReady(up.mediaId);
  const saved = await exp(empA.client.rpc("save_dismantled_part", { p_part_id: parts.headlight }));
  check("save: Save Part & Next persists the part only with name, details and a ready photo", saved.ok && !!saved.data?.capture_saved_at, saved.error?.message ?? "");
  const savedAgain = await exp(empA.client.rpc("save_dismantled_part", { p_part_id: parts.headlight }));
  check("save: saving again is a replay (no duplicate)", savedAgain.ok && savedAgain.data?.idempotent_replay === true);

  // 2nd part: edit its own capture, photo, save.
  const b2 = await exp(empA.client.rpc("begin_dismantled_part", { p_session_id: s1, p_client_request_id: crypto.randomUUID(), p_capture_name: "Alternator", p_capture_details: "Connector intact" }));
  parts.alt = b2.data?.part_id;
  const edit = await exp(empA.client.rpc("update_part_capture", { p_part_id: parts.alt, p_capture_name: "Alternator 120A", p_capture_details: "Connector intact, pulley ok" }));
  check("edit: employee may correct own capture while in progress", edit.ok, edit.error?.message ?? "");
  const up2 = await uploadThroughApi(empA, "part", parts.alt, "capture");
  if (up2.ok) await markReady(up2.mediaId);
  const save2 = await exp(empA.client.rpc("save_dismantled_part", { p_part_id: parts.alt }));
  check("save: second part saved", save2.ok, save2.error?.message ?? "");

  // Evidence photo (session) by the session employee; then an issue flag; then finish.
  const ev = await uploadThroughApi(empA, "dismantling_session", s1, "vehicle_evidence");
  check("evidence: employee uploads vehicle evidence through the real pipeline", ev.ok, ev.ok ? "" : `${ev.stage} ${ev.status} ${ev.body ?? ""}`.slice(0, 160));
  if (ev.ok) await markReady(ev.mediaId);
  const issue = await exp(empA.client.rpc("flag_dismantling_issue", { p_session_id: s1, p_issue: "Record Discrepancy", p_note: "TEST QA note: lot number differs from listing", p_client_request_id: crypto.randomUUID() }));
  check("issue: employee may flag an optional issue during the session", issue.ok, issue.error?.message ?? "");

  // Employee cannot use manager AI, or change price, location or SKU.
  const priceWrite = await exp(empA.client.from("parts").update({ price: 1, location: "X", stock_sku: "SKU-X" }).eq("id", parts.headlight).select("id"));
  check("22. employee cannot write price, location or SKU directly", !!priceWrite.error || (priceWrite.data ?? []).length === 0, priceWrite.error?.message ?? "");
  const fieldsRpc = await exp(empA.client.rpc("update_part_fields", { p_part_id: parts.headlight, p_fields: { price: 1 } }));
  check("22b. employee cannot call the parts field editor", !fieldsRpc.ok, fieldsRpc.error?.message ?? "no error");
  const approveByEmp = await exp(empA.client.rpc("approve_dismantled_part", { p_part_id: parts.headlight }));
  check("21b. employee cannot approve a part", !approveByEmp.ok, approveByEmp.error?.message ?? "no error");
  const aiRes = await fetch(BASE + "/api/ai/analyze-part/stream", { method: "POST", headers: { "content-type": "application/json", cookie: empA.cookie }, body: JSON.stringify({ partId: parts.headlight }) });
  const aiText = await aiRes.text();
  check("21c. employee cannot run Analyze Part (stream refuses: forbidden)", /"type":"error","category":"forbidden"/.test(aiText), `status=${aiRes.status}`);

  // Finish
  const fin = await exp(empA.client.rpc("finish_dismantling_session", { p_session_id: s1 }));
  check("20. finish completes the session, the assignment and the vehicle", fin.ok && fin.data?.status === "completed", fin.error?.message ?? "");
  const asg = await q(`select status, completed_at from public.dismantling_assignments where id = $1`, [a1]);
  check("20b. assignment is COMPLETED with a completion time", asg[0]?.status === "COMPLETED" && !!asg[0]?.completed_at);
  const veh = await q(`select status from public.vehicles where id = $1`, [v1]);
  check("21. vehicle lifecycle is Dismantled", veh[0]?.status === "Dismantled");
  const fin2 = await exp(empA.client.rpc("finish_dismantling_session", { p_session_id: s1 }));
  check("31. double Finish is idempotent", fin2.ok && fin2.data?.idempotent_replay === true, fin2.error?.message ?? "");
  const lateCapture = await exp(empA.client.rpc("begin_dismantled_part", { p_session_id: s1, p_client_request_id: crypto.randomUUID(), p_capture_name: "Late part", p_capture_details: "after finish" }));
  check("edit: a finished session refuses new captures", !lateCapture.ok, lateCapture.error?.message ?? "no error");
  const lateEdit = await exp(empA.client.rpc("update_part_capture", { p_part_id: parts.alt, p_capture_name: "Changed", p_capture_details: "after finish" }));
  check("edit: a completed capture is read-only", !lateEdit.ok, lateEdit.error?.message ?? "no error");
}

// =====================================================================================
// D. Manager review and lineage
// =====================================================================================
{
  const rec = await exp(manager.client.rpc("get_dismantling_vehicle_record", { p_vehicle_id: v1 }));
  const names = (rec.data?.parts ?? []).map((p) => p.capture_name).sort();
  check("22-review. manager sees exactly the two captured parts, by name", JSON.stringify(names) === JSON.stringify(["Alternator 120A", "Front Left Headlight"]), JSON.stringify(names));
  const emp = (rec.data?.assignments ?? [])[0];
  check("22-review. assignment shows the assigned employee and who assigned", !!emp?.employee_name && !!emp?.assigned_by_name, JSON.stringify(emp ?? {}).slice(0, 120));
  check("23. issue is linked to the vehicle record", (rec.data?.issues ?? []).length >= 1);
  const forEmp = await exp(empA.client.rpc("get_dismantling_vehicle_record", { p_vehicle_id: v1 }));
  check("manager-only: an employee cannot open the vehicle record", !forEmp.ok, forEmp.error?.message ?? "no error");

  // Review actions keep the same part row.
  const before = await q(`select id from public.parts where dismantling_session_id = $1 order by created_at`, [s1]);
  const approve = await exp(manager.client.rpc("approve_dismantled_part", { p_part_id: parts.headlight }));
  check("24. approve works on the captured part", approve.ok, approve.error?.message ?? "");
  const after = await q(`select id, status, stage, source_vehicle_event_id, dismantling_session_id, capture_name from public.parts where id = $1`, [parts.headlight]);
  check("25. approve keeps the same part row and its lineage", after[0]?.id === parts.headlight && after[0]?.dismantling_session_id === s1 && after[0]?.capture_name === "Front Left Headlight", JSON.stringify(after[0] ?? {}));
  const rowsNow = await q(`select id from public.parts where dismantling_session_id = $1 order by created_at`, [s1]);
  check("25b. no second part record was created by approval", rowsNow.length === before.length);

  const rej = await exp(manager.client.rpc("reject_dismantled_part", { p_part_id: parts.alt, p_reason: "TEST rejection for lineage check" }));
  const rejRow = await q(`select status, stage from public.parts where id = $1`, [parts.alt]);
  check("26. rejected part stays historical and non-sellable", rej.ok && rejRow[0]?.status === "rejected" && rejRow[0]?.stage !== "ready_for_sale", rej.error?.message ?? "");
}

// =====================================================================================
// E. Start/finish races (double Start, two managers assigning the same vehicle)
// =====================================================================================
{
  const ready5 = await exp(manager.client.rpc("mark_vehicle_ready", { p_vehicle_id: v5 }));
  check("concurrency-prep. v5 ready", ready5.ok);
  const [x, y] = await Promise.allSettled([
    manager.client.rpc("assign_dismantling_vehicle", { p_vehicle_id: v5, p_employee_id: empA.id, p_client_request_id: crypto.randomUUID() }),
    engineer.client.rpc("assign_dismantling_vehicle", { p_vehicle_id: v5, p_employee_id: empA.id, p_client_request_id: crypto.randomUUID() }),
  ]);
  const okCount = [x, y].filter((r) => r.status === "fulfilled" && !r.value.error).length;
  const open = await q(`select count(*)::int n from public.dismantling_assignments where vehicle_id = $1 and status = 'ASSIGNED'`, [v5]);
  check("29. two managers assigning the same vehicle at once leave one active assignment", okCount === 1 && open[0].n === 1, `successes=${okCount} open=${open[0].n}`);
}
{
  const ready7 = await exp(manager.client.rpc("mark_vehicle_ready", { p_vehicle_id: v7 }));
  const a7r = await exp(manager.client.rpc("assign_dismantling_vehicle", { p_vehicle_id: v7, p_employee_id: empA.id }));
  const a7 = a7r.data?.assignment_id;
  check("cancel-prep. v7 assigned", ready7.ok && !!a7);
  const cancel = await exp(manager.client.rpc("cancel_dismantling_assignment", { p_assignment_id: a7, p_reason: "TEST cancel before start" }));
  check("cancel: assignment cancelled before start", cancel.ok && cancel.data?.status === "CANCELLED", cancel.error?.message ?? "");
  const back = await exp(manager.client.rpc("list_dismantling_vehicles", { p_tab: "ready", p_search: vinFor("A7"), p_limit: 5 }));
  const inReady = (back.data?.rows ?? []).some((r) => r.vehicle_id === v7);
  check("cancel: vehicle returns to Ready for Dismantling", inReady, back.error?.message ?? "");
}
{
  const a5 = await q(`select id from public.dismantling_assignments where vehicle_id = $1 and status = 'ASSIGNED'`, [v5]);
  // Start and a reassignment race: one authoritative outcome.
  await Promise.allSettled([
    empA.client.rpc("start_dismantling_assignment", { p_assignment_id: a5[0].id, p_client_request_id: crypto.randomUUID() }),
    manager.client.rpc("reassign_dismantling_assignment", { p_assignment_id: a5[0].id, p_employee_id: empB.id, p_reason: "Race test" }),
  ]);
  const holder = await q(`select status, employee_id from public.dismantling_assignments where id = $1`, [a5[0].id]);
  const sessions = await q(`select count(*)::int n from public.dismantling_sessions where assignment_id = $1`, [a5[0].id]);
  const outcomeOk = (holder[0].status === "IN_PROGRESS" && holder[0].employee_id === empA.id && sessions[0].n === 1) || (holder[0].status === "ASSIGNED" && holder[0].employee_id === empB.id && sessions[0].n === 0);
  check("30. reassign racing with Start has one authoritative outcome", outcomeOk, `status=${holder[0].status} sessions=${sessions[0].n}`);
}

// =====================================================================================
// F. Read scoping and grants
// =====================================================================================
{
  const directSessions = await exp(empB.client.from("dismantling_sessions").select("id").eq("vehicle_id", v1));
  check("RLS: employee B cannot read A's session by direct table query", (directSessions.data ?? []).length === 0);
  const directVehicles = await exp(empA.client.from("vehicles").select("id").limit(50));
  check("RLS: dismantling employee cannot read the vehicles table directly", (directVehicles.data ?? []).length === 0, `rows=${(directVehicles.data ?? []).length}`);
  const adminList = await exp(empA.client.rpc("list_dismantling_vehicles", { p_tab: "ready", p_limit: 5 }));
  check("RLS: employee cannot use the manager vehicle list", !adminList.ok, adminList.error?.message ?? "no error");
  const ownerStart = await exp(owner.client.rpc("start_dismantling_assignment", { p_assignment_id: a6 }));
  check("roles: owner cannot start employee work", !ownerStart.ok, ownerStart.error?.message ?? "no error");
  const scrapStart = await exp(scrap.client.rpc("start_dismantling_session", { p_vehicle_id: v2 }));
  check("roles: scrap driver cannot start dismantling", !scrapStart.ok, scrapStart.error?.message ?? "no error");
}

} finally {
  // Always remove the temporary second-employee grant, even when a check throws.
  await cleanupB();
  await db.end();
}
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
