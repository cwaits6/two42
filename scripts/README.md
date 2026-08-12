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

It parses every `.ts`/`.tsx` file under `app/` and `lib/` with the TypeScript
compiler API (syntax-only — no type-checker, well under a second) and walks
each `supabase.from("table")…` chain to its root to decide which client it
runs on. Name-matching is deliberately avoided: `supabase` is a service-role
binding in some files and an authenticated one in others.

### The tiers

| Tier | Applies to | Escape hatch |
|------|------------|--------------|
| A | The email fan-out chains (feedback admins, serving broadcast, leader cancel notices), pinned by file + table in `FANOUTS` | **None** — see below |
| B | Every other chain rooted at a `createServiceClient()` binding | `// org-anchor: <reason>` |
| C | Chains rooted at a `SupabaseClient`-typed parameter of an exported `lib/` function | None (pre-existing modules are named in `TIER_C_EXEMPT` with reasons) |

Tier C is a deliberate over-approximation: a `lib/` helper that *can* receive
a service client must scope unconditionally, which is what lets the guard
avoid call-graph analysis.

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

Chains that need a marker but live in a file owned by another in-flight PR go
in the script's `KNOWN_ANCHORS` allowlist instead, with a `TODO` to move them
in-file once that PR lands. Stale entries — in `KNOWN_ANCHORS` or
`TIER_C_EXEMPT` — fail the guard rather than silently widening it.

### The non-AST checks

The same command also enforces:

- **Cross-org assertion pins** — the two signed-link surfaces read the
  profile row unscoped *on purpose* so a cross-org pairing is rejected
  explicitly; the guard pins that `profile.org_id !== group.org_id` rejection
  (and its denial log) to exactly one occurrence per file.
- **Seeded-UUID sweep** — no tracked file outside a named, commented
  exclusion list may hardcode the retired default-org UUID. The default is
  in-scope: new files are swept unless the list says why not.
