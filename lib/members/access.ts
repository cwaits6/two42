/**
 * The org-admin gate for the member import/export routes (CWA-40), mirroring
 * lib/platform-access.ts. Resolved through the COOKIE-BOUND request client —
 * never the service client — so the role check and every query the caller
 * makes afterwards run under RLS, which is the tenant boundary here. Fails
 * closed on a profile-query error: "couldn't tell" must mean "no" for a gate
 * that fronts the whole roster.
 *
 * This module imports @/lib/supabase/server (→ next/headers). It must never
 * be imported by csv.ts, format.ts, or import-plan.ts, or those pure modules
 * become untestable in vitest's node environment. The dependency arrow is
 * one-way: routes → access.ts, routes → pure modules.
 */
import { createClient } from "@/lib/supabase/server";
import type { User, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type OrgAdminGate =
  | { ok: true; user: User; supabase: SupabaseClient<Database> }
  | { ok: false; status: 401 | 403 };

/**
 * 401 when unauthenticated, 403 when not an org admin. On success returns
 * the RLS-scoped client so callers do not build a second one.
 */
export async function requireOrgAdmin(): Promise<OrgAdminGate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (error) {
    console.error("Org admin check failed; denying:", error);
    return { ok: false, status: 403 };
  }
  return profile?.role === "admin"
    ? { ok: true, user, supabase }
    : { ok: false, status: 403 };
}
