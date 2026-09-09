# Service-Role Client Inventory

Every place the app bypasses RLS via `createServiceClient()` (defined in
`lib/supabase/server.ts`) or the service key directly (Edge Functions).
`org_id` **is** the enforced tenant boundary (CWA-10 Phase 3, #212 — see
[`tenancy-model.md`](tenancy-model.md)), and a service-role client is NOT
constrained by the per-org RLS policies that enforce it. Every site below is
therefore a potential cross-tenant leak vector, and each row carries the
explicit mitigation that stands in for RLS on that surface. (This inventory
began as CWA-7 Phase 0, #209, when the boundary was still a future change.)

**Adding a new `createServiceClient()` call site? Add a row here in the same
PR, with the justification and the tenancy risk.**

## Automated enforcement (CWA-44)

The blocking `Service-role org_id guard` CI job runs
[`scripts/check-service-role-org-scope.mjs`](../../scripts/README.md), which
turns this document's rules into assertions:

- Every service-role query chain in `app/` and `lib/` must carry an `org_id`
  predicate (Tier B), unless it is a documented org anchor — marked in code
  with a reasoned `// org-anchor: <why>` comment. Most anchor chains in the
  tables below carry that marker in-file. Two do not: the `member_groups`
  (`:50`) and `profiles` (`:80`) chains in
  `app/api/serving/link-action/route.ts` still sit in the script's
  `KNOWN_ANCHORS` allowlist. The parallel PRs that owned that file (#306,
  #323) have landed, so this is now plain outstanding cleanup, not an
  in-flight accommodation — retiring an allowlist entry requires adding the
  in-file marker in the same change (stale entries fail the guard).
- The email fan-out chains (feedback admins, serving broadcast, leader cancel
  notices) are Tier A: they must be scoped and may **not** use the marker —
  an `// org-anchor:` on a fan-out is itself a failure. These surfaces push
  one org's data to third parties and email cannot be recalled.
- Exported `lib/` helpers taking a `SupabaseClient` parameter must scope the
  chains rooted at it (Tier C — a helper that *can* receive a service client
  must scope unconditionally).
- **This file itself is kept in sync**: every `app/`/`lib/` file calling
  `createServiceClient()` must have a row in the tables below, every row must
  name a real call site, and the site counts in the two section headings must
  match reality. The bold rule above is now machine-enforced.

The guard is static and syntax-only; it proves a predicate is *present*, not
that its value is correctly derived. The "Org derived from" column below —
the validated-anchor provenance — remains a review responsibility. Four
blind spots matter in practice:

- **`.rpc()` chains are never inspected** — the guard collects on `.from(`
  exclusively, so `provision_organization()`
  (`app/api/platform/organizations/route.ts`) has no static guard at all.
- **The whole `supabase/functions/` tree is out of scope** — the scan set is
  `git ls-files app lib`. The edge-function service clients and their query
  chains are covered by review and this document only (the repo-wide
  seeded-UUID sweep does reach them; nothing else does).
- **Nested embeds are not parsed** — `.select()` strings are opaque to the
  guard, so the rule that an embed is safe only when its parent is filtered
  is unenforced.
- **The pinned cross-org assertions are substring counts, not reachability
  analysis** — and two further assertions are unpinned entirely
  (`app/api/family-invites/claim/route.ts`,
  `app/api/household/link-member/route.ts`): they can be deleted without
  failing CI.

## Phase 3 status (CWA-10 / #212)

`org_id` is now the database-enforced boundary for anon/authenticated roles
(see [`tenancy-model.md`](tenancy-model.md)) — but service-role clients
carry `BYPASSRLS`, so every site below needed its own per-site mitigation.
With this pass both tables are closed; storage writes/deletes were closed
by CWA-57 / #328 (org-partitioned `storage.objects` policies — see
tenancy-model.md "Storage tenancy"), and storage reads by CWA-59 / #333
(private buckets + signed URLs, the revisit ADR-3 tracked).

One service-key user lives outside the "App routes and pages" and
"Lib helpers" tables by design — the one-time storage re-key operator
script; see the "Operator scripts" section below.

Every app-code site below now derives `org_id` from an anchor it has already
validated — the calendar subscription-token row, the HMAC-signed link's
group row, the family-invite row, the caller's own RLS-scoped profile, or
`app_request_org_id()` resolved through the cookie-bound request client —
and filters every subsequent service-role query on that value. The interim
default-org UUID constant is deleted from `lib/org.ts`.

`app_request_org_id()` is the anchor for the two anonymous entry points, the
join form and `app/join/family/[token]/page.tsx`. It returns a signed-in
caller's own org and ignores `x-two42-org`; only a genuinely anonymous
request resolves the header's slug, and only to a real `organizations` row.
It is the same value the `access_requests` RLS `WITH CHECK` evaluates, so
the two cannot drift. Both sites fail closed on both failure modes — an RPC
error and a NULL result (a slug matching no organization row) are each
logged, then the family-invite page redirects to `/join` and the join form
renders a "Join requests unavailable" notice instead of a form whose every
submission would die on a bare `42501`. Neither falls back to an org.
Since Phase 4b (CWA-48 / #314) that fail-closed resolution is the single
`resolveRequestOrgId()` in `lib/org.ts` — the RPC call, the NULL narrowing,
and the dual fail-closed logging live in one place. The public per-org route
`app/[orgSlug]/join` uses the same helper (with the URL slug overriding the
`x-two42-org` header on both the request and browser clients) and adds
**no** service-role client, so it needs no row in the tables below.

One lookup is deliberately unscoped: the initial `signup_token` read in
`app/api/auth/consume-token/route.ts` and `app/api/auth/verify-token/route.ts`,
where the token row is what resolves the org. Both fail closed if it yields
no row or a NULL `org_id`, and every subsequent operation is scoped to the
resolved row's `org_id`.

Two deliberate behaviour changes shipped with this pass:

- `feed.ics` gained the owner role re-check `events/[id]/ics` already had —
  a token whose owning profile is `pending` or deleted now returns `401`
  instead of a full event list.
- `family-invites/claim`: the scoped `profiles` update returning zero rows
  is now a real `500 Failed to link profile to family` instead of a silent
  success.

The two Edge Function sites were closed by the parallel edge-function
stream (Phase 3, #212 — see the table below).

What earlier phases already closed on this surface:

- `getServingLinkMode()` (`lib/serving/config.ts`) requires an `orgId` and
  filters `site_settings` on it (Phase 2) — the key-only read errored
  outright at two orgs. All four call sites derive the org from the
  validated group row. The last copy of the bug class, `resolveCanSign` in
  `supabase/functions/send-serving-reminders/index.ts`, was closed in
  Phase 3 (#212): it now takes an `orgId`, filters `site_settings` on it,
  and throws on query error instead of silently degrading links to unsigned.
- `app/api/serving/link-action/route.ts` derives `org_id` for its inserts
  from the HMAC-validated group row instead of the hardcoded default-org
  constant; the composite `(group_id, org_id)` FK enforces the pairing.
- The DB-layer analogue, `giving_stewards_can_manage()`, is org-scoped in
  the schema itself.

## Phase 4a status (CWA-11 / #213, stream 1/2)

The `/platform` operator surface introduces a new anchor class:
**platform-admin authority**. Every `/platform` site below gates on
`getPlatformAdmin()` / `requirePlatformAdmin()` (`lib/platform-access.ts`),
resolved through the cookie-bound request client — `is_platform_admin()` is
SECURITY DEFINER over `platform_admins` keyed on `auth.uid()`, and an RPC
error denies. A platform admin's authority is **cross-org by design**, so
these sites read `organizations` (the tenant root, no `org_id`) unfiltered
or by `.eq("id", id)`; that is the point of the surface, not a leak. The one
org-owned table touched (`access_requests`) is always filtered
`.eq("org_id", id)` — on a BYPASSRLS client that filter IS the tenant
boundary. The restrictive RLS floor gains no platform-admin escape hatch;
the cross-org reach lives only in these app-layer sites.

## Serving signup RPC — a definer-function bypass surface (CWA-47 / #313)

The serving signup insert pair (`serving_signups` + `serving_signup_attendees`)
is written by a `SECURITY DEFINER` function pair
(`20260803010000_serving_signup_rpc.sql`), not by direct PostgREST inserts —
the compensating-delete pattern it replaced could orphan a signup row and
wedge that Sunday behind `unique (group_id, service_date)`:

- `serving_signup_apply(_group_id, _service_date, _actor_id, _attendee_ids)`
  — the atomic core. EXECUTE: `service_role` only (the signed-link route
  passes its HMAC-validated profile id as the actor).
- `serving_signup_create(_group_id, _service_date, _attendee_ids)` — the
  authenticated entry point; actor from `auth.uid()`, group org pinned
  against `app_request_org_id()`, RLS INSERT-policy arms re-checked.
  EXECUTE: `authenticated` + `service_role`. No `anon` grant on either —
  the signed-link routes run server-side on the service-role client.

`SECURITY DEFINER` bypasses RLS, so **the org resolution and equality checks
in the function bodies are the tenant boundary; no lint sees them.**
`schema_tenancy_lint.sql` check 4 only proves the source mentions `org_id`;
the resolution order (org from the `member_groups` row, never a caller
parameter; every other row asserted to carry it) is review-enforced. The
grant matrix and the org checks are pinned by
`supabase/tests/serving_signup_rpc_suite.sql`.

## Email quota RPC — a definer-function bypass surface (CWA-72 / #365)

The per-org daily send cap (`org_email_usage` + `org_email_limits`) is
enforced by a `SECURITY DEFINER` function
(`20260825000000_org_email_send_caps.sql`), because count-then-send races
under concurrent fan-outs — the reserve must be one atomic
`INSERT … ON CONFLICT … DO UPDATE … WHERE` statement:

- `email_quota_consume(_org_id, _n)` — reserves `_n` sends against the org's
  daily cap, returning `false` on refusal. EXECUTE: `service_role` only. The
  org-never-from-a-caller-parameter rule is resolved the
  `serving_signup_apply` way: with no `anon`/`authenticated` grant, the only
  callers are server-side paths that already hold an `orgId` from an anchor
  they validated (the caller's RLS-scoped profile, the RLS-checked group
  row, `listActiveOrgs()`'s own enumeration).

Both tables are **service-role-only in v1**: restrictive isolation policy,
no permissive policy, ALL privileges revoked from `anon`/`authenticated`.
The grant matrix and the cap boundaries are pinned by
`supabase/tests/org_email_quota_suite.sql`.

**Guard blind spot, stated deliberately:**
`scripts/check-service-role-org-scope.mjs` walks `.from()` chains only, so
the `.rpc("email_quota_consume", …)` calls in `lib/email/quota.ts` and both
reminder edge functions are invisible to it. The compensating controls are
the `service_role`-only grant (a browser can never reach the RPC), the
pgTAP grant matrix, and the unit suites on both sides of the
`lib/` ⇄ `supabase/functions/_shared/` mirror.

## Email domain claim RPC — a definer-function bypass surface

The platform-wide cap on claimed custom sending domains (`ORG_EMAIL_DOMAIN_CAP`,
`lib/email/domainCap.ts`) is enforced by a `SECURITY DEFINER` function
(`20260908000001_email_domain_claim_rpc.sql`), because a count-then-insert in
the route races across tenants: the unique-per-org index only serializes
claims from the *same* org, so two orgs claiming at once could each observe a
free slot and each create a Resend domain. The function takes a platform-wide
transaction-scoped advisory lock, re-checks `custom_email_domain_enabled`,
counts every org's rows, and inserts — one transaction.

- `org_email_domain_claim(_org_id, _domain, _cap)` — inserts the org's row and
  returns it, or raises `ED001` (unknown org), `ED002` (custom domains not
  enabled), `ED003` (cap reached), or `23505` (the org already holds a row).
  EXECUTE: `service_role` only, the `email_quota_consume` way: with no
  `anon`/`authenticated` grant, the only caller is `POST
  /api/admin/email-domain`, which passes the `orgId` from `requireOrgAdmin()`'s
  RLS-scoped profile.

**Guard blind spot, stated deliberately:** the `.rpc("org_email_domain_claim",
…)` call is invisible to `scripts/check-service-role-org-scope.mjs`. The
compensating controls are the `service_role`-only grant, the grant-matrix and
behaviour assertions in `supabase/tests/org_email_domains_suite.sql`, and the
route's unit suite.

## App routes and pages (23 sites)

| File | Why service-role is used | Org derived from | Scoped queries |
|------|--------------------------|------------------|----------------|
| `app/platform/page.tsx` | Platform overview counts every org across tenants; RLS pins a request to one org | Platform-admin authority: `getPlatformAdmin()` via the cookie-bound request client; cross-org by design, confined to `organizations` (tenant root) | `organizations` (id, status — deliberately unfiltered) |
| `app/platform/organizations/page.tsx` | Org list across tenants — the surface's purpose | Platform-admin authority (as above); confined to `organizations` (tenant root) | `organizations` (deliberately unfiltered list) |
| `app/platform/organizations/[id]/page.tsx` | Org detail + founding-admin request + email cap/usage (CWA-72) + the org's sending-domain row (for the custom-domain gate and stuck-cleanup cards); all invisible to the caller's own-org RLS (the cap tables have no permissive policy at all; the domain row is scoped to the org's own admins) | Platform-admin authority; org id from the route param | `organizations` `.eq("id", id)` (now also reads `custom_email_domain_enabled`); `access_requests` `.eq("org_id", id).eq("approved_role", "admin")`; `org_email_limits` `.eq("org_id", id)`; `org_email_usage` `.eq("org_id", id).eq("usage_date", today)`; `org_email_domains` `.eq("org_id", id)` |
| `app/api/platform/organizations/route.ts` | `provision_organization()` is EXECUTE-granted to `service_role` only | Platform-admin authority; the RPC creates the org and derives everything from it transactionally | `rpc("provision_organization")` only |
| `app/api/platform/organizations/[id]/route.ts` | Status/branding/`custom_email_domain_enabled` writes on the tenant root, which has no org-admin write policy (the custom-domain flag is platform-operator-only by design: no grant to the org's own admin, this route is its sole write path) | Platform-admin authority; org id from the route param | `organizations` read + update `.eq("id", id)` (branding merged, never replaced) |
| `app/api/platform/organizations/[id]/invite-owner/route.ts` | Mints the founding admin's `signup_token`; the platform admin's own-org RLS could never reach the new org's request row | Platform-admin authority; org id from the route param | `access_requests` update `.eq("org_id", id).eq("approved_role", "admin").eq("email", ownerEmail)`; rollback update on the same filters + minted token; email branding via `resolveEmailBranding(id)` |
| `app/serving/go/page.tsx` | Unauthenticated, HMAC-signed serving link; no session exists to satisfy RLS | HMAC-validated `member_groups` row; link rejected when `profiles.org_id` disagrees | `serving_team_settings`, `profile_groups`, `serving_signups`, `profiles` (spouse), `family_units` (label) |
| `app/serving/[groupId]/page.tsx` | Surfaces pending (never-logged-in) spouse profiles that RLS hides from the caller | Caller's own RLS-scoped profile | `profiles` (spouse lookup) |
| `app/join/family/[token]/page.tsx` | Signed family-invite link resolved before login; no session | `app_request_org_id()` via the cookie-bound request client (`x-two42-org` header for anonymous visitors, own org for signed-in ones); invite lookup filtered on it | `family_invites` |
| `app/api/serving/signups/route.ts` | Post-delete notification email lookups for affected members | The deleted signup row's own `org_id` (authorised by the RLS-checked delete) | `profile_groups` (leaders), `family_units` (label) |
| `app/api/serving/link-action/route.ts` | Same HMAC signed-link pattern as `serving/go`; no session | HMAC-validated `member_groups` row; link rejected when `profiles.org_id` disagrees | `serving_team_settings`, `profile_groups`, `serving_signups` (read/delete — cancel path), `rpc(serving_signup_apply)` (the signup + attendee insert pair, one transaction; the function re-derives the org from the `member_groups` row and enforces it internally — CWA-47 / #313), `profiles` (spouse), `family_units` (label) |
| `app/api/serving/broadcast/route.ts` | Fans out email to all group members regardless of caller's RLS visibility | RLS-scoped `member_groups` row | `profile_groups` (recipients) |
| `app/api/calendar/feed.ics/route.ts` | Bearer-token calendar subscription; no session | `calendar_subscription_tokens` row (`org_id` stamped at issuance); owner role re-checked | `events`, `serving_signups`, `profiles` (owner), token expiry update |
| `app/api/auth/consume-token/route.ts` | Pre-login token flow; no session yet | The resolved `access_requests` row (`signup_token` is globally UNIQUE today — scoping is correctness-under-change) | `access_requests` update on `(id, org_id)` |
| `app/api/auth/verify-token/route.ts` | Pre-login token flow; no session yet | The `access_requests` token row itself (`org_id` selected and required non-null) | Token row is the anchor; `handle_new_user()` reads the same row |
| `app/api/feedback/route.ts` | Rate-limit count and admin email fan-out (RLS exposes feedback only to admins) | Caller's own RLS-scoped profile | `feedback` (count), `profiles` (admin recipients — was a latent cross-tenant email leak; a correctness-under-change risk, not a live one at single-org scale) |
| `app/api/household/link-member/route.ts` | Household manager updating another profile's `family_id` (RLS blocks cross-profile writes) | Caller's own RLS-scoped profile; target's org asserted equal | `profiles` update on `(id, org_id, family_id IS NULL)` |
| `app/api/events/[id]/ics/route.ts` | Bearer-token calendar subscription; no session | `calendar_subscription_tokens` row (`org_id` stamped at issuance) | `events` (404 on cross-org id), `profiles` (owner), token expiry update |
| `app/api/family-invites/claim/route.ts` | New user claiming an invite while their role is still `pending` | The `family_invites` row; caller's profile org must match (403 otherwise) | `profiles`, `family_members`, `family_invites` updates all on the invite's `org_id` |
| `app/api/admin/email-domain/route.ts` | GET reads `organizations.custom_email_domain_enabled`, a platform-operator column the admin's own client has no SELECT grant on (the row itself is read on the request client). POST gates on that flag, then claims the row through `org_email_domain_claim()` — the `service_role`-only RPC (see the "Email domain claim RPC" section above) that enforces the platform-wide domain cap atomically, so the route no longer holds an unscoped count read — then Resend `domains.create` returns `resend_domain_id`/`status`/`dns_records`, columns the admin's own client has no UPDATE grant on — the write must happen server-side (CWA-70 / #363); when the follow-up write fails and the Resend removal also fails, the row is kept as `status = 'cleanup_pending'` (server-set-only columns again) rather than deleted. DELETE now removes the Resend domain first and needs the same server-set-only writes when that fails | The caller's own RLS-scoped `profiles.org_id`, read on the request client; the `organizations` reads take `.eq("id", orgId)` (tenant root); the insert carries that `org_id` in its payload, and every subsequent read/write is predicate-scoped `.eq("org_id", orgId)` / `.eq("id", ...).eq("org_id", orgId)` | `organizations` `.eq("id", orgId)` (flag); `org_email_domains` existing-row select `.eq("org_id", orgId)`, unscoped head count (org-anchor), insert (payload: `org_id`, `domain`), update (`resend_domain_id`, `status`, `dns_records`, `cleanup_failed_at`) and rollback/remove deletes on `(id, org_id)` |
| `app/api/admin/email-domain/verify/route.ts` | POST handler: the `status`/`verified_at`/`last_checked_at` transition must not be writable by the admin's own client (same column grants as above) | The caller's own RLS-scoped `profiles.org_id`, read on the request client; target row fetched `.eq("org_id", orgId)` before any write | `org_email_domains` select `.eq("org_id", orgId)` + update on `(id, org_id)` |
| `app/api/platform/organizations/[id]/email-cap/route.ts` | Daily email cap override (CWA-72): `org_email_limits` is platform-operator-owned with no permissive policy, so only a service-role write can reach it — an org that can raise its own cap does not have a cap | Platform-admin authority; org id from the route param, validated against an existing `organizations` row before the write | `organizations` `.eq("id", id)` (existence check); `org_email_limits` upsert carrying the validated `org_id`, zero-row-checked |
| `app/api/platform/organizations/[id]/email-domain-cleanup/route.ts` | Platform-admin retry of a stuck Resend domain removal: the org's `org_email_domains` row is scoped to that org's own admins, so a platform operator finishing the cleanup from `/platform` needs the service client for both the read and the delete; the row's `cleanup_failed_at` is a server-set-only column besides | Platform-admin authority; org id from the route param, validated against an existing `organizations` row before any `org_email_domains` access | `organizations` `.eq("id", id)` (existence check); `org_email_domains` select `.eq("org_id", org.id)` (must be `cleanup_pending` with a `resend_domain_id`), update on `(id, org_id)` on a failed retry, delete on `(id, org_id)` zero-row-checked after Resend confirms removal |

## Lib helpers (2 sites)

Unlike the rows above — inherited from Phase 2 with their mitigations still
outstanding — this site was introduced *during* Phase 3 with its mitigation
already shipped. The "once org_id lands" framing does not apply; the risk
column below describes what a regression would cost, not a pending work item.

| File | Why service-role is used | Tenancy risk | Mitigation |
|------|--------------------------|--------------|------------|
| `lib/email/identity.ts` | `resolveEmailBranding(orgId)` reads `organizations.branding` for callers that hold an explicit org id but no request-scoped session (e.g. `lib/serving/server.ts`, invoked from HMAC-signed link flows), and a second, org-scoped read of `org_email_domains` (Phase 5 PR 7 / CWA-71) to resolve the per-org `From:` address — on both this path and the self-resolving (no-`orgId`) path, where the org id is instead resolved via `resolveRequestOrgId()` on the cookie-bound request client before the same service-role `org_email_domains` read runs | A missing filter on either table would leak another org's branding or sending domain into an email | The `organizations` read's `.eq("id", orgId)` and the `org_email_domains` read's `.eq("org_id", orgId)` are the only tenant boundaries, both mandatory; `orgId` is always either the caller's already-authorized id or the value `resolveRequestOrgId()` resolves for the current request — never a header, never a body field. `SENDING_DOMAIN` additionally gates the stored domain value itself (with `status = 'verified'`) before it can reach a `From:` header — see CLAUDE.md's injection-boundary list. Branding without an `orgId` still comes from the request-scoped client, so RLS applies — but that resolves to the *request* org, which is host-independent until Phase 5, so any caller holding an authorized `org_id` must pass it. |

| `lib/email/quota.ts` | `reserveEmailQuota(orgId, n)` calls `email_quota_consume()` — a `service_role`-only RPC (see the "Email quota RPC" section above), so the service client is the only client that can execute it | The `.rpc()` call is invisible to the guard (it walks `.from()` chains only), so a refactor could silently pass an unvalidated org id | `orgId` must come from an anchor the caller already validated — the caller's RLS-scoped profile (`app/api/feedback`), the RLS-checked group row (`app/api/serving/broadcast`), or the already-authorized `opts.orgId` both `notifyLeadersOfCancel` callers hold — never a header or body field. Fail-closed: any RPC error or throw is a refusal, never "send anyway" |

`lib/branding.ts` is deliberately **not** a service-role site: `getOrgBranding()`
uses the request-scoped `createClient()`, so RLS narrows `organizations` to the
request org and no `.eq()` filter is needed. That contrast is exactly why
`lib/email/identity.ts` above — which *does* use the service client — must
carry `.eq("id", orgId)`.

## Edge Functions (2 sites)

Both are cron-triggered with no session context and resolve the service key
from configured environment variables: a manual `SUPABASE_SECRET_KEY` override
(local/self-host only — the hosted platform reserves the prefix), then the
platform-injected `SUPABASE_SECRET_KEYS` map, then the legacy
`SUPABASE_SERVICE_ROLE_KEY` (see `resolveServiceKey()` in
`supabase/functions/_shared/service-key.ts`, shared by both), not
`createServiceClient()`.

Tenant iteration is `listActiveOrgs()` + `forEachOrg()`
(`supabase/functions/_shared/orgs.ts`). `listActiveOrgs()` filters
`organizations` on `.eq("status", "active")`, so a **suspended org is
skipped** — a suspended tenant must not email its members. This is currently
the only place `organizations.status` changes what happens *to a tenant*: it
gates no access path and no org helper consults it, so suspending an org
stops its reminder email and nothing else. The platform surfaces in the
table above do read and write the column — `app/platform/page.tsx` and
`app/platform/organizations/**` display it, and the platform org route sets
it — but that is the operator UI reporting and editing the flag, not the
flag enforcing anything (see
[`tenancy-model.md`](tenancy-model.md), Known limits).

Audit result (CWA-58): all 12 org-owned query chains across both entry
points carry an explicit `org_id` predicate (or an explicit `org_id` on
insert); the two nested embeds are FK traversals from org-filtered parents,
which the composite `(col, org_id)` FKs keep inside the tenant; the one
`organizations` read is the tenant root, filtered on `status`.

Both entry points additionally call `email_quota_consume()` per team/event
batch via `_shared/quota.ts` (CWA-72), passing the org id from the
`forEachOrg()` iteration — the same already-enumerated anchor every other
query in the loop uses. `.rpc()` calls are outside
`check-service-role-org-scope.mjs`'s reach *and* `supabase/functions/` is
outside its scan set entirely, so these calls are covered by review and by
`deno test` (`supabase/functions/tests/quota_test.ts`) only.

| File | Why service-role is used | Historical tenancy risk | Mitigation |
|------|--------------------------|-------------------------|------------|
| `supabase/functions/send-event-reminders/index.ts` | Cron job; reads events/RSVPs and emails attendees with no user session | Reminder fan-out iterates all rows across orgs | **Implemented (Phase 3, #212):** iterates active orgs via `_shared/orgs.ts`, every query filtered on `org_id`, per-org failures isolated so one org cannot suppress another's send. **Branding (CWA-56, #322):** `organizations.branding` rides along on the already-org-anchored `listActiveOrgs()` select — no new service-role call site, no new unscoped query — and is validated by `_shared/branding.ts` (a mirror of `lib/branding.ts` + `lib/email/identity.ts`) before reaching any CSS or RFC 5322 sink |
| `supabase/functions/send-serving-reminders/index.ts` | Cron job; reads serving signups and emails assignees with no user session | Same as `send-event-reminders` | **Implemented (Phase 3, #212):** same per-org iteration and `org_id` filters; `resolveCanSign` org-scoped; `serving_broadcasts` audit rows stamped with the processed row's org, not a constant. **Branding (CWA-56, #322):** same `listActiveOrgs()` ride-along, validated by `_shared/branding.ts`. **Per-team isolation (CWA-50, #316):** a failing team is recorded in the run summary's `failedItems[]` keyed by `group_id` — ids, never org-defined team names, in operator diagnostics |

## Operator scripts (1 site)

Not app code: this runs from an operator's shell, once per environment, in no
request path. It reads the service key straight from `process.env`
(`SUPABASE_SECRET_KEY`, falling back to `SUPABASE_SERVICE_ROLE_KEY`) rather
than through `createServiceClient()` or `resolveServiceKey()` — a third
service-key entry point, and the reason `npm run guard:tenancy` cannot see
it. Like "Edge Functions", this section is prose-and-table only: the guard
parses the "App routes and pages" and "Lib helpers" sections and cross-checks
each of their rows against a real `createServiceClient()` call site, so a row
for a `scripts/` file there would *fail* the guard.

(Section headings are referenced here by name, never as literal `##` markdown
— the guard locates a section with a plain `indexOf`, so an inline `##` in
prose above the real heading silently becomes the section it parses.)

| File | Why service-role is used | Tenancy risk | Mitigation |
|------|--------------------------|--------------|------------|
| `scripts/rekey-storage-objects.mjs` | One-time re-key of pre-CWA-57 storage objects onto `<org_id>/<kind>/<entity_id>/<file>`. A legacy un-prefixed key is unreachable by every RLS-constrained **mutation** — its first path segment is not an org id, so the new restrictive floor on `storage.objects` matches no row for it and no `anon`/`authenticated` principal can move or delete it. That was write-only exposure while the buckets were public (the object kept serving on `/object/public/*`, which bypassed RLS — the state this script runs in, since it is a precondition for the CWA-59 / #333 private-bucket deploy); post-CWA-59 the same un-moved key is unreadable to every anon/authenticated application caller too (service-role access still reaches it — that is what this script uses), which is what makes skipping this script a user-visible outage rather than a deferred cleanup. Moving it needs the service role either way | Un-scoped URL-column updates (`profiles.avatar_url`, `family_units.photo_url`, `family_members.avatar_url`) would rewrite another org's rows; a wrong org prefix would move objects *into* a tenant they do not belong to | The org id **is** operator input — legacy keys carry no org marker, so nothing in the data can identify the tenant and `--org <uuid>` is how it is named. What is guaranteed is that the value is never trusted as given: it must parse as a UUID and match a real `organizations` row or the script exits before touching anything, and with more than one org present the flag is mandatory rather than defaulted, so the script never guesses a tenant. Every URL update carries `.eq("org_id", orgId)` alongside `.eq("id", …)`. A pre-flight check aborts before any mutation if the app's stored URL base disagrees with this process's `SUPABASE_URL`; destination collisions and un-updated URL rows are collected and force a non-zero exit rather than reading as success. Classification is unit-tested (`scripts/rekeyPlan.test.mjs`) |
