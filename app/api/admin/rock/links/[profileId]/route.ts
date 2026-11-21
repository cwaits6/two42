import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { logError } from "@/lib/log";
import { gateError, hidden, rockSecretOrNull } from "@/lib/integrations/rock/http";
import { deleteLink } from "@/lib/integrations/rock/store";

/** DELETE /api/admin/rock/links/[profileId] — unlink one profile from its Rock person. The profile is unchanged. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  if (!rockSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const { profileId } = await params;
  if (!UUID.test(profileId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const removed = await deleteLink(gate.orgId, profileId);
    if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ unlinked: true });
  } catch (err) {
    logError("Rock unlink failed", err, {
      route: "/api/admin/rock/links/[profileId]",
      ids: { org: gate.orgId, profile: profileId },
    });
    return NextResponse.json({ error: "Couldn't unlink." }, { status: 500 });
  }
}
