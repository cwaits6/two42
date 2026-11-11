import { NextResponse } from "next/server";
import { isUuid } from "@/lib/groups/active";
import { createServiceClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

const MAX_NAME_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 2000;

/**
 * POST /api/family-invites/request — a household invitee asks an admin for
 * access. Anonymous: the invite token is the only thing that names the org,
 * and the pending access_requests row it files carries that org and the
 * token, which is what handle_new_user() and /api/auth/setup-account later
 * match on.
 */
export async function POST(request: Request) {
  let body: { token?: unknown; name?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!isUuid(token) || !name || message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  }
  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Use ${MAX_NAME_LENGTH} characters or fewer.` },
      { status: 400 },
    );
  }

  const service = await createServiceClient();
  // org-anchor: the invite row resolves the org; nothing is known before it
  // returns, and every read and write below scopes to its org_id.
  const { data: invite, error: inviteError } = await service
    .from("family_invites")
    .select("id, org_id, token, invite_email, accepted_at")
    .eq("token", token)
    .maybeSingle();
  if (inviteError) {
    logError(
      "family-invites/request: invite lookup failed",
      inviteError,
      { route: "/api/family-invites/request" },
    );
    return NextResponse.json({ error: "Failed to submit the request" }, { status: 500 });
  }
  if (!invite || invite.accepted_at) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  const { data: existing, error: existingError } = await service
    .from("access_requests")
    .select("id")
    .eq("org_id", invite.org_id)
    .ilike("email", invite.invite_email.replace(/[\\%_]/g, "\\$&"))
    .in("status", ["pending", "approved"])
    .limit(1);
  if (existingError) {
    logError(
      "family-invites/request: existing request lookup failed",
      existingError,
      { route: "/api/family-invites/request" },
    );
    return NextResponse.json({ error: "Failed to submit the request" }, { status: 500 });
  }
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: "A request for this email is already in." }, { status: 409 });
  }

  const { error: insertError } = await service.from("access_requests").insert({
    org_id: invite.org_id,
    name,
    email: invite.invite_email,
    message: message || null,
    invite_token: invite.token,
    status: "pending",
  });
  if (insertError) {
    logError(
      "family-invites/request: insert failed",
      insertError,
      { route: "/api/family-invites/request" },
    );
    return NextResponse.json({ error: "Failed to submit the request" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
