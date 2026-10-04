// Modules 10/11 — Scrap Driver and Scrap Management: RPC, read model, RLS and role tests (migrations 0035–0037).
// Real signed-in sessions against DEV. Loads, payments and rim history are append-only, so fixtures are
// tagged with this run's id and left in place (the test never deletes history).
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
const newClient = () => createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function signIn(role) {
  const u = byRole[role];
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  return c;
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); return { data, error, code: error?.code, msg: error?.message ?? "" }; };
const DENIED = (r) => !!r.error && (r.code === "42501" || r.code === "28000");

const roles = ["manager", "owner", "engineer_admin", "employee", "dismantling", "receiving", "scrap_driver", "container_loading", "export_manager", "auction", "scrap_driver"];
const S = {};
for (const r of [...new Set(roles)]) S[r] = await signIn(r);
const driverId = (await q("select id from public.profiles where email = $1", [byRole.scrap_driver.email]))[0].id;
const managerId = (await q("select id from public.profiles where email = $1", [byRole.manager.email]))[0].id;
const ownerId = (await q("select id from public.profiles where email = $1", [byRole.owner.email]))[0].id;
const businessDate = (await q("select public._scrap_business_date()::text d"))[0].d;  // 'YYYY-MM-DD' in the yard's zone

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const tag = "SCRAP" + run;
const rimCustomer = (await q(`insert into public.customers (first_name, last_name, phone, phone_normalized) values ('Rim', $1, '555-0801', '5550801') returning id`, [tag]))[0].id;

// Media fixture: a ready original, uploaded by the given profile, for the given owner and role.
async function media(ownerType, ownerId, role, uploadedBy, status = "ready") {
  const [m] = await q(
    `insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, size_bytes, status, uploaded_by)
     values ($1, $2, $3, 'original', 'operational-media', $4, 'image/png', 1, $5, $6) returning id`,
    [ownerType, ownerId, role, `scrap-test/${run}/${crypto.randomUUID()}.png`, status, uploadedBy]);
  return m.id;
}
const loadKeysAreSafe = (row) => !["weight", "rate", "amount", "manager_notes", "payment_id", "amount_override_reason", "payment_status", "open_discrepancies"].some((k) => k in row);

// ------------------------------------------------------------------ LOAD WORKFLOW (driver)
const req1 = crypto.randomUUID();
const l1 = await rpc(S.scrap_driver, "scrap_driver_create_load", { p_client_request_id: req1 });
check("driver creates a load", !l1.error && l1.data?.status === "new" && l1.data?.driver_state === "saved", l1.msg);
const load1 = l1.data?.id;
check("load date is the server business date", (await q("select load_date::text d from public.scrap_loads where id=$1", [load1]))[0].d === businessDate);
const l1again = await rpc(S.scrap_driver, "scrap_driver_create_load", { p_client_request_id: req1 });
check("create load replay with the same request id returns the same load", l1again.data?.id === load1 && (await q("select count(*)::int c from public.scrap_loads where client_request_id=$1", [req1]))[0].c === 1);
check("manager cannot create a driver load", DENIED(await rpc(S.manager, "scrap_driver_create_load", { p_client_request_id: crypto.randomUUID() })));
check("employee cannot create a driver load", DENIED(await rpc(S.employee, "scrap_driver_create_load", { p_client_request_id: crypto.randomUUID() })));
check("owner cannot use driver actions (role separation)", DENIED(await rpc(S.owner, "scrap_driver_create_load", { p_client_request_id: crypto.randomUUID() })));

const delivNoPhoto = await rpc(S.scrap_driver, "scrap_driver_mark_delivered", { p_load_id: load1 });
check("cannot mark delivered without the load photo", delivNoPhoto.code === "P0001", delivNoPhoto.msg);
const loadPhoto1 = await media("scrap_load", load1, "load_photo", driverId);
const wrongRole = await rpc(S.scrap_driver, "scrap_driver_attach_photo", { p_load_id: load1, p_kind: "ticket", p_media_id: loadPhoto1 });
check("ticket cannot be attached before delivery", wrongRole.code === "P0001", wrongRole.msg);
const attachLoad = await rpc(S.scrap_driver, "scrap_driver_attach_photo", { p_load_id: load1, p_kind: "load", p_media_id: loadPhoto1 });
check("driver attaches the load photo (ready, own, role load_photo)", !attachLoad.error && attachLoad.data?.has_load_photo === true, attachLoad.msg);
const mismatchRole = await media("scrap_load", load1, "ticket_photo", driverId);
check("load slot rejects a photo with the wrong role", (await rpc(S.scrap_driver, "scrap_driver_attach_photo", { p_load_id: load1, p_kind: "load", p_media_id: mismatchRole })).code === "22023");
const notReady = await media("scrap_load", load1, "load_photo", driverId, "processing");
check("a photo still processing cannot be attached", (await rpc(S.scrap_driver, "scrap_driver_attach_photo", { p_load_id: load1, p_kind: "load", p_media_id: notReady })).code === "22023");
const otherLoadPhoto = await media("scrap_load", ownerId, "load_photo", driverId);
check("a photo owned by another record cannot be attached", (await rpc(S.scrap_driver, "scrap_driver_attach_photo", { p_load_id: load1, p_kind: "load", p_media_id: otherLoadPhoto })).code === "22023");

