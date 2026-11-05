import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { logError, logWarn } from "@/lib/log";

/**
 * POST /api/family-invites/claim
 *
 * Called after a new user signs up via /setup-account when they arrived
 * through a family invite link (/join/family/[token]).
 *
 * Actions:
 * 1. Validate the invite token is still open (not accepted)
 * 2. Verify the caller's own org matches the invite's org (403 on mismatch)
 * 3. Link profiles.family_id to the invite's family (500 if the scoped
 *    update matches zero rows)
 * 4. Set family_members.claimed_profile_id to the new user's profile id
 * 5. Mark family_invites.accepted_at = now()
 *
 * The caller must be authenticated (newly signed-in user).
 * Service client is used for the update so RLS doesn't block the new user.
 *
 * Input:  { invite_token: string }
 * Output: { success: true }
 */
export async function POST(request: Request) {
  // Verify the caller is authenticated
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { invite_token } = body as { invite_token?: string };

  if (!invite_token) {
    return NextResponse.json({ error: "invite_token is required" }, { status: 400 });
  }

  // Use service client so we can bypass RLS (new user may not yet have member role)
  const service = await createServiceClient();

  // org-anchor: the invite row resolves the org for every write below.
  // Load the invite — its row is the org anchor for every write below
  const { data: invite, error: inviteError } = await service
    .from("family_invites")
    .select("id, org_id, family_id, family_member_id, invite_email, accepted_at")
    .eq("token", invite_token)
    .maybeSingle();

  if (inviteError) {
    logError(
      "family-invites/claim: invite lookup error",
      inviteError,
      { route: "/api/family-invites/claim" },
    );
  }

  if (inviteError || !invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (invite.accepted_at) {
    return NextResponse.json(
      { error: "This invite has already been claimed" },
      { status: 409 },
    );
  }

  // Verify the authenticated user's email matches the invite recipient
  if (user.email?.toLowerCase() !== invite.invite_email?.toLowerCase()) {
    return NextResponse.json(
      { error: "Email does not match invite recipient" },
      { status: 403 },
    );
  }

  // org-anchor: reads the caller's own org to compare against the invite's
  // (the 403 assertion just below).
  // The caller is authenticated but their role may still be `pending`, so RLS
  // is not doing this check for us — and handle_new_user() should already
  // have placed them in the invite's org, so a mismatch is a real anomaly.
  const { data: callerProfile, error: callerError } = await service
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();

  if (callerError) {
    logError(
      "family-invites/claim: caller profile lookup error",
      callerError,
      { route: "/api/family-invites/claim" },
    );
    return NextResponse.json(
      { error: "Failed to link profile to family" },
      { status: 500 },
    );
  }

  if (callerProfile.org_id !== invite.org_id) {
    logError(
      "family-invites/claim: caller org does not match invite org",
      undefined,
      {
        route: "/api/family-invites/claim",
        ids: { caller_org: callerProfile.org_id, invite_org: invite.org_id, user: user.id, invite: invite.id },
      },
    );
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date().toISOString();

  // 1. Link the new profile to the family. The scoped update returning zero
  // rows is a real failure — without .select() an update matching nothing
  // reported success while linking nothing.
  const { data: linked, error: profileError } = await service
    .from("profiles")
    .update({ family_id: invite.family_id })
    .eq("id", user.id)
    .eq("org_id", invite.org_id)
    .select("id");

  if (profileError) {
    logError(
      "family-invites/claim: profile update error",
      profileError,
      {
        route: "/api/family-invites/claim",
        ids: { user: user.id, invite: invite.id, org: invite.org_id },
      },
    );
    return NextResponse.json({ error: "Failed to link profile to family" }, { status: 500 });
  }

  // Zero rows after the org check above passed means the profile row moved or
  // vanished mid-request — a tenancy anomaly, not an ordinary failure.
  if (!linked || linked.length === 0) {
    logError(
      "family-invites/claim: scoped profile update matched 0 rows",
      undefined,
      {
        route: "/api/family-invites/claim",
        ids: { user: user.id, invite: invite.id, org: invite.org_id },
      },
    );
    return NextResponse.json({ error: "Failed to link profile to family" }, { status: 500 });
  }

  // 2. Mark the family_members record as claimed
  const { data: fmUpdated, error: fmError } = await service
    .from("family_members")
    .update({ claimed_profile_id: user.id })
    .eq("id", invite.family_member_id)
    .eq("org_id", invite.org_id)
    .select("id");

  if (fmError || !fmUpdated || fmUpdated.length === 0) {
    logError(
      "family-invites/claim: family_members update matched 0 rows or failed",
      fmError,
      {
        route: "/api/family-invites/claim",
        ids: { user: user.id, invite: invite.id, org: invite.org_id },
      },
    );
    // Non-fatal — profile is already linked; log and continue
  }

  // 3. Mark the invite as accepted
  const { data: accepted, error: acceptError } = await service
    .from("family_invites")
    .update({ accepted_at: now })
    .eq("id", invite.id)
    .eq("org_id", invite.org_id)
    .select("id");

  if (acceptError || !accepted || accepted.length === 0) {
    logWarn(
      "family-invites/claim: failed to mark invite accepted",
      acceptError,
      { route: "/api/family-invites/claim", ids: { invite: invite.id, org: invite.org_id } },
    );
    // Profile is already linked; return partial success so admin can remediate
    return NextResponse.json({ success: true, warning: "Profile linked but invite record was not updated." });
  }

  return NextResponse.json({ success: true });
}
