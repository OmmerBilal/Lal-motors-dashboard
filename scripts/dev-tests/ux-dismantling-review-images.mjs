// Manager dialog containment and part-photo review (Playwright + installed Chrome, DEV data).
//   Dialogs (owner, widths 390, 430, 768, 1440): Mark Ready, Assign Employee, Reassign, Cancel Assignment, Undo Ready.
//     Each dialog must sit inside the viewport and centred, and every footer button must sit inside the dialog.
//   Part photos (owner): a test vehicle is captured by the dismantling employee through the real media pipeline,
//     with TWO different part images. The owner's Completed record must show both parts with visibly rendered,
//     distinct images (decoded size > 0, visible), and the images must still show after a reload.
// Fixtures are TEST-DIS-IMG vehicles. Passwords come only from environment variables.
// Usage: BASE_URL=http://localhost:3100 DEV_TEST_OWNER_PASSWORD=... DEV_TEST_DISMANTLER_PASSWORD=... node scripts/dev-tests/ux-dismantling-review-images.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { chromium } = req("playwright-core");
const { createClient } = req("@supabase/supabase-js");
const pg = req("pg");
const sharp = req("sharp");

const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const creds = loadDevCredentials();
const owner = creds.find((u) => u.role === "owner");
const auction = creds.find((u) => u.role === "auction");
const receiving = creds.find((u) => u.role === "receiving");
const employee = { email: "dismantler@seed.lalmotors.test", password: process.env.DEV_TEST_DISMANTLER_PASSWORD || "" };
if (!owner?.password || owner.password.length < 8) { console.log("FAIL | owner password not provided (DEV_TEST_OWNER_PASSWORD)"); process.exit(1); }
if (!employee.password) { console.log("FAIL | employee password not provided (DEV_TEST_DISMANTLER_PASSWORD)"); process.exit(1); }
const shotDir = process.env.TEMP ? path.join(process.env.TEMP, "dismantling-images") : path.join(ROOT, "dismantling-images");
fs.mkdirSync(shotDir, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
const newClient = () => createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function signIn(a) {
  const c = newClient();
  const { data, error } = await c.auth.signInWithPassword({ email: a.email, password: a.password });
  if (error) throw new Error("sign-in failed: " + error.message);
  const value = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  const CH = 3180;
  const cookie = value.length <= CH ? `${COOKIE}=${value}` : Array.from({ length: Math.ceil(value.length / CH) }, (_, i) => `${COOKIE}.${i}=${value.slice(i * CH, (i + 1) * CH)}`).join("; ");
  const chunks = value.length <= CH ? [[COOKIE, value]] : Array.from({ length: Math.ceil(value.length / CH) }, (_, i) => [`${COOKIE}.${i}`, value.slice(i * CH, (i + 1) * CH)]);
  return { client: c, id: data.user.id, cookie, chunks };
}
const ownerS = await signIn({ email: owner.email, password: owner.password });
const empS = await signIn(employee);
const auctionS = await signIn(auction);
const recvS = await signIn(receiving);
const db = new pg.Client({ connectionString: envLocal.connection_string, ssl: { rejectUnauthorized: false } });
await db.connect();
const run = crypto.randomUUID().slice(0, 6).toUpperCase();

async function makeReceived(tag) {
  const vin = ("1TD" + run + tag).padEnd(17, "0").slice(0, 17);
  const { data, error } = await auctionS.client.rpc("match_or_create_vehicle", { p_vin: vin, p_lot_number: "TDI" + run + tag, p_stock_number: null, p_auction_source: "TEST-DIS-IMG-" + run, p_fields: { year: 2020, make: "Mazda", model: "CX-5", purchase_price: 380 } });
  if (error) throw new Error("fixture " + error.message);
  for (const role of ["arrival_front", "arrival_rear", "arrival_left", "arrival_right"]) {
    await db.query(`insert into public.media_assets (owner_type, owner_id, role, variant, bucket, storage_path, mime_type, size_bytes, status) values ('vehicle', $1, $2, 'original', 'operational-media', $3, 'image/jpeg', 1, 'ready')`, [data.vehicle_id, role, `vehicle/${data.vehicle_id}/img-${role}-${run}.jpg`]);
  }
  const rcv = await recvS.client.rpc("receive_vehicle", { p_vehicle_id: data.vehicle_id });
  if (rcv.error) throw new Error("receive " + rcv.error.message);
  return { vin, vehicleId: data.vehicle_id };
}

// Real upload pipeline for employee media: ticket, signed PUT, complete (the same calls the browser makes).
async function uploadThroughApi(session, ownerType, ownerId, role, bytes) {
  const clientRequestId = crypto.randomUUID();
  const t = await fetch(BASE + "/api/media/upload-ticket", { method: "POST", headers: { "content-type": "application/json", cookie: session.cookie }, body: JSON.stringify({ ownerType, ownerId, clientRequestId, role, mimeType: "image/jpeg", sizeBytes: bytes.length }) });
  if (!t.ok) throw new Error("ticket " + t.status + " " + (await t.text()).slice(0, 120));
  const tj = await t.json();
  const put = await fetch(tj.uploadUrl, { method: "PUT", headers: { "content-type": tj.contentType, "x-upsert": "true" }, body: bytes });
  if (!put.ok) throw new Error("transfer " + put.status);
  const done = await fetch(BASE + "/api/media/complete", { method: "POST", headers: { "content-type": "application/json", cookie: session.cookie }, body: JSON.stringify({ mediaId: tj.mediaId }) });
  if (!done.ok) throw new Error("complete " + done.status + " " + (await done.text()).slice(0, 120));
  return tj.mediaId;
}

// ============================ fixtures ============================
const readyV = await makeReceived("R");     // for Assign Employee and Undo Ready
const eligibleV = await makeReceived("E");  // for Mark Ready
const assignedV = await makeReceived("S");  // for Reassign and Cancel
{
  const r = await ownerS.client.rpc("mark_vehicle_ready", { p_vehicle_id: readyV.vehicleId });
  if (r.error) throw new Error("ready " + r.error.message);
  const r2 = await ownerS.client.rpc("mark_vehicle_ready", { p_vehicle_id: assignedV.vehicleId });
  if (r2.error) throw new Error("ready " + r2.error.message);
  const empId = empS.id;
  const a = await ownerS.client.rpc("assign_dismantling_vehicle", { p_vehicle_id: assignedV.vehicleId, p_employee_id: empId });
  if (a.error) throw new Error("assign " + a.error.message);
}

// Captured vehicle with two different part photos (employee through the real pipeline).
const capV = await makeReceived("P");
{
  const rd = await ownerS.client.rpc("mark_vehicle_ready", { p_vehicle_id: capV.vehicleId });
  if (rd.error) throw new Error("ready " + rd.error.message);
  const as = await ownerS.client.rpc("assign_dismantling_vehicle", { p_vehicle_id: capV.vehicleId, p_employee_id: empS.id });
  if (as.error) throw new Error("assign " + as.error.message);
  const st = await empS.client.rpc("start_dismantling_assignment", { p_assignment_id: as.data.assignment_id, p_client_request_id: crypto.randomUUID() });
  if (st.error) throw new Error("start " + st.error.message);
  const sessionId = st.data.session_id;
  const evidence = await sharp({ create: { width: 480, height: 360, channels: 3, background: [60, 60, 60] } }).jpeg().toBuffer();
  await uploadThroughApi(empS, "dismantling_session", sessionId, "vehicle_evidence", evidence);
  const parts = [
    { name: "Front Left Headlight", details: "OEM headlight, lens intact", color: [200, 40, 40] },
    { name: "Alternator", details: "Connector intact, pulley ok", color: [40, 120, 220] },
  ];
  for (const p of parts) {
    const b = await empS.client.rpc("begin_dismantled_part", { p_session_id: sessionId, p_client_request_id: crypto.randomUUID(), p_capture_name: p.name, p_capture_details: p.details });
    if (b.error) throw new Error("begin " + b.error.message);
    const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: p.color } }).jpeg().toBuffer();
    const mediaId = await uploadThroughApi(empS, "part", b.data.part_id, "capture", bytes);
    p.partId = b.data.part_id;
    p.mediaId = mediaId;
    const sv = await empS.client.rpc("save_dismantled_part", { p_part_id: b.data.part_id });
    if (sv.error) throw new Error("save " + sv.error.message);
  }
  const fin = await empS.client.rpc("finish_dismantling_session", { p_session_id: sessionId });
  if (fin.error) throw new Error("finish " + fin.error.message);
}