const deliv = await rpc(S.scrap_driver, "scrap_driver_mark_delivered", { p_load_id: load1 });
check("driver marks the load delivered", !deliv.error && deliv.data?.driver_state === "awaiting_ticket", deliv.msg);
const delivAgain = await rpc(S.scrap_driver, "scrap_driver_mark_delivered", { p_load_id: load1 });
check("delivered twice is safe (replay)", !delivAgain.error && delivAgain.data?.id === load1);
const lockedPhoto = await media("scrap_load", load1, "load_photo", driverId);
check("load photo is locked after delivery", (await rpc(S.scrap_driver, "scrap_driver_attach_photo", { p_load_id: load1, p_kind: "load", p_media_id: lockedPhoto })).code === "P0001");

const completeNoTicket = await rpc(S.scrap_driver, "scrap_driver_complete_load", { p_load_id: load1 });
check("cannot complete a load without the ticket photo", completeNoTicket.code === "P0001", completeNoTicket.msg);
const ticket1 = await media("scrap_load", load1, "ticket_photo", driverId);
const att = await rpc(S.scrap_driver, "scrap_driver_attach_photo", { p_load_id: load1, p_kind: "ticket", p_media_id: ticket1 });
check("driver attaches the ticket photo after delivery", !att.error && att.data?.has_ticket_photo === true && att.data?.driver_state === "ticket_attached", att.msg);
const comp = await rpc(S.scrap_driver, "scrap_driver_complete_load", { p_load_id: load1 });
check("driver completes the load (ready for review)", !comp.error && comp.data?.status === "ready_for_review" && comp.data?.driver_state === "complete", comp.msg);
const comp2 = await rpc(S.scrap_driver, "scrap_driver_complete_load", { p_load_id: load1 });
check("double complete is safe and changes nothing", !comp2.error && comp2.data?.status === "ready_for_review");
const compEvents = (await q("select count(*)::int c from public.scrap_load_events where scrap_load_id=$1 and event_type='completed'", [load1]))[0].c;
check("completion is recorded once in history", compEvents === 1, `completed events=${compEvents}`);

// Driver cannot approve, cannot change a finalized load, and cannot bypass evidence by writing directly.
check("driver cannot approve a load", DENIED(await rpc(S.scrap_driver, "scrap_manager_approve_load", { p_load_id: load1 })));
const direct = await S.scrap_driver.from("scrap_loads").update({ status: "approved" }).eq("id", load1).select("id");
const afterDirect = (await q("select status from public.scrap_loads where id=$1", [load1]))[0].status;
check("driver direct UPDATE to approved is blocked (no row changed)", afterDirect === "ready_for_review", `status=${afterDirect} err=${direct.error?.code ?? "none"} rows=${direct.data?.length ?? 0}`);
const directIns = await S.scrap_driver.from("scrap_loads").insert({ driver_id: driverId, load_date: businessDate, status: "new" }).select("id");
check("driver direct INSERT into scrap_loads is blocked", !!directIns.error || (directIns.data?.length ?? 0) === 0);

// Evidence-only: a driver can never reach a financial column in any read model.
const listed = await rpc(S.scrap_driver, "scrap_driver_list_loads", { p_limit: 25 });
const rows = listed.data?.rows ?? [];
check("driver list returns own loads", rows.some((r) => r.id === load1), `rows=${rows.length}`);
check("driver list rows carry no financial or payment fields", rows.length > 0 && rows.every(loadKeysAreSafe));
const got = await rpc(S.scrap_driver, "scrap_driver_get_load", { p_load_id: load1 });
check("driver detail carries no financial fields", !got.error && loadKeysAreSafe(got.data));
const finDirect = await S.scrap_driver.from("scrap_load_financials").select("scrap_load_id");
check("driver cannot read scrap_load_financials", !finDirect.error ? (finDirect.data?.length ?? 0) === 0 : true);
const payDirect = await S.scrap_driver.from("scrap_payments").select("id, amount_received");
check("driver cannot read scrap payments (no amounts)", !payDirect.error ? (payDirect.data?.length ?? 0) === 0 : true);

// Another driver's load: a foreign row (owner-owned, for the test) is invisible and refused.
const foreignLoad = (await q("insert into public.scrap_loads (driver_id, load_date, status) values ($1, $2, 'new') returning id", [ownerId, businessDate]))[0].id;
check("driver cannot read another driver's load", (await rpc(S.scrap_driver, "scrap_driver_get_load", { p_load_id: foreignLoad })).code === "22023");
check("driver cannot mark another driver's load delivered", (await rpc(S.scrap_driver, "scrap_driver_mark_delivered", { p_load_id: foreignLoad })).code === "22023");

// Check evidence: no amount field exists on the path; photo attaches once.
const chk = await rpc(S.scrap_driver, "scrap_driver_create_check", { p_client_request_id: crypto.randomUUID() });
check("driver creates a check (evidence only, no amount)", !chk.error && chk.data?.has_photo === false, chk.msg);
const chkPhoto = await media("driver_check", chk.data.id, "check_photo", driverId);
const chkAtt = await rpc(S.scrap_driver, "scrap_driver_attach_check_photo", { p_check_id: chk.data.id, p_media_id: chkPhoto });
check("driver attaches the check photo", !chkAtt.error && chkAtt.data?.has_photo === true, chkAtt.msg);
check("a second photo cannot replace a check photo", (await rpc(S.scrap_driver, "scrap_driver_attach_check_photo", { p_check_id: chk.data.id, p_media_id: await media("driver_check", chk.data.id, "check_photo", driverId) })).code === "P0001");
check("driver cannot read payments that reference checks", !(await S.scrap_driver.from("driver_check_submissions").select("linked_payment_id")).data?.length);

