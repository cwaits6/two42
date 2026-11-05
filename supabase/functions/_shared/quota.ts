// Per-org daily email quota reserve. Wraps
// email_quota_consume() — a SECURITY DEFINER RPC with service_role-only
// EXECUTE (supabase/migrations/20260825000000_org_email_send_caps.sql).
// Mirrors lib/email/quota.ts's contract in intent (not byte-for-byte in
// code, since this file cannot import from lib/): fail closed on any RPC
// error, reserve once per batch for the final filtered recipient set before
// the first send, never throw — a capped or errored reservation is a skip,
// not an abort of the caller's per-team/per-event loop or of forEachOrg's
// org loop (see _shared/orgs.ts).
//
// Deliberately free of any @supabase/supabase-js import so it can be unit
// tested offline against the structural type below.

import { logError } from "./log.ts";

interface QuotaResult {
  data: boolean | null;
  error: { message: string } | null;
}

/** The narrow slice of the Supabase client this module needs. */
export interface QuotaClient {
  rpc(
    fn: "email_quota_consume",
    args: { _org_id: string; _n: number },
  ): PromiseLike<QuotaResult>;
}

export async function reserveEmailQuota(
  supabase: QuotaClient,
  orgId: string,
  n: number,
): Promise<boolean> {
  // An empty (already-filtered) batch needs no reservation — and must not
  // reach the RPC, whose _n <= 0 raise is reserved for caller bugs.
  if (n === 0) return true;
  // A negative batch IS a caller bug: refuse rather than approve a send the
  // quota never accounted for (fail closed, same as an RPC error).
  if (n < 0) {
    logError("email quota check got a negative batch, refusing send", undefined, {
      ids: { org: orgId, n },
    });
    return false;
  }
  try {
    const { data, error } = await supabase.rpc("email_quota_consume", {
      _org_id: orgId,
      _n: n,
    });
    if (error) {
      logError("email quota check failed, refusing send", error, { ids: { org: orgId, n } });
      return false;
    }
    return data === true;
  } catch (err) {
    logError("email quota check threw, refusing send", err, { ids: { org: orgId, n } });
    return false;
  }
}
