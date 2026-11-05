import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export type PlatformAdminGate =
  | { ok: true; user: User }
  | { ok: false; status: 401 }
  // unavailable: the check itself failed, so the answer is unknown, not "no".
  | { ok: false; status: 403; unavailable?: true };

/**
 * The platform-operator gate. Resolved through the COOKIE-BOUND request
 * client (never the service client): is_platform_admin() is SECURITY DEFINER
 * over platform_admins keyed on auth.uid(), so the answer is server-owned
 * state the caller cannot influence. Fails closed on an RPC error — a
 * platform admin is the one principal with cross-org reach, so "couldn't
 * tell" must mean "no".
 *
 * Route handlers use the discriminated result to distinguish 401 (no user)
 * from 403 (signed-in non-platform-admin), matching
 * app/api/admin/approve/route.ts's envelope.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdminGate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) {
    console.error("Platform admin check failed; denying:", error);
    return { ok: false, status: 403, unavailable: true };
  }
  return data === true ? { ok: true, user } : { ok: false, status: 403 };
}

/** Layout/page form of the gate: the user when they are a platform admin, else null. */
export async function getPlatformAdmin(): Promise<User | null> {
  const gate = await requirePlatformAdmin();
  return gate.ok ? gate.user : null;
}
