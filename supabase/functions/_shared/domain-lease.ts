// The org_domains lease client for the attachment worker: the single-flight
// claim, the fenced attached_at stamp, and the detach hard-delete, each as
// one atomic UPDATE/DELETE whose predicate revalidates row state.
//
// Two layers, mirroring _shared/orgs.ts and _shared/quota.ts:
//   * DomainLeaseClient — the narrow, intention-revealing interface the
//     orchestration in _shared/domain-attach.ts is written against, so its
//     unit tests use a hand-built fake;
//   * createDomainLeaseClient() — the real implementation over a structural
//     slice of the Supabase query builder (DomainTableClient), so the exact
//     predicates can themselves be pinned by a recording fake in
//     tests/domain_lease_test.ts without importing @supabase/supabase-js.
//
// Runs with the service key (BYPASSRLS): every chain below carries an
// explicit .eq("org_id", …) — that predicate IS the tenant boundary here.
// Every write asserts the affected-row count (a maybeSingle() row back, or
// an exact count) and never just checks `error`: a filtered UPDATE/DELETE
// that matches nothing is a silent success in PostgREST, and this codebase
// has shipped that bug before.

/**
 * The single-flight lease window. Mirrors ATTACH_LEASE_WINDOW_MS in
 * lib/domains.ts (edge functions cannot import from lib/): the platform
 * retry route clears only leases older than this, and the /platform UI
 * reports a lease as expired on the same boundary. A change lands on both
 * sides, and in the pgTAP suite's interval.
 */
export const ATTACH_LEASE_WINDOW_MS = 10 * 60 * 1000;

export interface DomainRow {
  id: string;
  domain: string;
}

export interface DomainLeaseClient {
  /** status = 'verified' AND attached_at IS NULL, oldest first. */
  listVerifiedUnattached(orgId: string): Promise<DomainRow[]>;
  /** status = 'removing' (detach tombstones), oldest first. */
  listRemoving(orgId: string): Promise<DomainRow[]>;
  /**
   * Atomically take the attach lease. Returns the fresh claim token, or null
   * when zero rows matched — another attempt holds a live lease, or the
   * row's state moved (attached, revoked, deleted). The caller must treat
   * null as "stop", never as a distinguishable condition.
   */
  claimAttachLease(id: string, orgId: string, leaseWindowMs: number): Promise<string | null>;
  /** Same lease, predicated on status = 'removing' (a tombstone keeps attached_at). */
  claimDetachLease(id: string, orgId: string, leaseWindowMs: number): Promise<string | null>;
  /**
   * The fenced final stamp: true only if the UPDATE matched a row — token
   * fence, live lease, same domain, still verified, still unattached.
   */
  stampAttached(
    id: string,
    orgId: string,
    token: string,
    domain: string,
    leaseWindowMs: number,
  ): Promise<boolean>;
  /** Compensation read after a zero-row stamp: is the row still there at all? */
  rowStillExists(id: string, orgId: string): Promise<boolean>;
  /** Hard-delete a tombstone the caller holds the detach lease on. True only when exactly one row went. */
  hardDeleteRemoved(id: string, orgId: string, token: string): Promise<boolean>;
}

// ── The structural query-builder slice the real implementation needs ───────

export interface DomainQueryResult {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}

export interface DomainQueryBuilder extends PromiseLike<DomainQueryResult> {
  select(columns: string): DomainQueryBuilder;
  update(values: Record<string, unknown>): DomainQueryBuilder;
  delete(opts: { count: "exact" }): DomainQueryBuilder;
  eq(column: string, value: unknown): DomainQueryBuilder;
  is(column: string, value: null): DomainQueryBuilder;
  gt(column: string, value: string): DomainQueryBuilder;
  or(filters: string): DomainQueryBuilder;
  order(column: string): DomainQueryBuilder;
  maybeSingle(): PromiseLike<DomainQueryResult>;
}

/** The narrow slice of the Supabase client this module needs. */
export interface DomainTableClient {
  from(table: "org_domains"): DomainQueryBuilder;
}

