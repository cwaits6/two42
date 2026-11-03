import { normalizeEmail } from "@/lib/sanitize";
import type { AccessRequest, Profile } from "@/lib/types";

type InviteRow = Pick<AccessRequest, "status" | "email" | "signup_token" | "token_expires_at">;

/**
 * Sign-up clears only signup_token. A setup email that failed to send clears
 * token_expires_at too and leaves the person with no account, so a null token
 * alone does not prove a sign-up.
 */
function tokenUsed(r: InviteRow): boolean {
  return r.signup_token === null && r.token_expires_at !== null;
}

/**
 * The approved requests whose person has not signed up. A member can change
 * their address after signing up, so the address alone would list them as
 * invited again. The used token is not enough alone either: its clearing call
 * can fail after the account exists.
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
      !tokenUsed(r) &&
      !memberEmails.has(normalizeEmail(r.email)),
  );
}