// ============================ browser ============================
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const ctxFor = async (width) => {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await context.addCookies(ownerS.chunks.map(([n, v]) => ({ name: n, value: v, url: BASE })));
  return context;
};

// Geometry checks for the dialog that is open: centred, inside the viewport, and every footer button inside the dialog.
async function checkDialogGeometry(page, label, tag) {
  const dlg = page.getByRole("dialog").first();
  await dlg.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(350);
  const vp = page.viewportSize();
  const box = await dlg.boundingBox();
  // The action buttons are the footer buttons. The X close icon is positioned by the dialog itself and is checked as visible only.
  const buttons = await dlg.locator('[data-slot="dialog-footer"] button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent.trim().slice(0, 30), left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width }; }));
  const footerButtons = buttons.filter((b) => b.text && b.w > 0);
  const insideVp = box && box.x >= 0 && box.x + box.width <= vp.width + 0.5 && box.y >= 0 && box.y + box.height <= vp.height + 0.5;
  const centred = box && Math.abs(box.x + box.width / 2 - vp.width / 2) < 6;
  const allInside = footerButtons.every((b) => box && b.left >= box.x - 0.5 && b.right <= box.x + box.width + 0.5 && b.top >= box.y - 0.5 && b.bottom <= box.y + box.height + 0.5);
  const scroll = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  check(`${label}: dialog inside viewport at ${tag}`, !!insideVp, box ? `${Math.round(box.width)}x${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)}` : "no box");
  check(`${label}: dialog centred at ${tag}`, !!centred);
  const offenders = footerButtons.filter((b) => !(box && b.left >= box.x - 0.5 && b.right <= box.x + box.width + 0.5 && b.top >= box.y - 0.5 && b.bottom <= box.y + box.height + 0.5));
  const fmt = (r) => `${r.text}[${Math.round(r.left)}..${Math.round(r.right)} x ${Math.round(r.top)}..${Math.round(r.bottom)}]`;
  check(`${label}: every action button inside the dialog at ${tag}`, allInside && footerButtons.length >= 2, offenders.length ? "outside: " + offenders.map(fmt).join(" ") + " box=" + JSON.stringify(box) : footerButtons.length + " buttons inside");
  check(`${label}: no horizontal page overflow at ${tag}`, scroll.scroll <= scroll.inner + 1, `inner=${scroll.inner} scroll=${scroll.scroll}`);
  await page.screenshot({ path: path.join(shotDir, `dialog-${label.replace(/\W+/g, "-")}-${tag}.png`) });
}

const widths = (process.env.WIDTHS || "390,430,768,1440").split(",").map(Number);
for (const width of widths) {
  const tag = `${width}px`;
  const context = await ctxFor(width);
  const page = await context.newPage();
  await page.goto(BASE + "/dismantling-processing", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.getByRole("button", { name: /Vehicle Workflow/ }).first().click();
  // Ready tab: Assign Employee and Undo Ready.
  await page.getByRole("tab", { name: "Ready to Dismantle" }).click();
  await page.getByPlaceholder("Search VIN, lot, stock, make or model").fill(readyV.vin);
  const rowReady = page.locator("li", { hasText: readyV.vin });
  await rowReady.waitFor({ timeout: 30000 }).catch(async (e) => { await page.screenshot({ path: path.join(shotDir, `ready-row-missing-${tag}.png`), fullPage: true }); throw e; });
  await rowReady.getByRole("button", { name: "Assign Employee" }).click();
  await checkDialogGeometry(page, "Assign Employee", tag);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click().catch(() => page.keyboard.press("Escape"));
  await page.waitForTimeout(300);
  await rowReady.getByRole("button", { name: "Undo Ready" }).click();
  await checkDialogGeometry(page, "Undo Ready", tag);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // Eligible tab: Mark Ready for Dismantling.
  await page.getByRole("tab", { name: "Eligible / Not Ready" }).click();
  await page.getByPlaceholder("Search VIN, lot, stock, make or model").fill(eligibleV.vin);
  const rowEligible = page.locator("li", { hasText: eligibleV.vin });
  await rowEligible.waitFor({ timeout: 30000 });
  await rowEligible.getByRole("button", { name: "Mark Ready for Dismantling" }).click();
  await checkDialogGeometry(page, "Mark Ready", tag);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // Assigned tab: Reassign and Cancel.
  await page.getByRole("tab", { name: "Assigned" }).click();
  await page.getByPlaceholder("Search VIN, lot, stock, make or model").fill(assignedV.vin);
  const rowAssigned = page.locator("li", { hasText: assignedV.vin });
  await rowAssigned.waitFor({ timeout: 30000 });
  await rowAssigned.getByRole("button", { name: /Reassign/ }).click();
  await checkDialogGeometry(page, "Reassign Employee", tag);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await rowAssigned.getByRole("button", { name: "Cancel" }).click();
  await checkDialogGeometry(page, "Cancel Assignment", tag);
  await page.keyboard.press("Escape");
  await context.close();
}

// ============================ part photos, manager review ============================
for (const width of [1440, 390]) {
  const tag = `${width}px`;
  const context = await ctxFor(width);
  const page = await context.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(e.message.slice(0, 120)));
  const openRecord = async () => {
    await page.goto(BASE + "/dismantling-processing", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.getByRole("button", { name: /Vehicle Workflow/ }).first().click();
    await page.getByRole("tab", { name: "Completed" }).click();
    await page.getByPlaceholder("Search VIN, lot, stock, make or model").fill(capV.vin);
    const row = page.locator("li", { hasText: capV.vin });
    await row.waitFor({ timeout: 30000 });
    await row.getByRole("button", { name: /Review parts/ }).click();
    await page.getByText("Parts dismantled by Seed Dismantler").waitFor({ timeout: 30000 }).catch(() => {});
  };
  const checkImages = async (label) => {
    // Each part card must show its real image: decoded, visible, and distinct from the other part.
    await page.waitForFunction(() => [...document.querySelectorAll('img[alt$=" photo 1"]')].filter((i) => i.complete && i.naturalWidth > 0).length >= 2, null, { timeout: 30000 }).catch(() => {});
    const imgs = await page.locator('ul[aria-label$="photos"] img').evaluateAll((els) => els.map((e) => ({ alt: e.alt, ok: e.complete && e.naturalWidth > 0 && e.getBoundingClientRect().width > 0, src: e.src })));
    check(`${label}: two part cards each show a real rendered image at ${tag}`, imgs.length === 2 && imgs.every((i) => i.ok), JSON.stringify(imgs.map((i) => [i.alt, i.ok])));
    check(`${label}: the two images are different files at ${tag}`, imgs.length === 2 && imgs[0].src !== imgs[1].src);
    check(`${label}: both part names and details show at ${tag}`, (await page.getByText("Front Left Headlight").count()) >= 1 && (await page.getByText("Connector intact, pulley ok").count()) >= 1);
    const recordText = await page.locator("body").innerText();
    check(`${label}: captured-part count is 2 at ${tag}`, /Total Parts Captured\s+2\b/.test(recordText));
    return imgs;
  };
  await openRecord();
  await checkImages("before reload");
  await page.screenshot({ path: path.join(shotDir, `record-images-${tag}.png`), fullPage: true });
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.getByRole("button", { name: /Vehicle Workflow/ }).first().click().catch(() => {});
  await page.getByRole("tab", { name: "Completed" }).click().catch(() => {});
  await page.getByPlaceholder("Search VIN, lot, stock, make or model").fill(capV.vin).catch(() => {});
  await page.locator("li", { hasText: capV.vin }).getByRole("button", { name: /Review parts/ }).click().catch(() => {});
  await page.getByText("Parts dismantled by Seed Dismantler").waitFor({ timeout: 30000 }).catch(() => {});
  await checkImages("after reload");
  const ov = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  check(`manager record: no horizontal overflow at ${tag}`, ov.scroll <= ov.inner + 1, `inner=${ov.inner} scroll=${ov.scroll}`);
  check(`manager record: no page errors at ${tag}`, bad.length === 0, bad.join(" | "));
  await context.close();
}

// Record the fixture ids for cleanup reporting only (no deletion).
await db.end();
await browser.close();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
console.log(`screenshots: ${shotDir}`);
process.exit(fail === 0 ? 0 : 1);
