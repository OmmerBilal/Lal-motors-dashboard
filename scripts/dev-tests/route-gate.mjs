import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { loadDevCredentials } from "./dev-credentials.mjs";

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
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const REF = new URL(SUPA).hostname.split(".")[0];
const COOKIE = `sb-${REF}-auth-token`;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const creds = loadDevCredentials();
const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));

// @supabase/ssr cookie encoding: "base64-" + base64url(JSON), chunked at 3180 chars as .0 .1 ...
function cookieHeader(session) {
  const b64 = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const CHUNK = 3180;
  if (b64.length <= CHUNK) return `${COOKIE}=${b64}`;
  const parts = [];
  for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));
  return parts.map((p, i) => `${COOKIE}.${i}=${p}`).join("; ");
}

async function sessionFor(u) {
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + u.role + ": " + error.message);
  return data.session;
}

// Returns { status, location } for a GET with the session cookie (no redirects followed).
function probe(cookie, path) {
  // Errors are reported without the command line, which contains the session cookie.
  let out;
  try {
    out = execFileSync("curl", ["-s", "-o", "NUL", "-w", "%{http_code} %{redirect_url}", "-H", `Cookie: ${cookie}`, BASE + path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    throw new Error(`curl failed for ${path} (is the server running at ${BASE}?)`);
  }
  const [status, ...loc] = out.trim().split(" ");
  return { status: Number(status), location: loc.join(" ").replace(BASE, "") };
}

let pass = 0, fail = 0;
const check = (who, path, expect) => {
  const cookie = cookies[who];
  const r = probe(cookie, path);
  const ok = expect.status === r.status && (expect.location === undefined || expect.location === r.location);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} | ${who} | GET ${path} -> ${r.status}${r.location ? " " + r.location : ""}${ok ? "" : `   (expected ${expect.status}${expect.location ? " " + expect.location : ""})`}`);
};
const ALLOW = (s = 200) => ({ status: s });
const DENY_TO = (loc) => ({ status: 307, location: loc });

const cookies = {};
const roles = ["owner", "engineer_admin", "manager", "employee", "auction", "receiving", "dismantling", "scrap_driver", "container_loading", "export_manager"];
for (const r of roles) cookies[r] = cookieHeader(await sessionFor(byRole[r]));

// Route expectations. Denied routes redirect to the role's own home.
const cases = {
  owner: [["/team", ALLOW()], ["/sales", ALLOW()], ["/preview/warehouse", ALLOW()], ["/containers", ALLOW()]],
  engineer_admin: [["/sales", ALLOW()], ["/team", DENY_TO("/vehicles")], ["/ai-command-center", ALLOW()]],
  manager: [["/sales", ALLOW()], ["/containers", DENY_TO("/dismantling-processing")], ["/audit", DENY_TO("/dismantling-processing")]],
  employee: [["/parts", ALLOW()], ["/sales", DENY_TO("/parts")], ["/containers", DENY_TO("/parts")]],
  auction: [["/vehicles", ALLOW()], ["/scrap", DENY_TO("/vehicles")], ["/parts", DENY_TO("/vehicles")]],
  receiving: [["/vehicle-receiving", ALLOW()], ["/vehicles", DENY_TO("/vehicle-receiving")]],
  dismantling: [["/dismantling", ALLOW()], ["/parts", DENY_TO("/dismantling")], ["/sales", DENY_TO("/dismantling")]],
  scrap_driver: [["/scrap", ALLOW()], ["/sales", DENY_TO("/scrap")], ["/containers", DENY_TO("/scrap")], ["/team", DENY_TO("/scrap")], ["/vehicles", DENY_TO("/scrap")], ["/preview/scrap-driver", DENY_TO("/scrap")]],
  container_loading: [["/containers", ALLOW()], ["/sales", DENY_TO("/containers")], ["/parts", DENY_TO("/containers")]],
  export_manager: [["/containers", ALLOW()], ["/sales", DENY_TO("/containers")], ["/team", DENY_TO("/containers")]],
};
for (const [role, list] of Object.entries(cases)) for (const [path, exp] of list) check(role, path, exp);

// Disabled account: must be signed out and sent to /login?reason=disabled, then restored.
const admin = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await admin.connect();
const WH = byRole.employee;
await admin.query("update public.profiles set account_status='disabled' where id=$1", [WH.id]);
try {
  // The proxy caches role/status for ACCESS_TTL_MS (15 s). Wait out the window so this asserts
  // the bounded-staleness guarantee, not a cache hit. Data access is covered separately by rls-matrix.
  await new Promise((r) => setTimeout(r, 16000));
  const s = await sessionFor(WH); // sign-in still succeeds; the gate must end the session
  const ck = cookieHeader(s);
  const r = probe(ck, "/parts");
  const ok = r.status === 307 && r.location === "/login?reason=disabled";
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} | employee(disabled) | GET /parts -> ${r.status} ${r.location}`);
} finally {
  await admin.query("update public.profiles set account_status='active' where id=$1", [WH.id]);
  await admin.end();
}
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
