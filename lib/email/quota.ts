/**
 * Per-org daily email quota reserve (Phase 5 PR 8, CWA-72). Wraps
 * email_quota_consume() — a SECURITY DEFINER RPC with service_role-only
 * EXECUTE; see supabase/migrations/20260825000000_org_email_send_caps.sql
 * for the tenant-anchor contract (`orgId` must come from an anchor the
 * caller already validated, never a request header or body field).
 *
 * Fail-closed by contract (spec §11.2): an RPC error is a refusal, never
 * "the quota table was unreachable, send anyway" — the cap is a fail-closed
 * control or it is not a control.
 *
 * Callers reserve once per batch, before the first send, for the size of
 * the *final, filtered* recipient set (never the raw list), and skip on
 * refusal by logging, never throwing, so a capped org never aborts the loop
 * it is called from. Mirrored for the edge functions in
 * supabase/functions/_shared/quota.ts.
 */
import { createServiceClient } from "@/lib/supabase/server";

/**
 * The platform default daily cap, for display when an org has no
 * org_email_limits override row. The enforced copy lives in
 * email_quota_consume()'s coalesce(_cap, 500) — that SQL default is
 * authoritative; change both together (decision D7: revisit against the
 * Resend plan's actual ceiling as the tenant count grows).
 */
export const DEFAULT_DAILY_EMAIL_CAP = 500;

/** org_email_limits_cap_sane CHECK bounds, mirrored for request validation. */
export const MAX_DAILY_EMAIL_CAP = 100000;

export async function reserveEmailQuota(orgId: string, n: number): Promise<boolean> {
  // An empty (already-filtered) batch needs no reservation — and must not
  // reach the RPC, whose _n <= 0 raise is reserved for caller bugs.
  if (n === 0) return true;
  // A negative batch IS a caller bug: refuse rather than approve a send the
  // quota never accounted for (fail closed, same as an RPC error).
  if (n < 0) {
    console.error(
      "Email quota check got a negative batch for org %s (n=%d), refusing send",
      orgId,
      n,
    );
    return false;
  }
  try {
    const service = await createServiceClient();
    const { data, error } = await service.rpc("email_quota_consume", {
      _org_id: orgId,
      _n: n,
    });
    if (error) {
      console.error(
        "Email quota check failed for org %s (n=%d), refusing send:",
        orgId,
        n,
        error,
      );
      return false;
    }
    return data === true;
  } catch (err) {
    console.error(
      "Email quota check threw for org %s (n=%d), refusing send:",
      orgId,
      n,
      err,
    );
    return false;
  }
}
