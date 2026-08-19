import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { Resend } from "resend";

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
const DOMAIN_SHAPE =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const ROW_COLUMNS =
  "id, domain, status, dns_records, verified_at, last_checked_at, created_at";

async function requireOrgAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    } as const;
  }

  // The caller's own profile row, read on the request-scoped client: RLS
  // narrows it to the caller's own org, so profile.org_id is the org anchor
  // for every service-role query below.
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    } as const;
  }
  return { supabase, orgId: profile.org_id } as const;
}

export async function POST(request: Request) {
  const gate = await requireOrgAdmin();
  if ("error" in gate) return gate.error;
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

  const { data: rd, error: resendError } = await getResend().domains.create({
    name: domain,
  });

  if (resendError || !rd) {
    console.error(
      "email-domain create: Resend domains.create error (org=%s, domain=%s):",
      orgId,
      domain,
      resendError,
    );
    // Roll back the claim so a retry isn't blocked by the unique index.
    const { error: rollbackError } = await service
      .from("org_email_domains")
      .delete()
      .eq("id", inserted.id)
      .eq("org_id", orgId);
    if (rollbackError) {
      console.error(
        "email-domain create: rollback delete failed (org=%s, id=%s):",
        orgId,
        inserted.id,
        rollbackError,
      );
    }
    return NextResponse.json(
      { error: "Failed to create domain with email provider." },
      { status: 502 },
    );
  }

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
      "email-domain create: scoped update failed (org=%s, id=%s):",
      orgId,
      inserted.id,
      updateError,
    );
    return NextResponse.json(
      { error: "Domain created but failed to save. Contact support." },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: saved });
}

export async function DELETE() {
  // RLS-only mutation on the request-scoped client — mirrors
  // app/api/admin/family-members/[id]/route.ts's DELETE handler. The
  // "Admins manage org email domains" policy plus the DELETE grant is the
  // whole boundary; there is no Resend-side cleanup in v1.
  const gate = await requireOrgAdmin();
  if ("error" in gate) return gate.error;
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
