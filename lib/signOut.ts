import { failureMessage, SIGNED_OUT_HERE_ONLY } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";

export type SignOutOutcome =
  | { signedOut: true; message?: string }
  | { signedOut: false; message: string };

/**
 * Signs out everywhere and says what became of this device's session. A failed
 * revoke request leaves the session stored here, so this device is then signed
 * out on its own. That can fail too, and the library's error doesn't say which
 * state it left: the stored session is read back, and an unreadable one counts
 * as still signed in.
 */
export async function signOutHere(): Promise<SignOutOutcome> {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();
  if (!error) return { signedOut: true };

  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || data.session) {
    return { signedOut: false, message: failureMessage("sign out", error.status || "network") };
  }
  return { signedOut: true, message: SIGNED_OUT_HERE_ONLY };
}
