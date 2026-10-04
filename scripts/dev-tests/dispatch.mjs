// Central Dispatch tests (migration 0012): carrier write authority, dispatch counts against an
// independent SQL count, and one vehicle identity shared by intake and dispatch.
// Real signed-in sessions against DEV. Creates and removes its own rows.
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
const S = {};
for (const r of ["auction", "manager", "receiving", "dismantling", "scrap_driver"]) S[r] = await signIn(r);

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const tag = "DISPTEST-" + run;
const carrierIds = [];
const vehicleIds = [];

// 1. Carrier directory: only dispatch roles may write.
{
  const mk = (company) => ({ company, driver: "", phone: "", email: "", address: "", mc_dot: "", notes: "", active: true });
  const denied = await S.receiving.from("carriers").insert(mk(tag + " receiving")).select("id");
  check("receiving cannot add a carrier", !!denied.error || (denied.data?.length ?? 0) === 0, denied.error?.message?.slice(0, 60) ?? "rows=0");
  const denied2 = await S.dismantling.from("carriers").insert(mk(tag + " dismantling")).select("id");
  check("dismantling cannot add a carrier", !!denied2.error || (denied2.data?.length ?? 0) === 0);
  const ok = await S.manager.from("carriers").insert(mk(tag + " manager")).select("id").single();
  check("manager (dispatch role) can add a carrier", !ok.error && !!ok.data?.id, ok.error?.message ?? "");
  if (ok.data?.id) carrierIds.push(ok.data.id);
  const ok2 = await S.auction.from("carriers").insert(mk(tag + " auction")).select("id").single();
  check("auction (dispatch role) can add a carrier", !ok2.error && !!ok2.data?.id, ok2.error?.message ?? "");
  if (ok2.data?.id) carrierIds.push(ok2.data.id);
  const readRecv = await S.receiving.from("carriers").select("id").in("id", carrierIds);
  check("receiving may still read carriers (needed for receiving context)", (readRecv.data?.length ?? 0) === carrierIds.length);
  const scrapRead = await S.scrap_driver.from("carriers").select("id").in("id", carrierIds);
  check("scrap driver cannot read carriers", (scrapRead.data?.length ?? 0) === 0);
}

// 2. One vehicle identity: intake creates it, dispatch sees the same id.
const vin = ("1DS" + run + "00000001").slice(0, 17);
const fields = { year: 2018, make: "Toyota", model: "Camry", purchase_price: 700 };
const intake = await S.auction.rpc("match_or_create_vehicle", { p_vin: vin, p_lot_number: null, p_stock_number: "ST" + run, p_auction_source: null, p_fields: fields });
check("intake creates the vehicle", intake.data?.outcome === "created", intake.error?.message ?? "");
const vid = intake.data.vehicle_id;
vehicleIds.push(vid);
const sameInDispatch = await S.manager.rpc("list_vehicles", { p_stage: null, p_auction_source: null, p_search: vin, p_limit: 5, p_cursor_created_at: null, p_cursor_id: null, p_carrier_id: null });
check("dispatch-side read returns the SAME vehicle id (one identity)", sameInDispatch.data?.some((r) => r.id === vid), `rows=${sameInDispatch.data?.length}`);
const dup = await S.auction.rpc("match_or_create_vehicle", { p_vin: vin, p_lot_number: null, p_stock_number: "ST" + run, p_auction_source: null, p_fields: fields });
check("re-intake of the same vehicle does not duplicate", dup.data?.outcome === "existing" && dup.data.vehicle_id === vid);

// 3. Dispatch counts match an independent SQL count.
{
  const { data, error } = await S.manager.rpc("dispatch_stage_counts");
  const k = data?.[0];
  const want = (await q(`select
    count(*) filter (where closed_reason is null and transport_status='NEED_TRANSPORT')::int need,
    count(*) filter (where closed_reason is null and transport_status='POSTED_TO_CD')::int posted,
    count(*) filter (where closed_reason is null and transport_status='ASSIGNED')::int assigned,
    count(*) filter (where closed_reason is null and transport_status='IN_TRANSIT')::int transit,
    count(*) filter (where closed_reason is null and transport_status='ARRIVED')::int arrived,
    count(*) filter (where closed_reason is null and transport_status not in ('ARRIVED','PROBLEM') and (current_date-purchase_date)>=10)::int overdue,
    count(*) filter (where closed_reason is null and transport_status='PROBLEM')::int problems
    from public.vehicles`))[0];
  check("dispatch KPI counts match an independent count", !error && Number(k.need_transport) === want.need && Number(k.posted_to_cd) === want.posted && Number(k.assigned) === want.assigned && Number(k.in_transit) === want.transit && Number(k.arrived) === want.arrived && Number(k.overdue) === want.overdue && Number(k.problems) === want.problems, error?.message ?? JSON.stringify(k));
  const recv = await S.receiving.rpc("dispatch_stage_counts");
  check("receiving (vehicle staff) can read dispatch counts", !recv.error && Array.isArray(recv.data), recv.error?.message ?? "");
}