function isoNow(): string {
  return new Date().toISOString();
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function toRows(data: unknown): DomainRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r): DomainRow[] =>
    typeof r === "object" && r !== null &&
      typeof (r as DomainRow).id === "string" &&
      typeof (r as DomainRow).domain === "string"
      ? [{ id: (r as DomainRow).id, domain: (r as DomainRow).domain }]
      : []
  );
}

export function createDomainLeaseClient(supabase: DomainTableClient): DomainLeaseClient {
  // The lease predicate, shared by both claims: free (NULL) or expired
  // (older than the window). PostgREST `or=` syntax; the ISO timestamp
  // carries no comma or paren so it needs no quoting.
  const leaseFree = (leaseWindowMs: number) =>
    `attach_claimed_at.is.null,attach_claimed_at.lt.${isoAgo(leaseWindowMs)}`;

  async function claim(
    id: string,
    orgId: string,
    status: "verified" | "removing",
    leaseWindowMs: number,
  ): Promise<string | null> {
    const token = crypto.randomUUID();
    let q = supabase
      .from("org_domains")
      .update({ attach_claimed_at: isoNow(), attach_claim_token: token })
      .eq("id", id)
      .eq("org_id", orgId)
      .eq("status", status);
    // Only an attach claim gates on attached_at: a 'removing' tombstone
    // keeps attached_at by design (it is the "Vercel cleanup owed" marker).
    if (status === "verified") q = q.is("attached_at", null);
    const { data, error } = await q
      .or(leaseFree(leaseWindowMs))
      .select("attach_claim_token")
      .maybeSingle();
    if (error) throw new Error(`lease claim failed: ${error.message}`);
    return data ? token : null;
  }

  return {
    async listVerifiedUnattached(orgId) {
      const { data, error } = await supabase
        .from("org_domains")
        .select("id, domain")
        .eq("org_id", orgId)
        .eq("status", "verified")
        .is("attached_at", null)
        .order("created_at");
      if (error) throw new Error(`list verified domains failed: ${error.message}`);
      return toRows(data);
    },

    async listRemoving(orgId) {
      const { data, error } = await supabase
        .from("org_domains")
        .select("id, domain")
        .eq("org_id", orgId)
        .eq("status", "removing")
        .order("created_at");
      if (error) throw new Error(`list removing domains failed: ${error.message}`);
      return toRows(data);
    },

    claimAttachLease(id, orgId, leaseWindowMs) {
      return claim(id, orgId, "verified", leaseWindowMs);
    },

    claimDetachLease(id, orgId, leaseWindowMs) {
      return claim(id, orgId, "removing", leaseWindowMs);
    },

    async stampAttached(id, orgId, token, domain, leaseWindowMs) {
      // The token blocks a worker superseded by a newer claim; the live-lease
      // predicate blocks a slow worker whose lease expired with no
      // replacement; `domain` pins the stamp to the name actually sent to
      // Vercel. Any mismatch is zero rows, and zero rows means "do not
      // consider this attached".
      const { data, error } = await supabase
        .from("org_domains")
        .update({ attached_at: isoNow() })
        .eq("id", id)
        .eq("org_id", orgId)
        .eq("attach_claim_token", token)
        .eq("domain", domain)
        .eq("status", "verified")
        .is("attached_at", null)
        .gt("attach_claimed_at", isoAgo(leaseWindowMs))
        .select("id")
        .maybeSingle();
      if (error) throw new Error(`attached_at stamp failed: ${error.message}`);
      return data !== null && data !== undefined;
    },

    async rowStillExists(id, orgId) {
      const { data, error } = await supabase
        .from("org_domains")
        .select("id")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw new Error(`row re-read failed: ${error.message}`);
      return data !== null && data !== undefined;
    },

    async hardDeleteRemoved(id, orgId, token) {
      const { error, count } = await supabase
        .from("org_domains")
        .delete({ count: "exact" })
        .eq("id", id)
        .eq("org_id", orgId)
        .eq("status", "removing")
        .eq("attach_claim_token", token);
      if (error) throw new Error(`tombstone delete failed: ${error.message}`);
      return count === 1;
    },
  };
}
