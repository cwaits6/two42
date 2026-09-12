# Custom domains — attachment, release, and the operator steps

How a tenant's custom domain goes from a claim to a routed host, which
parts are automated, which parts an operator still does by hand, and where
the automation cannot yet see. Design rationale and the decision record
live in [`../plans/phase-5-domains-email.md`](../plans/phase-5-domains-email.md)
(§6–§8, decision D3); the tenancy rules every piece follows are in
[`tenancy-model.md`](tenancy-model.md) and the service-role call sites in
[`service-role-inventory.md`](service-role-inventory.md).

## The flow

| Step | Who | Where |
|------|-----|-------|
| 1. Claim `example.church` | Org admin | `/admin/settings/domains` → `POST /api/admin/domains` (request client, inserts `domain` only; `status = 'pending'`, server-generated `verification_token`) |
| 2. Publish two DNS records | Org admin, at their registrar | Shown on the same page: `TXT _two42-verify.<domain> = <token>` and the routing record (a `CNAME` for a subdomain, an `A` record for an apex; targets come from the Vercel project's Domains page, see below) |
| 3. Verify | Org admin | `POST /api/admin/domains/[id]/verify` — Node-runtime `dns/promises` TXT lookup, compared to the stored token; on match `status = 'verified'`, `verified_at = now()`. Rate-limited per org |
| 4. Attach to the Vercel project | **Worker** (`supabase/functions/attach-org-domains`) | `POST /v10/projects/{id}/domains`, GET-confirm, then the fenced `attached_at` stamp. Only after the stamp is the domain the org's canonical origin |
| 5. Add to the Supabase auth redirect allowlist | **Operator, by hand** | Supabase dashboard → Authentication → URL configuration (see below) |
| 6. Remove | Org admin | `DELETE /api/admin/domains/[id]` — unattached rows are deleted outright; attached rows become `removing` tombstones |
| 7. Detach from Vercel and delete the tombstone | **Worker** | `DELETE /v9/projects/{id}/domains/{domain}` (404 = already gone), then hard-delete the row |
| 8. Remove from the redirect allowlist | **Operator, by hand** | Same dashboard page as step 5 |

The app never holds the Vercel token. Its only power is flipping a row to
`verified`, which it can do only by passing the TXT check. The worker holds
the token as a function secret and is the sole writer of `attached_at`.

### The routing record and where its targets come from

DNS does not allow a CNAME at an apex (`example.church` with nothing in
front). The admin UI shows an `A` record for an apex and a `CNAME` for
everything else, and mentions ALIAS/ANAME / "CNAME flattening" as the
alternative for registrars that offer one. This is the single most common
support case for this feature. The apex heuristic — two labels, or three
under a short list of two-label public suffixes such as `co.uk` — is a UI
hint only; verification and attachment do not depend on it.

**Vercel requires the exact records shown on the project's Domains page**
(Vercel dashboard → the two42 project → Settings → Domains), and those can
differ from Vercel's generic `cname.vercel-dns.com` / `76.76.21.21`. The
admin page therefore reads its targets from two deployment settings, so a
project-specific target is configured once rather than worked around by
every tenant:

| Env var (Next.js, public) | Default | Set from |
|---|---|---|
| `NEXT_PUBLIC_VERCEL_CNAME_TARGET` | `cname.vercel-dns.com` | The CNAME value the project's Domains page shows for a subdomain |
| `NEXT_PUBLIC_VERCEL_APEX_A_RECORD` | `76.76.21.21` | The A value it shows for an apex |

Copy both from that page when the project is first configured, and again if
Vercel ever changes them. The coded defaults are only a fallback.

## The auth redirect allowlist — a manual operator step

Supabase Auth rejects any `redirectTo` not matching `SITE_URL` or the
project's additional redirect URLs and **silently falls back to `SITE_URL`**.
A password reset started on `example.church` would land the user on the
platform host, session-less, with no error anywhere. Every org host must be
in that allowlist:

- `https://*.<platform-apex>/**` once, for every subdomain (done as part of
  the Phase 5 infrastructure prerequisite).
- Each verified custom domain, individually, as `https://example.church/**`.

This is remote Supabase project configuration. Per the repo's hard database
rule it is CI/CD- and operator-owned: **nothing in the app writes it**, and
nothing in the app can check it. The trigger is the `/platform/domains`
page: when a row reads **Attached**, add its allowlist entry; when a
`removing` row disappears from the list, remove the entry.

A missing entry is invisible in CI and shows up only as "password reset
sends me to the wrong site".

## The worker

`supabase/functions/attach-org-domains/index.ts`, with the logic in
`supabase/functions/_shared/domain-attach.ts` (orchestration),
`_shared/domain-lease.ts` (the SQL predicates), `_shared/vercel.ts` (the
Vercel client and response classifiers), `_shared/domain-denylist.ts` (the
apex refusal) and `_shared/entitlement.ts` (the future billing gate, `true`
for everyone today).

### Secrets and environment

Set with `supabase secrets set` on the hosted project (never committed,
never in a Next.js env var):

| Name | Required | Meaning |
|------|----------|---------|
| `VERCEL_API_TOKEN` | yes | A Vercel API token with project-domain management on the deployment's project. Team-scoped tokens are not finely scoped: a compromised worker holds a deployment-control credential, which is why the worker is minimal and every change under `supabase/functions/` is reviewed |
| `VERCEL_PROJECT_ID` | yes | The Vercel project id (or name) the domains are added to |
| `VERCEL_TEAM_ID` | no | Appended as `?teamId=` when the project belongs to a team |
| `PLATFORM_APEX` | no, defaults to `two42.io` | Mirrors `NEXT_PUBLIC_PLATFORM_APEX`; the worker refuses this apex and every subdomain of it |

The service key is resolved the same way as the reminder functions
(`_shared/service-key.ts`). If `VERCEL_API_TOKEN` or `VERCEL_PROJECT_ID` is
missing the function returns 500 before touching any row — deliberately not
"Bearer undefined", which Vercel would answer with a 403 that the worker
would faithfully record as a permanent failure per domain.

**The token does not exist yet.** The worker is built and unit-tested against
a fake Vercel client; the real `fetch`-based client is written from Vercel's
REST reference and has not been exercised against the live API. The
response shapes it classifies are listed in `_shared/vercel.ts`'s header.
Every unrecognised status degrades to "ambiguous" (GET-reconcile), never to
a confident success.

### Schedule

pg_cron invokes the worker every 10 minutes: the `attach-org-domains` job
in `cron.job`, created by
`supabase/migrations/20260911000000_attach_org_domains_schedule_and_events.sql`
through `private.schedule_edge_reminder()` — the same helper and the same
vault-held URL and bearer as the reminder jobs in
`20260729000000_reminder_cron_schedules.sql`. The cadence is the lease
window: a run more often than that only finds rows it cannot claim. The
`/platform` retry button clears an expired lease; it does not trigger a
run — the next scheduled one picks the row up.
`supabase/tests/domain_worker_events_suite.sql` pins the job's name,
schedule and target path.

For debugging, a run can still be triggered by hand against the hosted
project:

```bash
supabase functions invoke attach-org-domains --project-ref <ref>
# or, with the service key as the bearer:
curl -X POST "https://<ref>.supabase.co/functions/v1/attach-org-domains" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

The response is the run summary: `domainsChanged`, `domainsFailed`,
`failed[]` (orgs whose loop threw) and `failedItems[]` (per-row failures,
keyed by `org_domains.id`). HTTP 500 when anything failed, 200 only for a
clean run — the same contract as the reminder functions.

### Single-flight lease and the fenced stamp

Each row is claimed in one atomic `UPDATE` that revalidates state
(`status = 'verified' AND attached_at IS NULL AND (attach_claimed_at IS NULL
OR attach_claimed_at < now() - 10 min)`) and returns a fresh
`attach_claim_token`. Zero rows back means stop. The final stamp requires
the same token, a still-live lease, the same domain that was sent to
Vercel, `status = 'verified'` and `attached_at IS NULL`; a superseded or
expired attempt cannot commit. Detach uses the same lease on `removing`
rows, and the tombstone is hard-deleted only on `(id, org_id,
status = 'removing', attach_claim_token)`. `supabase/tests/org_domains_suite.sql`
runs these statements against a real table and asserts the row counts;
`supabase/functions/tests/domain_lease_test.ts` pins the exact PostgREST
chains.

### Vercel response semantics

| Vercel says | Worker does |
|-------------|-------------|
| 200, `verified: true` | Confirmed — stamp |
| 200, `verified: false` with a `verification[]` challenge (the name is registered to another Vercel account) | Needs manual action, no stamp. The run summary and the function log carry the TXT record to publish; the operator publishes it, then calls `POST /v9/projects/{id}/domains/{domain}/verify`. The row is retried after the lease window, like an ambiguous result |
| 400 "domain already exists on the project" | Idempotent success — GET to confirm, then stamp |
| 409 (assigned to another project/account), 403, 402 | Permanent failure, no stamp. An `attach_permanent_failure` event is recorded and the row is skipped on every later run until the event is acknowledged on `/platform/domains` |
| Timeout, 429, 5xx, any other 400 | Ambiguous — GET first; stamp only if attached, never re-POST blind |
| DELETE 200 / 404 | Detached (404 = already gone) — hard-delete the tombstone, then record a `detached` event |
| DELETE 409 (project being transferred) or other error | Transient — tombstone kept, retried next run |

Compensation for a lost stamp: if Vercel confirmed the attachment but the
fenced stamp matched zero rows, the worker re-reads the row. Row gone (the
admin deleted an unattached row mid-flight) → detach the name just attached.
Row present → leave it for the live lease holder.

## What `/platform/domains` shows

The page lists every claimed domain across tenants with its state
(**Unverified**, **Awaiting attach** with the lease state, **Attached**,
**Detach pending**) and offers **Clear expired claim** on an
awaiting-attach row whose lease has expired.

Above that list it shows the worker's **unacknowledged events** — the two
outcomes the run summary alone could not carry past the run, read from
`org_domain_worker_events` (created by
`20260911000000_attach_org_domains_schedule_and_events.sql`, written through
`supabase/functions/_shared/domain-events.ts`):

1. **Attach failed** (`attach_permanent_failure`). A 409/403/402 from
   Vercel. The row stays `verified` + unattached, but the worker skips it
   on every later run — its skip check reads "any unacknowledged
   permanent-failure event for this `(org_id, domain)`", so "no retry" is
   literal rather than "retry every lease window". Keyed on the domain
   name, not the row id, so a name deleted and re-claimed under a fresh id
   stays parked. Reusing `status = 'failed'` for this was rejected — it
   already means "DNS check did not match" to the admin UI.
2. **Detached** (`detached`). Cleanup completing *is* the tombstone's
   hard-delete, so this event is the durable trace that the name still has a
   redirect-allowlist entry to remove (step 8 of the flow). It is recorded
   only after the delete affected exactly one row. If the insert itself
   fails after that delete — a transient DB error, nothing left to retry
   against — the domain is still logged as a `console.error` (with the
   domain name, since the row is already gone) and the run counts it as
   sent rather than failed, but no `/platform/domains` entry is created for
   it in that case.

**Acknowledge** (`POST /api/platform/domain-events/[id]/acknowledge`)
stamps `acknowledged_at` on the row's own `org_id`, row-count-checked; a
second click is a zero-row no-op. For a permanent failure, acknowledging is
the operator saying "the cause is fixed, retry" — the next run claims the
row again. For a detach it records that the allowlist entry is gone.

The table is service-role-only: the restrictive isolation policy is its
only policy, every privilege is revoked from `anon` and `authenticated`,
and the worker's inserts carry an explicit `org_id` (it runs with
`BYPASSRLS`). `supabase/functions/tests/domain_events_test.ts` pins the
worker's predicates, `supabase/functions/tests/domain_attach_test.ts` the
skip and the two writes, and `supabase/tests/domain_worker_events_suite.sql`
the lockdown and the acknowledge UPDATE's row counts.

What it still cannot show: a Vercel ownership challenge
(`needs_verification`) is not persisted — it is retried after the lease
window like an ambiguous result, and the TXT record to publish is in the
run summary and function log only.

## Invariants worth re-checking on any change here

- `attached_at` has exactly one writer: `stampAttached()` in
  `_shared/domain-lease.ts`. Grep `attached_at` across `app/`, `lib/` and
  `supabase/functions/` after any change.
- `removing` is the only status transition that keeps `attached_at`; the
  remove route's update names `status` and the two lease columns only.
- Every `org_domains` chain in the worker carries `.eq("org_id", …)`, and
  every `org_domain_worker_events` read carries it and every insert names
  it. No lint sees `supabase/functions/`; the recording tests and the pgTAP
  suites are the pins.
- The claim route's apex check (`classifyHost()` in `lib/org.ts`) and the
  worker's (`_shared/domain-denylist.ts`) are two implementations of one
  rule. A change lands on both sides.
