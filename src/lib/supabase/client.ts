"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. Uses the publishable/anon key only — this file is safe to
 * import from any client component. Every table access made through this client is subject
 * to RLS; it has no elevated privileges whatsoever.
 *
 * No generated `Database` generic yet — the Supabase CLI (needed for `supabase gen types
 * typescript`) isn't installed in this environment. Table shape safety for now comes from
 * hand-written Zod schemas/DTOs at the repository/service layer (src/server/repositories,
 * src/server/validation), not from a generic here. Add the generic once the CLI is
 * available; this call site won't need to change, only the import.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
