import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { logError } from "@/lib/log";
import { gateError, hidden, recordsSecretOrNull } from "@/lib/integrations/records/http";
import { deleteLink } from "@/lib/integrations/records/store";

/** DELETE /api/admin/church-records/links/[profileId] — unlink one profile from its person in the records. The profile is unchanged. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  if (!recordsSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const { profileId } = await params;
  if (!UUID.test(profileId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const removed = await deleteLink(gate.orgId, profileId);
    if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ unlinked: true });
  } catch (err) {
    logError("Church records unlink failed", err, {
      route: "/api/admin/church-records/links/[profileId]",
      ids: { org: gate.orgId, profile: profileId },
    });
    return NextResponse.json({ error: "Couldn't unlink." }, { status: 500 });
  }
}
