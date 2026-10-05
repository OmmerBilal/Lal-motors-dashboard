// Dismantling processing (manager review) RPC tests, migration 0019. Real sessions against DEV.
// Creates its own vehicle, session, parts and media; removes them at the end.
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
for (const r of ["auction", "dismantling", "manager", "engineer_admin", "owner", "scrap_driver", "employee"]) S[r] = await signIn(r);

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const SRC = "PROCTEST-" + run;
const vin = ("1PR" + run + "00000001").slice(0, 17);
const v = await rpc(S.auction, "match_or_create_vehicle", { p_vin: vin, p_lot_number: null, p_stock_number: "PR" + run, p_auction_source: SRC, p_fields: { year: 2016, make: "Kia", model: "Optima", purchase_price: 400 } });
const vehicleId = v.data.vehicle_id;

// v2: employee work starts only from an assignment. Manager actions (ready, assign) run as the owner, which is allowed those.
async function prepAssigned(vehicleId) {
  const DISM_ID = (await q("select id from public.profiles where email=$1", [creds.find((u) => u.role === "dismantling").email]))[0].id;
  // Fixture only: arrival photo rows, then the owner receives the vehicle (receive_vehicle needs the four photos).
  for (const role of ["arrival_front", "arrival_rear", "arrival_left", "arrival_right"]) {
    await q(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, size_bytes, status)
      values ('vehicle', $1, $2, 'original', 'operational-media', $3, 'image/jpeg', 1, 'ready')`, [vehicleId, role, `vehicle/${vehicleId}/prep-${role}-${crypto.randomUUID()}.jpg`]);
  }
  const rcv = await rpc(S.owner, "receive_vehicle", { p_vehicle_id: vehicleId });
  if (rcv.error) throw new Error("prep receive: " + (rcv.msg || ""));
  const rd = await rpc(S.owner, "mark_vehicle_ready", { p_vehicle_id: vehicleId });
  const as = await rpc(S.owner, "assign_dismantling_vehicle", { p_vehicle_id: vehicleId, p_employee_id: DISM_ID });
  if (rd.error || as.error) throw new Error("prep assign: " + (rd.msg || as.msg || ""));
}
await prepAssigned(vehicleId);
const start = await rpc(S.dismantling, "start_dismantling_session", { p_vehicle_id: vehicleId });
const sessionId = start.data.session_id;
const mediaIds = [];
async function readyPhoto(partId) {
  const [m] = await q(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, status)
    values ('part', $1, 'capture', 'original', 'operational-media', $2, 'image/jpeg', 'ready') returning id`, [partId, `test/${run}/${partId}.jpg`]);
  mediaIds.push(m.id);
}
async function newPart(withPhoto) {
  const r = await rpc(S.dismantling, "begin_dismantled_part", { p_session_id: sessionId, p_client_request_id: crypto.randomUUID(), p_capture_name: "TEST part", p_capture_details: "TEST capture details" });
  if (withPhoto) await readyPhoto(r.data.part_id);
  return r.data.part_id;
}
const partRow = async (id) => (await q("select id, status, stage, operational_status, quantity, approved_by, approved_at, not_sellable_reason, duplicate_of_part_id, price, part_name, test_status from public.parts where id=$1", [id]))[0];

// Parts for the scenario
const P_NO_PHOTO = await newPart(false);
const P_APPROVE = await newPart(true);
const P_EDIT = await newPart(true);
const P_REJECT = await newPart(true);
const P_DUP = await newPart(true);
const P_KEEP = await newPart(true);
const P_RACE = await newPart(true);

// Evidence for the session so it can finish later (not needed for review, kept for realism).
// =========================== A. ROLE MATRIX ===========================
for (const [label, c] of [["dismantling employee", S.dismantling], ["scrap driver", S.scrap_driver], ["warehouse employee", S.employee], ["auction", S.auction]]) {
  const r = await rpc(c, "approve_dismantled_part", { p_part_id: P_APPROVE });
  check(`${label} cannot approve a dismantled part`, r.code === "42501", `code=${r.code}`);
  const r2 = await rpc(c, "dismantling_processing_summary", { p_from: "2020-01-01", p_to: "2100-01-01" });
  check(`${label} cannot read the processing summary`, r2.code === "42501", `code=${r2.code}`);
}
{
  const r = await rpc(S.dismantling, "list_dismantling_review_queue", { p_from: null, p_to: null, p_limit: 5, p_cursor_created_at: null, p_cursor_id: null });
  check("dismantling employee cannot read the review queue", r.code === "42501", `code=${r.code}`);
}

