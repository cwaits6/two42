import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { MAX_DAILY_EMAIL_CAP } from "@/lib/email/quota";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Platform-admin override of an org's daily email cap (Phase 5 PR 8,
 * CWA-72). org_email_limits is platform-operator-owned, not org-admin-owned
 * — an org that can raise its own cap does not have a cap — so writes come
 * only through this gate, following the /platform write pattern
 * (app/api/platform/organizations/[id]/route.ts): gate, validate the target
 * org exists, then a service-role write carrying that validated org id.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status }
    );
  }

  const { id } = await params;

  let body: { daily_cap?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Mirrors the org_email_limits_cap_sane CHECK so a bad value gets a clear
  // 400 instead of a constraint violation. 0 is valid — a fully throttled org.
  const dailyCap = body.daily_cap;
  if (
    typeof dailyCap !== "number" ||
    !Number.isInteger(dailyCap) ||
    dailyCap < 0 ||
    dailyCap > MAX_DAILY_EMAIL_CAP
  ) {
    return NextResponse.json(
      { error: `Daily cap must be a whole number between 0 and ${MAX_DAILY_EMAIL_CAP}.` },
      { status: 400 }
    );
  }

  try {
    // org_email_limits has no permissive policy (service-role-only posture),
    // so this write must run on the service client; the org id is validated
    // against an existing organizations row first and every write carries it
    // explicitly. See docs/security/service-role-inventory.md.
    const service = await createServiceClient();

    const { data: org, error: orgError } = await service
      .from("organizations")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (orgError) throw orgError;
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Upsert: the override row may not exist yet (the 500/day default is a
    // function default, not a seeded row — decision D7).
    const { data: updated, error } = await service
      .from("org_email_limits")
      .upsert(
        { org_id: id, daily_cap: dailyCap, updated_at: new Date().toISOString() },
        { onConflict: "org_id" }
      )
      .select("org_id");
    if (error) throw error;
    // Zero-row writes report success silently — assert the row came back.
    if (!updated || updated.length === 0) {
      throw new Error("email cap upsert affected zero rows");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Email cap update error for org %s:", id, error);
    return NextResponse.json(
      { error: "Failed to update the email cap" },
      { status: 500 }
    );
  }
}
