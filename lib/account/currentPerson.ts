import { verifiedUser } from "@/lib/members/access";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

export type CurrentPerson =
  | { ok: true; id: string; orgId: string; signOut: () => Promise<void> }
  | { ok: false; status: 401 | 403 };

/**
 * The signed-in person and their org, read on the cookie-bound client. getUser()
 * rather than the local claims check: both callers read or destroy this person's
 * data, so a session that was already revoked must not get through. A person acts
 * only on the id this returns, never on one from the request.
 */
export async function currentPerson(): Promise<CurrentPerson> {
  const supabase = await createClient();
  const user = await verifiedUser(supabase, "Current person lookup");
  if (!user) return { ok: false, status: 401 };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    logError("Current person lookup failed", error);
    return { ok: false, status: 403 };
  }
  if (!profile) return { ok: false, status: 403 };

  return {
    ok: true,
    id: user.id,
    orgId: profile.org_id,
    signOut: async () => {
      await supabase.auth.signOut({ scope: "local" });
    },
  };
}
