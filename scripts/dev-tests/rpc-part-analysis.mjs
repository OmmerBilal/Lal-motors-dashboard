// Module 05 "Analyze Part" — authorization, status rule, and no-mutation checks over the real route and DEV database.
// Expected outcomes are explicit. A denial is proven by category "forbidden" from the role check (the stream carries
// that category as its final event). A positive draft or a controlled provider error is accepted as ALLOW.
// Fixture: one captured part gets a metadata row that points at an existing stored photo object (labelled TEST).
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
const BASE = process.env.BASE_URL || "http://localhost:3100";
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

async function cookieFor(role) {
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: byRole[role].email, password: byRole[role].password });
  if (error) throw new Error(`sign-in ${role}: ${error.message}`);
  const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  const CHUNK = 3180;
  return value.length <= CHUNK ? `${COOKIE}=${value}` : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => `${COOKIE}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`).join("; ");
}
async function streamEvents(cookie, body) {
  const res = await fetch(BASE + "/api/ai/analyze-part/stream", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  if (!(res.headers.get("content-type") ?? "").includes("ndjson")) return { status: res.status, events: [], json: await res.json().catch(() => null) };
  const text = await res.text();
  return { status: res.status, events: text.split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
}

// Fixture: a captured part gets a metadata row that points at an existing stored photo object (TEST label).
const source = (await db.query("select bucket, storage_path, mime_type, size_bytes, width, height from public.media_assets where owner_type='part' and variant='original' and status='ready' limit 1")).rows[0];
const target = (await db.query("select id, status from public.parts where status='captured' order by created_at desc limit 1")).rows[0];
let fixturePart = null;
if (source && target) {
  const existing = (await db.query("select id from public.media_assets where owner_type='part' and owner_id=$1 and variant='original' and status='ready' limit 1", [target.id])).rows[0];
  if (!existing) {
    // A real small image is uploaded for the fixture (the source row may point at an object that no longer exists).
    // The service key is read from the server environment file and is never printed.
    const sharp = req("sharp");
    const png = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 60, g: 90, b: 140 } } }).png().toBuffer();
    const admin = createClient(SUPA, envLocal.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
    const storagePath = `test/analysis-fixture/${target.id}.png`;
    const { error: upErr } = await admin.storage.from("operational-media").upload(storagePath, png, { contentType: "image/png", upsert: true });
    if (upErr) throw new Error("fixture upload failed: " + upErr.message);
    await db.query(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, size_bytes, width, height, status)
                    values ('part', $1, 'capture', 'original', 'operational-media', $2, 'image/png', $3, 320, 240, 'ready')`,
      [target.id, storagePath, png.length]);
    fixturePart = target.id;
  } else fixturePart = target.id;
}
console.log(`INFO | fixture part (captured, with a TEST photo row): ${fixturePart ?? "none"}`);

const approvedPart = (await db.query("select id, status from public.parts where status='approved' order by created_at desc limit 1")).rows[0];
const before = fixturePart ? (await db.query("select status, operational_status, stage from public.parts where id=$1", [fixturePart])).rows[0] : null;

const ROLES = ["owner", "engineer_admin", "manager", "export_manager", "auction", "dismantling", "scrap_driver", "container_loading", "employee", "receiving"];
const ALLOW = ["owner", "engineer_admin", "manager"];
const cookies = {};
for (const r of ROLES) cookies[r] = await cookieFor(r);

// 1) Anonymous: refused before any stream.
const anon = await fetch(BASE + "/api/ai/analyze-part/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ partId: fixturePart ?? "00000000-0000-4000-8000-000000000000" }) });
check("anonymous | expected DENY (401 JSON) | actual " + anon.status, anon.status === 401 && !(anon.headers.get("content-type") ?? "").includes("ndjson"));

// 2) Every role outside the manager set: forbidden from the role check, with no provider stage.
for (const role of ROLES) {
  if (ALLOW.includes(role) || !fixturePart) continue;
  const r = await streamEvents(cookies[role], { partId: fixturePart });
  const last = r.events[r.events.length - 1];
  const reached = r.events.some((e) => e.stage === "analyzing_image");
  check(`${role} | expected DENY (category forbidden, no provider call) | actual ${last?.category ?? r.status}`, last?.type === "error" && last.category === "forbidden" && !reached);
}

// 3) Manager roles: the status rule and the photo rule hold. A review-state part with a photo reaches the provider.
if (fixturePart) {
  for (const role of ALLOW) {
    const r = await streamEvents(cookies[role], { partId: fixturePart });
    const last = r.events[r.events.length - 1];
    const ok = last && (last.type === "result" || (last.type === "error" && last.category !== "forbidden"));
    check(`${role} | expected ALLOW (reaches the draft pipeline) | actual ${last?.type}:${last?.category ?? "result"}`, !!ok);
  }
} else {
  check("manager draft path | fixture available | none", false, "no captured part could be fixtured");
}

// 4) Approved part: refused by the status rule, not by authorization.
if (approvedPart) {
  const r = await streamEvents(cookies.manager, { partId: approvedPart.id });
  const last = r.events[r.events.length - 1];
  check("manager | approved part | expected refusal by status rule (category invalid) | actual " + last?.category, last?.type === "error" && last.category === "invalid" && !r.events.some((e) => e.stage === "analyzing_image"));
}

// 5) Unknown or malformed part id: refused before any lookup succeeds.
const bad = await fetch(BASE + "/api/ai/analyze-part/stream", { method: "POST", headers: { "content-type": "application/json", cookie: cookies.manager }, body: JSON.stringify({ partId: "not-a-uuid" }) });
check("manager | malformed id | expected 400 invalid | actual " + bad.status, bad.status === 400);

// 6) No automatic mutation: the part's status and stage are unchanged by any analysis run.
if (fixturePart) {
  const after = (await db.query("select status, operational_status, stage from public.parts where id=$1", [fixturePart])).rows[0];
  check("analysis changed no part state (status, operational status, stage)", JSON.stringify(before) === JSON.stringify(after), `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
}

console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail === 0 ? 0 : 1);
