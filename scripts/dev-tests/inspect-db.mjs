// Read-only inspection helper: prints catalog facts for migration design. Never prints secrets.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pg = createRequire(ROOT + "/package.json")("pg");
const env = Object.fromEntries(fs.readFileSync(ROOT + "/.env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const c = new pg.Client({ connectionString: env.connection_string, ssl: { rejectUnauthorized: false } });
await c.connect();
for (const q of process.argv.slice(2)) {
  const r = await c.query(q);
  console.log(JSON.stringify(r.rows, null, 0).slice(0, 1500));
}
await c.end();
