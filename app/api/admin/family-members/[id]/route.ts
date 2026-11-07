import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { logError } from "@/lib/log";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** PATCH /api/admin/family-members/[id] — update a family member */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
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

  const updates: Record<string, unknown> = {};
  if (first_name !== undefined) updates.first_name = first_name;
  if (last_name !== undefined) updates.last_name = last_name || null;
  if (preferred_name !== undefined) updates.preferred_name = preferred_name || null;
  if (relationship !== undefined) updates.relationship = relationship;
  if (birth_month !== undefined)
    updates.birth_month = birth_month ? Number(birth_month) : null;
  if (birth_day !== undefined)
    updates.birth_day = birth_day ? Number(birth_day) : null;
  if (birth_year !== undefined)
    updates.birth_year = birth_year ? Number(birth_year) : null;
  if (is_class_member !== undefined) updates.is_class_member = is_class_member;

  const { data, error } = await supabase
    .from("family_members")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    logError("family-members PATCH error", error, { route: "/api/admin/family-members/[id]" });
    return NextResponse.json({ error: "Couldn't save their details. Try again." }, { status: 500 });
  }

  return NextResponse.json({ data });
}

/** DELETE /api/admin/family-members/[id] — delete a family member */
export async function DELETE(request: Request, { params }: RouteParams) {
  const { id } = await params;
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

  const { error } = await supabase
    .from("family_members")
    .delete()
    .eq("id", id);

  if (error) {
    logError("family-members DELETE error", error, { route: "/api/admin/family-members/[id]" });
    return NextResponse.json({ error: "Couldn't remove them from the household. Try again." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
