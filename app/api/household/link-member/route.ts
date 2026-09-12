import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * POST /api/household/link-member
 *
 * Allows a primary/spouse to add an existing enrolled member (who has no
 * household assigned) to their own household. Uses the service client to
 * bypass RLS since regular members can't update another profile's family_id.
 *
 * Body: { profile_id: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: currentProfile } = await supabase
    .from("profiles")
    .select("org_id, role, family_id, setup_completed, relationship")
    .eq("id", user.id)
    .single();

  if (
    !currentProfile ||
    !["member", "content_editor", "admin"].includes(currentProfile.role) ||
    !currentProfile.setup_completed ||
    !currentProfile.family_id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!["primary", "spouse"].includes(currentProfile.relationship ?? "")) {
    return NextResponse.json(
      { error: "Only the household primary or spouse can add members." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { profile_id, relationship } = body;
  if (!profile_id || typeof profile_id !== "string") {
    return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
  }

  const validRelationships = ["primary", "spouse", "child", "parent", "sibling", "other"];
  if (relationship && !validRelationships.includes(relationship as string)) {
    return NextResponse.json({ error: "Invalid relationship value." }, { status: 400 });
  }

  // Can't link yourself
  if (profile_id === user.id) {
    return NextResponse.json({ error: "Cannot link your own profile." }, { status: 400 });
  }

  // Verify the target profile exists, has no household, and is a member
  const { data: target } = await supabase
    .from("profiles")
    .select("id, org_id, first_name, last_name, family_id, role, setup_completed")
    .eq("id", profile_id)
    .single();

  if (!target) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  // This read runs on the authenticated client, so RLS already scopes it to
  // the caller's org — the check is defence-in-depth against a future
  // permissive policy. Reuse the not-found response: a distinguishing message
  // would be a cross-org existence oracle.
  if (target.org_id !== currentProfile.org_id) {
    console.error(
      "household/link-member: caller org %s does not match target org %s (user=%s, target=%s)",
      currentProfile.org_id,
      target.org_id,
      user.id,
      target.id,
    );
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  if (!["member", "content_editor", "admin"].includes(target.role)) {
    return NextResponse.json({ error: "This person is not an enrolled member." }, { status: 400 });
  }

  if (target.family_id) {
    return NextResponse.json(
      { error: "This member is already in a household. Contact an admin to move them." },
      { status: 409 },
    );
  }

  // Use service client to bypass RLS for the cross-profile family_id update.
  // The .is("family_id", null) predicate closes the TOCTOU window: if another
  // request assigned this person to a household between the check above and this
  // write, the update will match 0 rows and we return 409 rather than silently
  // overwriting. The org_id predicate is the tenancy analogue of the same
  // defence — this write bypasses RLS, so it must be confined to the caller's
  // own org explicitly.
  const service = await createServiceClient();
  const { data: updated, error } = await service
    .from("profiles")
    .update({
      family_id: currentProfile.family_id,
      ...(relationship ? { relationship } : {}),
    })
    .eq("id", profile_id)
    .eq("org_id", currentProfile.org_id)
    .is("family_id", null)
    .select("id");

  if (error) {
    console.error("link-member error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: "This member was assigned to a household by someone else just now. Refresh and try again." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    data: { profile_id, family_id: currentProfile.family_id, relationship: relationship ?? null },
  });
}