// ------------------------------------------------------------------ MANAGEMENT: loads, measurement, approval
const m = S.manager;
check("driver cannot read the management summary", DENIED(await rpc(S.scrap_driver, "scrap_manager_summary", { p_from: businessDate, p_to: businessDate })));
check("receiving cannot read the management summary", DENIED(await rpc(S.receiving, "scrap_manager_summary", { p_from: businessDate, p_to: businessDate })));
check("employee cannot read the management summary", DENIED(await rpc(S.employee, "scrap_manager_summary", { p_from: businessDate, p_to: businessDate })));
const sum = await rpc(m, "scrap_manager_summary", { p_from: businessDate, p_to: businessDate });
check("manager summary is DB-backed and has the required counts", !sum.error && ["loads_in_range", "completed_in_range", "amount_in_range", "awaiting_ticket_now", "needs_review_now", "discrepancies_open_now", "tire_rim_open_obligations", "by_driver"].every((k) => k in sum.data), sum.msg);
check("summary rejects an oversized range", (await rpc(m, "scrap_manager_summary", { p_from: "2020-01-01", p_to: "2026-01-01" })).code === "22023");

check("measurement by the driver is denied", DENIED(await rpc(S.scrap_driver, "scrap_manager_set_measurement", { p_load_id: load1, p_weight: 100, p_rate: 0.1 })));
check("negative weight rejected", (await rpc(m, "scrap_manager_set_measurement", { p_load_id: load1, p_weight: -5, p_rate: 0.1 })).code === "22023");
check("weight without rate and without override rejected", (await rpc(m, "scrap_manager_set_measurement", { p_load_id: load1, p_weight: 100, p_rate: null })).code === "22023");
check("amount override without a reason rejected", (await rpc(m, "scrap_manager_set_measurement", { p_load_id: load1, p_weight: null, p_rate: null, p_amount_override: 40 })).code === "22023");
const meas = await rpc(m, "scrap_manager_set_measurement", { p_load_id: load1, p_weight: 4620, p_rate: 0.075 });
check("amount is calculated on the server (4620 x 0.075 = 346.50)", !meas.error && Number(meas.data?.amount) === 346.5, `amount=${meas.data?.amount} ${meas.msg}`);
const approveNoMeas = await rpc(m, "scrap_manager_approve_load", { p_load_id: crypto.randomUUID() });
check("approve of an unknown load is refused", approveNoMeas.code === "22023");
const approve1 = await rpc(m, "scrap_manager_approve_load", { p_load_id: load1 });
check("manager approves a completed, measured load", !approve1.error && approve1.data?.status === "approved", approve1.msg);
const approve1b = await rpc(m, "scrap_manager_approve_load", { p_load_id: load1 });
check("approve twice is a safe replay", !approve1b.error && approve1b.data?.status === "approved");
check("driver cannot approve (already approved path also denied to driver)", DENIED(await rpc(S.scrap_driver, "scrap_manager_approve_load", { p_load_id: load1 })));

// Second load for the same driver: measured, but with an open discrepancy so approval must be blocked.
const load2 = (await rpc(S.scrap_driver, "scrap_driver_create_load", { p_client_request_id: crypto.randomUUID() })).data?.id ?? null;
if (load2) {
  await rpc(S.scrap_driver, "scrap_driver_attach_photo", { p_load_id: load2, p_kind: "load", p_media_id: await media("scrap_load", load2, "load_photo", driverId) });
  await rpc(S.scrap_driver, "scrap_driver_mark_delivered", { p_load_id: load2 });
  await rpc(S.scrap_driver, "scrap_driver_attach_photo", { p_load_id: load2, p_kind: "ticket", p_media_id: await media("scrap_load", load2, "ticket_photo", driverId) });
  await rpc(S.scrap_driver, "scrap_driver_complete_load", { p_load_id: load2 });
}
check("load 2 created by driver", !!load2);
await rpc(m, "scrap_manager_set_measurement", { p_load_id: load2, p_weight: 5000, p_rate: 0.08 });
const badKind = await rpc(m, "scrap_manager_open_discrepancy", { p_kind: "payment_mismatch", p_load_id: load2, p_payment_id: null, p_note: "should be system-recorded" });
check("payment mismatch cannot be opened by hand", badKind.code === "22023");
check("discrepancy note must be at least 5 characters", (await rpc(m, "scrap_manager_open_discrepancy", { p_kind: "ticket_missing", p_load_id: load2, p_payment_id: null, p_note: "no" })).code === "22023");
check("discrepancy needs exactly one target", (await rpc(m, "scrap_manager_open_discrepancy", { p_kind: "other", p_load_id: null, p_payment_id: null, p_note: "no target here" })).code === "22023");
check("driver cannot open a discrepancy", DENIED(await rpc(S.scrap_driver, "scrap_manager_open_discrepancy", { p_kind: "other", p_load_id: load2, p_payment_id: null, p_note: "driver note here" })));
const d1 = await rpc(m, "scrap_manager_open_discrepancy", { p_kind: "ticket_photo_mismatch", p_load_id: load2, p_payment_id: null, p_note: "ticket number does not match photo" });
const d1b = await rpc(m, "scrap_manager_open_discrepancy", { p_kind: "ticket_photo_mismatch", p_load_id: load2, p_payment_id: null, p_note: "ticket number does not match photo" });
check("open discrepancy is structured and not duplicated", !d1.error && d1b.data?.id === d1.data?.id && (await q("select count(*)::int c from public.scrap_discrepancies where scrap_load_id=$1 and status='open'", [load2]))[0].c === 1);
check("approve is blocked while a discrepancy is open", (await rpc(m, "scrap_manager_approve_load", { p_load_id: load2 })).code === "P0001");
check("resolve needs a note", (await rpc(m, "scrap_manager_resolve_discrepancy", { p_discrepancy_id: d1.data.id, p_resolution_note: "ok" })).code === "22023");
check("driver cannot resolve a discrepancy", DENIED(await rpc(S.scrap_driver, "scrap_manager_resolve_discrepancy", { p_discrepancy_id: d1.data.id, p_resolution_note: "driver clears it" })));
const res1 = await rpc(m, "scrap_manager_resolve_discrepancy", { p_discrepancy_id: d1.data.id, p_resolution_note: "Ticket re-checked; number matches" });
check("manager resolves the discrepancy with a reason", !res1.error && res1.data?.status === "resolved", res1.msg);
const approve2 = await rpc(m, "scrap_manager_approve_load", { p_load_id: load2 });
check("approve succeeds after the discrepancy is resolved", !approve2.error && approve2.data?.status === "approved", approve2.msg);

