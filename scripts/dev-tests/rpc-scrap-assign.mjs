// Scrap: office creates a load and assigns the Scrap Driver (migration 0070). Real signed-in sessions against DEV.
// Office calls use the manager and engineer_admin accounts; the driver account checks its own view. Loads are
// append-only history, so this run's load is left in place (the test never deletes history). No passwords are written here.
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
const byRole = Object.fromEntries(loadDevCredentials().map((u) => [u.role, u]));
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
const newClient = () => createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function signIn(role) {
  const u = byRole[role];
  if (!u?.password) throw new Error(`no password for ${role} (set the matching DEV_TEST_* variable)`);
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  return c;
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); return { data, error, code: error?.code ?? null, msg: error?.message ?? "" }; };
const DENIED = (r) => !!r.error && (r.code === "42501" || r.code === "28000");

const driverProfile = (await q("select id, name from public.profiles where email = $1", [byRole.scrap_driver.email]))[0];
const managerProfile = (await q("select id from public.profiles where email = $1", [byRole.manager.email]))[0];

const mgr = await signIn("manager");
const eng = await signIn("engineer_admin");
const drv = await signIn("scrap_driver");

// 1. Driver picker: active Scrap Drivers only; the office sees it, a driver does not.
const drivers = await rpc(mgr, "scrap_manager_list_drivers", {});
check("picker: office lists active Scrap Drivers", !drivers.error && Array.isArray(drivers.data) && drivers.data.some((d) => d.id === driverProfile.id));
check("picker: the list carries names and ids only", !drivers.error && drivers.data.every((d) => Object.keys(d).sort().join() === "id,name"));
const drvPicker = await rpc(drv, "scrap_manager_list_drivers", {});
check("picker: a Scrap Driver cannot list drivers (42501)", DENIED(drvPicker), drvPicker.code ?? "no error");

// 2. Create and assign.
const requestId = crypto.randomUUID();
const created = await rpc(mgr, "scrap_manager_create_load", { p_driver_id: driverProfile.id, p_client_request_id: requestId });
check("create: office creates a load assigned to the driver", !created.error && created.data?.driver_id === driverProfile.id, created.msg);
const loadId = created.data?.id;
check("create: status is new (operational, Open)", created.data?.status === "new");
check("create: created_by and assigned_at are recorded", created.data?.created_by === managerProfile.id && !!created.data?.assigned_at);
check("create: the driver name is visible to the office", created.data?.driver_name === driverProfile.name);
const ev = await q("select event_type, actor_id from public.scrap_load_events where scrap_load_id = $1 and event_type = 'load_created'", [loadId]);
check("create: history records load_created with the actor", ev.length === 1 && ev[0].actor_id === managerProfile.id);

const replay = await rpc(mgr, "scrap_manager_create_load", { p_driver_id: driverProfile.id, p_client_request_id: requestId });
check("create: the same request id replays the same load (no duplicate)", !replay.error && replay.data?.id === loadId);

const notDriver = await rpc(mgr, "scrap_manager_create_load", { p_driver_id: managerProfile.id, p_client_request_id: crypto.randomUUID() });
check("create: a user without the Scrap Driver role is refused (22023)", notDriver.code === "22023", notDriver.msg);
const drvCreate = await rpc(drv, "scrap_manager_create_load", { p_driver_id: driverProfile.id, p_client_request_id: crypto.randomUUID() });
check("create: a Scrap Driver cannot create a load for the office (42501)", DENIED(drvCreate), drvCreate.code ?? "no error");

// 3. Reassign: same driver is a no-op; the picker rule still holds.
const same = await rpc(eng, "scrap_manager_assign_driver", { p_load_id: loadId, p_driver_id: driverProfile.id });
check("assign: same driver is a no-op (no new event)", !same.error && same.data?.driver_id === driverProfile.id);
const evAfterSame = await q("select count(*)::int n from public.scrap_load_events where scrap_load_id = $1 and event_type = 'driver_reassigned'", [loadId]);
check("assign: no reassign event for a no-op", evAfterSame[0].n === 0);
const badAssign = await rpc(eng, "scrap_manager_assign_driver", { p_load_id: loadId, p_driver_id: managerProfile.id });
check("assign: a non-driver cannot be assigned (22023)", badAssign.code === "22023", badAssign.msg);
const drvAssign = await rpc(drv, "scrap_manager_assign_driver", { p_load_id: loadId, p_driver_id: driverProfile.id });
check("assign: a Scrap Driver cannot reassign (42501)", DENIED(drvAssign), drvAssign.code ?? "no error");

// 4. The assigned driver sees only their own loads, with no financial fields.
const list = await rpc(drv, "scrap_driver_list_loads", { p_limit: 50 });
const rows = list.data?.rows ?? [];
check("driver: the assigned load is listed", rows.some((r) => r.id === loadId), list.msg);
check("driver: every listed load is their own", rows.every((r) => r.driver_id === driverProfile.id));
const money = ["weight", "rate", "amount", "payment_id", "manager_notes", "open_discrepancies"];
check("driver: no financial or reconciliation fields", rows.every((r) => money.every((k) => !(k in r))));
const one = await rpc(drv, "scrap_driver_get_load", { p_load_id: loadId });
check("driver: the assigned load opens with assigned_at", !one.error && !!one.data?.assigned_at, one.msg);
const mgrView = await rpc(eng, "scrap_manager_get_load", { p_load_id: loadId });
check("office: get_load shows created_by_name and assigned_at", !mgrView.error && mgrView.data?.load?.created_by_name && mgrView.data?.load?.assigned_at, mgrView.msg);
const mgrOpen = await rpc(mgr, "scrap_manager_list_loads", { p_bucket: "open", p_from: null, p_to: null, p_driver: null, p_limit: 50, p_before_created: null, p_before_id: null });
check("office: the new load is in Open", !mgrOpen.error && JSON.stringify(mgrOpen.data ?? "").includes(loadId), mgrOpen.msg);

await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
