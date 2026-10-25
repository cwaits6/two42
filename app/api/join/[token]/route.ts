import crypto from "crypto";
import { NextResponse } from "next/server";
import { EMAIL } from "@/lib/branding";
import { siteConfig } from "@/lib/config";
import { resolveEmailBranding } from "@/lib/email/identity";
import { reserveEmailQuota } from "@/lib/email/quota";
import { sendGroupInviteEmail } from "@/lib/email/resend";
import { isUuid } from "@/lib/groups/active";
import { INVITE_INVALID_TEXT } from "@/lib/groups/invites";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/server";

const SIGNUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// A Response body can be sent once, so the dead-link reply is built per request.
function invalid() {
  return NextResponse.json({ error: INVITE_INVALID_TEXT }, { status: 404 });
}
const CANNOT_SIGN_UP = {
  error: "We can't set up an account for that email address. If you already have an account, sign in and open this link again.",
};

type RedeemedRow = Database["public"]["Functions"]["group_invite_redeem"]["Returns"][number];

/**
 * POST /api/join/[token] — the new-person path of a group invite. The
 * redeem RPC writes the approved access request and the use row; this
 * route mints the signup token, mails it, and clears it again if the mail
 * never left, so the person can simply submit the form once more. The
 * address is never logged: it is the one piece of PII on this surface.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isUuid(token)) return invalid();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // A body of `null` parses fine, so the shape check has to come after.
  const fields: { name?: unknown; email?: unknown } =
    typeof body === "object" && body !== null ? body : {};
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  const email = typeof fields.email === "string" ? fields.email.trim() : "";
  if (!name || !email || email.length > 254 || !EMAIL.test(email)) {
    return NextResponse.json({ error: "Enter your name and a valid email address." }, { status: 400 });
  }

  const signupToken = crypto.randomBytes(32).toString("hex");
  const tokenExpiresAt = new Date(Date.now() + SIGNUP_TOKEN_TTL_MS).toISOString();

  const service = await createServiceClient();
  // org-anchor: the invite token resolves the org inside group_invite_redeem();
  // there is no org_id to pass. Every write after this scopes to the row it returns.
  const { data, error } = await service.rpc("group_invite_redeem", {
    _token: token,
    _name: name,
    _email: email,
    _signup_token: signupToken,
    _token_expires_at: tokenExpiresAt,
  });
  if (error) {
    switch (error.code) {
      case "GI001":
        return invalid();
      case "GI002":
        return NextResponse.json({ error: "Enter your name and a valid email address." }, { status: 400 });
      case "GI003":
      case "GI004":
      case "GI006":
        return NextResponse.json(CANNOT_SIGN_UP, { status: 409 });
      default:
        console.error("Join route: redeem failed:", error);
        return NextResponse.json({ error: "Failed to process the invite" }, { status: 500 });
    }
  }
  const row: RedeemedRow | undefined = data?.[0];
  if (!row) {
    console.error("Join route: redeem returned no row");
    return NextResponse.json({ error: "Failed to process the invite" }, { status: 500 });
  }

  // A token nobody received must not stay live; the person resubmits and
  // the RPC mints a fresh one without a second use.
  async function clearToken() {
    const { error: clearError } = await service
      .from("access_requests")
      .update({ signup_token: null, token_expires_at: null })
      .eq("id", row!.access_request_id)
      .eq("org_id", row!.org_id);
    if (clearError) {
      console.error(
        "Join route: setup email never sent AND the token could not be cleared; access_requests row %s (org=%s) holds an unsent token:",
        row!.access_request_id,
        row!.org_id,
        clearError,
      );
    }
  }

  if (!(await reserveEmailQuota(row.org_id, 1))) {
    await clearToken();
    return NextResponse.json(
      { error: "We couldn't send the email right now. Try again in a few minutes." },
      { status: 503 },
    );
  }

  try {
    await sendGroupInviteEmail(
      email,
      name,
      row.group_name,
      `${siteConfig.url}/setup-account?token=${signupToken}`,
      await resolveEmailBranding(row.org_id),
    );
  } catch (sendError) {
    console.error("Join route: setup email failed for access_requests row %s:", row.access_request_id, sendError);
    await clearToken();
    return NextResponse.json(
      { error: "We couldn't send the email right now. Try again in a few minutes." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
