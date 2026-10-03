import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { createClient } = req("@supabase/supabase-js");
const sharp = req("sharp");
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
const SECRET = envLocal.secret_key;
const REF = new URL(SUPA).hostname.split(".")[0];
const COOKIE = `sb-${REF}-auth-token`;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const creds = JSON.parse(fs.readFileSync(ROOT + "/dev-test-credentials.json", "utf8"));
const byRole = Object.fromEntries(creds.map((u) => [u.role, u]));
const pgc = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await pgc.connect();
const admin = createClient(SUPA, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

function cookieHeader(session) {
  const b64 = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const CHUNK = 3180;
  if (b64.length <= CHUNK) return `${COOKIE}=${b64}`;
  const parts = [];
  for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));
  return parts.map((p, i) => `${COOKIE}.${i}=${p}`).join("; ");
}
async function cookieFor(u) {
  const c = createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + u.role + ": " + error.message);
  return cookieHeader(data.session);
}

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

async function api(cookie, method, path, body) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

const partRow = (await pgc.query("select id from public.parts order by id limit 1")).rows[0];
const dismantleCookie = await cookieFor(byRole.dismantling);
const driverCookie = await cookieFor(byRole.scrap_driver);
const created = []; // media ids to clean
const objects = []; // {bucket, path}

const png = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#4a6b8a" } }).png().toBuffer();
const clientRequestId = crypto.randomUUID();

// 1. Ticket (positive)
const t1 = await api(dismantleCookie, "POST", "/api/media/upload-ticket", { ownerType: "part", ownerId: partRow.id, clientRequestId, role: "capture", mimeType: "image/png", sizeBytes: png.length });
check("dismantling: upload ticket for part", t1.status === 201 && !!t1.json?.uploadUrl, `status=${t1.status}`);
const mediaId = t1.json?.mediaId;
if (mediaId) { created.push(mediaId); objects.push({ bucket: t1.json.bucket, path: t1.json.path }); }

// 2. Bytes PUT to signed URL
if (t1.json?.uploadUrl) {
  const put = await fetch(t1.json.uploadUrl, { method: "PUT", headers: { "content-type": "image/png", "x-upsert": "true" }, body: png });
  check("bytes uploaded to signed URL", put.status === 200, `status=${put.status}`);
}

// 3. Completion creates medium + thumbnail
const c1 = await api(dismantleCookie, "POST", "/api/media/complete", { mediaId });
check("complete: variants created", c1.status === 200 && !!c1.json?.variants?.thumbnail && !!c1.json?.variants?.medium, `status=${c1.status} w=${c1.json?.width} h=${c1.json?.height}`);

// 4. Idempotent retry of the ticket and completion
const t2 = await api(dismantleCookie, "POST", "/api/media/upload-ticket", { ownerType: "part", ownerId: partRow.id, clientRequestId, role: "capture", mimeType: "image/png", sizeBytes: png.length });
check("retry ticket returns same media row (no duplicate)", t2.status === 200 && t2.json?.mediaId === mediaId && t2.json?.alreadyExisted === true, `status=${t2.status}`);
const c2 = await api(dismantleCookie, "POST", "/api/media/complete", { mediaId });
check("retry complete is idempotent", c2.status === 200 && c2.json?.variants?.thumbnail === c1.json?.variants?.thumbnail);
const dupCount = (await pgc.query("select count(*)::int c from public.media_assets where owner_type='part' and owner_id=$1 and storage_path like $2", [partRow.id, `%${clientRequestId}%`])).rows[0].c;
check("exactly 3 rows (original + medium + thumbnail) for this upload", dupCount === 3, `rows=${dupCount}`);

// 5. Read URLs: thumbnail is small webp, original on explicit request
const u1 = await api(dismantleCookie, "GET", `/api/media/url?mediaId=${mediaId}&variant=thumbnail`);
check("thumbnail read URL issued", u1.status === 200 && !!u1.json?.url, `status=${u1.status}`);
if (u1.json?.url) {
  const img = await fetch(u1.json.url);
  const buf = Buffer.from(await img.arrayBuffer());
  const meta = await sharp(buf).metadata();
  check("thumbnail bytes are WebP and <= 400px", img.status === 200 && meta.format === "webp" && Math.max(meta.width, meta.height) <= 400, `fmt=${meta.format} ${meta.width}x${meta.height} bytes=${buf.length}`);
}
const u2 = await api(dismantleCookie, "GET", `/api/media/url?mediaId=${mediaId}&variant=medium`);
check("medium read URL issued", u2.status === 200 && !!u2.json?.url);
const u3 = await api(dismantleCookie, "GET", `/api/media/url?mediaId=${mediaId}&variant=original`);
check("original read URL issued on explicit request", u3.status === 200 && !!u3.json?.url);

