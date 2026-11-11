import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { logError } from "@/lib/log";
import { INVALID_LINK, deadLinkResponse, readSetupToken } from "../setup-link";
import type { VerifyTokenResponse } from "../setup-response";

const logAccountLookup = (error: unknown) =>
  logError("Setup link: account lookup failed", error, { route: "/api/auth/verify-token" });

export async function POST(request: Request) {
  const token = readSetupToken(await request.json().catch(() => null));
  if (!token) {
    return NextResponse.json(INVALID_LINK, { status: 404 });
  }

  const supabase = await createServiceClient();

  // org-anchor: signup_token resolves the org; org_id is unknown until this
  // row returns it (docs/security/service-role-inventory.md).
  // The service client bypasses RLS, so the token row is the org anchor for
  // this pre-login flow. handle_new_user() does not simply re-read this row:
  // it matches lower(email) across access_requests ∪ family_invites and
  // raises TN002 if that union spans more than one org (see
  // supabase/schema.sql) — a stronger, and more surprising, guarantee than
  // "reads the same row".
  const { data, error } = await supabase
    .from("access_requests")
    .select("name, email, status, token_expires_at, org_id")
    .eq("signup_token", token)
    .eq("status", "approved")
    .maybeSingle();

  if (error) {
    logError("Signup token lookup failed", error, { route: "/api/auth/verify-token" });
    return NextResponse.json(INVALID_LINK, { status: 404 });
  }

  // org_id is NOT NULL in the schema, so a falsy value is an invariant
  // violation, not expected control flow — fail closed as an invalid token.
  if (!data || !data.org_id) {
    return deadLinkResponse(supabase.auth.admin, token, false, logAccountLookup);
  }

  if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) {
    return deadLinkResponse(supabase.auth.admin, token, true, logAccountLookup);
  }

  return NextResponse.json<VerifyTokenResponse>({ name: data.name, email: data.email });
}
