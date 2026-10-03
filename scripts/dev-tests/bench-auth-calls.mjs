// Times the individual auth calls the proxy makes, with a real session. Prints timings only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
const u = creds.find((x) => x.role === "owner");
const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const { data } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
const token = data.session.access_token;
const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
console.log("jwt alg:", header.alg, "kid present:", !!header.kid);

const time = async (label, fn) => { const runs = []; for (let i = 0; i < 5; i++) { const t = performance.now(); await fn(); runs.push(performance.now() - t); } runs.sort((a, b) => a - b); console.log(`${label}: median ${runs[2].toFixed(0)}ms`); };
const anon = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
await anon.auth.setSession({ access_token: token, refresh_token: data.session.refresh_token });
await time("getUser() [remote]", () => anon.auth.getUser());
await time("getClaims()", () => anon.auth.getClaims(token));
await time("rpc current_access() [PostgREST]", () => anon.rpc("current_access"));
