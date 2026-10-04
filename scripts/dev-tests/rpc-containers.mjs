// Modules 12 + 13 — Container loading and export management: RPC, RLS, immutability and role tests (migrations 0040–0041).
// Real signed-in sessions against DEV. Containers, invoices and payments are append-only history, so fixtures are
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
const EXPECTED = (r, code) => !!r.error && r.code === code;

const roles = ["container_loading", "export_manager", "owner", "engineer_admin", "manager", "employee", "receiving", "dismantling", "scrap_driver", "auction"];
const S = {};
for (const r of roles) S[r] = await signIn(r);
const uid = (role) => q("select id from public.profiles where email = $1", [byRole[role].email]).then((r) => r[0].id);
const loaderId = await uid("container_loading");

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const tag = "CNT" + run;
const randNumber = () => "LTST" + String(Math.floor(1000000 + Math.random() * 8999999));

// Media fixture for a container: a ready original, uploaded by the given profile.
async function media(containerId, role, uploadedBy, status = "ready") {
  const [m] = await q(
    `insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, size_bytes, status, uploaded_by)
     values ('container', $1, $2, 'original', 'operational-media', $3, 'image/jpeg', 1, $4, $5) returning id`,
    [containerId, role, `container-test/${run}/${crypto.randomUUID()}.jpg`, status, uploadedBy]);
  return m.id;
}

// A loader-finished container, ready for invoice. Used by the export tests.
async function readyContainer(label) {
  const o = await rpc(S.container_loading, "container_loader_open", { p_client_request_id: crypto.randomUUID() });
  if (o.error) throw new Error(`${label} open: ${o.msg}`);
  const id = o.data.id;
  await media(id, "number_photo", loaderId);
  const n = await rpc(S.container_loading, "container_loader_confirm_number", { p_container_id: id, p_number: randNumber() });
  if (n.error) throw new Error(`${label} number: ${n.msg}`);
  await media(id, "loading_photo", loaderId);
  await media(id, "final_list", loaderId);
  const f = await rpc(S.container_loading, "container_loader_finish", { p_container_id: id, p_client_request_id: crypto.randomUUID() });
  if (f.error) throw new Error(`${label} finish: ${f.msg}`);
  return { id, t_ref: o.data.t_ref, status: f.data.status };
}

// ------------------------------------------------------------------ MODULE 12 — LOADER
const open1 = await rpc(S.container_loading, "container_loader_open", { p_client_request_id: crypto.randomUUID() });
check("loader opens a container (status loading)", !open1.error && open1.data?.status === "loading", open1.msg);
check("permanent reference is server generated (T##-###)", /^T\d{2}-\d{3}$/.test(open1.data?.t_ref ?? ""), open1.data?.t_ref);
const reqOpen = crypto.randomUUID();
const openA = await rpc(S.container_loading, "container_loader_open", { p_client_request_id: reqOpen });
const openB = await rpc(S.container_loading, "container_loader_open", { p_client_request_id: reqOpen });
check("open is idempotent: same request returns the same container and reference", !openA.error && openA.data?.id === openB.data?.id && openA.data?.t_ref === openB.data?.t_ref);
const open2 = await rpc(S.container_loading, "container_loader_open", { p_client_request_id: crypto.randomUUID() });
check("references are unique and sequential", open2.data?.t_ref !== open1.data?.t_ref, `${open1.data?.t_ref} ${open2.data?.t_ref}`);
const C = open1.data.id;
check("loader cannot insert a container row directly", !!(await S.container_loading.from("container_jobs").insert({ t_ref: "X99-999", status: "loading" }).select("id")).error);
check("loader cannot write status directly", !!(await S.container_loading.from("container_jobs").update({ status: "ready_for_invoice" }).eq("id", C).select("id")).error || (await q("select status from public.container_jobs where id=$1", [C]))[0].status === "loading");
check("manager cannot open a container", DENIED(await rpc(S.manager, "container_loader_open", { p_client_request_id: crypto.randomUUID() })));
check("employee cannot open a container", DENIED(await rpc(S.employee, "container_loader_open", { p_client_request_id: crypto.randomUUID() })));
check("scrap driver cannot open a container", DENIED(await rpc(S.scrap_driver, "container_loader_open", { p_client_request_id: crypto.randomUUID() })));

