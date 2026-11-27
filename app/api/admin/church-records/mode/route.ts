import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { logError } from "@/lib/log";
import { gateError, hidden, recordsSecretOrNull } from "@/lib/integrations/records/http";
import { providerFor } from "@/lib/integrations/records/providers";
import { isRecordsMode, liveCopiedCount, readConnection, readMode, saveMode } from "@/lib/integrations/records/store";

/**
 * /api/admin/church-records/mode — whether the church copies its records'
 * details into two42 or shows them live.
 *
 *   GET  `{ mode, copiedCount }`: the mode, and how many details from the
 *        records switching to live would remove.
 *   PUT  `{ mode: "copy" | "live" }`. Switching to live removes every detail
 *        two42 still holds from the records, keeping what members changed;
 *        switching to copy fills them in at the next refresh. Answers
 *        `{ mode, removed }`, or 409 while a refresh is running, saving nothing.
 *
 * Answers 404 while the church isn't connected, or its provider can't show
 * details live. The org is the caller's own, from requireOrgAdmin().
 */

const ROUTE = "/api/admin/church-records/mode";

async function liveProvider(orgId: string) {
  const connection = await readConnection(orgId);
  const provider = connection && providerFor(connection.provider);
  return provider?.live && provider.copy ? provider : null;
}

export async function GET() {
  if (!recordsSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  try {
    if (!(await liveProvider(gate.orgId))) return hidden();
    const [{ mode }, copiedCount] = await Promise.all([readMode(gate.orgId), liveCopiedCount(gate.orgId)]);
    return NextResponse.json({ mode, copiedCount });
  } catch (err) {
    logError("Church records mode read failed", err, { route: ROUTE, ids: { org: gate.orgId } });
    return NextResponse.json({ error: "Couldn't load how two42 uses your church's records." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!recordsSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const mode = body?.mode;
  if (!isRecordsMode(mode)) {
    return NextResponse.json({ error: "Choose Copy into two42 or Live from your church's records." }, { status: 400 });
  }
  try {
    if (!(await liveProvider(gate.orgId))) return hidden();
    const saved = await saveMode(gate.orgId, mode, gate.user.id);
    if (saved.outcome === "busy") {
      return NextResponse.json(
        { error: "A refresh is running. Save again when it finishes, in a few minutes." },
        { status: 409 },
      );
    }
    return NextResponse.json({ mode, removed: saved.removed });
  } catch (err) {
    logError("Church records mode save failed", err, { route: ROUTE, ids: { org: gate.orgId } });
    return NextResponse.json({ error: "Couldn't save how two42 uses your church's records." }, { status: 500 });
  }
}
