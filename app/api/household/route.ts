import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { isMemberRole } from "@/lib/roles";
import { householdUpdates } from "./householdUpdates";

// Raised by the family_units_phone_owner_guard trigger, the server's own refusal.
const PHONE_OWNER_REFUSED = "HP001";

async function getHouseholdContext(supabase: Awaited<ReturnType<typeof createClient>>) {
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

/** GET /api/household — fetch current user's family unit */
export async function GET() {
  const supabase = await createClient();
  const ctx = await getHouseholdContext(supabase);
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: family, error } = await supabase
    .from("family_units")
    .select("*")
    .eq("id", ctx.profile.family_id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: family });
}

/** PATCH /api/household — update current user's family unit info */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const ctx = await getHouseholdContext(supabase);
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!["primary", "spouse"].includes(ctx.profile.relationship ?? "")) {
    return NextResponse.json(
      { error: "Only the household primary or spouse can update household info." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = householdUpdates(body, ctx.user.id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  const { updates } = result;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("family_units")
    .update(updates)
    .eq("id", ctx.profile.family_id)
    .select()
    .single();

  if (error?.code === PHONE_OWNER_REFUSED) {
    return NextResponse.json({ error: "Only that spouse can choose their own number." }, { status: 403 });
  }
  if (error) {
    console.error("household PATCH error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