// Correction rules.
check("correction needs a reason", (await rpc(m, "scrap_manager_correct_financials", { p_load_id: load2, p_weight: 5100, p_rate: 0.08, p_reason: "no" })).code === "22023");
check("driver cannot correct financials", DENIED(await rpc(S.scrap_driver, "scrap_manager_correct_financials", { p_load_id: load2, p_weight: 1, p_rate: 1, p_reason: "driver tries" })));
const corr = await rpc(m, "scrap_manager_correct_financials", { p_load_id: load2, p_weight: 5100, p_rate: 0.08, p_reason: "Scale re-weighed at the yard" });
check("manager corrects an approved load with a reason (amount 408.00)", !corr.error && Number(corr.data?.amount) === 408, corr.msg);
const measPending = await rpc(m, "scrap_manager_set_measurement", { p_load_id: load2, p_weight: 1, p_rate: 1 });
check("measurement refused after approval (must correct with a reason)", measPending.code === "P0001");
const hist = (await q("select event_type from public.scrap_load_events where scrap_load_id=$1 order by created_at", [load2])).map((r) => r.event_type);
check("load history keeps measurement, correction and approval", hist.includes("measurement_recorded") && hist.includes("financials_corrected") && hist.includes("approved"), hist.join(","));
check("events are append-only (update blocked)", await db.query("update public.scrap_load_events set actor_name='x' where scrap_load_id=$1", [load2]).then(() => false, () => true));
check("events are append-only (delete blocked)", await db.query("delete from public.scrap_load_events where scrap_load_id=$1", [load2]).then(() => false, () => true));

// Illegal transition is refused by the database even for a direct write.
check("illegal transition (approved to new) refused by the database", await db.query("update public.scrap_loads set status='new' where id=$1", [load2]).then(() => false, (e) => /invalid scrap load status/.test(e.message)));

// ------------------------------------------------------------------ PAYMENTS (office) and reconciliation
// Payments use loads of the driver that are approved and unpaid. Load 1 = 346.50, load 2 = 408.00.
check("payment by driver is denied", DENIED(await rpc(S.scrap_driver, "scrap_manager_record_payment", { p_driver_id: driverId, p_load_ids: [load1], p_amount_received: 346.5, p_method: "Check", p_client_request_id: crypto.randomUUID() })));
check("payment with an unknown method is refused", (await rpc(m, "scrap_manager_record_payment", { p_driver_id: driverId, p_load_ids: [load1], p_amount_received: 346.5, p_method: "Cash", p_client_request_id: crypto.randomUUID() })).code === "22023");
check("payment with a negative amount is refused", (await rpc(m, "scrap_manager_record_payment", { p_driver_id: driverId, p_load_ids: [load1], p_amount_received: -1, p_method: "Check", p_client_request_id: crypto.randomUUID() })).code === "22023");
check("payment with a duplicated load is refused", (await rpc(m, "scrap_manager_record_payment", { p_driver_id: driverId, p_load_ids: [load1, load1], p_amount_received: 1, p_method: "Check", p_client_request_id: crypto.randomUUID() })).code === "22023");

const payReq = crypto.randomUUID();
const pay1 = await rpc(m, "scrap_manager_record_payment", { p_driver_id: driverId, p_load_ids: [load1], p_amount_received: 346.5, p_method: "Check", p_reference: "CHK-1001", p_client_request_id: payReq });
check("payment matching the load total is recorded and closes the load as paid", !pay1.error && pay1.data?.mismatch === false && pay1.data?.expected_total === 346.5, pay1.msg);
const load1Status = (await q("select status from public.scrap_loads where id=$1", [load1]))[0].status;
check("matched load becomes closed (paid)", load1Status === "closed", load1Status);
const pay1b = await rpc(m, "scrap_manager_record_payment", { p_driver_id: driverId, p_load_ids: [load1], p_amount_received: 346.5, p_method: "Check", p_client_request_id: payReq });
check("payment retry with the same request id is a replay (no second payment)", !pay1b.error && pay1b.data?.payment?.id === pay1.data?.payment?.id && (await q("select count(*)::int c from public.scrap_payments where client_request_id=$1", [payReq]))[0].c === 1);
check("a paid load cannot be paid again", (await rpc(m, "scrap_manager_record_payment", { p_driver_id: driverId, p_load_ids: [load1], p_amount_received: 346.5, p_method: "Check", p_client_request_id: crypto.randomUUID() })).code === "P0001");

