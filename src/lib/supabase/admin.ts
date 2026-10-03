import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * SERVICE-ROLE client. Bypasses RLS entirely. Never import this from a Client Component or
 * any file that could end up in the browser bundle — the `server-only` import above makes
 * that a build-time error, not just a convention.
 *
 * Legitimate uses only: the Supabase Auth Admin API (creating/inviting users, which cannot
 * go through RLS by definition), and any genuinely trusted server-side maintenance task.
 * Ordinary business reads/writes must go through src/lib/supabase/server.ts (RLS-scoped)
 * or a SECURITY DEFINER RPC instead — reaching for this client to "just make RLS go away"
 * defeats the entire authorization model this backend relies on.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Read under the exact name present in .env.local (`secret_key`) — that file is never
  // modified or re-keyed by application code, per explicit instruction. Server-side
  // process.env access works regardless of the NEXT_PUBLIC_ convention; that prefix only
  // controls what Next.js inlines into the browser bundle, which is irrelevant here.
  const serviceKey = process.env.secret_key;
  if (!url || !serviceKey) {
    throw new Error(
      "createAdminClient: NEXT_PUBLIC_SUPABASE_URL and secret_key must both be set (server-only env, .env.local)."
    );
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
