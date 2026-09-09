import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { requireOrgAdmin } from "@/lib/members/access";
import { getOrgEmailDomainCap } from "@/lib/email/domainCap";
import { removeResendDomain } from "@/lib/email/resendDomains";

/**
 * /api/admin/email-domain — the org's single sending domain.
 *
 *   GET    read the claim state: whether custom domains are enabled for this
 *          org (a platform-operator flag the admin's own client has no SELECT
 *          grant on, so it is read server-side) plus the org's row, if any.
 *   POST   claim a domain. Gated first on organizations.custom_email_domain_
 *          enabled and on a platform-wide cap on claimed domains (Resend's
 *          account tier caps total domains regardless of tenant), then:
 *          insert the row, create it in Resend, persist Resend's id / status
 *          / DNS records. Service-role for the write of the server-set-only
 *          columns (the admin's own client has no UPDATE grant on them); org
 *          anchored on the caller's own RLS-scoped profile — never a header,
 *          never a body field.
 *   DELETE remove the claim. Removes the Resend domain first and deletes the
 *          row only once that succeeds; when the provider-side removal fails
 *          the row is kept as status = 'cleanup_pending' (resend_domain_id
 *          intact) so that Remove doubles as the retry, and a platform
 *          operator can finish it from /platform.
 *
 * Failure handling on the claim path follows the same rule: a Resend domain
 * that was created but whose claim ultimately failed is removed again, and
 * the DB row is deleted only if that removal succeeded. A row left as
 * cleanup_pending is the durable record of the orphaned Resend domain —
 * deleting it would strand resend_domain_id nowhere but the logs.
 */

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

