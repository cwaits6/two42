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

- Every service-role query chain in `app/` and `lib/` — `.from()` and
  `.rpc()` alike — must carry an `org_id` predicate (Tier B), unless it is a
  documented org anchor — marked in code with a reasoned
  `// org-anchor: <why>` comment. Every anchor chain in the tables below
  carries that marker in-file; the script has no allowlist.
- The email fan-out chains (feedback admins, serving broadcast, leader cancel
  notices) are Tier A: they must be scoped and may **not** use the marker —
  an `// org-anchor:` on a fan-out is itself a failure. These surfaces push
  one org's data to third parties and email cannot be recalled.
- Exported `lib/` helpers taking a `SupabaseClient` parameter must scope the
  chains rooted at it (Tier C — a helper that *can* receive a service client
  must scope unconditionally). No module is exempt.
- Every chain under `supabase/functions/` (entry points and `_shared/`) must
  carry an explicit `org_id` predicate, an explicit `org_id` on insert, or an
  `org_id`/`_org_id` RPC argument, or a reasoned marker; only the
  `organizations` tenant root is exempt.
- **This file itself is kept in sync**: every `app/`/`lib/` file calling
  `createServiceClient()` must have a row in the tables below, every row must
  name a real call site, and the site counts in the two section headings must
  match reality. The bold rule above is now machine-enforced.

The guard is static and syntax-only; it proves a predicate is *present*, not
that its value is correctly derived. The "Org derived from" column below —
the validated-anchor provenance — remains a review responsibility. What it
does and does not see, stated precisely:

- **`.rpc()` calls are inspected** the same way as `.from()` chains: an
  `org_id`/`_org_id` argument property is the predicate, and a call without
  one needs a reasoned marker (`provision_organization()` in
  `app/api/platform/organizations/route.ts` and `serving_signup_apply()` in
  `app/api/serving/link-action/route.ts` carry one). Whether the argument's
  value is the right org is still review.
- **`supabase/functions/` is scanned**, with every chain collected regardless
  of its root. Neither the value bound by `forEachOrg()` nor the
  correctness of the tenant iteration itself is proved — only that each
  chain names `org_id`.
- **Nested embeds are explicitly asserted on the parent** — a chain whose
  `.select()` embeds a relation and carries no org predicate or marker fails
  with a message naming the embed. This is a heuristic on the select string,
  not a PostgREST parser, and it sharpens the message rather than adding a
  second gate: a scoped parent passes as before.
- **The pinned cross-org assertions are substring counts, not reachability
  analysis.** All four hand-written checks are pinned (the two signed-link
  surfaces, `app/api/family-invites/claim/route.ts`,
  `app/api/household/link-member/route.ts`); the pin proves the comparison
  and its denial log exist, not that the code path is reached.

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

`app_request_org_id()` resolves the calling principal's org and nothing
else: it is NULL for an anonymous request, whatever headers it carries. No
anonymous surface resolves an org through it any more; the slug join page
that did is retired. Its two app-layer callers — `lib/uploadImage.ts` and
`lib/email/identity.ts`, through the single fail-closed
`resolveRequestOrgId()` in `lib/org.ts` — run with a session, and both fail
closed on an RPC error and on a NULL result (logged each time) rather than
fall back to an org.

**Anonymous entry points are token rows**, each read on the service client
under an `// org-anchor:` marker and each the org anchor for everything that
follows: `/setup-account` (the `access_requests.signup_token` row, via
`verify-token` / `consume-token`), `/join/family/[token]` (the
`family_invites` row, and its request route below), `/serving/go` (the
HMAC-validated `teams` row) and `/join/[token]` (the `group_invites` row).
Every one of them fails closed on both failure modes — a lookup error and no
row each take the page's generic invalid path, never a fallback org.

Those initial lookups are deliberately unscoped: the `signup_token` read in
`app/api/auth/consume-token/route.ts` and `app/api/auth/verify-token/route.ts`,
the `family_invites` read in `app/join/family/[token]/page.tsx` and
`app/api/family-invites/request/route.ts`, and the `group_invites` read in
`app/join/[token]/page.tsx`, where the token row is what resolves the org.
Each fails closed if it yields no row, and every subsequent operation is
scoped to the resolved row's `org_id`.

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

- `getServingLinkMode()` (`lib/serving/config.ts`) requires an `orgId` and a
  `groupId` and filters `group_settings` on both (Phase 2 closed the
  key-only read that errored outright at two orgs; the setting is per group
  now). All four call sites derive both ids from the validated team row. The
  edge-function copy, `resolveGroupLinkMode()` in
  `supabase/functions/_shared/groups.ts`, takes the same two ids and throws
  on query error instead of silently degrading links to unsigned.
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
the resolution order (org from the `teams` row, never a caller
parameter; every other row asserted to carry it) is review-enforced. The
grant matrix and the org checks are pinned by
`supabase/tests/serving_signup_rpc_suite.sql`.

## Group membership helpers — SECURITY DEFINER (`is_group_member`, `is_group_leader`, `is_team_lead`)

