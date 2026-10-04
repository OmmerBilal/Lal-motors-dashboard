// Vehicle read-model tests (migration 0007): keyset pagination, KPI correctness, thumbnail join,
// search, and role visibility. Real signed-in sessions against DEV. Creates and removes its rows.
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

const auction = await signIn("auction");
const scrap = await signIn("scrap_driver");
const receiving = await signIn("receiving");

// Fixtures: 7 vehicles with a unique source tag, one closed, one with a thumbnail.
const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const SRC = "READTEST-" + run;
const fields = { year: 2020, make: "Honda", model: "Civic", purchase_price: 900 };
const ids = [];
for (let i = 0; i < 7; i++) {
  const vin = ("1RD" + run + String(i).padStart(8, "0")).slice(0, 17);
  const { data, error } = await auction.rpc("match_or_create_vehicle", { p_vin: vin, p_lot_number: "LOT" + run + i, p_stock_number: null, p_auction_source: SRC, p_fields: fields });
  if (error) throw new Error("fixture " + error.message);
  ids.push(data.vehicle_id);
}
const closedId = ids[0];
const mgr = await signIn("manager");
await mgr.rpc("close_vehicle", { p_vehicle_id: closedId, p_reason: "Other", p_note: "read model fixture" });
// Make one vehicle overdue (purchase 12 days ago) and one arrived.
await db.query("update public.vehicles set purchase_date = current_date - 12 where id = $1", [ids[1]]);
await db.query("update public.vehicles set transport_status = 'ARRIVED' where id = $1", [ids[2]]);
await db.query("update public.vehicles set transport_status = 'IN_TRANSIT' where id = $1", [ids[3]]);
// Thumbnail: a thumbnail media row linked from the vehicle.
const [thumb] = await q(`insert into public.media_assets (owner_type, owner_id, variant, bucket, storage_path, mime_type, status)
  values ('vehicle', $1, 'thumbnail', 'operational-media', $2, 'image/webp', 'ready') returning id`, [ids[4], `vehicle/${ids[4]}/thumb.webp`]);
await db.query("update public.vehicles set thumbnail_asset_id = $1 where id = $2", [thumb.id, ids[4]]);

// Expected stage per fixture computed by an independent SQL, not by the function under test.
const expectedAll = await q("select id, public.vehicle_stage(v) as stage from public.vehicles v where auction_source = $1", [SRC]);
const expectedCounts = await q(`select count(*)::int total,
  count(*) filter (where stage='waiting')::int waiting,
  count(*) filter (where stage='transit')::int transit,
  count(*) filter (where stage='available')::int available,
  count(*) filter (where stage='overdue')::int overdue,
  count(*) filter (where stage='closed')::int closed
  from (select public.vehicle_stage(v) stage from public.vehicles v) s`);

// 1. Keyset pagination returns every visible row exactly once, in order, with has_more correct.
{
  const seen = [];
  let cur = { created_at: null, id: null };
  let pages = 0, lastHasMore = true;
  while (lastHasMore && pages < 500) {
    const { data, error } = await auction.rpc("list_vehicles", { p_stage: null, p_auction_source: SRC, p_search: null, p_limit: 3, p_cursor_created_at: cur.created_at, p_cursor_id: cur.id, p_carrier_id: null });
    if (error) throw new Error(error.message);
    pages++;
    if (data.length > 3) { check("page never exceeds the limit", false, `len=${data.length}`); break; }
    for (const r of data) seen.push(r.id);
    lastHasMore = data.length > 0 && data[data.length - 1].has_more;
    if (data.length) cur = { created_at: data[data.length - 1].created_at, id: data[data.length - 1].id };
  }
  check("pagination returns exactly the fixture vehicles", seen.length === ids.length, `got=${seen.length} want=${ids.length}`);
  check("pagination has no duplicates", new Set(seen).size === seen.length);
  check("7 fixtures at 3 per page take exactly 3 pages (has_more ends the walk)", pages === 3, `pages=${pages}`);
  check("every fixture id appears in the paged results", ids.every((i) => seen.includes(i)));
}

// 2. KPI counts match an independent count over ALL vehicles.
{
  const { data, error } = await auction.rpc("vehicle_stage_counts");
  const k = data?.[0];
  check("KPI totals match independent SQL", !error && Number(k.total) === expectedCounts[0].total && Number(k.waiting) === expectedCounts[0].waiting && Number(k.transit) === expectedCounts[0].transit && Number(k.available) === expectedCounts[0].available && Number(k.overdue) === expectedCounts[0].overdue && Number(k.closed) === expectedCounts[0].closed, JSON.stringify(k) || error?.message);
}

// 3. Stage filter returns only that stage, matching the independent stage.
{
  const { data } = await auction.rpc("list_vehicles", { p_stage: "closed", p_auction_source: SRC, p_search: null, p_limit: 25, p_cursor_created_at: null, p_cursor_id: null });
  check("stage=closed returns only the closed fixture", data.length === 1 && data[0].id === closedId && data[0].stage === "closed");
  const ov = await auction.rpc("list_vehicles", { p_stage: "overdue", p_auction_source: SRC, p_search: null, p_limit: 25, p_cursor_created_at: null, p_cursor_id: null });
  const wantOv = expectedAll.filter((r) => r.stage === "overdue").map((r) => r.id);
  check("stage=overdue matches independent computation", ov.data.length === wantOv.length && ov.data.every((r) => wantOv.includes(r.id)), `got=${ov.data?.length} want=${wantOv.length}`);
  const av = await auction.rpc("list_vehicles", { p_stage: "available", p_auction_source: SRC, p_search: null, p_limit: 25, p_cursor_created_at: null, p_cursor_id: null });
  check("stage=available returns the arrived fixture", av.data.length === 1 && av.data[0].id === ids[2]);
}

