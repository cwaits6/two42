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

## Automated enforcement

The blocking `Service-role org_id guard` CI job runs
[`scripts/check-service-role-org-scope.mjs`](../../scripts/README.md), which
turns this document's rules into assertions:

- Every service-role query chain in `app/` and `lib/` — `.from()` and
  `.rpc()` alike — must carry an `org_id` predicate (Tier B), unless it is a
  documented org anchor — marked in code with a reasoned
  `// org-anchor: <why>` comment. Every anchor chain in the tables below
  carries that marker in-file; the script has no allowlist.
- The email fan-out chains (feedback admins, serving broadcast, leader cancel
  notices, and the event reminder job's read of `events` in
  `supabase/functions/_shared/event-reminders.ts`) are Tier A: they must be scoped and may **not** use the marker —
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
  analysis.** All three hand-written checks are pinned (the two signed-link
  surfaces and `app/api/household/link-member/route.ts`); the pin proves the comparison
  and its denial log exist, not that the code path is reached.

## Org scoping status

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
`verify-token` / `setup-account`), `/join/family/[token]` (the
`family_invites` row, and its request route below), `/serving/go` (the
HMAC-validated `teams` row) and `/join/[token]` (the `group_invites` row).
Every one of them fails closed on both failure modes — a lookup error and no
row each take the page's generic invalid path, never a fallback org.

Those initial lookups are deliberately unscoped: the `signup_token` read in
`app/api/auth/setup-account/route.ts` and `app/api/auth/verify-token/route.ts`,
the `family_invites` read in `app/join/family/[token]/page.tsx` and
`app/api/family-invites/request/route.ts`, and the `group_invites` read in
`app/join/[token]/page.tsx`, where the token row is what resolves the org.
Each fails closed if it yields no row, and every subsequent operation is
scoped to the resolved row's `org_id`.

Two deliberate behaviour changes shipped with this pass:

- `feed.ics` gained the owner role re-check `events/[id]/ics` already had —
  a token whose owning profile is `pending` or deleted now returns `401`
  instead of a full event list.
- `family-invites/claim` (since removed; the household claim runs inside
  `auth/setup-account`): the scoped `profiles` update returning zero rows
  became a real `500` instead of a silent success.

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

## Platform operator surface status

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

## Serving signup RPC — a definer-function bypass surface

The serving signup insert pair (`serving_signups` + `serving_signup_attendees`)
is written by a `SECURITY DEFINER` function pair
(`20260803010000_serving_signup_rpc.sql`), not by direct PostgREST inserts —
the compensating-delete pattern it replaced could orphan a signup row and
wedge that Sunday behind `unique (group_id, service_date)`:

- `serving_signup_apply(_group_id, _service_date, _actor_id, _attendee_ids)`
  — the atomic core. EXECUTE: `service_role` only (the signed-link route
  passes its HMAC-validated profile id as the actor). Every attendee other
  than the actor must hold a `team_members` row for the team in the team's
  org (`SV004`): the household rule decides who may add whom, being on the
  team decides who can be on a date
  (`20261116000000_serving_blocks_couples_reminder_time.sql`). The date must
  be one of the team's dates (`SV006`): a Sunday, not before the church's
  local date, inside the set block or the rolling window, read from the
  team's own `serving_team_settings` row and the org's time zone.
- `serving_signup_create(_group_id, _service_date, _attendee_ids)` — the
  authenticated entry point; actor from `auth.uid()`, group org pinned
  against `app_request_org_id()`, the caller's standing on the team
  checked in the body. EXECUTE: `authenticated` + `service_role`. No `anon`
  grant on either — the signed-link routes run server-side on the
  service-role client.

`serving_signups` has no INSERT policy, so these two functions are the only
way a client takes a date and their rules cannot be skipped with a direct
insert.

`SECURITY DEFINER` bypasses RLS, so **the org resolution and equality checks
in the function bodies are the tenant boundary; no lint sees them.**
`schema_tenancy_lint.sql` check 4 only proves the source mentions `org_id`;
the resolution order (org from the `teams` row, never a caller
parameter; every other row asserted to carry it) is review-enforced. The
grant matrix and the org checks are pinned by
`supabase/tests/serving_signup_rpc_suite.sql`.

## Changing who is serving — a definer-function bypass surface

`serving_signup_change(_signup_id, _attendee_ids)`
(`20261116000000_serving_blocks_couples_reminder_time.sql`) replaces the people
on one date: a couple, one of them, or the other. EXECUTE: `authenticated` and
`service_role`, no `anon` grant; reached from `PATCH /api/serving/signups` on
the cookie-bound client.

`SECURITY DEFINER` bypasses RLS, so **the checks in the body are the whole
permission.** The actor comes from `auth.uid()` only; the org from the signup
row, pinned against `app_request_org_id()` and fail-closed on NULL; the actor
must have tapped Sign up or be listed on the date (`SV005` otherwise); and
every new attendee must be the actor, or the actor's spouse when the actor is
the primary or spouse of a household, in the same org (`SV002` otherwise),
and on the signup's team (`SV004` otherwise, from an org-filtered
`team_members` read). A group leader or team lead who is not on the date is
refused: they cancel it instead. The grants, each refusal and the attendee row counts are pinned by
`supabase/tests/serving_signup_change_suite.sql`.

## Serving reminder claim — service-key only, SECURITY INVOKER

`serving_reminder_claim(_org_id, _send_date, _service_date, _team_ids)` (same
migration) is what the hourly `send-serving-reminders` job calls, once per
church per firing, before it mails anyone. It starts the day's pass for each
team that has none, fixing that pass's recipients from the service date's
attendees with an email who are not pending, then claims every unsent
reminder in those passes atomically and returns the people to mail. EXECUTE:
`service_role` only. It is `SECURITY INVOKER`: its only caller holds
`BYPASSRLS`, so a definer grant would add nothing, and the org checks in the
body are what keep a call inside one church. Each team's own `teams.org_id` is
compared with `_org_id`; a mismatch raises `SR001` before any write. The
tables it writes, `serving_reminder_passes` and `serving_reminder_sends`, carry
the restrictive isolation floor and no permissive policy or client grant at
all: only the service key reads or writes the sent record. Both are pinned by
`supabase/tests/serving_reminder_record_suite.sql`.

`serving_reminder_passes_prune(_org_id, _before, _limit)` (same migration) is
what the nightly `clean-up-expired-data` job calls, in a loop per church,
to delete that church's passes with a `send_date` before the retention
cutoff: at most `_limit` per call, oldest first, the sends going with each
pass through the foreign key. It exists because PostgREST cannot limit a
delete. EXECUTE: `service_role` only, `SECURITY INVOKER` for the same
reason as the claim; every row it reads and deletes is filtered on
`_org_id`, which the job takes from `listActiveOrgs()`. The same suite pins
the grant, the bound and that another church's passes stay.