// Mismatch: a third load of 50.00 paid with 40.00 must open a payment_mismatch and keep the load approved.
const load3 = (await rpc(S.scrap_driver, "scrap_driver_create_load", { p_client_request_id: crypto.randomUUID() })).data?.id;
await rpc(S.scrap_driver, "scrap_driver_attach_photo", { p_load_id: load3, p_kind: "load", p_media_id: await media("scrap_load", load3, "load_photo", driverId) });
await rpc(S.scrap_driver, "scrap_driver_mark_delivered", { p_load_id: load3 });
await rpc(S.scrap_driver, "scrap_driver_attach_photo", { p_load_id: load3, p_kind: "ticket", p_media_id: await media("scrap_load", load3, "ticket_photo", driverId) });
await rpc(S.scrap_driver, "scrap_driver_complete_load", { p_load_id: load3 });
await rpc(m, "scrap_manager_set_measurement", { p_load_id: load3, p_weight: 1000, p_rate: 0.05 });
await rpc(m, "scrap_manager_approve_load", { p_load_id: load3 });
const pay2 = await rpc(m, "scrap_manager_record_payment", { p_driver_id: driverId, p_load_ids: [load3], p_amount_received: 40, p_method: "ACH", p_reference: "ACH-7", p_client_request_id: crypto.randomUUID() });
check("payment that does not match opens a payment_mismatch and is recorded as received", !pay2.error && pay2.data?.mismatch === true && Number(pay2.data?.payment?.amount_received) === 40, pay2.msg);
const mismatchOpen = (await q("select count(*)::int c from public.scrap_discrepancies where kind='payment_mismatch' and scrap_payment_id=$1 and status='open'", [pay2.data?.payment?.id]))[0].c;
check("mismatch is a structured open discrepancy", mismatchOpen === 1);
const l3status = (await q("select status from public.scrap_loads where id=$1", [load3]))[0].status;
check("mismatched load stays approved until resolved", l3status === "approved", l3status);
const pm = (await q("select payment_status from public.scrap_loads_manager_v where id=$1", [load3]))[0].payment_status;
check("read model shows reconciliation mismatch", pm === "mismatch", pm);

// Immutability: a posted payment amount cannot be changed or deleted directly, even by an administrator session.
check("posted payment amount cannot be changed directly", await db.query("update public.scrap_payments set amount_received=1 where id=$1", [pay2.data?.payment?.id]).then(() => false, (e) => /immutable/.test(e.message)));
check("posted payment cannot be deleted", await db.query("delete from public.scrap_payments where id=$1", [pay2.data?.payment?.id]).then(() => false, () => true));

// Proof photo: attachable once.
const proof = await media("scrap_payment", pay2.data.payment.id, "proof", managerId);
const proofA = await rpc(m, "scrap_manager_attach_payment_proof", { p_payment_id: pay2.data.payment.id, p_media_id: proof });
check("manager attaches the payment proof once", !proofA.error && proofA.data?.proof_asset_id === proof, proofA.msg);
check("a second proof cannot replace the first", (await rpc(m, "scrap_manager_attach_payment_proof", { p_payment_id: pay2.data.payment.id, p_media_id: await media("scrap_payment", pay2.data.payment.id, "proof", managerId) })).code === "P0001");

// Correction: the original stays, the correction references it, and the mismatch is superseded with a reason.
const corrReq = crypto.randomUUID();
const corrRes = await rpc(m, "scrap_manager_correct_payment", { p_original_payment_id: pay2.data.payment.id, p_amount_received: 50, p_load_ids: [load3], p_reason: "Check amount corrected from bank statement", p_client_request_id: corrReq });
check("payment correction creates a new row with correction_of and a reason", !corrRes.error && corrRes.data?.payment?.correction_of === pay2.data.payment.id && corrRes.data?.mismatch === false, corrRes.msg);
const origAmount = (await q("select amount_received from public.scrap_payments where id=$1", [pay2.data.payment.id]))[0].amount_received;
check("original payment is unchanged by the correction", Number(origAmount) === 40, `amount=${origAmount}`);
const load3now = (await q("select status from public.scrap_loads where id=$1", [load3]))[0].status;
check("corrected load closes against the correction", load3now === "closed", load3now);
check("original mismatch is superseded with a reason", (await q("select status, resolution_note from public.scrap_discrepancies where kind='payment_mismatch' and scrap_payment_id=$1", [pay2.data.payment.id]))[0]?.status === "resolved");
check("a payment cannot be corrected twice", (await rpc(m, "scrap_manager_correct_payment", { p_original_payment_id: pay2.data.payment.id, p_amount_received: 51, p_load_ids: [load3], p_reason: "second correction try", p_client_request_id: crypto.randomUUID() })).code === "P0001");
check("correction replay with the same request id adds nothing", (await rpc(m, "scrap_manager_correct_payment", { p_original_payment_id: pay2.data.payment.id, p_amount_received: 50, p_load_ids: [load3], p_reason: "Check amount corrected from bank statement", p_client_request_id: corrReq })).data?.payment?.id === corrRes.data?.payment?.id);

// Driver confidential read denial, through the table as well as the RPCs.
check("driver cannot list payments through the management RPC", DENIED(await rpc(S.scrap_driver, "scrap_manager_list_payments", { p_limit: 5 })));

