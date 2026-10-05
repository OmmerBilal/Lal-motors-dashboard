// Module 16 retrofit — streamed AI routes over the real app and DEV database. Checks the progress contract and the
// bounded end time. It does not require the provider to answer: a provider failure is a valid, controlled outcome.
// Run against a started server (BASE_URL, default http://localhost:3100). Never prints the key or a raw provider body.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const sharp = req("sharp");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const creds = loadDevCredentials();
const manager = creds.find((u) => u.role === "manager");
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const { data, error } = await c.auth.signInWithPassword({ email: manager.email, password: manager.password });
if (error) { console.log("FAIL | sign-in"); process.exit(1); }
const b64 = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
const CHUNK = 3180;
const cookie = b64.length <= CHUNK ? `${COOKIE}=${b64}` : Array.from({ length: Math.ceil(b64.length / CHUNK) }, (_, i) => `${COOKIE}.${i}=${b64.slice(i * CHUNK, (i + 1) * CHUNK)}`).join("; ");

/** Reads an NDJSON stream and records each event with its arrival time. */
async function streamEvents(url, init) {
  const started = Date.now();
  const res = await fetch(BASE + url, { method: "POST", headers: { cookie, ...(init.headers ?? {}) }, body: init.body });
  const events = [];
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("ndjson")) {
    return { status: res.status, type, events, elapsed: Date.now() - started, json: await res.json().catch(() => null) };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) events.push({ ...JSON.parse(line), at: Date.now() - started });
    }
    if (done) break;
  }
  return { status: res.status, type, events, elapsed: Date.now() - started };
}

const ALLOWED_STAGES = ["understanding", "reading_context", "preparing_image", "analyzing_image", "extracting", "preparing_action", "approval_required", "checking_state", "executing", "saving", "completed"];

// 0) Cold request: reported, not asserted. The first request after a server start also loads route code.
const cold = await streamEvents("/api/ai/command/stream", { body: JSON.stringify({ text: "Find the customer named Smith" }), headers: { "content-type": "application/json" } });
console.log(`INFO | cold first progress=${cold.events[0]?.at ?? "none"}ms, cold end=${cold.elapsed}ms`);

// 1) Command stream (warm): first progress event arrives at once, labels come from the fixed table, the end is bounded.
const cmd = await streamEvents("/api/ai/command/stream", { body: JSON.stringify({ text: "Find the customer named Smith" }), headers: { "content-type": "application/json" } });
check("command stream answers as NDJSON", cmd.type.includes("ndjson"), cmd.type);
const progress = cmd.events.filter((e) => e.type === "progress");
check("first progress event arrives within 1 second", progress.length > 0 && progress[0].at < 1000, `first=${progress[0]?.at}ms`);
check("progress stages come from the fixed label table", progress.every((e) => ALLOWED_STAGES.includes(e.stage) && typeof e.label === "string" && !/reason|think|chain/i.test(e.label)));
const last = cmd.events[cmd.events.length - 1];
check("command ends with a result or a controlled error", last && (last.type === "result" || last.type === "error"), last?.type);
check("command finishes within the 30 second ceiling", cmd.elapsed <= 30_500, `elapsed=${cmd.elapsed}ms`);
if (last?.type === "error") check("provider failure is a controlled category with a message", typeof last.category === "string" && last.message.length > 10, last.category);

// 2) Approval stream: an unknown proposal is refused at once, with no provider timer and no write.
const appr = await streamEvents("/api/ai/approve/stream", { body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000000" }), headers: { "content-type": "application/json" } });
const apprLast = appr.events[appr.events.length - 1];
check("approval of an unknown proposal ends with a controlled error", apprLast?.type === "error", apprLast?.category ?? `status=${appr.status}`);
check("approval stream answers quickly", appr.elapsed < 10_000, `elapsed=${appr.elapsed}ms`);

// 3) Analysis stream: a real small image goes through compression, then the provider or the cache answers.
const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
const form = new FormData();
form.append("purpose", "part");
form.append("image", new Blob([png], { type: "image/png" }), "part.png");
const an = await streamEvents("/api/ai/analyze/stream", { body: form });
const anStages = an.events.filter((e) => e.type === "progress").map((e) => e.stage);
check("analysis reports preparing_image first", anStages[0] === "preparing_image", anStages.join(">"));
const anLast = an.events[an.events.length - 1];
check("analysis ends with a draft result or a controlled error", anLast && (anLast.type === "result" || anLast.type === "error"), anLast?.type);
check("analysis finishes within the 30 second ceiling", an.elapsed <= 30_500, `elapsed=${an.elapsed}ms`);

// 4) Unauthenticated callers still get a JSON 401 before any stream starts.
const anon = await fetch(BASE + "/api/ai/command/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello there" }) });
check("anonymous stream request gets a JSON 401, not a stream", anon.status === 401 && !(anon.headers.get("content-type") ?? "").includes("ndjson"), `status=${anon.status}`);

console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
console.log(`command: ${cmd.events.map((e) => e.type === "progress" ? `${e.stage}@${e.at}ms` : `${e.type}:${e.category ?? "ok"}@${e.at}ms`).join(" > ")}`);
process.exit(fail === 0 ? 0 : 1);
