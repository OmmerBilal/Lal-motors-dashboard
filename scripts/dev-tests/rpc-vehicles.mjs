// Vehicle business RPC tests (migration 0006). Real signed-in sessions against DEV.
// Creates its own vehicles, carriers and media rows, then removes them.
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
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); return { data, error, code: error?.code, msg: error?.message ?? "" }; };

const S = {};
for (const r of ["auction", "manager", "engineer_admin", "owner", "receiving", "dismantling", "scrap_driver", "employee"]) S[r] = await signIn(r);

// Unique test namespace so runs never collide.
const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const vinFor = (n) => ("1TST" + run + String(n).padStart(7, "0")).slice(0, 17);
const stockFor = (n) => `S${run}${n}`;
const lotFor = (n) => `L${run}${n}`;
const SRC = "RPCTEST-" + run;
const fields = { year: 2019, make: "Ford", model: "Focus", purchase_price: 1000, auction_fees: 50, transportation_cost: 0 };
const createdVehicles = [];
const createdCarriers = [];

// =========================== A. AUTHORIZATION ===========================
{
  let r = await rpc(S.receiving, "match_or_create_vehicle", { p_vin: vinFor(90), p_lot_number: null, p_stock_number: stockFor(90), p_auction_source: null, p_fields: fields });
  check("receiving cannot create auction intake", r.code === "42501", `code=${r.code}`);
  r = await rpc(S.auction, "close_vehicle", { p_vehicle_id: crypto.randomUUID(), p_reason: "Other", p_note: "test note" });
  check("auction cannot close a vehicle (reviewer only)", r.code === "42501", `code=${r.code}`);
  r = await rpc(S.dismantling, "assign_carrier", { p_vehicle_ids: [crypto.randomUUID()], p_carrier_id: crypto.randomUUID(), p_transport_price: 10 });
  check("dismantling cannot assign carriers", r.code === "42501", `code=${r.code}`);
  r = await rpc(S.receiving, "update_transport_status", { p_vehicle_id: crypto.randomUUID(), p_to_status: "PROBLEM", p_problem_note: "x problem" });
  check("receiving cannot change transport status", r.code === "42501", `code=${r.code}`);
  r = await rpc(S.scrap_driver, "receive_vehicle", { p_vehicle_id: crypto.randomUUID() });
  check("scrap driver cannot receive vehicles", r.code === "42501", `code=${r.code}`);
  r = await rpc(S.employee, "match_or_create_vehicle", { p_vin: vinFor(91), p_lot_number: null, p_stock_number: null, p_auction_source: null, p_fields: fields });
  check("warehouse employee cannot create vehicles", r.code === "42501", `code=${r.code}`);
  const anon = createClient(SUPA, PUB, { auth: { persistSession: false } });
  r = await rpc(anon, "receive_vehicle", { p_vehicle_id: crypto.randomUUID() });
  check("anonymous receive refused", !!r.error);
}

// =========================== B. VALIDATION ===========================
{
  const bad = [
    ["no identifiers", { p_vin: null, p_lot_number: null, p_stock_number: null, p_auction_source: null, p_fields: fields }],
    ["16-char VIN", { p_vin: "1TST123456789012", p_lot_number: null, p_stock_number: null, p_auction_source: null, p_fields: fields }],
    ["VIN containing I", { p_vin: "1I" + "A".repeat(15), p_lot_number: null, p_stock_number: null, p_auction_source: null, p_fields: fields }],
    ["lot without source", { p_vin: null, p_lot_number: lotFor(1), p_stock_number: null, p_auction_source: null, p_fields: fields }],
    ["new vehicle without year", { p_vin: vinFor(92), p_lot_number: null, p_stock_number: null, p_auction_source: null, p_fields: { make: "A", model: "B" } }],
  ];
  for (const [label, args] of bad) {
    const r = await rpc(S.auction, "match_or_create_vehicle", args);
    check(`intake rejects ${label}`, r.code === "22023", `code=${r.code} ${r.msg.slice(0, 50)}`);
  }
  const rc = await rpc(S.manager, "close_vehicle", { p_vehicle_id: crypto.randomUUID(), p_reason: "Bogus", p_note: "test note" });
  check("close rejects an unknown reason", rc.code === "22023", `code=${rc.code}`);
  const ac = await rpc(S.manager, "assign_carrier", { p_vehicle_ids: [crypto.randomUUID()], p_carrier_id: crypto.randomUUID(), p_transport_price: -5 });
  check("assign rejects a negative price", ac.code === "22023", `code=${ac.code}`);
}