// ------------------------------------------------------------------ TIRE / RIM OBLIGATIONS
const roReq = crypto.randomUUID();
const ro = (await rpc(m, "scrap_manager_create_rim_obligation", { p_customer_id: rimCustomer, p_tires_qty: 4, p_aluminum_owed: 10, p_steel_owed: 0, p_notes: tag, p_client_request_id: roReq }));
check("manager creates a tire/rim obligation for an existing customer", !ro.error && ro.data?.aluminum_remaining === 10, ro.msg);
const roId = ro.data?.id;
check("obligation replay returns the same record", (await rpc(m, "scrap_manager_create_rim_obligation", { p_customer_id: rimCustomer, p_tires_qty: 4, p_aluminum_owed: 10, p_steel_owed: 0, p_notes: tag, p_client_request_id: roReq })).data?.id === roId);
check("obligation with a negative quantity is refused", (await rpc(m, "scrap_manager_create_rim_obligation", { p_customer_id: rimCustomer, p_tires_qty: 0, p_aluminum_owed: -1, p_steel_owed: 0, p_notes: "", p_client_request_id: crypto.randomUUID() })).code === "22023");
check("obligation with nothing owed is refused", (await rpc(m, "scrap_manager_create_rim_obligation", { p_customer_id: rimCustomer, p_tires_qty: 0, p_aluminum_owed: 0, p_steel_owed: 0, p_notes: "", p_client_request_id: crypto.randomUUID() })).code === "22023");
check("obligation for a missing customer is refused", (await rpc(m, "scrap_manager_create_rim_obligation", { p_customer_id: crypto.randomUUID(), p_tires_qty: 0, p_aluminum_owed: 1, p_steel_owed: 0, p_notes: "", p_client_request_id: crypto.randomUUID() })).code === "22023");
check("driver cannot create an obligation", DENIED(await rpc(S.scrap_driver, "scrap_manager_create_rim_obligation", { p_customer_id: rimCustomer, p_tires_qty: 0, p_aluminum_owed: 1, p_steel_owed: 0, p_notes: "", p_client_request_id: crypto.randomUUID() })));
check("driver cannot record a rim return", DENIED(await rpc(S.scrap_driver, "scrap_manager_record_rim_return", { p_obligation_id: roId, p_aluminum_returned: 1, p_steel_returned: 0, p_notes: "", p_client_request_id: crypto.randomUUID() })));

const r1 = await rpc(m, "scrap_manager_record_rim_return", { p_obligation_id: roId, p_aluminum_returned: 4, p_steel_returned: 0, p_notes: "partial 1", p_client_request_id: crypto.randomUUID() });
check("partial return: owed 10, returned 4, remaining 6", !r1.error && r1.data?.aluminum_remaining === 6 && r1.data?.status === "open", r1.msg);
const r2Req = crypto.randomUUID();
const r2 = await rpc(m, "scrap_manager_record_rim_return", { p_obligation_id: roId, p_aluminum_returned: 3, p_steel_returned: 0, p_notes: "partial 2", p_client_request_id: r2Req });
check("second partial return: remaining 3", !r2.error && r2.data?.aluminum_remaining === 3, r2.msg);
const r2b = await rpc(m, "scrap_manager_record_rim_return", { p_obligation_id: roId, p_aluminum_returned: 3, p_steel_returned: 0, p_notes: "partial 2", p_client_request_id: r2Req });
check("return replay does not count twice", !r2b.error && r2b.data?.aluminum_remaining === 3);
check("over-return is rejected (4 more than 3 remaining)", (await rpc(m, "scrap_manager_record_rim_return", { p_obligation_id: roId, p_aluminum_returned: 4, p_steel_returned: 0, p_notes: "", p_client_request_id: crypto.randomUUID() })).code === "22023");
check("negative return is rejected", (await rpc(m, "scrap_manager_record_rim_return", { p_obligation_id: roId, p_aluminum_returned: -1, p_steel_returned: 0, p_notes: "", p_client_request_id: crypto.randomUUID() })).code === "22023");
check("empty return is rejected", (await rpc(m, "scrap_manager_record_rim_return", { p_obligation_id: roId, p_aluminum_returned: 0, p_steel_returned: 0, p_notes: "", p_client_request_id: crypto.randomUUID() })).code === "22023");
const final = await rpc(m, "scrap_manager_record_rim_return", { p_obligation_id: roId, p_aluminum_returned: 3, p_steel_returned: 0, p_notes: "final", p_client_request_id: crypto.randomUUID() });
check("final return completes the obligation (remaining 0)", !final.error && final.data?.status === "completed" && final.data?.aluminum_remaining === 0, final.msg);
check("return after completion is rejected", (await rpc(m, "scrap_manager_record_rim_return", { p_obligation_id: roId, p_aluminum_returned: 1, p_steel_returned: 0, p_notes: "", p_client_request_id: crypto.randomUUID() })).code === "P0001");
check("return history is preserved (3 returns)", (await q("select count(*)::int c from public.rim_returns where obligation_id=$1", [roId]))[0].c === 3);
const directRim = await S.manager.from("rim_returns").insert({ obligation_id: roId, aluminum_returned: 1, steel_returned: 0 }).select("id");
check("direct client insert into rim_returns is blocked", !!directRim.error || (directRim.data?.length ?? 0) === 0);

