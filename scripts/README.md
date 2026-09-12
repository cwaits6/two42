# scripts/

## `rekey-storage-objects.mjs` — one-time legacy storage re-key (CWA-57)

Moves pre-CWA-57 storage objects onto the org-partitioned key layout
(`<org_id>/<kind>/<entity_id>/<file>`) and updates the matching URL column
(`profiles.avatar_url`, `family_units.photo_url`,
`family_members.avatar_url`) in the same pass. An operator runs it once,
post-deploy, per environment:

```bash
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SECRET_KEY=<service key> \
node scripts/rekey-storage-objects.mjs            # dry run — prints the plan
node scripts/rekey-storage-objects.mjs --apply    # actually moves
```

`SUPABASE_SERVICE_ROLE_KEY` is accepted as a fallback for
`SUPABASE_SECRET_KEY`. `SUPABASE_URL` must be the host the **app** writes
into its URL columns (`NEXT_PUBLIC_SUPABASE_URL`) — a pre-flight check reads
one stored URL per table and aborts before mutating anything if the two
disagree, because every move would otherwise succeed while every URL update
matched nothing.

It is deliberately **not** a migration: Supabase Storage keys the physical
blob by `bucket/name`, so a SQL `UPDATE storage.objects SET name = …` would
rename the DB row, orphan the blob, and 404 every public URL. The Storage
`move()` API — HTTP-only — is the single operation that moves both.

Idempotent: keys already on the org-partitioned layout are skipped, so a
re-run after a partial failure continues where it stopped. "Starts with a
UUID" is deliberately **not** the test — the original profile-avatar layout
was `<profile_id>/avatar.jpg`, whose first segment is also a UUID; the check
requires a known `<kind>` second segment as well (`scripts/rekeyPlan.mjs`,
unit-tested in `scripts/rekeyPlan.test.mjs`). The org id is derived from the
`organizations` table; if more than one org exists the script refuses to
guess and requires `--org <uuid>` (legacy keys carry no org marker — they can
only have belonged to the org that predates partitioning). Until it runs,
legacy objects keep rendering (public buckets serve reads without consulting
RLS) but cannot be deleted or overwritten by any client — see
`docs/security/tenancy-model.md` ("Storage tenancy").

## `check-service-role-org-scope.mjs` — the service-role tenancy guard (CWA-44)

Service-role Supabase clients carry `BYPASSRLS`, so the `.eq("org_id", …)`
filters on their query chains **are** the tenant boundary — the isolation
policies pgTAP verifies do not constrain them at all. Until this guard, those
filters were enforced by review alone: deleting one produced no type error, no
build failure, and no test failure, and is behaviorally invisible while
exactly one organization exists.

The guard runs as the blocking `Service-role org_id guard` CI job. Run it
locally:

```bash
npm run guard:tenancy
```

It parses every `.ts`/`.tsx` file under `app/` and `lib/`, and every `.ts`
file under `supabase/functions/` (entry points and `_shared/`, not the Deno
tests), with the TypeScript compiler API (syntax-only — no type-checker, well
under a second) and walks each `supabase.from("table")…` and
`supabase.rpc("name", …)…` chain to its root to decide which client it runs
on. Name-matching is deliberately avoided: `supabase` is a service-role
binding in some files and an authenticated one in others.

### The tiers

| Tier | Applies to | Escape hatch |
|------|------------|--------------|
| A | The email fan-out chains (feedback admins, serving broadcast, leader cancel notices), pinned by file + table in `FANOUTS` | **None** — see below |
| B | Every other chain rooted at a `createServiceClient()` binding | `// org-anchor: <reason>` |
| C | Chains rooted at a `SupabaseClient`-typed parameter of an exported `lib/` function | None for `.from()` chains; an `.rpc()` call that *is* the org resolver may carry `// org-anchor: <reason>` |
| edge | Every chain in `supabase/functions/` (entry points and `_shared/`), whatever its root | `// org-anchor: <reason>`; the `organizations` tenant root is exempt |

