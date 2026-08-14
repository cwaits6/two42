import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { NextResponse } from "next/server";

/**
 * GET /api/household/search-members?q=name
 *
 * Search enrolled profiles who have no household assigned, to allow a
 * primary/spouse to link them to their own household.
 */
export async function GET(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: currentProfile } = await supabase
    .from("profiles")
    .select("role, family_id, setup_completed, relationship")
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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ data: [] });
  }

  // Escape PostgREST filter special characters to prevent malformed queries
  const safe = q.replace(/[,()]/g, "");

  // Search profiles without a household, matching first or last name.
  // We select hide_email so we can respect the member's privacy setting
  // before displaying their email in the UI.
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, preferred_name, avatar_url, email, hide_email")
    .is("family_id", null)
    .neq("id", user.id)
    .in("role", ["member", "content_editor", "admin"])
    .eq("setup_completed", true)
    .or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,preferred_name.ilike.%${safe}%`)
    .order("first_name")
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Private buckets (CWA-59): the client renders these avatars directly, so
  // exchange stored URLs for signed URLs in the response.
  const rows = data ?? [];
  const signedAvatars = await mintSignedUrls(rows.map((r) => r.avatar_url));

  // Mask email for members who have opted out of showing it
  const results = rows.map(({ hide_email, email, ...rest }, i) => ({
    ...rest,
    avatar_url: signedAvatars[i],
    email: hide_email ? null : email,
  }));

  return NextResponse.json({ data: results });
}
