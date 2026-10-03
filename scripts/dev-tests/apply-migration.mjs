import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pg = createRequire(ROOT + "/package.json")("pg");
const env = Object.fromEntries(fs.readFileSync(ROOT + "/.env.local", "utf8").split(/\r?\n/).filter(l => l.includes("=") && !l.trim().startsWith("#")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const file = process.argv[2];
const sql = fs.readFileSync(file, "utf8");
const client = new pg.Client({ connectionString: env.connection_string, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log("APPLIED OK:", file.split(/[\/]/).pop());
} catch (e) {
  await client.query("rollback");
  console.log("ROLLED BACK:", e.message);
  process.exitCode = 1;
} finally { await client.end(); }
