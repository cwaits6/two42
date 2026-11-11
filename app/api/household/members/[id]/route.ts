import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { memberNames } from "@/lib/nameField";
import { isMemberRole } from "@/lib/roles";
import { logError } from "@/lib/log";

interface RouteParams {
  params: Promise<{ id: string }>;
}

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

/** PATCH /api/household/members/[id] — update a family member in current household */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getMemberContext(supabase);
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!["primary", "spouse"].includes(ctx.profile.relationship ?? "")) {
    return NextResponse.json(
      { error: "Only the household primary or spouse can edit family members." },
      { status: 403 },
    );
  }

  // Verify the family member belongs to the current user's household
  const { data: existing } = await supabase
    .from("family_members")
    .select("family_id")
    .eq("id", id)
    .single();

  if (!existing || existing.family_id !== ctx.profile.family_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { relationship, birth_month, birth_day, birth_year, is_class_member, avatar_url } = body;

  const { names, fieldErrors } = memberNames(body, "update");
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }
  const updates: Record<string, unknown> = { ...names };
  if (relationship !== undefined) updates.relationship = relationship;
  if (birth_month !== undefined) updates.birth_month = birth_month ? Number(birth_month) : null;
  if (birth_day !== undefined) updates.birth_day = birth_day ? Number(birth_day) : null;
  if (birth_year !== undefined) updates.birth_year = birth_year ? Number(birth_year) : null;
  if (is_class_member !== undefined) updates.is_class_member = Boolean(is_class_member);
  if (avatar_url !== undefined) updates.avatar_url = avatar_url || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("family_members")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    logError("household/members PATCH error", error, { route: "/api/household/members/[id]" });
    return NextResponse.json({ error: "Couldn't save their details. Try again." }, { status: 500 });
  }

  return NextResponse.json({ data });
}

/** DELETE /api/household/members/[id] — remove a family member from current household */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getMemberContext(supabase);
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!["primary", "spouse"].includes(ctx.profile.relationship ?? "")) {
    return NextResponse.json(
      { error: "Only the household primary or spouse can remove family members." },
      { status: 403 },
    );
  }

  // Verify the family member belongs to the current user's household
  const { data: existing } = await supabase
    .from("family_members")
    .select("family_id")
    .eq("id", id)
    .single();

  if (!existing || existing.family_id !== ctx.profile.family_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await supabase.from("family_members").delete().eq("id", id);

  if (error) {
    logError("household/members DELETE error", error, { route: "/api/household/members/[id]" });
    return NextResponse.json({ error: "Couldn't remove them from your household. Try again." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