The group model (`20260926000000_group_model_foundation.sql`) introduces the
first within-org visibility boundary: rows on `groups`, `group_members`,
`group_labels` and `group_member_labels` are readable by members of that
group and writable by its leaders (org admins pass every arm). The RLS
policies resolve membership through three `SECURITY DEFINER` helpers, each
`STABLE`, `set search_path = ''`, and resolving the caller from `auth.uid()`
**only** — the id argument names the group or team, never the principal:

- `is_group_member(_group_id)` — a `group_members` row for `auth.uid()` in
  the given group.
- `is_group_leader(_group_id)` — the same row with `role = 'leader'`. This
  replaces the pre-group-model helper of the same name, which had team-lead
  semantics; that helper lives on as `is_team_lead`.
- `is_team_lead(_team_id)` — a `team_members` row for `auth.uid()` on the
  given team with `is_leader = true`. The seven serving policies
  (`serving_signups` create/delete, `serving_signup_attendees` remove,
  `serving_broadcasts` view/log, `serving_team_settings` insert/update) and
  `serving_signup_create()` call it.

Every body carries `org_id = public.app_current_org_id()`, so a membership
row in another org never counts — `schema_tenancy_lint.sql` check 4 sees
that predicate; the org equality itself is what keeps a caller-supplied id
from resolving another tenant's row. EXECUTE: revoked from `public` and
`anon`, granted to `authenticated` (the policies that call them are all
`to authenticated`).

`group_model_backfill()` — the one-group-per-org data migration — is
deliberately **not** `SECURITY DEFINER` and has no client grant (EXECUTE
revoked from `public`, `anon`, `authenticated` and `service_role`): it
exists as a function only so `supabase/tests/group_model_suite.sql` can run
the same logic the migration ran against fixture orgs. It is idempotent
and asserts its own enrolment and leader counts. Grants, org checks and the
within-org boundary are pinned by that suite and by `idor_suite.sql`.

`group_content_backfill()` (`20261017000000_group_scoped_content.sql`) is
its content-layer twin, with the same shape: plain `plpgsql`, no client
grant, idempotent. It gives every ungrouped content row to its org's oldest
group, folds each group's calendars into one (events re-pointed, extras
deleted, counts asserted), creates a calendar for a group without one, and
moves the org-level call and link-mode settings onto `group_settings`.
`supabase/tests/group_scope_suite.sql` runs it against fixture groups and
pins the fold, the NOT NULL and composite FKs, the policy shapes and the
member / leader / org-admin read and write matrix.

The content policies themselves gate on `is_group_member(group_id)` /
`is_group_leader(group_id)` — see "Group visibility" in
[`tenancy-model.md`](tenancy-model.md). `giving_can_manage_fund(_fund_id)`
now resolves the fund's group and admits its leaders or (when stewards may
manage) its steward; the org admin arm is gone from it, as from every
content policy.

The people layer's directory boundary
(`20261018000000_directory_visibility.sql`) adds three read-only helpers
of the same shape — `SECURITY DEFINER`, `STABLE`, `set search_path = ''`,
caller resolved from `auth.uid()` only, EXECUTE revoked from `public` and
`anon` and granted to `authenticated`:

- `org_directory_visible()` — the caller's own `organizations` row has
  `directory_visibility = 'org'`. Reads only the tenant root, pinned by
  `id = app_current_org_id()`; zero arguments, so it is InitPlan-hoisted.
- `shares_group_with(_profile_id)` — the caller and the given profile share
  a `group_members` group in the caller's org.
- `shares_group_with_household(_family_id)` — the caller shares a group
  with any profile in the given household, in the caller's org.

Every `group_members` read in them carries `org_id =
public.app_current_org_id()`. They are called by the `profiles`,
`family_units` and `family_members` SELECT policies — see "Directory
visibility" in [`tenancy-model.md`](tenancy-model.md). None writes.

`handle_new_user()` (the auth signup trigger, `SECURITY DEFINER`) now also
writes `group_members`: when the org it already resolved from the approved
access request has exactly one group, the new non-pending profile is
enrolled in it as a member. The org comes from the same server-owned rows
as before, never from the caller, and every inserted column carries it.
`supabase/tests/directory_visibility_suite.sql` pins the one-group, the
several-groups and the family-invite (pending) cases.

## Group creation RPCs — a definer-function bypass surface

Self-serve group creation (`20261025000000_group_creation.sql`) writes a
group, its leader's `group_members` row and its one `event_calendars` row
through a `SECURITY DEFINER` pair over a shared core, because the browser
has no transaction across three PostgREST statements and a failure between
them would leave a leaderless group nobody can reach:

- `group_create(_name, _description, _leader_id)` — the member- and
  admin-facing entry point. Tenant anchor: the caller's own `profiles` row
  (`auth.uid()`, not pending) resolves the org **and** the role; no
  parameter names an org. A non-admin may lead the group only themselves
  (`GC005`) and only while the org's `group_creation_policy` is `'open'`
  (`GC001`); an org admin may name any approved member of their org.
  EXECUTE: `authenticated` only.
