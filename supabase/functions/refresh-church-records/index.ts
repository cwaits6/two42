// Supabase Edge Function: refresh-church-records
//
// Nightly, for every church connected to its church records: copies the
// details of people changed since the last run, and of links not yet copied,
// into two42, and lists people who went inactive or disappeared under Needs
// review. The rules live in _shared/records-refresh.ts and
// _shared/records-copy.ts; a church admin's Refresh now runs the same code.
// No migration schedules it: the operator adds the schedule.
//
// Runs with the service key (BYPASSRLS), so tenant isolation lives in the
// query text: iterates every active organization and filters each query on
// org_id explicitly. Opens each church's key with RECORDS_KEY_SECRET; without
// it the integration is off and the run does nothing, and with a value that
// isn't a key it answers 500 so the schedule shows the fault.

// Pinned exactly, in lockstep with the reminder functions and package-lock.json.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.9";
import { serviceKeyCallerOnly } from "../_shared/caller-auth.ts";
import { listActiveOrgs, type OrgListClient } from "../_shared/orgs.ts";
import { openKey, parseRecordsSecret, RECORDS_SECRET_ENV } from "../_shared/records-crypto.ts";
import { assertAddressGuard } from "../_shared/records-fetch.ts";
import { type RecordsPhotoStorage, storeRecordsPhoto } from "../_shared/records-photo.ts";
import { copySourceFor } from "../_shared/records-providers.ts";
import { type RecordsRefreshClient, refreshAllOrgs, refreshOrg } from "../_shared/records-refresh.ts";
import { normalizePhone } from "../_shared/phone.ts";
import { resolveServiceKey } from "../_shared/service-key.ts";
import { logError, logInfo, logWarn } from "../_shared/log.ts";

// Inside the edge runtime's 150 s request limit; what is left waits for the next night.
const BUDGET_MS = 90_000;

interface ConnectionClient {
  from(table: "records_connections"): {
    select(columns: string): {
      eq(column: "org_id", value: string): {
        maybeSingle(): PromiseLike<{
          data: { provider: string; base_url: string; key_ciphertext: string; connection_id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(serviceKeyCallerOnly(async () => {
  const raw = Deno.env.get(RECORDS_SECRET_ENV);
  const secret = parseRecordsSecret(raw);
  if (!secret && raw?.trim()) {
    logError("church records refresh skipped: RECORDS_KEY_SECRET is not a valid key", undefined, {
      route: "refresh-church-records",
    });
    return json({ error: "RECORDS_KEY_SECRET is not a valid key." }, 500);
  }
  if (!secret) {
    logInfo("church records refresh skipped: the integration is off", { route: "refresh-church-records" });
    return json({ orgs: 0 }, 200);
  }
  try {
    // A runtime that ignored the address check would send a church's key
    // wherever its records' name resolves, so nothing is opened without it.
    await assertAddressGuard();

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, resolveServiceKey());
    // Casts: structurally checking the full SupabaseClient against these narrow
    // types trips TS2589 at the pinned version, as in the reminder functions.
    const db = supabase as unknown as RecordsRefreshClient & ConnectionClient;
    const orgs = await listActiveOrgs(supabase as unknown as OrgListClient);
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;

    const all = await refreshAllOrgs(orgs, {
      elapsed,
      budgetMs: BUDGET_MS,
      refreshOne: async (org) => {
        const { data: connection, error } = await db
          .from("records_connections")
          .select("provider, base_url, key_ciphertext, connection_id")
          .eq("org_id", org.id)
          .maybeSingle();
        if (error) throw new Error("records connection read failed");
        if (!connection) return null;
        const source = copySourceFor(connection.provider);
        if (!source) throw new Error("records connection has a provider with no copy source");
        return await refreshOrg(db, {
          orgId: org.id,
          connectionId: connection.connection_id,
          creds: { baseUrl: connection.base_url, key: openKey(secret, org.id, connection.provider, connection.key_ciphertext) },
          source,
          normalizePhone,
          storePhoto: (orgId, profileId, bytes) =>
            storeRecordsPhoto(supabase as unknown as RecordsPhotoStorage, orgId, profileId, bytes),
          now: () => new Date(),
          elapsed,
          budgetMs: BUDGET_MS,
        });
      },
    });

    const { connected, copied, review, pending, failed, cutShort, notStarted, busy } = all;
    const summary = {
      route: "refresh-church-records",
      ids: {
        connected,
        copied,
        review,
        pending,
        orgsFailed: failed.length,
        orgsCutShort: cutShort.length,
        orgsNotStarted: notStarted.length,
        orgsBusy: busy.length,
      },
    };
    if (cutShort.length || notStarted.length) logWarn("church records refresh ran out of time", undefined, summary);
    else if (busy.length) logWarn("church records refresh skipped churches another refresh held", undefined, summary);
    else logInfo("church records refresh run", summary);
    // The org failures carry ids only: an error's text could hold a database message.
    return json(
      { orgs: orgs.length, connected, copied, review, pending, failed, cutShort, notStarted, busy },
      all.finished ? 200 : 500,
    );
  } catch (err) {
    logError("church records refresh aborted before completion", err, { route: "refresh-church-records" });
    return json({ error: "The church records refresh stopped before it finished." }, 500);
  }
}));
