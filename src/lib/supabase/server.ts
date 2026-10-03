import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for use in Server Components, Server Actions, and Route
 * Handlers. Still uses the publishable/anon key (NOT the service role key) — every query
 * made through this client is still subject to RLS, scoped to whichever user's session
 * cookie is present. This is what server code should use for "act as the current user"
 * operations (most reads, and writes that should go through RLS + the mutation-
 * authorization triggers rather than bypass them).
 *
 * Server Components can only READ cookies, not set them — the `set`/`remove` calls below
 * are wrapped in try/catch for exactly that case (calling this from a Server Component is
 * fine; the session refresh those calls would perform is a no-op there, which is safe,
 * since middleware.ts already handles session refresh on every request).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — expected, see comment above.
          }
        },
      },
    }
  );
}
