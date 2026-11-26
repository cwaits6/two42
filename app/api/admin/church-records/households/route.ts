import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { logError } from "@/lib/log";
import { gateError, hidden, recordsSecretOrNull } from "@/lib/integrations/records/http";
import { providerFor } from "@/lib/integrations/records/providers";
import {
  confirmHousehold,
  readConnection,
  readHouseholdsStatus,
  readyHouseholdSuggestions,
  saveChildrenSetting,
} from "@/lib/integrations/records/store";

/**
 * /api/admin/church-records/households — households suggested from the
 * families in the church's records, and the children switch.
 *
 *   GET   whether children are suggested, when the last refresh ran, whether
 *         it could read families, and the suggestions, named from two42 only.
 *   PUT   `{ suggestChildren: boolean }`. Turning it off removes every child
 *         suggestion no household has decided on.
 *   POST  `{ suggestions: string[] }`, 1 to 100 ids: confirm them, each all
 *         or nothing. More than one only when every one is confirmable in
 *         bulk. 409 when a single one changed since the refresh, or a refresh
 *         is running.
 *
 * Answers 404 while the church isn't connected, or its provider can't read
 * families. The org is the caller's own, from requireOrgAdmin().
 */

const MAX_BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function householdsProvider(orgId: string): Promise<boolean> {
  const connection = await readConnection(orgId);
  return !!(connection && providerFor(connection.provider)?.copy?.households);
}

export async function GET() {
  if (!recordsSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  try {
    if (!(await householdsProvider(gate.orgId))) return hidden();
    return NextResponse.json(await readHouseholdsStatus(gate.orgId));
  } catch (err) {
    logError("Church records households read failed", err, { route: "/api/admin/church-records/households", ids: { org: gate.orgId } });
    return NextResponse.json({ error: "Couldn't load the household suggestions." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!recordsSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.suggestChildren !== "boolean") {
    return NextResponse.json({ error: "Choose whether to suggest children." }, { status: 400 });
  }
  try {
    if (!(await householdsProvider(gate.orgId))) return hidden();
    await saveChildrenSetting(gate.orgId, body.suggestChildren, gate.user.id);
    return NextResponse.json({ suggestChildren: body.suggestChildren });
  } catch (err) {
    logError("Church records children setting save failed", err, { route: "/api/admin/church-records/households", ids: { org: gate.orgId } });
    return NextResponse.json({ error: "Couldn't save whether to suggest children." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!recordsSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const raw = body?.suggestions;
  const ids =
    Array.isArray(raw) && raw.length >= 1 && raw.length <= MAX_BATCH && raw.every((id) => typeof id === "string" && UUID.test(id))
      ? [...new Set(raw as string[])]
      : null;
  if (!ids) return NextResponse.json({ error: "Choose up to 100 households to confirm." }, { status: 400 });

  try {
    if (!(await householdsProvider(gate.orgId))) return hidden();
    if (ids.length > 1) {
      const ready = await readyHouseholdSuggestions(gate.orgId, ids);
      if (ids.some((id) => !ready.has(id))) {
        return NextResponse.json(
          { error: "Suggestions under Check first are confirmed one at a time." },
          { status: 400 },
        );
      }
    }
    let confirmed = 0;
    let changed = 0;
    for (const id of ids) {
      const answer = await confirmHousehold(gate.orgId, id, gate.user.id);
      if (answer === "busy") {
        // Any confirmed before it stay confirmed; the answer says how many.
        return NextResponse.json(
          { error: "A refresh is running. Try again when it finishes, in a few minutes.", confirmed, changed },
          { status: 409 },
        );
      }
      if (answer === "confirmed") confirmed++;
      else changed++;
    }
    if (ids.length === 1 && changed === 1) {
      return NextResponse.json(
        { error: "This changed since the last refresh. Choose Refresh now, then try again." },
        { status: 409 },
      );
    }
    return NextResponse.json({ confirmed, changed });
  } catch (err) {
    logError("Church records household confirm failed", err, { route: "/api/admin/church-records/households", ids: { org: gate.orgId } });
    return NextResponse.json({ error: "Couldn't confirm the households." }, { status: 500 });
  }
}