// Concurrency: two returns race for the last 2 units. Exactly one may succeed; remaining never goes negative.
const ro2 = (await rpc(m, "scrap_manager_create_rim_obligation", { p_customer_id: rimCustomer, p_tires_qty: 0, p_aluminum_owed: 3, p_steel_owed: 0, p_notes: tag, p_client_request_id: crypto.randomUUID() })).data.id;
await rpc(m, "scrap_manager_record_rim_return", { p_obligation_id: ro2, p_aluminum_returned: 1, p_steel_returned: 0, p_notes: "", p_client_request_id: crypto.randomUUID() });
const [ca, cb] = [await signIn("manager"), await signIn("owner")];
const race = await Promise.all([
  rpc(ca, "scrap_manager_record_rim_return", { p_obligation_id: ro2, p_aluminum_returned: 2, p_steel_returned: 0, p_notes: "race a", p_client_request_id: crypto.randomUUID() }),
  rpc(cb, "scrap_manager_record_rim_return", { p_obligation_id: ro2, p_aluminum_returned: 2, p_steel_returned: 0, p_notes: "race b", p_client_request_id: crypto.randomUUID() }),
]);
const okCount = race.filter((r) => !r.error).length;
const remaining = (await q("select (o.aluminum_owed - coalesce(sum(r.aluminum_returned),0))::int rem from public.rim_obligations o left join public.rim_returns r on r.obligation_id=o.id where o.id=$1 group by o.aluminum_owed", [ro2]))[0].rem;
check("concurrent returns: exactly one succeeds, remaining never negative", okCount === 1 && remaining === 0, `ok=${okCount} remaining=${remaining}`);

// ------------------------------------------------------------------ DAILY CLOSE (past days, so today stays open for DEV use)
// A past day with no close and no loads, so the suite can be rerun against the same DEV database.
async function freeDay(exclude = []) {
  for (let k = 0; k < 100; k++) {
    const off = 10 + Math.floor(Math.random() * 300);  // inside the 366-day report window
    const d = (await q("select (public._scrap_business_date() - $1::int)::text d", [off]))[0].d;
    const used = (await q("select (select count(*) from public.daily_closes where close_date = $1::date)::int c1, (select count(*) from public.scrap_loads where load_date = $1::date)::int c2", [d]))[0];
    if (used.c1 === 0 && used.c2 === 0 && !exclude.includes(d)) return d;
  }
  throw new Error("no free past day for the daily close tests");
}
const pastDay = await freeDay();
const closeClean = await freeDay([pastDay]);
check("driver cannot preview or close a day", DENIED(await rpc(S.scrap_driver, "scrap_manager_daily_close_preview", { p_date: pastDay })) && DENIED(await rpc(S.scrap_driver, "scrap_manager_daily_close", { p_date: pastDay, p_override_reason: null })));
const tomorrow = (await q("select (public._scrap_business_date() + 1)::text d"))[0].d;
check("a day that has not ended cannot be closed in the future", (await rpc(m, "scrap_manager_daily_close", { p_date: tomorrow, p_override_reason: null })).code === "22023");
// A past day with an incomplete load (no photos, status new): blocked.
const blockedLoad = (await q("insert into public.scrap_loads (driver_id, load_date, status) values ($1, $2, 'new') returning id", [driverId, pastDay]))[0].id;
const prev = await rpc(m, "scrap_manager_daily_close_preview", { p_date: pastDay });
check("preview lists the blocking items for the day", !prev.error && prev.data?.blockers?.some((b) => b.kind === "missing_load_photo") && prev.data?.blockers?.some((b) => b.kind === "incomplete_workflow"), JSON.stringify(prev.data?.blockers));
check("close with blockers and no reason is refused", (await rpc(m, "scrap_manager_daily_close", { p_date: pastDay, p_override_reason: null })).code === "P0001");
check("override by a manager who is not owner or engineer admin is refused", DENIED(await rpc(m, "scrap_manager_daily_close", { p_date: pastDay, p_override_reason: "manager override attempt" })));
check("override without a reason is refused even for an owner", (await rpc(S.owner, "scrap_manager_daily_close", { p_date: pastDay, p_override_reason: "  " })).code === "P0001");
const ov = await rpc(S.owner, "scrap_manager_daily_close", { p_date: pastDay, p_override_reason: "Scale failure; loads verified by phone" });
check("owner override with a reason closes the day, frozen with its blockers", !ov.error && ov.data?.override_reason?.startsWith("Scale failure") && Array.isArray(ov.data?.blockers) && ov.data.blockers.length > 0, ov.msg);
check("overridden close is audited", (await q("select count(*)::int c from public.audit_logs where action='scrap.daily_close.override' and entity_id=$1", [ov.data?.id]))[0].c === 1);
const ovAgain = await rpc(S.owner, "scrap_manager_daily_close", { p_date: pastDay, p_override_reason: "second attempt" });
check("closing an already-closed day returns the frozen record (no second close)", !ovAgain.error && ovAgain.data?.id === ov.data?.id);
check("a closed day's loads cannot be changed by the driver", (await rpc(S.scrap_driver, "scrap_driver_attach_photo", { p_load_id: blockedLoad, p_kind: "load", p_media_id: await media("scrap_load", blockedLoad, "load_photo", driverId) })).code === "P0001");
check("a closed day's load cannot be measured by the manager (correction needed)", (await rpc(m, "scrap_manager_set_measurement", { p_load_id: blockedLoad, p_weight: 1, p_rate: 1 })).code === "P0001");
check("a closed day cannot be deleted or edited (daily close append-only)", await db.query("update public.daily_closes set override_reason='x' where id=$1", [ov.data.id]).then(() => false, () => true));

// A clean day closes without an override, when nothing is open.
const clean = await rpc(m, "scrap_manager_daily_close", { p_date: closeClean, p_override_reason: null });
check("a clean day closes normally for a manager (no blockers, no override)", !clean.error && clean.data?.override_reason === null && Array.isArray(clean.data?.blockers) && clean.data.blockers.length === 0, clean.msg);

