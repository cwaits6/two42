# CLAUDE.md

Guidance for AI agents working in this repo — interactive Claude Code sessions and autonomous Archon workflow runs alike. See `AGENTS.md` for additional agent notes.

## Project

Next.js + Supabase app for a church small group, deployed on Vercel. Open source. Releases are automated with semantic-release on conventional commits.

## Database — hard rules

- **Never touch the remote Supabase project.** No `supabase db push`, no `supabase migration repair` without `--db-url` pointing at local, no direct remote connections. The CI/CD pipeline is the sole owner of remote schema state.
- **Never run `supabase db reset`.** It wipes local test data. To apply pending migrations locally:

  ```bash
  supabase migration up --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres
  ```

- The local Supabase stack (API `:54321`, Postgres `:54322`, Studio `:54323`) is a **single shared instance** used by every worktree and parallel agent session. Never stop, restart, or reset it.
- Migrations are timestamped SQL files in `supabase/migrations/`. Keep them additive. Only one in-flight branch should introduce migrations at a time; if your task needs a schema change and another open PR already adds migrations, flag it instead of racing.

### Multi-tenancy (`org_id`)

`org_id` is the enforced tenant boundary. `supabase/tests/schema_tenancy_lint.sql` hard-fails CI on each of these, so they are structural requirements for every migration, not style preferences:

- **Every new table gets `org_id uuid not null default public.app_current_org_id()`** — the DEFAULT is fail-closed: no authenticated principal resolves NULL, which violates NOT NULL rather than guessing a tenant.
- **Every org-owned table gets the restrictive isolation policy** (`as restrictive ... using (org_id = (select public.app_request_org_id()))`). The request-scoped helper is required — anonymous reads of public content resolve their org from the `x-two42-org` header, which `app_current_org_id()` cannot do; authenticated principals always resolve to their own org regardless of the header. It is the isolation floor; permissive policies compose on top as `ORG AND (arms)`, never `(ORG AND arm1) OR arm2`.
- **No bare `using (true)` / `with check (true)`** on an org-owned table.
- **Every FK into an org-owned parent is composite** — `(col, org_id) references parent(col, org_id)`. `on delete set null` must name the FK column explicitly, e.g. `on delete set null (calendar_id)`, or it will try to null `org_id` too.
- **Wrap helper calls in RLS policy expressions as `(select public.helper())`** so the planner evaluates them once per statement (InitPlan). This repo has regressed on it twice. The rule is about policy expressions — inside SECURITY DEFINER function bodies the bare call is fine.
- **Every `createServiceClient()` query against an org-owned table filters on an `org_id` derived from an already-validated anchor** — the token row, the HMAC-validated group row, the caller's own RLS-scoped profile, or `app_request_org_id()` resolved through the cookie-bound request client (`await createClient()`, never the service client). Never a constant, never an org id read off the request body. The tenant root is the one exception: `organizations` carries no `org_id`, so a service-role read of it filters `id` against an org id that came from those same validated anchors (e.g. `lib/email/identity.ts` filters `.eq("id", orgId)` on an `orgId` its caller already holds) — never an id taken straight off the request body. Service-role clients carry `BYPASSRLS`, so the explicit filter *is* the tenant boundary on these surfaces, and `schema_tenancy_lint.sql` cannot see it — this rule is checked by review, not by CI. Call sites and their org anchors: [`docs/security/service-role-inventory.md`](docs/security/service-role-inventory.md).
  - `app_request_org_id()` is an approved anchor because it is the same value the RLS `WITH CHECK` evaluates: an authenticated principal always resolves to their own org and `x-two42-org` is ignored; only a genuinely anonymous request resolves the header's slug, and only to a real `organizations` row. **Fail closed on both failure modes** — an RPC error *and* a NULL result (a slug matching no organization row) must each log and take the route's already-unavailable path (redirect, or a "requests unavailable" render), never a fallback org.
  - The one exception to the filter rule: the initial `signup_token` lookup in `app/api/auth/consume-token/route.ts` and `app/api/auth/verify-token/route.ts` cannot be org-scoped, because that row is what resolves the org. Both fail closed when it yields no row or a NULL `org_id`, and every subsequent operation scopes to the resolved row's `org_id`. A new unscoped lookup needs that same shape and a row in the inventory.

One rule in this section has **no lint behind it** and so needs the most care:

- **Service-role code enforces `org_id` itself — no lint catches a miss.** The cron edge functions (`supabase/functions/`) run with the service key, which carries `BYPASSRLS`, so the isolation policies above do not constrain them at all. Iterate tenants with `listActiveOrgs()` / `forEachOrg()` from `supabase/functions/_shared/orgs.ts`, and put an explicit `.eq("org_id", …)` on **every** query and an explicit `org_id` on every insert. Nested PostgREST embeds are the one exception — they are reached by FK traversal from an already-org-filtered parent, and composite `(col, org_id)` FKs mean the traversal cannot leave the tenant — but that only holds if the parent is filtered. Neither `schema_tenancy_lint.sql` (which never sees TypeScript) nor `deno-test` (which does not exercise query bodies) can detect a missing filter: a dropped `org_id` predicate is a silent cross-tenant leak that passes CI cleanly. Grep every `.from(` when reviewing a change here.

