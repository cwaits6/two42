import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { logError } from "@/lib/log";
import { gateError, hidden, recordsSecretOrNull } from "@/lib/integrations/records/http";
import { providerFor } from "@/lib/integrations/records/providers";
import { parseFieldSettings } from "@/lib/integrations/records/settings";
import {
  readConnection,
  readCopyStatus,
  readFieldSettings,
  saveFieldSettings,
} from "@/lib/integrations/records/store";

/**
 * /api/admin/church-records/copy — what the church copies from its records.
 *
 *   GET  each field's setting, when the last refresh ran, how many linked
 *        people still wait for their first copy, and the people to review:
 *        their two42 name, why, and where to open them in the records.
 *   PUT  save the settings, `{ fields: { <field>: "locked" | "member" } }`;
 *        a field left out is not from the records. Only identity fields can
 *        be locked. 409 while a refresh is running, saving nothing.
 *
 * Answers 404 while the church isn't connected, or its provider offers no
 * copying. The org is the caller's own, from requireOrgAdmin().
 */


async function copyProvider(orgId: string) {
  const connection = await readConnection(orgId);
  const provider = connection && providerFor(connection.provider);
  return provider?.copy && connection ? { provider, baseUrl: connection.baseUrl } : null;
}

export async function GET() {
  if (!recordsSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  try {
    const found = await copyProvider(gate.orgId);
    if (!found) return hidden();
    const [fields, status] = await Promise.all([readFieldSettings(gate.orgId), readCopyStatus(gate.orgId)]);
    return NextResponse.json({
      fields,
      lastRefreshedAt: status.lastRefreshedAt,
      pending: Object.keys(fields).length > 0 ? status.pending : 0,
      review: status.review.map((person) => ({
        profileId: person.profileId,
        name: person.name,
        reason: person.reason,
        since: person.since,
        url: found.provider.personUrl(found.baseUrl, person.personId),
      })),
    });
  } catch (err) {
    logError("Church records copy settings read failed", err, { route: "/api/admin/church-records/copy", ids: { org: gate.orgId } });
    return NextResponse.json({ error: "Couldn't load what two42 copies." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!recordsSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const fields = parseFieldSettings(body?.fields);
  if (!fields) {
    return NextResponse.json(
      { error: "Only name, suffix, title, gender and a child's grade can be locked." },
      { status: 400 },
    );
  }
  try {
    if (!(await copyProvider(gate.orgId))) return hidden();
    if ((await saveFieldSettings(gate.orgId, fields, gate.user.id)) === "busy") {
      return NextResponse.json(
        { error: "A refresh is running. Save again when it finishes, in a few minutes." },
        { status: 409 },
      );
    }
    // The save stores exactly these, so no read can fail after it committed.
    return NextResponse.json({ fields });
  } catch (err) {
    logError("Church records copy settings save failed", err, { route: "/api/admin/church-records/copy", ids: { org: gate.orgId } });
    return NextResponse.json({ error: "Couldn't save what two42 copies." }, { status: 500 });
  }
}
