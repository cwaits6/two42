import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { ATTACH_LEASE_WINDOW_MS } from "@/lib/domains";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/platform/domains/[id]/retry — release an EXPIRED attachment
 * lease on a verified, unattached domain so the worker's next run re-claims
 * it cleanly.
 *
 * This route never writes attached_at: the worker is that column's sole
 * writer, and only from a Vercel-confirmed state. It also never clears a
 * live lease (that would race the worker) or an empty one (nothing to
 * clear) — the `.lt("attach_claimed_at", cutoff)` predicate is the whole
 * point, and zero rows is the normal "nothing to retry" answer, not an
 * error. Follows the /platform write pattern: gate, resolve the target row,
 * then a service-role write carrying that row's org id.
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

    // org-anchor: the platform admin names the row by id and holds no org
    // of their own; this read resolves the row's org_id, which scopes the
    // write below. requirePlatformAdmin() above is the authority boundary.
    // See docs/security/service-role-inventory.md.
    const { data: row, error: rowError } = await service
      .from("org_domains")
      .select("id, org_id")
      .eq("id", id)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }

    const cutoff = new Date(Date.now() - ATTACH_LEASE_WINDOW_MS).toISOString();
    const { data: cleared, error } = await service
      .from("org_domains")
      .update({ attach_claimed_at: null, attach_claim_token: null })
      .eq("id", row.id)
      .eq("org_id", row.org_id)
      .eq("status", "verified")
      .is("attached_at", null)
      .lt("attach_claimed_at", cutoff)
      .select("id");
    if (error) throw error;

    // Row count is the answer, not the absence of an error.
    const released = (cleared ?? []).length === 1;
    return NextResponse.json({
      success: true,
      released,
      message: released
        ? "Expired claim cleared. The worker will retry on its next run."
        : "Nothing to retry: no expired claim on this domain.",
    });
  } catch (error) {
    console.error("Domain retry error for row %s:", id, error);
    return NextResponse.json(
      { error: "Failed to clear the attachment claim" },
      { status: 500 },
    );
  }
}
