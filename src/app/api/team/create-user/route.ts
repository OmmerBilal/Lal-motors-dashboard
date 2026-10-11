import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ASSIGNABLE_ROLES, type Role } from "@/lib/types";

export const runtime = "nodejs";

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function badRequest(message: string) {
  return NextResponse.json({ error: { code: "invalid", message } }, { status: 400 });
}

/**
 * Owner-only: creates a real login (Supabase Auth) for a new employee, with a temporary
 * password the owner sets and hands to them directly — no invite email. The Auth Admin API
 * can only be called with the service-role key (src/lib/supabase/admin.ts), which never
 * reaches the browser, so this has to be a server route rather than a client RPC call.
 *
 * The caller's session is re-checked here with the RLS-scoped server client (never trust a
 * client-sent "I am the owner" flag); role assignment itself is then delegated to the
 * existing guarded RPC (team_set_role, migration 0044) rather than writing user_roles
 * directly, so there is exactly one place that enforces "no owner role, no self-change" etc.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const callerId = auth?.claims?.sub as string | undefined;
  if (!callerId) return NextResponse.json({ error: { code: "forbidden", message: "Sign in again." } }, { status: 401 });

  const { data: roleRows, error: roleError } = await supabase.from("user_roles").select("roles(key)").eq("user_id", callerId);
  if (roleError) return NextResponse.json({ error: { code: "forbidden", message: "Your role could not be checked." } }, { status: 403 });
  const callerRoles = (roleRows ?? []).map((r) => (r as unknown as { roles: { key: string } | null }).roles?.key).filter(Boolean);
  if (!callerRoles.includes("owner")) {
    return NextResponse.json({ error: { code: "forbidden", message: "Only the owner can create accounts." } }, { status: 403 });
  }

  let body: { name?: unknown; email?: unknown; password?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON.");
  }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = String(body.role ?? "") as Role;

  if (name.length < 2) return badRequest("Enter the person's name.");
  if (!EMAIL_RE.test(email)) return badRequest("Enter a valid email address.");
  if (password.length < MIN_PASSWORD_LENGTH) return badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (!ASSIGNABLE_ROLES.includes(role)) return badRequest("Choose a valid role.");

  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (createError || !created?.user) {
    // Supabase's own duplicate-email error is already a safe, non-leaking message.
    return badRequest(createError?.message || "The account could not be created.");
  }
  const userId = created.user.id;

  // public.profiles is created by the on_auth_user_created trigger (migration 0001) the
  // moment the auth.users row above was inserted — no separate insert needed here. Role
  // assignment reuses the existing owner-gated RPC rather than writing user_roles directly.
  const { error: roleAssignError } = await supabase.rpc("team_set_role", { p_profile: userId, p_role_key: role });
  if (roleAssignError) {
    // The login now exists but has no role yet; surface this clearly rather than silently losing it.
    return NextResponse.json(
      { error: { code: "partial", message: `Account created, but the role could not be set: ${roleAssignError.message}` } },
      { status: 500 },
    );
  }

  const { error: flagError } = await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
  if (flagError) {
    return NextResponse.json(
      { error: { code: "partial", message: `Account created, but the forced-password-change flag could not be set: ${flagError.message}` } },
      { status: 500 },
    );
  }

  // Never log or echo the password — only confirm the non-secret fields the owner already knows.
  return NextResponse.json({ id: userId, name, email, role });
}
