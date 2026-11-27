// A church admin's Refresh now: the nightly refresh's code, run for the
// admin's own church. Server-only: imports next/headers through
// @/lib/supabase/server.
import { createServiceClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/sanitize";
import { type RecordsRefreshClient, refreshOrg, type RefreshResult } from "@/supabase/functions/_shared/records-refresh";
import { removeRecordsChildPhoto, removeRecordsPhoto, storeRecordsChildPhoto, storeRecordsPhoto } from "./photo";
import type { RecordsCredentials, RecordsProvider } from "./types";

// Inside the route's maxDuration; people not reached wait for the next refresh.
const BUDGET_MS = 45_000;

/**
 * Refreshes the church `orgId` names, which must come from requireOrgAdmin().
 * The service client goes to refreshOrg(), whose every query filters on that
 * org. Null when the provider offers no copying.
 */
export async function refreshNow(
  orgId: string,
  loaded: { provider: RecordsProvider; creds: RecordsCredentials; connectionId: string },
): Promise<RefreshResult | null> {
  if (!loaded.provider.copy) return null;
  const service = await createServiceClient();
  const startedAt = Date.now();
  return refreshOrg(service as unknown as RecordsRefreshClient, {
    orgId,
    connectionId: loaded.connectionId,
    creds: loaded.creds,
    source: loaded.provider.copy,
    normalizePhone,
    storePhoto: storeRecordsPhoto,
    removePhoto: removeRecordsPhoto,
    storeChildPhoto: storeRecordsChildPhoto,
    removeChildPhoto: removeRecordsChildPhoto,
    now: () => new Date(),
    elapsed: () => Date.now() - startedAt,
    budgetMs: BUDGET_MS,
  });
}
