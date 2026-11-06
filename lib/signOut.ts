import { failureMessage, SIGNED_OUT_HERE_ONLY } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";

export type SignOutOutcome =
  | { signedOut: true; message?: string }
  | { signedOut: false; message: string };

/**
 * Signs this device out and says what became of its session. The library's
 * error alone doesn't: a failed revoke request has already removed the session
 * here, while a failure to load the session returns with it still stored. So
 * after an error the stored session is read back, and an unreadable one counts
 * as still signed in.
 */
export async function signOutHere(): Promise<SignOutOutcome> {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();
  if (!error) return { signedOut: true };

  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || data.session) {
    return { signedOut: false, message: failureMessage("sign out", error.status || "network") };
  }
  return { signedOut: true, message: SIGNED_OUT_HERE_ONLY };
}
