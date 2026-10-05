// Four arrival photos regression (Receiving). Real DEV data, real signed-in sessions, and the real media API:
// upload-ticket -> signed PUT -> complete. Progress is read through the same media_list_for_owner RPC the Receiving screen
// uses, and completion through the shared helper src/lib/media/arrival-photos.ts. Creates TEST-ARR-* vehicles only.
// Needs the production server running on BASE_URL with the current build (npm run build && npx next start -p 3100).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const sharp = req("sharp");
const { ARRIVAL_PHOTO_SLOTS, getArrivalPhotoCompletion } = await import(pathToFileURL(path.join(ROOT, "src/lib/media/arrival-photos.ts")).href);

const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const creds = loadDevCredentials();
const account = (role) => creds.find((u) => u.role === role);

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };


async function signIn(role) {
  const u = account(role);
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + role + ": " + error.message);
  const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  const CH = 3180;
  const cookie = value.length <= CH ? `${COOKIE}=${value}` : Array.from({ length: Math.ceil(value.length / CH) }, (_, i) => `${COOKIE}.${i}=${value.slice(i * CH, (i + 1) * CH)}`).join("; ");
  return { client: c, cookie };
}

// The same read the Receiving screen performs: media_list_for_owner with the arrival_ prefix, then the shared helper.
async function completionFor(session, vehicleId) {
  const { data, error } = await session.client.rpc("media_list_for_owner", { p_owner_type: "vehicle", p_owner_id: vehicleId, p_role_prefix: "arrival_", p_limit: 100 });
  if (error) throw new Error("media_list_for_owner: " + error.message);
  return getArrivalPhotoCompletion(data ?? []);
}

// The real upload pipeline: ticket, signed PUT, complete. Same calls the browser makes.
const photoBytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 120, b: 150 } } }).jpeg().toBuffer();
async function persistPhoto(session, ownerId, role) {
  const clientRequestId = crypto.randomUUID();
  const ticket = await fetch(BASE + "/api/media/upload-ticket", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: session.cookie },
    body: JSON.stringify({ ownerType: "vehicle", ownerId, clientRequestId, role, mimeType: "image/jpeg", sizeBytes: photoBytes.length }),
  });
  if (!ticket.ok) return { ok: false, stage: "ticket", status: ticket.status, body: await ticket.text() };
  const t = await ticket.json();
  const put = await fetch(t.uploadUrl, { method: "PUT", headers: { "content-type": t.contentType, "x-upsert": "true" }, body: photoBytes });
  if (!put.ok) return { ok: false, stage: "transfer", status: put.status };
  const done = await fetch(BASE + "/api/media/complete", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: session.cookie },
    body: JSON.stringify({ mediaId: t.mediaId }),
  });
  if (!done.ok) return { ok: false, stage: "complete", status: done.status, body: await done.text() };
  return { ok: true, mediaId: t.mediaId };
}

// 1. Canonical role names: the frontend list must equal the receive_vehicle SQL filter in the latest migration that defines it.
{
  const migrations = fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  let sqlRoles = null;
  for (const f of migrations) {
    const text = fs.readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8");
    if (!text.includes("function public.receive_vehicle")) continue;
    const m = text.match(/m\.role in \(([^)]*)\)/);
    if (m) sqlRoles = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  const frontRoles = ARRIVAL_PHOTO_SLOTS.map((s) => s.role);
  check("frontend roles equal the receive_vehicle SQL role list (latest migration)", JSON.stringify([...frontRoles].sort()) === JSON.stringify([...(sqlRoles ?? [])].sort()),
    `frontend=${frontRoles.join(",")} sql=${(sqlRoles ?? []).join(",")}`);
}

