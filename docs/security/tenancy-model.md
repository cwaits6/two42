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
| `app_request_org_id()` | the org a request is *about* | the principal's org first; for anonymous callers only, the org whose `slug` matches the `x-two42-org` request header |

Rules that make these safe:

- Both are `STABLE`, `SECURITY DEFINER`, `set search_path = ''`. Every call
  site wraps them as `(select public.app_…())` so the planner evaluates
  them once per statement (InitPlan), not per row.
- **Fail-closed by construction.** No principal and no resolvable header ⇒
  NULL ⇒ `org_id = NULL` is not TRUE ⇒ rows filtered on read, rejected on
  write. There is no "no org means everything" branch anywhere.
- **A logged-in user can never widen their scope with the header** — the
  principal's org always wins. The header only ever selects among orgs'
  already-public content for anonymous visitors.
- **Deliberately no GUC override.** Any role can `set_config()` an
  arbitrary GUC; a trusted service-role override, if ever needed, belongs
  to Phase 3 and must be gated on `auth.role() = 'service_role'`.
- Every app Supabase client (server, browser, middleware) sends
  `x-two42-org` from `resolveOrgSlug()` in `lib/org.ts` — a trivial
  env-pinned mapping taking no host parameter until Phase 5 custom domains
  (#214) add real host → org resolution. The one exception:
  the public per-org routes (`app/[orgSlug]/join`) pass the URL slug
  explicitly to `createClient(orgSlug)` on **both** the server and browser
  clients. The DB still validates that slug against a real `organizations`
  row and still ignores it for authenticated principals, so the trust model
  is unchanged — the header grants nothing, it only selects which org's
  already-public surface an anonymous request is about.
- The app-layer complement is **`resolveRequestOrgId()`** (`lib/org.ts`,
  Phase 4b CWA-48 / #314): the single fail-closed helper that resolves a
  request's org through `app_request_org_id()` before a page relies on it.
  It fails closed on both failure modes — an RPC error, and an RPC success
  returning NULL (a slug matching no organization row) — logging each, so
  its three callers (`app/join/page.tsx`, `app/join/family/[token]/page.tsx`,
  `app/[orgSlug]/join/page.tsx`) take their already-unavailable path
  (redirect, or a "requests unavailable" render) instead of falling back to
  an org.

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

## Signup and provisioning contracts

`handle_new_user()` resolves a signup's org **only** from server-owned
rows: approved `access_requests` and unclaimed `family_invites` matching
the email. Zero matches → the signup raises (`TN001`); matches in more than
one org → raises (`TN002`). Server-set `raw_app_meta_data ->> 'org_id'` may
disambiguate within the matched set, never widen it; client-supplied
`raw_user_meta_data` is never consulted for org selection.

`provision_organization(name, slug, owner_email)` builds a complete org in
one transaction: the org row — its `branding` jsonb seeded with the full
tenant-overridable contract (`display_name`, `logo_url`, `accent`,
`reply_to`; see [`DESIGN.md`](../design/DESIGN.md)) — the prayer calendar plus its
`prayer_calendar_id` setting, the settings defaults, an empty about page,
and an **approved access request for the owner** — so self-serve
onboarding is org-first: provision, then create the auth user, and the
fail-closed trigger needs no special case. Phase 4 must NOT solve
onboarding by adding a fallback branch to `handle_new_user()`. An invalid
slug raises `TN003`.

**`access_requests.approved_role`** (Phase 4a, `20260802000002`) names the
role `handle_new_user()` grants when an approved request resolves a signup:
NULL preserves the pre-Phase-4 behavior (`'member'`), and
`provision_organization()` stamps `'admin'` on the owner's seeded request —
that column is the entire founding-admin handoff; no new auth flow exists.
The anon-reachable INSERT policy pins `approved_role` to NULL, so no
visitor can self-request admin; only server-side (service-role) writes and
org admins — who already manage `profiles.role` within their org — can set
it.

Provisioning seeds **no groups**. Groups are org-defined: admins create
them in `/admin/groups` and designate capabilities per group
(`is_serving_role`) and leadership per membership
(`profile_groups.is_leader`). Nothing in the schema or app requires a group
to exist, so there is no platform-defined group name for a policy or
surface to depend on (`member_groups.functional_role` is dropped in
`20260801000000`).

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

1. every org-owned table has exactly one restrictive isolation policy
   referencing `org_id`;
2. no policy on an org-owned table has a bare `true` predicate;
3. every FK into an org-owned parent is composite on `org_id`;
4. every `ON DELETE SET NULL` on an `org_id`-carrying FK names a column
   list that excludes `org_id`;
5. every `SECURITY DEFINER` function reading an org-owned table references
   `org_id`;

plus the Phase 0/1 checks (RLS enabled, `org_id` present, NOT NULL, the
exact `app_current_org_id()` default). The only remaining allowlist is for
local-stack stray tables that exist in no migration; the two by-design
table exemptions (`organizations`, `platform_admins`) are structural, not
data, and the composite-FK check carries the one named FK exemption
documented above (`organization_members_profile_id_fkey` — the Phase 4
platform seam).

## Known limits (accepted, tracked)

- An authenticated member of org A visiting org B's public page resolves to
  org A and sees nothing (fail-closed, not wrong-tenant). Revisited in
  Phase 5 (#214).
- Storage-bucket policies, signed tokens, and the service-role call sites:
  Phase 3 (#212). Group-level scoping of member-facing surfaces: split out
  ahead of Phase 4.
- The permissive `organizations` SELECT policy is written whole-row, but the
  column privileges beneath it are not: `20260801000002` revoked the
  table-level grant and re-granted a column list, and `20260802000001`
  narrowed `anon` further to `select (id, slug, branding)` — `anon` can no
  longer read `name`; `authenticated` keeps
  `select (id, name, slug, branding)`. Neither role can select `status`,
  `created_at`, or any column a later phase adds — `ADD COLUMN` grants
  nothing, so a new column is unreadable until someone lists it there on
  purpose. An anonymous caller who resolves the org via `x-two42-org` reads
  exactly those three columns.
  Remaining gap: `branding` is a single jsonb value, so `reply_to` rides along
  with the three keys the app shell needs; column privileges cannot reach
  inside jsonb, and excluding it needs a SECURITY DEFINER projection.
  Accepted: the slug is already public by construction (it *is* the header
  value), and `reply_to` is an address the org publishes on every outbound
  email.
- **`organizations.status` does not cut access.** The `public.org_status`
  enum (CWA-51; `create type public.org_status as enum
  ('active','suspended')` in `20260802000000_org_status_enum.sql`) has
  exactly one column using it, `organizations.status`. It is an enum rather
  than a CHECK constraint so `supabase gen types` emits a union type — that
  is what makes the `satisfies readonly OrgStatus[]` check in
  `app/api/platform/organizations/[id]/route.ts` a compile-time gate on new
  labels. The scope limit is recorded in `20260731000001_org_helpers.sql`:
  `status` is deliberately **not** consulted by either org helper, so
  suspending an org does not cut its members' access. It gates no access
  path anywhere: the only behavior it changes is that `listActiveOrgs()`
  (`supabase/functions/_shared/orgs.ts`) skips suspended orgs, so a
  suspended tenant stops receiving reminder email. The `/platform` operator
  surfaces read the column to display it and write it to set it, which is
  reporting and editing, not enforcement.
  Enforcement of a real access cut belongs to Phase 4's suspend surface;
  don't assume it exists until then. Neither `anon` nor `authenticated` can
  even `select` the column (see the column-grant bullet above).
- **Per-org branding is an injection surface with a named boundary.**
  `organizations.branding` is admin-supplied free text that reaches CSS and
  RFC 5322 headers. The boundary is `HEX` (`lib/contrast.ts`, strict
  `^#[0-9a-fA-F]{6}$`), `CONTROL` (`lib/branding.ts`, C0/C1
  control-character strip), and `PLAIN_NAME` (`lib/email/identity.ts`,
  unquoted-atom allowlist with an always-safe quoted-string fallback) —
  validation boundaries, not style choices; do not relax them to support
  richer names or color formats. `supabase/functions/_shared/branding.ts` is
  a deliberate **byte-level mirror** of those regexes (edge functions cannot
  import from `lib/`), so a change must land on both sides. The edge mirror
  deliberately omits the WCAG 4.5:1 `validateAccent()` contrast gate, which
  is enforced on the write path only (#319).
