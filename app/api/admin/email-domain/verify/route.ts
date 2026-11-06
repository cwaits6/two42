import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { requireOrgAdmin } from "@/lib/members/access";
import { CUSTOM_SENDING_DOMAINS_ENABLED } from "@/lib/email/sendingDomains";
import { logError } from "@/lib/log";

/**
 * POST /api/admin/email-domain/verify — ask Resend to re-check the org's
 * claimed sending domain and persist the fresh status.
 *
 * Service-role because status / dns_records / verified_at / last_checked_at
 * are server-set-only columns the admin's own client cannot UPDATE. Org
 * anchored on the caller's own RLS-scoped profile; the target row is
 * fetched `.eq("org_id", orgId)` before any write, and the write is scoped
 * on `(id, org_id)`.
 *
 * Verify is a manual button only — no cron, no page-load re-check
 * (deferred, not in v1).
 */

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

// Excludes resend_domain_id (Resend's internal handle, not client-facing)
// and org_id (already known to the caller).
const ROW_COLUMNS =
  "id, domain, status, dns_records, verified_at, last_checked_at, created_at";

export async function POST() {
  // Hidden surface: 404 before auth or any data work, like the sibling route.
  if (!CUSTOM_SENDING_DOMAINS_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const gate = await requireOrgAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status },
    );
  }
  const { orgId } = gate;

  const service = await createServiceClient();

  try {
    const { data: row, error: rowError } = await service
      .from("org_email_domains")
      .select("id, resend_domain_id")
      .eq("org_id", orgId)
      .maybeSingle();

    if (rowError) {
      logError(
        "email-domain verify: lookup error",
        rowError,
        { route: "/api/admin/email-domain/verify", ids: { org: orgId } },
      );
      return NextResponse.json(
        { error: "Failed to verify domain." },
        { status: 500 },
      );
    }
    if (!row || !row.resend_domain_id) {
      return NextResponse.json(
        { error: "No claimed domain to verify." },
        { status: 404 },
      );
    }

    const resend = getResend();
    const { error: verifyError } = await resend.domains.verify(
      row.resend_domain_id,
    );
    if (verifyError) {
      logError(
        "email-domain verify: Resend domains.verify error",
        verifyError,
        { route: "/api/admin/email-domain/verify", ids: { org: orgId } },
      );
      return NextResponse.json(
        { error: "Failed to verify domain with email provider." },
        { status: 502 },
      );
    }

    const { data: fresh, error: getError } = await resend.domains.get(
      row.resend_domain_id,
    );
    if (getError || !fresh) {
      logError(
        "email-domain verify: Resend domains.get error",
        getError,
        { route: "/api/admin/email-domain/verify", ids: { org: orgId } },
      );
      return NextResponse.json(
        { error: "Failed to read verification status." },
        { status: 502 },
      );
    }

    const now = new Date().toISOString();
    const { data: saved, error: updateError } = await service
      .from("org_email_domains")
      .update({
        status: fresh.status,
        dns_records: fresh.records ?? [],
        // Explicitly null on any non-verified status: a domain that regresses
        // from verified must not keep a stale verified_at.
        verified_at: fresh.status === "verified" ? now : null,
        last_checked_at: now,
      })
      .eq("id", row.id)
      .eq("org_id", orgId)
      .select(ROW_COLUMNS)
      .single();

    if (updateError || !saved) {
      logError(
        "email-domain verify: scoped update failed",
        updateError,
        { route: "/api/admin/email-domain/verify", ids: { org: orgId, id: row.id } },
      );
      return NextResponse.json(
        { error: "Verified but failed to save status." },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: saved });
  } catch (err) {
    // See app/api/admin/email-domain/route.ts's POST handler: the Resend
    // SDK throws on network-level failures instead of returning { error }.
    logError(
      "email-domain verify: unexpected error",
      err,
      { route: "/api/admin/email-domain/verify", ids: { org: orgId } },
    );
    return NextResponse.json(
      { error: "Failed to verify domain." },
      { status: 500 },
    );
  }
}
