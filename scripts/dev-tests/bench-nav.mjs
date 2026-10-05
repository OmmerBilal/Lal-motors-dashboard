// Measures authenticated navigation latency through the proxy (real sign-in, real cookie).
// Usage: node scripts/dev-tests/bench-nav.mjs [baseUrl] [runs]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const BASE = process.argv[2] || "http://localhost:3200";
const RUNS = Number(process.argv[3] || 15);
const creds = loadDevCredentials();
const u = creds.find((x) => x.role === "owner");

const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
if (error) throw new Error("sign-in failed");
const b64 = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
const cookie = `${COOKIE}=${b64}`;

const times = [];
for (let i = 0; i < RUNS; i++) {
  const t = performance.now();
  const res = await fetch(BASE + (process.env.BENCH_PATH || "/sales"), { headers: { cookie }, redirect: "manual" });
  await res.arrayBuffer();
  times.push({ ms: performance.now() - t, status: res.status });
}
const sorted = times.map((x) => x.ms).sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))].toFixed(0);
console.log(`runs=${RUNS} status=${[...new Set(times.map((x) => x.status))].join(",")} median=${pct(50)}ms p90=${pct(90)}ms min=${sorted[0].toFixed(0)}ms`);