// 4. Search finds by VIN and lot fragment.
{
  const vinFrag = ("1RD" + run).slice(0, 9);
  const s = await auction.rpc("list_vehicles", { p_stage: null, p_auction_source: SRC, p_search: vinFrag, p_limit: 25, p_cursor_created_at: null, p_cursor_id: null });
  check("search by VIN fragment finds all fixtures", s.data.length === ids.length, `got=${s.data.length}`);
  const lot = await auction.rpc("list_vehicles", { p_stage: null, p_auction_source: SRC, p_search: "LOT" + run + "3", p_limit: 25, p_cursor_created_at: null, p_cursor_id: null });
  check("search by lot number finds one vehicle", lot.data.length === 1 && lot.data[0].id === ids[3]);
}

// 5. Thumbnail: one join, thumbnail path only; vehicles without one get null.
{
  const { data } = await auction.rpc("list_vehicles", { p_stage: null, p_auction_source: SRC, p_search: null, p_limit: 25, p_cursor_created_at: null, p_cursor_id: null });
  const withThumb = data.find((r) => r.id === ids[4]);
  check("vehicle with thumbnail returns the thumbnail path", withThumb?.thumbnail_path === `vehicle/${ids[4]}/thumb.webp` && withThumb.thumbnail_bucket === "operational-media");
  const noThumb = data.find((r) => r.id === ids[5]);
  check("vehicle without thumbnail returns null path (no extra query needed)", noThumb?.thumbnail_path === null);
}

// 6. Role visibility: scrap driver sees no vehicles; receiving sees them.
{
  const s = await scrap.rpc("list_vehicles", { p_stage: null, p_auction_source: SRC, p_search: null, p_limit: 25, p_cursor_created_at: null, p_cursor_id: null });
  check("scrap driver sees zero vehicles through the read model", !s.error && s.data.length === 0, s.error?.message ?? `rows=${s.data?.length}`);
  const r = await receiving.rpc("list_vehicles", { p_stage: null, p_auction_source: SRC, p_search: null, p_limit: 25, p_cursor_created_at: null, p_cursor_id: null });
  check("receiving sees the fixtures", r.data?.length === ids.length, `rows=${r.data?.length}`);
}

// 8. Carrier filter + company name come from the database; filter options list the source.
{
  const car = (await q("insert into public.carriers (company, active) values ($1, true) returning id", ["READTEST carrier " + run]))[0].id;
  await db.query("update public.vehicles set carrier_id = $1 where id = $2", [car, ids[5]]);
  const cf = await auction.rpc("list_vehicles", { p_stage: null, p_auction_source: SRC, p_search: null, p_limit: 25, p_cursor_created_at: null, p_cursor_id: null, p_carrier_id: car });
  check("carrier filter returns only the assigned vehicle", cf.data?.length === 1 && cf.data[0].id === ids[5], cf.error?.message ?? "");
  check("list row carries the carrier company name", cf.data?.[0]?.carrier_company === "READTEST carrier " + run);
  const opts = await auction.rpc("vehicle_filter_options");
  check("filter options include this auction source and active carriers", !opts.error && opts.data.auction_sources.includes(SRC) && opts.data.carriers.some((c) => c.id === car), opts.error?.message ?? "");
  await db.query("update public.vehicles set carrier_id = null where id = $1", [ids[5]]);
  await db.query("delete from public.carriers where id = $1", [car]);
}

// 7. Index use for the default newest-first page (plan node must not be a full seq scan of a large table).
{
  // On ~10 rows the planner correctly prefers a seq scan. Prove the keyset index is usable by
  // disabling seq scan for this one transaction; production-size tables will use it by default.
  await db.query("begin");
  await db.query("set local enable_seqscan = off");
  const plan = await q("explain select id from public.vehicles order by created_at desc, id desc limit 25");
  await db.query("commit");
  const text = plan.map((p) => p["QUERY PLAN"]).join(" | ");
  check("keyset index vehicles_created_at_idx is usable for the default list", /Index (Only )?Scan/.test(text), text.slice(0, 140));
}

// Cleanup
{
  await db.query("update public.vehicles set thumbnail_asset_id = null where id = any($1::uuid[])", [ids]);
  await db.query("delete from public.media_assets where owner_id = any($1::uuid[])", [ids]);
  await db.query("delete from public.vehicle_events where vehicle_id = any($1::uuid[])", [ids]);
  await db.query("delete from public.vehicles where id = any($1::uuid[])", [ids]);
  const left = (await q("select count(*)::int c from public.vehicles where auction_source = $1", [SRC]))[0].c;
  check("cleanup removed read-model fixtures", left === 0, `left=${left}`);
}
await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
