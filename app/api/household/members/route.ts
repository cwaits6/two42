import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { titleCaseName } from "@/lib/sanitize";
import { isMemberRole } from "@/lib/roles";

async function getMemberContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, family_id, setup_completed, relationship")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    !isMemberRole(profile.role) ||
    !profile.setup_completed ||
    !profile.family_id
  ) {
    return null;
  }

  return { user, profile };
}

/** GET /api/household/members — list non-auth family members for current household */
export async function GET() {
  const supabase = await createClient();
  const ctx = await getMemberContext(supabase);
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("family_members")
    .select("*")
    .eq("family_id", ctx.profile.family_id)
    .order("relationship");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

/** POST /api/household/members — add a non-auth family member to current household */
export async function POST(request: Request) {
  const supabase = await createClient();
  const ctx = await getMemberContext(supabase);
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!["primary", "spouse"].includes(ctx.profile.relationship ?? "")) {
    return NextResponse.json(
      { error: "Only the household primary or spouse can add family members." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    first_name,
    last_name,
    preferred_name,
    relationship,
    birth_month,
    birth_day,
    birth_year,
    is_class_member,
  } = body;

  const firstName = titleCaseName(String(first_name ?? ""));
  if (!firstName) return NextResponse.json({ error: "first_name is required" }, { status: 400 });
  if (!relationship) return NextResponse.json({ error: "relationship is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("family_members")
    .insert({
      family_id: ctx.profile.family_id,
      first_name: firstName,
      last_name: titleCaseName(String(last_name ?? "")) || null,
      preferred_name: titleCaseName(String(preferred_name ?? "")) || null,
      relationship,
      birth_month: birth_month ? Number(birth_month) : null,
      birth_day: birth_day ? Number(birth_day) : null,
      birth_year: birth_year ? Number(birth_year) : null,
      is_class_member: is_class_member ? Boolean(is_class_member) : false,
    })
    .select()
    .single();

  if (error) {
    console.error("household/members POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