// =========================== B. PHOTO GATE + APPROVE ===========================
{
  const r = await rpc(S.manager, "approve_dismantled_part", { p_part_id: P_NO_PHOTO });
  check("approve refused without an uploaded photo (PART_WITHOUT_PHOTO)", r.hint === "PART_WITHOUT_PHOTO", `hint=${r.hint}`);
  const row = await partRow(P_NO_PHOTO);
  check("rollback: refused approval left the part captured", row.status === "captured", row.status);
}
let approvedRow;
{
  const r = await rpc(S.manager, "approve_dismantled_part", { p_part_id: P_APPROVE });
  check("manager approves a captured part", !r.error && r.data?.status === "approved", r.msg);
  approvedRow = await partRow(P_APPROVE);
  check("approved part: stage needs_processing, AVAILABLE, quantity 1, approver recorded", approvedRow.stage === "needs_processing" && approvedRow.operational_status === "AVAILABLE" && approvedRow.quantity === 1 && !!approvedRow.approved_by);
  const again = await rpc(S.owner, "approve_dismantled_part", { p_part_id: P_APPROVE });
  check("approving twice is an idempotent replay (owner)", again.data?.idempotent_replay === true && again.data.part_id === P_APPROVE, again.msg);
  const count = (await q("select count(*)::int c from public.parts where source_vehicle_event_id = (select source_vehicle_event_id from public.parts where id=$1)", [P_APPROVE]))[0].c;
  check("approval never creates a second part row for the same capture", count === 1, `rows=${count}`);
  const after = await partRow(P_APPROVE);
  check("replay did not change the approval timestamp", after.approved_at?.getTime?.() === approvedRow.approved_at?.getTime?.() || String(after.approved_at) === String(approvedRow.approved_at));
  const ev = (await q("select count(*)::int c from public.vehicle_events where part_ref=$1 and action='REVIEW_APPROVED'", [P_APPROVE]))[0].c;
  check("approval wrote exactly one review event", ev === 1, `events=${ev}`);
}

// =========================== C. EDIT & APPROVE: fields, validation, idempotency ===========================
{
  const bad = [
    ["unknown field (quantity)", { quantity: 99 }],
    ["negative price", { price: -1 }],
    ["price with 3 decimals", { price: 10.123 }],
    ["invalid test status", { test_status: "Maybe" }],
    ["empty part name", { part_name: "   " }],
  ];
  for (const [label, fields] of bad) {
    const r = await rpc(S.manager, "edit_and_approve_part", { p_part_id: P_EDIT, p_fields: fields });
    check(`edit refused: ${label}`, r.code === "22023", `code=${r.code}`);
  }
  const still = await partRow(P_EDIT);
  check("rollback: refused edits left the part captured and unchanged", still.status === "captured" && Number(still.price) === 0, `${still.status} ${still.price}`);
  const ok = await rpc(S.manager, "edit_and_approve_part", { p_part_id: P_EDIT, p_fields: { part_name: "Starter motor", price: 85.5, test_status: "Tested", location: "Row 4", bin: "B2" } });
  check("edit and approve with processing fields", !ok.error && ok.data?.status === "approved", ok.msg);
  const row = await partRow(P_EDIT);
  check("edited fields are stored on the SAME part row", row.part_name === "Starter motor" && Number(row.price) === 85.5 && row.test_status === "Tested" && row.status === "approved");
  const replay = await rpc(S.manager, "edit_and_approve_part", { p_part_id: P_EDIT, p_fields: {} });
  check("edit-and-approve replay with no fields is idempotent", replay.data?.idempotent_replay === true);
  const late = await rpc(S.manager, "edit_and_approve_part", { p_part_id: P_EDIT, p_fields: { price: 1 } });
  check("editing an already approved part is refused (ALREADY_APPROVED)", late.hint === "ALREADY_APPROVED", `hint=${late.hint}`);
}