## Event reminder claim — service-key only, SECURITY INVOKER

`event_reminder_claim(_org_id, _event_id, _occurrence_date, _reply_event_id)`
(`20261117000000_event_reminder_choices.sql`; its recipients changed in
`20261121000000_event_reply_dates_contract.sql`) is what the
`send-event-reminders` job calls, once per date due, before it mails anyone.
It starts the pass for that date when it has none, fixing who the reminder
goes to, then claims every unsent reminder in the pass atomically and returns
the people to mail. **It is the recipient query of an email fan-out**, and it
lives in SQL, where the Tier A guard cannot see it (the guard pins the job's
`events` read instead), so its body is the boundary: the event's own
`events.org_id` is compared with `_org_id` and a mismatch raises `ER001`
before any write; `_reply_event_id`, the row of a date edited on its own,
must be a date of that event in the same org or the call raises `ER001`; and
every table it joins (`profiles`, `rsvps`, `group_members`) is filtered on
`_org_id`. Recipients: an answer of Yes or Maybe for that date, the `rsvps`
row on `(_event_id, _occurrence_date)`, which is where a date edited on its
own keeps its replies too; a current member of the
event's group; not pending; with an email; and `profiles.email_event_reminders`
on. EXECUTE: `service_role` only. `SECURITY INVOKER`, for the same reason as
the serving claim. The tables it writes, `event_reminder_passes` and
`event_reminder_sends`, carry the restrictive isolation floor and no
permissive policy or client grant. All of it is pinned by
`supabase/tests/event_reminder_suite.sql`, with a second church's event and
people in the fixture.

`event_reminder_passes_prune(_org_id, _before, _limit)` (same migration) is
the nightly job's bounded delete for those passes, a copy of
`serving_reminder_passes_prune()` on `occurrence_date`, with the same grant
and the same `_org_id` filter on every row it reads and deletes.

`private.event_reminder_cutover(_at)` (same migration) runs once, in the
migration, as its owner: it writes an empty pass for every event row the last
firing without a sent record had already mailed, each stamped with the row's
own `org_id`. No client or job can call it.

## Person deletion RPC — a definer-function bypass surface

`delete_person(_person_id, _org_id)`
(first `20261113000000_delete_person.sql`; the current body is in
`20261125000000_household_and_deletion_rules.sql`) runs every database step of deleting a
person in one transaction: refusing a platform operator and the last church
admin, serving dates, sign-up records, household entries, and the
`auth.users` row, which cascades to the profile, through it to the person's
`serving_reminder_sends` and `event_reminder_sends` rows, and to the fund
rules below (`20261115000000_fund_recipients_in_group.sql`). EXECUTE: `service_role` only,
reached from `deletePerson()` in `lib/account/deletion.ts`.

Whether the household goes, and where each fund ends up, come from
`person_deletion_outcomes()` (below), the same answer the confirmation shows.
After the profile delete it checks every fund ended as that answer said, and
otherwise raises `AD003`, which rolls the whole delete back.

Their `group_invite_uses` rows stay, because `max_uses` counts them and deleting
one would make a used-up link live again. The function clears what identifies the
person: the address, the request link, and `profile_id` through its foreign key. A
`signup_sent` row must carry an email by its check constraint, so it holds the
placeholder `deleted`, which can't equal an address because
`group_invite_redeem()` requires an `@`.

`SECURITY DEFINER` bypasses RLS, so **the org checks in the body are the tenant
boundary.** The org comes from the target's `profiles` row. `_org_id` is only
compared with it, and a mismatch gets the same `AD001` as nobody at all. Every
statement filters on that org, except the writes to `auth.users` and the read of
`storage.objects`, which have no `org_id` and are keyed on the target's own id
and on row ids already scoped to the org.

**Its owner needs `DELETE` on `auth.users`.** `postgres` holds it through a grant
in Supabase's own database image
(`GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres`), and Supabase's restriction
on writing to its managed schemas names only their migration tables. The migration
stops the deploy if the role running it lacks the privilege.

The grant matrix, each refusal, the row counts and a rollback forced at the last
step are pinned by `supabase/tests/account_deletion_suite.sql`.

## Person deletion outcomes — a definer-function bypass surface

`person_deletion_outcomes(_person_id, _org_id)`
(`20261125000000_household_and_deletion_rules.sql`) says what deleting a person
does to each fund they receive gifts for (passed on to the second person, or
waiting for a recipient) and to their household (stays, or goes with the people
listed in it). Read-only (`STABLE`, no writes). Called by `delete_person()` and
by `loadDeletionSummary()` in `lib/account/deletion.ts`, so the confirmation and
the delete can't describe different outcomes. EXECUTE: `service_role` only.

`SECURITY DEFINER` bypasses RLS, so **the org checks in the body are the tenant
boundary.** The org comes from the target's own `profiles` row; `_org_id` is
only compared with it, and a mismatch or an unknown person returns null. Every
read filters `org_id` on that org, and the joins to `groups`, `group_members`
and `profiles` carry it through the composite keys. It returns fund, group and
person names; the confirmation reduces them to counts for a church admin. The
fund rule it reports is the one `giving_fund_recipients_guard()` applies.
`search_path = ''`, revoked from `public, anon, authenticated`. Pinned by
`supabase/tests/deletion_outcomes_suite.sql`.

## Fund recipient triggers — definer-function bypass surfaces

`20261115000000_fund_recipients_in_group.sql` adds two `SECURITY DEFINER`
trigger functions that write `giving_funds`, and a backfill function. All three
`set search_path = ''`, schema-qualify everything and revoke EXECUTE from
`public`, `anon` and `authenticated`; none takes a parameter.

- `giving_fund_recipients_guard()` — `BEFORE INSERT OR UPDATE OF steward_id,
  co_steward_id, group_id, org_id, needs_review` on `giving_funds`. Reads the
  row's own `group_id` and `org_id`, and refuses a named person who has no
  `group_members` row with both, which also refuses another church's person, or
  who is pending. It takes `FOR KEY SHARE` on the membership row it reads, so a
  removal running alongside the write can't miss the fund. Every loss of a
  recipient reaches it as `steward_id` going null, whichever path caused it:
  promotes a second person still in the group and not pending, empties the
  second slot and `steward_role`, and sets `needs_review`. Refuses clearing
  `needs_review` unless `is_group_leader(old.group_id)`, which reads
  `auth.uid()`; there is no exemption for a null `auth.uid()`, so the service
  role can't confirm a fund either. A check constraint,
  `giving_funds_no_recipient_needs_review`, keeps a fund with no recipient
  flagged.
