import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { logError } from "@/lib/log";
import { RecordsCryptoError } from "@/lib/integrations/records/crypto";
import { RecordsError } from "@/lib/integrations/records/errors";
import { gateError, hidden, recordsFailure, recordsSecretOrNull } from "@/lib/integrations/records/http";
import { refreshNow } from "@/lib/integrations/records/refresh";
import { loadCredentials } from "@/lib/integrations/records/store";
import type { RefreshCounts } from "@/app/admin/settings/church-records/copyFields";

/**
 * POST /api/admin/church-records/refresh — Refresh now: copies the people
 * changed in the church's records since the last refresh, and anyone not yet
 * copied, then answers with the counts. The nightly refresh-church-records
 * function runs the same code. The org is the caller's own, from
 * requireOrgAdmin().
 */


// The refresh stops starting people at 45 seconds; the rest wait for the next one.
export const maxDuration = 60;

export async function POST() {
  const secret = recordsSecretOrNull();
  if (!secret) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const { orgId } = gate;

  let loaded: Awaited<ReturnType<typeof loadCredentials>>;
  try {
    loaded = await loadCredentials(orgId, secret);
  } catch (err) {
    // A key that won't open means RECORDS_KEY_SECRET changed since it was saved.
    const keyLost = err instanceof RecordsCryptoError;
    logError("Church records credentials unavailable", err, {
      route: "/api/admin/church-records/refresh",
      step: keyLost ? "open_key" : "read_connection",
      ids: { org: orgId },
    });
    if (keyLost) return NextResponse.json({ error: "The saved key can't be opened. Choose Change key and enter it again; your links stay." }, { status: 409 });
    return NextResponse.json({ error: "Couldn't load the connection." }, { status: 500 });
  }
  if (!loaded) return hidden();

  try {
    const result = await refreshNow(orgId, loaded);
    if (!result) return hidden();
    if (result.status === "busy") {
      return NextResponse.json({ error: "A refresh is already running. Try again in a few minutes." }, { status: 409 });
    }
    return NextResponse.json({
      copied: result.copied,
      pending: result.pending,
      review: result.review,
      photosSkipped: result.photosSkipped,
      failed: result.failed,
      householdsUnavailable: result.householdsUnavailable,
      stoppedAtBudget: result.stoppedAtBudget,
    } satisfies RefreshCounts);
  } catch (err) {
    if (err instanceof RecordsError) return recordsFailure(err, loaded.provider.label);
    logError("Church records refresh failed", err, { route: "/api/admin/church-records/refresh", ids: { org: orgId } });
    return NextResponse.json({ error: "Couldn't refresh. Try again." }, { status: 500 });
  }
}