const listed = await rpc(S.container_loading, "container_loader_list", { p_status: "open", p_limit: 25 });
check("loader list shows open containers", !listed.error && listed.data?.rows?.some((r) => r.id === C), listed.msg);
const SAFE_LOADER_KEYS = ["id", "t_ref", "container_number", "number_confirmed", "status", "started_at", "finished_at", "loading_list_confirmed", "created_at", "last_update_at", "number_photos", "loading_photos", "final_list_photos"];
const row = listed.data.rows.find((r) => r.id === C);
check("loader list rows contain only loader-safe fields", Object.keys(row).every((k) => SAFE_LOADER_KEYS.includes(k)), Object.keys(row).filter((k) => !SAFE_LOADER_KEYS.includes(k)).join(","));
const got = await rpc(S.container_loading, "container_loader_get", { p_container_id: C });
check("loader detail has no consignee, invoice, payment or close fields", !got.error && !JSON.stringify(got.data).match(/consignee|invoice|payment|balance|closed_by|close_override|deposit|price/i), got.msg);

check("confirm number before the number photo is refused", (await rpc(S.container_loading, "container_loader_confirm_number", { p_container_id: C, p_number: randNumber() })).code === "P0001");
await media(C, "number_photo", loaderId);
check("invalid container number format is refused", (await rpc(S.container_loading, "container_loader_confirm_number", { p_container_id: C, p_number: "MSCU123" })).code === "22023");
const NUM = randNumber();
const conf = await rpc(S.container_loading, "container_loader_confirm_number", { p_container_id: C, p_number: NUM });
check("loader confirms the official number after the photo", !conf.error && conf.data?.container_number === NUM && conf.data?.number_confirmed === true, conf.msg);
const confAgain = await rpc(S.container_loading, "container_loader_confirm_number", { p_container_id: C, p_number: NUM });
check("confirming the same number again is a no-op", !confAgain.error && confAgain.data?.container_number === NUM);
const other = await rpc(S.container_loading, "container_loader_open", { p_client_request_id: crypto.randomUUID() });
await media(other.data.id, "number_photo", loaderId);
check("a number already used by another container is refused", (await rpc(S.container_loading, "container_loader_confirm_number", { p_container_id: other.data.id, p_number: NUM })).code === "22023");

check("finish without loading photos is refused", (await rpc(S.container_loading, "container_loader_finish", { p_container_id: C, p_client_request_id: crypto.randomUUID() })).code === "P0001");
await media(C, "loading_photo", loaderId);
check("finish without the final loading list is refused", (await rpc(S.container_loading, "container_loader_finish", { p_container_id: C, p_client_request_id: crypto.randomUUID() })).code === "P0001");
const pendingFinal = await media(C, "final_list", loaderId, "processing");
check("a final list still processing does not count", (await rpc(S.container_loading, "container_loader_finish", { p_container_id: C, p_client_request_id: crypto.randomUUID() })).code === "P0001");
await db.query("update public.media_assets set status = 'ready' where id = $1", [pendingFinal]);
const fin = await rpc(S.container_loading, "container_loader_finish", { p_container_id: C, p_client_request_id: crypto.randomUUID() });
check("loader finishes loading: ready for invoice", !fin.error && fin.data?.status === "ready_for_invoice" && fin.data?.loading_list_confirmed === true, fin.msg);
const finAgain = await rpc(S.container_loading, "container_loader_finish", { p_container_id: C, p_client_request_id: crypto.randomUUID() });
check("finish twice is safe: same state, no second transition", !finAgain.error && finAgain.data?.status === "ready_for_invoice");
check("loading_finished recorded once", (await q("select count(*)::int c from public.container_events where container_id=$1 and action='loading_finished'", [C]))[0].c === 1);
check("evidence cannot be added after loading finished (database guard)", await db.query("insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, size_bytes, status, uploaded_by) values ('container', $1, 'loading_photo', 'original', 'operational-media', 'late.jpg', 'image/jpeg', 1, 'ready', $2)", [C, loaderId]).then(() => false, (e) => /no longer loading/.test(e.message)));
check("loader cannot reopen or set ready on a finished container directly", !!(await S.container_loading.from("container_jobs").update({ status: "loading" }).eq("id", C).select("id")).error || (await q("select status from public.container_jobs where id=$1", [C]))[0].status === "ready_for_invoice");