- `group_member_removed_leaves_funds()` — `AFTER DELETE OR UPDATE OF group_id,
  profile_id, org_id` on `group_members`. Org and group come from the `OLD`
  membership row, and both updates filter on them. Returns without writing when
  the membership still exists.
- `giving_funds_apply_recipient_rules()` — the deploy's backfill, kept so pgTAP
  can prove it. `SECURITY INVOKER`, also revoked from `service_role`, so only
  the migration role runs it. Each row's own `org_id` scopes its membership
  check, and only a person outside the fund's group matches, so a second run
  changes nothing.

`delete_person()` doesn't write `giving_funds`: its profile delete reaches
the same rules through the composite foreign keys (`on delete set null
(steward_id)`) and the membership trigger, in either firing order. Proved in
`supabase/tests/giving_recipients_suite.sql`.

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

Each also joins the caller's `profiles` row and requires `role <> 'pending'`
(`20261102000000_pending_ends_group_access.sql`): a person moved back to
pending keeps their rows but passes no arm until they are approved again,
and `serving_signup_create()` applies the same check to its direct
`team_members` arm.

Every body carries `org_id = public.app_current_org_id()`, so a membership
row in another org never counts — `schema_tenancy_lint.sql` check 4 sees
that predicate; the org equality itself is what keeps a caller-supplied id
from resolving another tenant's row. EXECUTE: revoked from `public` and
`anon`, granted to `authenticated` (the policies that call them are all
`to authenticated`).

`is_serving_signup_attendee(_signup_id)` (`20261110000000_serving_signup_attendee_cancel.sql`)
has the same shape and grants: a `serving_signup_attendees` row for
`auth.uid()` on the given signup, with the same org predicate and non-pending
check. It is read-only and only the `serving_signups` delete policy calls it. It
exists because that policy cannot read the attendee table directly: the attendee
select policy reads `serving_signups`, and Postgres raises 42P17 when policy
expansion revisits a relation, whichever command the second policy is for.
`supabase/tests/serving_cancel_suite.sql` pins its grants and each cancel arm's
row count.

`group_model_backfill()` — the one-group-per-org data migration — is
deliberately **not** `SECURITY DEFINER` and has no client grant (EXECUTE
revoked from `public`, `anon`, `authenticated` and `service_role`): it
exists as a function only so `supabase/tests/group_model_suite.sql` can run
the same logic the migration ran against fixture orgs. It is idempotent
and asserts its own enrolment and leader counts. Grants, org checks and the
within-org boundary are pinned by that suite and by `idor_suite.sql`.

