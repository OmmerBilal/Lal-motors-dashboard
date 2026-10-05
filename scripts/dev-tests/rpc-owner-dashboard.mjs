// Module 14 — Owner Dashboard read models (migration 0042): authorization, range guards, and aggregates
// checked against independent database queries over the same range. Real sessions against DEV.
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
for (const r of ["owner", "engineer_admin", "manager", "export_manager", "container_loading", "employee", "scrap_driver", "receiving"]) S[r] = await signIn(r);

// Range: last 7 days in the yard's zone, and an empty historical range.
const today = (await q("select public._scrap_business_date()::text d"))[0].d;
const from = (await q("select (public._scrap_business_date() - 6)::text d"))[0].d;
const emptyFrom = "2000-01-01", emptyTo = "2000-01-02";

// Authorization: owner only (the route is owner-only).
for (const role of ["engineer_admin", "manager", "export_manager", "container_loading", "employee", "scrap_driver", "receiving"]) {
  check(`${role} denied owner dashboard summary`, DENIED(await rpc(S[role], "owner_dashboard_summary", { p_from: from, p_to: today })));
}
const anon = newClient();
check("anonymous denied owner dashboard summary", !!(await rpc(anon, "owner_dashboard_summary", { p_from: from, p_to: today })).error);
check("owner reads the summary", !(await rpc(S.owner, "owner_dashboard_summary", { p_from: from, p_to: today })).error);

// Range guards.
check("range longer than a year is refused", (await rpc(S.owner, "owner_dashboard_summary", { p_from: "2020-01-01", p_to: "2026-01-01" })).code === "22023");
check("end before start is refused", (await rpc(S.owner, "owner_dashboard_summary", { p_from: today, p_to: from })).code === "22023");
check("missing range is refused", (await rpc(S.owner, "owner_dashboard_activity", { p_from: null, p_to: today })).code === "22023");

// Summary: each figure compared with an independent query.
const sum = (await rpc(S.owner, "owner_dashboard_summary", { p_from: from, p_to: today })).data;
const totalVehicles = Number((await q("select count(*)::int c from public.vehicles"))[0].c);
const stageTotal = Object.values(sum.stage_counts).reduce((n, x) => n + Number(x), 0);
check("stage counts add up to every vehicle", stageTotal === totalVehicles, `stages=${stageTotal} vehicles=${totalVehicles}`);
check("KPI total vehicles equals the database count", sum.kpis.total_vehicles === totalVehicles);
const pulled = Number((await q(`select count(*)::int c from public.vehicle_events where action='PART_REMOVED' and (created_at at time zone 'America/New_York')::date between $1::date and $2::date`, [from, today]))[0].c);
check("parts pulled in range equals the database event count", sum.kpis.parts_pulled === pulled, `kpi=${sum.kpis.parts_pulled} db=${pulled}`);
const conv = Number((await q(`select count(*)::int c from public.vehicle_events where action='PART_REMOVED' and lower(coalesce(part_type,'')) like '%converter%' and (created_at at time zone 'America/New_York')::date between $1::date and $2::date`, [from, today]))[0].c);
check("converters in range equal the database count", sum.kpis.converters === conv, `kpi=${sum.kpis.converters} db=${conv}`);
const loadsRange = Number((await q("select count(*)::int c from public.scrap_loads where load_date between $1::date and $2::date", [from, today]))[0].c);
check("scrap loads in range equal the database count", sum.kpis.scrap_loads === loadsRange, `kpi=${sum.kpis.scrap_loads} db=${loadsRange}`);
const shipped = Number((await q("select count(*)::int c from public.container_jobs where status in ('on_the_way','closed')"))[0].c);
check("containers shipped equal the database count", sum.kpis.containers_shipped === shipped);
const exIds = sum.exceptions.map((e) => e.id);
check("exceptions are the five dashboard rules, from the database", ["overdue", "needsAttention", "highValue", "converters", "awaitingDispatch"].every((id) => exIds.includes(id)), exIds.join(","));
const overdue = Number((await q("select count(*)::int c from public.vehicles v where public._vehicle_stage(v.status) <> 'completed' and (current_date - v.created_at::date) >= 40"))[0].c);
check("overdue exception equals the database count", sum.exceptions.find((e) => e.id === "overdue").count === overdue, `kpi=${sum.exceptions.find((e) => e.id === "overdue").count} db=${overdue}`);
check("notification count is a non-negative number", Number.isInteger(sum.notification_count) && sum.notification_count >= 0);

// Empty range: zeros and no error, never a fake positive.
const empty = await rpc(S.owner, "owner_dashboard_summary", { p_from: emptyFrom, p_to: emptyTo });
check("empty historical range returns zeros, not errors", !empty.error && empty.data?.kpis?.parts_pulled === 0 && empty.data?.kpis?.scrap_loads === 0, empty.msg);
const emptyAct = await rpc(S.owner, "owner_dashboard_activity", { p_from: emptyFrom, p_to: emptyTo, p_limit: 8 });
check("empty range has no activity rows", !emptyAct.error && emptyAct.data?.length === 0);

// Employees: owner excluded; actions equal the database count for the range.
const emp = (await rpc(S.owner, "owner_dashboard_employees", { p_from: from, p_to: today })).data;
check("employee overview excludes the owner", !emp.some((e) => e.role.split(", ").includes("owner")));
const actionsDb = Number((await q(`select count(*)::int c from public.vehicle_events e join public.profiles p on p.id=e.actor_id
  where (e.created_at at time zone 'America/New_York')::date between $1::date and $2::date
    and not exists (select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=p.id and r.key='owner')`, [from, today]))[0].c);
const actionsKpi = emp.reduce((n, e) => n + e.actions, 0);
check("employee actions in range equal the database count", actionsKpi === actionsDb, `rows=${actionsKpi} db=${actionsDb}`);
check("employee rows carry no financial fields", emp.every((e) => !("amount" in e) && !("balance" in e) && !("payment" in e)));
check("employees are denied to non-owners", DENIED(await rpc(S.manager, "owner_dashboard_employees", { p_from: from, p_to: today })));

// Activity: bounded, newest first, real events only.
const act = (await rpc(S.owner, "owner_dashboard_activity", { p_from: from, p_to: today, p_limit: 8 })).data;
check("recent activity is limited to the requested count", act.length <= 8, `rows=${act.length}`);
check("recent activity is newest first", act.every((r, i) => i === 0 || new Date(act[i - 1].created_at) >= new Date(r.created_at)));
check("recent activity rows carry an action and an actor", act.every((r) => r.action && r.actor_name));
check("activity limit is capped at 25", (await rpc(S.owner, "owner_dashboard_activity", { p_from: from, p_to: today, p_limit: 500 })).data.length <= 25);
check("activity is denied to non-owners", DENIED(await rpc(S.employee, "owner_dashboard_activity", { p_from: from, p_to: today, p_limit: 8 })));

console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail ? 1 : 0);
