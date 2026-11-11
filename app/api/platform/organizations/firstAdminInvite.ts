/**
 * Sends a church's first admin their invite: mints the signup token on the
 * founding access request and mails the setup link. Shared by Add
 * organization and the church page's Send invite.
 *
 * The service client bypasses RLS, so `orgId` must already be validated by
 * the caller: the id provision_organization() returned in the same request,
 * or the route param behind the platform-admin gate. Every query below
 * filters on it.
 */
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveEmailBranding } from "@/lib/email/identity";
import { reserveEmailQuota } from "@/lib/email/quota";
import { sendMemberInviteEmail } from "@/lib/email/resend";
import { siteConfig } from "@/lib/config";
import { normalizeEmail } from "@/lib/sanitize";
import { logError, stepOf } from "@/lib/log";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type FirstAdminInviteResult =
  | { sent: true }
  | { sent: false; reason: "not_found" | "limit" | "failed" };

export async function sendFirstAdminInvite(opts: {
  orgId: string;
  /** The address the caller expects on the founding request. */
  email: string;
  operatorId: string;
}): Promise<FirstAdminInviteResult> {
  const { orgId } = opts;
  const fail = (stage: string, err: unknown): FirstAdminInviteResult => {
    logError("First admin invite: stage failed", err, {
      step: stepOf(stage),
      ids: { org: orgId },
    });
    return { sent: false, reason: "failed" };
  };

  try {
    const service = await createServiceClient();
    const { data: rows, error: readError } = await service
      .from("access_requests")
      .select("id, email")
      .eq("org_id", orgId)
      .eq("approved_role", "admin")
      .order("created_at", { ascending: true })
      .limit(1);
    if (readError) return fail("founding request read", readError);

    // Compared here rather than in the query: rows added before emails were
    // lowercased on save can hold the address in mixed case.
    const row = rows?.[0];
    const email = row ? normalizeEmail(row.email) : null;
    if (!row || !email || email !== normalizeEmail(opts.email)) {
      return { sent: false, reason: "not_found" };
    }

    // Before the token, so a refusal leaves nothing to roll back.
    if (!(await reserveEmailQuota(orgId, 1))) return { sent: false, reason: "limit" };

    const signupToken = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    const { data: updated, error: updateError } = await service
      .from("access_requests")
      .update({
        status: "approved",
        reviewed_by: opts.operatorId,
        reviewed_at: new Date(now).toISOString(),
        signup_token: signupToken,
        token_expires_at: new Date(now + TOKEN_TTL_MS).toISOString(),
      })
      .eq("id", row.id)
      .eq("org_id", orgId)
      .select("id");
    if (updateError) return fail("token update", updateError);
    if (!updated || updated.length === 0) return fail("token update", undefined);

    const setupLink = `${siteConfig.url}/setup-account?token=${signupToken}`;
    try {
      await sendMemberInviteEmail(email, setupLink, await resolveEmailBranding(orgId));
    } catch (sendError) {
      // Rolled back so the church page shows the invite as not sent.
      const { error: rollbackError } = await service
        .from("access_requests")
        .update({ signup_token: null, token_expires_at: null })
        .eq("id", row.id)
        .eq("org_id", orgId)
        .eq("signup_token", signupToken);
      if (rollbackError) {
        logError("First admin invite: rollback failed", rollbackError, { ids: { org: orgId } });
      }
      return fail("invite email", sendError);
    }
    return { sent: true };
  } catch (err) {
    return fail("unexpected", err);
  }
}