`group_content_backfill()` (`20261017000000_group_scoped_content.sql`) was
its content-layer twin, with the same shape: plain `plpgsql`, no client
grant. It ran once inside that migration and was dropped by
`20261123000000_database_tidy_up.sql` with the call fields it moved.
`supabase/tests/group_scope_suite.sql` pins the NOT NULL and composite FKs,
the policy shapes and the member / leader / org-admin read and write matrix.

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
public.app_current_org_id()`. `shares_group_with()` is called by the `profiles`
SELECT policy; `shares_group_with_household()` only by `household_visible()`,
the one statement of household visibility, which the `family_units` SELECT
policy and `family_directory_people()` both read — see
"Directory visibility" in [`tenancy-model.md`](tenancy-model.md). None writes.

`handle_new_user()` (the auth signup trigger, `SECURITY DEFINER`) writes
the new `profiles` row and, for a non-pending profile, `group_members`:
when the org it already resolved from the approved access request has
exactly one group, the new profile is enrolled in it as a member. It writes
no other membership table — `profiles.org_id` is the only org membership.
The org comes from the same server-owned rows as before, never from the
caller, and every inserted column carries it.
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
  is on, and private groups additionally for an org admin, each with its
  oldest calendar's color; every join and the color lookup carry the
  group's `org_id`. Read-only. EXECUTE:
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
`useDiscoverableGroups`, `JoinRequestsManager`) and the server-side
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
  this org (`GI004`). That refusal only lasts as long as the denied row: the
  nightly cleanup deletes the row 90 days after `reviewed_at`, so a decline
  blocks group links for 90 days. It then writes the approved `access_requests` row
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
No DELETE policy and no DELETE privilege, so a link stays as the audit trail
until the nightly `clean-up-expired-data` job deletes it and its uses, 90 days
after it is revoked or expires. `anon` holds no privilege on either table.
`group_invite_uses` has one SELECT policy (the same readers) and no client write grant at all; only the
functions above and the trigger write it.

The app-side call sites: `app/api/join/[token]/route.ts` calls
`group_invite_redeem` on the service client under a marker (the function
resolves the org from the token; there is no `org_id` to pass) and scopes
its one rollback write on `(id, org_id)`; `app/join/[token]/JoinGroupButton.tsx`
calls `group_invite_join` on the browser client, which is not service-rooted;
`app/g/[groupId]/settings/invites/InviteLinksManager.tsx` reads and writes
`group_invites` on the browser client under the policies above.

## Email quota RPC — a definer-function bypass surface

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
  row, `listActiveOrgs()`'s own enumeration, platform-admin authority over
  the route's org).

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

## Prayer author helper — a definer-function bypass surface

`prayer_requests.author_id` is unreadable to every client role
(`20261109000000_prayer_author_private.sql`). `prayer_wall` stays
`security_invoker`, so it runs with the caller's rights and reaches the author
only through one `SECURITY DEFINER` function:

- `prayer_request_visible_author(_request_id)` — returns the author only to
  the author themselves, or, on a by-name request, to someone the `profiles`
  read policy lets see that person: a church admin, their household, or a
  member while the author is listed and either shares a group with them or the
  church's directory is open. Otherwise NULL. Anonymous means NULL for every
  other member, leader and church admin. EXECUTE: `authenticated` only; revoked
  from `public`, `anon` and `service_role`.

The parameter is only the row key. The org and group come from the
`prayer_requests` row, checked against `app_request_org_id()` and
`is_group_member(r.group_id)`; the profile is joined on the row's own `org_id`.
`SECURITY DEFINER` bypasses RLS, so **those checks and the by-name arm are the
boundary, and no lint sees them.** The by-name arm repeats the `profiles` read
policy: if that policy changes, change the arm with it, or an id can be returned
where the name is hidden, which links a person's requests to each other. The
grant matrix and each arm are pinned by
`supabase/tests/prayer_anonymity_suite.sql`.

Two plain (not definer) triggers from the same migration close write oracles:
`prayer_requests_author_sets_anonymity` lets only the author change
`is_anonymous`, and `profiles_keep_id` refuses a client's change to
`profiles.id` before a foreign key error can name `prayer_requests`.
`service_role` is outside both, and no service-role client reads
`prayer_requests` or `prayer_wall`.

## Hidden email helpers — definer-function bypass surfaces

A person's address has three read paths that do not need `SELECT` on
`profiles.email` (`20261118000000_hidden_email_read_paths.sql`): the owner's
`get_own_email()`, and three `SECURITY DEFINER` functions. Each resolves the
church from the signed-in person through `app_request_org_id()`, sets an empty
`search_path`, and is executable by `authenticated` only (revoked from
`public`, `anon` and `service_role`).

- `profile_directory_email(_profile_id)` — the address `profiles_directory`
  shows for one person. NULL when the person hides their email, for every
  caller including the owner and a church admin, and NULL wherever the
  `profiles` read policy hides the person from the caller. The view stays
  `security_invoker`, so the restrictive `org_id` policy and the read policy
  still decide which rows exist; only this one column comes from the function.
  The parameter is only the row key, and the function can be called with any
  id, so **its visibility arms repeat the `profiles` read policy and no lint
  sees them**: if that policy changes, change the arms with it, or an address
  is returned for a person whose row is hidden.
- `admin_member_emails()` — every profile id and address in the caller's
  church, hidden or not. Rows only when `is_admin()`; no rows for anyone else.
  It takes no parameter. Church admin Members, the member edit page, and the
  member import and export read addresses here on the request client, so none
  of them needs a service-role client.
- `serving_team_email_count(_team_id)` — how many people on a team an email to
  the team reaches: an address on file, not pending, announcements on, the
  same rule `app/api/serving/broadcast/route.ts` sends by. The team row is
  read under the caller's org, and the count is NULL unless the caller leads
  that team or its group. It returns a number and never an address.

The grant matrix, each arm, the mirror of the read policy and the second-church
cases are pinned by `supabase/tests/hidden_email_suite.sql`, and all three are
called as a church admin of another church in
`supabase/tests/tenancy_leak_suite.sql`.

No function returns a household member's address: `get_profile_email()`,
which did, was dropped in `20261122000000_household_hidden_email.sql`. The same
migration added `profiles_email_by_owner_or_admin`, a plain (not definer)
`BEFORE UPDATE OF email` trigger on `profiles`. When the caller is `anon` or
`authenticated`, it refuses with `42501` any update that names `email` on
someone else's row unless `is_admin()`. It gates on `current_user`, which
PostgREST sets with `SET ROLE` and no request can change, so the service role
and the definer sign-in trigger `handle_auth_user_email_change` pass and no
session setting lets a client role through. It has no `WHEN` clause: it fires
on the column being named, so a right guess and a wrong guess are refused the
same. Execute is revoked from `public`, `anon` and `authenticated`, since a
trigger function is never called directly. `hidden_email_suite.sql` pins all
of it.

These functions are how the app reads an address. A direct read of
`profiles.email` is stopped by the column grant: `anon` and `authenticated`
hold `SELECT` on every other column of `profiles`, and not on `email`.

## Household anniversary gate — a definer-function bypass surface (`family_anniversary_hidden`)

`public.family_anniversary_hidden(_family_id)`
(`supabase/migrations/20261111000000_directory_no_hide_settings.sql`) is a
read-only `SECURITY DEFINER` over `profiles`: whether either spouse in the household
has `hide_anniversary` set. Both household views call it, because they are
`security_invoker` and an unlisted spouse's row is invisible to the caller, which
would make an `EXISTS` inside the view fail open.

It returns a boolean and writes nothing. Its org comes from
`app_current_org_id()`, never from a parameter, so a family id from another org
answers false. `search_path = ''`; execute is revoked from `public, anon` and
granted to `authenticated, service_role`. Remove it with `profiles.hide_anniversary`.

## Children in the directory — definer-function bypass surfaces

Three `SECURITY DEFINER` functions, first in
`supabase/migrations/20261112000000_children_directory.sql`; the current bodies
are in `20261125000000_household_and_deletion_rules.sql`. Each has
`search_path = ''`, and each is read or fired only as described here. Each
reads the child rule from `is_child_without_account()`, a pure `SECURITY INVOKER`
function that is not a bypass surface.

- `public.family_directory_people(_family_id)` is read-only over `family_members`.
  `families_directory_full` calls it, because other members have no direct read of
  that table. Its org comes from `app_current_org_id()`, never from a parameter, and
  it gates on `household_visible()`, the rule the `family_units` policy reads, so a direct call for a household the
  caller can't see, for another org or by a pending account returns `[]`. Execute is
  revoked from `public, anon, service_role` and granted to `authenticated` only: with
  no principal the service role could only read `[]`, which a caller would take for an
  empty household. No service-role client reads `families_directory_full`, which calls it.
- `public.family_invites_refuse_child()` is a BEFORE trigger on `family_invites`,
  read-only over `family_members`. It has to see a row the caller can't, or naming
  another household's person would pass. It reads the member by `(id, org_id)` from
  the invite row, whose composite FK already ties the two together. A service-role
  insert has no request org to read instead. It raises `HP003` when the member isn't in
  the invite's `family_id`, which nothing else checks and which `/api/auth/setup-account`
  relies on, then `HP002` on a child without an account. The read takes `FOR SHARE`, so
  an invite and a relabel to Child can't both commit: the later one waits for the
  earlier, then this read sees the relabel or the retiring trigger below sees the invite.
- `public.family_members_retire_child_invites()` is an AFTER UPDATE trigger on
  `family_members` that deletes that member's `family_invites` and the unused
  `access_requests` naming them. A primary can relabel someone but has no DELETE
  policy on invites, and `access_requests` has no client policy. Every delete is
  scoped to the updated row's `org_id`, and only runs for that row.

Execute on both trigger functions is revoked from `public, anon, authenticated`.

## App routes and pages (25 sites)

| File | Why service-role is used | Org derived from | Scoped queries |
|------|--------------------------|------------------|----------------|
| `app/platform/page.tsx` | Platform overview counts every org across tenants; RLS pins a request to one org | Platform-admin authority: `getPlatformAdmin()` via the cookie-bound request client; cross-org by design, confined to `organizations` (tenant root) | `organizations` (id, status — deliberately unfiltered) |
| `app/platform/organizations/page.tsx` | Org list across tenants — the surface's purpose | Platform-admin authority (as above); confined to `organizations` (tenant root) | `organizations` (deliberately unfiltered list) |
| `app/platform/organizations/[id]/page.tsx` | Org detail + founding-admin request + email cap/usage (CWA-72) + the org's sending-domain row (for the custom-domain gate and stuck-cleanup cards); all invisible to the caller's own-org RLS (the cap tables have no permissive policy at all; the domain row is scoped to the org's own admins) | Platform-admin authority; org id from the route param | `organizations` `.eq("id", id)` (now also reads `custom_email_domain_enabled`); `access_requests` via `foundingRequestQuery(service, org.id)` from `firstAdminInvite.ts` (`.eq("org_id", orgId).eq("approved_role", "admin")`); `org_email_limits` `.eq("org_id", id)`; `org_email_usage` `.eq("org_id", id).eq("usage_date", today)`; `org_email_domains` `.eq("org_id", id)` |
| `app/api/platform/organizations/route.ts` | `provision_organization()` is EXECUTE-granted to `service_role` only | Platform-admin authority; the RPC creates the org and derives everything from it transactionally | `rpc("provision_organization")`; then `sendFirstAdminInvite()` (see `firstAdminInvite.ts` below) with the org id the RPC returned |
| `app/api/platform/organizations/[id]/route.ts` | Status/branding/`custom_email_domain_enabled` writes on the tenant root, whose only org-admin write policy is the single-column `directory_visibility` UPDATE (the custom-domain flag is platform-operator-only by design: no grant to the org's own admin, this route is its sole write path) | Platform-admin authority; org id from the route param | `organizations` read + update `.eq("id", id)` (branding merged, never replaced) |
| `app/api/platform/organizations/firstAdminInvite.ts` | `sendFirstAdminInvite()`, called in-process by Add organization (`app/api/platform/organizations/route.ts`) and Send invite (`app/api/platform/organizations/[id]/invite-owner/route.ts`): mints the first admin's `signup_token` and sends their invite; the platform admin's own-org RLS could never reach the new org's request row | Platform-admin authority; org id is the one `provision_organization()` returned in the same request, or the route param behind the gate | `access_requests` select through the exported `foundingRequestQuery()` (`.eq("org_id", orgId).eq("approved_role", "admin")`, earliest by `created_at` then `id`; the church page reads the same query), email compared case-insensitively in code; token update on `.eq("id", row.id).eq("org_id", orgId)`, zero-row-checked; rollback update on the same filters + minted token; daily cap via `reserveEmailQuota(orgId, 1)` before the token; email branding via `resolveEmailBranding(orgId)` |
| `app/serving/go/page.tsx` | Unauthenticated, HMAC-signed serving link; no session exists to satisfy RLS | HMAC-validated `teams` row (`org_id` and `group_id`); link rejected when `profiles.org_id` disagrees | `group_settings` (link mode, on the team's `group_id`), `serving_team_settings`, `team_members`, `serving_signups` (all on `team_id`, including the following dates a booking would add, `.in("service_date", candidates)`), `team_members` with embedded `profiles` through `findSpouse()` (spouse, on `org_id` and `team_id`), `organizations` `.eq("id", org_id)` (the time zone that decides which dates have passed) |
| `app/g/[groupId]/serving/[teamId]/page.tsx` | Surfaces pending (never-logged-in) spouse profiles that RLS hides from the caller | Caller's own RLS-scoped profile | `team_members` with embedded `profiles` through `findSpouse()` (spouse, on `org_id` and `team_id`) |
| `app/join/family/[token]/page.tsx` | Signed family-invite link resolved before login; no session | The `family_invites` row itself: looked up by `token` alone (unscoped by org — the row is what resolves it), and only for a well-formed uuid; fails closed on a lookup error, on no row and on an accepted invite | `family_invites` (with its `family_members` / `family_units` embeds, reached by the row's own composite FKs) |
| `app/api/family-invites/request/route.ts` | A household invitee files their access request before login; no session, and `access_requests` has no client INSERT policy | The `family_invites` row looked up by `token` alone (the org anchor); 404 on no row or an already-claimed invite, 500 on a lookup error | `access_requests` existing-request select `.eq("org_id", invite.org_id)` and insert carrying `org_id: invite.org_id` and `invite_token: invite.token` |
| `app/join/[token]/page.tsx` | Group invite link resolved before login (and for a signed-in member, before the group's own policies can see them); no session | The `group_invites` row looked up by `token` alone (unscoped — the row is what resolves the org); a lookup error renders "Couldn't load this invite." with a retry, no row or a dead link renders the one invalid message | `group_invites` (with `groups` / `organizations` embeds by the row's own FKs); `group_invite_uses` count `.eq("invite_id", id).eq("org_id", org_id)`. The signed-in viewer's own `profiles` and `group_members` rows are read on the request client |
| `app/api/join/[token]/route.ts` | `group_invite_redeem()` is EXECUTE-granted to `service_role` only, and the route holds the signup token it mails | The function resolves the org from the token row inside the transaction (`// org-anchor:` on the `.rpc()`); the returned `org_id` anchors the quota reservation, the branding read and the rollback | `rpc("group_invite_redeem")`; `access_requests` token-clearing update `.eq("id", access_request_id).eq("org_id", org_id)` when quota refuses or the send fails |
| `app/api/serving/signups/route.ts` | Post-delete notification email lookups for affected members; the addresses a booking or change confirmation goes to, which the app does not read on the request client and a spouse may hide | The deleted signup row's own `org_id` (authorised by the RLS-checked delete); the link's group from its `teams` embed. For confirmations, the RLS-read `teams` row's `org_id` on a booking and the RLS-read signup row's on a change, after the attendees were validated on the request client | `team_members` (leaders, on `team_id`); `profiles` (`id, email`, on `org_id` and the validated attendee ids) |
| `app/api/serving/link-action/route.ts` | Same HMAC signed-link pattern as `serving/go`; no session | HMAC-validated `teams` row (`org_id` and `group_id`); link rejected when `profiles.org_id` disagrees | `group_settings` (link mode), `serving_team_settings`, `team_members`, `serving_signups` (read/delete — cancel path; all on `team_id`), `rpc(serving_signup_apply)` (once per date; the signup + attendee insert pair, one transaction; the function re-derives the org from the `teams` row and enforces it internally — CWA-47 / #313), `team_members` with embedded `profiles` through `findSpouse()` (spouse, on `org_id` and `team_id`), `organizations` `.eq("id", org_id)` (the time zone that decides which dates have passed) |
| `app/api/serving/broadcast/route.ts` | Fans out email to all team members regardless of caller's RLS visibility | RLS-scoped `teams` row (`org_id` and `group_id`); the caller must lead the team or its group (a `group_members` read on the request client) | `team_members` (recipients, on `team_id`), `group_settings` (link mode, on `org_id` + `group_id`) |
| `app/api/calendar/feed.ics/route.ts` | Bearer-token calendar subscription; no session | `calendar_subscription_tokens` row (`org_id` stamped at issuance); owner role re-checked; the owner's `group_members` rows are the group boundary | `group_members` (the owner's groups), `events` `.in("group_id", …)` (every repeating series whatever its start, and exception rows, cancelled ones included, by the original slot `series_occurrence_date` — they remove deleted and moved dates), `organizations` `.eq("id", org_id)` (the time zone series dates are expanded in), `group_settings` `.in("group_id", …)` (each group's calendar sharing defaults — join details, notes, location — which an event or series may override on its own row; a failed read is a 500), `serving_signups` `.in("teams.group_id", …)`, `profiles` (owner), token expiry update. A `?group=` outside the owner's groups yields an empty 200; a failed membership read is a 500 |
| `app/api/auth/setup-account/route.ts` | Pre-login account creation; no session yet, and the `auth.admin` API needs the service key | The `access_requests` token row looked up by `signup_token` alone (unscoped — the row is what resolves the org; `org_id` required non-null); a lookup error and no row each take the one invalid answer | `auth.admin` `getUserById` / `createUser` (the row's email and name, `email_confirm`, `app_metadata.org_id` from the row) / `updateUserById` (retry of an unfinished setup only), all under the id derived from the token; `family_invites` select by the row's `invite_token` and update, `family_members` select (an invite whose member has moved to another household is skipped), `profiles` `family_id` update (zero rows fatal) and `family_members` update on the invite's `family_id`, all `.eq("org_id", row.org_id)`; `access_requests` consume on `(id, org_id, signup_token)`, then on `(id, org_id)` when that changed no row, so a token that replaced this one mid-request is retired too |
| `app/api/auth/verify-token/route.ts` | Pre-login token flow; no session yet | The `access_requests` token row itself (`org_id` selected and required non-null) | Token row is the anchor; for a link with no live row, `auth.admin.getUserById` under the id derived from the token answers "already set up" |
| `app/api/feedback/route.ts` | Rate-limit count and admin email fan-out (RLS exposes feedback only to admins) | Caller's own RLS-scoped profile | `feedback` (count), `profiles` (admin recipients — was a latent cross-tenant email leak; a correctness-under-change risk, not a live one at single-org scale) |
| `app/api/household/link-member/route.ts` | Household manager updating another profile's `family_id` (RLS blocks cross-profile writes) | Caller's own RLS-scoped profile; target's org asserted equal | `profiles` update on `(id, org_id, family_id IS NULL)` |
| `app/api/events/[id]/ics/route.ts` | Bearer-token calendar subscription; no session | `calendar_subscription_tokens` row (`org_id` stamped at issuance); the owner's membership of the event's group re-checked | `events` (404 on cross-org id; a moved date's series row read on `(id, org_id, group_id)` for its meeting details and calendar sharing; a series' exception rows on `(series_id, org_id, group_id)`), `organizations` `.eq("id", org_id)` (time zone), `group_settings` on `(org_id, group_id)` (the group's calendar sharing defaults), `group_members` (404 when the owner is not in the event's group), `profiles` (owner), token expiry update |
| `app/api/admin/email-domain/route.ts` | Every method 404s before auth while `CUSTOM_SENDING_DOMAINS_ENABLED` (`lib/email/sendingDomains.ts`) is false. GET reads `organizations.custom_email_domain_enabled` through the service client; the admin's request client has no SELECT grant on that column. The `org_email_domains` row is read through the request client. POST gates on that flag, then claims the row through `org_email_domain_claim()` — the `service_role`-only RPC (see the "Email domain claim RPC" section above) that enforces the platform-wide domain cap atomically, so the route no longer holds an unscoped count read — then Resend `domains.create` returns `resend_domain_id`/`status`/`dns_records`, columns the admin's own client has no UPDATE grant on — the write must happen server-side (CWA-70 / #363); when the follow-up write fails and the Resend removal also fails, the row is kept as `status = 'cleanup_pending'` (server-set-only columns again) rather than deleted. DELETE now removes the Resend domain first and needs the same server-set-only writes when that fails | The caller's own RLS-scoped `profiles.org_id`, read on the request client; the `organizations` reads take `.eq("id", orgId)` (tenant root); the insert carries that `org_id` in its payload, and every subsequent read/write is predicate-scoped `.eq("org_id", orgId)` / `.eq("id", ...).eq("org_id", orgId)` | `organizations` `.eq("id", orgId)` (flag); `org_email_domains` existing-row select `.eq("org_id", orgId)`, unscoped head count (org-anchor), insert (payload: `org_id`, `domain`), update (`resend_domain_id`, `status`, `dns_records`, `cleanup_failed_at`) and rollback/remove deletes on `(id, org_id)` |
| `app/api/admin/email-domain/verify/route.ts` | 404s before auth while `CUSTOM_SENDING_DOMAINS_ENABLED` is false. POST handler: the `status`/`verified_at`/`last_checked_at` transition must not be writable by the admin's own client (same column grants as above) | The caller's own RLS-scoped `profiles.org_id`, read on the request client; target row fetched `.eq("org_id", orgId)` before any write | `org_email_domains` select `.eq("org_id", orgId)` + update on `(id, org_id)` |
| `app/api/platform/organizations/[id]/email-cap/route.ts` | Daily email cap override (CWA-72): `org_email_limits` is platform-operator-owned with no permissive policy, so only a service-role write can reach it — an org that can raise its own cap does not have a cap | Platform-admin authority; org id from the route param, validated against an existing `organizations` row before the write | `organizations` `.eq("id", id)` (existence check); `org_email_limits` upsert carrying the validated `org_id`, zero-row-checked |
| `app/api/platform/organizations/[id]/email-domain-cleanup/route.ts` | Platform-admin retry of a stuck Resend domain removal: the org's `org_email_domains` row is scoped to that org's own admins, so a platform operator finishing the cleanup from `/platform` needs the service client for both the read and the delete; the row's `cleanup_failed_at` is a server-set-only column besides | Platform-admin authority; org id from the route param, validated against an existing `organizations` row before any `org_email_domains` access | `organizations` `.eq("id", id)` (existence check); `org_email_domains` select `.eq("org_id", org.id)` (must be `cleanup_pending` with a `resend_domain_id`), update on `(id, org_id)` on a failed retry, delete on `(id, org_id)` zero-row-checked after Resend confirms removal |

## Lib helpers (6 sites)

Unlike the rows above — inherited from Phase 2 with their mitigations still
outstanding — this site was introduced *during* Phase 3 with its mitigation
already shipped. The "once org_id lands" framing does not apply; the risk
column below describes what a regression would cost, not a pending work item.

| File | Why service-role is used | Tenancy risk | Mitigation |
|------|--------------------------|--------------|------------|
| `lib/account/deletion.ts` | `deletePerson(orgId, personId, actorId?)` and `loadDeletionSummary(orgId, personId, viewer)` — the one path that deletes a person, from `DELETE /api/account` (themself) and `DELETE /api/admin/members/[id]` (a church admin). `delete_person()` is granted only to `service_role`. After it commits, and after the response, the team-lead notices read other people's rows. The confirmation reads a person's leaders and refusal flags, and their fund and household outcomes from `person_deletion_outcomes()` (granted only to `service_role`), which RLS would refuse a church admin or a member | A wrong org would delete a person in another church, or show a church admin group content from it | `orgId` comes from the caller's own RLS-scoped profile (`currentPerson()` or `requireOrgAdmin()`), never the request, and `delete_person()` compares it with the target's own row. A self-delete's `personId` is the session's user id. Every read filters `org_id` except `platform_admins`, which has none and is keyed on a target already read inside the org. A church admin's summary carries counts, not fund or group names |
| `lib/account/export.ts` | `buildAccountExport(orgId, personId)` — a person's own download. `prayer_requests.author_id` has no column grant for `authenticated`, so an anonymous request can only be matched to its author here; memberships and RSVPs in groups the person has left aren't RLS-readable either | A dropped filter would put another person's data in the file | `orgId` and `personId` come from `currentPerson()`, the session and its RLS-scoped profile, never the request. Every chain filters `org_id` and this person, the household id read off their own profile row, or, for `access_requests`, the address on that row, matched exactly and case-insensitively. Unclaimed household entries are the one place other people appear, with their names and birth dates, because nothing records who typed them; entries claimed by someone else are excluded, and no other selected column names anyone else |
| `lib/storageDelete.ts` | `removeAvatarObjects(orgId, keys)` — removes a deleted person's photos after `delete_person()` commits. There is no browser session by then, and a key from before org partitioning is unreachable by every RLS-constrained client | The client ignores the org partition on `storage.objects`, so a wrong key would remove another church's object. The guard flags this chain, since it is rooted at a service client, but its marker only records the reason and no check can see the key's value | The module owns its client and accepts none. `orgId` comes from the caller's validated anchor, and a key under another org is refused and reported as still stored. The keys come from `delete_person()`, which finds them from row ids it has already scoped to the org, never from a stored URL column the row's owner can write. This and the operator script are the only service-role `.storage.from(` call sites |
| `lib/email/identity.ts` | `resolveEmailBranding(orgId)` — `orgId` is **required** — reads `organizations.branding` for callers that hold an explicit org id but no request-scoped session (e.g. `lib/serving/server.ts`, invoked from HMAC-signed link flows), and a second, org-scoped read of `org_email_domains` to resolve the per-org `From:` address. The link origin (`EmailBranding.baseUrl`) is the app's one canonical host, `siteConfig.url`, and needs no read. The genuinely request-scoped case is the separately named `resolveRequestEmailBranding()`: it resolves the org id via `resolveRequestOrgId()` on the cookie-bound request client, then runs the same service-role `org_email_domains` read for it — it has no live caller today and exists so that path must be typed out, never reached by omitting an argument | A missing filter on either table would leak another org's branding or sending domain into an email | The `organizations` read's `.eq("id", orgId)` and the `org_email_domains` read's `.eq("org_id", orgId)` are the only tenant boundaries, both mandatory; `orgId` is always either the caller's already-authorized id or the value `resolveRequestOrgId()` resolves for the current request — never a header, never a body field. `SENDING_DOMAIN` additionally gates the stored domain value itself (with `status = 'verified'`) before it can reach a `From:` header — see CLAUDE.md's injection-boundary list. Branding on the request-scoped path still comes from the request-scoped client, so RLS applies — but that resolves to the *request* org, which can differ from the row's org, so any caller holding an authorized `org_id` must pass it. |
| `lib/email/quota.ts` | `reserveEmailQuota(orgId, n)` calls `email_quota_consume()` — a `service_role`-only RPC (see the "Email quota RPC" section above), so the service client is the only client that can execute it | The `.rpc()` call is invisible to the guard (it walks `.from()` chains only), so a refactor could silently pass an unvalidated org id | `orgId` must come from an anchor the caller already validated — the caller's RLS-scoped profile (`app/api/feedback`), the RLS-checked group row (`app/api/serving/broadcast`), the already-authorized `opts.orgId` both `notifyLeadersOfCancel` callers hold, or the org id `sendFirstAdminInvite()` (`app/api/platform/organizations/firstAdminInvite.ts`) holds: the id `provision_organization()` returned, or the route param behind `requirePlatformAdmin()` — never a header or body field. Fail-closed: any RPC error or throw is a refusal, never "send anyway" |
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

## Edge Functions (3 sites)

All three run with no session context and resolve the service key
from configured environment variables: a manual `SUPABASE_SECRET_KEY` override
(local/self-host only — the hosted platform reserves the prefix), then the
platform-injected `SUPABASE_SECRET_KEYS` map, then the legacy
`SUPABASE_SERVICE_ROLE_KEY` (see `resolveServiceKey()` in
`supabase/functions/_shared/service-key.ts`, shared by all three), not
`createServiceClient()`. All three are cron-triggered.

Tenant iteration is `listActiveOrgs()` (`supabase/functions/_shared/orgs.ts`),
with `forEachOrg()` for the reminder functions. `listActiveOrgs()` filters
`organizations` on `.eq("status", "active")`, so a **suspended org is
skipped** — a suspended tenant must not email its members. This is currently
the only place `organizations.status` changes what happens *to a tenant*: it
gates no access path and no org helper consults it, so suspending an org
stops its reminder email and its nightly cleanup, and nothing else. The platform surfaces in the
table above do read and write the column — `app/platform/page.tsx` and
`app/platform/organizations/**` display it, and the platform org route sets
it — but that is the operator UI reporting and editing the flag, not the
flag enforcing anything (see
[`tenancy-model.md`](tenancy-model.md), Known limits).

`send-event-reminders` runs in the mode its cron body names
(`{"mode":"dates"}`, `_shared/event-reminders.ts`). Per church from
`listActiveOrgs()`, it makes three reads of `events` (repeating events,
rows starting within a week, and dates edited or deleted on their own), a
fourth by `id` for the series of a date it read whose series row starts
later than that week, and one of `group_settings` (the groups that turned reminders off), each on
`org_id`, bound to `org.id` from the `forEachOrg()` callback; works out the
dates due in pure code (`_shared/event-reminder-due.ts`,
`_shared/event-dates.ts`); and calls `event_reminder_claim()` once per date
with `_org_id` bound to the same `org.id`. Every send is claimed in that
call before Resend is called, reserves one place against the church's daily
email cap just before it is mailed, carries an `Idempotency-Key` built from
the record's key, and is settled on `event_reminder_sends` with `org_id`
(again `org.id`), `event_id`, `occurrence_date` and `profile_id`. A firing
stops starting sends at a time budget and releases what it claimed; the
16:00 and 17:00 firings finish it. `tests/event-reminders_test.ts` asserts
the org on every chain and call against a recording fake, and
`tests/event-reminder-due_test.ts` the due rules on both sides of each
bound and across both clock changes.

With no body, or a body that names no mode, the function runs as it did
before the sent record: it
lists the org's groups through `listGroups()` (`_shared/groups.ts`), reads
each group's events on `org_id` + `group_id`, and resolves recipients through
`resolveEventReminderRecipients()` (`_shared/event-recipients.ts`): RSVPs
∩ current `group_members` of the event's group → non-pending profiles with
an email. That mode exists only for a function deployed ahead of the
migration that schedules the dates mode, and goes once a release has run on
it. A body that names any other mode, or does not parse, is refused
with 400 and nothing is read or sent (`reminderMode()`). A failing group is recorded in `failedItems[]` keyed by `group_id` and
the org's other groups still run. `send-serving-reminders` keeps its team loop,
reads `teams.group_id` with the team name, and resolves the serving link
mode per group through `resolveGroupLinkMode()` (`group_settings`, on
`org_id` + `group_id`, memoised per org run); every `serving_*` query is on
`team_id`, and both its reminder and its open-date emails skip pending
profiles. Both shared modules are pure, with recorded-chain tests under
`supabase/functions/tests/`.

The serving reminders run hourly (`_shared/serving-hourly.ts`). Each firing
decides from the church's clock alone whether any team could be due, so a
church outside 6 AM to 10 PM costs no query; a church inside it costs one
`serving_team_settings` read with its `teams` and today's
`serving_reminder_passes` and `serving_reminder_sends` embedded (FK
traversals from the org-filtered parent); and only teams due with a reminder
still unsent reach `serving_reminder_claim()`, one call per church with the
church's id from `listActiveOrgs()`. Every send is claimed in that call before
Resend is called, reserves one place against the church's daily email cap
just before it is mailed (so a claim released unmailed costs nothing),
carries an `Idempotency-Key` built from the record's key,
and is settled on `serving_reminder_sends` with `org_id`, `team_id`,
`send_date` and `profile_id`. The run stops starting new teams at a time
budget and leaves the rest to the next firing; the record keeps that safe.
`tests/serving-hourly_test.ts` asserts the query count per church against a
recording fake, and `tests/serving-due_test.ts` the due rules across both
clock changes.

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
wall clock rather than the runtime's (UTC), and `send-serving-reminders` reads
the date a run acts on through `reminderRun()` in `_shared/serving-dates.ts`.
The database stores only exact
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
| `supabase/functions/send-event-reminders/index.ts` | Cron job; reads events and sends reminders with no user session | Reminder fan-out iterates all rows across orgs | Refuses any caller but a service key. **Implemented (Phase 3, #212):** iterates active orgs via `_shared/orgs.ts`, every query filtered on `org_id`, per-org failures isolated so one org cannot suppress another's send. **Dates mode:** events read on `org_id`, the dates due worked out in pure code, and each date's recipients chosen and claimed in `event_reminder_claim()` with `_org_id` from the same iteration; per-event failures in `failedItems[]`. **Deploy-window mode** (a body with no mode): org → group iteration, events on `group_id`, recipients gated on current group membership, per-group failures in `failedItems[]`. **Branding (CWA-56, #322):** `organizations.branding` rides along on the already-org-anchored `listActiveOrgs()` select — no new service-role call site, no new unscoped query — and is validated by `_shared/branding.ts` (a mirror of `lib/branding.ts` + `lib/email/identity.ts`) before reaching any CSS or RFC 5322 sink. **Link origin:** every link is built on the one canonical host (the `SITE_URL` function secret) — no query. **Time zone:** `organizations.timezone` rides along on the same `listActiveOrgs()` select and formats the reminder's event time |
| `supabase/functions/send-serving-reminders/index.ts` | Cron job; reads serving signups and emails assignees with no user session | Same as `send-event-reminders` | Refuses any caller but a service key. **Implemented (Phase 3, #212):** same per-org iteration and `org_id` filters; `resolveCanSign` org-scoped; `serving_broadcasts` audit rows stamped with the processed row's org, not a constant. **Branding (CWA-56, #322):** same `listActiveOrgs()` ride-along, validated by `_shared/branding.ts`. **Link origin:** the same canonical `SITE_URL`, threaded into every cancel/signup/team-page link. **Per-team isolation (CWA-50, #316):** a failing team is recorded in the run summary's `failedItems[]` keyed by `team_id` — ids, never org-defined team names, in operator diagnostics. **Group scope:** the link mode is per group (`group_settings` through `_shared/groups.ts`), every `serving_*` query is on `team_id`, and links open `/g/<group_id>/serving/<team_id>` |
| `supabase/functions/clean-up-expired-data/index.ts` | Cron job; deletes expired requests, invites, feedback, serving and event reminder passes older than 35 days (through `serving_reminder_passes_prune()` and `event_reminder_passes_prune()`, at most 500 per call, their sends through the foreign key) and, for a church that opted in, prayer requests, with no user session | A delete missing its filter removes another church's data for good | Refuses any caller but a service key. Iterates active orgs, one org-filtered delete per rule, failures isolated per step and per org. The rules and their boundaries are unit-tested in `tests/retention_test.ts` and `tests/cleanup_test.ts` |

All three check their own caller first, because each acts unattended: the
reminder jobs send email that cannot be recalled, and the cleanup job deletes
data that cannot be restored. The gateway's JWT check does not stand in for this,
since it also passes tokens that are not the scheduler's. Each handler is wrapped in
`serviceKeyCallerOnly()` (`_shared/caller-auth.ts`), so nothing in it runs until
`isServiceKeyCaller()` has compared the bearer token with every service key in
the environment; anything else gets a 401 and a log line that names no token.
Every key, because the vault's `cron_service_role_key` may not be the one
`resolveServiceKey()` picks. A 401 in `net._http_response` means the vault key
matches none of them, and nothing was sent or deleted. pg_cron, through
`private.schedule_edge_reminder()`, is the only caller of these functions.

`cleanUpOrg()` (`_shared/cleanup.ts`) runs one delete per rule, each
with `.eq("org_id", orgId)` bound to an id from `listActiveOrgs()`, and reads
the church's setting with `.eq("id", orgId)` on the tenant root. It logs and
returns per-org counts only; a step that fails is reported with a 500, never as
a zero, and the church's other rules and the other churches still run. The
counts are rows the deletes matched: `group_invite_uses` and `prayer_responses`
go with their parent through the foreign key and are not counted. It never
deletes an `organizations` row.

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