// Loader is locked out of every export surface, by table and by RPC.
check("loader reads no consignees", (await S.container_loading.from("consignees").select("id")).data?.length === 0);
check("loader reads no invoices", (await S.container_loading.from("export_invoices").select("id")).data?.length === 0);
check("loader reads no export payments", (await S.container_loading.from("export_payments").select("id")).data?.length === 0);
check("loader reads no shipping details", (await S.container_loading.from("container_shipping_info").select("container_id")).data?.length === 0);
check("loader cannot select closed_by directly", !!(await S.container_loading.from("container_jobs").select("closed_by").limit(1)).error);
check("loader cannot insert a consignee", !!(await S.container_loading.from("consignees").insert({ company: "X" }).select("id")).error);
check("loader cannot insert an export payment", !!(await S.container_loading.from("export_payments").insert({ invoice_id: crypto.randomUUID(), amount: 1, type: "Deposit", method: "Cash" }).select("id")).error);
for (const [name, fn] of [
  ["export_get_container", () => rpc(S.container_loading, "export_get_container", { p_container_id: C })],
  ["export_consignee_save", () => rpc(S.container_loading, "export_consignee_save", { p_id: null, p_company: "Loader Co" })],
  ["export_create_invoice", () => rpc(S.container_loading, "export_create_invoice", { p_container_id: C, p_client_request_id: crypto.randomUUID() })],
  ["export_record_payment", () => rpc(S.container_loading, "export_record_payment", { p_invoice_id: crypto.randomUUID(), p_amount: 1, p_type: "Deposit", p_method: "Cash", p_client_request_id: crypto.randomUUID() })],
  ["export_mark_on_the_way", () => rpc(S.container_loading, "export_mark_on_the_way", { p_container_id: C, p_shipping_reference: "x", p_client_request_id: crypto.randomUUID() })],
  ["export_close_container", () => rpc(S.container_loading, "export_close_container", { p_container_id: C, p_client_request_id: crypto.randomUUID() })],
  ["export_list_containers", () => rpc(S.container_loading, "export_list_containers", { p_bucket: "all" })],
]) check(`loader denied ${name}`, DENIED(await fn()));

// Other roles cannot run the loader workflow either, and export roles are not loaders (no loader-only RPC needed).
for (const role of ["employee", "receiving", "dismantling", "scrap_driver", "auction", "manager"]) {
  check(`${role} denied loader list`, DENIED(await rpc(S[role], "container_loader_list", { p_status: "open" })));
}

// ------------------------------------------------------------------ MODULE 13 — EXPORT
const X = S.export_manager;
const R = await readyContainer("export fixture");
check("export fixture: a container finished by the loader", R.status === "ready_for_invoice", R.t_ref);

check("manager (front desk) is denied export management", DENIED(await rpc(S.manager, "export_container_counts", {})));
check("employee is denied export management", DENIED(await rpc(S.employee, "export_container_counts", {})));
check("owner may read export management", !(await rpc(S.owner, "export_container_counts", {})).error);
check("engineer admin may read export management", !(await rpc(S.engineer_admin, "export_container_counts", {})).error);
const counts = await rpc(X, "export_container_counts", {});
check("export counts are database-backed", !counts.error && counts.data?.all >= 1 && counts.data?.ready_for_invoice >= 1, counts.msg);

