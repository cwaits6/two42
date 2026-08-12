/**
 * GET /api/admin/members/export (CWA-40) — the org roster as CSV.
 *
 * Admin-gated through requireOrgAdmin(); every read goes through the
 * cookie-bound client, so RLS scopes the snapshot to the caller's org. The
 * explicit org_id filters loadOrgSnapshot applies are the tier-C floor
 * beneath that, not a replacement for it — see the note in snapshot.ts. No
 * org_id ever appears in the file. Error bodies are plain text,
 * matching app/api/members/[id]/vcard/route.ts, and no snapshot content —
 * rows, cells, emails — ever reaches console.* (log codes and table names
 * only; the CSV is full-roster PII).
 */
import { requireOrgAdmin } from "@/lib/members/access";
import {
  memberRowsFromSnapshot,
  serializeMembers,
} from "@/lib/members/format";
import { loadOrgSnapshot } from "@/lib/members/snapshot";

export async function GET() {
  const gate = await requireOrgAdmin();
  if (!gate.ok) {
    return new Response(gate.status === 401 ? "Unauthorized" : "Forbidden", {
      status: gate.status,
    });
  }

  // Split from the serialization below so the "table name only" claim about
  // `err` stays true by construction — a projection crash must not log as a
  // snapshot failure.
  let snapshot;
  try {
    snapshot = await loadOrgSnapshot(gate.supabase, gate.orgId);
  } catch (err) {
    // err carries a table name only (see loadOrgSnapshot) — never row data.
    console.error("members export: snapshot load failed:", err);
    return new Response("Failed to build export", { status: 500 });
  }

  let csv: string;
  try {
    csv = serializeMembers(memberRowsFromSnapshot(snapshot));
  } catch (err) {
    // The projection holds full-roster PII — log the error TYPE only.
    console.error(
      "members export: serialization failed:",
      err instanceof Error ? err.name : typeof err
    );
    return new Response("Failed to build export", { status: 500 });
  }

  // The org row for the filename. Filtering `id` against the caller's own
  // validated org anchor rather than relying on RLS alone: organizations is
  // the tenant root and carries no org_id, so this is the shape CLAUDE.md
  // prescribes for it.
  const { data: org, error: orgError } = await gate.supabase
    .from("organizations")
    .select("slug")
    .eq("id", gate.orgId)
    .maybeSingle();
  if (orgError) {
    // Not a 500 — the CSV is correct and complete; only the filename degrades.
    // But two full-PII rosters from different orgs sharing "members-<date>"
    // is worth a log line rather than a silent collapse to slug = "".
    console.error(
      "members export: org slug lookup failed; falling back to an unnamed file: code=%s message=%s",
      orgError.code,
      orgError.message
    );
  }
  const slug = (org?.slug ?? "").replace(/[^a-zA-Z0-9-]/g, "");
  const date = new Date().toISOString().slice(0, 10);
  const filename = ["members", slug, date].filter(Boolean).join("-");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
