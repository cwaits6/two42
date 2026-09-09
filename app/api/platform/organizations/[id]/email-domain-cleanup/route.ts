import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { removeResendDomain } from "@/lib/email/resendDomains";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Platform-admin retry for a stuck email-domain cleanup. When the org
 * admin's claim or remove route could not remove the domain from Resend, the
 * org_email_domains row is kept as status = 'cleanup_pending' with
 * resend_domain_id intact (app/api/admin/email-domain/route.ts). This lets a
 * platform operator finish that removal from /platform without waiting on
 * the org's own admin to click Remove again — the stuck domain still
 * occupies one of the platform's Resend domain slots until it is gone.
 *
 * Follows the /platform write pattern (email-cap/route.ts): gate, validate
 * the target org exists, then service-role reads and writes that all carry
 * the validated org id.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status }
    );
  }

  const { id } = await params;

  try {
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

    const { data: row, error: rowError } = await service
      .from("org_email_domains")
      .select("id, resend_domain_id, status")
      .eq("org_id", org.id)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row || row.status !== "cleanup_pending" || !row.resend_domain_id) {
      return NextResponse.json(
        { error: "No domain cleanup is pending for this organization" },
        { status: 404 }
      );
    }

    const cleanedUp = await removeResendDomain(row.resend_domain_id, {
      orgId: org.id,
      context: "platform cleanup retry",
    });
    if (!cleanedUp) {
      // Keep the row; bump the failure time so the card shows this attempt.
      const { error: markError, count: markCount } = await service
        .from("org_email_domains")
        .update(
          { cleanup_failed_at: new Date().toISOString() },
          { count: "exact" }
        )
        .eq("id", row.id)
        .eq("org_id", org.id);
      if (markError) {
        console.error(
          "Email domain cleanup retry: failed to record the attempt (org=%s, id=%s):",
          org.id,
          row.id,
          markError
        );
      } else if (!markCount) {
        // Zero-row writes report success silently — the row disappeared
        // (e.g. the org admin's own DELETE finished it) between the select
        // above and this update. Not an error, just worth a log line.
        console.error(
          "Email domain cleanup retry: attempt-timestamp write matched no row — likely raced with a concurrent cleanup (org=%s, id=%s):",
          org.id,
          row.id
        );
      }
      return NextResponse.json(
        { error: "The email provider cleanup failed again. Try later." },
        { status: 502 }
      );
    }

    const { error: deleteError, count } = await service
      .from("org_email_domains")
      .delete({ count: "exact" })
      .eq("id", row.id)
      .eq("org_id", org.id);
    if (deleteError) throw deleteError;
    // Zero-row writes report success silently — assert the row went away.
    if (!count) {
      return NextResponse.json(
        { error: "No domain cleanup is pending for this organization" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Email domain cleanup retry error for org %s:", id, error);
    return NextResponse.json(
      { error: "Failed to retry the domain cleanup" },
      { status: 500 }
    );
  }
}
