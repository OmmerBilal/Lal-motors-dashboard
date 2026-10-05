// Receive eligibility (src/lib/receive-eligibility.ts): the one decision used by the Auction row menu, the Auction
// detail and the Receiving deep link. Runs the real TypeScript module under Node's type stripping (Node 22.6+), then
// checks every distinct vehicle state present in DEV against the database's own rules. Read-only: writes nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const pg = req("pg");
const { canReceiveVehicle, receiveStateBlocker } = await import(pathToFileURL(path.join(ROOT, "src/lib/receive-eligibility.ts")).href);

const envLocal = Object.fromEntries(
  fs.readFileSync(ROOT + "/.env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

const open = { status: "Purchased", closedReason: null, receivingStatus: "not_received" };

// 1. Roles: only the receiving roles, and only on an eligible vehicle.
for (const role of ["owner", "engineer_admin", "receiving"]) check(`role ${role} can receive an open vehicle`, canReceiveVehicle(open, role));
for (const role of ["auction", "manager", "employee", "dismantling", "scrap_driver", "container_loading", "export_manager"]) {
  check(`role ${role} cannot receive`, !canReceiveVehicle(open, role));
}

// 2. Vehicle state. Each case must have the expected blocker, independent of the role.
check("Waiting Arrival (Purchased, not received, open) is eligible", receiveStateBlocker(open) === null);
check("Overdue / in transit (Processing, not received) is eligible", receiveStateBlocker({ ...open, status: "Processing" }) === null);
check("received vehicle is blocked", receiveStateBlocker({ ...open, receivingStatus: "received" }) === "received");
check("closed vehicle is blocked", receiveStateBlocker({ ...open, closedReason: "Scrapped" }) === "closed");
check("dismantled vehicle is blocked", receiveStateBlocker({ ...open, status: "Dismantled" }) === "dismantled");
check("closed wins over other states", receiveStateBlocker({ status: "Dismantled", closedReason: "Other", receivingStatus: "received" }) === "closed");

// 3. The DEV database's own rows: eligible exactly when the DB says it is open, not dismantled and not received.
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const rows = (await db.query(`select status, receiving_status, (closed_reason is not null) as closed,
    count(*)::int as n
  from public.vehicles group by 1, 2, 3 order by 1, 2, 3`)).rows;
await db.end();
for (const r of rows) {
  const facts = { status: r.status, closedReason: r.closed ? "Other" : null, receivingStatus: r.receiving_status };
  const expected = !r.closed && r.status !== "Dismantled" && r.receiving_status !== "received";
  check(
    `DEV rows status=${r.status} received=${r.receiving_status} closed=${r.closed} (${r.n})`,
    canReceiveVehicle(facts, "owner") === expected,
    `predicate=${canReceiveVehicle(facts, "owner")} db-rule=${expected}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