// 6. Cross-role and bad-target denial
const d1 = await api(driverCookie, "GET", `/api/media/url?mediaId=${mediaId}&variant=thumbnail`);
check("scrap driver cannot read a part photo", d1.status === 404, `status=${d1.status}`);
const d2 = await api(driverCookie, "POST", "/api/media/complete", { mediaId });
check("scrap driver cannot complete a part photo", d2.status === 404, `status=${d2.status}`);
const d3 = await api(driverCookie, "POST", "/api/media/upload-ticket", { ownerType: "part", ownerId: partRow.id, clientRequestId: crypto.randomUUID(), mimeType: "image/png", sizeBytes: 100 });
check("scrap driver cannot attach a photo to a part", d3.status === 403, `status=${d3.status}`);
const d4 = await api(dismantleCookie, "POST", "/api/media/upload-ticket", { ownerType: "part", ownerId: crypto.randomUUID(), clientRequestId: crypto.randomUUID(), mimeType: "image/png", sizeBytes: 100 });
check("nonexistent owner record is refused (owner existence check)", d4.status === 403, `status=${d4.status}`);
const d5 = await api(dismantleCookie, "POST", "/api/media/upload-ticket", { ownerType: "export_invoice", ownerId: partRow.id, clientRequestId: crypto.randomUUID(), mimeType: "image/png", sizeBytes: 100 });
check("dismantling cannot attach export-confidential media", d5.status === 403 || d5.status === 400, `status=${d5.status}`);
const a1 = await api(null, "POST", "/api/media/upload-ticket", { ownerType: "part", ownerId: partRow.id, clientRequestId: crypto.randomUUID(), mimeType: "image/png", sizeBytes: 100 });
check("anonymous API call gets 401 JSON", a1.status === 401 && a1.json?.error?.code === "unauthenticated", `status=${a1.status}`);

// 7. Input validation
const v1 = await api(dismantleCookie, "POST", "/api/media/upload-ticket", { ownerType: "part", ownerId: partRow.id, clientRequestId: crypto.randomUUID(), mimeType: "text/html", sizeBytes: 100 });
check("disallowed MIME rejected (400)", v1.status === 400, `status=${v1.status}`);
const v2 = await api(dismantleCookie, "POST", "/api/media/upload-ticket", { ownerType: "part", ownerId: partRow.id, clientRequestId: crypto.randomUUID(), mimeType: "image/png", sizeBytes: 20 * 1024 * 1024 });
check("oversize file rejected (400)", v2.status === 400, `status=${v2.status}`);
const v3 = await api(dismantleCookie, "POST", "/api/media/upload-ticket", { ownerType: "part; drop", ownerId: partRow.id, clientRequestId: crypto.randomUUID(), mimeType: "image/png", sizeBytes: 100 });
check("unknown owner type rejected (400)", v3.status === 400, `status=${v3.status}`);

// 8. Non-image bytes declared as PNG are marked failed, never turned into variants
const fakeId = crypto.randomUUID();
const t3 = await api(dismantleCookie, "POST", "/api/media/upload-ticket", { ownerType: "part", ownerId: partRow.id, clientRequestId: fakeId, mimeType: "image/png", sizeBytes: 12 });
if (t3.json?.mediaId) {
  created.push(t3.json.mediaId); objects.push({ bucket: t3.json.bucket, path: t3.json.path });
  await fetch(t3.json.uploadUrl, { method: "PUT", headers: { "content-type": "image/png", "x-upsert": "true" }, body: Buffer.from("not an image") });
  const c3 = await api(dismantleCookie, "POST", "/api/media/complete", { mediaId: t3.json.mediaId });
  const st = (await pgc.query("select status from public.media_assets where id=$1", [t3.json.mediaId])).rows[0]?.status;
  check("fake image is rejected and marked failed", c3.status === 400 && st === "failed", `status=${c3.status} row=${st}`);
}

// 9. Direct Storage bypass: object read/list with a user JWT must fail
const sess = createClient(SUPA, PUB, { auth: { persistSession: false } });
await sess.auth.signInWithPassword({ email: byRole.dismantling.email, password: byRole.dismantling.password });
const direct = await sess.storage.from("operational-media").download(mediaId ? (t1.json.path) : "x");
check("direct client download of operational object is blocked", !!direct.error, direct.error ? "denied" : "BYTES RETURNED");
const listed = await sess.storage.from("operational-media").list(`part/${partRow.id}`);
check("direct client list of operational bucket is empty or blocked", !!listed.error || (listed.data?.length ?? 0) === 0, listed.error ? "denied" : `items=${listed.data?.length}`);
const anon = createClient(SUPA, PUB, { auth: { persistSession: false } });
const anonDl = await anon.storage.from("confidential-export-media").list("");
check("anonymous cannot list confidential bucket", !!anonDl.error || (anonDl.data?.length ?? 0) === 0, anonDl.error ? "denied" : `items=${anonDl.data?.length}`);

// Cleanup (DEV only): remove objects this test created and their rows.
for (const o of objects) await admin.storage.from(o.bucket).remove([o.path]).catch(() => {});
const ids = created;
if (ids.length) {
  await pgc.query("delete from public.media_assets where variant_of = any($1::uuid[])", [ids]);
  await pgc.query("delete from public.media_assets where id = any($1::uuid[])", [ids]);
}
const leftovers = (await pgc.query("select count(*)::int c from public.media_assets where storage_path like $1", [`%${clientRequestId}%`])).rows[0].c;
check("cleanup removed test rows", leftovers === 0, `left=${leftovers}`);
await pgc.end();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
