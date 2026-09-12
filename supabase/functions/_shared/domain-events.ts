// The org_domain_worker_events client for the attachment worker: the
// durable record of the two outcomes the run summary alone cannot carry past
// the run — a permanent Vercel refusal, and a completed detach whose
// tombstone is gone.
//
// Two layers, mirroring _shared/domain-lease.ts:
//   * DomainEventsClient — the narrow, intention-revealing interface the
//     orchestration in _shared/domain-attach.ts is written against, so its
//     unit tests use a hand-built fake;
//   * createDomainEventsClient() — the real implementation over a structural
//     slice of the Supabase query builder (DomainEventsTableClient), so the
//     exact predicates are pinned by a recording fake in
//     tests/domain_events_test.ts without importing @supabase/supabase-js.
//
// Runs with the service key (BYPASSRLS): the read carries an explicit
// .eq("org_id", …) and every insert an explicit org_id — that value IS the
// tenant boundary here. This is the one place in the worker that stores the
// domain name by design: an operator acknowledging a detach needs the name
// to find its redirect-allowlist entry, and the org_domains row it came from
// no longer exists. Inserts are plain appends — a duplicate is harmless
// because the skip check asks "any unacknowledged row?", never "exactly
// one" — so there is no lease or fence on this table.

export type DomainWorkerEvent = "attach_permanent_failure" | "detached";

export interface DomainEventsClient {
  /** True when (org_id, domain) has an attach_permanent_failure event with acknowledged_at IS NULL. */
  hasUnacknowledgedPermanentFailure(orgId: string, domain: string): Promise<boolean>;
  /** Append an attach_permanent_failure event with an explicit org_id. Throws on an insert error. */
  recordPermanentFailure(orgId: string, domain: string, detail: string): Promise<void>;
  /** Append a detached event with an explicit org_id. Throws on an insert error. */
  recordDetached(orgId: string, domain: string): Promise<void>;
}

// ── The structural query-builder slice the real implementation needs ───────

export interface DomainEventsQueryResult {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}

export interface DomainEventsQueryBuilder extends PromiseLike<DomainEventsQueryResult> {
  select(columns: string, opts: { count: "exact"; head: true }): DomainEventsQueryBuilder;
  insert(values: Record<string, unknown>): DomainEventsQueryBuilder;
  eq(column: string, value: unknown): DomainEventsQueryBuilder;
  is(column: string, value: null): DomainEventsQueryBuilder;
}

/** The narrow slice of the Supabase client this module needs. */
export interface DomainEventsTableClient {
  from(table: "org_domain_worker_events"): DomainEventsQueryBuilder;
}

export function createDomainEventsClient(supabase: DomainEventsTableClient): DomainEventsClient {
  async function record(orgId: string, domain: string, event: DomainWorkerEvent, detail: string | null) {
    const { error } = await supabase
      .from("org_domain_worker_events")
      .insert({ org_id: orgId, domain, event, detail });
    if (error) throw new Error(`${event} event insert failed: ${error.message}`);
  }

  return {
    async hasUnacknowledgedPermanentFailure(orgId, domain) {
      // A head request: the count is the answer, no rows come back. An
      // error throws (the caller records the row as failed, never as
      // skipped); a missing count reads as zero, so the worst case of a
      // count-less response is one more attempt, not a row silently
      // parked forever.
      const { error, count } = await supabase
        .from("org_domain_worker_events")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("domain", domain)
        .eq("event", "attach_permanent_failure")
        .is("acknowledged_at", null);
      if (error) throw new Error(`permanent-failure lookup failed: ${error.message}`);
      return (count ?? 0) > 0;
    },

    recordPermanentFailure(orgId, domain, detail) {
      return record(orgId, domain, "attach_permanent_failure", detail);
    },

    recordDetached(orgId, domain) {
      return record(orgId, domain, "detached", null);
    },
  };
}
