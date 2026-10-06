// Containers: management creates and assigns, planned parts hold inventory, the assigned loader confirms loaded quantities
// (migration 0071). Real signed-in sessions against DEV. Management = engineer_admin; loader = container_loading.
// Finish Loading (photos, stock export) is covered by the browser QA. This file checks the rules around it.
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
  if (!u?.password) throw new Error(`no password for ${role} (set the matching DEV_TEST_* variable)`);
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  return c;
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); return { data, error, code: error?.code ?? null, msg: error?.message ?? "" }; };
const DENIED = (r) => !!r.error && (r.code === "42501" || r.code === "28000" || /permission denied/i.test(r.msg));

const loaderProfile = (await q("select id from public.profiles where email = $1", [byRole.container_loading.email]))[0];
const eng = await signIn("engineer_admin");
const mgr = await signIn("manager");
const ldr = await signIn("container_loading");

// Fixture: a fresh dedicated part with quantity 3 per run, so earlier runs' holds never change the numbers.
const SKU = "QA-CONT-RPC-" + crypto.randomUUID().slice(0, 6).toUpperCase();
const made = await rpc(eng, "create_manual_inventory_part", { p_fields: { part_name: "QA Container Part " + SKU, quantity: 3, price: 40, category: "", part_number: "", condition: "Used", location: "QA-CONT", part_notes: "", stock_sku: SKU }, p_client_request_id: crypto.randomUUID() });
check("fixture: QA part created with quantity 3", !made.error, made.msg);
const part = (await q("select id, part_name, quantity from public.parts where stock_sku = $1", [SKU]))[0];
// Start from zero holds on this part so the arithmetic is exact on a rerun.
const holds0 = await q("select count(*)::int n from public.container_planned_items where part_id = $1 and status = 'planned'", [part.id]);
check("fixture: the QA part has no planned holds to start", holds0[0].n === 0, `holds=${holds0[0].n}`);
const avail = async () => (await q("select public._available_quantity($1) a", [part.id]))[0].a;

// 1. Creation: management only; the loader must be an active Container Loader.
const reqId = crypto.randomUUID();
const loaderOpen = await rpc(ldr, "container_loader_open", { p_client_request_id: crypto.randomUUID() });
check("create: a loader cannot open a container (revoked)", DENIED(loaderOpen), loaderOpen.code ?? "no error");
const loaderCreate = await rpc(ldr, "export_create_container", { p_loader_id: loaderProfile.id, p_consignee_id: null, p_destination_country: "", p_destination_port: "", p_trucking_company: "", p_shipping_note: "", p_client_request_id: crypto.randomUUID() });
check("create: a loader cannot create a container (42501)", DENIED(loaderCreate), loaderCreate.code ?? "no error");
const mgrCreate = await rpc(mgr, "export_create_container", { p_loader_id: loaderProfile.id, p_consignee_id: null, p_destination_country: "", p_destination_port: "", p_trucking_company: "", p_shipping_note: "", p_client_request_id: crypto.randomUUID() });
check("create: a front desk manager cannot create a container (42501)", DENIED(mgrCreate), mgrCreate.code ?? "no error");
const notLoader = await rpc(eng, "export_create_container", { p_loader_id: (await q("select id from public.profiles where email = $1", [byRole.manager.email]))[0].id, p_consignee_id: null, p_destination_country: "", p_destination_port: "", p_trucking_company: "", p_shipping_note: "", p_client_request_id: crypto.randomUUID() });
check("create: a user without the Container Loader role cannot be assigned (22023)", notLoader.code === "22023", notLoader.msg);

const created = await rpc(eng, "export_create_container", { p_loader_id: loaderProfile.id, p_consignee_id: null, p_destination_country: "Canada", p_destination_port: "Halifax", p_trucking_company: "QA Trucking", p_shipping_note: "QA", p_client_request_id: reqId });
check("create: management creates a loading container with the loader assigned", !created.error && created.data?.container?.status === "loading", created.msg);
const cid = created.data?.container?.id;
check("create: the LAL reference is generated by the server", /^T\d{2}-\d{3}$/.test(created.data?.container?.t_ref ?? ""));
const row = (await q("select assigned_loader_id, assigned_by, assigned_at, parts_planning, created_by from public.container_jobs where id = $1", [cid]))[0];
check("create: assigned loader, assigned by, assigned at and created by are recorded", row.assigned_loader_id === loaderProfile.id && row.assigned_by && row.assigned_at && row.created_by, JSON.stringify(row));
check("create: a new container is a planning container", row.parts_planning === true);
const evs = (await q("select action from public.container_events where container_id = $1 order by created_at", [cid])).map((r) => r.action);
check("create: history records created and loader_assigned", evs.includes("created") && evs.includes("loader_assigned"), evs.join(","));
const replay = await rpc(eng, "export_create_container", { p_loader_id: loaderProfile.id, p_consignee_id: null, p_destination_country: "", p_destination_port: "", p_trucking_company: "", p_shipping_note: "", p_client_request_id: reqId });
check("create: the same request id replays the same container", !replay.error && replay.data?.container?.id === cid);

