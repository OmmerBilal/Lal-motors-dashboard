// Module 16 — one live provider smoke attempt through the real command route. It reports the result truthfully:
// PASS when the model routes a read command, or PROVIDER CONNECTION FAILED with the category when it cannot.
// It never prints the key, the raw provider body or the session cookie. It writes nothing: the command is a read.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envPub = parse(ROOT + "/.env");
const envLocal = parse(ROOT + "/.env.local");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
const manager = creds.find((u) => u.role === "manager");
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;

const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const { data, error } = await c.auth.signInWithPassword({ email: manager.email, password: manager.password });
if (error) { console.log("FAIL | sign-in for smoke test"); process.exit(1); }
const b64 = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
const CHUNK = 3180;
const cookie = b64.length <= CHUNK ? `${COOKIE}=${b64}` : Array.from({ length: Math.ceil(b64.length / CHUNK) }, (_, i) => `${COOKIE}.${i}=${b64.slice(i * CHUNK, (i + 1) * CHUNK)}`).join("; ");

const res = await fetch(BASE + "/api/ai/command", {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ text: "Find the customer named Smith" }),
});
const json = await res.json().catch(() => ({}));
if (res.status === 200 && (json.kind === "read" || json.kind === "answer")) {
  console.log(`PASS | live provider routed the command (${json.kind}${json.tool ? ", tool " + json.tool : ""})`);
  process.exit(0);
}
const category = json.error?.category ?? json.kind ?? "unknown";
console.log(`PROVIDER CONNECTION FAILED | status=${res.status} | category=${category} | nothing was written`);
process.exit(2);
