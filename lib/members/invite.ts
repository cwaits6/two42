/**
 * The server path every church-admin invitation goes through, whether one
 * person from Members or many from the importer: an approved access request
 * carrying a signup token, and the member invite email linking to
 * /setup-account.
 *
 * access_requests has no INSERT policy for any client role, so these writes
 * run on the service client. That bypasses RLS: the `orgId` every caller
 * passes must be the admin's own, from requireOrgAdmin(), and every query
 * below filters or stamps it explicitly.
 */
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveEmailBranding } from "@/lib/email/identity";
import { sendMemberInviteEmail } from "@/lib/email/resend";
import { siteConfig } from "@/lib/config";

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** A PostgrestError's details echo row values (the email), so log only these. */
function errorSummary(err: unknown) {
  if (!err || typeof err !== "object") return err;
  const { name, code, message } = err as Record<string, unknown>;
  return { name, code, message };
}

/**
 * access_requests stores emails as typed, so matching is case-insensitive.
 * The value is a LIKE pattern inside an array literal, so both sets of
 * metacharacters are escaped; postgrest-js quotes neither.
 */
function exactIlikeElement(email: string): string {
  const pattern = email.replace(/[\\%_]/g, "\\$&");
  return `"${pattern.replace(/[\\"]/g, "\\$&")}"`;
}

export interface ExistingInvitees {
  /** Emails that already belong to a profile in the org. */
  accounts: Set<string>;
  /** Emails with an access request in the org, in any status. */
  invited: Set<string>;
}

/**
 * Which of `emails` (already normalized) must not be invited again. Throws on
 * a query error: "couldn't tell" must not mail someone who already has an
 * account.
 */
export async function findExistingInvitees(
  orgId: string,
  emails: string[]
): Promise<ExistingInvitees> {
  const service = await createServiceClient();
  const patterns = emails.map(exactIlikeElement);
  const [profiles, requests] = await Promise.all([
    service
      .from("profiles")
      .select("email")
      .eq("org_id", orgId)
      .ilikeAnyOf("email", patterns),
    service
      .from("access_requests")
      .select("email")
      .eq("org_id", orgId)
      .ilikeAnyOf("email", patterns),
  ]);
  if (profiles.error) throw profiles.error;
  if (requests.error) throw requests.error;

  const lower = (rows: { email: string | null }[]) =>
    new Set(rows.flatMap((r) => (r.email ? [r.email.toLowerCase()] : [])));
  return { accounts: lower(profiles.data), invited: lower(requests.data) };
}

export interface MemberInvite {
  orgId: string;
  invitedBy: string;
  /** Normalized. */
  email: string;
  /** Shown on /setup-account and split into first and last name at signup. */
  name: string;
  /** Lists the person in this household and links them to it at signup. */
  household?: { id: string; firstName: string; lastName: string };
}

/**
 * Creates the invitation and sends its email. On any failure every row this
 * call wrote is deleted, so a retry starts clean. Returns false on failure;
 * the details are logged by row id, never by email.
 */
export async function sendMemberInvite(invite: MemberInvite): Promise<boolean> {
  const { orgId } = invite;
  const service = await createServiceClient();
  const undo: (() => PromiseLike<{ error: unknown }>)[] = [];

  const rollBack = async (stage: string, err: unknown) => {
    console.error("member invite: %s failed (org=%s):", stage, orgId, errorSummary(err));
    for (const step of undo.reverse()) {
      const { error } = await step();
      if (error) {
        console.error(
          "member invite: rollback step failed (org=%s):",
          orgId,
          errorSummary(error)
        );
      }
    }
    return false;
  };

  let inviteToken: string | null = null;
  if (invite.household) {
    // The composite (family_id, org_id) FK rejects a household from another
    // org, so the insert itself is the ownership check.
    const { data: member, error: memberError } = await service
      .from("family_members")
      .insert({
        org_id: orgId,
        family_id: invite.household.id,
        first_name: invite.household.firstName,
        last_name: invite.household.lastName,
        relationship: "other",
      })
      .select("id")
      .single();
    if (memberError || !member) return rollBack("household member insert", memberError);
    undo.push(() =>
      service.from("family_members").delete().eq("id", member.id).eq("org_id", orgId)
    );

    const { data: familyInvite, error: familyInviteError } = await service
      .from("family_invites")
      .insert({
        org_id: orgId,
        family_id: invite.household.id,
        family_member_id: member.id,
        invite_email: invite.email,
        sent_at: new Date().toISOString(),
        created_by: invite.invitedBy,
      })
      .select("id, token")
      .single();
    if (familyInviteError || !familyInvite) {
      return rollBack("household invite insert", familyInviteError);
    }
    undo.push(() =>
      service.from("family_invites").delete().eq("id", familyInvite.id).eq("org_id", orgId)
    );
    inviteToken = familyInvite.token;
  }

  const signupToken = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const { error: insertError } = await service.from("access_requests").insert({
    org_id: orgId,
    email: invite.email,
    name: invite.name,
    status: "approved",
    reviewed_by: invite.invitedBy,
    reviewed_at: now.toISOString(),
    signup_token: signupToken,
    token_expires_at: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
    invite_token: inviteToken,
  });
  if (insertError) return rollBack("access request insert", insertError);
  undo.push(() =>
    service
      .from("access_requests")
      .delete()
      .eq("signup_token", signupToken)
      .eq("org_id", orgId)
  );

  // /setup-account resolves the org from the signup token's row, so the link
  // carries nothing else.
  const setupLink = `${siteConfig.url}/setup-account?token=${signupToken}`;
  try {
    await sendMemberInviteEmail(invite.email, setupLink, await resolveEmailBranding(orgId));
  } catch (err) {
    return rollBack("invite email", err);
  }
  return true;
}