// 2. The loader sees only its own containers and nothing financial.
const ll = await rpc(ldr, "container_loader_list", { p_status: "all", p_limit: 50 });
const lrows = ll.data?.rows ?? [];
check("loader: the new container is in My Assigned Containers", lrows.some((r) => r.id === cid), ll.msg);
check("loader: every listed container is assigned to them", lrows.every((r) => r.assigned_loader_id === loaderProfile.id));
const lg = await rpc(ldr, "container_loader_get", { p_container_id: cid });
check("loader: the assigned container opens", !lg.error && lg.data?.container?.id === cid, lg.msg);
check("loader: the container view has no consignee, shipping or invoice fields", !lg.error && !JSON.stringify(lg.data).match(/consignee|invoice|destination|trucking|balance/i));
const mgrGet = await rpc(mgr, "container_loader_get", { p_container_id: cid });
check("access: a front desk manager cannot open a container through the loader RPC", DENIED(mgrGet), mgrGet.code ?? "no error");
const direct = await rpc(ldr, "export_get_container", { p_container_id: cid });
check("access: the loader cannot open the management container view", DENIED(direct), direct.code ?? "no error");

// 3. Planned parts: search is bounded, planning holds stock, the server refuses over-planning.
const search = await rpc(eng, "export_container_search_parts", { p_container_id: cid, p_search: SKU });
const sRows = search.data ?? [];
check("search: management finds the QA part with available stock", sRows.some((r) => r.id === part.id && r.available >= 3), search.msg);
check("search: results are bounded to 20", sRows.length <= 20);
check("search: under two characters returns nothing", (await rpc(eng, "export_container_search_parts", { p_container_id: cid, p_search: "Q" })).data?.length === 0);
const loaderSearch = await rpc(ldr, "export_container_search_parts", { p_container_id: cid, p_search: "QA Container" });
check("search: a loader cannot search inventory (42501)", DENIED(loaderSearch), loaderSearch.code ?? "no error");

const a0 = await avail();
const add2 = await rpc(eng, "export_container_add_planned", { p_container_id: cid, p_part_id: part.id, p_quantity: 2 });
check("plan: adding 2 succeeds", !add2.error, add2.msg);
const aAfter = await avail();
check("plan: available drops by the planned quantity (3 stock, 2 planned, 1 left)", aAfter === a0 - 2, `before=${a0} after=${aAfter}`);
const opStatus = (await q("select operational_status s from public.parts where id = $1", [part.id]))[0].s;
check("plan: the part is not marked SOLD (stock still on hand)", opStatus !== "SOLD", opStatus);
const dup = await rpc(eng, "export_container_add_planned", { p_container_id: cid, p_part_id: part.id, p_quantity: 1 });
check("plan: the same part cannot be planned twice in one container", dup.code === "22023", dup.msg);
const other = await rpc(eng, "export_create_container", { p_loader_id: loaderProfile.id, p_consignee_id: null, p_destination_country: "", p_destination_port: "", p_trucking_company: "", p_shipping_note: "", p_client_request_id: crypto.randomUUID() });
const otherId = other.data?.container?.id;
const steal = await rpc(eng, "export_container_add_planned", { p_container_id: otherId, p_part_id: part.id, p_quantity: 99 });
check("plan: another container cannot take the held units (refused, over availability)", steal.code === "22023", steal.msg);
const sync = (await q("select operational_status s from public.parts where id = $1", [part.id]))[0].s;
check("plan: a fully planned part reads RESERVED or AVAILABLE, never SOLD", sync !== "SOLD", sync);

