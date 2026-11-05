/**
 * The org-admin gate for the member import/export routes, mirroring
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
import { logError } from "@/lib/log";
import { stepOf } from "@/lib/log/step";

export type OrgAdminGate =
  | { ok: true; user: User; supabase: SupabaseClient<Database>; orgId: string }
  | { ok: false; status: 401 | 403 };

/** The verified user, or null. Logs an Auth failure, which callers report as a plain 401. */
export async function verifiedUser(supabase: SupabaseClient<Database>, gate: string): Promise<User | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) {
    // Without this, an auth-service outage is indistinguishable from "not
    // signed in" in the logs — a 401 storm with no recorded cause.
    logError("Auth lookup failed; denying", error, { step: stepOf(gate) });
    return null;
  }
  return user;
}

/**
 * 401 when unauthenticated, 403 when not an org admin. On success returns
 * the RLS-scoped client so callers do not build a second one, plus the
 * caller's own org_id — read off their RLS-scoped profile row, which
 * CLAUDE.md names as an approved tenant anchor. Callers pass it to every
 * query that takes a client as a parameter (see loadOrgSnapshot).
 */
export async function requireOrgAdmin(): Promise<OrgAdminGate> {
  const supabase = await createClient();
  const user = await verifiedUser(supabase, "Org admin check");
  if (!user) return { ok: false, status: 401 };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();
  if (error) {
    // code/message only: a PostgrestError's details/hint echo row content.
    logError("Org admin check failed; denying", error);
    return { ok: false, status: 403 };
  }
  return profile?.role === "admin"
    ? { ok: true, user, supabase, orgId: profile.org_id }
    : { ok: false, status: 403 };
}
