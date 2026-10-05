// Module 02 — Central Dispatch read models over the real DEV database, through supabase-js as real roles.
// Checks totals against a direct count, keyset paging without duplicates, filters, closed exclusion, RLS for roles
// without vehicle access, and the inbound list bound.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const pg = req("pg");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
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

// Direct counts (the truth to compare against).
const openTotal = Number((await q("select count(*)::int c from public.vehicles where closed_reason is null"))[0].c);
const groupsTruth = await q(`select count(distinct public._dispatch_group_key(pickup_location_name, pickup_address))::int c from public.vehicles where closed_reason is null`);

// Groups: page through with a small page size; every group appears once and the vehicle counts sum to the open total.
const seenKeys = new Set();
let after = null, total = 0, pages = 0, dupes = 0;
for (;;) {
  const { data, error } = await mgr.rpc("dispatch_pickup_groups", { p_tab: "byLocation", p_search: null, p_auction: null, p_after: after, p_limit: 3 });
  if (error) { check("group summary responds", false, error.message); break; }
  pages++;
  for (const g of data.groups) {
    const key = g.name + "|" + g.address;
    if (seenKeys.has(key)) dupes++;
    seenKeys.add(key);
    total += g.vehicle_count;
  }
  if (!data.has_more || pages > 500) break;
  after = data.next_after;
}
check("group summary pages cover every open vehicle exactly once", total === openTotal, `sum=${total} open=${openTotal} pages=${pages}`);
check("no group repeats across pages", dupes === 0, `dupes=${dupes}`);
check("group count matches the database", seenKeys.size === Number(groupsTruth[0].c), `groups=${seenKeys.size} truth=${groupsTruth[0].c}`);

// Vehicles of one group: keyset pages, no duplicates, equals the group's count, closed excluded.
const first = await mgr.rpc("dispatch_pickup_groups", { p_tab: "byLocation", p_search: null, p_auction: null, p_after: null, p_limit: 1 });
const g0 = first.data?.groups?.[0];
if (g0) {
  const groupKey = (await q(`select public._dispatch_group_key(pickup_location_name, pickup_address) k from public.vehicles where closed_reason is null and (coalesce(nullif(btrim(pickup_location_name),''),'(no pickup location)') = $1) and coalesce(btrim(pickup_address),'') = $2 limit 1`, [g0.name, g0.address]))[0]?.k;
  let cursorC = null, cursorI = null, got = [], more = true, guard = 0;
  while (more && guard++ < 200) {
    const { data, error } = await mgr.rpc("dispatch_group_vehicles", { p_group: groupKey, p_tab: "byLocation", p_search: null, p_auction: null, p_cursor_created_at: cursorC, p_cursor_id: cursorI, p_limit: 2 });
    if (error) { check("group vehicles respond", false, error.message); break; }
    got.push(...data.rows);
    more = data.has_more;
    if (data.rows.length) { const last = data.rows[data.rows.length - 1]; cursorC = last.created_at; cursorI = last.id; }
  }
  const ids = got.map((r) => r.id);
  check("group vehicles page without duplicates", new Set(ids).size === ids.length, `rows=${ids.length}`);
  check("group vehicles equal the group's count", ids.length === g0.vehicle_count, `rows=${ids.length} count=${g0.vehicle_count}`);
  check("group vehicles are never closed", got.every((r) => r.closed_reason === null));
  check("group vehicles all belong to that pickup location", got.every((r) => (r.pickup_location_name || "(no pickup location)") === g0.name || (!r.pickup_location_name && g0.name === "(no pickup location)")));
} else {
  check("at least one pickup group exists in DEV", false);
}

// Status tab filter.
const needs = await mgr.rpc("dispatch_pickup_groups", { p_tab: "NEED_TRANSPORT", p_search: null, p_auction: null, p_after: null, p_limit: 200 });
const needTotal = needs.data.groups.reduce((s, g) => s + g.vehicle_count, 0);
const needTruth = Number((await q("select count(*)::int c from public.vehicles where closed_reason is null and transport_status='NEED_TRANSPORT'"))[0].c);
check("status tab counts only that transport status", needTotal === needTruth && needs.data.groups.every((g) => g.vehicle_count === g.need_transport), `tab=${needTotal} truth=${needTruth}`);

// Search finds a known vehicle by VIN and returns nothing for a nonsense term.
const sample = (await q("select vin from public.vehicles where closed_reason is null and vin is not null and vin <> '' order by created_at desc limit 1"))[0];
if (sample) {
  const hit = await mgr.rpc("dispatch_pickup_groups", { p_tab: "all", p_search: sample.vin, p_auction: null, p_after: null, p_limit: 50 });
  check("search by VIN finds the vehicle", hit.data.groups.reduce((s, g) => s + g.vehicle_count, 0) >= 1);
}
const none = await mgr.rpc("dispatch_pickup_groups", { p_tab: "all", p_search: "zz-no-such-vehicle-zz", p_auction: null, p_after: null, p_limit: 50 });
check("search for nothing returns no groups", none.data.groups.length === 0);

// Inbound list: bounded and only not-received, assigned or in-transit vehicles.
const inbound = await mgr.rpc("dispatch_inbound_vehicles", { p_limit: 200 });
const inb = inbound.data ?? [];
check("inbound list is bounded to 200", inb.length <= 200, `rows=${inb.length}`);
check("inbound list holds only inbound vehicles", inb.every((r) => r.receiving_status === "not_received" && ["ASSIGNED", "IN_TRANSIT"].includes(r.transport_status) && r.closed_reason === null));

// Roles without vehicle access see nothing (RLS on vehicles), not someone else's data.
const sg = await scrap.rpc("dispatch_pickup_groups", { p_tab: "all", p_search: null, p_auction: null, p_after: null, p_limit: 50 });
const scrapSees = sg.error ? "error" : sg.data.groups.reduce((s, g) => s + g.vehicle_count, 0);
check("scrap driver sees no dispatch vehicles", scrapSees === 0 || scrapSees === "error", `seen=${scrapSees}`);
const si = await scrap.rpc("dispatch_inbound_vehicles", { p_limit: 200 });
check("scrap driver sees no inbound vehicles", (si.data ?? []).length === 0 || !!si.error);

console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail === 0 ? 0 : 1);
