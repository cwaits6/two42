import { NextResponse } from "next/server";
import { householdInviteVerdict } from "@/app/join/family/[token]/joinVerdict";
import { isUuid } from "@/lib/groups/active";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logError, logWarn } from "@/lib/log";


function failed() {
  return NextResponse.json({ error: "Failed to join the household" }, { status: 500 });
}

function notFound() {
  return NextResponse.json({ error: "Invite not found" }, { status: 404 });
}

/**
 * POST /api/family-invites/join — a signed-in person takes up a household
 * invite sent to their address. The invite row is the org anchor: the
 * household, the member and the church all come from it, and the body names
 * only the token.
 *
 * The writes are conditional updates to fixed values, so two presses converge
 * on one join, even when both read the person as not yet in a household. The
 * invite is accepted last: a failure before it leaves the invite live, and a
 * retry finds the profile already in this household and finishes.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!isUuid(token)) return notFound();

  const service = await createServiceClient();
  // org-anchor: the invite row resolves the org; nothing is known before it
  // returns, and every read and write below scopes to its org_id.
  const { data: invite, error: inviteError } = await service
    .from("family_invites")
    .select("id, org_id, family_id, family_member_id, invite_email, accepted_at")
    .eq("token", token)
    .maybeSingle();
  if (inviteError) {
    logError("family-invites/join: invite lookup failed", inviteError, { route: "/api/family-invites/join" });
    return failed();
  }
  if (!invite) return notFound();
  const ids = { user: user.id, invite: invite.id };

  const [{ data: profile, error: profileError }, { data: member, error: memberError }] = await Promise.all([
    supabase.from("profiles").select("org_id, role, family_id, relationship").eq("id", user.id).maybeSingle(),
    service
      .from("family_members")
      .select("id, family_id, relationship, claimed_profile_id")
      .eq("id", invite.family_member_id)
      .eq("org_id", invite.org_id)
      .maybeSingle(),
  ]);
  if (profileError || memberError) {
    logError("family-invites/join: profile or member lookup failed", profileError ?? memberError, {
      route: "/api/family-invites/join",
      ids,
    });
    return failed();
  }

  const verdict = householdInviteVerdict({ invite, member, profile, user });
  switch (verdict) {
    case "joined":
      return NextResponse.json({ joined: true });
    case "invalid":
      if (profile && profile.org_id !== invite.org_id) {
        logWarn("family-invites/join: invite from another church refused", undefined, {
          route: "/api/family-invites/join",
          ids: { ...ids, org: invite.org_id, callerOrg: profile.org_id },
        });
      }
      return notFound();
    case "different_account":
      return NextResponse.json({ error: "Different account" }, { status: 403 });
    case "other_household":
      return NextResponse.json({ error: "Already in a household" }, { status: 409 });
    case "joinable":
      break;
  }
  // The verdict is joinable only with both rows in hand.
  if (!member || !profile) return notFound();

  // Each write is a compare-and-set on the value the verdict read, so a change
  // in between matches no row. PostgREST answers an or() filter on PATCH with
  // 42703, so the value read picks an is() or an eq() instead.
  //
  // The member's relationship, not the column default, so a spouse or child
  // joining never reads as a second primary with a primary's rights.
  const link = service
    .from("profiles")
    .update({ family_id: invite.family_id, relationship: member.relationship })
    .eq("id", user.id)
    .eq("org_id", invite.org_id);
  const { data: linked, error: linkError } = await (
    profile.family_id === null ? link.is("family_id", null) : link.eq("family_id", invite.family_id)
  ).select("id");
  if (linkError) {
    logError("family-invites/join: linking the household failed", linkError, { route: "/api/family-invites/join", ids });
    return failed();
  }
  if (!linked || linked.length === 0) {
    // A concurrent press may have linked this same household first; only a
    // different household is a refusal.
    const { data: now, error: rereadError } = await service
      .from("profiles")
      .select("family_id")
      .eq("id", user.id)
      .eq("org_id", invite.org_id)
      .maybeSingle();
    if (rereadError) {
      logError("family-invites/join: re-reading the household failed", rereadError, {
        route: "/api/family-invites/join",
        ids,
      });
      return failed();
    }
    if (now?.family_id !== invite.family_id) {
      return NextResponse.json({ error: "Already in a household" }, { status: 409 });
    }
  }

  // Never take over a member another account already claimed.
  const claim = service
    .from("family_members")
    .update({ claimed_profile_id: user.id })
    .eq("id", member.id)
    .eq("org_id", invite.org_id)
    .eq("family_id", invite.family_id);
  const { data: claimed, error: claimError } = await (
    member.claimed_profile_id === null
      ? claim.is("claimed_profile_id", null)
      : claim.eq("claimed_profile_id", user.id)
  ).select("id");
  if (claimError) {
    logError("family-invites/join: marking the household member claimed failed", claimError, {
      route: "/api/family-invites/join",
      ids,
    });
    return failed();
  }
  if (!claimed || claimed.length === 0) {
    // A concurrent press by this account may have claimed it first; anything
    // else means the member left or went to another account since the verdict.
    const { data: memberNow, error: memberRereadError } = await service
      .from("family_members")
      .select("family_id, claimed_profile_id")
      .eq("id", member.id)
      .eq("org_id", invite.org_id)
      .maybeSingle();
    if (memberRereadError) {
      logError("family-invites/join: re-reading the household member failed", memberRereadError, {
        route: "/api/family-invites/join",
        ids,
      });
      return failed();
    }
    if (memberNow?.family_id !== invite.family_id || memberNow?.claimed_profile_id !== user.id) {
      logWarn("family-invites/join: household member gone or claimed by another account", undefined, {
        route: "/api/family-invites/join",
        ids,
      });
      // Undo only a link this request made, so the refusal grants nothing.
      if (linked && linked.length > 0 && profile.family_id === null) {
        const { error: unlinkError } = await service
          .from("profiles")
          .update({ family_id: null, relationship: profile.relationship })
          .eq("id", user.id)
          .eq("org_id", invite.org_id)
          .eq("family_id", invite.family_id);
        if (unlinkError) {
          logError("family-invites/join: undoing the household link failed", unlinkError, {
            route: "/api/family-invites/join",
            ids,
          });
          return failed();
        }
      }
      return notFound();
    }
  }

  // Zero rows here means a concurrent press accepted it first.
  const { error: acceptError } = await service
    .from("family_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id)
    .eq("org_id", invite.org_id)
    .is("accepted_at", null)
    .select("id");
  if (acceptError) {
    logError("family-invites/join: accepting the invite failed", acceptError, { route: "/api/family-invites/join", ids });
    return failed();
  }

  return NextResponse.json({ joined: true });
}
