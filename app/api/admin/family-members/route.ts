import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { logError } from "@/lib/log";

/** POST /api/admin/family-members — create a new family member record */
export async function POST(request: Request) {
  const supabase = await createClient();

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

  const body = await request.json().catch(() => ({}));
  const {
    family_id,
    first_name,
    last_name,
    preferred_name,
    relationship,
    birth_month,
    birth_day,
    birth_year,
    is_class_member,
  } = body;

  if (!family_id || !first_name || !relationship) {
    return NextResponse.json(
      { error: "family_id, first_name, and relationship are required" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("family_members")
    .insert({
      family_id,
      first_name,
      last_name: last_name || null,
      preferred_name: preferred_name || null,
      relationship,
      birth_month: birth_month ? Number(birth_month) : null,
      birth_day: birth_day ? Number(birth_day) : null,
      birth_year: birth_year ? Number(birth_year) : null,
      is_class_member: is_class_member ?? false,
    })
    .select()
    .single();

  if (error) {
    logError("family-members POST error", error, { route: "/api/admin/family-members" });
    return NextResponse.json({ error: "Couldn't add them to the household. Try again." }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