// =========================== C. IDENTITY: one vehicle, never silent duplicates ===========================
const VA = { vin: vinFor(1), stock: stockFor(1), lot: lotFor(1) };
let vehicleA;
{
  const r = await rpc(S.auction, "match_or_create_vehicle", { p_vin: VA.vin, p_lot_number: VA.lot, p_stock_number: VA.stock, p_auction_source: SRC, p_fields: fields });
  check("new VIN creates a vehicle", r.data?.outcome === "created", r.msg || JSON.stringify(r.data));
  vehicleA = r.data.vehicle_id; createdVehicles.push(vehicleA);

  const again = await rpc(S.auction, "match_or_create_vehicle", { p_vin: VA.vin, p_lot_number: null, p_stock_number: null, p_auction_source: null, p_fields: fields });
  check("same VIN again matches the existing vehicle (retry-safe)", again.data?.outcome === "existing" && again.data.vehicle_id === vehicleA && again.data.matched_by === "vin");

  const byStock = await rpc(S.auction, "match_or_create_vehicle", { p_vin: null, p_lot_number: null, p_stock_number: VA.stock, p_auction_source: null, p_fields: fields });
  check("stock number alone matches the same vehicle", byStock.data?.outcome === "existing" && byStock.data.vehicle_id === vehicleA);

  const byLot = await rpc(S.auction, "match_or_create_vehicle", { p_vin: null, p_lot_number: VA.lot, p_stock_number: null, p_auction_source: SRC, p_fields: fields });
  check("lot + auction source matches the same vehicle", byLot.data?.outcome === "existing" && byLot.data.vehicle_id === vehicleA);

  const cnt = (await q("select count(*)::int c from public.vehicles where vin=$1", [VA.vin]))[0].c;
  check("exactly one row for the VIN after 4 intakes", cnt === 1, `rows=${cnt}`);
}
{
  // Conflict: VIN of A together with the stock number of a different vehicle B.
  const vb = await rpc(S.auction, "match_or_create_vehicle", { p_vin: vinFor(2), p_lot_number: null, p_stock_number: stockFor(2), p_auction_source: null, p_fields: fields });
  createdVehicles.push(vb.data.vehicle_id);
  const conflict = await rpc(S.auction, "match_or_create_vehicle", { p_vin: VA.vin, p_lot_number: null, p_stock_number: stockFor(2), p_auction_source: null, p_fields: fields });
  check("identifiers pointing at different vehicles -> conflict, nothing written", conflict.data?.outcome === "conflict", JSON.stringify(conflict.data));
  const contradict = await rpc(S.auction, "match_or_create_vehicle", { p_vin: null, p_lot_number: null, p_stock_number: VA.stock, p_auction_source: null, p_fields: { ...fields } });
  check("matched stock row without a conflicting VIN still matches", contradict.data?.outcome === "existing");
}
{
  // Real race: two intake calls for the same brand-new VIN at the same time.
  const newVin = vinFor(3), newStock = stockFor(3);
  const [x, y] = await Promise.all([
    rpc(S.auction, "match_or_create_vehicle", { p_vin: newVin, p_lot_number: null, p_stock_number: newStock, p_auction_source: null, p_fields: fields }),
    rpc(await signIn("auction"), "match_or_create_vehicle", { p_vin: newVin, p_lot_number: null, p_stock_number: newStock, p_auction_source: null, p_fields: fields }),
  ]);
  const outcomes = [x, y].map((r) => r.data?.outcome ?? ("error:" + r.code));
  const rows = (await q("select id from public.vehicles where vin=$1", [newVin])).map((r) => r.id);
  for (const r of [x, y]) if (r.data?.vehicle_id) createdVehicles.push(r.data.vehicle_id);
  check("parallel intake of the same new VIN creates exactly one row", rows.length === 1, `rows=${rows.length} outcomes=${outcomes.join(",")}`);
  check("parallel intake: the other caller gets existing or conflict, not an error", outcomes.every((o) => ["created", "existing", "conflict"].includes(o)), outcomes.join(","));
}