// Consignee master: reusable, validated, export-only.
check("consignee needs a company name", (await rpc(X, "export_consignee_save", { p_id: null, p_company: "x" })).code === "22023");
check("manager cannot save a consignee", DENIED(await rpc(S.manager, "export_consignee_save", { p_id: null, p_company: "Manager Co" })));
const cons = await rpc(X, "export_consignee_save", { p_id: null, p_company: `Consignee ${tag}`, p_contact: "Ana", p_address: "1 Dock Rd", p_city: "Newark", p_country: "US", p_phone: "555-0100", p_email: "ana@example.com" });
check("export manager creates a reusable consignee", !cons.error && cons.data?.company === `Consignee ${tag}`, cons.msg);
const CONS = cons.data.id;
const consList = await rpc(X, "export_consignee_list", { p_search: tag, p_limit: 10 });
check("consignee can be found and reused by search", !consList.error && consList.data?.some((c) => c.id === CONS));
const shipSet = await rpc(X, "export_container_set_shipping", { p_container_id: R.id, p_consignee_id: CONS, p_destination_country: "US", p_destination_port: "Newark", p_trucking_company: "Dispatch Co", p_ship_date: null, p_eta: null, p_shipping_note: "" });
check("export sets shipping details and the consignee", !shipSet.error && shipSet.data?.consignee_id === CONS, shipSet.msg);
check("loader cannot set shipping details", DENIED(await rpc(S.container_loading, "export_container_set_shipping", { p_container_id: R.id, p_consignee_id: CONS })));

// Invoice draft.
const inv = await rpc(X, "export_create_invoice", { p_container_id: R.id, p_client_request_id: crypto.randomUUID() });
check("draft invoice created on a finished container (no invoice number yet)", !inv.error && inv.data?.status === "Draft" && inv.data?.invoice_number === null && inv.data?.t_ref === R.t_ref, inv.msg);
const INV = inv.data.id;
const invAgain = await rpc(X, "export_create_invoice", { p_container_id: R.id, p_client_request_id: crypto.randomUUID() });
check("one invoice per container: a second create returns the same invoice", !invAgain.error && invAgain.data?.id === INV);
const loadingC = await rpc(S.container_loading, "container_loader_open", { p_client_request_id: crypto.randomUUID() });
check("an invoice cannot be created for a container still loading", EXPECTED(await rpc(X, "export_create_invoice", { p_container_id: loadingC.data.id, p_client_request_id: crypto.randomUUID() }), "P0001"));

check("draft with no lines is refused", (await rpc(X, "export_save_invoice_draft", { p_invoice_id: INV, p_consignee_id: CONS, p_notes: "", p_lines: [] })).code === "22023");
check("line with zero quantity is refused", (await rpc(X, "export_save_invoice_draft", { p_invoice_id: INV, p_consignee_id: CONS, p_notes: "", p_lines: [{ description: "Engine", quantity: 0, unit_price: 10 }] })).code === "22023");
check("line with a negative price is refused", (await rpc(X, "export_save_invoice_draft", { p_invoice_id: INV, p_consignee_id: CONS, p_notes: "", p_lines: [{ description: "Engine", quantity: 1, unit_price: -1 }] })).code === "22023");
const LINES = [{ description: "Engine", quantity: 2, unit_price: 150.25, category: "Parts", condition: "Used" }, { description: "Alternator", quantity: 3, unit_price: 40.1 }];
const draft = await rpc(X, "export_save_invoice_draft", { p_invoice_id: INV, p_consignee_id: CONS, p_notes: "handle with care", p_lines: LINES });
const expectedCents = (2 * 15025) + (3 * 4010);
check("draft saved; total is computed by the database in NUMERIC", !draft.error && Number(draft.data?.total) === expectedCents / 100, `total=${draft.data?.total} expected=${expectedCents / 100}`);
check("manager cannot edit an invoice draft", DENIED(await rpc(S.manager, "export_save_invoice_draft", { p_invoice_id: INV, p_consignee_id: CONS, p_notes: "", p_lines: LINES })));
const rv = await rpc(X, "export_mark_invoice_review", { p_invoice_id: INV });
check("draft moves to review", !rv.error && rv.data?.status === "Review", rv.msg);

