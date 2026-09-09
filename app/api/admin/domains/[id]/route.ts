import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/members/access";

/**
 * DELETE /api/admin/domains/[id] — release a claimed domain.
 *
 * Deletion is a workflow, not a row delete, because attachment creates
 * state outside the database (the Vercel project domain). Two branches:
 *
 *   attached_at IS NULL → nothing external to clean up: a plain RLS- and
 *     grant-bounded delete on the request-scoped client. The restrictive
 *     delete policy confines the admin's DELETE grant to exactly these rows.
 *   attached_at set → service-role: flip status to 'removing' — the ONLY
 *     transition that keeps attached_at (it is the "Vercel cleanup still
 *     owed" marker) — and clear the attachment lease so a pending attach
 *     cannot re-stamp it. The attachment worker detaches the name from
 *     Vercel and hard-deletes the tombstone; until then the row is
 *     excluded from the resolver and from the admin's DELETE grant.
 *
 * Org anchored on the caller's own RLS-scoped profile: the target row is
 * fetched `.eq("id", id).eq("org_id", orgId)` before any write, and every
 * write is scoped on `(id, org_id)`.
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const gate = await requireOrgAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status },
    );
  }
  const { supabase, orgId } = gate;
  const { id } = await params;

  const service = await createServiceClient();

  try {
    const { data: row, error: rowError } = await service
      .from("org_domains")
      .select("id, status, attached_at")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (rowError) {
      console.error("domain remove: lookup error (org=%s, id=%s):", orgId, id, rowError);
      return NextResponse.json({ error: "Failed to remove domain." }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "Domain not found." }, { status: 404 });
    }

    // Already a tombstone: the worker owns it from here. Idempotent.
    if (row.status === "removing") {
      return NextResponse.json({ success: true, status: "removing" });
    }

    if (row.attached_at === null) {
      const { error, count } = await supabase
        .from("org_domains")
        .delete({ count: "exact" })
        .eq("id", id)
        .eq("org_id", orgId);
      if (error) {
        console.error("domain remove: delete error (org=%s, id=%s):", orgId, id, error);
        return NextResponse.json({ error: "Failed to remove domain." }, { status: 500 });
      }
      // Zero rows after the read above found one: the row changed under us
      // (the worker attached it, so the delete policy now excludes it).
      // Report the race rather than a success that did nothing.
      if (count !== 1) {
        return NextResponse.json(
          { error: "Domain changed while removing it. Refresh and try again." },
          { status: 409 },
        );
      }
      return NextResponse.json({ success: true, status: "deleted" });
    }

    // Only a verified + attached row reaches here; predicate on both so a
    // concurrent transition (or a service-side bug) is zero rows, not a
    // blind overwrite.
    const { data: updated, error: updateError } = await service
      .from("org_domains")
      .update({ status: "removing", attach_claimed_at: null, attach_claim_token: null })
      .eq("id", id)
      .eq("org_id", orgId)
      .eq("status", "verified")
      .not("attached_at", "is", null)
      .select("id");
    if (updateError) {
      console.error("domain remove: removing transition failed (org=%s, id=%s):", orgId, id, updateError);
      return NextResponse.json({ error: "Failed to remove domain." }, { status: 500 });
    }
    if (!updated || updated.length !== 1) {
      return NextResponse.json(
        { error: "Domain changed while removing it. Refresh and try again." },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, status: "removing" });
  } catch (err) {
    console.error("domain remove: unexpected error (org=%s, id=%s):", orgId, id, err);
    return NextResponse.json({ error: "Failed to remove domain." }, { status: 500 });
  }
}