Tier C is a deliberate over-approximation: a `lib/` helper that *can* receive
a service client must scope unconditionally, which is what lets the guard
avoid call-graph analysis. A `.from()` chain there can always take an
`orgId` from its caller, so it gets no escape hatch. An `.rpc()` call whose
contract has no org parameter — `app_request_org_id()` in `lib/org.ts`, which
derives the org from the principal or the validated host header — has nothing
to scope on, so the marker is the only truthful mechanism for it.

The edge functions run on the service key by construction, so there is no
authenticated client to distinguish from: every chain under
`supabase/functions/` is collected regardless of its root and must carry an
explicit `.eq("org_id", …)` (bound from the `listActiveOrgs()` /
`forEachOrg()` iteration), an explicit `org_id` on insert, or an
`org_id`/`_org_id` argument on an `.rpc()` call. The one exemption is the
tenant root: `organizations` has no `org_id` column, and `listActiveOrgs()`'s
enumeration of it is the deliberate full-tenant read. There is no allowlist
on any tier — every exception is named in the file it excuses.

### Why Tier A has no escape hatch

The fan-out surfaces push one org's data to third parties, and email cannot
be recalled. An unscoped read there does not leak a render — it mails another
org's members. The feedback fan-out bug already reached `main` once, which is
why these chains are pinned by name: if one goes missing or gains an
`// org-anchor:` marker, that is itself a failure, not an excuse.

### Adding an `// org-anchor:` marker

A handful of chains are *legitimately* unscoped — the row they fetch is what
resolves the org in the first place (a signup token, a subscription token, an
invite). Each one must be named in code:

```ts
// org-anchor: signup_token resolves the org; org_id is unknown until this
// row returns it (docs/security/service-role-inventory.md).
const { data: row } = await supabase
  .from("access_requests")
  .select("id, org_id")
  .eq("signup_token", token)
  .maybeSingle();
```

The reason text is mandatory — a bare `// org-anchor:` is rejected. Every
marked chain must fail closed when the lookup misses, scope every subsequent
query to the resolved row's `org_id`, and have a row in
[`docs/security/service-role-inventory.md`](../docs/security/service-role-inventory.md)
(the guard separately keeps that inventory in sync with the actual
`createServiceClient()` call sites, including the counts in its headings).

The analyzers are exported and unit-tested with fixture sources in
`scripts/check-service-role-org-scope.test.mjs` (each check has a passing and
a failing fixture); the scan itself only runs when the script is the entry
point.

### `.rpc()` calls and nested embeds

`.rpc("name", args)` calls are collected and classified exactly like
`.from()` chains. The predicate for an RPC is an `org_id` or `_org_id`
property on its args object (the repo's SQL-function argument convention —
`email_quota_consume(_org_id, _n)`, `org_email_domain_claim(_org_id, …)`). A
call with no such property needs a reasoned marker, as
`provision_organization()` (which creates the org) and `serving_signup_apply()`
(which re-derives the org from the `member_groups` row) carry. Only plain and
shorthand properties are recognised — a spread or a computed key is not seen
through, which fails toward reporting rather than silence.

`.select()` strings are checked for PostgREST embed syntax
(`relation(cols)`, with an optional `alias:` and `!fk_hint`). An embed is
only as safe as its parent's own scoping, so a chain that embeds a nested
relation and carries no org predicate or marker fails with a message naming
the embed. It is the same requirement as any other chain on that tier, worded
so the reviewer sees why the embed specifically is implicated; a scoped
parent passes as before.

### The non-AST checks

The same command also enforces:

- **Cross-org assertion pins** — the two signed-link surfaces read the
  profile row unscoped *on purpose* so a cross-org pairing is rejected
  explicitly, and the family-invite claim and household link-member routes
  compare the caller's org to the target row's as defence in depth; the guard
  pins each rejection (and its distinctive denial log) to exactly one
  occurrence per file, so deleting one fails CI.
- **Seeded-UUID sweep** — no tracked file outside a named, commented
  exclusion list may hardcode the retired default-org UUID. The default is
  in-scope: new files are swept unless the list says why not.
