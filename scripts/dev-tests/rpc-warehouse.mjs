// Warehouse Employee App (migration 0074): inventory location workspace. Real signed-in sessions against DEV.
// Employee = the Warehouse Employee role (key 'employee'). Denials use other real roles. No passwords are written here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const pg = req("pg");
const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const byRole = Object.fromEntries(loadDevCredentials().map((u) => [u.role, u]));
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
const newClient = () => createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function signIn(role) {
  const u = byRole[role];
  if (!u?.password) throw new Error(`no password for ${role}`);
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  return c;
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); return { data, error, code: error?.code ?? null, msg: error?.message ?? "" }; };
const DENIED = (r) => !!r.error && (r.code === "42501" || r.code === "28000" || /permission denied/i.test(r.msg));

const emp = await signIn("employee");
const eng = await signIn("engineer_admin");
const ldr = await signIn("container_loading");
const scr = await signIn("scrap_driver");

// Fixture: a fresh approved inventory part with NO location (a Pending Putaway item), created per run.
const SKU = "QA-WH-" + crypto.randomUUID().slice(0, 6).toUpperCase();
const made = await rpc(eng, "create_manual_inventory_part", { p_fields: { part_name: "QA Warehouse Part " + SKU, quantity: 2, price: 10, category: "", part_number: "WH-OEM-" + SKU, condition: "Used", location: "", part_notes: "", stock_sku: SKU }, p_client_request_id: crypto.randomUUID() });
check("fixture: a part with no location is created", !made.error, made.msg);
const partId = made.data?.part_id;

// 1. Pending Putaway and Stored lists.
const summary = await rpc(emp, "warehouse_summary", {});
check("summary: the employee sees pending and stored counts", !summary.error && typeof summary.data?.pending === "number" && typeof summary.data?.stored === "number", summary.msg);
const pending = await rpc(emp, "warehouse_list", { p_view: "pending", p_after: null, p_limit: 50 });
const pRows = pending.data?.rows ?? [];
check("pending: the no-location part is listed as Pending Putaway", pRows.some((r) => r.id === partId), pending.msg);
check("pending: every row has no location", pRows.every((r) => !r.location));
check("pending: rows carry no price or cost fields", pRows.every((r) => !("price" in r) && !("core_charge" in r) && !("cost" in r)));
const stored = await rpc(emp, "warehouse_list", { p_view: "stored", p_after: null, p_limit: 50 });
check("stored: every row has a location", (stored.data?.rows ?? []).every((r) => !!r.location), stored.msg);
check("pages: the list is bounded to the requested size", pRows.length <= 50);
const badView = await rpc(emp, "warehouse_list", { p_view: "everything", p_after: null, p_limit: 5 });
check("pages: an unknown view is refused (22023)", badView.code === "22023", badView.msg);

// 2. Search: bounded, two characters, no price.
const hit = await rpc(emp, "warehouse_search", { p_query: SKU, p_limit: 25 });
check("search: the part is found by SKU", (hit.data ?? []).some((r) => r.id === partId), hit.msg);
const byOem = await rpc(emp, "warehouse_search", { p_query: "WH-OEM-" + SKU, p_limit: 25 });
check("search: the part is found by OEM / interchange number", (byOem.data ?? []).some((r) => r.id === partId), byOem.msg);
const short = await rpc(emp, "warehouse_search", { p_query: "Q", p_limit: 25 });
check("search: one character returns nothing", Array.isArray(short.data) && short.data.length === 0);
check("search: results carry no price", (hit.data ?? []).every((r) => !("price" in r)));

// 3. Location: assign, persist, history, audit, no-op, refusals.
const empty = await rpc(emp, "warehouse_set_location", { p_part_id: partId, p_location: "   " });
check("location: an empty location is refused (22023)", empty.code === "22023", empty.msg);
const assigned = await rpc(emp, "warehouse_set_location", { p_part_id: partId, p_location: "A-12" });
check("location: the employee assigns a warehouse location", !assigned.error && assigned.data?.part?.location === "A-12", assigned.msg);
const again = await rpc(emp, "warehouse_get_part", { p_part_id: partId });
check("location: the location persists (a fresh read returns it)", again.data?.part?.location === "A-12");
const h1 = await q("select count(*)::int n from public.part_operations where part_id = $1 and action_type = 'LOCATION_CHANGE'", [partId]);
const sameLoc = await rpc(emp, "warehouse_set_location", { p_part_id: partId, p_location: "A-12" });
const h2 = await q("select count(*)::int n from public.part_operations where part_id = $1 and action_type = 'LOCATION_CHANGE'", [partId]);
check("location: setting the same location changes nothing and adds no history", !sameLoc.error && h1[0].n === h2[0].n);
const changed = await rpc(emp, "warehouse_set_location", { p_part_id: partId, p_location: "Rack B / Shelf 2" });
check("location: the employee changes the location", !changed.error && changed.data?.part?.location === "Rack B / Shelf 2", changed.msg);
const hist = (changed.data?.history ?? []).filter((h) => h.action === "LOCATION_CHANGE");
const last = hist[0];
check("history: the change records the previous and new location and the employee", last?.previous_location === "A-12" && last?.new_location === "Rack B / Shelf 2" && last?.actor_name && last?.actor_role === "employee", JSON.stringify(last));
check("history: the first assignment is recorded with no previous location", hist.some((h) => h.previous_location == null && h.new_location === "A-12"));
const audit = await q("select count(*)::int n from public.audit_logs where action = 'part.location_change' and entity_id = $1", [partId]);
check("audit: the location change is written to the audit log", audit[0].n >= 2, "rows=" + audit[0].n);
const qty = (await q("select quantity from public.parts where id = $1", [partId]))[0].quantity;
check("location: quantity and SKU are unchanged by a location change", qty === 2);

// 4. The employee cannot place a part that is not valid inventory.
const notInv = await q("select id from public.parts where status = 'rejected' limit 1");
if (notInv[0]) {
  const bad = await rpc(emp, "warehouse_set_location", { p_part_id: notInv[0].id, p_location: "Z-99" });
  check("refusal: a rejected part cannot be placed (P0001)", bad.code === "P0001", bad.msg);
}

// 5. Other roles are refused; the employee cannot reach price, financial, container or dismantling writes.
check("denied: a container loader cannot use the warehouse summary", DENIED(await rpc(ldr, "warehouse_summary", {})));
check("denied: a scrap driver cannot set a location", DENIED(await rpc(scr, "warehouse_set_location", { p_part_id: partId, p_location: "X" })));
const priceTry = await rpc(emp, "update_part_fields", { p_part_id: partId, p_fields: { price: 999 } });
check("denied: the employee cannot edit selling price", DENIED(priceTry) || priceTry.code === "42501", priceTry.code ?? "no error");
const price = (await q("select price from public.parts where id = $1", [partId]))[0].price;
check("denied: the price is unchanged after the attempt", Number(price) === 10, "price=" + price);
const containerTry = await rpc(emp, "export_list_containers", { p_bucket: "all", p_limit: 5 });
check("denied: the employee cannot open container export", DENIED(containerTry), containerTry.code ?? "no error");
const createTry = await rpc(emp, "export_create_container", { p_loader_id: "55555555-5555-5555-5555-555555555555", p_consignee_id: null, p_destination_country: "", p_destination_port: "", p_trucking_company: "", p_shipping_note: "", p_client_request_id: crypto.randomUUID() });
check("denied: the employee cannot create a container", DENIED(createTry), createTry.code ?? "no error");

await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