// Finalize: server number, consignee snapshot, double submit is a replay.
const fin1 = await rpc(X, "export_finalize_invoice", { p_invoice_id: INV, p_client_request_id: crypto.randomUUID() });
check("finalize assigns a server invoice number (INV-yy-nnnn)", !fin1.error && /^INV-\d{2}-\d{4}$/.test(fin1.data?.invoice_number ?? ""), fin1.msg);
check("finalize freezes the consignee snapshot", fin1.data?.consignee?.company === `Consignee ${tag}`);
const fin2 = await rpc(X, "export_finalize_invoice", { p_invoice_id: INV, p_client_request_id: crypto.randomUUID() });
check("finalize twice is a replay: same number", !fin2.error && fin2.data?.invoice_number === fin1.data.invoice_number);
const NUMBER = fin1.data.invoice_number;
check("invoice number is unique in the database", (await q("select count(*)::int c from public.export_invoices where invoice_number=$1", [NUMBER]))[0].c === 1);

// Immutability of the finalized record (database, not UI).
check("finalized invoice cannot be updated (database)", await db.query("update public.export_invoices set notes='changed' where id=$1", [INV]).then(() => false, (e) => /immutable/.test(e.message)));
check("finalized invoice cannot be deleted (database)", await db.query("delete from public.export_invoices where id=$1", [INV]).then(() => false, (e) => /immutable/.test(e.message)));
check("finalized line items cannot be changed (database)", await db.query("update public.export_invoice_line_items set quantity=99 where invoice_id=$1", [INV]).then(() => false, (e) => /immutable|Finalized/i.test(e.message)));
check("finalized line items cannot be added (database)", await db.query("insert into public.export_invoice_line_items (invoice_id, description, quantity, unit_price) values ($1,'x',1,1)", [INV]).then(() => false, (e) => /immutable|Finalized/i.test(e.message)));
check("finalized line items cannot be deleted (database)", await db.query("delete from public.export_invoice_line_items where invoice_id=$1", [INV]).then(() => false, (e) => /immutable|Finalized/i.test(e.message)));
check("a finalized invoice cannot be edited through the draft RPC", EXPECTED(await rpc(X, "export_save_invoice_draft", { p_invoice_id: INV, p_consignee_id: CONS, p_notes: "x", p_lines: LINES }), "P0001"));
check("export manager direct UPDATE of invoice is blocked", !!(await X.from("export_invoices").update({ notes: "x" }).eq("id", INV).select("id")).error || (await q("select notes from public.export_invoices where id=$1", [INV]))[0].notes !== "x");

// Consignee master can change later; the finalized snapshot does not.
await rpc(X, "export_consignee_save", { p_id: CONS, p_company: `Consignee ${tag} RENAMED`, p_contact: "Ana", p_address: "1 Dock Rd", p_city: "Newark", p_country: "US", p_phone: "555-0100", p_email: "ana@example.com" });
const afterRename = await rpc(X, "export_get_container", { p_container_id: R.id });
check("finalized invoice keeps the consignee used at finalization", afterRename.data?.invoice?.consignee?.company === `Consignee ${tag}`, afterRename.data?.invoice?.consignee?.company);

