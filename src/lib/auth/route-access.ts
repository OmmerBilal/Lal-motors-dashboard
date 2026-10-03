import type { Role } from "@/lib/types";

/**
 * Server-side URL gate. Mirrors the role→screen routing in src/lib/nav.ts so that a user
 * who types a URL they cannot navigate to to is redirected by the server, not just hidden
 * from the menu. Navigation is NOT authorization: this only decides which app SHELL a role
 * may load. The data behind each screen is still protected by RLS and the mutation triggers.
 *
 * Owner is allowed everywhere (nav.ts gives Owner every destination, and Owner previews
 * every employee workspace under /preview/*).
 *
 * Paths are matched by prefix, most specific first. A path with no rule is DENIED for
 * everyone except Owner (default-deny), so a newly added route is closed until it is listed.
 */
type RouteRule = { prefix: string; roles: readonly Role[] };

const OWNER_ONLY: readonly Role[] = [];
const ROLE_KEYS_ALL: readonly Role[] = [
  "engineer_admin", "manager", "employee", "auction", "receiving", "dismantling",
  "scrap_driver", "container_loading", "export_manager",
];

const ROUTE_RULES: RouteRule[] = [
  { prefix: "/dashboard", roles: OWNER_ONLY },
  { prefix: "/vehicles", roles: ["engineer_admin", "manager", "auction"] },
  { prefix: "/central-dispatch", roles: ["engineer_admin", "manager", "auction"] },
  { prefix: "/vehicle-receiving", roles: ["engineer_admin", "receiving"] },
  { prefix: "/dismantling-processing", roles: ["engineer_admin", "manager"] },
  { prefix: "/dismantling", roles: ["engineer_admin", "dismantling"] },
  { prefix: "/ai-command-center", roles: ["engineer_admin"] },
  { prefix: "/parts", roles: ["engineer_admin", "manager", "employee"] },
  { prefix: "/operations", roles: ["engineer_admin", "manager"] },
  { prefix: "/sales", roles: ["engineer_admin", "manager"] },
  { prefix: "/containers", roles: ["engineer_admin", "export_manager", "container_loading"] },
  { prefix: "/scrap", roles: ["engineer_admin", "manager", "auction", "scrap_driver"] },
  { prefix: "/audit", roles: ["engineer_admin"] },
  { prefix: "/team", roles: OWNER_ONLY },
  { prefix: "/preview", roles: OWNER_ONLY },
  // Media API: every active role may call it. Who can attach or read which file is decided by
  // RLS on media_assets (can_access_media / media_owner_exists) inside the service, not here.
  { prefix: "/api/media", roles: ROLE_KEYS_ALL },
];

// Routes every signed-in, active user may load. "/" only redirects to the user's home.
const ALWAYS_ALLOWED_PREFIXES = ["/"];

// First destination for each role, mirroring the first item in nav.ts for that role.
const HOME_BY_ROLE: Record<Role, string> = {
  owner: "/dashboard",
  engineer_admin: "/vehicles",
  manager: "/dismantling-processing",
  employee: "/parts",
  auction: "/vehicles",
  receiving: "/vehicle-receiving",
  dismantling: "/dismantling",
  scrap_driver: "/scrap",
  container_loading: "/containers",
  export_manager: "/containers",
};

export const ROLE_KEYS: readonly Role[] = Object.keys(HOME_BY_ROLE) as Role[];

function matches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** Keeps only known role keys so an unexpected value from the database cannot grant access. */
export function knownRoles(roleKeys: readonly string[]): Role[] {
  return roleKeys.filter((k): k is Role => (ROLE_KEYS as readonly string[]).includes(k));
}

export function isRouteAllowed(pathname: string, roleKeys: readonly string[]): boolean {
  const roles = knownRoles(roleKeys);
  if (roles.includes("owner")) return true;
  if (ALWAYS_ALLOWED_PREFIXES.some((p) => p === pathname)) return true;

  const rule = ROUTE_RULES
    .filter((r) => matches(pathname, r.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!rule) return false;

  return roles.some((r) => rule.roles.includes(r));
}

/** Where a signed-in user with these roles should land. Owner wins if present. */
export function homeForRoles(roleKeys: readonly string[]): string {
  const roles = knownRoles(roleKeys);
  if (roles.includes("owner")) return HOME_BY_ROLE.owner;
  const first = roles[0];
  return first ? HOME_BY_ROLE[first] : "/login";
}

export function homeForRole(role: Role): string {
  return HOME_BY_ROLE[role];
}
