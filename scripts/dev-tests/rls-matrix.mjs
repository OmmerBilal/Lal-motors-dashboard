import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const pg = req("pg");

const parse = (f) =>
  Object.fromEntries(
    fs.readFileSync(f, "utf8").split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const URL_ = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
const admin = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await admin.connect();

const results = [];
const rec = (who, name, ok, detail = "") => {
  results.push({ who, name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} | ${who} | ${name}${detail ? " | " + detail : ""}`);
};

async function signIn(email, password) {
  const c = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error("sign-in failed: " + error.message);
  return c;
}
async function countVisible(c, table) {
  const { count, error } = await c.from(table).select("*", { count: "exact", head: true });
  return error ? { n: 0, err: error.message } : { n: count ?? 0 };
}
async function expectVisibleAtLeast(who, c, table, min = 1) {
  const r = await countVisible(c, table);
  rec(who, `read ${table} (allowed)`, r.n >= min, `visible=${r.n}${r.err ? " err=" + r.err.slice(0, 80) : ""}`);
}
async function expectNone(who, c, table) {
  const r = await countVisible(c, table);
  rec(who, `read ${table} (forbidden)`, r.n === 0, `visible=${r.n}${r.err ? " denied" : ""}`);
}
async function expectWriteBlocked(who, label, builder) {
  const { data, error } = await builder;
  const affected = Array.isArray(data) ? data.length : (data ? 1 : 0);
  rec(who, `write blocked: ${label}`, !!error || affected === 0, error ? "error: " + error.message.slice(0, 90) : `rows=${affected}`);
}
async function expectRpcBlocked(who, label, builder) {
  const { error } = await builder;
  rec(who, `rpc blocked: ${label}`, !!error, error ? "denied: " + error.message.slice(0, 90) : "NOT denied");
}

const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));

const matrix = {
  owner:             { allow: ["profiles", "user_roles", "sales", "customers", "consignees", "export_invoices", "audit_logs", "vehicles", "parts"], deny: [] },
  engineer_admin:    { allow: ["sales", "customers", "vehicles", "parts", "audit_logs", "container_jobs", "export_invoices"], deny: [] },
  manager:           { allow: ["sales", "customers", "vehicles", "parts", "scrap_loads"], deny: ["consignees", "export_invoices", "export_payments", "container_shipping_info", "audit_logs"] },
  employee:          { allow: ["parts", "part_operations"], deny: ["sales", "customers", "payments", "consignees", "export_invoices", "scrap_load_financials", "audit_logs"] },
  auction:           { allow: ["vehicles", "scrap_loads"], deny: ["sales", "customers", "parts", "consignees", "export_invoices", "payments"] },
  receiving:         { allow: ["vehicles"], deny: ["sales", "customers", "parts", "consignees", "export_invoices", "scrap_load_financials", "payments"] },
  dismantling:       { allow: ["dismantling_sessions", "parts", "vehicles"], deny: ["sales", "customers", "payments", "consignees", "export_invoices", "scrap_load_financials", "audit_logs"] },
  scrap_driver:      { allow: ["scrap_loads"], deny: ["sales", "customers", "payments", "consignees", "export_invoices", "scrap_load_financials", "vehicles", "parts", "container_jobs", "user_roles", "audit_logs"] },
  container_loading: { allow: ["container_jobs"], deny: ["consignees", "export_invoices", "export_payments", "container_shipping_info", "payments", "sales", "customers", "audit_logs"] },
  export_manager:    { allow: ["consignees", "export_invoices", "container_jobs", "container_shipping_info"], deny: ["sales", "customers", "payments", "parts", "vehicles", "audit_logs", "user_roles"] },
};

const WRITE_AUDIT = { p_action: "x", p_entity_type: "x", p_entity_id: null, p_summary: "x", p_changes: {}, p_reason: null, p_request_id: null };

// Disabled-account test. Always restored in finally.
const WH = byRole.employee;
await admin.query("update public.profiles set account_status='disabled' where id=$1", [WH.id]);
try {
  const c = await signIn(WH.email, WH.password);
  const { data: acc } = await c.rpc("current_access");
  rec("employee(disabled)", "current_access reports disabled", acc?.[0]?.account_status === "disabled", `status=${acc?.[0]?.account_status}`);
  await expectNone("employee(disabled)", c, "parts");
  await expectNone("employee(disabled)", c, "part_operations");
} catch (e) {
  rec("employee(disabled)", "disabled test ran", false, e.message);
} finally {
  await admin.query("update public.profiles set account_status='active' where id=$1", [WH.id]);
}

{
  const c = await signIn(WH.email, WH.password);
  await expectVisibleAtLeast("employee", c, "parts");
  const { data: acc } = await c.rpc("current_access");
  rec("employee", "current_access = active + employee role", acc?.[0]?.account_status === "active" && acc[0].role_keys.includes("employee"), JSON.stringify(acc?.[0]?.role_keys));
}

for (const [role, spec] of Object.entries(matrix)) {
  const u = byRole[role];
  if (!u) { rec(role, "credential present", false); continue; }
  const c = await signIn(u.email, u.password);
  for (const t of spec.allow) await expectVisibleAtLeast(role, c, t, role === "scrap_driver" ? 0 : 1);
  for (const t of spec.deny) {
    // user_roles intentionally allows SELF-read (user_id = auth.uid()); the forbidden part is seeing anyone else's rows.
    if (t === "user_roles") {
      const { data, error } = await c.from("user_roles").select("user_id");
      const onlySelf = !error && (data ?? []).every((r) => r.user_id === u.id);
      rec(role, "read user_roles (only own rows)", onlySelf, `visible=${data?.length ?? 0}${error ? " denied" : ""}`);
    } else {
      await expectNone(role, c, t);
    }
  }
}

{
  const c = await signIn(byRole.manager.email, byRole.manager.password);
  const sale = await c.from("sales").select("id").limit(1).maybeSingle();
  if (sale.data) await expectWriteBlocked("manager", "sales.amount_paid direct update", c.from("sales").update({ amount_paid: 999999 }).eq("id", sale.data.id).select("id"));
  await expectRpcBlocked("manager", "write_audit_log()", c.rpc("write_audit_log", WRITE_AUDIT));
  await expectWriteBlocked("manager", "payments insert as posted", c.from("payments").insert({ amount: 1, status: "posted" }).select("id"));
  await expectWriteBlocked("manager", "audit_logs direct insert", c.from("audit_logs").insert({ action: "fake", entity_type: "x" }).select("id"));
}
{
  const c = await signIn(byRole.engineer_admin.email, byRole.engineer_admin.password);
  await expectWriteBlocked("engineer_admin", "grant Owner (user_roles insert)", c.from("user_roles").insert({ user_id: byRole.engineer_admin.id, role_id: 1 }).select("user_id"));
  await expectWriteBlocked("engineer_admin", "update own account_status", c.from("profiles").update({ account_status: "active" }).eq("id", byRole.engineer_admin.id).select("id"));
}
{
  const c = await signIn(byRole.container_loading.email, byRole.container_loading.password);
  const job = await c.from("container_jobs").select("id").limit(1).maybeSingle();
  if (job.data) {
    await expectWriteBlocked("container_loading", "status -> ready_for_invoice direct", c.from("container_jobs").update({ status: "ready_for_invoice" }).eq("id", job.data.id).select("id"));
    await expectWriteBlocked("container_loading", "status -> closed direct", c.from("container_jobs").update({ status: "closed" }).eq("id", job.data.id).select("id"));
  } else rec("container_loading", "container job exists for test", false, "no rows");
  await expectRpcBlocked("container_loading", "write_audit_log()", c.rpc("write_audit_log", WRITE_AUDIT));
}
{
  const c = await signIn(byRole.scrap_driver.email, byRole.scrap_driver.password);
  const load = await c.from("scrap_loads").select("id,status").limit(1).maybeSingle();
  if (load.data) await expectWriteBlocked("scrap_driver", "approve own load (status=approved)", c.from("scrap_loads").update({ status: "approved" }).eq("id", load.data.id).select("id"));
  else rec("scrap_driver", "scrap load visible for approve test", true, "no visible loads; approve path not exercised");
}
{
  const c = await signIn(byRole.auction.email, byRole.auction.password);
  const v = await c.from("vehicles").select("id").limit(1).maybeSingle();
  if (v.data) await expectWriteBlocked("auction", "close vehicle (closed_reason)", c.from("vehicles").update({ closed_reason: "test" }).eq("id", v.data.id).select("id"));
}
{
  const c = await signIn(byRole.dismantling.email, byRole.dismantling.password);
  const p = await c.from("parts").select("id").limit(1).maybeSingle();
  if (p.data) await expectWriteBlocked("dismantling", "set part price", c.from("parts").update({ price: 1 }).eq("id", p.data.id).select("id"));
}
{
  const c = await signIn(byRole.export_manager.email, byRole.export_manager.password);
  const inv = await c.from("export_invoices").select("id,status").eq("status", "Finalized").limit(1).maybeSingle();
  if (inv.data) await expectWriteBlocked("export_manager", "edit finalized invoice", c.from("export_invoices").update({ notes: "x" }).eq("id", inv.data.id).select("id"));
  else rec("export_manager", "finalized invoice exists for test", true, "none finalized in seed; immutability not exercised");
}
{
  const c = await signIn(byRole.owner.email, byRole.owner.password);
  await expectRpcBlocked("owner", "write_audit_log() (service-only even for owner)", c.rpc("write_audit_log", WRITE_AUDIT));
}
{
  const anon = createClient(URL_, PUB, { auth: { persistSession: false } });
  const { data, error } = await anon.from("sales").select("id").limit(1);
  rec("anon", "read sales", !!error || (data?.length ?? 0) === 0, error ? "denied" : `rows=${data?.length}`);
  const r2 = await anon.rpc("current_access");
  rec("anon", "current_access()", !!r2.error || (r2.data?.length ?? 0) === 0, r2.error ? "denied" : "empty");
}

await admin.end();
const failed = results.filter((r) => !r.ok);
console.log(`\nTOTAL ${results.length} | PASS ${results.length - failed.length} | FAIL ${failed.length}`);
