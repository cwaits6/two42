/**
 * GET /api/admin/members/export (CWA-40) — the org roster as CSV.
 *
 * Admin-gated through requireOrgAdmin(); every read goes through the
 * cookie-bound client, so RLS scopes the snapshot to the caller's org and no
 * org_id ever appears in a query or the file. Error bodies are plain text,
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

  let csv: string;
  try {
    const snapshot = await loadOrgSnapshot(gate.supabase);
    csv = serializeMembers(memberRowsFromSnapshot(snapshot));
  } catch (err) {
    // err carries a table name only (see loadOrgSnapshot) — never row data.
    console.error("members export: snapshot load failed:", err);
    return new Response("Failed to build export", { status: 500 });
  }

  // RLS narrows organizations to the caller's org, so this needs no filter.
  const { data: org } = await gate.supabase
    .from("organizations")
    .select("slug")
    .maybeSingle();
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
