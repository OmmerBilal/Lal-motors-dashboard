// Module 15 — team directory, pending invites, employee activity, recent activity and management operations
// (migration 0043). Authorization, range guards, aggregates compared with independent queries, and source-row checks.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const S = {};
for (const r of ["owner", "engineer_admin", "manager", "employee", "container_loading", "scrap_driver", "export_manager"]) S[r] = await signIn(r);
const today = (await q("select public._scrap_business_date()::text d"))[0].d;
const from = (await q("select (public._scrap_business_date() - 6)::text d"))[0].d;

// ------------------------------------------------------------------ authorization (owner only, like /team)
for (const role of ["engineer_admin", "manager", "employee", "container_loading", "scrap_driver", "export_manager"]) {
  check(`${role} denied the team directory`, DENIED(await rpc(S[role], "team_list_members", {})));
  check(`${role} denied pending invites`, DENIED(await rpc(S[role], "team_list_invites", {})));
  check(`${role} denied employee activity`, DENIED(await rpc(S[role], "employee_activity_summary", { p_from: from, p_to: today })));
  check(`${role} denied management operations`, DENIED(await rpc(S[role], "management_operations_summary", { p_from: from, p_to: today })));
}
const anon = newClient();
check("anonymous denied the team directory", !!(await rpc(anon, "team_list_members", {})).error);
check("owner reads the team directory", !(await rpc(S.owner, "team_list_members", {})).error);

// ------------------------------------------------------------------ range guards
check("activity range longer than a year is refused", (await rpc(S.owner, "employee_activity_summary", { p_from: "2020-01-01", p_to: "2026-01-01" })).code === "22023");
check("activity end before start is refused", (await rpc(S.owner, "employee_activity_summary", { p_from: today, p_to: from })).code === "22023");
check("activity with one missing bound is refused", (await rpc(S.owner, "employee_activity_summary", { p_from: from, p_to: null })).code === "22023");

// ------------------------------------------------------------------ team directory: real profiles and roles
const members = (await rpc(S.owner, "team_list_members", {})).data;
const dbProfiles = Number((await q("select count(*)::int c from public.profiles"))[0].c);
check("directory lists every profile from the database", members.length === dbProfiles, `rows=${members.length} db=${dbProfiles}`);
const dbActive = Number((await q("select count(*)::int c from public.profiles where account_status='active'"))[0].c);
check("active count matches the database", members.filter((m) => m.account_status === "active").length === dbActive);
const ALLOWED_KEYS = ["id", "name", "email", "account_status", "roles", "last_seen_at", "created_at"];
check("directory rows expose only whitelisted fields (no phone, no auth data)", members.every((m) => Object.keys(m).every((k) => ALLOWED_KEYS.includes(k))), members.flatMap((m) => Object.keys(m).filter((k) => !ALLOWED_KEYS.includes(k))).join(","));
check("directory roles match user_roles for a sample account", (() => {
  const m = members.find((x) => x.email === byRole.scrap_driver.email);
  return !!m && m.roles.includes("scrap_driver");
})());
check("every account status is a known status", members.every((m) => ["active", "disabled", "removed"].includes(m.account_status)));

// ------------------------------------------------------------------ pending invites: real table, real count
const invites = (await rpc(S.owner, "team_list_invites", {})).data;
const dbPending = Number((await q("select count(*)::int c from public.user_invites where status='pending'"))[0].c);
check("pending invites come from user_invites (count matches)", invites.length === dbPending, `rows=${invites.length} db=${dbPending}`);
check("invites carry a role key and an inviter name", invites.every((i) => i.role && i.invited_by_name));

// ------------------------------------------------------------------ employee activity: aggregates vs independent queries
const act = (await rpc(S.owner, "employee_activity_summary", { p_from: from, p_to: today })).data;
check("activity excludes the owner", !act.some((a) => a.roles.includes("owner")));
const eventsDb = Number((await q(`select count(*)::int c from public.vehicle_events e join public.profiles p on p.id = e.actor_id
  where (e.created_at at time zone 'America/New_York')::date between $1::date and $2::date
    and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.id and r.key = 'owner')`, [from, today]))[0].c);
