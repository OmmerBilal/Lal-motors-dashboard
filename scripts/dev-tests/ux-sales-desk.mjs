// Front-desk sales, focused browser check (Playwright + installed Chrome, DEV). Owner account (DEV_TEST_OWNER_PASSWORD).
//   Parts Inventory: add a manual part through the dialog.
//   Sales Desk (1440): no part list before a search; search finds the part; Add keeps the search text and focus;
//     overpayment is refused on screen; partial checkout ($40 cash) shows Paid Now, Remaining and PARTIALLY PAID;
//     the customer history shows the outstanding balance and Receive Payment clears it;
//     a receipt prints as ONE page (print-layout PDF page count).
// Fixtures: one TEST-SALES customer and one TEST-SALES manual part. Nothing is deleted.
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

const parse = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const envLocal = parse(ROOT + "/.env.local");
const envPub = parse(ROOT + "/.env");
const SUPA = envPub.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL;
const PUB = envPub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envLocal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3100";
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const owner = loadDevCredentials().find((u) => u.role === "owner");
if (!owner?.password || owner.password.length < 8) { console.log("FAIL | owner password not provided (DEV_TEST_OWNER_PASSWORD)"); process.exit(1); }
const shotDir = process.env.TEMP ? path.join(process.env.TEMP, "sales-desk") : path.join(ROOT, "sales-desk");
fs.mkdirSync(shotDir, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
const newClient = () => createClient(SUPA, PUB, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const c = newClient();
const { data: sess, error: sErr } = await c.auth.signInWithPassword({ email: owner.email, password: owner.password });
if (sErr) { console.log("FAIL | owner sign-in"); process.exit(1); }
const value = "base64-" + Buffer.from(JSON.stringify(sess.session), "utf8").toString("base64url");
const CH = 3180;
const chunks = value.length <= CH ? [[COOKIE, value]] : Array.from({ length: Math.ceil(value.length / CH) }, (_, i) => [`${COOKIE}.${i}`, value.slice(i * CH, (i + 1) * CH)]);

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const first = "SalesDesk" + run;
const phone = "+1555" + String(Math.floor(1000000 + Math.random() * 8999999));
const cust = await c.rpc("create_customer", { p_data: { first_name: first, last_name: "Test", phone, email: "" }, p_client_request_id: crypto.randomUUID() });
if (cust.error) { console.log("FAIL | fixture customer: " + cust.error.message); process.exit(1); }
const partName = "TEST Manual Desk Part " + run;

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies(chunks.map(([n, v]) => ({ name: n, value: v, url: BASE })));
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror " + e.message.slice(0, 140)));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push("console " + m.text().slice(0, 140)); });

// 1. Add a manual inventory part from Parts Inventory.
await page.goto(BASE + "/parts", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.getByRole("button", { name: /Inventory/ }).first().click().catch(() => {});
await page.getByRole("button", { name: /Add Inventory Part/ }).first().click();
await page.getByLabel(/Part Name/).fill(partName);
await page.getByLabel(/Quantity/).fill("5");
await page.getByLabel(/Selling Price/).fill("25");
await page.getByRole("button", { name: "Add Inventory Part" }).click();
const added = await page.getByText("Inventory part added", { exact: false }).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
check("manual part: added from Parts Inventory", added || (await page.getByText("Part photo").count()) >= 1);
await page.getByRole("button", { name: "Done" }).click().catch(() => {});

// 2. Sales Desk: nothing listed before a search.
await page.goto(BASE + "/sales", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
check("desk: no part list before any search", (await page.locator('[data-testid="pos-part-card"]').count()) === 0 && (await page.getByText("Search for a part to add it to the sale.").count()) === 1);

// 3. Select the customer.
await page.getByPlaceholder("Name, phone, company or email").fill(first);
const option = page.locator('[data-testid="pos-customer-option"]').first();
await option.waitFor({ state: "visible", timeout: 30000 });
await option.click();
await page.waitForTimeout(800);
check("customer: the test customer is selected", (await page.locator('[data-testid="pos-customer-option"]').count()) === 0);

// 4. Search needs two characters; the manual part is found; Add keeps the search and focus.
const partSearch = page.getByLabel("Search parts");
await partSearch.fill("T");
await page.waitForTimeout(600);
check("search: one character lists nothing", (await page.locator('[data-testid="pos-part-card"]').count()) === 0);
await partSearch.fill(partName);
await page.locator('[data-testid="pos-part-card"]').first().waitFor({ timeout: 30000 }).catch(() => {});
check("search: the manual part is found", (await page.locator('[data-testid="pos-part-card"]').count()) >= 1);
await page.locator('[data-testid="pos-part-card"]').first().getByRole("button", { name: "Add" }).click();
await page.waitForTimeout(400);
const kept = (await partSearch.inputValue()) === partName;
const focused = await partSearch.evaluate((el) => document.activeElement === el);
check("add: the search keeps its text and focus for the next part", kept && focused);
await page.screenshot({ path: path.join(shotDir, "desk-1440-after-add.png"), fullPage: false });

// 5. Overpayment is refused on screen.
const paid = page.locator("#amount-paid");
await paid.fill("999999");
await page.waitForTimeout(200);
check("overpayment: the desk refuses an amount above the total", (await page.getByText(/more than the total/).count()) >= 1 && (await page.getByRole("button", { name: "Complete Sale" }).isDisabled()));

// 6. Partial checkout: $10 cash on a $25 sale (the sale total is the manual part, $25).
await paid.fill("10");
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Complete Sale" }).click();
await page.getByText(/complete$/).first().waitFor({ timeout: 60000 }).catch(() => {});
const doneText = await page.locator("body").innerText();
check("checkout: success screen shows the sale as complete", /Sale S-\S+ complete|Sale .+ complete/.test(doneText));
check("checkout: success shows Paid Now $10.00 and Remaining Balance", /Paid Now\s*\$10\.00/.test(doneText) && /Remaining Balance\s*\$\d/.test(doneText));
check("checkout: payment status is PARTIALLY PAID with Balance Due", /PARTIALLY PAID/.test(doneText) && /Balance Due:\s*\$\d/.test(doneText));
await page.screenshot({ path: path.join(shotDir, "desk-1440-success.png"), fullPage: false });

// 7. Receipt: print layout produces ONE page.
await page.getByRole("button", { name: /Print Receipt/ }).click();
await page.waitForTimeout(800);
await page.emulateMedia({ media: "print" });
const pdf = await page.pdf({ format: "A4", printBackground: true });
const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
check("receipt: the ordinary receipt prints as exactly one page", pages === 1, `pages=${pages}`);
await page.emulateMedia({ media: "screen" });

// 8. Customer balance and Receive Payment from the customer history.
await page.getByRole("button", { name: /Customer History|History/ }).first().click().catch(() => {});
await page.getByText("Total Outstanding Balance").waitFor({ timeout: 30000 }).catch(() => {});
await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Receive Payment"); return !!b && !b.disabled; }, null, { timeout: 30000 }).catch(() => {});
const outText = await page.locator("body").innerText();
check("balance: customer shows an outstanding balance after the partial sale", /Total Outstanding Balance\s*\$15\.00/.test(outText));
await page.getByRole("button", { name: "Receive Payment" }).first().click();
const outMatch = outText.match(/Total Outstanding Balance\s*\$([\d,]+\.\d{2})/);
const outstanding = outMatch ? outMatch[1].replace(/,/g, "") : "0";
await page.getByLabel("Amount Received").fill(outstanding);
await page.getByRole("button", { name: "Receive Payment" }).last().click();
await page.getByText("Received $").first().waitFor({ timeout: 30000 }).catch(() => {});
const recvText = await page.locator("body").innerText();
check("receive: the remaining balance is received and posted", /Posted\./.test(recvText) && /Remaining customer balance:\s*\$0\.00/.test(recvText));
await page.getByRole("button", { name: "Done" }).first().click().catch(() => {});

// 9. Layout at 390: no horizontal overflow on the desk.
await page.setViewportSize({ width: 390, height: 900 });
await page.goto(BASE + "/sales", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
const ov = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
check("layout: the desk has no horizontal overflow at 390", ov.scroll <= ov.inner + 1, `inner=${ov.inner} scroll=${ov.scroll}`);

check("no React or page errors", problems.length === 0, problems.slice(0, 3).join(" | "));
await browser.close();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
console.log(`screenshots: ${shotDir}`);
process.exit(fail === 0 ? 0 : 1);
