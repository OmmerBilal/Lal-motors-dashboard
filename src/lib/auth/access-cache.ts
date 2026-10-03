import "server-only";

/**
 * Short-lived, in-process cache of each user's account status and role keys, used ONLY by the
 * route gate in src/proxy.ts.
 *
 * Why it exists: current_access() is a remote round trip (~390 ms measured to the DEV region).
 * Doing it on every navigation made every page feel blocked by auth infrastructure.
 *
 * Why it is safe: data access is NOT decided here. Every RLS policy and mutation trigger calls
 * has_role / has_any_role, which require is_active_account() on each query (migration 0002).
 * A disabled or de-roled user therefore loses data access immediately, whatever this cache says.
 * The only effect of a stale entry is which app shell the proxy lets the browser load, for at
 * most ACCESS_TTL_MS. Forced sign-outs call forget() so they take effect at once.
 */

export type CachedAccess = { accountStatus: string; roleKeys: string[] };

const ACCESS_TTL_MS = 15_000;
const MAX_ENTRIES = 5_000;

type Entry = { value: CachedAccess; expiresAt: number };
const cache = new Map<string, Entry>();

export function getCachedAccess(userId: string): CachedAccess | null {
  const hit = cache.get(userId);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(userId);
    return null;
  }
  return hit.value;
}

export function setCachedAccess(userId: string, value: CachedAccess) {
  if (cache.size >= MAX_ENTRIES) {
    // Map keeps insertion order, so the first key is the oldest. Drop it to bound memory.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(userId, { value, expiresAt: Date.now() + ACCESS_TTL_MS });
}

export function forget(userId: string) {
  cache.delete(userId);
}

export const ACCESS_CACHE_TTL_MS = ACCESS_TTL_MS;
