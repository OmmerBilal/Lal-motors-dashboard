// Module 15 — team management RPCs (migration 0044): role, status, invite, cancel, remove, day activity.
// Real sessions against DEV. Changes to seeded accounts are restored in a finally block. Invitations are cancelled.
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

const S = {};
for (const r of ["owner", "engineer_admin", "manager", "employee", "receiving"]) S[r] = await signIn(r);
const idOf = async (role) => (await q("select id from public.profiles where email=$1", [byRole[role].email]))[0].id;
const recvId = await idOf("receiving");
const ownerId = await idOf("owner");
const recvRole = (await q("select r.key from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=$1", [recvId])).map((r) => r.key);
const recvStatus = (await q("select account_status from public.profiles where id=$1", [recvId]))[0].account_status;
const runTag = crypto.randomUUID().slice(0, 6);

try {
  // ------------------------------------------------------------------ roles: only the owner manages accounts
  for (const role of ["engineer_admin", "manager", "employee"]) {
    check(`${role} denied role change`, DENIED(await rpc(S[role], "team_set_role", { p_profile: recvId, p_role_key: "employee" })));
    check(`${role} denied account status change`, DENIED(await rpc(S[role], "team_set_account_status", { p_profile: recvId, p_status: "disabled" })));
    check(`${role} denied invitation`, DENIED(await rpc(S[role], "team_invite_member", { p_email: `x${runTag}@example.com`, p_name: "Test Person", p_role_key: "employee", p_client_request_id: crypto.randomUUID() })));
    check(`${role} denied day activity`, DENIED(await rpc(S[role], "employee_day_activity", { p_profile: recvId, p_date: "2026-01-01" })));
  }
  check("anonymous denied role change", !!(await rpc(newClient(), "team_set_role", { p_profile: recvId, p_role_key: "employee" })).error);

  // ------------------------------------------------------------------ owner protections
  check("owner cannot change own role", (await rpc(S.owner, "team_set_role", { p_profile: ownerId, p_role_key: "employee" })).code === "22023");
  check("owner cannot disable own account", (await rpc(S.owner, "team_set_account_status", { p_profile: ownerId, p_status: "disabled" })).code === "22023");
  check("the owner role cannot be granted through the API", (await rpc(S.owner, "team_set_role", { p_profile: recvId, p_role_key: "owner" })).code === "42501");
  check("an unknown role key is refused", (await rpc(S.owner, "team_set_role", { p_profile: recvId, p_role_key: "superadmin" })).code === "22023");
  check("an unknown account is refused", (await rpc(S.owner, "team_set_role", { p_profile: crypto.randomUUID(), p_role_key: "employee" })).code === "22023");

  // ------------------------------------------------------------------ role change on a seeded account (restored after)
  const same = await rpc(S.owner, "team_set_role", { p_profile: recvId, p_role_key: recvRole[0] ?? "receiving" });
  check("setting the same role changes nothing", !same.error && same.data?.changed === false, same.msg);
  const other = recvRole[0] === "employee" ? "receiving" : "employee";
  const change = await rpc(S.owner, "team_set_role", { p_profile: recvId, p_role_key: other });
  check("owner changes a role; the database reflects it", !change.error && change.data?.changed === true && (await q("select r.key from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=$1", [recvId]))[0].key === other, change.msg);
  const audited = (await q("select count(*)::int c from public.audit_logs where action='team.role.changed' and entity_id=$1", [recvId]))[0].c;
  check("role change is audited", audited >= 1, `audit rows=${audited}`);

  // ------------------------------------------------------------------ disable: the account really loses access
  try {
    const dis = await rpc(S.owner, "team_set_account_status", { p_profile: recvId, p_status: "disabled" });
    check("owner disables an account", !dis.error && dis.data?.changed === true, dis.msg);
    const recvClient = await signIn("receiving").catch(() => null);
    // A disabled account either cannot sign in, or signs in and is refused by every protected RPC.
    const blockedBy = recvClient ? await rpc(recvClient, "scrap_driver_list_loads", { p_limit: 1 }) : null;
    check("a disabled account has no protected access", !recvClient || (!!blockedBy && DENIED(blockedBy)), blockedBy ? (blockedBy.msg || blockedBy.code) : "sign-in refused");
    check("disabling is audited", (await q("select count(*)::int c from public.audit_logs where action='team.account_status.changed' and entity_id=$1 and changes->>'to'='disabled'", [recvId]))[0].c >= 1);
    const reenable = await rpc(S.owner, "team_set_account_status", { p_profile: recvId, p_status: "active" });
    check("owner re-enables the account", !reenable.error && reenable.data?.changed === true, reenable.msg);
  } finally {
    await rpc(S.owner, "team_set_account_status", { p_profile: recvId, p_status: recvStatus === "removed" ? "active" : recvStatus });
    await rpc(S.owner, "team_set_role", { p_profile: recvId, p_role_key: recvRole[0] ?? "receiving" });
  }
  const restoredRole = (await q("select r.key from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=$1", [recvId])).map((r) => r.key);
  check("seeded account role is restored after the test", restoredRole.join(",") === recvRole.join(","), restoredRole.join(","));

  // ------------------------------------------------------------------ remove needs a reason
  check("removing a member needs a reason", (await rpc(S.owner, "team_remove_member", { p_profile: recvId, p_reason: "no" })).code === "22023");
  check("engineer admin cannot remove a member", DENIED(await rpc(S.engineer_admin, "team_remove_member", { p_profile: recvId, p_reason: "a valid reason here" })));

  // ------------------------------------------------------------------ invitations: validated, replay-safe, cancellable
  const email = `team-test-${runTag}@example.com`;
  check("invite needs a valid email", (await rpc(S.owner, "team_invite_member", { p_email: "not-an-email", p_name: "Test Person", p_role_key: "employee", p_client_request_id: crypto.randomUUID() })).code === "22023");
  check("invite needs a name", (await rpc(S.owner, "team_invite_member", { p_email: email, p_name: "x", p_role_key: "employee", p_client_request_id: crypto.randomUUID() })).code === "22023");
  check("owner role cannot be invited", (await rpc(S.owner, "team_invite_member", { p_email: email, p_name: "Test Person", p_role_key: "owner", p_client_request_id: crypto.randomUUID() })).code === "42501");
  check("an existing account email cannot be invited again", (await rpc(S.owner, "team_invite_member", { p_email: byRole.receiving.email, p_name: "Test Person", p_role_key: "employee", p_client_request_id: crypto.randomUUID() })).code === "22023");
  const invReq = crypto.randomUUID();
  const inv = await rpc(S.owner, "team_invite_member", { p_email: email, p_name: "Test Person", p_role_key: "employee", p_client_request_id: invReq });
  check("invitation recorded as pending, email delivery NOT CONNECTED", !inv.error && inv.data?.email_delivery === "not_connected" && inv.data?.replay === false, inv.msg);
  const invId = inv.data?.id;
  const replay = await rpc(S.owner, "team_invite_member", { p_email: email, p_name: "Test Person", p_role_key: "employee", p_client_request_id: invReq });
  check("invite replay returns the same record", !replay.error && replay.data?.id === invId && replay.data?.replay === true);
  check("a second pending invite for the same email is refused", (await rpc(S.owner, "team_invite_member", { p_email: email, p_name: "Test Person", p_role_key: "employee", p_client_request_id: crypto.randomUUID() })).code === "22023");
  const pendingList = (await rpc(S.owner, "team_list_invites", {})).data;
  check("pending invite appears in the real invite list", pendingList.some((i) => i.id === invId));
  const cancel = await rpc(S.owner, "team_cancel_invite", { p_invite: invId });
  check("pending invite is cancelled", !cancel.error && cancel.data?.status === "cancelled", cancel.msg);
  check("cancelling again changes nothing", (await rpc(S.owner, "team_cancel_invite", { p_invite: invId })).data?.changed === false);
  check("cancelled invite leaves the pending list", !((await rpc(S.owner, "team_list_invites", {})).data ?? []).some((i) => i.id === invId));
  check("invitation is audited", (await q("select count(*)::int c from public.audit_logs where action='team.invite.created' and entity_id=$1", [invId]))[0].c === 1);

  // ------------------------------------------------------------------ day activity: real rows, owner only, future refused
  const today = (await q("select public._scrap_business_date()::text d"))[0].d;
  check("day activity for a future day is refused", (await rpc(S.owner, "employee_day_activity", { p_profile: recvId, p_date: (await q("select (public._scrap_business_date()+1)::text d"))[0].d })).code === "22023");
  const day = await rpc(S.owner, "employee_day_activity", { p_profile: recvId, p_date: today });
  check("day activity returns parts and actions arrays", !day.error && Array.isArray(day.data?.parts) && Array.isArray(day.data?.actions), day.msg);
  const partIds = (day.data?.parts ?? []).map((p) => p.id);
  const realParts = partIds.length ? Number((await q("select count(*)::int c from public.parts where id = any($1::uuid[])", [partIds]))[0].c) : 0;
  check("every day-activity part is a real parts row", realParts === partIds.length, `real=${realParts} shown=${partIds.length}`);
  check("day activity carries no price or payment fields", (day.data?.parts ?? []).every((p) => !("price" in p) && !("core_charge" in p)));
} finally {
  // Invitations created by this run are cancelled above; nothing else is left changed.
}

console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail ? 1 : 0);
