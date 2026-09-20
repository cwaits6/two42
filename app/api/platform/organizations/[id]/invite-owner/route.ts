import { NextResponse } from "next/server";
import crypto from "crypto";
import { requirePlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveEmailBranding } from "@/lib/email/identity";
import { sendInviteEmail } from "@/lib/email/resend";
import { siteConfig } from "@/lib/config";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status }
    );
  }
  const user = gate.user;

  const { id } = await params;

  let body: { ownerEmail?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ownerEmail = typeof body.ownerEmail === "string" ? body.ownerEmail.trim() : "";
  if (!ownerEmail) {
    return NextResponse.json({ error: "Missing owner email" }, { status: 400 });
  }

  try {
    // Mint a fresh signup token (7-day expiry, same shape as
    // /api/admin/approve). Re-sending re-mints, which invalidates any
    // previous link — the UI says so.
    const signupToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // access_requests is org-owned and this is a BYPASSRLS client, so the
    // .eq("org_id", id) below IS the tenant boundary — the org id comes from
    // the route param, authorized by the platform-admin gate above. See
    // docs/security/service-role-inventory.md.
    const service = await createServiceClient();
    const { data: updated, error: updateError } = await service
      .from("access_requests")
      .update({
        status: "approved",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        signup_token: signupToken,
        token_expires_at: tokenExpiresAt,
      })
      .eq("org_id", id)
      .eq("approved_role", "admin")
      .eq("email", ownerEmail)
      .select("name, email");

    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: "No founding-admin request found for this organization" },
        { status: 404 }
      );
    }

    const signupLink = `${siteConfig.url}/setup-account?token=${signupToken}`;
    try {
      await sendInviteEmail(
        ownerEmail,
        updated[0].name,
        signupLink,
        await resolveEmailBranding(id)
      );
    } catch (sendError) {
      // Null the token back out so the operator can retry cleanly (mirrors
      // /api/admin/invite-bulk's rollback-on-send-failure).
      await service
        .from("access_requests")
        .update({ signup_token: null, token_expires_at: null })
        .eq("org_id", id)
        .eq("email", ownerEmail)
        .eq("signup_token", signupToken);
      console.error("Invite email send failed; token rolled back:", sendError);
      return NextResponse.json(
        { error: "Failed to send invite email" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Invite owner error:", error);
    return NextResponse.json({ error: "Failed to send invite" }, { status: 500 });
  }
}
