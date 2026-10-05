// Receive guard (0006 + 0059): the server refuses to receive a dismantled or closed vehicle, and an eligible vehicle
// without the four arrival photos. Calls run as the receiving role through supabase-js. Every call is refused, so
// nothing is written. Uses existing DEV vehicles that match each case.
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

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const { error: signError } = await c.auth.signInWithPassword({ email: byRole.receiving.email, password: byRole.receiving.password });
if (signError) throw new Error("sign-in receiving: " + signError.message);

const dismantled = (await db.query(`select id from public.vehicles where status='Dismantled' order by created_at desc limit 1`)).rows[0];
const closed = (await db.query(`select id from public.vehicles where closed_reason is not null and status <> 'Dismantled' order by created_at desc limit 1`)).rows[0];
const noPhotos = (await db.query(`select v.id from public.vehicles v where v.closed_reason is null and v.status <> 'Dismantled' and v.receiving_status='not_received' and (select count(distinct m.role) from public.media_assets m where m.owner_type='vehicle' and m.owner_id=v.id and m.variant='original' and m.status='ready' and m.role in ('arrival_front','arrival_rear','arrival_left','arrival_right')) < 4 order by v.created_at desc limit 1`)).rows[0];

const snapshot = async (id) => (await db.query("select receiving_status, status, closed_reason, received_by, received_at from public.vehicles where id=$1", [id])).rows[0];

if (dismantled) {
  const before = await snapshot(dismantled.id);
  const r = await c.rpc("receive_vehicle", { p_vehicle_id: dismantled.id });
  const after = await snapshot(dismantled.id);
  check("dismantled vehicle is refused by the server", !!r.error && /dismantled/.test(r.error.message), r.error?.message ?? "no error");
  check("dismantled refusal changes nothing", JSON.stringify(before) === JSON.stringify(after));
} else {
  check("DEV has a dismantled vehicle to test", false, "none found");
}

if (closed) {
  const before = await snapshot(closed.id);
  const r = await c.rpc("receive_vehicle", { p_vehicle_id: closed.id });
  const after = await snapshot(closed.id);
  check("closed vehicle is refused by the server", !!r.error && /closed/.test(r.error.message), r.error?.message ?? "no error");
  check("closed refusal changes nothing", JSON.stringify(before) === JSON.stringify(after));
} else {
  check("DEV has a closed vehicle to test", false, "none found");
}

if (noPhotos) {
  const before = await snapshot(noPhotos.id);
  const r = await c.rpc("receive_vehicle", { p_vehicle_id: noPhotos.id });
  const after = await snapshot(noPhotos.id);
  check("eligible vehicle without four arrival photos is refused", !!r.error && /4 arrival photos/.test(r.error.message), r.error?.message ?? "no error");
  check("photo refusal changes nothing", JSON.stringify(before) === JSON.stringify(after));
} else {
  check("DEV has an eligible vehicle without four photos to test", false, "none found");
}

console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail === 0 ? 0 : 1);
