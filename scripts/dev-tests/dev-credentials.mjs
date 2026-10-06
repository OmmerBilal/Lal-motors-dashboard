// Test-only credential loader for DEV suites. Reads dev-test-credentials.json (git-ignored) and, when present, takes the
// owner password from DEV_TEST_OWNER_PASSWORD in the environment or in the git-ignored .env.local. The password is never
// printed, logged or written anywhere. Application runtime code never imports this file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
}

/** Returns the credential list with the owner password taken from the local environment when one is configured. */
export function loadDevCredentials() {
  const creds = JSON.parse(fs.readFileSync(path.join(ROOT, "dev-test-credentials.json"), "utf8"));
  const local = readEnvFile(path.join(ROOT, ".env.local"));
  const ownerPassword = process.env.DEV_TEST_OWNER_PASSWORD || local.DEV_TEST_OWNER_PASSWORD;
  const employeePassword = process.env.DEV_TEST_DISMANTLER_PASSWORD || local.DEV_TEST_DISMANTLER_PASSWORD;
  const scrapDriverPassword = process.env.DEV_TEST_SCRAP_DRIVER_PASSWORD || local.DEV_TEST_SCRAP_DRIVER_PASSWORD;
  const containerLoaderPassword = process.env.DEV_TEST_CONTAINER_LOADER_PASSWORD || local.DEV_TEST_CONTAINER_LOADER_PASSWORD;
  return creds.map((u) => {
    if (u.role === "owner" && ownerPassword) return { ...u, password: ownerPassword };
    if (u.role === "dismantling" && employeePassword) return { ...u, password: employeePassword };
    if (u.role === "scrap_driver" && scrapDriverPassword) return { ...u, password: scrapDriverPassword };
    if (u.role === "container_loading" && containerLoaderPassword) return { ...u, password: containerLoaderPassword };
    return u;
  });
}
