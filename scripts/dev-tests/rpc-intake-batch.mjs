// Module 01 — duplicate protection for intake batches, over the real DEV database through supabase-js as real roles.
// Fixtures use fresh TBAT-* identifiers. Existing-match case uses a real vehicle already in DEV.
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
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
async function clientFor(role) {
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await c.auth.signInWithPassword({ email: byRole[role].email, password: byRole[role].password });
  if (error) throw new Error(`sign-in ${role}: ${error.message}`);
  return c;
}
const auction = await clientFor("auction");
const mgr = await clientFor("manager");
const scrap = await clientFor("scrap_driver");

const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase();
const vinA = ("TBATA" + tag + "0000000000").slice(0, 17);
const vinB = ("TBATB" + tag + "0000000000").slice(0, 17);
const vinC = ("TBATC" + tag + "0000000000").slice(0, 17);
const row = (over) => ({ vin: "", lotNumber: "", stockNumber: "", auctionSource: "Copart", auctionItemNumber: "", year: "2020", make: "Honda", model: "Accord", trim: "", engine: "", mileage: "", titleStatus: "", location: "", purchasePrice: "", auctionFees: "", transportationCost: "", sourceText: "", ...over });

// Exact manual QA case: same VIN twice, White then Red.
const whiteRed = [
  row({ vin: vinA, sourceText: `${vinA} 2020 Honda Accord White` }),
  row({ vin: vinA, sourceText: `${vinA} 2020 Honda Accord Red` }),
];
const ev1 = await auction.rpc("intake_evaluate_batch", { p_rows: whiteRed });
const s1 = (ev1.data ?? []).map((r) => r.status);
check("same VIN twice with different content: not two NEW rows", !ev1.error && s1.filter((x) => x === "new").length === 0, `statuses=${s1.join(",")} ${ev1.error?.message ?? ""}`);
check("same VIN twice with different content: both rows need review (conflict)", s1.length === 2 && s1.every((x) => x === "conflict"), `statuses=${s1.join(",")}`);

// Same VIN with identical content: one candidate, the other is a duplicate.
const vinDup = [
  row({ vin: vinB, sourceText: `${vinB} 2020 Honda Accord White` }),
  row({ vin: vinB, sourceText: `${vinB} 2020 Honda Accord White` }),
];
const ev2 = await auction.rpc("intake_evaluate_batch", { p_rows: vinDup });
const s2 = (ev2.data ?? []).map((r) => r.status);
check("same VIN with identical content: first row is the candidate, second is a duplicate", s2[0] === "new" && s2[1] === "duplicate", `statuses=${s2.join(",")}`);

// Same lot inside one batch with different content: conflict.
const lot = "LOT" + tag;
const lotPair = [
  row({ vin: vinC, lotNumber: lot, sourceText: `${vinC} lot ${lot} 2020 Honda Accord White` }),
  row({ vin: "", lotNumber: lot, year: "2019", model: "Civic", sourceText: `lot ${lot} 2019 Honda Civic` }),
];
const ev3 = await auction.rpc("intake_evaluate_batch", { p_rows: lotPair });
const s3 = (ev3.data ?? []).map((r) => r.status);
check("same lot inside one batch with different content: both rows need review", s3.every((x) => x === "conflict"), `statuses=${s3.join(",")}`);

// Existing vehicle in the database: reported as existing, never new.
const existing = (await db.query("select vin from public.vehicles where vin is not null and vin <> '' and closed_reason is null order by created_at desc limit 1")).rows[0];
if (existing) {
  const ev4 = await auction.rpc("intake_evaluate_batch", { p_rows: [row({ vin: existing.vin, sourceText: existing.vin + " 2020 Honda Accord" })] });
  check("existing database VIN is reported as existing, not new", ev4.data?.[0]?.status === "existing", `status=${ev4.data?.[0]?.status} ${ev4.error?.message ?? ""}`);
} else {
  check("existing database VIN check", false, "no vehicle with a VIN in DEV");
}

// Server commit defends against duplicates sent by a modified client (the same request as a client would send).
const before = Number((await db.query("select count(*)::int c from public.vehicles where vin=$1", [vinB])).rows[0].c);
const commitDup = await mgr.rpc("intake_commit_batch", { p_rows: vinDup });
const created = Number((await db.query("select count(*)::int c from public.vehicles where vin=$1", [vinB])).rows[0].c) - before;
check("commit of two identical rows creates exactly one vehicle", !commitDup.error && created === 1, `created=${created} ${commitDup.error?.message ?? ""}`);
const counts = commitDup.data?.counts ?? {};
check("commit reports the duplicate row without creating it", counts.created === 1 && counts.duplicate === 1, JSON.stringify(counts));

// Commit of the conflicting pair creates nothing.
const commitConflict = await mgr.rpc("intake_commit_batch", { p_rows: whiteRed });
const conflictRows = Number((await db.query("select count(*)::int c from public.vehicles where vin=$1", [vinA])).rows[0].c);
check("commit of a conflicting pair creates nothing", !commitConflict.error && conflictRows === 0, `rows=${conflictRows} counts=${JSON.stringify(commitConflict.data?.counts ?? {})}`);

// Invalid rows are never created.
const invalid = [row({ vin: vinC, year: "", sourceText: "missing year" })];
const commitInvalid = await mgr.rpc("intake_commit_batch", { p_rows: invalid });
check("a row without a year is invalid and not created", !commitInvalid.error && (commitInvalid.data?.counts?.invalid ?? 0) === 1 && Number((await db.query("select count(*)::int c from public.vehicles where vin=$1", [vinC])).rows[0].c) === 0);

// Roles: only intake roles may check or commit.
const denied = await scrap.rpc("intake_evaluate_batch", { p_rows: whiteRed });
check("scrap driver cannot evaluate an intake batch (42501)", denied.error?.code === "42501", denied.error?.code ?? "no error");
const deniedCommit = await scrap.rpc("intake_commit_batch", { p_rows: whiteRed });
check("scrap driver cannot commit an intake batch (42501)", deniedCommit.error?.code === "42501", deniedCommit.error?.code ?? "no error");

// Size guard.
const huge = Array.from({ length: 201 }, () => row({ vin: "", lotNumber: "X", sourceText: "x" }));
const big = await auction.rpc("intake_evaluate_batch", { p_rows: huge });
check("a batch over 200 rows is refused", !!big.error, big.error?.message ?? "no error");

console.log(`TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
await db.end();
process.exit(fail === 0 ? 0 : 1);