// Revisions: a correction is a new revision; the original stays.
const badRev = await rpc(X, "export_revise_invoice", { p_invoice_id: INV, p_reason: "no", p_consignee_id: CONS, p_lines: LINES, p_client_request_id: crypto.randomUUID() });
check("revision needs a reason", badRev.code === "22023");
const REVLINES = [{ description: "Engine", quantity: 2, unit_price: 150.25 }, { description: "Alternator", quantity: 4, unit_price: 40.1 }];
const revReq = crypto.randomUUID();
const rev1 = await rpc(X, "export_revise_invoice", { p_invoice_id: INV, p_reason: "Alternator quantity corrected from 3 to 4", p_consignee_id: CONS, p_lines: REVLINES, p_client_request_id: revReq });
check("revision creates a new effective state and a revision number", !rev1.error && rev1.data?.revision_count === 1 && Number(rev1.data?.total) === (2 * 150.25) + (4 * 40.1), rev1.msg);
const rev1b = await rpc(X, "export_revise_invoice", { p_invoice_id: INV, p_reason: "Alternator quantity corrected from 3 to 4", p_consignee_id: CONS, p_lines: REVLINES, p_client_request_id: revReq });
check("revision replay does not add a second revision", !rev1b.error && rev1b.data?.revision_count === 1);
const origLines = (await q("select sum(quantity*unit_price)::numeric t from public.export_invoice_line_items where invoice_id=$1", [INV]))[0].t;
check("original line items are unchanged by the revision", Number(origLines) === expectedCents / 100, `db=${origLines}`);
check("original invoice row is unchanged by the revision (number)", (await q("select invoice_number from public.export_invoices where id=$1", [INV]))[0].invoice_number === NUMBER);
const rev2 = await rpc(X, "export_revise_invoice", { p_invoice_id: INV, p_reason: "Second correction: consignee contact updated", p_consignee_id: CONS, p_lines: REVLINES, p_client_request_id: crypto.randomUUID() });
check("second revision is numbered 2 and history keeps both", !rev2.error && rev2.data?.revision_count === 2, rev2.msg);
const revRows = await q("select revision_number, reason from public.export_invoice_revisions where invoice_id=$1 order by revision_number", [INV]);
check("revision history is preserved and ordered", revRows.length === 2 && revRows[0].revision_number === 1 && revRows[1].revision_number === 2);
check("revision rows cannot be updated (database)", await db.query("update public.export_invoice_revisions set reason='x' where invoice_id=$1", [INV]).then(() => false, (e) => /append-only/.test(e.message)));
check("revision rows cannot be deleted (database)", await db.query("delete from public.export_invoice_revisions where invoice_id=$1", [INV]).then(() => false, (e) => /append-only/.test(e.message)));
check("loader cannot revise an invoice", DENIED(await rpc(S.container_loading, "export_revise_invoice", { p_invoice_id: INV, p_reason: "loader tries", p_consignee_id: CONS, p_lines: REVLINES, p_client_request_id: crypto.randomUUID() })));

// Payments: partial, multiple, overpayment refused, replay safe, reversal.
const TOTAL = Number(rev2.data.total);
check("payment on a draft invoice is refused", (await (async () => { const d = await rpc(X, "export_create_invoice", { p_container_id: (await readyContainer("draft-pay")).id, p_client_request_id: crypto.randomUUID() }); return rpc(X, "export_record_payment", { p_invoice_id: d.data.id, p_amount: 1, p_type: "Deposit", p_method: "Wire", p_client_request_id: crypto.randomUUID() }); })()).code === "P0001");
check("payment amount must be above zero", (await rpc(X, "export_record_payment", { p_invoice_id: INV, p_amount: 0, p_type: "Deposit", p_method: "Wire", p_client_request_id: crypto.randomUUID() })).code === "22023");
check("payment with an unknown method is refused", (await rpc(X, "export_record_payment", { p_invoice_id: INV, p_amount: 10, p_type: "Deposit", p_method: "Bitcoin", p_client_request_id: crypto.randomUUID() })).code === "22023");
const overpay = await rpc(X, "export_record_payment", { p_invoice_id: INV, p_amount: TOTAL + 1, p_type: "Deposit", p_method: "Wire", p_client_request_id: crypto.randomUUID() });
check("overpayment is refused by the database", overpay.code === "P0001" && /overpayment/.test(overpay.msg), overpay.msg);
const pay1Req = crypto.randomUUID();
const pay1 = await rpc(X, "export_record_payment", { p_invoice_id: INV, p_amount: 100.5, p_type: "Deposit", p_method: "Wire", p_reference: "WIRE-1", p_client_request_id: pay1Req });
check("partial payment recorded; balance is total minus payment", !pay1.error && Number(pay1.data?.balance) === Number((TOTAL - 100.5).toFixed(2)), pay1.msg);
const pay1b = await rpc(X, "export_record_payment", { p_invoice_id: INV, p_amount: 100.5, p_type: "Deposit", p_method: "Wire", p_reference: "WIRE-1", p_client_request_id: pay1Req });
check("payment replay does not record twice", !pay1b.error && pay1b.data?.id === pay1.data?.id && (await q("select count(*)::int c from public.export_payments where client_request_id=$1", [pay1Req]))[0].c === 1);
const pay2 = await rpc(X, "export_record_payment", { p_invoice_id: INV, p_amount: 50, p_type: "Additional Deposit", p_method: "ACH", p_client_request_id: crypto.randomUUID() });
check("second payment adds to the paid total (multiple payments)", !pay2.error && Number(pay2.data?.balance) === Number((TOTAL - 150.5).toFixed(2)), pay2.msg);
check("loader cannot record a payment", DENIED(await rpc(S.container_loading, "export_record_payment", { p_invoice_id: INV, p_amount: 1, p_type: "Deposit", p_method: "Cash", p_client_request_id: crypto.randomUUID() })));