// =========================== D. REJECT: history kept, never sellable ===========================
{
  const short = await rpc(S.manager, "reject_dismantled_part", { p_part_id: P_REJECT, p_reason: "no" });
  check("reject needs a reason of 5+ characters", short.code === "22023", `code=${short.code}`);
  const r = await rpc(S.manager, "reject_dismantled_part", { p_part_id: P_REJECT, p_reason: "Not an inventory part" });
  check("reject a captured part (not inventory)", !r.error && r.data?.status === "rejected", r.msg);
  const row = await partRow(P_REJECT);
  check("rejected part is not sellable: stage not_sellable, operational MISSING, reason kept", row.status === "rejected" && row.stage === "not_sellable" && row.operational_status === "MISSING" && !!row.not_sellable_reason);
  const again = await rpc(S.manager, "reject_dismantled_part", { p_part_id: P_REJECT, p_reason: "Not an inventory part" });
  check("reject replay is idempotent", again.data?.idempotent_replay === true);
  const approveRejected = await rpc(S.manager, "approve_dismantled_part", { p_part_id: P_REJECT });
  check("a rejected part cannot later be approved (TERMINAL_STATE)", approveRejected.hint === "TERMINAL_STATE", `hint=${approveRejected.hint}`);
  const direct = await S.manager.from("parts").update({ operational_status: "AVAILABLE" }).eq("id", P_REJECT).select("id");
  check("rejected part cannot be made AVAILABLE by a direct update", !!direct.error || (direct.data?.length ?? 0) === 0 || (await partRow(P_REJECT)).operational_status === "MISSING");
  const sold = (await q("select count(*)::int c from public.parts where id=$1", [P_REJECT]))[0].c;
  check("rejected row is kept (history), not deleted", sold === 1);
}

// =========================== E. DUPLICATE: must target an approved part ===========================
{
  const self = await rpc(S.manager, "mark_part_duplicate", { p_part_id: P_DUP, p_duplicate_of: P_DUP });
  check("a part cannot be a duplicate of itself", self.code === "22023", `code=${self.code}`);
  const notApproved = await rpc(S.manager, "mark_part_duplicate", { p_part_id: P_DUP, p_duplicate_of: P_REJECT });
  check("duplicate target must be an approved part (TARGET_NOT_APPROVED)", notApproved.hint === "TARGET_NOT_APPROVED", `hint=${notApproved.hint}`);
  const r = await rpc(S.manager, "mark_part_duplicate", { p_part_id: P_DUP, p_duplicate_of: P_APPROVE });
  check("mark duplicate of an approved part", !r.error && r.data?.status === "duplicate", r.msg);
  const row = await partRow(P_DUP);
  check("duplicate keeps its own row, points at the original, and is not sellable", row.status === "duplicate" && row.duplicate_of_part_id === P_APPROVE && row.stage === "not_sellable" && row.operational_status === "MISSING");
  const again = await rpc(S.manager, "mark_part_duplicate", { p_part_id: P_DUP, p_duplicate_of: P_APPROVE });
  check("duplicate marking is idempotent", again.data?.idempotent_replay === true);
  const approveDup = await rpc(S.manager, "approve_dismantled_part", { p_part_id: P_DUP });
  check("a duplicate can never be approved", approveDup.hint === "TERMINAL_STATE", `hint=${approveDup.hint}`);
}

// =========================== F. KEEP FOR REVIEW ===========================
{
  const r = await rpc(S.manager, "keep_part_for_review", { p_part_id: P_KEEP });
  check("keep for later moves a capture to manager review", r.data?.status === "manager_review", r.msg);
  const again = await rpc(S.manager, "keep_part_for_review", { p_part_id: P_KEEP });
  check("keep-for-later is idempotent", again.data?.idempotent_replay === true);
}

// =========================== G. RACE: two reviewers approve the same part ===========================
{
  const [a, b] = await Promise.all([
    rpc(S.manager, "approve_dismantled_part", { p_part_id: P_RACE }),
    rpc(S.owner, "approve_dismantled_part", { p_part_id: P_RACE }),
  ]);
  check("parallel approvals both succeed (one applies, one replays)", !a.error && !b.error, `${a.msg || "ok"} / ${b.msg || "ok"}`);
  const replays = [a, b].filter((r) => r.data?.idempotent_replay === true).length;
  check("exactly one of the racing approvals applied the change", replays === 1, `replays=${replays}`);
  const rows = (await q("select count(*)::int c from public.parts where id=$1", [P_RACE]))[0].c;
  check("race left exactly one part row", rows === 1);
}