- `group_request_approve(_request_id)` — turns a pending `group_requests`
  row into a group led by its requester. Tenant anchor: the caller's own
  `profiles` row, which must be an org admin (`GC005`); the request is
  selected by id **and** that org with `for update`, so a foreign id and a
  missing one are the same `GC004`. EXECUTE: `authenticated` only.
- `group_create_for(_org, _name, _description, _leader, _created_by)` — the
  plain plpgsql core (not `SECURITY DEFINER`; it inherits the callers'
  bypass). Asserts the leader is an approved member of `_org` (`GC003`)
  before writing, and every inserted row carries `_org`. EXECUTE revoked
  from `public`, `anon`, `authenticated` **and** `service_role`: it is
  reachable only through the two entry points.
- `org_group_creation_policy()` — the zero-argument reader the
  `group_requests` INSERT policy uses; the caller's own org row only.
  EXECUTE: `authenticated`.

`SECURITY DEFINER` bypasses RLS, so **the org resolution and the
assertions in the function bodies are the tenant boundary; no lint sees
them.** `schema_tenancy_lint.sql` check 4 only proves the bodies mention
`org_id`. The browser-side `.rpc()` calls (`CreateGroupDialog`,
`PendingGroupRequests`) run on the cookie-bound client and are not
service-rooted, so the guard has nothing to check there; the grant matrix,
every mode, the approve path and the cross-org floor are pinned by
`supabase/tests/group_creation_suite.sql`. Decline is a plain UPDATE under
the `group_requests` policies, zero-row-checked in the UI. No service-role
client is involved anywhere in the feature.

## Group discovery and joining RPCs — a definer-function bypass surface

Group discovery (`20261026000000_group_discovery.sql`) lets a member find a
group they are not in and join it or ask to, which the `groups` SELECT
policy (members and admins only) cannot express without widening every
`groups` read in the app. The reads and writes go through four
`SECURITY DEFINER` entry points over an un-granted core instead; the
`groups` policy is unchanged.

- `discoverable_groups()` — the one list behind Find a group and
  Directory › Groups. Tenant anchor: the caller's own `profiles` row
  (`auth.uid()`, not pending), no parameter. Returns the caller's own
  groups always, other non-private groups while `organizations.group_discovery`
  is on, and private groups additionally for an org admin; every join in
  the body carries the group's `org_id`. Read-only. EXECUTE:
  `authenticated` only.
- `join_group(_group_id)` — the member-facing gate. Tenant anchor: the
  caller's own `profiles` row; the group is looked up by id **and** that
  org, the org switch must be on and the group not private (`GJ001` for a
  missing id, a foreign group, a private group and a switched-off org
  alike, so the response confirms nothing). Delegates to the core.
  EXECUTE: `authenticated` only.