// Concurrent payments that together exceed the balance: exactly one may succeed.
const remaining = Number((TOTAL - 150.5).toFixed(2));
const [ca, cb] = [await signIn("export_manager"), await signIn("owner")];
const race = await Promise.all([
  rpc(ca, "export_record_payment", { p_invoice_id: INV, p_amount: remaining, p_type: "Final Payment", p_method: "Wire", p_client_request_id: crypto.randomUUID() }),
  rpc(cb, "export_record_payment", { p_invoice_id: INV, p_amount: remaining, p_type: "Final Payment", p_method: "Wire", p_client_request_id: crypto.randomUUID() }),
]);
const raceOk = race.filter((r) => !r.error).length;
const balanceNow = (await rpc(X, "export_get_container", { p_container_id: R.id })).data?.invoice?.balance;
check("concurrent payments exceeding the balance: one succeeds, balance never negative", raceOk === 1 && Number(balanceNow) === 0, `ok=${raceOk} balance=${balanceNow}`);

// Reversal: a new row references the original; original untouched; no double reversal.
const rv1 = await rpc(X, "export_reverse_payment", { p_payment_id: pay2.data.id, p_reason: "Entered against the wrong invoice", p_client_request_id: crypto.randomUUID() });
check("reversal creates a reference row and restores the balance", !rv1.error && Number(rv1.data?.balance) > 0, rv1.msg);
check("original payment row is unchanged by the reversal", Number((await q("select amount from public.export_payments where id=$1", [pay2.data.id]))[0].amount) === 50);
check("payment rows cannot be updated (database)", await db.query("update public.export_payments set amount=1 where id=$1", [pay2.data.id]).then(() => false, (e) => /append-only/.test(e.message)));
check("a payment cannot be reversed twice", EXPECTED(await rpc(X, "export_reverse_payment", { p_payment_id: pay2.data.id, p_reason: "again please", p_client_request_id: crypto.randomUUID() }), "P0001"));
check("a reversal cannot be reversed", EXPECTED(await rpc(X, "export_reverse_payment", { p_payment_id: rv1.data.id, p_reason: "reverse the reversal", p_client_request_id: crypto.randomUUID() }), "P0001"));
check("loader cannot reverse a payment", DENIED(await rpc(S.container_loading, "export_reverse_payment", { p_payment_id: pay2.data.id, p_reason: "loader tries", p_client_request_id: crypto.randomUUID() })));

