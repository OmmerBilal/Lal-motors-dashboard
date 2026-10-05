"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Role, User } from "@/lib/types";

type SessionContextValue = {
  user: User;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Real Supabase Auth session, replacing the old localStorage-based mock identity. Deliberately
 * keeps the SAME exported shape every existing consumer already expects (`useSession().user`,
 * a `User` with `id`/`name`/`email`/`role`) so call sites elsewhere in the app did not need to
 * change — only the four places that used to fake "logout" by resetting to `users[0]` were
 * updated, to call `signOut()` instead (there is no `users` list / `setUserId` escape hatch
 * anymore: a real session cannot let you instantly become a different person).
 *
 * `role` is sourced from `user_roles`/`roles`, not stored in the JWT. If a person is ever
 * assigned more than one role, the first one returned is used for nav/display purposes — the
 * frontend's `Role` type is still single-valued; true multi-role UI is a larger, separate
 * change, not done here.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  // Only the first authentication bootstrap shows the full-screen "Loading session…". After that, every session event
  // (token refresh, tab focus, visibility) is a background revalidation, so the mounted app tree and its workflow stay.
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // The user id the app is currently showing. Routine events for this same user change nothing on screen.
    let currentUserId: string | null = null;

    async function loadProfile(authUserId: string) {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, name, email")
        .eq("id", authUserId)
        .maybeSingle();

      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles")
        .select("roles(key)")
        .eq("user_id", authUserId);

      if (!active) return;

      if (profileError || roleError || !profile) {
        // A failed background refresh must not sign the user out of a working screen; only an empty bootstrap shows an error.
        setError("Could not load your profile. Contact an administrator.");
        setUser((prev) => (prev && prev.id === authUserId ? prev : null));
        setBooting(false);
        return;
      }

      // No generated Database type is available yet (Section "client.ts" note), so
      // supabase-js can't infer the embedded `roles` relation's cardinality — cast through
      // `unknown` rather than fighting the inferred (and here, incorrect) array shape.
      const firstRoleRow = roleRows?.[0] as unknown as { roles: { key: string } | null } | undefined;
      const roleKey = firstRoleRow?.roles?.key as Role | undefined;

      if (!roleKey) {
        setError("Your account has no role assigned yet. Contact an administrator.");
        setUser(null);
        setBooting(false);
        return;
      }

      const next: User = { id: profile.id, name: profile.name, email: profile.email, role: roleKey };
      // Keep the same object when nothing changed, so consumers do not re-render or reset.
      setUser((prev) =>
        prev && prev.id === next.id && prev.name === next.name && prev.email === next.email && prev.role === next.role ? prev : next,
      );
      setError(null);
      setBooting(false);
    }

    // getSession() reads the local session; the proxy already verified the request server-side,
    // so this avoids a second remote Auth call on every full page load.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session?.user) {
        currentUserId = data.session.user.id;
        loadProfile(data.session.user.id);
      } else {
        setUser(null);
        setBooting(false);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (session?.user) {
        // TOKEN_REFRESHED, routine SIGNED_IN for the same user, focus and visibility revalidation:
        // background only. No loading state, no profile reload, no navigation.
        if (session.user.id === currentUserId) return;
        currentUserId = session.user.id;
        loadProfile(session.user.id);
        return;
      }
      // Other events without a session (for example the initial empty event) are left to the bootstrap above.
      if (event !== "SIGNED_OUT") return;
      // A genuine sign-out: the only event that clears the user and leaves the protected app.
      currentUserId = null;
      setUser(null);
      setBooting(false);
      router.replace("/login");
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase, router]);

  const value = useMemo<SessionContextValue | null>(() => {
    if (!user) return null;
    return {
      user,
      signOut: async () => {
        await supabase.auth.signOut();
        router.replace("/login");
      },
    };
  }, [user, supabase, router]);

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading session…</p>
      </div>
    );
  }

  if (!value) {
    // Middleware already redirects unauthenticated requests away from protected routes
    // before this can render for them — reaching this branch means either we're on a
    // public route (/login etc., which never calls useSession()) or a signed-in session
    // whose profile/role failed to load, which IS a real error worth surfacing.
    if (error) {
      return (
        <div className="flex min-h-screen items-center justify-center px-4">
          <p className="max-w-sm text-center text-sm text-destructive">{error}</p>
        </div>
      );
    }
    return <>{children}</>;
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