- `join_group_apply(_group_id, _actor_id)` — the plain plpgsql core (not
  `SECURITY DEFINER`; it inherits the caller's bypass). Org from the
  `groups` row; asserts `_actor_id` is an approved member of that org
  (`GJ002`) and not already in the group (`GJ003`); under `open` inserts
  the `group_members` row and resolves any stale pending request with
  `reviewed_by = null`, under `approval` inserts the pending
  `group_join_requests` row. Every inserted row carries the group's
  `org_id`. EXECUTE revoked from `public`, `anon`, `authenticated` **and**
  `service_role`: reachable only through `join_group()` today. An
  invite-link wrapper that has validated its token may call it later and
  needs no further grant; if that wrapper runs on the service client it
  grants `service_role` EXECUTE on the core in its own migration.
- `pending_group_join_requests(_group_id)` — the leader's review list.
  Tenant anchor: the caller's own `profiles` row; rows only when the caller
  leads the group (`is_group_leader()`) or is an org admin (`is_admin()`),
  else empty. Returns id, created_at, first_name, last_name, preferred_name
  and email (NULL when the requester set `hide_email`) for pending
  requests only. Read-only. EXECUTE: `authenticated` only.
- `review_group_join_request(_request_id, _approve)` — approve or decline.
  Tenant anchor: the caller's own `profiles` row; the request is selected
  by id **and** that org with `for update`, and the caller must lead its
  group or be an org admin, so a foreign, missing, decided or
  not-permitted id is the same `GJ004`. Approve asserts the requester is
  still an approved member (`GJ002`), inserts the membership and stamps
  the row in one transaction. EXECUTE: `authenticated` only.

`group_join_requests` carries the restrictive isolation floor, one SELECT
policy (the requester, the group's leaders, org admins) and **no client
write grant** — table-level INSERT, UPDATE and DELETE are revoked from
`anon` and `authenticated`, so a direct write fails with `42501` instead
of matching zero rows; only the functions above write it. The org switch
and the two group flags are written by the cookie-bound client under the
existing `organizations` org-settings policy (column grants only; no new
policy) and the `groups` "Leaders and admins can update groups" policy,
zero-row-checked in the UI.

`SECURITY DEFINER` bypasses RLS, so **the org resolution and the
assertions in the function bodies are the tenant boundary; no lint sees
them.** `schema_tenancy_lint.sql` check 4 only proves the bodies mention
`org_id`. The browser-side `.rpc()` calls (`GroupJoinAction`,
`useDiscoverableGroups`, `PrivacyAndJoiningManager`) and the server-side
`getDiscoverableGroups()` run on the cookie-bound client and are not
service-rooted, so the guard has nothing to check there; the grant matrix,
the visibility rules, both join policies, who may review, the org switch
as a ceiling, every direct write path and the cross-org floor are pinned
by `supabase/tests/group_discovery_suite.sql`. No service-role client is
involved anywhere in the feature.

## Group invite RPCs — a definer-function bypass surface

Group invite links (`20261027000000_group_invites.sql`) let a leader or org
admin mint a link into one group that a stranger redeems before they have
any session, and that a signed-in member follows to join. Both redemptions
go through `SECURITY DEFINER` functions, so **the org resolution and the
assertions in their bodies are the tenant boundary; no lint sees them**.
`schema_tenancy_lint.sql` check 4 only proves the bodies mention `org_id`;
`supabase/tests/group_invites_suite.sql` pins the behaviour.

- `group_invite_redeem(_token, _name, _email, _signup_token, _token_expires_at)`
  — the new-person path. Tenant anchor: the `group_invites` row the token
  selects, locked `for update`, never a parameter; a signed-in caller is
  refused (`GI006`). It refuses a dead link (`GI001`: unknown, revoked,
  expired, used up — one code), bad input (`GI002`), an address that
  already has an account anywhere or an approved request or unclaimed
  family invite in another org (`GI003`, existence checks only — a setup
  link could never work for it), and an address an org admin denied in
  this org (`GI004`). It then writes the approved `access_requests` row
  (`reviewed_by` = the link's creator, `group_id`, `group_invite_id`, the
  minted `signup_token`) and one `group_invite_uses` row, both carrying the
  invite's `org_id`. A repeat submission by the same lower-cased address
  refreshes the token on the same request without a second use, so a lost
  email never burns a one-use link. EXECUTE: `service_role` only — the
  route holds the token it mailed; the browser never sees it.
- `group_invite_join(_token)` — the member path. Tenant anchor: the
  caller's own `profiles` row (`GI006` when none or pending); the invite
  row, locked `for update`, must carry that org (`GI001` for a foreign,
  missing, revoked, expired or used-up link alike). Already a member ⇒
  `already_member` and no use row. A private group admits at once (the
  link is the approval; `added_by` = the link's creator); otherwise it
  delegates to the un-granted `join_group_apply()` core, which applies the
  group's `join_policy` — `joined` or `requested`. One use row per person
  per link. EXECUTE: `authenticated` only — revoked from `service_role`,
  because the caller's own session is the anchor and a service caller has
  none.
- `handle_new_user()` — when the approved request that admits a signup
  names a `group_id`, the trigger enrols that group (its composite FK pins
  it to the signup's org) and stamps `profile_id` on the use row, ahead of
  the one-group fallback.

`group_invites` carries the restrictive isolation floor and three permissive
policies for the group's leaders and org admins — SELECT, INSERT
(`created_by` must be the caller, `revoked_at` null) and UPDATE confined by
column grant to `revoked_at`, whose `WITH CHECK` refuses to clear it again.
No DELETE policy and no DELETE privilege: links are the audit trail. `anon`
holds no privilege on either table. `group_invite_uses` has one SELECT
policy (the same readers) and no client write grant at all; only the
functions above and the trigger write it.

The app-side call sites: `app/api/join/[token]/route.ts` calls
`group_invite_redeem` on the service client under a marker (the function
resolves the org from the token; there is no `org_id` to pass) and scopes
its one rollback write on `(id, org_id)`; `app/join/[token]/JoinGroupButton.tsx`
calls `group_invite_join` on the browser client, which is not service-rooted;
`app/g/[groupId]/settings/invites/InviteLinksManager.tsx` reads and writes
`group_invites` on the browser client under the policies above.

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

**Guard coverage, stated precisely:**
`scripts/check-service-role-org-scope.mjs` checks the
`.rpc("email_quota_consume", …)` calls in `lib/email/quota.ts` and
`supabase/functions/_shared/quota.ts` for their `_org_id` argument; it does
not prove the value passed is the right org. The compensating controls are
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
  returns it, or raises `SD001` (unknown org), `SD002` (custom domains not
  enabled), `SD003` (cap reached), or `23505` (the org already holds a row).
  EXECUTE: `service_role` only, the `email_quota_consume` way: with no
  `anon`/`authenticated` grant, the only caller is `POST
  /api/admin/email-domain`, which passes the `orgId` from `requireOrgAdmin()`'s
  RLS-scoped profile.

**Guard coverage, stated precisely:** `scripts/check-service-role-org-scope.mjs`
checks the `.rpc("org_email_domain_claim", …)` call for its `_org_id`
argument, not for where that value came from. The compensating controls are
the `service_role`-only grant, the grant-matrix and behaviour assertions in
`supabase/tests/org_email_domains_suite.sql`, and the route's unit suite.

## App routes and pages (26 sites)

| File | Why service-role is used | Org derived from | Scoped queries |
|------|--------------------------|------------------|----------------|
| `app/platform/page.tsx` | Platform overview counts every org across tenants; RLS pins a request to one org | Platform-admin authority: `getPlatformAdmin()` via the cookie-bound request client; cross-org by design, confined to `organizations` (tenant root) | `organizations` (id, status — deliberately unfiltered) |
| `app/platform/organizations/page.tsx` | Org list across tenants — the surface's purpose | Platform-admin authority (as above); confined to `organizations` (tenant root) | `organizations` (deliberately unfiltered list) |
| `app/platform/organizations/[id]/page.tsx` | Org detail + founding-admin request + email cap/usage (CWA-72) + the org's sending-domain row (for the custom-domain gate and stuck-cleanup cards); all invisible to the caller's own-org RLS (the cap tables have no permissive policy at all; the domain row is scoped to the org's own admins) | Platform-admin authority; org id from the route param | `organizations` `.eq("id", id)` (now also reads `custom_email_domain_enabled`); `access_requests` `.eq("org_id", id).eq("approved_role", "admin")`; `org_email_limits` `.eq("org_id", id)`; `org_email_usage` `.eq("org_id", id).eq("usage_date", today)`; `org_email_domains` `.eq("org_id", id)` |
| `app/api/platform/organizations/route.ts` | `provision_organization()` is EXECUTE-granted to `service_role` only | Platform-admin authority; the RPC creates the org and derives everything from it transactionally | `rpc("provision_organization")` only |
| `app/api/platform/organizations/[id]/route.ts` | Status/branding/`custom_email_domain_enabled` writes on the tenant root, whose only org-admin write policy is the single-column `directory_visibility` UPDATE (the custom-domain flag is platform-operator-only by design: no grant to the org's own admin, this route is its sole write path) | Platform-admin authority; org id from the route param | `organizations` read + update `.eq("id", id)` (branding merged, never replaced) |
| `app/api/platform/organizations/[id]/invite-owner/route.ts` | Mints the founding admin's `signup_token`; the platform admin's own-org RLS could never reach the new org's request row | Platform-admin authority; org id from the route param | `access_requests` update `.eq("org_id", id).eq("approved_role", "admin").eq("email", ownerEmail)`; rollback update on the same filters + minted token; email branding via `resolveEmailBranding(id)` |
| `app/serving/go/page.tsx` | Unauthenticated, HMAC-signed serving link; no session exists to satisfy RLS | HMAC-validated `teams` row (`org_id` and `group_id`); link rejected when `profiles.org_id` disagrees | `group_settings` (link mode, on the team's `group_id`), `serving_team_settings`, `team_members`, `serving_signups` (all on `team_id`), `profiles` (spouse), `family_units` (label) |
| `app/g/[groupId]/serving/[teamId]/page.tsx` | Surfaces pending (never-logged-in) spouse profiles that RLS hides from the caller | Caller's own RLS-scoped profile | `profiles` (spouse lookup) |
| `app/join/family/[token]/page.tsx` | Signed family-invite link resolved before login; no session | The `family_invites` row itself: looked up by `token` alone (unscoped by org — the row is what resolves it); fails closed on a lookup error and on no row | `family_invites` (with its `family_members` / `family_units` embeds, reached by the row's own composite FKs) |
| `app/api/family-invites/request/route.ts` | A household invitee files their access request before login; no session, and `access_requests` has no client INSERT policy | The `family_invites` row looked up by `token` alone (the org anchor); 404 on no row or an already-claimed invite, 500 on a lookup error | `access_requests` existing-request select `.eq("org_id", invite.org_id)` and insert carrying `org_id: invite.org_id` and `invite_token: invite.token` |
| `app/join/[token]/page.tsx` | Group invite link resolved before login (and for a signed-in member, before the group's own policies can see them); no session | The `group_invites` row looked up by `token` alone (unscoped — the row is what resolves the org); a lookup error renders "Something went wrong", no row or a dead link renders the one invalid message | `group_invites` (with `groups` / `organizations` embeds by the row's own FKs); `group_invite_uses` count `.eq("invite_id", id).eq("org_id", org_id)`. The signed-in viewer's own `profiles` and `group_members` rows are read on the request client |
| `app/api/join/[token]/route.ts` | `group_invite_redeem()` is EXECUTE-granted to `service_role` only, and the route holds the signup token it mails | The function resolves the org from the token row inside the transaction (`// org-anchor:` on the `.rpc()`); the returned `org_id` anchors the quota reservation, the branding read and the rollback | `rpc("group_invite_redeem")`; `access_requests` token-clearing update `.eq("id", access_request_id).eq("org_id", org_id)` when quota refuses or the send fails |
| `app/api/serving/signups/route.ts` | Post-delete notification email lookups for affected members | The deleted signup row's own `org_id` (authorised by the RLS-checked delete); the link's group from its `teams` embed | `team_members` (leaders, on `team_id`), `family_units` (label) |
| `app/api/serving/link-action/route.ts` | Same HMAC signed-link pattern as `serving/go`; no session | HMAC-validated `teams` row (`org_id` and `group_id`); link rejected when `profiles.org_id` disagrees | `group_settings` (link mode), `serving_team_settings`, `team_members`, `serving_signups` (read/delete — cancel path; all on `team_id`), `rpc(serving_signup_apply)` (the signup + attendee insert pair, one transaction; the function re-derives the org from the `teams` row and enforces it internally — CWA-47 / #313), `profiles` (spouse), `family_units` (label) |
| `app/api/serving/broadcast/route.ts` | Fans out email to all team members regardless of caller's RLS visibility | RLS-scoped `teams` row (`org_id` and `group_id`); the caller must lead the team or its group (a `group_members` read on the request client) | `team_members` (recipients, on `team_id`), `group_settings` (link mode, on `org_id` + `group_id`) |
| `app/api/calendar/feed.ics/route.ts` | Bearer-token calendar subscription; no session | `calendar_subscription_tokens` row (`org_id` stamped at issuance); owner role re-checked; the owner's `group_members` rows are the group boundary | `group_members` (the owner's groups), `events` `.in("group_id", …)`, `serving_signups` `.in("teams.group_id", …)`, `profiles` (owner), token expiry update. A `?group=` outside the owner's groups yields an empty 200; a failed membership read is a 500 |
| `app/api/auth/consume-token/route.ts` | Pre-login token flow; no session yet | The resolved `access_requests` row (`signup_token` is globally UNIQUE today — scoping is correctness-under-change) | `access_requests` update on `(id, org_id)` |
| `app/api/auth/verify-token/route.ts` | Pre-login token flow; no session yet | The `access_requests` token row itself (`org_id` selected and required non-null) | Token row is the anchor; `handle_new_user()` reads the same row |
| `app/api/feedback/route.ts` | Rate-limit count and admin email fan-out (RLS exposes feedback only to admins) | Caller's own RLS-scoped profile | `feedback` (count), `profiles` (admin recipients — was a latent cross-tenant email leak; a correctness-under-change risk, not a live one at single-org scale) |
| `app/api/household/link-member/route.ts` | Household manager updating another profile's `family_id` (RLS blocks cross-profile writes) | Caller's own RLS-scoped profile; target's org asserted equal | `profiles` update on `(id, org_id, family_id IS NULL)` |
| `app/api/events/[id]/ics/route.ts` | Bearer-token calendar subscription; no session | `calendar_subscription_tokens` row (`org_id` stamped at issuance); the owner's membership of the event's group re-checked | `events` (404 on cross-org id), `group_members` (404 when the owner is not in the event's group), `profiles` (owner), token expiry update |
| `app/api/family-invites/claim/route.ts` | New user claiming an invite while their role is still `pending` | The `family_invites` row; caller's profile org must match (403 otherwise) | `profiles`, `family_members`, `family_invites` updates all on the invite's `org_id` |
| `app/api/admin/email-domain/route.ts` | Every method 404s before auth while `CUSTOM_SENDING_DOMAINS_ENABLED` (`lib/email/sendingDomains.ts`) is false. GET reads `organizations.custom_email_domain_enabled` through the service client; the admin's request client has no SELECT grant on that column. The `org_email_domains` row is read through the request client. POST gates on that flag, then claims the row through `org_email_domain_claim()` — the `service_role`-only RPC (see the "Email domain claim RPC" section above) that enforces the platform-wide domain cap atomically, so the route no longer holds an unscoped count read — then Resend `domains.create` returns `resend_domain_id`/`status`/`dns_records`, columns the admin's own client has no UPDATE grant on — the write must happen server-side (CWA-70 / #363); when the follow-up write fails and the Resend removal also fails, the row is kept as `status = 'cleanup_pending'` (server-set-only columns again) rather than deleted. DELETE now removes the Resend domain first and needs the same server-set-only writes when that fails | The caller's own RLS-scoped `profiles.org_id`, read on the request client; the `organizations` reads take `.eq("id", orgId)` (tenant root); the insert carries that `org_id` in its payload, and every subsequent read/write is predicate-scoped `.eq("org_id", orgId)` / `.eq("id", ...).eq("org_id", orgId)` | `organizations` `.eq("id", orgId)` (flag); `org_email_domains` existing-row select `.eq("org_id", orgId)`, unscoped head count (org-anchor), insert (payload: `org_id`, `domain`), update (`resend_domain_id`, `status`, `dns_records`, `cleanup_failed_at`) and rollback/remove deletes on `(id, org_id)` |
| `app/api/admin/email-domain/verify/route.ts` | 404s before auth while `CUSTOM_SENDING_DOMAINS_ENABLED` is false. POST handler: the `status`/`verified_at`/`last_checked_at` transition must not be writable by the admin's own client (same column grants as above) | The caller's own RLS-scoped `profiles.org_id`, read on the request client; target row fetched `.eq("org_id", orgId)` before any write | `org_email_domains` select `.eq("org_id", orgId)` + update on `(id, org_id)` |
| `app/api/platform/organizations/[id]/email-cap/route.ts` | Daily email cap override (CWA-72): `org_email_limits` is platform-operator-owned with no permissive policy, so only a service-role write can reach it — an org that can raise its own cap does not have a cap | Platform-admin authority; org id from the route param, validated against an existing `organizations` row before the write | `organizations` `.eq("id", id)` (existence check); `org_email_limits` upsert carrying the validated `org_id`, zero-row-checked |
| `app/api/platform/organizations/[id]/email-domain-cleanup/route.ts` | Platform-admin retry of a stuck Resend domain removal: the org's `org_email_domains` row is scoped to that org's own admins, so a platform operator finishing the cleanup from `/platform` needs the service client for both the read and the delete; the row's `cleanup_failed_at` is a server-set-only column besides | Platform-admin authority; org id from the route param, validated against an existing `organizations` row before any `org_email_domains` access | `organizations` `.eq("id", id)` (existence check); `org_email_domains` select `.eq("org_id", org.id)` (must be `cleanup_pending` with a `resend_domain_id`), update on `(id, org_id)` on a failed retry, delete on `(id, org_id)` zero-row-checked after Resend confirms removal |

## Lib helpers (3 sites)

Unlike the rows above — inherited from Phase 2 with their mitigations still
outstanding — this site was introduced *during* Phase 3 with its mitigation
already shipped. The "once org_id lands" framing does not apply; the risk
column below describes what a regression would cost, not a pending work item.

| File | Why service-role is used | Tenancy risk | Mitigation |
|------|--------------------------|--------------|------------|
| `lib/email/identity.ts` | `resolveEmailBranding(orgId)` — `orgId` is **required** — reads `organizations.branding` for callers that hold an explicit org id but no request-scoped session (e.g. `lib/serving/server.ts`, invoked from HMAC-signed link flows), and a second, org-scoped read of `org_email_domains` to resolve the per-org `From:` address. The link origin (`EmailBranding.baseUrl`) is the app's one canonical host, `siteConfig.url`, and needs no read. The genuinely request-scoped case is the separately named `resolveRequestEmailBranding()`: it resolves the org id via `resolveRequestOrgId()` on the cookie-bound request client, then runs the same service-role `org_email_domains` read for it — it has no live caller today and exists so that path must be typed out, never reached by omitting an argument | A missing filter on either table would leak another org's branding or sending domain into an email | The `organizations` read's `.eq("id", orgId)` and the `org_email_domains` read's `.eq("org_id", orgId)` are the only tenant boundaries, both mandatory; `orgId` is always either the caller's already-authorized id or the value `resolveRequestOrgId()` resolves for the current request — never a header, never a body field. `SENDING_DOMAIN` additionally gates the stored domain value itself (with `status = 'verified'`) before it can reach a `From:` header — see CLAUDE.md's injection-boundary list. Branding on the request-scoped path still comes from the request-scoped client, so RLS applies — but that resolves to the *request* org, which can differ from the row's org, so any caller holding an authorized `org_id` must pass it. |
| `lib/email/quota.ts` | `reserveEmailQuota(orgId, n)` calls `email_quota_consume()` — a `service_role`-only RPC (see the "Email quota RPC" section above), so the service client is the only client that can execute it | The `.rpc()` call is invisible to the guard (it walks `.from()` chains only), so a refactor could silently pass an unvalidated org id | `orgId` must come from an anchor the caller already validated — the caller's RLS-scoped profile (`app/api/feedback`), the RLS-checked group row (`app/api/serving/broadcast`), or the already-authorized `opts.orgId` both `notifyLeadersOfCancel` callers hold — never a header or body field. Fail-closed: any RPC error or throw is a refusal, never "send anyway" |
| `lib/members/invite.ts` | `findExistingInvitees(orgId, emails)` and `sendMemberInvite(invite)` — the one path a church admin's invitations take, one person from `/admin/members/invite` (`app/api/admin/members/invite`) or many from the importer (`app/api/admin/invite-bulk`). `access_requests` has no INSERT policy for any client role, so the approved request carrying the signup token can only be written server-side; the household rows (`family_members`, `family_invites`) and every rollback delete use the same client so a failed send leaves nothing behind (`family_invites` has no DELETE policy) | An unscoped existing-account read would report, or skip, another org's people; an insert without `org_id`, or a household id from another org, would admit the invitee to the wrong church | `orgId` is the caller's `requireOrgAdmin()` result — the admin's own RLS-scoped profile row — never a body field. The `profiles` / `access_requests` reads filter `.eq("org_id", orgId)`; every insert carries `org_id: orgId`; every rollback delete is on `(id or signup_token, org_id)`. The body's household id reaches only the `family_members` insert, whose composite `(family_id, org_id)` FK rejects a household outside `orgId` |

`lib/branding.ts` is deliberately **not** a service-role site: `getOrgBranding()`
uses the request-scoped `createClient()`, so RLS narrows `organizations` to the
request org and no `.eq()` filter is needed. That contrast is exactly why
`lib/email/identity.ts` above — which *does* use the service client — must
carry `.eq("id", orgId)`. `getOrgBranding()` takes no argument: the org is
whatever the session resolves, and an anonymous request resolves none.
`getRequestBranding()` is the root layout's wrapper around it, gating on an
authenticated session before ever calling `getOrgBranding()` so an anonymous
request is branded with the platform defaults without a query.

## Edge Functions (2 sites)

Both run with no session context and resolve the service key
from configured environment variables: a manual `SUPABASE_SECRET_KEY` override
(local/self-host only — the hosted platform reserves the prefix), then the
platform-injected `SUPABASE_SECRET_KEYS` map, then the legacy
`SUPABASE_SERVICE_ROLE_KEY` (see `resolveServiceKey()` in
`supabase/functions/_shared/service-key.ts`, shared by both), not
`createServiceClient()`. Both are cron-triggered.

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

Both functions iterate org → group → team. `send-event-reminders` lists the
org's groups through `listGroups()` (`_shared/groups.ts`), reads each
group's events on `org_id` + `group_id`, and resolves recipients through
`resolveEventReminderRecipients()` (`_shared/event-recipients.ts`): RSVPs
∩ current `group_members` of the event's group → profiles with an email, so
an RSVP from someone who has since left the group is dropped. A failing
group is recorded in `failedItems[]` keyed by `group_id` and the org's
other groups still run. `send-serving-reminders` keeps its team loop,
reads `teams.group_id` with the team name, and resolves the serving link
mode per group through `resolveGroupLinkMode()` (`group_settings`, on
`org_id` + `group_id`, memoised per org run); every `serving_*` query is on
`team_id`. Both shared modules are pure, with recorded-chain tests under
`supabase/functions/tests/`.

Audit result (CWA-58, re-audited with the group flip): every query chain
across both entry points and the two shared modules carries an explicit
`org_id` predicate (or an explicit `org_id` on insert) plus `group_id` /
`team_id` where the row is group- or team-owned; the nested embeds are FK
traversals from org-filtered parents, which the composite `(col, org_id)`
FKs keep inside the tenant; the one `organizations` read is the tenant
root, filtered on `status`. The guard proves each predicate is present;
which variable it binds is review-enforced.

`listActiveOrgs()` also selects `organizations.timezone` on that same
org-anchored read: `send-event-reminders` formats each reminder's event time
through `_shared/event-time.ts` in that zone, so the mail shows the org's
wall clock rather than the runtime's (UTC). The database stores only exact
IANA names (`organizations_timezone_check()`), so the function passes the
stored name to `Intl` as is; a name `Intl` rejects fails that org's groups into
`failedItems[]`, never a wrong time. No new query and no new service-role call site.

Both entry points additionally call `email_quota_consume()` per team/event
batch via `_shared/quota.ts` (CWA-72), passing the org id from the
`forEachOrg()` iteration — the same already-enumerated anchor every other
query in the loop uses. `.rpc()` calls are outside
`check-service-role-org-scope.mjs`'s reach *and* `supabase/functions/` is
outside its scan set entirely, so these calls are covered by review and by
`deno test` (`supabase/functions/tests/quota_test.ts`) only.

| File | Why service-role is used | Historical tenancy risk | Mitigation |
|------|--------------------------|-------------------------|------------|
| `supabase/functions/send-event-reminders/index.ts` | Cron job; reads events/RSVPs and emails attendees with no user session | Reminder fan-out iterates all rows across orgs | **Implemented (Phase 3, #212):** iterates active orgs via `_shared/orgs.ts`, every query filtered on `org_id`, per-org failures isolated so one org cannot suppress another's send. **Group scope:** org → group iteration, events on `group_id`, recipients gated on current group membership, per-group failures in `failedItems[]`. **Branding (CWA-56, #322):** `organizations.branding` rides along on the already-org-anchored `listActiveOrgs()` select — no new service-role call site, no new unscoped query — and is validated by `_shared/branding.ts` (a mirror of `lib/branding.ts` + `lib/email/identity.ts`) before reaching any CSS or RFC 5322 sink. **Link origin:** every link is built on the one canonical host (the `SITE_URL` function secret) — no query. **Time zone:** `organizations.timezone` rides along on the same `listActiveOrgs()` select and formats the reminder's event time |
| `supabase/functions/send-serving-reminders/index.ts` | Cron job; reads serving signups and emails assignees with no user session | Same as `send-event-reminders` | **Implemented (Phase 3, #212):** same per-org iteration and `org_id` filters; `resolveCanSign` org-scoped; `serving_broadcasts` audit rows stamped with the processed row's org, not a constant. **Branding (CWA-56, #322):** same `listActiveOrgs()` ride-along, validated by `_shared/branding.ts`. **Link origin:** the same canonical `SITE_URL`, threaded into every cancel/signup/team-page link. **Per-team isolation (CWA-50, #316):** a failing team is recorded in the run summary's `failedItems[]` keyed by `team_id` — ids, never org-defined team names, in operator diagnostics. **Group scope:** the link mode is per group (`group_settings` through `_shared/groups.ts`), every `serving_*` query is on `team_id`, and links open `/g/<group_id>/serving/<team_id>` |

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
