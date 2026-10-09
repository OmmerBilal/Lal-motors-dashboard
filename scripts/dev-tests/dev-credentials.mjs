// Test-only credential loader for DEV suites. Reads dev-test-credentials.json (git-ignored) and, for any role,
// takes a password override from the environment or the git-ignored .env.local, so a suite can run against the
// seeded account's REAL current password without that password ever being written into the (git-ignored) JSON
// file. The password is never printed, logged or written anywhere. Application runtime code never imports this file.
//
// Override variable name for a role: DEV_TEST_<ROLE_KEY_UPPERCASED>_PASSWORD, e.g. DEV_TEST_MANAGER_PASSWORD,
// DEV_TEST_EXPORT_MANAGER_PASSWORD, DEV_TEST_SCRAP_DRIVER_PASSWORD. A few names predate this generic scheme and
// are kept as aliases for the same role: DEV_TEST_DISMANTLER_PASSWORD (dismantling) and
// DEV_TEST_CONTAINER_LOADER_PASSWORD (container_loading).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// role key -> extra legacy env var name(s) checked before the generic DEV_TEST_<ROLE>_PASSWORD name.
const LEGACY_ALIASES = {
  dismantling: ["DEV_TEST_DISMANTLER_PASSWORD"],
  container_loading: ["DEV_TEST_CONTAINER_LOADER_PASSWORD"],
};

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
}

function overrideFor(role, local) {
  const names = [...(LEGACY_ALIASES[role] ?? []), `DEV_TEST_${role.toUpperCase()}_PASSWORD`];
  for (const name of names) {
    const v = process.env[name] || local[name];
    if (v) return v;
  }
  return null;
}

/** Returns the credential list with each role's password taken from the environment when an override is configured. */
export function loadDevCredentials() {
  const creds = JSON.parse(fs.readFileSync(path.join(ROOT, "dev-test-credentials.json"), "utf8"));
  const local = readEnvFile(path.join(ROOT, ".env.local"));
  return creds.map((u) => {
    const override = overrideFor(u.role, local);
    return override ? { ...u, password: override } : u;
  });
}
