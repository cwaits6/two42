import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { requireOrgAdmin } from "@/lib/members/access";

/**
 * /api/admin/email-domain — the org's single sending domain (Phase 5 PR 6,
 * CWA-70 / #363).
 *
 *   POST   claim a domain: insert the row, create it in Resend, persist
 *          Resend's id / status / DNS records. Service-role for the write of
 *          the server-set-only columns (the admin's own client has no UPDATE
 *          grant on them); org anchored on the caller's own RLS-scoped
 *          profile — never a header, never a body field.
 *   DELETE remove the claim: a plain RLS- and grant-bounded delete on the
 *          request-scoped client. No service role, no Resend call in v1.
 *
 * No outbound mail uses this table yet — that is PR 7
 * (docs/plans/phase-5-domains-email.md §12 step 7).
 */

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

// Route-local input floor, stricter than the DB's own
// org_email_domains_domain_shape CHECK (lowercase + length only) so
// obviously-malformed input never reaches Resend. NOT the future
// SENDING_DOMAIN constant in lib/email/identity.ts (PR 7) — that one
// additionally gates the send path; this one only gates what an admin may
// claim.
export const DOMAIN_SHAPE =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Excludes resend_domain_id (Resend's internal handle, not client-facing)
// and org_id (already known to the caller).
const ROW_COLUMNS =
  "id, domain, status, dns_records, verified_at, last_checked_at, created_at";

function gateError(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 401 ? "Unauthorized" : "Forbidden" },
    { status },
  );
}

// Deletes the just-inserted row so the unique-per-org index doesn't block a
// retry. Shared by every failure branch below (Resend create failure,
// failed follow-up update, and the catch-all) — each supplies its own
// `context` so the log line still says which branch rolled back.
async function rollbackInsert(
  service: Awaited<ReturnType<typeof createServiceClient>>,
  orgId: string,
  id: string,
  context: string,
) {
  const { error } = await service
    .from("org_email_domains")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) {
    console.error(
      "email-domain create: rollback delete failed (%s) (org=%s, id=%s):",
      context,
      orgId,
      id,
      error,
    );
  }
}

// Removes a Resend domain created earlier in the same request so it isn't
// left orphaned when the DB write that was supposed to record it fails.
// Resend's remove() can itself throw on a network-level failure, same as
// domains.create() — caught here so callers don't need their own try/catch.
async function cleanupResendDomain(
  orgId: string,
  resendDomainId: string,
  context: string,
) {
  try {
    const { error } = await getResend().domains.remove(resendDomainId);
    if (error) {
      console.error(
        "email-domain create: Resend cleanup failed (%s) (org=%s, resend_domain_id=%s):",
        context,
        orgId,
        resendDomainId,
        error,
      );
    }
  } catch (cleanupErr) {
    console.error(
      "email-domain create: Resend cleanup threw (%s) (org=%s, resend_domain_id=%s):",
      context,
      orgId,
      resendDomainId,
      cleanupErr,
    );
  }
}

export async function POST(request: Request) {
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const { orgId } = gate;

  const body = await request.json().catch(() => ({}));
  const domain =
    typeof body?.domain === "string" ? body.domain.trim().toLowerCase() : "";
  if (!DOMAIN_SHAPE.test(domain)) {
    return NextResponse.json(
      { error: "Enter a valid domain, e.g. mail.example.church" },
      { status: 400 },
    );
  }

  const service = await createServiceClient();
  let insertedId: string | null = null;
  let resendDomainId: string | null = null;

  try {
    // Insert first: the unique-per-org index turns a duplicate claim into a
    // clean 409 before any Resend resource is created.
    const { data: inserted, error: insertError } = await service
      .from("org_email_domains")
      .insert({ org_id: orgId, domain })
      .select("id")
      .single();

    if (insertError || !inserted) {
      if (insertError?.code === "23505") {
        return NextResponse.json(
          {
            error:
              "This organization already has a sending domain claimed. Remove it first.",
          },
          { status: 409 },
        );
      }
      console.error(
        "email-domain create: insert error (org=%s):",
        orgId,
        insertError,
      );
      return NextResponse.json(
        { error: "Failed to claim domain." },
        { status: 500 },
      );
    }
    insertedId = inserted.id;

    const { data: rd, error: resendError } = await getResend().domains.create(
      { name: domain },
    );

    if (resendError || !rd) {
      console.error(
        "email-domain create: Resend domains.create error (org=%s, domain=%s):",
        orgId,
        domain,
        resendError,
      );
      // Roll back the claim so a retry isn't blocked by the unique index.
      await rollbackInsert(service, orgId, inserted.id, "create failure");
      return NextResponse.json(
        { error: "Failed to create domain with email provider." },
        { status: 502 },
      );
    }

    resendDomainId = rd.id;

    const { data: saved, error: updateError } = await service
      .from("org_email_domains")
      .update({
        resend_domain_id: rd.id,
        status: rd.status ?? "pending",
        dns_records: rd.records ?? [],
      })
      .eq("id", inserted.id)
      .eq("org_id", orgId)
      .select(ROW_COLUMNS)
      .single();

    if (updateError || !saved) {
      console.error(
        "email-domain create: scoped update failed (org=%s, id=%s, resend_domain_id=%s):",
        orgId,
        inserted.id,
        rd.id,
        updateError,
      );
      // Mirror the rollback above: the Resend domain now exists but the DB
      // write that records it didn't, so clean up both sides rather than
      // leave an orphaned Resend domain with no logged trail to find it.
      await cleanupResendDomain(orgId, rd.id, "after failed update");
      await rollbackInsert(service, orgId, inserted.id, "after failed update");
      return NextResponse.json(
        { error: "Failed to save domain. Please try again." },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: saved });
  } catch (err) {
    // The Resend SDK's { data, error } return only covers application-level
    // errors — a network-level failure (DNS, TLS, timeout) throws instead,
    // same as fetch() itself. Catch it here so it's logged with the same
    // context as every other branch, and so an insert left in place by a
    // thrown domains.create() doesn't permanently block future claims via
    // the unique-per-org index.
    console.error(
      "email-domain create: unexpected error (org=%s):",
      orgId,
      err,
    );
    if (resendDomainId) {
      // The Resend domain exists but the DB row recording it may not
      // survive the rollback below — remove it so the provider side isn't
      // left orphaned.
      await cleanupResendDomain(orgId, resendDomainId, "after unexpected error");
    }
    if (insertedId) {
      await rollbackInsert(service, orgId, insertedId, "after unexpected error");
    }
    return NextResponse.json(
      { error: "Failed to claim domain." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  // RLS-only mutation on the request-scoped client — mirrors
  // app/api/admin/family-members/[id]/route.ts's DELETE handler. The
  // "Admins manage org email domains" policy plus the DELETE grant is the
  // whole boundary; there is no Resend-side cleanup in v1.
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const { supabase, orgId } = gate;

  const { error, count } = await supabase
    .from("org_email_domains")
    .delete({ count: "exact" })
    .eq("org_id", orgId);

  if (error) {
    console.error("email-domain remove: delete error (org=%s):", orgId, error);
    return NextResponse.json(
      { error: "Failed to remove domain." },
      { status: 500 },
    );
  }
  if (!count) {
    return NextResponse.json({ error: "No domain to remove." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
