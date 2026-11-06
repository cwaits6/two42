import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { NextResponse } from "next/server";
import { isMemberRole, STORED_MEMBER_ROLES } from "@/lib/roles";

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
    !isMemberRole(currentProfile.role) ||
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
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, preferred_name, avatar_url")
    .is("family_id", null)
    .neq("id", user.id)
    .in("role", STORED_MEMBER_ROLES)
    .eq("setup_completed", true)
    .or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,preferred_name.ilike.%${safe}%`)
    .order("first_name")
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Private buckets: the client renders these avatars directly, so
  // exchange stored URLs for signed URLs in the response.
  const rows = data ?? [];
  // The directory view carries an address only when its owner shows it.
  const [signedAvatars, { data: addresses, error: addressError }] = await Promise.all([
    mintSignedUrls(rows.map((r) => r.avatar_url)),
    supabase
      .from("profiles_directory")
      .select("id, email")
      .in("id", rows.map((r) => r.id)),
  ]);
  if (addressError) return NextResponse.json({ error: addressError.message }, { status: 500 });
  const emailById = new Map(addresses.map((a) => [a.id, a.email]));

  const results = rows.map((row, i) => ({
    ...row,
    avatar_url: signedAvatars[i],
    email: emailById.get(row.id) ?? null,
  }));

  return NextResponse.json({ data: results });
}
