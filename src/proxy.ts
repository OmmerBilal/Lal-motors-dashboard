import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { homeForRoles, isRouteAllowed } from "@/lib/auth/route-access";

/**
 * Runs on every matched request. Three jobs, in order:
 *   1. Refresh the Supabase session cookie (without this, sessions silently expire mid-use).
 *   2. Authenticated at all? No session -> /login for any protected route.
 *   3. Server-side route gate: a signed-in user whose account is disabled/removed or has no
 *      role is signed out here; a user who requests a screen their role may not open is
 *      redirected to their own home. Done per request, so a typed URL is blocked before any
 *      page code runs (not just hidden from the menu).
 *
 * Middleware is NOT where data authorization happens. Real authorization is RLS plus the
 * mutation triggers and RPCs in the database. This file only decides which app shell loads.
 */

const PUBLIC_PATHS = ["/login", "/reset-password", "/accept-invite"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function proxy(request: NextRequest) {
  // Cookies that Supabase wants to set/clear. Applied to whichever response we finally return,
  // so a redirect after a forced sign-out still clears the session cookies.
  const pendingCookies: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            pendingCookies.push({ name, value, options });
          }
        },
      },
    }
  );

  const finish = (response: NextResponse) => {
    for (const { name, value, options } of pendingCookies) response.cookies.set(name, value, options);
    return response;
  };

  const redirectTo = (path: string, search = "") => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = search;
    return finish(NextResponse.redirect(url));
  };

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  // API callers get a JSON 401, never a login redirect (a redirect would look like success to fetch).
  if (!user && pathname.startsWith("/api/")) {
    return finish(NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 }));
  }

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return finish(NextResponse.redirect(url));
  }

  if (user && isPublicPath(pathname)) {
    return redirectTo("/");
  }

  if (user && !isPublicPath(pathname)) {
    const { data: rows } = await supabase.rpc("current_access");
    const access = rows?.[0];

    // Disabled, removed, missing profile, or no role: end this browser's session. Scope "local"
    // only clears this browser's cookie, it does not revoke the person's other devices.
    if (!access || access.account_status !== "active" || access.role_keys.length === 0) {
      await supabase.auth.signOut({ scope: "local" });
      if (pathname.startsWith("/api/")) {
        return finish(NextResponse.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 }));
      }
      const reason = access?.account_status === "active" ? "no-role" : "disabled";
      return redirectTo("/login", `?reason=${reason}`);
    }

    if (!isRouteAllowed(pathname, access.role_keys)) {
      const home = homeForRoles(access.role_keys);
      if (home !== pathname) return redirectTo(home);
    }
  }

  return finish(NextResponse.next({ request }));
}

export const config = {
  matcher: [
    /*
     * Match every path except static assets and Next's own internals — the standard
     * @supabase/ssr exclusion list.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
