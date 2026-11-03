import { normalizeEmail } from "@/lib/sanitize";
import type { AccessRequest, Profile } from "@/lib/types";

type InviteRow = Pick<AccessRequest, "status" | "email" | "signup_token">;

/**
 * The approved requests whose person has not signed up. Sign-up clears
 * signup_token, and a member can change their address afterwards, so the
 * address alone would list them as invited again. The token is not enough
 * alone either: its clearing call can fail after the account exists.
 */
export function invitedNotSignedUp<R extends InviteRow>(
  requests: R[],
  members: Pick<Profile, "email">[],
): R[] {
  const memberEmails = new Set(members.map((m) => normalizeEmail(m.email)));
  memberEmails.delete(null);
  return requests.filter(
    (r) =>
      r.status === "approved" &&
      r.signup_token !== null &&
      !memberEmails.has(normalizeEmail(r.email)),
  );
}
