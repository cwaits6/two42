import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { redactFailure } from "@/lib/members/apply";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/platform/domain-events/[id]/acknowledge — stamp acknowledged_at
 * on one worker event, taking it off the /platform/domains list.
 *
 * For an attach_permanent_failure event this is also what lets the worker
 * try the domain again: its skip check reads `acknowledged_at IS NULL` on
 * the same (org_id, domain), so acknowledging is the operator saying "the
 * cause is fixed, retry". For a detached event it records that the
 * redirect-allowlist entry has been removed. The `.is("acknowledged_at",
 * null)` predicate makes a second click a zero-row no-op, not a re-stamp.
 * Follows the /platform write pattern: gate, resolve the target row, then a
 * service-role write carrying that row's org id.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status },
    );
  }

  const { id } = await params;

  try {
    const service = await createServiceClient();

    // org-anchor: the platform admin names the event by id and holds no org
    // of their own; this read resolves the row's org_id, which scopes the
    // write below. requirePlatformAdmin() above is the authority boundary.
    // See docs/security/service-role-inventory.md.
    const { data: row, error: rowError } = await service
      .from("org_domain_worker_events")
      .select("id, org_id")
      .eq("id", id)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const { data: stamped, error } = await service
      .from("org_domain_worker_events")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("org_id", row.org_id)
      .is("acknowledged_at", null)
      .select("id");
    if (error) throw error;

    // Row count is the answer, not the absence of an error.
    const acknowledged = (stamped ?? []).length === 1;
    return NextResponse.json({
      success: true,
      acknowledged,
      message: acknowledged ? "Event acknowledged." : "Already acknowledged.",
    });
  } catch (error) {
    console.error("Domain event acknowledge error for row %s: %s", id, redactFailure(error));
    return NextResponse.json({ error: "Failed to acknowledge the event" }, { status: 500 });
  }
}
