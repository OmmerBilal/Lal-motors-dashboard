"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Role, User } from "@/lib/types";
import { ForcedPasswordChange } from "@/components/auth/forced-password-change";

/**
 * One provider for the whole application lifecycle. It is mounted once in the root layout and never removed or
 * remounted based on whether a user exists. Every state is a valid provider state:
 *   booting         first authentication bootstrap only (full-screen "Loading session…")
 *   profile-loading a session exists and its profile and role are being read (login transition)
 *   signed-out      no session. Valid state, used by the root page, the login page and the logout transition.
 *   signed-in       the user, role and profile are loaded
 *   error           a session exists but the profile or role could not be read
 *
 * Protected screens render only when signed in. The gate below decides that from state, so no component that needs
 * a user can run while the user is absent. Public screens (root, login, invite, reset) always render.
 */
export type SessionStatus = "booting" | "profile-loading" | "signed-out" | "signed-in" | "error";

type SessionContextValue = {
  status: SessionStatus;
  user: User | null;
  error: string | null;
  signOut: () => Promise<void>;
  /** Optimistically clears the forced-password-change gate once the server-side flag has actually been cleared. */
  markPasswordChanged: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/** Screens that render with no session. The root page decides where to send the person. */
const PUBLIC_PATHS = ["/", "/login", "/accept-invite", "/reset-password"];

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<{ status: SessionStatus; user: User | null; error: string | null }>({
    status: "booting",
    user: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    // The user id the app is currently showing. Routine events for this same user change nothing on screen.
    let currentUserId: string | null = null;
    // The user whose data is in the query cache. A different user clears the cache, so nothing from the last person stays visible.
    let cachedUserId: string | null = null;

    function switchCacheTo(userId: string | null) {
      if (cachedUserId !== userId) {
        queryClient.clear();
        cachedUserId = userId;
      }
    }

    async function loadProfile(authUserId: string) {
      const [profileResult, roleResult] = await Promise.all([
        supabase.from("profiles").select("id, name, email, must_change_password").eq("id", authUserId).maybeSingle(),
        supabase.from("user_roles").select("roles(key)").eq("user_id", authUserId),
      ]);
      if (!active) return;

      const profile = profileResult.data;
      if (profileResult.error || roleResult.error || !profile) {
        // A failed background refresh must not sign the person out of a working screen.
        setState((prev) =>
          prev.user && prev.user.id === authUserId
            ? prev
            : { status: "error", user: null, error: "Could not load your profile. Contact an administrator." },
        );
        return;
      }

      // No generated Database type is available yet, so the embedded relation is cast through unknown.
      const firstRoleRow = roleResult.data?.[0] as unknown as { roles: { key: string } | null } | undefined;
      const roleKey = firstRoleRow?.roles?.key as Role | undefined;
      if (!roleKey) {
        setState({ status: "error", user: null, error: "Your account has no role assigned yet. Contact an administrator." });
        return;
      }

      const next: User = {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: roleKey,
        must_change_password: Boolean((profile as { must_change_password?: boolean }).must_change_password),
      };
      switchCacheTo(next.id);
      // Keep the same object when nothing changed, so consumers do not re-render or reset.
      setState((prev) => {
        const same =
          prev.user &&
          prev.user.id === next.id &&
          prev.user.name === next.name &&
          prev.user.email === next.email &&
          prev.user.role === next.role &&
          prev.user.must_change_password === next.must_change_password;
        return { status: "signed-in", user: same ? prev.user : next, error: null };
      });
    }

    // getSession() reads the local session; the proxy already verified the request server-side.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session?.user) {
        currentUserId = data.session.user.id;
        loadProfile(data.session.user.id);
      } else {
        switchCacheTo(null);
        setState({ status: "signed-out", user: null, error: null });
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (session?.user) {
        // TOKEN_REFRESHED, routine SIGNED_IN and focus revalidation for the same user: background only.
        if (session.user.id === currentUserId) return;
        currentUserId = session.user.id;
        // A different person (or the first sign-in after logout): no previous user's screen or data stays.
        switchCacheTo(null);
        setState({ status: "profile-loading", user: null, error: null });
        loadProfile(session.user.id);
        return;
      }
      // Other events without a session (the initial empty event) are left to the bootstrap above.
      if (event !== "SIGNED_OUT") return;
      // A genuine sign-out: clears the person and the cached data, then leaves the protected app.
      currentUserId = null;
      switchCacheTo(null);
      setState({ status: "signed-out", user: null, error: null });
      router.replace("/login");
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase, router, queryClient]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [supabase, router]);

  const markPasswordChanged = useCallback(() => {
    setState((prev) => (prev.user ? { ...prev, user: { ...prev.user, must_change_password: false } } : prev));
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ status: state.status, user: state.user, error: state.error, signOut, markPasswordChanged }),
    [state, signOut, markPasswordChanged],
  );

  return (
    <SessionContext.Provider value={value}>
      <SessionGate>{children}</SessionGate>
    </SessionContext.Provider>
  );
}

/** Decides what renders from state. Protected children render only when signed in. */
function SessionGate({ children }: { children: React.ReactNode }) {
  const session = useSessionState();
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (session.status === "booting") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading session…</p>
      </div>
    );
  }
  if (isPublic) return <>{children}</>;
  if (session.status === "signed-in") {
    // Mandatory, unskippable: an owner-created account must set its own password before any
    // app screen renders. Nothing here can navigate past it except a successful password change.
    if (session.user?.must_change_password) {
      return <ForcedPasswordChange role={session.user.role} onDone={session.markPasswordChanged} />;
    }
    return <>{children}</>;
  }
  if (session.status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="max-w-sm text-center text-sm text-destructive">{session.error}</p>
      </div>
    );
  }
  // signed-out or profile-loading on a protected path: nothing from the app renders until the state settles.
  return null;
}

/** The whole session state, including the signed-out state. Use this where a person may not be signed in. */
export function useSessionState(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

/** For screens under the protected gate. The gate renders them only when signed in, so `user` is always present there. */
export function useSession(): { user: User; signOut: () => Promise<void> } {
  const ctx = useSessionState();
  if (!ctx.user) throw new Error("useSession needs a signed-in session. Protected screens render only when signed in.");
  return { user: ctx.user, signOut: ctx.signOut };
}