// 4. Dispatch flow on the same vehicle, with the carrier written through RPCs.
{
  const carrier = carrierIds[0];
  let r = await S.manager.rpc("update_transport_status", { p_vehicle_id: vid, p_to_status: "READY_TO_POST" });
  check("READY_TO_POST refused without a price", r.error?.code === "P0001", r.error?.message ?? "");
  r = await S.manager.rpc("assign_carrier", { p_vehicle_ids: [vid], p_carrier_id: carrier, p_transport_price: 350 });
  check("assign carrier with a price", r.data?.assigned === 1, r.error?.message ?? "");
  const st = await S.manager.rpc("update_transport_status", { p_vehicle_id: vid, p_to_status: "IN_TRANSIT" });
  check("ASSIGNED -> IN_TRANSIT", st.data?.transport_status === "IN_TRANSIT", st.error?.message ?? "");
  const receivingPrice = await S.receiving.from("vehicles").update({ transport_price: 1 }).eq("id", vid).select("id");
  check("receiving cannot change transport price directly", !!receivingPrice.error || (receivingPrice.data?.length ?? 0) === 0);
  const dispPrice = await S.dismantling.rpc("assign_carrier", { p_vehicle_ids: [vid], p_carrier_id: carrier, p_transport_price: 1 });
  check("dismantling cannot assign a carrier", dispPrice.error?.code === "42501", dispPrice.error?.code ?? "no error");
}

// 5. Per-vehicle prices in one atomic batch (assign_carrier_items).
{
  const mk = async (n) => (await S.auction.rpc("match_or_create_vehicle", { p_vin: ("1DP" + run + "0" + String(n).padStart(7, "0")).slice(0, 17), p_lot_number: null, p_stock_number: "PX" + run + n, p_auction_source: null, p_fields: fields })).data.vehicle_id;
  const a = await mk(1), b = await mk(2), c = await mk(3);
  vehicleIds.push(a, b, c);
  const carrier = carrierIds[0];
  const ok = await S.manager.rpc("assign_carrier_items", { p_carrier_id: carrier, p_items: [{ vehicle_id: a, transport_price: 111 }, { vehicle_id: b, transport_price: 222.5 }] });
  check("batch assigns each vehicle its own price", ok.data?.assigned === 2, ok.error?.message ?? "");
  const rows = await q("select id, transport_price from public.vehicles where id = any($1::uuid[]) order by transport_price", [[a, b]]);
  check("prices stored per vehicle (111 and 222.50)", rows.length === 2 && Number(rows[0].transport_price) === 111 && Number(rows[1].transport_price) === 222.5);
  // Rollback: c is valid but the batch also contains a closed vehicle, so nothing may change.
  await S.manager.rpc("close_vehicle", { p_vehicle_id: b, p_reason: "Other", p_note: "dispatch test closed" });
  const bad = await S.manager.rpc("assign_carrier_items", { p_carrier_id: carrier, p_items: [{ vehicle_id: c, transport_price: 50 }, { vehicle_id: b, transport_price: 60 }] });
  check("batch containing a closed vehicle is refused", bad.error?.code === "P0001", bad.error?.code ?? "no error");
  const cState = (await q("select transport_status, transport_price from public.vehicles where id=$1", [c]))[0];
  check("rollback: the valid vehicle in the refused batch is untouched", cState.transport_status === "NEED_TRANSPORT" && cState.transport_price === null, JSON.stringify(cState));
  const dupe = await S.manager.rpc("assign_carrier_items", { p_carrier_id: carrier, p_items: [{ vehicle_id: c, transport_price: 50 }, { vehicle_id: c, transport_price: 60 }] });
  check("duplicate vehicle in one batch is refused", dupe.error?.code === "22023", dupe.error?.code ?? "no error");
  const bad2 = await S.receiving.rpc("assign_carrier_items", { p_carrier_id: carrier, p_items: [{ vehicle_id: c, transport_price: 50 }] });
  check("receiving cannot use the per-vehicle batch", bad2.error?.code === "42501", bad2.error?.code ?? "no error");
  const negative = await S.manager.rpc("assign_carrier_items", { p_carrier_id: carrier, p_items: [{ vehicle_id: c, transport_price: -1 }] });
  check("negative price refused", negative.error?.code === "22023", negative.error?.code ?? "no error");
}

// Cleanup
{
  if (vehicleIds.length) {
    await db.query("delete from public.vehicle_events where vehicle_id = any($1::uuid[])", [vehicleIds]);
    await db.query("delete from public.vehicles where id = any($1::uuid[])", [vehicleIds]);
  }
  if (carrierIds.length) await db.query("delete from public.carriers where id = any($1::uuid[])", [carrierIds]);
  const left = (await q("select count(*)::int c from public.carriers where company like $1", [tag + "%"]))[0].c;
  check("cleanup removed test carriers", left === 0, `left=${left}`);
}
await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
