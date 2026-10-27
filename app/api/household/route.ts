import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import {
  titleCaseName,
  titleCaseStreet,
  titleCaseCity,
  normalizePhone,
  normalizeState,
  normalizePostalCode,
} from "@/lib/sanitize";
import { isMemberRole } from "@/lib/roles";

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

  const {
    family_name,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    phone_home,
    anniversary,
    hide_address,
    hide_phone_home,
  } = body;

  const updates: Record<string, unknown> = {};

  if (family_name !== undefined) {
    const name = titleCaseName(String(family_name));
    if (!name) return NextResponse.json({ error: "Family name is required" }, { status: 400 });
    updates.family_name = name;
  }
  if (address_line1 !== undefined) updates.address_line1 = titleCaseStreet(String(address_line1 ?? "")) || null;
  if (address_line2 !== undefined) updates.address_line2 = titleCaseStreet(String(address_line2 ?? "")) || null;
  if (city !== undefined) updates.city = titleCaseCity(String(city ?? "")) || null;
  if (state !== undefined) {
    const stateCode = state ? normalizeState(String(state)) : null;
    if (state && !stateCode) return NextResponse.json({ error: "Invalid state" }, { status: 400 });
    updates.state = stateCode;
  }
  if (postal_code !== undefined) {
    const postal = postal_code ? normalizePostalCode(String(postal_code)) : null;
    if (postal_code && !postal) return NextResponse.json({ error: "Invalid ZIP code" }, { status: 400 });
    updates.postal_code = postal;
  }
  if (phone_home !== undefined) {
    const phone = phone_home ? normalizePhone(String(phone_home)) : null;
    if (phone_home && !phone) return NextResponse.json({ error: "Invalid home phone" }, { status: 400 });
    updates.phone_home = phone;
  }
  if (anniversary !== undefined) updates.anniversary = anniversary || null;
  if (hide_address !== undefined) updates.hide_address = Boolean(hide_address);
  if (hide_phone_home !== undefined) updates.hide_phone_home = Boolean(hide_phone_home);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("family_units")
    .update(updates)
    .eq("id", ctx.profile.family_id)
    .select()
    .single();

  if (error) {
    console.error("household PATCH error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