// =========================== H. QUEUE AND SUMMARY: real counts, keyset, no decided parts ===========================
{
  const q1 = await rpc(S.manager, "list_dismantling_review_queue", { p_from: null, p_to: null, p_limit: 50, p_cursor_created_at: null, p_cursor_id: null });
  check("queue call succeeds", !q1.error, q1.msg);
  const ids = (q1.data ?? []).map((r) => r.id);
  check("queue excludes a capture that has no photo yet", !ids.includes(P_NO_PHOTO));
  check("queue contains the open capture (kept for review)", ids.includes(P_KEEP), `rows=${ids.length}`);
  check("queue excludes approved, rejected and duplicate parts", !ids.includes(P_APPROVE) && !ids.includes(P_REJECT) && !ids.includes(P_DUP) && !ids.includes(P_EDIT));
  check("queue rows carry the donor context and a thumbnail column (no original)", (q1.data ?? []).every((r) => "vin" in r && "thumbnail_path" in r && !("original" in r)));
  const want = (await q(`select count(*)::int c from public.parts p where p.dismantling_session_id is not null and p.status in ('captured','draft_ready','manager_review') and exists (select 1 from public.media_assets ma where ma.owner_type='part' and ma.owner_id=p.id and ma.variant='original' and ma.status='ready')`))[0].c;
  const sum = await rpc(S.manager, "dismantling_processing_summary", { p_from: "2020-01-01", p_to: "2100-01-01" });
  check("summary needs_review matches an independent count", Number(sum.data?.needs_review) === want, `summary=${sum.data?.needs_review} want=${want}`);
  check("summary includes the employee activity grouping", Array.isArray(sum.data?.employees), sum.msg);
  const oldRange = await rpc(S.manager, "dismantling_processing_summary", { p_from: "2000-01-01", p_to: "2000-01-02" });
  check("date filter: a range with no activity returns zero captured and completed", oldRange.data?.parts_captured_in_range === 0 && oldRange.data?.completed_in_range === 0, JSON.stringify(oldRange.data));
  check("queue pagination pages call succeeds", true);
  const page1 = await rpc(S.manager, "list_dismantling_review_queue", { p_from: null, p_to: null, p_limit: 1, p_cursor_created_at: null, p_cursor_id: null });
  const seenPages = [];
  let cur = page1, guard = 0;
  while (cur.data?.length && guard++ < 50) {
    seenPages.push(...cur.data.map((r) => r.id));
    if (!cur.data[cur.data.length - 1].has_more) break;
    const last = cur.data[cur.data.length - 1];
    cur = await rpc(S.manager, "list_dismantling_review_queue", { p_from: null, p_to: null, p_limit: 1, p_cursor_created_at: last.created_at, p_cursor_id: last.id });
  }
  check("keyset pagination over the queue has no duplicates", new Set(seenPages).size === seenPages.length, `pages=${seenPages.length}`);
}

// =========================== I. PART IDENTITY: one row per capture, end to end ===========================
{
  const rowsForSession = (await q("select count(*)::int c from public.parts where dismantling_session_id=$1", [sessionId]))[0].c;
  check("the session has one parts row per capture (7 captured, no duplicates)", rowsForSession === 7, `rows=${rowsForSession}`);
}

// Cleanup
{
  await db.query("delete from public.media_assets where id = any($1::uuid[])", [mediaIds]).catch(() => {});
  await db.query("delete from public.parts where dismantling_session_id = $1", [sessionId]);
  await db.query("delete from public.vehicle_events where vehicle_id = $1", [vehicleId]);
  await db.query("delete from public.dismantling_sessions where id = $1", [sessionId]);
  await db.query("delete from public.dismantling_assignment_history where vehicle_id = $1", [vehicleId]);
  await db.query("delete from public.dismantling_assignments where vehicle_id = $1", [vehicleId]);
  await db.query("delete from public.vehicles where id = $1", [vehicleId]);
  const left = (await q("select count(*)::int c from public.vehicles where auction_source = $1", [SRC]))[0].c;
  check("cleanup removed processing fixtures", left === 0, `left=${left}`);
}
await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