// =========================== D. CLOSE (soft, reviewer only, idempotent, audited) ===========================
{
  const r = await rpc(S.manager, "close_vehicle", { p_vehicle_id: vehicleA, p_reason: "Sold Complete", p_note: "sold to buyer" });
  check("manager closes a vehicle with reason and note", !r.error && r.data?.closed_reason === "Sold Complete", r.msg);
  const row = (await q("select status, closed_reason, closed_note from public.vehicles where id=$1", [vehicleA]))[0];
  check("closed vehicle keeps its row (soft close, no delete)", row?.closed_reason === "Sold Complete" && row.closed_note === "sold to buyer");
  const replay = await rpc(S.manager, "close_vehicle", { p_vehicle_id: vehicleA, p_reason: "Other", p_note: "different note" });
  check("second close is an idempotent replay and does not overwrite the first", replay.data?.idempotent_replay === true && replay.data.closed_reason === "Sold Complete");
  const audit = (await q("select count(*)::int c from public.audit_logs where entity_id=$1 and action='vehicle.close'", [vehicleA]))[0].c;
  check("close wrote exactly one audit row", audit === 1, `audit=${audit}`);
  const ev = (await q("select count(*)::int c from public.vehicle_events where vehicle_id=$1 and action='VEHICLE_CLOSED'", [vehicleA]))[0].c;
  check("close wrote one vehicle event (history retained)", ev === 1);
}

// =========================== E. CARRIER ASSIGNMENT (bulk, all-or-nothing) ===========================
const carrier = (await q(`insert into public.carriers (company, active) values ($1, true) returning id`, ["RPC Carrier " + run]))[0].id;
const inactive = (await q(`insert into public.carriers (company, active) values ($1, false) returning id`, ["RPC Inactive " + run]))[0].id;
createdCarriers.push(carrier, inactive);
const vB = (await rpc(S.auction, "match_or_create_vehicle", { p_vin: vinFor(4), p_lot_number: null, p_stock_number: stockFor(4), p_auction_source: null, p_fields: fields })).data.vehicle_id;
const vC = (await rpc(S.auction, "match_or_create_vehicle", { p_vin: vinFor(5), p_lot_number: null, p_stock_number: stockFor(5), p_auction_source: null, p_fields: fields })).data.vehicle_id;
createdVehicles.push(vB, vC);
{
  const inact = await rpc(S.manager, "assign_carrier", { p_vehicle_ids: [vB], p_carrier_id: inactive, p_transport_price: 400 });
  check("inactive carrier refused", inact.code === "22023", `code=${inact.code}`);
  const ok = await rpc(S.manager, "assign_carrier", { p_vehicle_ids: [vB, vC], p_carrier_id: carrier, p_transport_price: 400 });
  check("bulk assign 2 vehicles", ok.data?.assigned === 2, ok.msg);
  const st = await q("select transport_status, transport_price, carrier_id from public.vehicles where id = any($1::uuid[])", [[vB, vC]]);
  check("both vehicles ASSIGNED with the carrier and price", st.every((r) => r.transport_status === "ASSIGNED" && Number(r.transport_price) === 400 && r.carrier_id === carrier));
  const again = await rpc(S.manager, "assign_carrier", { p_vehicle_ids: [vB, vC], p_carrier_id: carrier, p_transport_price: 400 });
  check("re-running the same bulk assign changes nothing", again.data?.assigned === 0 && again.data?.unchanged === 2);
}
{
  // Rollback: a batch containing a closed vehicle must not assign the open one.
  const vOpen = (await rpc(S.auction, "match_or_create_vehicle", { p_vin: vinFor(6), p_lot_number: null, p_stock_number: stockFor(6), p_auction_source: null, p_fields: fields })).data.vehicle_id;
  createdVehicles.push(vOpen);
  const before = (await q("select transport_status from public.vehicles where id=$1", [vOpen]))[0].transport_status;
  const batch = await rpc(S.manager, "assign_carrier", { p_vehicle_ids: [vOpen, vehicleA], p_carrier_id: carrier, p_transport_price: 300 });
  check("batch with one closed vehicle is refused", batch.code === "P0001", `code=${batch.code}`);
  const after = (await q("select transport_status from public.vehicles where id=$1", [vOpen]))[0].transport_status;
  check("rollback: the open vehicle in the refused batch was NOT changed", before === after, `${before} -> ${after}`);
  const wrongRole = await rpc(S.dismantling, "assign_carrier", { p_vehicle_ids: [vOpen], p_carrier_id: carrier, p_transport_price: 300 });
  check("dismantling assign refused (role)", wrongRole.code === "42501");
}

