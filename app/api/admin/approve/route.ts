import { createClient } from "@/lib/supabase/server";
import { sendInviteEmail } from "@/lib/email/resend";
import { resolveEmailBranding } from "@/lib/email/identity";
import { orgBaseUrl } from "@/lib/org-urls";
import { NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(request: Request) {
  const supabase = await createClient();

  // Verify the caller is an admin
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, name } = await request.json();

  if (!email || !name) {
    return NextResponse.json({ error: "Missing email or name" }, { status: 400 });
  }

  try {
    // Generate a secure signup token (expires in 7 days)
    const signupToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Update the access request with approval status and signup token
    const { data: updated, error: updateError } = await supabase
      .from("access_requests")
      .update({
        status: "approved",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        signup_token: signupToken,
        token_expires_at: tokenExpiresAt,
      })
      .eq("email", email)
      .eq("status", "pending")
      .select();

    if (updateError) {
      throw updateError;
    }

    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: "No pending request found for this email" },
        { status: 404 }
      );
    }

    // The org comes from the row just updated under RLS — the caller's own
    // org — so the link and branding follow the recipient's org host, not
    // the deployment's env-pinned platform URL.
    const orgId = updated[0].org_id;
    const signupLink = `${await orgBaseUrl(orgId)}/setup-account?token=${signupToken}`;
    try {
      await sendInviteEmail(email, name, signupLink, await resolveEmailBranding(orgId));
    } catch (sendError) {
      // Roll the request back to pending so a retry doesn't 404 — mirrors
      // /api/platform/organizations/[id]/invite-owner's rollback-on-send-failure.
      const { error: rollbackError } = await supabase
        .from("access_requests")
        .update({ status: "pending", signup_token: null, token_expires_at: null })
        .eq("email", email)
        .eq("signup_token", signupToken);
      if (rollbackError) {
        // The row is now stuck approved with a token nobody received. Name it
        // so an operator can find and repair it without the email error.
        console.error(
          "Invite email send failed AND rollback failed; access_requests row for %s (org=%s) is approved with an unsent token:",
          email,
          orgId,
          rollbackError
        );
      } else {
        console.error("Invite email send failed; approval rolled back:", sendError);
      }
      return NextResponse.json(
        { error: "Failed to send invite email" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Approval error:", error);
    return NextResponse.json(
      { error: "Failed to process approval" },
      { status: 500 }
    );
  }
}
