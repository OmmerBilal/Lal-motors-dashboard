// Module 16 — AI Command Center tool layer over the real app and DEV database. Real sessions, real routes, real RPCs.
// The model is NOT mocked: the provider may fail (key, quota, network). Every assertion below holds either way:
// nothing is written without approval, unknown or SQL-like tools are rejected, and a provider failure changes nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const sharp = req("sharp");
const pg = req("pg");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const creds = loadDevCredentials();
const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

// Session cookie for the Next server, built the same way the app reads it (chunked base64 session JSON).
async function sessionFor(role) {
  const u = byRole[role];
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  return data.session;
}
function cookieFor(session) {
  const b64 = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const CHUNK = 3180;
  if (b64.length <= CHUNK) return `${COOKIE}=${b64}`;
  const parts = [];
  for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));
  return parts.map((p, i) => `${COOKIE}.${i}=${p}`).join("; ");
}
const cookies = {};
for (const r of ["manager", "owner", "scrap_driver", "employee"]) cookies[r] = cookieFor(await sessionFor(r));

async function post(role, route, body) {
  const headers = { "content-type": "application/json" };
  if (role) headers.cookie = cookies[role];
  const res = await fetch(BASE + route, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const restore = [];
const runTag = crypto.randomUUID().slice(0, 6).toUpperCase();

// ------------------------------------------------------------------ access: management roles only, no anonymous use
const anon = await post(null, "/api/ai/command", { tool: "find_customer", arguments: { query: "Smith" } });
check("anonymous cannot use the command center", anon.status === 401 && anon.json.error?.code === "unauthenticated", `status=${anon.status}`);
const driver = await post("scrap_driver", "/api/ai/command", { tool: "find_customer", arguments: { query: "Smith" } });
check("scrap driver cannot use the command center", driver.status === 403, `status=${driver.status}`);
const emp = await post("employee", "/api/ai/command", { tool: "recent_activity", arguments: {} });
check("warehouse employee cannot read the audit trail via AI", emp.status === 403, `status=${emp.status}`);
const mgrSummary = await post("manager", "/api/ai/command", { tool: "get_management_summary", arguments: {} });
check("manager cannot use the owner-only management summary tool", mgrSummary.status === 403, `status=${mgrSummary.status}`);

// ------------------------------------------------------------------ registry: unknown and SQL-like tools are rejected
const unknown = await post("manager", "/api/ai/command", { tool: "delete_everything", arguments: {} });
check("unknown tool is rejected", unknown.status === 400 && unknown.json.error?.category === "unknown_tool", `status=${unknown.status}`);
const sqlTool = await post("manager", "/api/ai/command", { tool: "run_sql", arguments: { sql: "drop table customers" } });
check("an SQL-style tool name is rejected", sqlTool.status === 400 && sqlTool.json.error?.category === "unknown_tool");
const badArgs = await post("manager", "/api/ai/command", { tool: "get_customer_history", arguments: { customer_id: "not-a-uuid" } });
check("invalid arguments are rejected before any RPC", badArgs.status === 400 && badArgs.json.error?.category === "invalid", `status=${badArgs.status}`);
const customersBefore = Number((await q("select count(*)::int c from public.customers"))[0].c);
const injected = await post("manager", "/api/ai/command", { tool: "find_customer", arguments: { query: "x'; drop table customers; --" } });
const customersAfter = Number((await q("select count(*)::int c from public.customers"))[0].c);
check("SQL-like search text is treated as data (no SQL executed)", injected.status === 200 && customersAfter === customersBefore, `status=${injected.status}`);

// ------------------------------------------------------------------ reads run immediately and return real rows
const read = await post("manager", "/api/ai/command", { tool: "find_customer", arguments: { query: "Smith" } });
check("read tool returns real data immediately", read.status === 200 && read.json.kind === "read" && Array.isArray(read.json.data), `status=${read.status}`);

// ------------------------------------------------------------------ writes: proposal first, nothing changed
const name = `AI Test ${runTag}`;
const prop = await post("manager", "/api/ai/command", { tool: "create_customer", arguments: { phone: "+1 555 " + String(Date.now()).slice(-7), first_name: name, last_name: "Proposal" } });
check("a write becomes a proposal (preview), not an action", prop.status === 200 && prop.json.kind === "proposal" && prop.json.requestId, JSON.stringify(prop.json).slice(0, 160));
const created0 = Number((await q("select count(*)::int c from public.customers where first_name=$1", [name]))[0].c);
check("no customer exists after the proposal alone", created0 === 0, `rows=${created0}`);
const rejectProp = await post("manager", "/api/ai/command", { tool: "create_customer", arguments: { phone: "+1 555 " + String(Date.now()).slice(-7), first_name: name + " R", last_name: "Rejected" } });
const rej = await fetch(BASE + "/api/ai/approve", { method: "DELETE", headers: { "content-type": "application/json", cookie: cookies.manager }, body: JSON.stringify({ requestId: rejectProp.json.requestId }) });
const rejJson = await rej.json();
check("rejecting a proposal changes nothing", rej.status === 200 && rejJson.kind === "answer");
check("rejected proposal created no customer", Number((await q("select count(*)::int c from public.customers where first_name=$1", [name + " R"]))[0].c) === 0);

// Approval executes the existing RPC once, and the audit trail records both steps.
const appr = await post("manager", "/api/ai/approve", { requestId: prop.json.requestId });
check("approval executes the existing create_customer RPC", appr.status === 200 && appr.json.kind === "read", `status=${appr.status} ${JSON.stringify(appr.json).slice(0, 120)}`);
const created1 = Number((await q("select count(*)::int c from public.customers where first_name=$1", [name]))[0].c);
check("exactly one customer created by the approved action", created1 === 1, `rows=${created1}`);
const again = await post("manager", "/api/ai/approve", { requestId: prop.json.requestId });
check("approving twice does nothing the second time", again.status !== 200 || again.json.kind === "error", `status=${again.status}`);
check("second approval created no duplicate customer", Number((await q("select count(*)::int c from public.customers where first_name=$1", [name]))[0].c) === 1);
const audit = await q("select action from public.audit_logs where entity_type='ai_action' and entity_id=$1 order by created_at", [prop.json.requestId]);
check("audit records proposal and execution", audit.some((a) => a.action === "ai.action.proposed") && audit.some((a) => a.action === "ai.action.executed"), audit.map((a) => a.action).join(","));
check("the AI action row is kept with its status", (await q("select status from public.ai_action_requests where id=$1", [prop.json.requestId]))[0].status === "executed");

// Another person cannot approve a proposal that is not theirs.
const otherProp = await post("manager", "/api/ai/command", { tool: "create_customer", arguments: { phone: "+1 555 " + String(Date.now()).slice(-7), first_name: name + " O", last_name: "Other" } });
const theirs = await post("owner", "/api/ai/approve", { requestId: otherProp.json.requestId });
check("another user cannot approve someone else's proposal", theirs.status !== 200 || theirs.json.kind === "error", `status=${theirs.status}`);
check("that refused approval created nothing", Number((await q("select count(*)::int c from public.customers where first_name=$1", [name + " O"]))[0].c) === 0);

// Stale state: the record changes between proposal and approval, so approval must refuse.
const cust = (await q("select id from public.customers where phone is not null order by created_at limit 1"))[0];
if (cust) {
  const upd = await post("manager", "/api/ai/command", { tool: "update_customer", arguments: { customer_id: cust.id, fields: { notes: "AI proposed note " + runTag } } });
  if (!upd.json.requestId) { check("update proposal returned a request id", false, JSON.stringify(upd.json).slice(0, 160)); }
  else {
  check("update proposal is created with a preview", upd.status === 200 && upd.json.kind === "proposal", `status=${upd.status} ${JSON.stringify(upd.json).slice(0, 200)}`);
  const originalNotes = (await q("select notes from public.customers where id=$1", [cust.id]))[0].notes;
  restore.push([cust.id, originalNotes]);
  await db.query("update public.customers set notes = $2 where id = $1", [cust.id, "changed by someone else " + runTag]);
  const staleAppr = await post("manager", "/api/ai/approve", { requestId: upd.json.requestId });
  check("stale approval is refused (state changed after proposal)", staleAppr.status === 409 && staleAppr.json.error?.category === "stale", `status=${staleAppr.status}`);
  const notesNow = (await q("select notes from public.customers where id=$1", [cust.id]))[0].notes;
  check("refused stale approval did not overwrite the record", notesNow === "changed by someone else " + runTag);
  check("stale request is recorded as stale", (await q("select status from public.ai_action_requests where id=$1", [upd.json.requestId]))[0].status === "stale");
  }
}

// ------------------------------------------------------------------ provider behaviour: never a fabricated result, never a write
const beforeText = Number((await q("select count(*)::int c from public.customers"))[0].c);
const textRun = await post("manager", "/api/ai/command", { text: "Find the customer named Smith" });
const afterText = Number((await q("select count(*)::int c from public.customers"))[0].c);
const PROVIDER = ["not_configured", "invalid_key", "forbidden", "rate_limited", "quota", "timeout", "network", "model_unavailable", "invalid_response", "unknown"];
if (textRun.json.kind === "error") {
  check("provider failure returns a controlled category and a truthful message", PROVIDER.includes(textRun.json.error?.category) && typeof textRun.json.error?.message === "string", textRun.json.error?.category);
  check("provider failure performs no write", afterText === beforeText);
} else {
  check("model-routed command returned a real tool result or an answer (no invented data)", ["read", "proposal", "answer"].includes(textRun.json.kind), textRun.json.kind);
}
check("provider error responses never contain the key or raw provider body", !JSON.stringify(textRun.json).match(/sk-|Bearer|api\.openai|OpenAI_key/i));

// ------------------------------------------------------------------ analysis and voice: role gates, controlled input errors
const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 50, b: 50 } } }).png().toBuffer();
const fd = new FormData();
fd.append("purpose", "part");
fd.append("image", new Blob([png], { type: "image/png" }), "part.png");
const empAnalyze = await fetch(BASE + "/api/ai/analyze", { method: "POST", headers: { cookie: cookies.employee }, body: (() => { const f = new FormData(); f.append("purpose", "part"); f.append("image", new Blob([png], { type: "image/png" }), "p.png"); return f; })() });
check("warehouse employee cannot run part analysis (AI-free role)", empAnalyze.status === 403, `status=${empAnalyze.status}`);
const scrapAnalyze = await fetch(BASE + "/api/ai/analyze", { method: "POST", headers: { cookie: cookies.scrap_driver }, body: (() => { const f = new FormData(); f.append("purpose", "auction_screenshot"); f.append("image", new Blob([png], { type: "image/png" }), "a.png"); return f; })() });
check("scrap driver cannot run screenshot analysis", scrapAnalyze.status === 403, `status=${scrapAnalyze.status}`);
const mgrAnalyzeBad = await fetch(BASE + "/api/ai/analyze", { method: "POST", headers: { cookie: cookies.manager }, body: (() => { const f = new FormData(); f.append("purpose", "sql_please"); return f; })() });
check("unknown analysis purpose is refused", mgrAnalyzeBad.status === 400, `status=${mgrAnalyzeBad.status}`);
const empVoice = await fetch(BASE + "/api/ai/transcribe", { method: "POST", headers: { cookie: cookies.employee }, body: (() => { const f = new FormData(); f.append("audio", new Blob([Buffer.from("x")], { type: "audio/webm" }), "a.webm"); return f; })() });
check("warehouse employee cannot use voice commands", empVoice.status === 403, `status=${empVoice.status}`);
const mgrVoiceEmpty = await fetch(BASE + "/api/ai/transcribe", { method: "POST", headers: { cookie: cookies.manager }, body: new FormData() });
check("voice upload without audio is refused", mgrVoiceEmpty.status === 400, `status=${mgrVoiceEmpty.status}`);

// Restore the seeded customer record changed by the stale-state check. Test customers carry this run's label.
for (const [id, notes] of restore) await db.query("update public.customers set notes = $2 where id = $1", [id, notes]);
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail ? 1 : 0);
