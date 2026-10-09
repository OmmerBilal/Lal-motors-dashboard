// Navigation and role-access (src/lib/nav.ts, src/lib/auth/route-access.ts). Pure data/function checks, no DB and
// no running server: confirms the owner/admin sidebar no longer shows "Dismantling Employee App", that "Vehicle
// Dismantling Processing" is still there, and that nothing about route access or the dismantling employee's own
// navigation changed. Server-enforced route access (can a signed-in role actually reach a route) is exercised
// against a live server by route-gate.mjs, run separately as a regression.
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
register(pathToFileURL(path.join(ROOT, "scripts/dev-tests/_ts-alias-loader.mjs")).href, import.meta.url);
const { getPrimaryNav, ownerPreviews } = await import(pathToFileURL(path.join(ROOT, "src/lib/nav.ts")).href);
const { isRouteAllowed, homeForRole, ROLE_KEYS } = await import(pathToFileURL(path.join(ROOT, "src/lib/auth/route-access.ts")).href);

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

// 1. Owner/admin sidebar: the redundant entry is gone; the real management tool is still there.
const ownerNav = getPrimaryNav("owner");
check("owner sidebar: 'Dismantling Employee App' is removed", !ownerNav.some((n) => n.label === "Dismantling Employee App"), ownerNav.map((n) => n.label).join(", "));
check("owner sidebar: 'Vehicle Dismantling Processing' is still present", ownerNav.some((n) => n.label === "Vehicle Dismantling Processing" && n.href === "/dismantling-processing"));
check("owner sidebar: no entry points at /preview/dismantling", !ownerNav.some((n) => n.href === "/preview/dismantling"));

// 2. The preview route itself is not deleted: it still has a title (ownerPreviews is used for the page header,
// not the sidebar) and route-access still allows the owner to open it directly.
check("preview catalog: the Dismantling Employee App preview entry itself is preserved (route not deleted)", ownerPreviews.some((p) => p.label === "Dismantling Employee App" && p.href === "/preview/dismantling" && p.role === "dismantling"));
check("route access: the owner can still open /preview/dismantling directly (route not deleted)", isRouteAllowed("/preview/dismantling", ["owner"]));

// 3. The assigned dismantling employee's own navigation and route access are completely unchanged.
const dismantlingNav = getPrimaryNav("dismantling");
check("dismantling employee: their own sidebar still has Dismantling Employee App at /dismantling", dismantlingNav.some((n) => n.label === "Dismantling Employee App" && n.href === "/dismantling"));
check("route access: the dismantling employee can reach /dismantling", isRouteAllowed("/dismantling", ["dismantling"]));
check("route access: the dismantling employee is refused /team (owner only)", !isRouteAllowed("/team", ["dismantling"]));
check("home route: the dismantling employee's home is unchanged (/dismantling)", homeForRole("dismantling") === "/dismantling");

// 4. engineer_admin keeps its own real (non-preview) dismantling entry — a different role, out of this task's scope.
const engineerNav = getPrimaryNav("engineer_admin");
check("engineer_admin: still has its own Dismantling Employee App entry (different role, unaffected)", engineerNav.some((n) => n.label === "Dismantling Employee App" && n.href === "/dismantling"));

// 5. Management can still reach Vehicle Dismantling Processing; the dismantling employee cannot.
check("route access: a manager can reach /dismantling-processing", isRouteAllowed("/dismantling-processing", ["manager"]));
check("route access: the dismantling employee cannot reach /dismantling-processing", !isRouteAllowed("/dismantling-processing", ["dismantling"]));

// 6. Nothing else about the owner's sidebar moved around or vanished.
const EXPECT_OWNER_LABELS = [
  "Owner Vehicle Dashboard", "Central Dispatch", "Auction Vehicle Inventory", "Vehicle Receiving & Arrival",
  "Vehicle Dismantling Processing", "Front Desk Manager Portal", "Warehouse Employee App", "AI Command Center",
  "Parts Inventory", "Parts Operations", "Customers & Sales", "Containers & Export", "Scrap Loads",
  "Audit & History", "Users & Activity",
];
check("owner sidebar: every other entry is still present, in the same order", JSON.stringify(ownerNav.map((n) => n.label)) === JSON.stringify(EXPECT_OWNER_LABELS), ownerNav.map((n) => n.label).join(" | "));

// 7. Every role still has a defined home and a non-empty primary nav (the role set itself is unchanged).
for (const role of ROLE_KEYS) {
  const nav = getPrimaryNav(role);
  check(`role "${role}": has a non-empty primary nav and a home route`, nav.length > 0 && typeof homeForRole(role) === "string" && homeForRole(role).startsWith("/"));
}

console.log(`\nTOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
