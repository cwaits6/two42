# Tenancy Model

Phase 2 of the multi-tenancy rearchitecture (CWA-9 /
[#211](https://github.com/cwaits6/two42/issues/211), epic #209–#214) made
`org_id` the **database-enforced** tenant boundary. This document describes
the invariant, the pieces that enforce it, and the contracts later phases
must not break.

## The invariant

> A member of org A cannot read, write, reference, or infer any row
> belonging to org B — through a table, a view, a `SECURITY DEFINER`
> helper, a foreign key, or a signup.

Isolation is a property of the schema, not of application discipline. It is
proven continuously by `supabase/tests/tenancy_leak_suite.sql` against two
fully-seeded orgs, with per-table fixture-completeness assertions so a green
run can never be vacuous.

## Org resolution — the two helpers

| Helper | Resolves | From |
|---|---|---|
| `app_current_org_id()` | the calling principal's org | the caller's own `profiles.org_id` — server-owned state only |
| `app_request_org_id()` | the org a request is *about* | the principal's org, the same as `app_current_org_id()`; NULL for anonymous callers. Kept as the policy-facing name every isolation policy cites |

Rules that make these safe:

- Both are `STABLE`, `SECURITY DEFINER`, `set search_path = ''`. Every call
  site wraps them as `(select public.app_…())` so the planner evaluates
  them once per statement (InitPlan), not per row.
- **Fail-closed by construction.** No principal ⇒ NULL ⇒ `org_id = NULL`
  is not TRUE ⇒ rows filtered on read, rejected on write. There is no "no
  org means everything" branch anywhere, and no header can name an org.
- **Anonymous entry points are token rows.** Nothing anonymous resolves an
  org through the helpers: `/setup-account` (the `access_requests.signup_token`
  row), `/join/family/[token]` (the `family_invites` row), `/serving/go`
  (the HMAC-validated `teams` row) and `/join/[token]` (the `group_invites`
  row) each read their row on the service client under an `// org-anchor:`
  marker, fail closed on a lookup error and on no row, and scope everything
  after it to that row's `org_id`.
- **Deliberately no GUC override.** Any role can `set_config()` an
  arbitrary GUC; a trusted service-role override, if ever needed, belongs
  to Phase 3 and must be gated on `auth.role() = 'service_role'`.
- **The app serves one canonical host, and the host never names an org.**
  `lib/supabase/middleware.ts` runs a single expected-host check
  (`isExpectedHost()` in `lib/org.ts`) before any client is built: the
  `NEXT_PUBLIC_SITE_URL` host, plus the closed static set a deployment is
  also reached on (`localhost`, `127.0.0.1`, `*.vercel.app`). Any other
  `Host` — an org subdomain, an unrelated domain — gets a 404 with no app
  response at all. There is no host → org mapping anywhere: no subdomain
  classification, no custom-domain registry, no resolver RPC.
- No app Supabase client (server, browser, middleware) sends an org header
  of any kind, and `createClient()` takes no org argument. A session is the
  only thing that resolves an org through the helpers; the pre-login
  surfaces are the token rows above.
- The app-layer complement is **`resolveRequestOrgId()`** (`lib/org.ts`):
  the single fail-closed helper that resolves a request's org through
  `app_request_org_id()` for a caller that holds a session but no org id of
  its own (`lib/uploadImage.ts`, `lib/email/identity.ts`). It fails closed
  on both failure modes — an RPC error, and an RPC success returning NULL —
  logging each, so its callers refuse the upload or send from the platform
  address instead of falling back to an org.

Also, `org_id` on every org-owned table is `NOT NULL DEFAULT
app_current_org_id()`: a write with no session and no explicit org violates
NOT NULL instead of landing in the wrong tenant.

## The restrictive isolation floor

Every org-owned table carries exactly one policy:

```sql
create policy "org isolation" on public.<table>
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));
```

Postgres ANDs restrictive policies with the OR-combined permissive ones, so
isolation holds even if a permissive policy — today's or a future one —
forgets its org predicate. `WITH CHECK` also blocks re-tagging a row's
`org_id`. `organizations` (the tenant root, no `org_id`) carries the same
restrictive floor with row visibility restricted by
`id = (select public.app_request_org_id())` — its own row *is* the org, so
the primary key stands in for `org_id`. Since Phase 3
(`20260801000002_org_branding_backfill.sql`) it also carries a permissive
SELECT policy, `"Org readable within request org"`, granted to `anon` and
`authenticated` and repeating the same predicate rather than a bare `true`.
Postgres RLS grants nothing without a permissive policy, so before that
migration the table was readable by no PostgREST caller in the seeded org at
all and the app silently served env-var branding. The older `"org members can
view their orgs"` policy is gated on `organization_members`, which
`handle_new_user()` has populated only since `20260731000014` and which was
never backfilled — it grants nothing to profiles predating that migration and
is retained as the hook for the Phase 4 membership model.

The permissive policies are additionally rewritten as
`ORG AND (role arms)` — org predicate factored out front exactly once — for
readability and per-org semantics. No `USING (true)` remains on any
org-owned table; the former blanket-public reads (page content, lectures,
series, calendars) are org-resolved anon reads now.

**There is deliberately no platform-admin escape hatch** in the restrictive
predicate. The Phase 4 cross-org path exists now (`/platform`, CWA-11
stream 1), and it is **service-role in the app layer, not a widened
policy**: every surface gates on `getPlatformAdmin()` /
`requirePlatformAdmin()` (`lib/platform-access.ts`, resolved through the
cookie-bound request client, fail-closed on RPC error) and then reads
`organizations` — the tenant root — via `createServiceClient()`, filtering
the one org-owned table it touches (`access_requests`) on the target
`org_id` explicitly. `supabase/tests/platform_org_lifecycle_suite.sql`
carries its tests. Adding `or is_platform_admin()` to the restrictive
predicate would put a cross-tenant `OR` arm on every org-owned table
forever; do not. Service-role and `postgres` bypass RLS entirely
(`BYPASSRLS`); that surface is inventoried in
[`service-role-inventory.md`](service-role-inventory.md).

## Composite foreign keys

Every FK whose parent is an org-owned table is composite:
`(fk_col, org_id) references parent (id, org_id)` — a child row can never
reference a parent in another org, structurally. `ON DELETE SET NULL`
relations use PG ≥ 15's column-list form `set null (<col>)` so `org_id`
(NOT NULL) survives the parent's deletion. There are fifteen such
relations; the pgTAP FK suite proves the runtime behavior for the seven
capability/entity ones, and the schema lint structurally asserts — for
every FK, current and future — that a `SET NULL` action on an
`org_id`-carrying FK names a column list excluding `org_id`, so dropping
the column list on any of them fails CI. FKs referencing `auth.users`
cannot be composite (no `org_id` there). `organization_members.profile_id`
is deliberately single-column, and is the composite-FK check's one named
exemption (`organization_members_profile_id_fkey` in
`schema_tenancy_lint.sql`): the membership org is intentionally independent
of the profile's pinned org — the seam the Phase 4 platform-admin
authorization contract builds on.

## Group model — the first within-org boundary

The org exists to hold people; everything members do together belongs to a
**group**. Four layers, one permission role per layer above "member":

| Layer | Table(s) | Holds | Role |
|---|---|---|---|
| Org | `organizations`, `profiles`, households | people, membership approval, branding, the two giving settings | org admin |
| Group (a class or small group) | `groups`, `group_members`, `group_settings` and every content table | the content layer: calendar, announcements, lectures, about, prayer, giving, serving, roster | leader (`group_members.role = 'leader'`) |
| Team (inside one group) | `teams`, `team_members` | serving signups, reminders, `serving_team_settings` | team lead (`team_members.is_leader`) |
| Label (inside one group) | `group_labels`, `group_member_labels` | a filter tag on a group membership | none — labels are attributes |

`teams` is the renamed `member_groups` and `team_members` the renamed
`profile_groups` (`team_members.group_id` → `team_id`); every team carries a
required `(group_id, org_id)` composite FK into `groups`. The serving tables'
team columns (`serving_signups`, `serving_broadcasts`,
`serving_team_settings`) are named `team_id`, so `group_id` means a group
everywhere it appears. Groups stay one level deep — no sub-groups, no
sub-orgs.

**Membership-based RLS.** The org isolation floor above is unchanged; the
group tables add the first predicate that narrows visibility *within* an
org. Every permissive policy on the four group tables composes as
`ORG AND (arms)`:

- read: `org_id = (select app_request_org_id()) and (is_admin() or
  is_group_member(group_id))` — plus an own-rows arm on `group_members`
  (`profile_id = auth.uid()`) so a member can resolve their own memberships
  before any group context exists;
- write: `org_id = (select app_request_org_id()) and (is_admin() or
  is_group_leader(group_id))`; group *deletion* is org-admin only, and
  creation goes through `group_create()` under the org's
  `group_creation_policy` (see "Group creation" below) — the "Admins can
  insert groups" policy stays but nothing in the app uses it.

`is_group_member(_group_id)` and `is_group_leader(_group_id)` read
`group_members` for `auth.uid()` **only** — the argument names the group,
never the principal — and carry `org_id = app_current_org_id()` so a
membership row in another org never counts. They are `SECURITY DEFINER`,
`set search_path = ''`, EXECUTE granted to `authenticated` and revoked from
`anon`. They take a row-dependent argument, so unlike the zero-argument
helpers they cannot be InitPlan-hoisted and are called bare in policy
expressions. `is_team_lead(_team_id)` is the former `is_group_leader` (which
read `profile_groups.is_leader`, i.e. had team semantics); the seven serving
policies and `serving_signup_create()` call it under the new name.

`group_member_labels` is same-group by construction: both of its FKs are
three-column — `(group_member_id, group_id, org_id)` into `group_members`
and `(label_id, group_id, org_id)` into `group_labels` — so a label can only
ever be attached to a membership of the group that defines it, before RLS
is consulted. Labels are written only through the cookie-bound client under
these policies (Group settings › Labels and the roster's Edit and Select
modes); no service-role or `SECURITY DEFINER` path touches them, so the
service-role inventory carries no entry for them.

### Group visibility

Every content table carries `group_id uuid not null` with a composite
`(group_id, org_id)` FK into `groups`: `events`, `event_calendars`,
`announcements`, `lectures`, `lecture_series`, `about_page` (keyed by
`group_id`, one row per group), `class_teachers`, `prayer_requests`,
`prayer_responses`, `prayer_call_sessions`, `giving_funds`,
`giving_fund_methods` and `group_settings`. The column has **no DEFAULT**:
there is no fail-closed group resolver the way `app_current_org_id()` is one
for the org, so NOT NULL is the guard — a write path that forgets the group
fails with `23502` rather than landing in a wrong group.

The permissive arms compose on the org floor as:

- read: `org_id = (select app_request_org_id()) and
  is_group_member(group_id)` — published announcements for members, drafts
  for leaders; a prayer request is readable by every member of its group;
- write: `org_id = (select app_request_org_id()) and
  is_group_leader(group_id)`, or the existing author rule
  (`prayer_requests`, `prayer_responses`) or steward rule (`giving_funds`,
  `giving_fund_methods` through `giving_can_manage_fund()`, which now reads
  the fund's group).

**Org admins are not implicit members.** `is_admin()` appears in no content
policy: an org admin reads a
group's content only as a member of it and edits it only as a leader of it.
The admin arm survives on `groups`, `group_members`, `group_labels`,
`group_member_labels`, `teams` and `team_members` only — the people layer.
Org admins manage people from Admin; the only UI for teams and labels is
Group settings, which a leader of the group reaches.

**`content_editor` is retired.** `profiles_role_check` allows only `pending`,
`member` and `admin`; the rows that held `content_editor` were moved to
`member`, and `is_content_editor()` is gone. No policy, function or view
names the value (`retired_content_editor_suite.sql`). `toUserRole()` in
`lib/roles.ts` still maps a stored `content_editor` to `member`; that entry
can go once this migration is live, since no row can hold the value after it.

Rows that reach a group through a parent do so under the caller's own RLS
rather than carrying a column: `rsvps` through `exists (select 1 from
events e where e.id = rsvps.event_id)`, so a member RSVPs to and sees RSVPs
on exactly the events they can see; `serving_signups`,
`serving_signup_attendees`, `serving_broadcasts` and
`serving_team_settings` through `exists (select 1 from teams t where t.id
= <row>.team_id and t.org_id = <row>.org_id and is_group_member(t.group_id))`
— one FK hop, the shape `team_members` writes already used. The team-lead
arms (`is_team_lead(team_id)`) stay beside the group-leader arms, and
`serving_signup_create()` re-checks the same three arms before delegating.
Those arms are sound only because a team member is always a member of the
team's group: `team_members_require_group_membership` refuses any other
row (including an org admin enrolling themselves through the admin arm),
and `group_members_leave_teams` removes a departing member from the group's
teams, so no serving row stays reachable through a membership that no
longer exists.

Where both sides of a parent→child FK carry `group_id`, the FK is
three-column — `events.calendar_id`, `events.series_id`,
`lectures.series_id`, `prayer_call_sessions.event_id`,
`prayer_responses.request_id`, `giving_fund_methods.fund_id` — so a member
of two groups cannot file a child under group B for a group A parent; the
`on delete set null (<col>)` column-list form keeps `org_id` and `group_id`
intact on a parent delete. `about_page` is keyed by `group_id` and
`class_teachers` is unique on `(group_id, profile_id)`, so the same person
may lead in two groups.

**One calendar per group.** The group is the calendar: `event_calendars`
carries `group_id`, the backfill folded every pre-existing calendar of an
org into its group's single calendar (events re-pointed, extra rows
deleted, counts asserted), and the app resolves "the group's calendar" as
the earliest row by `created_at` (`getGroupCalendar()` /
`ensureGroupCalendar()` in `lib/groups/calendar.ts`). The calendar's color
is the group's color: six-digit hex at the column (`event_calendars_color_hex`,
default Clay `#B85C38`), re-checked by `HEX` in the membership loader before
it reaches CSS, and validated on the write path by `validateGroupColor()`
for 4.5:1 against white or Espresso text — the chip text color follows.

**`group_settings`** holds the per-group video call, prayer call and serving
link mode (one row per group, created on first save). The org-level
`site_settings` keys they replace, plus `prayer_calendar_id` and
`directory_app_url`, were deleted; `site_settings` keeps only the two
giving keys. The anonymous read arms on `lectures`, `lecture_series`,
`event_calendars` and published `announcements` are gone: `is_group_member()`
is false for anon by construction, and the middleware already sends those
paths to login.

The backfill lives in `group_content_backfill()` (plain `plpgsql`,
idempotent, no client grant), mirroring `group_model_backfill()`, so
`supabase/tests/group_scope_suite.sql` proves the calendar fold and the
boundary against fixture groups in CI. Ungrouped rows go to the org's oldest
group: production has exactly one group per org, and a local stack seeded
with several keeps its pre-existing content under the first one.

**The one-group backfill.** The migration gives every existing org one
group named from `branding.display_name` (fallback: the org name), enrols
every profile with `role <> 'pending'`, makes every org admin a leader, and
attaches every existing team to it — with before/after row-count
assertions that abort the migration on any mismatch. The logic lives in
`group_model_backfill()` (plain `plpgsql`, idempotent, no client grant) so
`supabase/tests/group_model_suite.sql` can prove it against fixture orgs in
CI, where migrations run against an empty database.

### Directory visibility

The people layer has its own within-org boundary
(`20261018000000_directory_visibility.sql`): a member reads another
member's profile when they share at least one group, or when the org admin
has opened the directory to the whole organization. The setting is a typed
column, `organizations.directory_visibility text not null default
'shared_groups' check (in ('shared_groups', 'org'))`, because RLS reads
it — it is a security boundary, not a preference, and a `site_settings` key
would not be one.

The three SELECT policies keep their names and their `ORG AND (arms)`
shape. `profiles` ("Profiles are visible per access rules"): self, org
admin, own household (`is_member()`-gated, as before), or the directory
arm — `is_member() and is_unlisted = false and role in (member, admin)` **and**
`(org_directory_visible() or shares_group_with(id))`. `family_units`
("Members can view family units") and `family_members` ("Members can view
family members"): org admin, own household (`is_member()`-gated, so a
pending account linked by a family-invite claim still reads neither table),
or `is_member() and (org_directory_visible() or
shares_group_with_household(<family id>))`.
The three directory views are `security_invoker` and narrow with the base
tables; nothing else changed.

The helpers are `SECURITY DEFINER`, `STABLE`, `set search_path = ''`,
EXECUTE revoked from `anon` and granted to `authenticated`:

- `org_directory_visible()` — the caller's own org row
  (`id = app_current_org_id()`) has `directory_visibility = 'org'`. Zero
  arguments, so policies wrap it `(select ...)` and it is an InitPlan.
- `shares_group_with(_profile_id)` — one self-join on `group_members`:
  a row for `auth.uid()` and a row for the given profile in the same group,
  both carrying `org_id = app_current_org_id()`.
- `shares_group_with_household(_family_id)` — the same, for any profile
  whose `family_id` is the given household.

Like `is_group_member()`, the two row-dependent helpers are called bare in
the policy expressions; a correlated `(select f(id))` is not an InitPlan.
The caller is always `auth.uid()`; the argument names the other person or
household, never the principal.

**A one-group org sees no change.** The group-model backfill enrolled every
approved member of such an org into its one group, so `shares_group_with()`
is true for every pair of approved members and the directory arm reduces
to the old one. To keep that true for members approved later,
`handle_new_user()` enrols a non-pending signup into the org's group when
the org has exactly one (`role = 'member'`); with zero or several groups it
enrols nobody. A family-invite signup lands as `pending` and is promoted by
the claim route, which does not enrol.

**Consequences stated on purpose.** A household visible through a shared
group lists only the profiles the viewer may read, so a spouse who is in
no shared group is absent from that household's card. Linking a household
member by search (`app/api/household/search-members/route.ts`) and the
giving steward picker (`loadFundFormData()` in `lib/giving/server.ts`)
find only people the viewer may read; both are whole-org again under
`'org'`. `family_invites` stays `is_member()`-wide.

**The write path.** `organizations` had Supabase's default table-level
UPDATE grant and no permissive write policy. The migration revokes that
grant from `anon` and `authenticated`, grants `update
(directory_visibility)` and `select (directory_visibility)` to
`authenticated` only, and adds the one permissive UPDATE policy — "Admins
can set org settings", whole-row `id = app_request_org_id() and
is_admin()` (created as "Admins can set directory visibility" and renamed
when `group_creation_policy` joined it). The column grants, not the policy,
are what keep an org admin away from `name`, `status` and
`custom_email_domain_enabled`; `branding_rls_suite.sql` pins both halves
and `directory_visibility_suite.sql` pins the read matrix, the helper
truth table, the signup enrolment rule and the admin-only write.

### Group creation

Who may start a group is an org setting read by RLS and by a definer
function, so like directory visibility it is a typed column:
`organizations.group_creation_policy text not null default 'approval'
check (in ('open', 'approval', 'admins'))`
(`20261025000000_group_creation.sql`). `open`: any approved member creates a
group and it is live at once. `approval`: a member files a request an org
admin approves. `admins`: org admins only. `anon` has no grant on the
column; `authenticated` reads and (through the single org-settings UPDATE
policy above) the org's own admin writes it.
`org_group_creation_policy()` is the zero-argument `SECURITY DEFINER`
reader, shaped like `org_directory_visible()`: the caller's own org row,
NULL for anyone without one, so every comparison fails closed.

**Requests are rows of their own.** `group_requests` (`org_id` default
`app_current_org_id()`, the restrictive isolation floor, composite FKs
`(requested_by, org_id)` into `profiles` and `(group_id, org_id)` into
`groups` with `on delete set null (group_id)`) holds a pending request
rather than a `status` column on `groups`, so nothing that treats a
`groups` row as a live group — the one-group signup enrolment in
`handle_new_user()`, `group_content_backfill()`, the directory helpers, the
one-calendar-per-group invariant — needs a new predicate. Its permissive
policies compose on the floor as `ORG AND (arms)`:

- read: the requester (`requested_by = auth.uid()`) or an org admin;
- insert: the requester themselves, `is_member()`, `status = 'pending'`
  with no reviewer, timestamp or group, **and**
  `org_group_creation_policy() = 'approval'` — the policy, not the UI, is
  what keeps a request out of an open or admins-only org;
- update: org admins, on `status = 'pending'` rows only, with a `WITH CHECK`
  of `status in ('pending', 'declined')` so `'approved'` is unreachable by a
  plain UPDATE and a decided request cannot be re-decided (a stale decline
  after an approval matches zero rows). Decline is that UPDATE; approval is
  the RPC below. No DELETE policy: a declined row is the record.

**Creation is a `SECURITY DEFINER` RPC, not widened RLS.** A group needs
three rows — `groups`, its leader's `group_members` row and its one
`event_calendars` row — and the browser cannot write them in one
transaction, so `group_create(_name, _description, _leader_id)` and
`group_request_approve(_request_id)` do, over an un-granted plpgsql core,
`group_create_for(_org, _name, _description, _leader, _created_by)`. The
org checks in their bodies replace the isolation policy on this surface:

- both entry points resolve the org **from the caller's own `profiles`
  row** (`auth.uid()`, not pending), never from a parameter;
- `group_create()` lets an org admin name any leader, refuses a non-admin
  who names anyone but themselves (`GC005`), and refuses a non-admin unless
  the org's policy is `'open'` (`GC001`);
- `group_request_approve()` requires the caller to be an org admin
  (`GC005`) and looks the request up by id **and** that org, so a foreign
  id is the same `GC004` as a missing one;
- the core asserts the leader is an approved member of that org (`GC003`)
  before writing, and every row it inserts carries that `org_id`.

`GC002` is no principal or a pending account; `GC006` a blank name. Grants:
EXECUTE on the two entry points and the reader revoked from `public` and
`anon`, granted to `authenticated`; the core revoked from everyone
including `service_role`. `schema_tenancy_lint.sql` check 4 only sees that
the bodies mention `org_id`; `supabase/tests/group_creation_suite.sql` pins
the grants, every mode, the approve path and what it writes, the zero-row
decline and setting writes, and the cross-org floor.

**Consequences stated on purpose.** An org admin who names someone else as
leader is not a member of the new group (org admins are not implicit
members). The first member-created group is the org's second, after which
`handle_new_user()`'s one-group enrolment stops enrolling new signups
anywhere until a leader adds them; the rule is unchanged.

### Group discovery

Whether members can find and ask to join groups is three columns read by
definer functions and never by a policy
(`20261026000000_group_discovery.sql`): `organizations.group_discovery
boolean not null default true` (the ceiling: `anon` has no grant on it,
`authenticated` reads it and the org's own admin writes it through the
single org-settings UPDATE policy), `groups.is_private boolean not null
default false` (a leader hides their group from non-members whatever the
org switch says — private can only hide more, never less) and
`groups.join_policy text not null default 'approval' check (in ('open',
'approval'))`. **The `groups` SELECT policy is unchanged**: a non-member
still reads no `groups` row, so `/g/<id>` stays a 404 for them, and a
private group is not a new kind of row but a flag on one.

### Org time zone

`organizations.timezone text not null default 'America/New_York'`
(`20261029000000_org_timezone.sql`) is the one zone every event time is
entered and displayed in; it is a display setting, read by no policy and no
definer function. Same grant shape as the other org settings: `anon` has no
SELECT or UPDATE grant on the column (it holds only Supabase's pre-existing, inert table-level INSERT), `authenticated` reads it (every signed-in member's
event surfaces format in it, through the request-scoped
`getOrgTimeZone()` in `lib/time/orgZone.ts`), and the org's own admin writes
it through the single org-settings UPDATE policy. The database is the one
gate on what the column holds: a `before insert or update` trigger,
`organizations_timezone_check()`, refuses with a `check_violation` anything
but an exact, case-sensitive `pg_timezone_names` entry outside the `posix/`
tree — the set `Intl` formats in — so a POSIX rule string, an offset or a
case variant that `at time zone` would take never reaches a reader, and the
readers pass the stored name to `Intl` as is. On the web side
`isValidTimeZone()` in `lib/time/zone.ts` asks `Intl` directly and
`getOrgTimeZone()` falls back to `siteConfig.timeZone` with a logged error,
so a page render cannot fail over its zone; the reminder edge function
formats in the stored zone with no second check. The Settings picker lists
`Intl.supportedValuesOf()`, which can run ahead of the database's zone data;
a name the database does not yet know fails the save with an error toast
rather than being stored. `supabase/tests/org_timezone_suite.sql` pins the
default, the grants, the admin-only write (a member's and another org's
admin's UPDATE each touch zero rows), the rejections and the accepted
spellings. The edge functions read the same column on `listActiveOrgs()`'s
org-anchored select (see `service-role-inventory.md`, Edge Functions).

`discoverable_groups()` is the one read behind Find a group and
Directory › Groups. Tenant anchor: the caller's own `profiles` row
(`auth.uid()`, not pending); it returns the caller's own groups always,
every other non-private group while the org switch is on, and private
groups additionally for an org admin, with only the columns the row shows
(name, meeting time, member count, the two flags, the viewer's role and
their pending-request state). With the switch off an org admin sees no
more than a member: they manage groups on Admin › Groups.

**Join requests are rows of their own.** `group_join_requests` (`org_id`
default `app_current_org_id()`, the restrictive isolation floor, composite
FKs `(group_id, org_id)` into `groups` and `(profile_id, org_id)` into
`profiles`, one pending row per `(group_id, profile_id)` by partial unique
index) has one permissive policy, SELECT for the requester, the group's
leaders and org admins, and **no client write grant at all**: table-level
INSERT, UPDATE and DELETE are revoked from `anon` and `authenticated`, so a
direct write fails with `42501` rather than matching zero rows. Every write
goes through:

- `join_group(_group_id)` — org from the caller's own `profiles` row; the
  group is looked up by id **and** that org; the org switch must be on and
  the group not private. All four failures are the same `GJ001`, so the
  response never says whether a hidden group exists. Then the core.
- `join_group_apply(_group_id, _actor_id)` — the policy branch: `open`
  writes the `group_members` row (and resolves any stale pending request
  with no reviewer); `approval` files a pending request. Plain plpgsql with
  EXECUTE revoked from everyone including `service_role`: it carries no
  discovery or privacy gate, so only a wrapper that has applied its own
  gate (`join_group()` today; an invite-link wrapper later) may reach it.
  It still asserts the actor is an approved member of the group's org
  (`GJ002`) and not already in it (`GJ003`).
- `review_group_join_request(_request_id, _approve)` — org from the
  caller's own `profiles` row; the request is selected by id **and** that
  org with `for update`, and the caller must lead its group or be an org
  admin, else `GJ004` (the same as a missing id). Approve writes the
  membership and marks the row in one transaction.

`pending_group_join_requests(_group_id)` is the leader's list — the one
place a leader reads the name and email of a profile they may not share a
group with. It is scoped to pending requests for a group the caller leads
(or any group, for an org admin), returns name, preferred name and email
only, and honours `hide_email`. `supabase/tests/group_discovery_suite.sql`
pins the grants, what a non-member, a member and an org admin each see,
open vs approval joining, who may review, the org switch as a ceiling,
every direct write path and the cross-org floor;
`e2e/group-discovery.spec.ts` asserts the rendered consequence.

### Group invite links

A group's leaders and the org's admins mint links into that group
(`20261027000000_group_invites.sql`). `group_invites` (`org_id` default
`app_current_org_id()`, the restrictive isolation floor, a composite FK into
`groups`, a DB-minted plaintext `uuid` token, `expires_at`, `max_uses`,
`revoked_at`) is read, created and revoked by the leaders and admins under
three permissive policies; the UPDATE is confined by column grant to
`revoked_at` and cannot clear it again, and there is no DELETE policy or
privilege. `group_invite_uses` holds one row per redemption, is readable by
the same people and writable by no client at all. `access_requests` gains
`group_id` and `group_invite_id` (composite FKs, column-list `set null`)
and `unique (id, org_id)` so the use row can reference it.

Redemption is two `SECURITY DEFINER` functions whose bodies are the tenant
boundary. `group_invite_redeem()` (service_role only) locks the invite row
the token selects, takes the org from it, and writes the approved request
and the use row in one transaction; the route mails the setup link and
clears the token if the mail never left. `group_invite_join()`
(authenticated) takes the org from the caller's own profile and refuses an
invite from any other org as `GI001`, the same as a dead link; a private
group admits at once (the link is the approval), otherwise
`join_group_apply()` applies the group's `join_policy`. One dead-link code
(`GI001`) covers unknown, revoked, expired, used-up and foreign alike, so
the page never says which. `supabase/tests/group_invites_suite.sql` pins the
grants, who may mint and revoke, both redemption paths, the cap and the
cross-org floor; `e2e/group-invite.spec.ts` asserts the rendered consequence.

Anonymous org resolution therefore ends with this feature: the slug join
page is gone, `app_request_org_id()` collapses to the principal's org, the
anonymous `access_requests` INSERT policy is dropped (a household invitee
files their request through `app/api/family-invites/request/route.ts`,
anchored on the `family_invites` row), and no client sends an org header.

### Group context (app layer)

The URL segment `/g/<groupId>` names the group a request is about, and
`requireActiveGroup()` in `lib/groups/server.ts` is what every page and the
layout under `app/g/[groupId]/` call first. It verifies membership on
**every request** through `group_members` (the own-rows SELECT arm above),
memoized only within the request by React `cache()`; nothing survives
across requests. A malformed id 404s before any query runs. A signed-in
viewer who is not a member of a real group gets the same 404, never a 403
or a redirect, so the response does not confirm the group exists. For
leader-only sub-pages, `requireGroupLeader()` 404s a member who does not
lead the group; the settings index itself redirects such a member to the
group dashboard instead, because a member of the group is not enumerating
anything there.

The `two42-group` cookie is a **preference, never an authority**. The
middleware writes it on every `/g/<uuid>/…` response (server components
cannot set cookies), and the only readers — `getActiveGroup()` for org-level
surfaces that need a target group, and the middleware's legacy-route
redirect — intersect its value with the verified membership list through
`resolveActiveGroup()`: a cookie naming a group the viewer is not in is
ignored and the first membership (by `joined_at`) applies. The client hook
`useActiveGroup()` never reads it at all; it derives the active group from
the URL and the membership list the root layout serialised.

`loadGroupMemberships()`, `loadHomeCards()`, `getGroupCalendar()`,
`ensureGroupCalendar()`, `getGroupSettings()`, `savePrayerCallSessions()`
and `getServingLinkMode()` are tier C helpers under
`scripts/check-service-role-org-scope.mjs`: they take a `SupabaseClient`
parameter, so every chain carries the caller's already-validated `org_id`
(the viewer's own RLS-scoped `profiles.org_id`) and, where the row is
group-owned, the verified active group's id. The membership loader throws
on a failed read (of memberships or of the calendars that give them their
color); the root layout and the middleware's legacy redirect are the only
callers that catch it, and both fall back to no group, so an error never
resolves a group anywhere. `getGroupSettings()` and `getGroupCalendar()`
throw on a failed read for the same reason: the About editor saves the
settings back, so a read failure must not render as blank defaults, and
`ensureGroupCalendar()` inserts only after a lookup that confirmed the
group has no calendar — a failed lookup returns null without inserting,
so an outage cannot give a group a second calendar. No service-role client
is involved in group context.

`getDiscoveryOn()` in `lib/groups/discovery.ts` reads the org switch
through the cookie-bound request client and **fails closed to `false`**: a
read error or a missing row renders discovery as off everywhere (no "Find
a group" link, `/find-a-group` a 404, the Groups tab showing own groups
only), exactly as the pre-discovery stub did. `discoverable_groups()` and
`join_group()` enforce the truth regardless of what the UI offers, and the
browser-side `.rpc()` calls run on the cookie-bound client, so no
service-role client is involved anywhere in discovery.

The bearer-token ICS routes are the one service-role surface that crosses
the group boundary: `app/api/calendar/feed.ics/route.ts` reads the token
owner's `group_members` rows (scoped to the token's org) and the feed is
`.in("group_id", …)` over exactly those groups — a `?group=` value the owner
is not in intersects to an empty calendar, never a distinguishing status —
and `app/api/events/[id]/ics/route.ts` 404s when the owner is not a member
of the event's group, the same status as a cross-org id. The two cron edge
functions iterate org → group (→ team) with an explicit `group_id` /
`team_id` on every query; the recipient resolver drops an RSVP from someone
who has since left the group.

## Storage tenancy

`storage.objects` has no `org_id` column, so the first path segment of the
object key is its analogue (CWA-57 /
[#328](https://github.com/cwaits6/two42/issues/328)). Every object key is
org-partitioned:

```
avatars/       <org_id>/profiles/<profile_id>/avatar.jpg
               <org_id>/family-members/<family_member_id>/avatar.jpg
               <org_id>/families/<family_id>/photo.jpg
event-images/  <org_id>/events/<event_id>/<name>.jpg
```

`storage.foldername(name)` returns the folder segments excluding the
filename, so `(storage.foldername(name))[1]` is the org, `[2]` the kind,
`[3]` the entity id — and the restrictive floor is the direct translation of
the table-level one
(`20260803000000_storage_org_partitioned_policies.sql`):

```sql
create policy "org isolation" on storage.objects
  as restrictive for all to anon, authenticated
  using      ((storage.foldername(name))[1] = (select public.app_request_org_id())::text)
  with check ((storage.foldername(name))[1] = (select public.app_request_org_id())::text);
```

The 17 permissive policies are factored `ORG AND (arms)` like every
org-owned table, and the per-entity arms compare as text
(`entity.id::text = segment`, never `segment::uuid` — a non-UUID segment
must deny the row, not raise `22P02`). On the app side, every key is built
by `lib/storagePaths.ts` and every upload/delete goes through
`lib/uploadImage.ts`, which resolves the org once per call via
`resolveRequestOrgId()` and prefixes it — call sites pass relative paths and
structurally cannot omit the org. `supabase/tests/storage_tenancy_suite.sql`
proves the isolation (cross-org read/insert/update/delete all denied, with
own-org positive controls) and pins the policy shape structurally.

**Decision (ADR-3, revised by CWA-59 /
[#333](https://github.com/cwaits6/two42/issues/333)): both buckets are
`public => false`; reads go through signed URLs.** The original ADR-3
accepted public buckets as a deliberate trade-off — read secrecy resting on
unguessable UUID paths, with any ever-leaked URL (browser history, a
forwarded link, a proxy log) permanently readable across tenants. This is
the tracked revisit of that trade-off. The `/object/public/*` path no longer
serves either bucket; every render site exchanges the stored URL for a
signed URL via `createSignedUrl()`/`createSignedUrls()`, whose minting is
gated by the SELECT policies on `storage.objects` — dormant for reads while
the buckets were public, load-bearing now. Avatars keep the org-scoped
`"Public can view avatars"`; event images read through the event's group
(`"Group members can view event images"`: the key's `<event_id>` segment
joined to `events` under `is_group_member(e.group_id)`), so an org member
outside the group finds no visible row, the same as an org-B principal
minting for an org-A key; a leaked signed URL dies at its TTL. The pgTAP assertion that previously pinned "both public" now pins
"both private", so flipping a bucket back fails CI until this paragraph is
revisited again.

One deliberate deviation from the original ADR-3 prose: **no column-format
change and no data migration.** The old text assumed going private meant
"each column would need to become a path". Instead, `profiles.avatar_url`,
`family_units.photo_url`, and `family_members.avatar_url` keep storing
exactly the `getPublicUrl()`-shaped string they always have (and that
`scripts/rekey-storage-objects.mjs` writes back), and a pure parser
(`parseStoragePublicUrl()` in `lib/storagePaths.ts`) recovers
`{bucket, path}` at read time. That keeps the write path and the rekey
script untouched and avoids a backfill over member-PII rows for the same end
state. The signing helpers come in exactly two flavors, each owning its own
client construction: `mintSignedUrl(s)` in `lib/uploadImage.ts` (browser
context) and `lib/storageRead.ts` (server context, cookie-bound
`createClient()`). Neither accepts a `SupabaseClient` parameter, by design —
storage signing has no `org_id` predicate a callee could re-validate, so a
passed-in service client would mint cross-tenant URLs unchecked (the Tier C
shape).

The TTL is `SIGNED_URL_TTL_SECONDS = 3600` (`lib/storagePaths.ts`): it
matches the upload path's `cacheControl: "3600"` so signed-URL validity and
intended cache lifetime agree, keeps re-mint cost tolerable for avatars that
render on nearly every page (one mint per page load cycle), and turns a
leaked URL from a permanent capability into a same-day-dead one. Failure is
soft per item: a malformed stored value, a transient Storage error, or an
un-rekeyed legacy object (see ADR-4 below — such a key fails the org floor's
`[1] = org_id` check for *every* anon/authenticated RLS-constrained
principal, so post-CWA-59 no application read can reach it until the rekey
script — which runs with the service role and bypasses RLS — moves it)
renders as a missing image, never a crashed page.

The physical re-key of pre-existing (un-prefixed) objects is deferred to
`scripts/rekey-storage-objects.mjs` (ADR-4, see
[`scripts/README.md`](../../scripts/README.md)): a SQL
`UPDATE storage.objects SET name = …` would orphan blobs, because Storage
keys the physical file by `bucket/name`. A legacy key's first path segment
is not an org id, so the restrictive floor matches no row for it under *any*
RLS-constrained (anon/authenticated) principal: it is invisible to every
application client write path — deleting one is a
silent no-op: the `storage.objects` row and its blob both survive and the
caller still sees success — and, since CWA-59 made reads RLS-gated as well,
it is **unreadable to anon/authenticated application callers** too (while
the buckets were public it kept rendering via `/object/public/*`; that path
is closed — only service-role access, e.g. the rekey script itself, still
reaches such a key). This is why the
script is a hard precondition for the CWA-59 private-bucket deploy, not
merely cleanup. Nothing is orphaned by the delete path — the residue is the
opposite shape. A delete-then-reupload leaves the legacy object sitting at
its old key, still tracked by its own row, while the
entity's URL column now points at the new org-partitioned key. The script
moves legacy objects onto the partitioned layout, which is what makes them
deletable again; it deletes nothing, so anything already stranded at an old
key by a delete-then-reupload before it runs must be removed by hand.

## Signup and provisioning contracts

`handle_new_user()` resolves a signup's org **only** from server-owned
rows: approved `access_requests` and unclaimed `family_invites` matching
the email. Zero matches → the signup raises (`TN001`); matches in more than
one org → raises (`TN002`). Server-set `raw_app_meta_data ->> 'org_id'` may
disambiguate within the matched set, never widen it; client-supplied
`raw_user_meta_data` is never consulted for org selection.

`provision_organization(name, owner_email)` builds a complete org in one
transaction: the org row — its `branding` jsonb seeded with the full
tenant-overridable contract (`display_name`, `logo_url`, `accent`,
`reply_to`; see [`DESIGN.md`](../design/DESIGN.md)) — the two org-level
giving settings, and an **approved access request for the owner** — so self-serve
onboarding is org-first: provision, then create the auth user, and the
fail-closed trigger needs no special case. Phase 4 must NOT solve
onboarding by adding a fallback branch to `handle_new_user()`. Nothing
routes by slug any more, so provisioning takes none, and
`organizations.slug` is dropped (`20261028000000_drop_org_slug.sql`).

An approved access request may name a `group_id` (and `group_invite_id`):
the group an invite link admits the person into. `handle_new_user()` enrols
that group — its composite FK pins it to the signup's org — and stamps the
new profile on the `group_invite_uses` row, ahead of the one-group fallback
that enrols a signup with no invite into an org's only group.

**`access_requests.approved_role`** (Phase 4a, `20260802000002`) names the
role `handle_new_user()` grants when an approved request resolves a signup:
NULL preserves the pre-Phase-4 behavior (`'member'`), and
`provision_organization()` stamps `'admin'` on the owner's seeded request —
that column is the entire founding-admin handoff; no new auth flow exists.
The anon-reachable INSERT policy pins `approved_role` to NULL, so no
visitor can self-request admin; only server-side (service-role) writes and
org admins — who already manage `profiles.role` within their org — can set
it.

Provisioning seeds **no teams, no group, and nothing group-owned**: a
calendar, an about page and the call settings all belong to a group, and
there is none at provisioning time; the group's calendar is created when
its first event, prayer call or color is saved. Teams are defined per group:
its leaders create them in Group settings › Teams
(`/g/<groupId>/settings/teams`) and designate capabilities per team
(`is_serving_role`) and leadership per membership
(`team_members.is_leader`). Nothing in the schema or app requires a team to
exist, so there is no platform-defined team name for a policy or surface to
depend on (`member_groups.functional_role` was dropped in `20260801000000`).
A newly provisioned org has no group either — the founding admin has no
profile at provisioning time, so nothing could be enrolled — and because
`teams.group_id` is required, no team can exist until group creation ships.
The one live org was backfilled by the group-model migration.

Provisioning **never moves an existing profile between orgs**. If a profile
with the owner's email already belongs to a different org, the call raises
`TN004` and the whole transaction rolls back. An unscoped
`update profiles set org_id = … where email = …` would be a cross-tenant
write: once Phase 4 exposes a caller, passing a competing org's admin email
would re-pin that admin into the caller's org, taking over the account. A
"who may provision" authorization guard does not address that, so the
primitive itself is closed here.

EXECUTE is revoked from `public`/`anon`/`authenticated`; `SECURITY DEFINER`
+ `search_path = ''` + that REVOKE is the entire authorization story — do
not add a GRANT to any client-reachable role without a caller check. The one
explicit GRANT is to `service_role` (`20260801000002`), which restates a
Supabase default so the Phase 4 server-side caller does not depend on it;
`service_role` is never reachable from a client, so it does not re-open
PostgREST RPC.

## Enforcement in CI

`supabase/tests/schema_tenancy_lint.sql` asserts, each with a negative
probe:

- **check 1** — every org-owned table has exactly one restrictive isolation
  policy referencing `org_id`;
- **check 2** — no policy on an org-owned table has a bare `true` predicate;
- **check 3** — every FK into an org-owned parent is composite on `org_id`;
- **check 3b** — every `ON DELETE SET NULL` on an `org_id`-carrying FK names
  a column list that excludes `org_id`;
- **check 4** — every `SECURITY DEFINER` function reading an org-owned table
  references `org_id`;

These are the suite's own labels (`-- Phase 2 check N` in
`schema_tenancy_lint.sql`), not list positions: the `SET NULL` assertion is
`3b`, so numbering the list 1..5 would cite every rule after it one off —
which is exactly how the `SECURITY DEFINER` rule came to be cited as
"check 5" here while the migration and the inventory called it check 4.

plus the Phase 0/1 checks (RLS enabled, `org_id` present, NOT NULL, the
exact `app_current_org_id()` default). The only remaining allowlist is for
local-stack stray tables that exist in no migration; the two by-design
table exemptions (`organizations`, `platform_admins`) are structural, not
data, and the composite-FK check carries the one named FK exemption
documented above (`organization_members_profile_id_fkey` — the Phase 4
platform seam).

## Known limits (accepted, tracked)

- `feedback` and the two giving keys in `site_settings` stay org-level by
  decision: product feedback is about the app and read by org admins, and
  the giving toggles are org policy. Storage event-image keys stay
  `<org_id>/events/<event_id>/…` — the event id resolves the group, and the
  three event-image policies gate on `is_group_leader(e.group_id)` through
  it.
- The edge functions' `group_id` / `team_id` bindings are review-enforced:
  `check-service-role-org-scope.mjs` proves each chain names the predicate,
  not that it binds the right variable. `_shared/event-recipients.ts` and
  `_shared/groups.ts` are pure modules with recorded-chain tests for that
  reason.

- The serving signup write path is a `SECURITY DEFINER` pair
  (`serving_signup_apply` / `serving_signup_create`,
  `20260803010000_serving_signup_rpc.sql`) so the signup + attendee inserts
  commit atomically (CWA-47 / #313). Its org checks — org resolved from the
  `teams` row, every other row asserted to carry it, the
  authenticated wrapper pinned to `app_request_org_id()` — replace RLS
  inside the bodies and are review-enforced: lint check 4 above only proves
  the source mentions `org_id`. Grants and org checks are pinned by
  `supabase/tests/serving_signup_rpc_suite.sql` and the inventory records
  the surface ([service-role-inventory.md](service-role-inventory.md)).
- The per-org daily email send cap is enforced by a `SECURITY DEFINER`
  writer, `email_quota_consume(_org_id, _n)`
  (`20260825000000_org_email_send_caps.sql`, CWA-72 / #365), so the atomic
  reserve-and-check can happen in one `INSERT ... ON CONFLICT ... DO UPDATE
  ... WHERE` statement rather than racing a separate count-then-send.
  Unlike `serving_signup_apply`, there is no row to resolve `_org_id`
  against — `_org_id` is a bare parameter, and EXECUTE is granted to
  `service_role` only (no `anon`/`authenticated` grant), so the only
  callers are server-side paths that already hold a validated `orgId` from
  an anchor they verified themselves — never trusted from the parameter
  alone. `check-service-role-org-scope.mjs` requires the `_org_id`
  argument on every service-rooted `.rpc()` call; where that value comes
  from is review-enforced. Grants and
  cap-boundary behavior are pinned by
  `supabase/tests/org_email_quota_suite.sql`; the inventory records the
  call sites ([service-role-inventory.md](service-role-inventory.md)).
- An authenticated member of org A who opens org B's group invite link is
  told the invite is for a different organization and offered Sign out:
  `group_invite_join()` compares the caller's own org to the invite row's
  and answers `GI001` on a mismatch, the same as a dead link, so nothing
  about org B is confirmed. Session cookies stay host-scoped (no `Domain=`
  widening anywhere in `lib/supabase/{server,client,middleware}.ts`, pinned
  by a regression test), so they are never sent to a subdomain of the
  canonical host.
- Storage **writes** are closed (CWA-57 / #328 — see "Storage tenancy"
  above); signed tokens and the service-role call sites were closed in
  Phase 3 (#212). Group-level scoping of member-facing surfaces: split out
  ahead of Phase 4.
- Storage **reads** are closed too (CWA-59 / #333 — ADR-3 above, as
  revised): both buckets are private and every read mints a signed URL
  through the org-scoped SELECT policies. The remaining storage item is the
  one-time physical re-key of legacy object keys
  (`scripts/rekey-storage-objects.mjs`, #334 / CWA-60), which must run
  before the private flip deploys — an un-rekeyed legacy object is
  unreadable app-wide once reads are RLS-gated.
- The permissive `organizations` SELECT policy is written whole-row, but the
  column privileges beneath it are not: `20260801000002` revoked the
  table-level grant and re-granted a column list, and `20260802000001`
  narrowed `anon` further to `select (id, branding)` — `anon` can no
  longer read `name`; `authenticated` keeps
  `select (id, name, branding)`. Neither role can select `status`,
  `created_at`, or any column a later phase adds — `ADD COLUMN` grants
  nothing, so a new column is unreadable until someone lists it there on
  purpose. An anonymous caller now resolves no org and reads no row at all, so
  the remaining `anon` grant is inert; revoking it is a separate cleanup.
  Remaining gap: `branding` is a single jsonb value, so `reply_to` rides along
  with the three keys the app shell needs; column privileges cannot reach
  inside jsonb, and excluding it needs a SECURITY DEFINER projection.
  Accepted: `reply_to` is an address the org publishes on every outbound
  email.
- **`organizations.status` cuts no access path.** The one place it ever
  gated routing — the custom-domain host resolver — is retired along with
  host routing. What remains is
  unchanged: the `public.org_status` enum (CWA-51; `create type
  public.org_status as enum ('active','suspended')` in
  `20260802000000_org_status_enum.sql`) has exactly one column using it,
  and is an enum rather than a CHECK constraint so `supabase gen types`
  emits a union type — that is what makes the `satisfies readonly
  OrgStatus[]` check in `app/api/platform/organizations/[id]/route.ts` a
  compile-time gate on new labels. `20260731000001_org_helpers.sql` still
  records that `status` is deliberately **not** consulted by either org
  helper, so suspending an org does not cut its members' access;
  `listActiveOrgs()` (`supabase/functions/_shared/orgs.ts`) still skips
  suspended orgs, so a suspended tenant stops receiving reminder email; and
  the `/platform` operator surfaces read the column to display it and write
  it to set it, which is reporting and editing, not enforcement.
  Enforcement of a member-facing access cut belongs to Phase 4's suspend
  surface; don't assume it exists until then. Neither `anon` nor
  `authenticated` can even `select` the column (see the column-grant bullet
  above).
- **Supabase Auth's redirect allowlist names the one canonical host.** Auth
  flows (magic links, password resets) redirect through Supabase's
  configured allowlist: `https://<canonical host>/**` plus the localhost dev
  entry, with no wildcard-subdomain or custom-domain entries. That allowlist
  is remote Supabase project configuration owned by the operator/CI per this
  repo's hard database rule — the app never writes it. As defense in depth
  on the app side, the `next` param in `app/api/auth/callback/route.ts` is
  hardened: a sentinel-origin check accepts only single-leading-`/`
  same-origin paths, rejecting `//host`, backslash variants, and any
  scheme-ish prefix (`app/api/auth/callback/sanitize-next.ts`, same
  technique as the login page's `redirect` param).
- **Per-org branding is an injection surface with a named boundary.**
  `organizations.branding` is admin-supplied free text that reaches CSS and
  RFC 5322 headers. The boundary is `HEX` (`lib/contrast.ts`, strict
  `^#[0-9a-fA-F]{6}$`), `CONTROL` (`lib/branding.ts`, C0/C1
  control-character strip), `PLAIN_NAME` (`lib/email/identity.ts`,
  unquoted-atom allowlist with an always-safe quoted-string fallback), and
  `SENDING_DOMAIN` (`lib/email/identity.ts`, the per-org `From:` address
  gate — it validates `org_email_domains.domain`, a different table than the
  other three, and is additionally gated on `status = 'verified'`; anything
  else falls back to the platform address) — validation boundaries, not
  style choices; do not relax them to support richer names or color formats.
  `supabase/functions/_shared/branding.ts` is a deliberate **byte-level
  mirror** of those four `organizations.branding` regexes, since Phase 5
  PR 7 (edge functions cannot import from `lib/`), so a change must land on
  both sides. The edge mirror
  deliberately omits the WCAG 4.5:1 `validateAccent()` contrast gate, which
  is enforced on the write path only (#319).
- **Emailed-link origin is a constant, not per-org data.** Every link the
  platform mails is built on the one canonical host — `siteConfig.url` in
  the app, the `SITE_URL` function secret in the cron edge functions — so no
  admin-supplied value reaches a link origin. Each target route resolves its
  org without the host: `/setup-account`, `/join/family/[token]` and
  `/join/[token]` from the token's row, `/serving/go` from the HMAC-validated
  token, `/serving/**` and `/events` from the signed-in session.