// Route-local input floor, stricter than the DB's own
// org_email_domains_domain_shape CHECK (lowercase + length only) so
// obviously-malformed input never reaches Resend. NOT the SENDING_DOMAIN
// constant in lib/email/identity.ts — that one additionally gates the send
// path; this one only gates what an admin may claim.
export const DOMAIN_SHAPE =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Excludes resend_domain_id (Resend's internal handle, not client-facing)
// and org_id (already known to the caller).
const ROW_COLUMNS =
  "id, domain, status, dns_records, verified_at, last_checked_at, cleanup_failed_at, created_at";

const CLEANUP_PENDING = "cleanup_pending";

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
  service: ServiceClient,
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

// Keeps a row whose Resend cleanup failed, marked so the stuck state is
// visible and retryable. resend_domain_id is written explicitly on the claim
// path because the row may never have recorded it (the write that was
// supposed to is exactly what failed). Never throws: every caller is already
// on a failure path and must still return its own error response.
async function markCleanupPending(
  service: ServiceClient,
  orgId: string,
  id: string,
  resendDomainId: string,
  context: string,
) {
  try {
    const { error } = await service
      .from("org_email_domains")
      .update({
        resend_domain_id: resendDomainId,
        status: CLEANUP_PENDING,
        cleanup_failed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("org_id", orgId);
    if (error) {
      console.error(
        "email-domain %s: failed to persist cleanup_pending (org=%s, id=%s, resend_domain_id=%s):",
        context,
        orgId,
        id,
        resendDomainId,
        error,
      );
    }
  } catch (err) {
    console.error(
      "email-domain %s: persisting cleanup_pending threw (org=%s, id=%s, resend_domain_id=%s):",
      context,
      orgId,
      id,
      resendDomainId,
      err,
    );
  }
}

// When the Resend domain was created but this claim ultimately failed: clean
// up Resend first, and delete the DB row only if that cleanup actually
// succeeded. A cleanup that itself fails must not delete the row — that
// would leave the orphaned Resend domain with no record but the logs, and
// the next claim would hit Resend's duplicate rejection as an opaque 502.
// Marking cleanup_pending keeps it reconcilable via DELETE (Remove) or the
// platform retry endpoint.
async function finalizeFailedClaim(
  service: ServiceClient,
  orgId: string,
  insertedId: string,
  resendDomainId: string | null,
  context: string,
) {
  if (!resendDomainId) {
    await rollbackInsert(service, orgId, insertedId, context);
    return;
  }
  const cleanedUp = await removeResendDomain(resendDomainId, {
    orgId,
    context: `create ${context}`,
  });
  if (cleanedUp) {
    await rollbackInsert(service, orgId, insertedId, context);
    return;
  }
  await markCleanupPending(
    service,
    orgId,
    insertedId,
    resendDomainId,
    `create ${context}`,
  );
}

// The 409 for an org that already holds a row: a cleanup still in progress
// gets its own message, since "remove it first" is exactly what the admin
// may already have tried.
function conflictResponse(status: string | undefined) {
  if (status === CLEANUP_PENDING) {
    return NextResponse.json(
      {
        error:
          "A previous domain removal is still completing. Try Remove again shortly, or contact support if it keeps failing.",
      },
      { status: 409 },
    );
  }
  return NextResponse.json(
    {
      error:
        "This organization already has a sending domain claimed. Remove it first.",
    },
    { status: 409 },
  );
}

export async function GET() {
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const { supabase, orgId } = gate;

  const service = await createServiceClient();

  // organizations is the tenant root: .eq("id", orgId) IS the tenant
  // boundary. orgId is requireOrgAdmin()'s validated anchor.
  const { data: org, error: orgError } = await service
    .from("organizations")
    .select("custom_email_domain_enabled")
    .eq("id", orgId)
    .maybeSingle();
  if (orgError || !org) {
    console.error(
      "email-domain read: org flag lookup failed (org=%s):",
      orgId,
      orgError,
    );
    return NextResponse.json(
      { error: "Failed to load sending domain." },
      { status: 500 },
    );
  }

  // RLS-scoped: the admin's own row only, on the request client.
  const { data: row, error: rowError } = await supabase
    .from("org_email_domains")
    .select(ROW_COLUMNS)
    .maybeSingle();
  if (rowError) {
    console.error(
      "email-domain read: row lookup failed (org=%s):",
      orgId,
      rowError,
    );
    return NextResponse.json(
      { error: "Failed to load sending domain." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    enabled: org.custom_email_domain_enabled,
    data: row ?? null,
  });
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

  // organizations is the tenant root: .eq("id", orgId) IS the tenant
  // boundary. orgId is requireOrgAdmin()'s validated anchor. Fail closed: a
  // missing org or a failed read refuses the claim rather than assuming the
  // flag is on.
  const { data: org, error: orgFlagError } = await service
    .from("organizations")
    .select("custom_email_domain_enabled")
    .eq("id", orgId)
    .maybeSingle();
  if (orgFlagError || !org) {
    console.error(
      "email-domain create: org flag lookup failed (org=%s):",
      orgId,
      orgFlagError,
    );
    return NextResponse.json(
      { error: "Failed to claim domain." },
      { status: 500 },
    );
  }
  if (!org.custom_email_domain_enabled) {
    return NextResponse.json(
      {
        error:
          "Custom sending domains aren't enabled for your organization. Contact support to request access.",
      },
      { status: 403 },
    );
  }

  // An org that already holds a row gets the specific 409 up front — before
  // the platform-wide cap check, so an admin whose own cleanup is stuck is
  // told that, not that the platform is full. The unique-per-org index
  // still catches the race below.
  const { data: existing, error: existingError } = await service
    .from("org_email_domains")
    .select("status")
    .eq("org_id", orgId)
    .maybeSingle();
  if (existingError) {
    console.error(
      "email-domain create: existing row lookup failed (org=%s):",
      orgId,
      existingError,
    );
    return NextResponse.json(
      { error: "Failed to claim domain." },
      { status: 500 },
    );
  }
  if (existing) {
    return conflictResponse(existing.status);
  }

  // org-anchor: a platform-wide backstop across every org's claimed domains,
  // not a per-org read. Resend's account tier limits total domains regardless
  // of tenant, so this must reject before ever calling domains.create; the
  // count is the only thing read, never a row. Rows still awaiting cleanup
  // count too — their Resend domain still occupies a slot. See
  // lib/email/domainCap.ts and docs/security/service-role-inventory.md.
  const { count: totalClaimed, error: capError } = await service
    .from("org_email_domains")
    .select("id", { count: "exact", head: true });
  if (capError) {
    console.error(
      "email-domain create: domain cap check failed (org=%s):",
      orgId,
      capError,
    );
    return NextResponse.json(
      { error: "Failed to claim domain." },
      { status: 500 },
    );
  }
  if ((totalClaimed ?? 0) >= getOrgEmailDomainCap()) {
    return NextResponse.json(
      {
        error:
          "The platform has reached its limit on custom sending domains. Contact support.",
      },
      { status: 403 },
    );
  }

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
        // Lost the race with a concurrent claim (or a cleanup that landed
        // between the check above and this insert): report which.
        const { data: raced } = await service
          .from("org_email_domains")
          .select("status")
          .eq("org_id", orgId)
          .maybeSingle();
        return conflictResponse(raced?.status);
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
      // Nothing exists on Resend's side yet: roll back the claim so a retry
      // isn't blocked by the unique index.
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
      // The Resend domain now exists but the DB write that records it
      // didn't: clean up both sides, keeping the row if Resend's side won't
      // go.
      await finalizeFailedClaim(
        service,
        orgId,
        inserted.id,
        rd.id,
        "after failed update",
      );
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
    if (insertedId) {
      await finalizeFailedClaim(
        service,
        orgId,
        insertedId,
        resendDomainId,
        "after unexpected error",
      );
    }
    return NextResponse.json(
      { error: "Failed to claim domain." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const { orgId } = gate;

  // Service-role: completing the Resend-side removal here needs to write
  // status / cleanup_failed_at when it fails, and those are server-set-only
  // columns the admin's own client has no UPDATE grant on — the same
  // reasoning as POST and verify. The target row is fetched .eq("org_id",
  // orgId) before any write, and every write is scoped on (id, org_id).
  const service = await createServiceClient();

  const { data: row, error: rowError } = await service
    .from("org_email_domains")
    .select("id, resend_domain_id")
    .eq("org_id", orgId)
    .maybeSingle();
  if (rowError) {
    console.error("email-domain remove: lookup error (org=%s):", orgId, rowError);
    return NextResponse.json(
      { error: "Failed to remove domain." },
      { status: 500 },
    );
  }
  if (!row) {
    return NextResponse.json({ error: "No domain to remove." }, { status: 404 });
  }

  // A row with no resend_domain_id never made it to Resend (or was inserted
  // by hand) — nothing to remove on the provider side.
  if (row.resend_domain_id) {
    const cleanedUp = await removeResendDomain(row.resend_domain_id, {
      orgId,
      context: "remove",
    });
    if (!cleanedUp) {
      await markCleanupPending(
        service,
        orgId,
        row.id,
        row.resend_domain_id,
        "remove",
      );
      return NextResponse.json(
        {
          error:
            "The email provider couldn't release this domain yet, so it is still reserved. Try Remove again in a few minutes, or contact support if it keeps failing.",
        },
        { status: 502 },
      );
    }
  }

  const { error, count } = await service
    .from("org_email_domains")
    .delete({ count: "exact" })
    .eq("id", row.id)
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