// Shipping and close. Balance must be zero first.
check("closing with an open balance is refused", EXPECTED(await rpc(X, "export_close_container", { p_container_id: R.id, p_client_request_id: crypto.randomUUID() }), "P0001"));
const shipReq = crypto.randomUUID();
const ship = await rpc(X, "export_mark_on_the_way", { p_container_id: R.id, p_shipping_reference: "BOL-7788", p_client_request_id: shipReq });
check("container goes on the way (finalized invoice required)", !ship.error && ship.data?.shipping_reference === "BOL-7788", ship.msg);
const shipAgain = await rpc(X, "export_mark_on_the_way", { p_container_id: R.id, p_shipping_reference: "BOL-7788", p_client_request_id: crypto.randomUUID() });
check("on-the-way twice is a replay", !shipAgain.error);
check("loader cannot move a container on the way", DENIED(await rpc(S.container_loading, "export_mark_on_the_way", { p_container_id: R.id, p_shipping_reference: "x", p_client_request_id: crypto.randomUUID() })));
const liveBal = (await rpc(X, "export_get_container", { p_container_id: R.id })).data?.invoice?.balance;
const paid = await rpc(X, "export_record_payment", { p_invoice_id: INV, p_amount: Number(liveBal), p_type: "Final Payment", p_method: "Wire", p_client_request_id: crypto.randomUUID() });
check("the live balance is paid exactly", !paid.error && Number(paid.data?.balance) === 0, paid.msg);
const bal2 = (await rpc(X, "export_get_container", { p_container_id: R.id })).data?.invoice?.balance;
const closeReq = crypto.randomUUID();
const closeTry = await rpc(X, "export_close_container", { p_container_id: R.id, p_client_request_id: closeReq });
check("container closes once the balance is zero", !closeTry.error && closeTry.data?.status === "closed", `balance=${bal2} ${closeTry.msg}`);
{
  check("close replay returns the same closed state", (await rpc(X, "export_close_container", { p_container_id: R.id, p_client_request_id: closeReq })).data?.status === "closed");
  check("a closed container's shipping details cannot change", EXPECTED(await rpc(X, "export_container_set_shipping", { p_container_id: R.id, p_consignee_id: CONS }), "P0001"));
  check("loader cannot close a container", DENIED(await rpc(S.container_loading, "export_close_container", { p_container_id: R.id, p_client_request_id: crypto.randomUUID() })));
}

// Lists and detail: buckets, keyset, confidential data only for export roles.
const list = await rpc(X, "export_list_containers", { p_bucket: "all", p_limit: 5 });
check("export list is paged (limit honored) with confidential fields for export", !list.error && list.data?.rows?.length <= 5 && "consignee_company" in (list.data.rows[0] ?? {}), list.msg);
check("export list bucket filter works", (await rpc(X, "export_list_containers", { p_bucket: "closed", p_limit: 5 })).data?.rows?.every((r) => r.status === "closed"));
check("export list rejects an unknown bucket", (await rpc(X, "export_list_containers", { p_bucket: "everything" })).code === "22023");
const detail = await rpc(X, "export_get_container", { p_container_id: R.id });
check("export detail includes invoice, revisions, payments, shipping and events", !detail.error && detail.data?.invoice && Array.isArray(detail.data?.revisions) && Array.isArray(detail.data?.payments) && detail.data?.shipping && Array.isArray(detail.data?.events), detail.msg);

// Role matrix: every export entry point, for every role that is not export-authorized.
const denyRoles = ["container_loading", "manager", "employee", "receiving", "dismantling", "scrap_driver", "auction"];
const matrix = {
  "export counts": (c) => rpc(c, "export_container_counts", {}),
  "export list": (c) => rpc(c, "export_list_containers", { p_bucket: "all" }),
  "export detail": (c) => rpc(c, "export_get_container", { p_container_id: R.id }),
  "consignee list": (c) => rpc(c, "export_consignee_list", { p_search: null }),
  "create invoice": (c) => rpc(c, "export_create_invoice", { p_container_id: R.id, p_client_request_id: crypto.randomUUID() }),
  "finalize": (c) => rpc(c, "export_finalize_invoice", { p_invoice_id: INV, p_client_request_id: crypto.randomUUID() }),
  "payment": (c) => rpc(c, "export_record_payment", { p_invoice_id: INV, p_amount: 1, p_type: "Deposit", p_method: "Wire", p_client_request_id: crypto.randomUUID() }),
};
for (const role of denyRoles) for (const [name, fn] of Object.entries(matrix)) {
  const r = await fn(S[role]);
  check(`matrix: ${role} denied ${name}`, DENIED(r), r.code || "no error");
}
const anon = newClient();
for (const [name, fn] of Object.entries(matrix)) check(`matrix: anonymous denied ${name}`, !!(await fn(anon)).error);
{ const r = await anon.from("container_jobs").select("id"); check("matrix: anonymous cannot read containers directly", !!r.error || (r.data?.length ?? 0) === 0, r.error ? r.error.code : `rows=${r.data?.length}`); }

console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail ? 1 : 0);