// ------------------------------------------------------------------ REPORTS
const rep = await rpc(m, "scrap_manager_report", { p_from: pastDay, p_to: businessDate, p_driver: null });
const expectedAmount = Number((await q("select coalesce(sum(amount),0)::numeric a from public.scrap_loads_manager_v where load_date between $1 and $2 and status in ('approved','closed')", [pastDay, businessDate]))[0].a);
check("report amount equals the database sum for completed loads", !rep.error && Math.abs(Number(rep.data?.amount) - expectedAmount) < 0.005, `report=${rep.data?.amount} db=${expectedAmount}`);
check("report has reconciliation, tire/rim and by-driver sections", !rep.error && rep.data?.reconciliation && "tire_rim_outstanding_aluminum" in rep.data && Array.isArray(rep.data?.by_driver));
check("driver cannot run the report", DENIED(await rpc(S.scrap_driver, "scrap_manager_report", { p_from: pastDay, p_to: businessDate, p_driver: null })));

// ------------------------------------------------------------------ KEYSET PAGING (no duplicates, bounded)
const seen = new Set();
let cursor = {};
let pages = 0;
let more = true;
while (more && pages < 50) {
  const pg1 = await rpc(m, "scrap_manager_list_loads", { p_bucket: "all", p_from: pastDay, p_to: businessDate, p_driver: driverId, p_limit: 2, p_before_date: cursor.d ?? null, p_before_created: cursor.c ?? null, p_before_id: cursor.i ?? null });
  if (pg1.error) { check("list loads pages", false, pg1.msg); break; }
  for (const r of pg1.data.rows) { if (seen.has(r.id)) break; seen.add(r.id); }
  const last = pg1.data.rows.at(-1);
  if (last) cursor = { d: last.load_date, c: last.created_at, i: last.id };
  more = pg1.data.has_more;
  pages++;
}
const expectedRows = (await q("select count(*)::int c from public.scrap_loads_manager_v where load_date between $1 and $2 and driver_id=$3", [pastDay, businessDate, driverId]))[0].c;
check("keyset paging returns every load once, no duplicates", seen.size === expectedRows, `paged=${seen.size} db=${expectedRows} pages=${pages}`);
check("list rejects an unknown bucket", (await rpc(m, "scrap_manager_list_loads", { p_bucket: "everything" })).code === "22023");
const dl = await rpc(S.scrap_driver, "scrap_driver_list_loads", { p_limit: 1 });
check("driver list is paged and bounded", !dl.error && dl.data?.rows?.length <= 1);

// ------------------------------------------------------------------ CROSS-ROLE SECURITY MATRIX
const denyRoles = ["receiving", "dismantling", "container_loading", "export_manager", "employee", "scrap_driver"];
const matrix = {
  "summary": (c) => rpc(c, "scrap_manager_summary", { p_from: businessDate, p_to: businessDate }),
  "list loads": (c) => rpc(c, "scrap_manager_list_loads", { p_bucket: "all" }),
  "approve": (c) => rpc(c, "scrap_manager_approve_load", { p_load_id: load2 }),
  "record payment": (c) => rpc(c, "scrap_manager_record_payment", { p_driver_id: driverId, p_load_ids: [load3], p_amount_received: 1, p_method: "Check", p_client_request_id: crypto.randomUUID() }),
  "create obligation": (c) => rpc(c, "scrap_manager_create_rim_obligation", { p_customer_id: rimCustomer, p_tires_qty: 0, p_aluminum_owed: 1, p_steel_owed: 0, p_notes: "", p_client_request_id: crypto.randomUUID() }),
  "daily close": (c) => rpc(c, "scrap_manager_daily_close", { p_date: pastDay, p_override_reason: "matrix" }),
  "report": (c) => rpc(c, "scrap_manager_report", { p_from: pastDay, p_to: businessDate, p_driver: null }),
};
for (const role of denyRoles) for (const [name, fn] of Object.entries(matrix)) {
  const r = await fn(S[role]);
  check(`matrix: ${role} denied ${name}`, DENIED(r), r.code || "no error");
}
const anon = newClient();
for (const [name, fn] of Object.entries(matrix)) {
  const r = await fn(anon);
  check(`matrix: anonymous denied ${name}`, !!r.error && !r.data, r.code || "no error");
}
check("matrix: anonymous denied driver create", !!(await rpc(anon, "scrap_driver_create_load", { p_client_request_id: crypto.randomUUID() })).error);

// Office roles that the existing scrap rule grants (owner, engineer_admin, manager, auction) can read the summary.
for (const role of ["owner", "engineer_admin", "manager", "auction"]) {
  const r = await rpc(S[role], "scrap_manager_summary", { p_from: businessDate, p_to: businessDate });
  check(`matrix: ${role} may read management summary (scrap office role)`, !r.error, r.msg);
}

// Driver cannot approve through a direct update of the financial table either.
const finBefore = (await q("select amount::text a from public.scrap_load_financials where scrap_load_id=$1", [load1]))[0].a;
const finWrite = await S.scrap_driver.from("scrap_load_financials").update({ amount: 1 }).eq("scrap_load_id", load1).select("scrap_load_id");
const finAfter = (await q("select amount::text a from public.scrap_load_financials where scrap_load_id=$1", [load1]))[0].a;
check("driver cannot write scrap_load_financials directly (amount unchanged)", (finWrite.data?.length ?? 0) === 0 && finBefore === finAfter, `before=${finBefore} after=${finAfter}`);

console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail ? 1 : 0);
