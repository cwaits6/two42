import { createClient } from "@/lib/supabase/server";
import { sendFamilyInviteEmail } from "@/lib/email/resend";
import { resolveEmailBranding } from "@/lib/email/identity";
import { orgBaseUrl } from "@/lib/org-urls";
import { NextResponse } from "next/server";

/**
 * POST /api/family-invites
 *
 * Sends an invite email to a person who exists as a family_members record
 * (lightweight non-auth record) so they can create their own account and
 * be linked to the household.
 *
 * Caller must be:
 *   - An admin, OR
 *   - The household primary member (their profiles.family_id matches
 *     the family_members.family_id)
 *
 * Input:  { family_member_id: string, invite_email: string }
 * Output: { success: true, message: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load the caller's profile to check role + family membership
  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role, family_id, first_name, last_name, preferred_name")
    .eq("id", user.id)
    .single();

  if (!callerProfile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const isAdmin = callerProfile.role === "admin";
  const isMember = ["member", "content_editor", "admin"].includes(
    callerProfile.role,
  );

  if (!isMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { family_member_id, invite_email } = body as {
    family_member_id?: string;
    invite_email?: string;
  };

  if (!family_member_id || !invite_email) {
    return NextResponse.json(
      { error: "family_member_id and invite_email are required" },
      { status: 400 },
    );
  }

  // Load the family_members record
  const { data: familyMember, error: fmError } = await supabase
    .from("family_members")
    .select("id, family_id, first_name, last_name, claimed_profile_id")
    .eq("id", family_member_id)
    .single();

  if (fmError || !familyMember) {
    return NextResponse.json(
      { error: "Family member not found" },
      { status: 404 },
    );
  }

  // Authorization: admin can always invite; members can only invite within their own family
  if (
    !isAdmin &&
    callerProfile.family_id !== familyMember.family_id
  ) {
    return NextResponse.json(
      { error: "You can only send invites for members of your own household" },
      { status: 403 },
    );
  }

  // Check if already claimed
  if (familyMember.claimed_profile_id) {
    return NextResponse.json(
      { error: "This family member already has an account" },
      { status: 409 },
    );
  }

  // Check for an existing pending invite for this family member
  const { data: existingInvite } = await supabase
    .from("family_invites")
    .select("id, accepted_at")
    .eq("family_member_id", family_member_id)
    .is("accepted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingInvite) {
    return NextResponse.json(
      {
        error:
          "A pending invite already exists for this family member. Check your email or wait for it to expire.",
      },
      { status: 409 },
    );
  }

  // Insert the invite record
  const { data: invite, error: insertError } = await supabase
    .from("family_invites")
    .insert({
      family_member_id,
      family_id: familyMember.family_id,
      invite_email,
      sent_at: new Date().toISOString(),
      created_by: user.id,
    })
    .select("token, org_id")
    .single();

  if (insertError || !invite) {
    console.error("family-invites insert error:", insertError);
    return NextResponse.json(
      { error: "Failed to create invite" },
      { status: 500 },
    );
  }

  // Build the join link on the org's own host. org_id comes from the invite
  // row just inserted under RLS (the caller's org), so the link — and the
  // branding below — follow the recipient's org, not the platform URL.
  const joinLink = `${await orgBaseUrl(invite.org_id)}/join/family/${invite.token}`;

  // Build the inviter's display name
  const inviterName =
    [
      callerProfile.preferred_name || callerProfile.first_name,
      callerProfile.last_name,
    ]
      .filter(Boolean)
      .join(" ") || "A member";

  // Build the family member's display name
  const memberName = [familyMember.first_name, familyMember.last_name]
    .filter(Boolean)
    .join(" ");

  try {
    await sendFamilyInviteEmail(
      invite_email,
      inviterName,
      memberName,
      joinLink,
      await resolveEmailBranding(invite.org_id),
    );
  } catch (emailError) {
    console.error("Failed to send family invite email:", emailError);
    // Return success anyway — the invite row was created, they can resend
    return NextResponse.json({
      success: true,
      message:
        "Invite created but email delivery failed. Please try again or contact support.",
      warning: "email_failed",
    });
  }

  return NextResponse.json({
    success: true,
    message: `Invite sent to ${invite_email}`,
  });
}