Full rationale, the helper inventory, and the deviations register: [`docs/security/tenancy-model.md`](docs/security/tenancy-model.md).

### Edge functions

- Source lives in `supabase/functions/`; shared, unit-testable modules in `supabase/functions/_shared/`. Run the checks locally before pushing:

  ```bash
  deno check supabase/functions/_shared/*.ts
  deno test --allow-env supabase/functions/tests/
  deno check supabase/functions/send-event-reminders/index.ts \
             supabase/functions/send-serving-reminders/index.ts
  ```

- **The two `index.ts` entry points are type-checked as a blocking PR gate** (CWA-45 / #311). Their esm.sh import is pinned to an exact version (`@supabase/supabase-js@2.110.9`) with a `deno.lock` integrity entry, and the `deno-test` job in `.github/workflows/supabase.yml` runs `deno check --frozen` on both files as a failing step. Post-merge, `supabase functions deploy` compiles them again — and it runs *before* `supabase db push` in the same job, so a broken entry point that somehow reached `main` would block every migration behind it. That is why the PR check blocks; run `deno check` on both files yourself before pushing.
- Keep logic that can be unit tested in `_shared/`: the entry points execute `Deno.env.get(...)`, `resolveServiceKey()`, and `Deno.serve()` at module top level, so nothing in them is importable from a test.

### Testing

- pgTAP suites live in `supabase/tests/`. Run them locally through the shared stack's container — each file is wrapped in `begin;`/`rollback;` so it never persists anything:

  ```bash
  docker exec -i supabase_db_small-group-hub \
    psql -U postgres -d postgres -f - < supabase/tests/<file>.sql
  ```

- **Never run `supabase test db` locally.** It resets the database, which violates the shared-stack rules above. CI runs it in the `pgtap` job of `.github/workflows/supabase.yml` against an ephemeral, isolated Postgres.
- Regenerate DB types after schema changes with `npm run db:types` (read-only against the local stack); CI fails if `lib/supabase/database.types.ts` drifts from the migrations.
- Adding a service-role client anywhere? Document it in `docs/security/service-role-inventory.md` in the same PR — every service-role query bypasses RLS and must be justified. Both entry points count: `createServiceClient()` in the app layer, and `createClient(SUPABASE_URL, resolveServiceKey())` in the edge functions.
- `npm run lint` is a blocking PR check (the `Lint` job in `.github/workflows/test.yml`) and runs with `--max-warnings=0`, so a warning fails the build. It was broken repo-wide by a brace-expansion/minimatch conflict (#299) until #309 scoped the override by major; any older instruction to skip lint is stale.

## Git & PRs

- Conventional commits. Only `fix`, `feat`, `perf`, and breaking changes trigger a release. Use `ci:` / `ci(scope):` commits on `ci/` branches for CI/infra changes; `docs:` / `chore:` for other non-release changes.
- **Merge a PR only when the maintainer explicitly and directly tells you to merge that specific PR** (e.g. "merge #123", "merge it in now"). Never infer or assume merge intent — green CI, "looks good", "ship it", an approved plan, or an implied next step do NOT authorize a merge. Default to opening the PR (draft is fine) and stopping. If it's at all ambiguous whether an instruction is an explicit merge directive, leave the PR open and ask.
- Do not include Claude/AI session links in PR titles or bodies.

## Local dev

- Multiple dev servers run in parallel worktrees. Pick a free port (`npm run dev -- -p <port>`) instead of assuming `:3000`.
- `npm install` may need real network access; sandboxed installs often fail DNS resolution in this repo (see `AGENTS.md`).

## UI conventions

- The brand and design system — wordmark, typography, and the canonical color palette (Clay / Marigold / Espresso / Warm Paper) — is specified in [`docs/design/DESIGN.md`](docs/design/DESIGN.md). Treat it as the source of truth; keep it and any theme tokens in sync.
- Plain, functional copy: verb+noun labels, no salesy subtitles or cute metaphors.
- The audience spans adults 18+ through members in their late 80s. Design for the oldest members — large type, high contrast, generous touch targets — without making the UI feel dated to younger ones.
- Assignment/roster UIs show current members by default with an explicit "add" mode — never render full toggle lists of every person.
- Base UI `Select` components must receive the `items` prop, or the trigger renders raw values.
- Per-org branding (`organizations.branding`) is admin-supplied free text reaching CSS and RFC 5322 headers. `HEX` and the control-character strip in `lib/branding.ts`, and `PLAIN_NAME` in `lib/email/identity.ts`, are the injection boundary — not style choices. Do not relax them to support richer names or color formats; add a new validated key instead.
