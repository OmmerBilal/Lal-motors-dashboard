// Dismantling RPC tests (migration 0016). Real signed-in sessions against DEV.
// Creates its own vehicles, sessions, parts and media, then removes them.
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
for (const r of ["auction", "receiving", "scrap_driver", "employee", "dismantling", "engineer_admin", "owner", "manager"]) S[r] = await signIn(r);
const DISM = S.dismantling;
const DISM_OTHER = await signIn("dismantling"); // second session of the same role, to act as a different person below
void DISM_OTHER;

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const SRC = "DISMTEST-" + run;
const fields = { year: 2017, make: "Nissan", model: "Altima", purchase_price: 500 };
const vehicleIds = [];
const sessionIds = [];
const partIds = [];
const mediaIds = [];

async function newVehicle(n) {
  const vin = ("1DM" + run + String(n).padStart(8, "0")).slice(0, 17);
  const r = await rpc(S.auction, "match_or_create_vehicle", { p_vin: vin, p_lot_number: null, p_stock_number: "DM" + run + n, p_auction_source: SRC, p_fields: fields });
  if (!r.data?.vehicle_id) throw new Error("fixture: " + r.msg);
  vehicleIds.push(r.data.vehicle_id);
  return r.data.vehicle_id;
}
// Ready original media owned by a dismantling session or a part (admin insert as the fixture owner).
async function readyMedia(ownerType, ownerId, role) {
  const [m] = await q(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, status)
    values ($1, $2, $3, 'original', 'operational-media', $4, 'image/jpeg', 'ready') returning id`,
    [ownerType, ownerId, role, `test/${run}/${ownerId}/${role}-${crypto.randomUUID()}.jpg`]);
  mediaIds.push(m.id);
  return m.id;
}

const V1 = await newVehicle(1);
const V2 = await newVehicle(2);
const V3 = await newVehicle(3);

// =========================== A. ROLE MATRIX ===========================
for (const [label, c] of [["auction", S.auction], ["receiving", S.receiving], ["scrap driver", S.scrap_driver], ["warehouse employee", S.employee]]) {
  const r = await rpc(c, "start_dismantling_session", { p_vehicle_id: V1 });
  check(`${label} cannot start a dismantling session`, r.code === "42501", `code=${r.code}`);
}
{
  const anon = createClient(SUPA, PUB, { auth: { persistSession: false } });
  const r = await rpc(anon, "start_dismantling_session", { p_vehicle_id: V1 });
  check("anonymous start refused", !!r.error);
}

// =========================== B. START: success, replay, already in process ===========================
let session1;
{
  const r = await rpc(DISM, "start_dismantling_session", { p_vehicle_id: V1 });
  check("dismantling employee starts a session", !r.error && r.data?.status === "active", r.msg);
  session1 = r.data.session_id; sessionIds.push(session1);
  const st = (await q("select status, employee_id from public.dismantling_sessions where id=$1", [session1]))[0];
  check("session row is active and owned by the starter", st?.status === "active");
  const v = (await q("select status from public.vehicles where id=$1", [V1]))[0];
  check("vehicle status moves to Processing", v.status === "Processing", v.status);
  const again = await rpc(DISM, "start_dismantling_session", { p_vehicle_id: V1 });
  check("same employee retry returns the same session (replay)", again.data?.session_id === session1 && again.data?.idempotent_replay === true, again.msg);
  const other = await rpc(S.engineer_admin, "start_dismantling_session", { p_vehicle_id: V1 });
  check("a different employee is refused: ALREADY_IN_PROCESS", other.hint === "ALREADY_IN_PROCESS", `hint=${other.hint} code=${other.code}`);
  const n = (await q("select count(*)::int c from public.dismantling_sessions where vehicle_id=$1 and ended_at is null", [V1]))[0].c;
  check("exactly one active session for the vehicle", n === 1, `active=${n}`);
}

// =========================== C. RACE: two employees start the same free vehicle ===========================
{
  const [a, b] = await Promise.all([
    rpc(DISM, "start_dismantling_session", { p_vehicle_id: V2 }),
    rpc(S.owner, "start_dismantling_session", { p_vehicle_id: V2 }),
  ]);
  const ok = [a, b].filter((r) => !r.error);
  if (ok[0]?.data?.session_id) sessionIds.push(ok[0].data.session_id);
  check("parallel starts on the same vehicle: exactly one session", ok.length === 1, `ok=${ok.length}`);
  const rows = (await q("select count(*)::int c from public.dismantling_sessions where vehicle_id=$1 and ended_at is null", [V2]))[0].c;
  check("race leaves exactly one active session row", rows === 1, `rows=${rows}`);
  const winner = ok[0]?.data?.session_id;
  const loserError = [a, b].find((r) => r.error);
  check("race loser is refused with ALREADY_IN_PROCESS", loserError?.hint === "ALREADY_IN_PROCESS", loserError?.hint ?? "none");
  // Finish the winner's session cleanly for later tests: give it evidence and finish.
  if (winner) {
    const who = (await q("select employee_id from public.dismantling_sessions where id=$1", [winner]))[0].employee_id;
    const c = who === (await q("select id from public.profiles where email=$1", [byRole.owner.email]))[0]?.id ? S.owner : DISM;
    await readyMedia("dismantling_session", winner, "vehicle_evidence");
    const fin = await rpc(c, "finish_dismantling_session", { p_session_id: winner });
    check("winner finishes its own session", !fin.error, fin.msg);
  }
}

// =========================== D. PART CAPTURE: begin, retry, photo gate, abandon ===========================
const reqA = crypto.randomUUID();
let partA;
{
  const r = await rpc(DISM, "begin_dismantled_part", { p_session_id: session1, p_client_request_id: reqA });
  check("begin a part capture inside the active session", !r.error && !!r.data?.part_id, r.msg);
  partA = r.data.part_id; partIds.push(partA);
  const retry = await rpc(DISM, "begin_dismantled_part", { p_session_id: session1, p_client_request_id: reqA });
  check("retrying the same capture request returns the same part (no duplicate)", retry.data?.part_id === partA && retry.data?.idempotent_replay === true);
  const cnt = (await q("select count(*)::int c from public.parts where client_request_id=$1", [reqA]))[0].c;
  check("exactly one part row for the request", cnt === 1, `rows=${cnt}`);
  const p = (await q("select vehicle_id, dismantling_session_id, source_vin, status, quantity, source_vehicle_event_id from public.parts where id=$1", [partA]))[0];
  check("part keeps donor context (vehicle, session, VIN, event)", p.vehicle_id === V1 && p.dismantling_session_id === session1 && p.source_vin && p.source_vehicle_event_id && p.status === "captured");
  const outsider = await rpc(S.engineer_admin, "begin_dismantled_part", { p_session_id: session1, p_client_request_id: crypto.randomUUID() });
  check("a different employee cannot add parts to someone else's session", outsider.code === "42501", `code=${outsider.code}`);
  const price = await DISM.from("parts").update({ price: 1 }).eq("id", partA).select("id");
  check("dismantling direct update of part price is blocked", !!price.error || (price.data?.length ?? 0) === 0, price.error?.message?.slice(0, 60) ?? "rows=0");
  const sku = await DISM.from("parts").update({ stock_sku: "X1" }).eq("id", partA).select("id");
  check("dismantling direct update of SKU is blocked", !!sku.error || (sku.data?.length ?? 0) === 0);
  const loc = await DISM.from("parts").update({ location: "A1" }).eq("id", partA).select("id");
  check("dismantling direct update of location is blocked", !!loc.error || (loc.data?.length ?? 0) === 0);
  const approve = await DISM.from("parts").update({ status: "approved" }).eq("id", partA).select("id");
  check("dismantling direct approval is blocked", !!approve.error || (approve.data?.length ?? 0) === 0);
}
{
  // Photo gate: vehicle evidence first (checked first by the RPC), then the part photo gate.
  await readyMedia("dismantling_session", session1, "vehicle_evidence");
  const f = await rpc(DISM, "finish_dismantling_session", { p_session_id: session1 });
  check("finish refused while a captured part still lacks a photo (PART_WITHOUT_PHOTO)", f.hint === "PART_WITHOUT_PHOTO", `hint=${f.hint}`);
  const stillActive = (await q("select status from public.dismantling_sessions where id=$1", [session1]))[0].status;
  check("rollback: refused finish left the session active", stillActive === "active", stillActive);
  // Retry path: the photo finally arrives, so finish is allowed (tested after abandon below for the other branch).
  await readyMedia("part", partA, "capture");
  const abandonDone = await rpc(DISM, "abandon_dismantled_part", { p_part_id: partA });
  check("a part with a photo cannot be abandoned", abandonDone.code === "P0001", `code=${abandonDone.code}`);
}
{
  const reqB = crypto.randomUUID();
  const b = await rpc(DISM, "begin_dismantled_part", { p_session_id: session1, p_client_request_id: reqB });
  partIds.push(b.data.part_id);
  const ab = await rpc(DISM, "abandon_dismantled_part", { p_part_id: b.data.part_id });
  check("abandon a capture that never got a photo", ab.data?.status === "rejected", ab.msg);
  const abAgain = await rpc(DISM, "abandon_dismantled_part", { p_part_id: b.data.part_id });
  check("abandon is idempotent", abAgain.data?.idempotent_replay === true);
  const ev = (await q("select status from public.vehicle_events where id=(select source_vehicle_event_id from public.parts where id=$1)", [b.data.part_id]))[0];
  check("abandoned capture keeps its history event", ev?.status === "abandoned");
}

// =========================== E. FLAG ISSUE ===========================
{
  const req1 = crypto.randomUUID();
  const r = await rpc(DISM, "flag_dismantling_issue", { p_session_id: session1, p_issue: "Missing Parts", p_note: "Alternator not on vehicle", p_client_request_id: req1 });
  check("flag an issue on the active session", !r.error && !!r.data?.event_id, r.msg);
  const retry = await rpc(DISM, "flag_dismantling_issue", { p_session_id: session1, p_issue: "Missing Parts", p_note: "Alternator not on vehicle", p_client_request_id: req1 });
  check("retried issue is deduplicated (same event)", retry.data?.event_id === r.data.event_id && retry.data?.idempotent_replay === true);
  const bad = await rpc(DISM, "flag_dismantling_issue", { p_session_id: session1, p_issue: "Invented", p_note: "something here", p_client_request_id: crypto.randomUUID() });
  check("unlisted issue type refused", bad.code === "22023", `code=${bad.code}`);
  const short = await rpc(DISM, "flag_dismantling_issue", { p_session_id: session1, p_issue: "Other", p_note: "x", p_client_request_id: crypto.randomUUID() });
  check("issue without a real note refused", short.code === "22023", `code=${short.code}`);
  const other = await rpc(S.engineer_admin, "flag_dismantling_issue", { p_session_id: session1, p_issue: "Other", p_note: "not my session", p_client_request_id: crypto.randomUUID() });
  check("a different employee cannot flag an issue on this session", other.code === "42501", `code=${other.code}`);
}

// =========================== F. FINISH: owner check, success, idempotent retry, already dismantled ===========================
{
  const notOwner = await rpc(S.owner, "finish_dismantling_session", { p_session_id: session1 });
  check("owner cannot finish another employee's session (actor consistency)", notOwner.code === "42501", `code=${notOwner.code}`);
  const fin = await rpc(DISM, "finish_dismantling_session", { p_session_id: session1 });
  check("finish succeeds once every part has a photo and evidence exists", !fin.error && fin.data?.status === "completed", fin.msg);
  const v = (await q("select status from public.vehicles where id=$1", [V1]))[0];
  check("vehicle becomes Dismantled", v.status === "Dismantled", v.status);
  const retry = await rpc(DISM, "finish_dismantling_session", { p_session_id: session1 });
  check("finish retry is an idempotent replay", retry.data?.idempotent_replay === true);
  const again = await rpc(DISM, "start_dismantling_session", { p_vehicle_id: V1 });
  check("a dismantled vehicle cannot be started again: ALREADY_DISMANTLED", again.hint === "ALREADY_DISMANTLED", `hint=${again.hint}`);
  const cap = (await q("select part_photos_captured from public.dismantling_sessions where id=$1", [session1]))[0].part_photos_captured;
  check("completed session records the captured part count", cap === 1, `count=${cap}`);
  const beginAfter = await rpc(DISM, "begin_dismantled_part", { p_session_id: session1, p_client_request_id: crypto.randomUUID() });
  check("no new part can be captured into a completed session", beginAfter.hint === "SESSION_NOT_ACTIVE", `hint=${beginAfter.hint}`);
}

// =========================== G. NO EVIDENCE BLOCKS FINISH (V3) ===========================
{
  const s3 = await rpc(DISM, "start_dismantling_session", { p_vehicle_id: V3 });
  sessionIds.push(s3.data.session_id);
  const f = await rpc(DISM, "finish_dismantling_session", { p_session_id: s3.data.session_id });
  check("finish refused with no vehicle evidence photo (NO_EVIDENCE)", f.hint === "NO_EVIDENCE", `hint=${f.hint}`);
  const closedV = await newVehicle(4);
  await rpc(S.manager, "close_vehicle", { p_vehicle_id: closedV, p_reason: "Other", p_note: "dismantling closed test" });
  const cl = await rpc(DISM, "start_dismantling_session", { p_vehicle_id: closedV });
  check("closed vehicle cannot be started (CLOSED_VEHICLE)", cl.hint === "CLOSED_VEHICLE", `hint=${cl.hint}`);
}

// Cleanup
{
  const sess = sessionIds.filter(Boolean);
  const parts = partIds.filter(Boolean);
  const vids = vehicleIds.filter(Boolean);
  await db.query("delete from public.media_assets where id = any($1::uuid[])", [mediaIds]).catch(() => {});
  if (sess.length) await db.query("delete from public.parts where dismantling_session_id = any($1::uuid[])", [sess]);
  if (parts.length) await db.query("delete from public.parts where id = any($1::uuid[])", [parts]);
  await db.query("delete from public.vehicle_events where vehicle_id = any($1::uuid[])", [vids]);
  if (sess.length) await db.query("delete from public.dismantling_sessions where id = any($1::uuid[])", [sess]);
  await db.query("delete from public.vehicles where id = any($1::uuid[])", [vids]);
  const left = (await q("select count(*)::int c from public.vehicles where auction_source = $1", [SRC]))[0].c;
  check("cleanup removed dismantling fixtures", left === 0, `left=${left}`);
}
await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
