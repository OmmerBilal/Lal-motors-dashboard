// Identity switching in one browser context (Playwright + installed Chrome, DEV accounts). No hard reload is used.
// Sequence, repeated for four sign-ins: root, login as Owner, dashboard, Sign out, login as the dismantling employee,
// employee app, Sign out. Asserts on every step: no "useSession must be used within SessionProvider", no React or
// Next runtime error overlay, the correct home for the role, no previous-user UI, and direct navigation per role.
// Passwords come only from environment variables: DEV_TEST_OWNER_PASSWORD and DEV_TEST_DISMANTLER_PASSWORD.
// Usage: BASE_URL=http://localhost:3100 DEV_TEST_OWNER_PASSWORD=... DEV_TEST_DISMANTLER_PASSWORD=... node scripts/dev-tests/ux-auth-switch.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadDevCredentials } from "./dev-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(ROOT + "/package.json");
const { chromium } = req("playwright-core");

const BASE = process.env.BASE_URL || "http://localhost:3100";
const owner = loadDevCredentials().find((u) => u.role === "owner");
const employee = { email: "dismantler@seed.lalmotors.test", password: process.env.DEV_TEST_DISMANTLER_PASSWORD || "" };
if (!owner?.password || owner.password.length < 8) { console.log("FAIL | owner password not provided (DEV_TEST_OWNER_PASSWORD)"); process.exit(1); }
if (!employee.password) { console.log("FAIL | employee password not provided (DEV_TEST_DISMANTLER_PASSWORD)"); process.exit(1); }
const shotDir = process.env.TEMP ? path.join(process.env.TEMP, "auth-switch") : path.join(ROOT, "auth-switch");
fs.mkdirSync(shotDir, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });

const noBadErrors = async (label) => {
  const bad = errors.filter((e) => /useSession must be used within SessionProvider|Runtime Error|Unhandled/i.test(e));
  const overlay = await page.locator("nextjs-portal, [data-nextjs-dialog-overlay]").count();
  check(`${label}: no SessionProvider or runtime error`, bad.length === 0 && overlay === 0, bad.slice(0, 2).join(" | ") || `overlay=${overlay}`);
  errors.length = 0;
};

async function signIn(email, password) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("#email").waitFor({ timeout: 30000 });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /Log in/ }).click();
}
async function signOut() {
  await page.getByRole("button", { name: "Sign out" }).first().click({ timeout: 30000 });
  await page.waitForURL(/\/login/, { timeout: 30000 }).catch(() => {});
}

// 1. Clean context: the root page sends a signed-out person to login, without an error.
await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
check("clean context: root sends signed-out person to /login", new URL(page.url()).pathname === "/login", page.url());
await noBadErrors("clean context root");

const transitions = [
  { who: "owner", email: owner.email, password: owner.password, home: "/dashboard", marker: /Owner Vehicle Dashboard|Central Dispatch/ },
  { who: "employee", email: employee.email, password: employee.password, home: "/dismantling", marker: /My Assigned Vehicles/ },
  { who: "owner", email: owner.email, password: owner.password, home: "/dashboard", marker: /Owner Vehicle Dashboard|Central Dispatch/ },
  { who: "employee", email: employee.email, password: employee.password, home: "/dismantling", marker: /My Assigned Vehicles/ },
];

for (let i = 0; i < transitions.length; i++) {
  const t = transitions[i];
  const n = i + 1;
  await signIn(t.email, t.password);
  await page.waitForURL(new RegExp(t.home.replace("/", "\\/") + "$"), { timeout: 45000 }).catch(() => {});
  check(`transition ${n}: ${t.who} lands on ${t.home}`, new URL(page.url()).pathname === t.home, page.url());
  await page.getByText(t.marker).first().waitFor({ timeout: 30000 }).catch(() => {});
  check(`transition ${n}: ${t.who} app renders`, (await page.getByText(t.marker).count()) >= 1);
  if (t.who === "employee") {
    check(`transition ${n}: no owner data after employee login`, (await page.getByText("Owner Vehicle Dashboard").count()) === 0 && (await page.getByText("Central Dispatch").count()) === 0);
  } else {
    check(`transition ${n}: no employee page after owner login`, (await page.getByText("My Assigned Vehicles").count()) === 0);
  }
  await noBadErrors(`transition ${n} (${t.who})`);
  await page.screenshot({ path: path.join(shotDir, `switch-${n}-${t.who}.png`) });

  // Direct navigation for this role.
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  check(`transition ${n}: root redirects ${t.who} to ${t.home}`, new URL(page.url()).pathname === t.home, page.url());
  if (t.who === "employee") {
    await page.goto(BASE + "/dismantling-processing", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    check(`transition ${n}: employee cannot open the manager processing screen`, !new URL(page.url()).pathname.startsWith("/dismantling-processing"), page.url());
  } else {
    await page.goto(BASE + "/dismantling-processing", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    check(`transition ${n}: owner opens dismantling processing`, new URL(page.url()).pathname.startsWith("/dismantling-processing"), page.url());
  }
  await noBadErrors(`transition ${n} direct navigation`);

  if (i < transitions.length - 1) {
    await page.goto(BASE + "/dashboard", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await signOut();
    check(`transition ${n}: sign out returns to /login`, new URL(page.url()).pathname === "/login", page.url());
    await noBadErrors(`transition ${n} sign out`);
  }
}

await context.close();
await browser.close();
console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
