// Parts Inventory RPC tests (migration 0026). Real signed-in sessions against DEV.
// Each fixture part goes through the real capture -> photo -> approval path. Cleans up at the end.
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

async function signIn(role) {
  const u = byRole[role];
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  return c;
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); return { data, error, code: error?.code, hint: error?.hint, msg: error?.message ?? "" }; };

const S = {};
for (const r of ["manager", "owner", "engineer_admin", "employee", "dismantling", "auction", "scrap_driver", "receiving"]) S[r] = await signIn(r);

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const SRC = "PARTSTEST-" + run;
const tag = "PTEST" + run;
const vehicles = [], sessions = [], parts = [], media = [], customers = [], sales = [];

// Builds one approved part through the real capture path. Returns its id.
async function approvedPart(n, shouldApprove = true) {
  const vin = ("1PT" + run + String(n).padStart(8, "0")).slice(0, 17);
  const v = await rpc(S.auction, "match_or_create_vehicle", { p_vin: vin, p_lot_number: null, p_stock_number: "PT" + run + n, p_auction_source: SRC, p_fields: { year: 2015, make: "Mazda", model: "3", purchase_price: 300 } });
  vehicles.push(v.data.vehicle_id);
  await prepAssigned(v.data.vehicle_id);
  const s = await rpc(S.dismantling, "start_dismantling_session", { p_vehicle_id: v.data.vehicle_id });
  sessions.push(s.data.session_id);
  const b = await rpc(S.dismantling, "begin_dismantled_part", { p_session_id: s.data.session_id, p_client_request_id: crypto.randomUUID(), p_capture_name: "TEST part", p_capture_details: "TEST capture details" });
  parts.push(b.data.part_id);
  const [m] = await q(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, status) values ('part', $1, 'capture', 'original', 'operational-media', $2, 'image/jpeg', 'ready') returning id`, [b.data.part_id, `test/${run}/${n}.jpg`]);
  media.push(m.id);
  if (shouldApprove) {
    const ap = await rpc(S.manager, "approve_dismantled_part", { p_part_id: b.data.part_id });
    if (ap.error) throw new Error("approve fixture: " + ap.msg);
  }
  // Donor session is left active on purpose: parts keep their session link, and cleanup deletes both.
  return b.data.part_id;
}
const name = (id) => q("update public.parts set part_name=$2 where id=$1", [id, tag + "-" + id.slice(0, 4)]);

const P_READY = await approvedPart(1);
const P_HOLD = await approvedPart(2);
const P_SOLD = await approvedPart(3);
const P_NS = await approvedPart(4);
const P_REJ = await approvedPart(5, false);
for (const id of [P_READY, P_HOLD, P_SOLD, P_NS, P_REJ]) await name(id);
const cust = (await q(`insert into public.customers (first_name, last_name, phone, phone_normalized) values ('Parts', $1, '555-0777', '5550777') returning id`, [tag]))[0].id;
customers.push(cust);
const rej = await rpc(S.manager, "reject_dismantled_part", { p_part_id: P_REJ, p_reason: "Not inventory (fixture)" });
if (rej.error) throw new Error("reject fixture: " + rej.msg);

// =========================== A. ROLES ===========================
for (const [label, c] of [["dismantling employee", S.dismantling], ["auction", S.auction], ["scrap driver", S.scrap_driver], ["receiving", S.receiving]]) {
  const l = await rpc(c, "list_parts", { p_search: tag, p_stage: null, p_status: null, p_operational: null, p_limit: 5, p_cursor_created_at: null, p_cursor_id: null });
  check(`${label} cannot list Parts Inventory`, l.code === "42501", `code=${l.code}`);
  const d = await rpc(c, "get_part_detail", { p_part_id: P_READY });
  check(`${label} cannot open a part`, d.code === "42501", `code=${d.code}`);
}
{
  const l = await rpc(S.employee, "list_parts", { p_search: tag, p_stage: null, p_status: null, p_operational: null, p_limit: 50, p_cursor_created_at: null, p_cursor_id: null });
  check("warehouse employee can list Parts Inventory", !l.error && (l.data ?? []).length >= 4, l.msg);
  const m = await rpc(S.manager, "list_parts", { p_search: tag, p_stage: null, p_status: null, p_operational: null, p_limit: 50, p_cursor_created_at: null, p_cursor_id: null });
  check("manager can list Parts Inventory", !m.error && (m.data ?? []).length >= 4, m.msg);
}

// =========================== B. WAREHOUSE FIELD EDITS AND PROTECTED FIELDS ===========================
{
  const ok = await rpc(S.employee, "update_part_fields", { p_part_id: P_HOLD, p_fields: { condition: "Good", location: "Row 3", bin: "B7", test_status: "Tested" }, p_note: "Warehouse check" });
  check("warehouse edits condition, location and test", !ok.error && ok.data?.changed?.length === 4, ok.msg);
  const ops = (await q("select count(*)::int c from public.part_operations where part_id=$1 and action_type='FIELD_UPDATE'", [P_HOLD]))[0].c;
  check("field update wrote a part_operations history row", ops === 1, `rows=${ops}`);
  const price = await rpc(S.employee, "update_part_fields", { p_part_id: P_HOLD, p_fields: { price: 10 } });
  check("warehouse cannot set price (REVIEWER_ONLY)", price.code === "42501", `code=${price.code}`);
  const sku = await rpc(S.employee, "update_part_fields", { p_part_id: P_HOLD, p_fields: { stock_sku: "SKU-" + run } });
  check("warehouse cannot set SKU", sku.code === "42501", `code=${sku.code}`);
  const qty = await rpc(S.employee, "update_part_fields", { p_part_id: P_HOLD, p_fields: { quantity: 99 } });
  check("quantity cannot be set through field edits", qty.code === "22023", `code=${qty.code}`);
  const direct = await S.employee.from("parts").update({ price: 1 }).eq("id", P_HOLD).select("id");
  check("warehouse direct price update is blocked", !!direct.error || (direct.data?.length ?? 0) === 0);
  const neg = await rpc(S.manager, "update_part_fields", { p_part_id: P_HOLD, p_fields: { price: -5 } });
  check("negative price refused", neg.code === "22023", `code=${neg.code}`);
  const dec = await rpc(S.manager, "update_part_fields", { p_part_id: P_HOLD, p_fields: { price: 12.345 } });
  check("price with three decimals refused", dec.code === "22023", `code=${dec.code}`);
  const chan = await rpc(S.manager, "update_part_fields", { p_part_id: P_HOLD, p_fields: { sale_channels: ["Amazon"] } });
  check("unknown sale channel refused", chan.code === "22023", `code=${chan.code}`);
  const set = await rpc(S.manager, "update_part_fields", { p_part_id: P_HOLD, p_fields: { price: 45, stock_sku: "SKU-" + run + "-H", sale_channels: ["In-Store", "eBay"] } });
  check("manager sets price, SKU and channels", !set.error, set.msg);
  const dupSku = await rpc(S.manager, "update_part_fields", { p_part_id: P_READY, p_fields: { stock_sku: "SKU-" + run + "-H" } });
  check("a SKU already used by another part is refused (SKU_TAKEN)", dupSku.hint === "SKU_TAKEN", `hint=${dupSku.hint}`);
}

// =========================== C. STAGE TRANSITIONS ===========================
{
  const jump = await rpc(S.manager, "set_part_stage", { p_part_id: P_READY, p_stage: "ready_for_sale" });
  check("needs_processing -> ready_for_sale is an invalid jump", jump.hint === "INVALID_TRANSITION", `hint=${jump.hint}`);
  const wh = await rpc(S.employee, "set_part_stage", { p_part_id: P_READY, p_stage: "in_processing" });
  check("warehouse moves needs_processing -> in_processing", !wh.error && wh.data?.stage === "in_processing", wh.msg);
  const whReady = await rpc(S.employee, "set_part_stage", { p_part_id: P_READY, p_stage: "ready_for_sale" });
  check("warehouse cannot mark ready for sale (REVIEWER_ONLY)", whReady.code === "42501", `code=${whReady.code}`);
  const notReady = await rpc(S.manager, "set_part_stage", { p_part_id: P_READY, p_stage: "ready_for_sale" });
  check("ready for sale refused without price, location and test (NOT_READY)", notReady.hint === "NOT_READY", `hint=${notReady.hint}`);
  await rpc(S.manager, "update_part_fields", { p_part_id: P_READY, p_fields: { price: 80, location: "Shelf A", test_status: "Tested", stock_sku: "SKU-" + run + "-R" } });
  const ready = await rpc(S.manager, "set_part_stage", { p_part_id: P_READY, p_stage: "ready_for_sale" });
  check("manager marks a complete part ready for sale", !ready.error && ready.data?.stage === "ready_for_sale", ready.msg);
  const hist = (await q("select count(*)::int c from public.part_operations where part_id=$1 and action_type='STAGE_CHANGE'", [P_READY]))[0].c;
  check("stage changes are recorded in history", hist === 2, `rows=${hist}`);
  const again = await rpc(S.manager, "set_part_stage", { p_part_id: P_READY, p_stage: "ready_for_sale" });
  check("same stage is an idempotent replay", again.data?.idempotent_replay === true);
  // Ready parts for the sold/not-sellable fixtures
  for (const id of [P_SOLD, P_NS]) {
    await rpc(S.employee, "set_part_stage", { p_part_id: id, p_stage: "in_processing" });
    await rpc(S.manager, "update_part_fields", { p_part_id: id, p_fields: { price: 30, location: "Bin 9", test_status: "Tested", stock_sku: "SKU-" + run + "-" + id.slice(0, 4) } });
    await rpc(S.manager, "set_part_stage", { p_part_id: id, p_stage: "ready_for_sale" });
  }
}

// =========================== D. SELLABILITY (regression on the sales path) ===========================
{
  const notReadySale = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P_HOLD, description: "hold", quantity: 1, unit_price: 45 }], p_mode: "reserve" });
  check("a part not yet ready for sale cannot be reserved (sales path enforces it)", notReadySale.code === "P0001", `code=${notReadySale.code} ${notReadySale.msg.slice(0, 60)}`);
  const rejSale = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P_REJ, description: "rej", quantity: 1, unit_price: 5 }], p_mode: "fulfill_now" });
  check("a rejected part cannot be sold even with quantity 1", rejSale.code === "P0001", `code=${rejSale.code}`);
  const ns = await rpc(S.manager, "mark_part_not_sellable", { p_part_id: P_NS, p_reason: "Cracked housing" });
  check("mark not sellable", !ns.error && ns.data?.stage === "not_sellable", ns.msg);
  const nsSale = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P_NS, description: "ns", quantity: 1, unit_price: 30 }], p_mode: "reserve" });
  check("a not-sellable part cannot be reserved", nsSale.code === "P0001", `code=${nsSale.code}`);
  const nsWh = await rpc(S.employee, "mark_part_not_sellable", { p_part_id: P_READY, p_reason: "Wrong call by warehouse" });
  check("warehouse cannot mark not sellable (role)", nsWh.code === "42501", `code=${nsWh.code}`);
  const reopen = await rpc(S.manager, "reopen_part_processing", { p_part_id: P_NS, p_note: "Housing was checked again" });
  check("reopen a not-sellable part to processing with a note", !reopen.error && reopen.data?.stage === "in_processing", reopen.msg);
  await rpc(S.manager, "set_part_stage", { p_part_id: P_NS, p_stage: "ready_for_sale" });
  await rpc(S.manager, "mark_part_not_sellable", { p_part_id: P_NS, p_reason: "Cracked housing" });
}

// =========================== E. ZERO QUANTITY: sold out stays in the database and in the list ===========================
{
  const sale = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P_SOLD, description: "sold", quantity: 1, unit_price: 30 }], p_mode: "fulfill_now" });
  check("fulfill-now sells the last unit", !sale.error, sale.msg);
  sales.push(sale.data?.sale_id);
  const qty = (await q("select quantity, operational_status from public.parts where id=$1", [P_SOLD]))[0];
  check("sold-out part quantity is 0 and state is SOLD", qty.quantity === 0 && qty.operational_status === "SOLD", JSON.stringify(qty));
  const list = await rpc(S.manager, "list_parts", { p_search: tag, p_stage: null, p_status: null, p_operational: null, p_limit: 50, p_cursor_created_at: null, p_cursor_id: null });
  const row = (list.data ?? []).find((r) => r.id === P_SOLD);
  check("zero-quantity part is still listed, flagged out of stock", !!row && row.out_of_stock === true && row.quantity === 0, JSON.stringify(row ?? "missing"));
  const exists = (await q("select count(*)::int c from public.parts where id=$1", [P_SOLD]))[0].c;
  check("sold-out row is not deleted", exists === 1);
  const detail = await rpc(S.manager, "get_part_detail", { p_part_id: P_SOLD });
  check("detail of a sold-out part loads with out_of_stock", detail.data?.part?.out_of_stock === true);
}

// =========================== F. REJECTED / DUPLICATE PROTECTION ===========================
{
  const stage = await rpc(S.manager, "set_part_stage", { p_part_id: P_REJ, p_stage: "in_processing" });
  check("rejected part has no processing stage (NOT_APPROVED)", stage.hint === "NOT_APPROVED", `hint=${stage.hint}`);
  const fields = await rpc(S.manager, "update_part_fields", { p_part_id: P_REJ, p_fields: { price: 9 } });
  check("rejected part cannot be edited for processing (NOT_APPROVED)", fields.hint === "NOT_APPROVED", `hint=${fields.hint}`);
  const op = await rpc(S.manager, "set_part_operational_status", { p_part_id: P_REJ, p_status: "DAMAGED", p_note: "Trying to make it stock" });
  check("rejected part keeps MISSING (TERMINAL_STATE)", op.hint === "TERMINAL_STATE", `hint=${op.hint}`);
  const sale = await rpc(S.manager, "create_sale", { p_customer_id: cust, p_lines: [{ part_id: P_REJ, description: "rej", quantity: 1, unit_price: 5 }], p_mode: "reserve" });
  check("rejected part cannot be reserved", sale.code === "P0001", `code=${sale.code}`);
}

// =========================== G. OPERATIONAL STATE ===========================
{
  const damaged = await rpc(S.employee, "set_part_operational_status", { p_part_id: P_HOLD, p_status: "DAMAGED", p_note: "Cracked during test" });
  check("warehouse records damage with a note", !damaged.error && damaged.data?.operational_status === "DAMAGED", damaged.msg);
  const returned = await rpc(S.employee, "set_part_operational_status", { p_part_id: P_HOLD, p_status: "RETURNED", p_note: "Customer return" });
  check("warehouse cannot record a return (REVIEWER_ONLY)", returned.code === "42501", `code=${returned.code}`);
  const noNote = await rpc(S.employee, "set_part_operational_status", { p_part_id: P_HOLD, p_status: "MISSING", p_note: "" });
  check("operational change without a note refused", noNote.code === "22023", `code=${noNote.code}`);
  const sold = await rpc(S.employee, "set_part_operational_status", { p_part_id: P_HOLD, p_status: "SOLD", p_note: "trying" });
  check("SOLD cannot be set directly", sold.code === "22023", `code=${sold.code}`);
  const qtyStill = (await q("select quantity from public.parts where id=$1", [P_HOLD]))[0].quantity;
  check("operational changes never alter quantity", qtyStill === 1, `qty=${qtyStill}`);
}

// =========================== H. DETAIL: donor context, photos, history ===========================
{
  const d = await rpc(S.manager, "get_part_detail", { p_part_id: P_HOLD });
  check("detail includes the donor vehicle VIN", !!d.data?.donor_vehicle?.vin, JSON.stringify(d.data?.donor_vehicle ?? d.msg).slice(0, 80));
  check("detail includes the dismantling session and employee name", !!d.data?.session?.id && typeof d.data?.session?.employee_name === "string");
  check("detail lists photo ids only (no storage paths)", Array.isArray(d.data?.photos) && d.data.photos.length >= 1 && !JSON.stringify(d.data.photos).includes("storage_path"));
  check("detail includes part history", Array.isArray(d.data?.history) && d.data.history.length >= 2);
}

// =========================== I. PAGINATION AND SEARCH ===========================
{
  const seen = [];
  let cur = await rpc(S.manager, "list_parts", { p_search: tag, p_stage: null, p_status: null, p_operational: null, p_limit: 2, p_cursor_created_at: null, p_cursor_id: null });
  let guard = 0;
  while (cur.data?.length && guard++ < 50) {
    seen.push(...cur.data.map((r) => r.id));
    const last = cur.data[cur.data.length - 1];
    if (!last.has_more) break;
    cur = await rpc(S.manager, "list_parts", { p_search: tag, p_stage: null, p_status: null, p_operational: null, p_limit: 2, p_cursor_created_at: last.created_at, p_cursor_id: last.id });
  }
  check("keyset pagination over parts has no duplicates and covers the fixtures", new Set(seen).size === seen.length && parts.every((id) => seen.includes(id)), `rows=${seen.length}`);
  const bySku = await rpc(S.manager, "list_parts", { p_search: "SKU-" + run, p_stage: null, p_status: null, p_operational: null, p_limit: 20, p_cursor_created_at: null, p_cursor_id: null });
  check("search by SKU finds the part", (bySku.data ?? []).some((r) => r.id === P_HOLD));
  const byStage = await rpc(S.manager, "list_parts", { p_search: tag, p_stage: "ready_for_sale", p_status: null, p_operational: null, p_limit: 20, p_cursor_created_at: null, p_cursor_id: null });
  check("stage filter returns only that stage", (byStage.data ?? []).every((r) => r.stage === "ready_for_sale"));
}

// =========================== J. PART CONTROLS: thumbnail join, no originals ===========================
{
  const l = await rpc(S.manager, "list_parts", { p_search: tag, p_stage: null, p_status: null, p_operational: null, p_limit: 5, p_cursor_created_at: null, p_cursor_id: null });
  check("list rows carry a thumbnail path column only", (l.data ?? []).every((r) => "thumbnail_path" in r && !("original_path" in r)));
}

// Cleanup
{
  if (sales.filter(Boolean).length) {
    const ids = sales.filter(Boolean);
    await db.query("delete from public.sale_items where sale_id = any($1::uuid[])", [ids]);
    await db.query("delete from public.inventory_reservations where sale_id = any($1::uuid[])", [ids]);
    await db.query("delete from public.sales where id = any($1::uuid[])", [ids]);
  }
  await db.query("delete from public.media_assets where id = any($1::uuid[])", [media]);
  await db.query("delete from public.part_operations where part_id = any($1::uuid[])", [parts]);
  await db.query("delete from public.parts where id = any($1::uuid[])", [parts]);
  await db.query("delete from public.vehicle_events where vehicle_id = any($1::uuid[])", [vehicles]);
  await db.query("delete from public.dismantling_sessions where id = any($1::uuid[])", [sessions]);
  await db.query("delete from public.dismantling_assignment_history where vehicle_id = any($1::uuid[])", [vehicles]);
  await db.query("delete from public.dismantling_assignments where vehicle_id = any($1::uuid[])", [vehicles]);
  await db.query("delete from public.vehicles where id = any($1::uuid[])", [vehicles]);
  await db.query("delete from public.customers where id = any($1::uuid[])", [customers]);
  const left = (await q("select count(*)::int c from public.vehicles where auction_source=$1", [SRC]))[0].c;
  check("cleanup removed parts fixtures", left === 0, `left=${left}`);
}
await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