check("vehicle events in range equal the database count", act.reduce((n, a) => n + a.vehicle_events, 0) === eventsDb, `rows=${act.reduce((n, a) => n + a.vehicle_events, 0)} db=${eventsDb}`);
const capturedDb = Number((await q(`select count(*)::int c from public.parts pt join public.profiles p on p.id = pt.captured_by
  where (pt.created_at at time zone 'America/New_York')::date between $1::date and $2::date
    and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.id and r.key = 'owner')`, [from, today]))[0].c);
check("parts captured in range equal the database count", act.reduce((n, a) => n + a.parts_captured, 0) === capturedDb, `kpi=${act.reduce((n, a) => n + a.parts_captured, 0)} db=${capturedDb}`);
check("activity counts are non-negative integers", act.every((a) => Object.entries(a).filter(([k]) => !["profile_id", "name", "account_status", "roles"].includes(k)).every(([, v]) => Number.isInteger(v) && v >= 0)));
const emptyAct = (await rpc(S.owner, "employee_activity_summary", { p_from: "2000-01-01", p_to: "2000-01-02" })).data;
check("empty period returns zero counts, not errors", emptyAct.every((a) => a.vehicle_events === 0 && a.parts_captured === 0 && a.scrap_loads === 0));

// ------------------------------------------------------------------ recent activity: real audit rows, ordered, bounded
const recent = (await rpc(S.owner, "employee_recent_activity", { p_from: from, p_to: today, p_limit: 10 })).data;
check("recent activity is limited to the requested count", recent.length <= 10, `rows=${recent.length}`);
check("recent activity is newest first", recent.every((r, i) => i === 0 || new Date(recent[i - 1].created_at) >= new Date(r.created_at)));
const ids = recent.map((r) => r.id);
const realRows = ids.length ? Number((await q("select count(*)::int c from public.audit_logs where id = any($1::uuid[])", [ids]))[0].c) : 0;
check("every recent activity row references a real audit row", realRows === ids.length, `real=${realRows} shown=${ids.length}`);
check("recent activity carries no change payload", recent.every((r) => !("changes" in r) && !("reason" in r)));
check("recent activity limit is capped at 100", (await rpc(S.owner, "employee_recent_activity", { p_from: from, p_to: today, p_limit: 999 })).data.length <= 100);
const actorRows = recent.length ? recent[0].actor_id : null;
if (actorRows) {
  const byActor = (await rpc(S.owner, "employee_recent_activity", { p_from: from, p_to: today, p_limit: 50, p_actor: actorRows })).data;
  check("activity filter by employee returns only that employee", byActor.every((r) => r.actor_id === actorRows));
}
check("empty period has no recent activity", (await rpc(S.owner, "employee_recent_activity", { p_from: "2000-01-01", p_to: "2000-01-02", p_limit: 10 })).data.length === 0);

// ------------------------------------------------------------------ management operations: counts vs database
const ops = (await rpc(S.owner, "management_operations_summary", { p_from: from, p_to: today })).data;
const outDb = Number((await q("select count(*)::int c from public.parts where status='approved' and quantity=0"))[0].c);
check("out of stock count equals the database (approved, quantity 0)", ops.parts_out_of_stock === outDb, `kpi=${ops.parts_out_of_stock} db=${outDb}`);
const activeDb = Number((await q("select count(*)::int c from public.dismantling_sessions where status='active'"))[0].c);
check("active dismantling sessions equal the database", ops.dismantling_active_sessions === activeDb);
check("management operations has the expected keys", ["parts_review_queue", "scrap_awaiting_review", "containers_loading", "sales_open", "containers_on_the_way"].every((k) => k in ops));

console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail ? 1 : 0);