// 2. Helper: pure cases, no database.
{
  const at = (role, id) => ({ id, role });
  const none = getArrivalPhotoCompletion([]);
  check("0 of 4: incomplete, 4 missing", !none.complete && none.completedCount === 0 && none.missing.length === 4);
  const three = getArrivalPhotoCompletion([at("arrival_front", "1"), at("arrival_rear", "2"), at("arrival_left", "3")]);
  check("3 of 4: incomplete, right missing", !three.complete && three.completedCount === 3 && three.missing[0].id === "right");
  const four = getArrivalPhotoCompletion([at("arrival_right", "4"), at("arrival_left", "3"), at("arrival_rear", "2"), at("arrival_front", "1")]);
  check("4 of 4 in any order: complete", four.complete && four.completedCount === 4 && four.missing.length === 0);
  const wrong = getArrivalPhotoCompletion([at("arrival_front", "1"), at("arrival_rear", "2"), at("arrival_side", "3"), at("front", "4")]);
  check("wrong role names do not count", wrong.completedCount === 2 && !wrong.left && !wrong.right);
  const extra = getArrivalPhotoCompletion([at("arrival_front", "1"), at("arrival_rear", "2"), at("arrival_left", "3"), at("arrival_extra", "5")]);
  check("optional additional photo does not count toward 4", !extra.complete && extra.completedCount === 3);
  const replaced = getArrivalPhotoCompletion([at("arrival_rear", "new"), at("arrival_rear", "old"), at("arrival_front", "1")]);
  check("replacing a slot leaves one canonical role for that slot", replaced.rear && replaced.mediaIdBySlot.rear === "new" && replaced.completedCount === 2);
  const loading = getArrivalPhotoCompletion(undefined);
  check("no data yet is not 4 of 4", !loading.complete && loading.completedCount === 0);
}

// 3. Real DEV flow on a fresh TEST-ARR vehicle, then a second vehicle to prove media is scoped by owner id.
const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const auction = await signIn("auction");
const receiving = await signIn("receiving");
const fields = { year: 2021, make: "Ford", model: "Escape", purchase_price: 500 };
async function makeVehicle(tag) {
  const vin = ("1TA" + run + tag).padEnd(17, "0").slice(0, 17);
  const { data, error } = await auction.client.rpc("match_or_create_vehicle", { p_vin: vin, p_lot_number: "ARR" + run + tag, p_stock_number: null, p_auction_source: "TEST-ARR-" + run, p_fields: fields });
  if (error) throw new Error("fixture: " + error.message);
  return data.vehicle_id;
}
const target = await makeVehicle("A");
const other = await makeVehicle("B");

check("starts with 0 required arrival photos", (await completionFor(receiving, target)).completedCount === 0);

const steps = [["arrival_front", 1], ["arrival_rear", 2], ["arrival_left", 3], ["arrival_right", 4]];
for (const [role, n] of steps) {
  const saved = await persistPhoto(receiving, target, role);
  check(`persist ${role} through the media API`, saved.ok, saved.ok ? "" : `${saved.stage} ${saved.status} ${saved.body ?? ""}`.slice(0, 160));
  const c = await completionFor(receiving, target);
  check(`query shows ${n}/4 after ${role}`, c.completedCount === n && c.complete === (n === 4), `completedCount=${c.completedCount}`);
}
const full = await completionFor(receiving, target);
check("helper reports complete = true at 4/4", full.complete === true && full.missing.length === 0);

// Wrong role, other vehicle and optional photo must not change the four-slot count.
const wrongRole = await persistPhoto(receiving, target, "arrival_side");
check("a wrong role name is saved but does not count", wrongRole.ok && (await completionFor(receiving, target)).completedCount === 4);
const extraPhoto = await persistPhoto(receiving, target, "arrival_extra");
check("an additional photo does not change 4/4", extraPhoto.ok && (await completionFor(receiving, target)).completedCount === 4);
const otherPhoto = await persistPhoto(receiving, other, "arrival_left");
check("media on another vehicle does not count for this vehicle", otherPhoto.ok && (await completionFor(receiving, other)).completedCount === 1 && (await completionFor(receiving, target)).completedCount === 4);

// Replacing one slot: a second rear original is saved; the slot still counts once and 4/4 holds.
const replaceRear = await persistPhoto(receiving, target, "arrival_rear");
const afterReplace = await completionFor(receiving, target);
check("replacing rear keeps one canonical rear and 4/4", replaceRear.ok && afterReplace.complete && afterReplace.completedCount === 4);

// Reload: a new session reads the same persisted state.
const reloaded = await signIn("receiving");
check("reload returns 4/4 with the same slots", (await completionFor(reloaded, target)).complete === true);

// Server guard: the other vehicle (one photo) is refused; the target (four photos) is received.
const refusedRes = await receiving.client.rpc("receive_vehicle", { p_vehicle_id: other });
check("receive_vehicle still refuses a vehicle without four photos", !!refusedRes.error && /capture all 4 arrival photos/.test(refusedRes.error.message), refusedRes.error?.message ?? "no error");
const recv = await receiving.client.rpc("receive_vehicle", { p_vehicle_id: target });
check("receive_vehicle succeeds with four persisted photos and all other guards valid", !recv.error && recv.data?.receiving_status === "received", recv.error?.message ?? "");

console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