// 4. Planned view: the loader sees planned/loaded but no stock or location; management sees stock detail.
const items = await rpc(ldr, "container_planned_items", { p_container_id: cid });
const line = (items.data?.items ?? []).find((i) => i.part_id === part.id);
check("loader: sees the planned line with planned quantity 2 and loaded 0", !items.error && line?.planned_qty === 2 && line?.loaded_qty === 0, items.msg);
check("loader: no stock, location or inventory source on the loader view", line && !("available" in line) && !("location" in line) && !("inventory_source" in line));
const mItems = await rpc(eng, "container_planned_items", { p_container_id: cid });
const mline = (mItems.data?.items ?? []).find((i) => i.part_id === part.id);
check("management: sees available and location on the planned line", mline && "available" in mline && "location" in mline);

// 5. Loaded quantity: only the assigned loader, 0..planned, no stock movement.
const itemId = line.id;
const tooMany = await rpc(ldr, "container_loader_set_loaded", { p_item_id: itemId, p_loaded_qty: 3 });
check("loaded: more than planned is refused (22023)", tooMany.code === "22023", tooMany.msg);
const negative = await rpc(ldr, "container_loader_set_loaded", { p_item_id: itemId, p_loaded_qty: -1 });
check("loaded: a negative quantity is refused", negative.code === "22023", negative.msg);
const mgrLoaded = await rpc(mgr, "container_loader_set_loaded", { p_item_id: itemId, p_loaded_qty: 1 });
check("loaded: a front desk manager cannot set loaded quantities (denied)", DENIED(mgrLoaded), mgrLoaded.code ?? "no error");
const setOne = await rpc(ldr, "container_loader_set_loaded", { p_item_id: itemId, p_loaded_qty: 1 });
check("loaded: the loader confirms 1 of 2", !setOne.error && (setOne.data?.items ?? []).find((i) => i.id === itemId)?.loaded_qty === 1, setOne.msg);
check("loaded: confirming does not move stock (quantity still 3)", (await q("select quantity from public.parts where id = $1", [part.id]))[0].quantity === 3);

// 6. Remove: refused once loaded; allowed after the loaded count returns to 0.
const removeLoaded = await rpc(eng, "export_container_remove_planned", { p_item_id: itemId });
check("remove: refused while the loader has confirmed a quantity", removeLoaded.code === "P0001", removeLoaded.msg);
await rpc(ldr, "container_loader_set_loaded", { p_item_id: itemId, p_loaded_qty: 0 });
const removed = await rpc(eng, "export_container_remove_planned", { p_item_id: itemId });
check("remove: a planned part can be removed before loading and releases its hold", !removed.error, removed.msg);
check("remove: availability returns to where it was before planning", (await avail()) === a0);

// 7. Only loading containers change; the loader cannot change plans; finish is refused without evidence.
const mgrAdd = await rpc(mgr, "export_container_add_planned", { p_container_id: cid, p_part_id: part.id, p_quantity: 1 });
check("plan: a front desk manager cannot plan parts (42501)", DENIED(mgrAdd), mgrAdd.code ?? "no error");
const ldrAdd = await rpc(ldr, "export_container_add_planned", { p_container_id: cid, p_part_id: part.id, p_quantity: 1 });
check("plan: the loader cannot add parts (42501)", DENIED(ldrAdd), ldrAdd.code ?? "no error");
const finishNoEvidence = await rpc(ldr, "container_loader_finish", { p_container_id: cid, p_client_request_id: crypto.randomUUID() });
check("finish: refused without the container number and photos", finishNoEvidence.code === "P0001", finishNoEvidence.msg);

// 8. Legacy containers keep their history and show no structured parts.
const legacy = (await q("select id from public.container_jobs where parts_planning = false and status = 'closed' order by created_at limit 1"))[0]
  ?? (await q("select id from public.container_jobs where parts_planning = false order by created_at limit 1"))[0];
if (legacy) {
  const lg2 = await rpc(eng, "container_planned_items", { p_container_id: legacy.id });
  check("legacy: a historical container opens with no structured parts and no error", !lg2.error && (lg2.data?.items ?? []).length === 0 && lg2.data?.container?.parts_planning === false, lg2.msg);
  const lgDetail = await rpc(eng, "export_get_container", { p_container_id: legacy.id });
  check("legacy: the historical export view still opens", !lgDetail.error && !!lgDetail.data?.container, lgDetail.msg);
} else {
  check("legacy: a historical container exists to check", false, "none found");
}

await db.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