// =========================== F. TRANSPORT STATUS TRANSITIONS ===========================
{
  const v = vC; // currently ASSIGNED
  let r = await rpc(S.auction, "update_transport_status", { p_vehicle_id: v, p_to_status: "IN_TRANSIT" });
  check("ASSIGNED -> IN_TRANSIT", r.data?.transport_status === "IN_TRANSIT", r.msg);
  r = await rpc(S.auction, "update_transport_status", { p_vehicle_id: v, p_to_status: "NEED_TRANSPORT" });
  check("illegal backwards move IN_TRANSIT -> NEED_TRANSPORT refused", r.code === "P0001", `code=${r.code}`);
  r = await rpc(S.auction, "update_transport_status", { p_vehicle_id: v, p_to_status: "IN_TRANSIT" });
  check("same status is an idempotent replay", r.data?.idempotent_replay === true);
  r = await rpc(S.auction, "update_transport_status", { p_vehicle_id: v, p_to_status: "PROBLEM", p_problem_note: "x" });
  check("PROBLEM needs a real note", r.code === "22023", `code=${r.code}`);
  r = await rpc(S.auction, "update_transport_status", { p_vehicle_id: v, p_to_status: "PROBLEM", p_problem_note: "Trailer breakdown" });
  check("raise PROBLEM with note", r.data?.transport_status === "PROBLEM", r.msg);
  r = await rpc(S.auction, "update_transport_status", { p_vehicle_id: v, p_to_status: "IN_TRANSIT" });
  const pr = (await q("select transport_status, transport_problem from public.vehicles where id=$1", [v]))[0];
  check("resolve PROBLEM back to IN_TRANSIT clears the problem", r.data?.transport_status === "IN_TRANSIT" && pr.transport_problem === null);
  r = await rpc(S.auction, "update_transport_status", { p_vehicle_id: v, p_to_status: "ARRIVED" });
  check("IN_TRANSIT -> ARRIVED", r.data?.transport_status === "ARRIVED", r.msg);
  r = await rpc(S.auction, "update_transport_status", { p_vehicle_id: v, p_to_status: "PROBLEM", p_problem_note: "too late" });
  check("ARRIVED cannot be moved to PROBLEM", r.code === "P0001", `code=${r.code}`);
  // READY_TO_POST needs a transport price; a fresh vehicle has none, so it must be refused.
  const fresh = (await rpc(S.auction, "match_or_create_vehicle", { p_vin: vinFor(9), p_lot_number: null, p_stock_number: stockFor(9), p_auction_source: null, p_fields: fields })).data.vehicle_id;
  createdVehicles.push(fresh);
  const nop = await rpc(S.auction, "update_transport_status", { p_vehicle_id: fresh, p_to_status: "READY_TO_POST" });
  check("READY_TO_POST refused without a transport price", nop.code === "P0001", `code=${nop.code}`);
}

