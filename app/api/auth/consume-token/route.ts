import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { logError } from "@/lib/log";

export async function POST(request: Request) {
  const { token } = await request.json();

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  // org-anchor: signup_token resolves the org; org_id is unknown until this
  // row returns it (docs/security/service-role-inventory.md).
  // This lookup genuinely cannot be org-scoped: org_id isn't known until this
  // row resolves it. signup_token is currently globally UNIQUE, so
  // .maybeSingle() is safe today; if that constraint ever became per-org,
  // this lookup would need to change, since it would then match multiple
  // rows and .maybeSingle() would error. The write below is scoped to
  // (id, org_id) once the row is known — that scoping is what stays correct
  // if the constraint changes.
  const { data: row, error: lookupError } = await supabase
    .from("access_requests")
    .select("id, org_id")
    .eq("signup_token", token)
    .maybeSingle();

  if (lookupError) {
    logError("Failed to look up signup token", lookupError, { route: "/api/auth/consume-token" });
    return NextResponse.json({ error: "Failed to invalidate token" }, { status: 500 });
  }

  // Zero rows means the token was already consumed — stay idempotent.
  if (!row) {
    return NextResponse.json({ success: true });
  }

  const { error } = await supabase
    .from("access_requests")
    .update({ signup_token: null })
    .eq("id", row.id)
    .eq("org_id", row.org_id);

  if (error) {
    logError("Failed to consume signup token", error, { route: "/api/auth/consume-token" });
    return NextResponse.json({ error: "Failed to invalidate token" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
