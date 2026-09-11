import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { classifyHost, normalizeHost } from "@/lib/org";
import { siteConfig } from "@/lib/config";
import { DOMAIN_ROW_COLUMNS, DOMAIN_SHAPE } from "@/lib/domains";
import { redactFailure } from "@/lib/members/apply";

/**
 * POST /api/admin/domains — claim a custom domain for the caller's org.
 *
 * The one surface in the custom-domain feature that needs no service role:
 * the insert runs on the cookie-bound request client under the admin
 * policy, naming only `domain`. org_id comes from the fail-closed column
 * DEFAULT, status starts at 'pending', and the verification_token is
 * server-generated — the INSERT grant covers `domain` alone, so an admin
 * cannot self-verify at claim time. Verification (DNS TXT check) and
 * removal live in ./[id]/verify and ./[id].
 */

export async function POST(request: Request) {
  const gate = await requireOrgAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status },
    );
  }
  const { supabase, orgId } = gate;

  const body = await request.json().catch(() => ({}));
  const domain =
    typeof body?.domain === "string" ? normalizeHost(body.domain) : "";
  if (!DOMAIN_SHAPE.test(domain)) {
    return NextResponse.json(
      { error: "Enter a valid domain, e.g. example.church or www.example.church" },
      { status: 400 },
    );
  }

  // UX-only refusal of the platform apex and its subdomains; the worker's
  // own denylist (supabase/functions/_shared/domain-denylist.ts) is the real
  // boundary, since it is the one holding the Vercel token.
  if (classifyHost(domain, siteConfig.platformApex).kind !== "custom-domain-candidate") {
    return NextResponse.json(
      { error: "That domain is part of the platform and cannot be claimed." },
      { status: 400 },
    );
  }

  const { data: inserted, error } = await supabase
    .from("org_domains")
    .insert({ domain })
    .select(DOMAIN_ROW_COLUMNS)
    .single();

  if (error || !inserted) {
    // The partial per-org unique (status <> 'removing'): a repeat claim.
    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "You've already claimed this domain." },
        { status: 409 },
      );
    }
    console.error("domain claim: insert error (org=%s): %s", orgId, redactFailure(error));
    return NextResponse.json(
      { error: "Failed to claim domain." },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: inserted });
}
