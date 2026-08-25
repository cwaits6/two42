// Shared org-iteration primitive for the cron-triggered Edge Functions.
//
// Both reminder functions run with the service key, which carries BYPASSRLS —
// the Phase 2 org isolation policies do not constrain them. Tenant isolation
// therefore has to live in the query text: enumerate orgs here, then filter
// every downstream query on org_id explicitly.
//
// The one exception is a nested PostgREST embed — `.select("a, b(c)")` — which
// cannot take its own filter. Those are safe *because* the parent row was
// already org-filtered and every FK into an org-owned parent is composite
// (col, org_id), so an embed traversal cannot leave the tenant. That argument
// only holds while the parent is filtered: never embed from an unfiltered
// `.from(`.
//
// Deliberately free of any @supabase/supabase-js import so it can be unit
// tested offline against the structural type below.

export interface Org {
  id: string;
  name: string;
  slug: string;
  // The raw organizations.branding jsonb. Deliberately `unknown`, not a typed
  // shape: _shared/branding.ts is the sole validator of this column, and this
  // module must not grow a second, weaker opinion about it.
  branding: unknown;
  // The org's single sending-domain row (org_email_domains, Phase 5 PR 6 /
  // #367), embedded via the FK from organizations — an array by PostgREST
  // convention even though the unique index on org_id caps it at one row.
  // Deliberately raw {domain, status}, not pre-validated: _shared/branding.ts
  // is the sole validator, same reasoning as `branding` above.
  org_email_domains: Array<{ domain: string; status: string }>;
}

interface QueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** The narrow slice of the Supabase client this module needs. */
export interface OrgListClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        order(column: string): PromiseLike<QueryResult<Org>>;
      };
    };
  };
}

/**
 * Active organizations, ordered by slug for a stable, reproducible run order.
 * Suspended orgs are skipped — a suspended tenant must not email its members.
 * Throws on query failure: enumerating zero orgs because of an error is
 * indistinguishable from "no orgs" at the call site, and would silently make
 * the whole run a no-op.
 *
 * branding rides along on this one query (CWA-56) so per-org email branding
 * costs no extra round trip and no new service-role call site — and the
 * org_email_domains embed (CWA-71) rides along the same way. The embed is
 * safe without its own filter because it is reached by FK traversal from an
 * organizations row this same service-role query already selected — the
 * embed-from-an-already-filtered-parent exception, not a new unscoped
 * `.from(` call.
 */
export async function listActiveOrgs(supabase: OrgListClient): Promise<Org[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, slug, branding, org_email_domains(domain, status)")
    .eq("status", "active")
    .order("slug");
  if (error) throw new Error(`Failed to list organizations: ${error.message}`);
  return data ?? [];
}

/**
 * A failure isolated below the org level — one team, one event, one row
 * (CWA-50). `item` is an id (e.g. a group_id), never an org-defined name:
 * names are tenant content and fragile as diagnostic keys.
 */
export interface ItemFailure {
  item: string;
  error: string;
}

/**
 * What a per-org runner reports back. `sendFailures` counts emails Resend
 * refused or that never left the function — without it, a run in which every
 * send failed is byte-identical to a legitimately quiet day, because a failed
 * send throws nothing and so never reaches `failed[]`. `itemFailures` is the
 * sub-org failure channel (CWA-50): optional, so a runner with no inner loop
 * (send-event-reminders) is unchanged.
 */
export interface OrgRunCounts {
  sent: number;
  sendFailures: number;
  itemFailures?: ItemFailure[];
}

export interface OrgRunResult extends OrgRunCounts {
  orgId: string;
  slug: string;
  error?: string;
}

/**
 * Thrown by a per-org runner (runForOrg / runDaily / runMonthly) when it must
 * abort mid-run but has already sent some emails. Without this, a mid-loop
 * throw after N successful sends would still be recorded by forEachOrg as
 * `{ sent: 0, sendFailures: 0 }` — indistinguishable from an org that failed
 * before sending anything (CWA-49). Callers should accumulate `sent` /
 * `sendFailures` locally and throw this instead of a plain `Error` once any
 * email has gone out. Carries `itemFailures` for the same reason (CWA-49 ∩
 * CWA-50): an org that aborts mid-run must still report the teams that had
 * already failed before the abort.
 */
export class OrgRunError extends Error {
  readonly sent: number;
  readonly sendFailures: number;
  readonly itemFailures: ItemFailure[];

  constructor(message: string, counts: OrgRunCounts) {
    super(message);
    this.name = "OrgRunError";
    this.sent = counts.sent;
    this.sendFailures = counts.sendFailures;
    this.itemFailures = counts.itemFailures ?? [];
  }
}

/**
 * Run `fn` once per org, sequentially, isolating failures: one org throwing is
 * logged with its slug and recorded, and the remaining orgs still run.
 * Sequential rather than parallel so outbound Resend concurrency stays at
 * today's rate instead of being multiplied by the org count.
 */
export async function forEachOrg(
  orgs: Org[],
  fn: (org: Org) => Promise<OrgRunCounts>,
): Promise<OrgRunResult[]> {
  const results: OrgRunResult[] = [];
  for (const org of orgs) {
    try {
      const { sent, sendFailures, itemFailures } = await fn(org);
      results.push({
        orgId: org.id,
        slug: org.slug,
        sent,
        sendFailures,
        // Omitted when empty so runners without an inner loop keep today's
        // exact result shape (and response body).
        ...(itemFailures?.length ? { itemFailures } : {}),
      });
    } catch (err) {
      console.error("[org %s %s] reminder run failed:", org.slug, org.id, err);
      // OrgRunError carries whatever was sent (and which items had already
      // failed) before the mid-run abort; ordinary errors fall back to zeroes.
      const counts: OrgRunCounts = err instanceof OrgRunError
        ? { sent: err.sent, sendFailures: err.sendFailures, itemFailures: err.itemFailures }
        : { sent: 0, sendFailures: 0 };
      results.push({
        orgId: org.id,
        slug: org.slug,
        sent: counts.sent,
        sendFailures: counts.sendFailures,
        ...(counts.itemFailures?.length ? { itemFailures: counts.itemFailures } : {}),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/**
 * Roll per-org results into the HTTP response body.
 *
 * The invocation contract: **HTTP 500 when any org failed OR any item
 * (team) failed — `failed[]` or `failedItems[]` non-empty — 200 only for a
 * clean run.** A team whose reminders silently never went out is exactly as
 * operationally severe as an org that failed. The cron schedules invoke via
 * pg_net's `net.http_post`, which is fire-and-forget — the status lands in
 * `net._http_response` and nothing retries a 5xx (pg_cron reruns on
 * schedule, not on failure), so a 5xx can never cause duplicate sends. The
 * body always carries `failed[]`, `failedItems[]`, and the counts for
 * diagnosis. Resend-level rejections (`emailsFailed`) alone stay 200: the
 * run itself completed and each rejection is logged per profile.
 */
export function summarize(results: OrgRunResult[]): {
  orgs: number;
  emailsSent: number;
  emailsFailed: number;
  failed: Array<{ org: string; error: string }>;
  failedItems: Array<{ org: string; item: string; error: string }>;
} {
  return {
    orgs: results.length,
    emailsSent: results.reduce((n, r) => n + r.sent, 0),
    emailsFailed: results.reduce((n, r) => n + r.sendFailures, 0),
    failed: results
      .filter((r) => r.error)
      .map((r) => ({ org: r.slug, error: r.error as string })),
    failedItems: results.flatMap((r) =>
      (r.itemFailures ?? []).map((f) => ({ org: r.slug, item: f.item, error: f.error }))
    ),
  };
}