// =========================== G. RECEIVING (4 photos, retry-safe, one receiver) ===========================
async function addArrivalPhotos(vehicleId, roles) {
  for (const role of roles) {
    await q(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, status, uploaded_by)
             values ('vehicle', $1, $2, 'original', 'operational-media', $3, 'image/jpeg', 'ready', null)`,
      [vehicleId, role, `test/${run}/${vehicleId}/${role}.jpg`]);
  }
}
async function cleanupMedia(vehicleId) { await q("delete from public.media_assets where owner_id=$1 and owner_type='vehicle'", [vehicleId]); }

const VR = (await rpc(S.auction, "match_or_create_vehicle", { p_vin: vinFor(7), p_lot_number: null, p_stock_number: stockFor(7), p_auction_source: null, p_fields: fields })).data.vehicle_id;
createdVehicles.push(VR);
{
  await addArrivalPhotos(VR, ["arrival_front", "arrival_rear", "arrival_left"]);
  let r = await rpc(S.receiving, "receive_vehicle", { p_vehicle_id: VR });
  check("receive refused with only 3 of 4 photos", r.code === "P0001" && /3 of 4/.test(r.msg), r.msg.slice(0, 70));
  await addArrivalPhotos(VR, ["arrival_right"]);
  r = await rpc(S.receiving, "receive_vehicle", { p_vehicle_id: VR });
  check("receive succeeds with all 4 photos", r.data?.receiving_status === "received", r.msg);
  const row = (await q("select receiving_status, received_by, received_at, status from public.vehicles where id=$1", [VR]))[0];
  check("receiving_status, received_by and received_at are written", row.receiving_status === "received" && row.received_by && row.received_at);
  const retry = await rpc(S.receiving, "receive_vehicle", { p_vehicle_id: VR });
  check("same employee retry is an idempotent replay", retry.data?.idempotent_replay === true);
  const other = await rpc(S.engineer_admin, "receive_vehicle", { p_vehicle_id: VR });
  check("a different employee cannot re-receive the vehicle", other.code === "P0001", `code=${other.code}`);
  const ev = (await q("select count(*)::int c from public.vehicle_events where vehicle_id=$1 and action='RECEIVED'", [VR]))[0].c;
  check("exactly one RECEIVED event after retries", ev === 1, `events=${ev}`);
}
{
  // Direct bypass: receiving employee may not set transport price or purchase accounting via the client.
  const r1 = await S.receiving.from("vehicles").update({ transport_price: 1 }).eq("id", VR).select("id");
  check("receiving direct update of transport_price is blocked", !!r1.error || (r1.data?.length ?? 0) === 0, r1.error?.message?.slice(0, 60) ?? "rows=0");
  const r2 = await S.receiving.from("vehicles").update({ purchase_price: 1 }).eq("id", VR).select("id");
  check("receiving direct update of purchase_price is blocked", !!r2.error || (r2.data?.length ?? 0) === 0, r2.error?.message?.slice(0, 60) ?? "rows=0");
}
{
  // Concurrency: two different employees confirm receipt of the same vehicle at once.
  const VC = (await rpc(S.auction, "match_or_create_vehicle", { p_vin: vinFor(8), p_lot_number: null, p_stock_number: stockFor(8), p_auction_source: null, p_fields: fields })).data.vehicle_id;
  createdVehicles.push(VC);
  await addArrivalPhotos(VC, ["arrival_front", "arrival_rear", "arrival_left", "arrival_right"]);
  const [a, b] = await Promise.all([
    rpc(S.receiving, "receive_vehicle", { p_vehicle_id: VC }),
    rpc(S.engineer_admin, "receive_vehicle", { p_vehicle_id: VC }),
  ]);
  const ok = [a, b].filter((r) => !r.error).length;
  check("parallel receive by two employees: exactly one wins", ok === 1, `ok=${ok}`);
  const ev = (await q("select count(*)::int c from public.vehicle_events where vehicle_id=$1 and action='RECEIVED'", [VC]))[0].c;
  check("parallel receive wrote exactly one RECEIVED event", ev === 1, `events=${ev}`);
}

// =========================== CLEANUP (DEV only) ===========================
{
  const ids = createdVehicles.filter(Boolean);
  for (const id of ids) await cleanupMedia(id);
  if (ids.length) {
    await db.query("delete from public.vehicle_events where vehicle_id = any($1::uuid[])", [ids]);
    await db.query("delete from public.vehicles where id = any($1::uuid[])", [ids]);
  }
  if (createdCarriers.length) await db.query("delete from public.carriers where id = any($1::uuid[])", [createdCarriers]);
  const left = (await q("select count(*)::int c from public.vehicles where auction_source=$1", [SRC]))[0].c;
  check("cleanup removed test vehicles", left === 0, `left=${left}`);
}
await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
