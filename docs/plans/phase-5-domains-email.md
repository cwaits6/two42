# Phase 5 — Custom domains and per-org email

Implementation spec for [#214](https://github.com/cwaits6/two42/issues/214)
(CWA-12), the final phase of the multi-tenancy rearchitecture (epic
[#209](https://github.com/cwaits6/two42/issues/209)–[#214](https://github.com/cwaits6/two42/issues/214)).

**Status:** spec only. No code, no migrations, no schema changes ship with this
document. Every SQL block below is a *proposal* to be reviewed before anyone
writes a migration file. Where this document and an existing migration disagree,
the migration wins.

---

## 1. Where this phase sits

| Phase | Issue | Owns | State |
|---|---|---|---|
| 0 | #209 | pgTAP tenancy harness, stub org spine, service-role inventory | done |
| 1 | #210 | `organizations` + `platform_admins`, `org_id` on ~28 tables, backfill | done |
| 2 | #211 | `org_id` made the **enforced** boundary: org helpers, restrictive RLS floor, composite FKs, fail-closed `handle_new_user()`, `provision_organization()` | done |
| 3 | #212 | Service-role call sites, signed tokens, branding → DB, org-branded email | done |
| 4 | #213 | Onboarding, `/platform` operator surface, public per-org routes, tenant-#2 gate | done |
| **5 (this spec)** | **#214** | **Wildcard subdomains + custom domains; per-org verified sending domains + send caps** | **not started** |

Phase 5 as filed also lists private storage and Stripe billing. Both are
explicitly **out of scope here** — see §3.

Everything below assumes the Phase 2 contract is intact and unchanged:
`org_id` is the database-enforced boundary, `app_request_org_id()` is the
single fail-closed resolution point for RLS, and the `x-two42-org` header
*grants nothing* — it only selects which org's already-public surface an
anonymous request is about. Read
[`docs/security/tenancy-model.md`](../security/tenancy-model.md) and
[`docs/security/service-role-inventory.md`](../security/service-role-inventory.md)
before implementing any task here; this spec is written against them and
repeatedly defers to them.

---

## 2. What Phase 5 actually changes

Two facts hold today and both stop holding in Phase 5:

1. **The host is meaningless.** `resolveOrgSlug()` (`lib/org.ts`) takes no
   host parameter and returns `NEXT_PUBLIC_ORG_SLUG` or `"default"`. Every
   Supabase client — server (`lib/supabase/server.ts`), browser
   (`lib/supabase/client.ts`), middleware (`lib/supabase/middleware.ts`) —
   stamps that one env-pinned slug onto `x-two42-org`. The single exception is
   `app/[orgSlug]/join`, which passes the URL slug explicitly to
   `createClient(orgSlug)` on both sides. One deployment serves one org's
   anonymous surface, plus whatever the path-based route addresses.

2. **The sending domain is a platform constant.** `PLATFORM_ADDRESS`
   (`lib/email/identity.ts`) is parsed once at module load from
   `siteConfig.email.from`. Per-org branding varies the `From:` *display name*
   and `Reply-To:` only, deliberately, because SPF/DKIM are configured for the
   one platform domain.

Phase 5 makes the host authoritative for org resolution, and makes the sending
domain per-org where an org has proved it owns one.

Two existing code comments are load-bearing pointers into this work and should
be deleted by the PRs that resolve them:

- `lib/org.ts:16-17` and `:30-32` — "Phase 5 (custom domains, #214) replaces
  this with real host → org resolution", and the note that `resolveOrgSlug()`
  deliberately takes no host parameter until then.
- `lib/email/identity.ts:76-83` — `resolveEmailBranding()` with no `orgId`
  resolves branding from the *request* org, which is "correct only while
  `resolveOrgSlug()` is host-independent". Its `console.debug` line is the
  grep target named in the comment. §9.4 makes that a work item.

---

## 3. Non-goals

Both are deferred deliberately, not overlooked.

- **Stripe billing, per-org subscriptions, usage metering, and rate limits as a
  billing input.** The launch is a single-org free-tier dogfood: there is no
  money, one tenant, and self-serve `/join`. Building metering before there is
  a plan to meter is inventing requirements. The send caps in §9 are an *abuse
  and blast-radius* control, sized to protect the shared Resend account and the
  platform's sending reputation — they are not a billing meter, must not be
  designed as one, and no work here should introduce a price, a plan, or a
  quota tier. If billing lands later it can read the same usage rows; that is
  a happy accident, not a design goal.
- **Private storage buckets and signed URLs.** In flight as
  [#333](https://github.com/cwaits6/two42/issues/333) (the CWA-57 follow-up).
  ADR-3 in [`tenancy-model.md`](../security/tenancy-model.md) records the
  current public-bucket posture and why. Phase 5 must not touch
  `storage.objects` policies, `lib/storagePaths.ts`, or `lib/uploadImage.ts`.
  One interaction is worth knowing about and is called out in §11: object URLs
  are stored as durable absolute URLs against the Supabase project origin, not
  the app host, so custom domains do not change them and the two workstreams do
  not collide.

---

# Part A — Wildcard subdomains and custom domains

## 4. Routing model

Three ways a request can name an org, in precedence order:

| # | Shape | Example | Resolution |
|---|---|---|---|
| 1 | **Custom domain** | `smallgroup.example.church` | DB lookup against a **verified** `org_domains` row |
| 2 | **Platform subdomain** | `incouragers.<platform-apex>` | first host label, parsed — no lookup needed |
| 3 | **Path-addressed** (existing) | `<platform-apex>/incouragers/join` | URL segment, as today (`app/[orgSlug]/join`) |

Precedence is host-first: if the host resolves an org, the host wins and a
path slug naming a *different* org is a 404, not a silent override. Two
different orgs must never be addressable in one request.

**Keep path-addressed routes.** They are the fallback that works before an org
has any domain at all — including during provisioning, before DNS propagates,
and on preview deployments where the host is a Vercel-generated name. The
canonical URL for an org becomes its custom domain once verified *and*
attached (§6.3 step 6), else its platform subdomain; `/[orgSlug]/…` stays
reachable and should emit
`<link rel="canonical">` at the canonical host.

**Reserved subdomain labels.** `ORG_SLUG_PATTERN` (`lib/org.ts`) and
`provision_organization()` both accept `^[a-z0-9][a-z0-9-]{1,62}$` today, which
means an org can currently be minted with the slug `app`, `api`, `www`,
`admin`, or `platform`. The moment slugs become host labels, any of those
shadows a platform host. A reserved-label denylist must land in
`provision_organization()` (raising a new `TN00x`) *and* be mirrored in
`lib/org.ts` in the same PR — the mirroring rule the repo already applies to
`ORG_SLUG_PATTERN`. Proposed initial list: `www`, `app`, `api`, `admin`,
`platform`, `auth`, `mail`, `email`, `static`, `assets`, `cdn`, `status`,
`docs`, `blog`, `help`, `support`, `dev`, `staging`, `preview`, `test`.
Existing slugs must be checked against it before it is enforced (today there is
one org, slug `default` — which is itself worth adding to the list once it is
no longer in use).

## 5. Host → org resolution

### 5.1 The resolver primitive

Custom-domain resolution needs a database read, and the read happens in
middleware, on a request that may be entirely anonymous. Three properties are
required:

- it must not need a service-role client (a service key in edge middleware is
  a much larger exposure than the problem it solves);
- it must not make `org_domains` anon-readable as a table (that would let any
  visitor enumerate every tenant's domains);
- it must fail closed — an unresolvable host resolves *no* org, never a
  fallback org.

A `SECURITY DEFINER` resolver granted to `anon` satisfies all three with
minimal disclosure: it answers exactly one question ("which org slug, if any,
owns this host?") and only for verified rows.

```sql
-- PROPOSAL, not a migration.
create or replace function public.app_org_slug_for_host(_host text)
returns text
language sql stable security definer set search_path = ''
as $$
  select o.slug
  from public.org_domains d
  join public.organizations o on o.id = d.org_id
  where d.domain = _host
    and d.status = 'verified'
    and o.status = 'active';
$$;

revoke execute on function public.app_org_slug_for_host(text) from public;
grant execute on function public.app_org_slug_for_host(text) to anon, authenticated, service_role;
```

Notes on the shape, each one deliberate:

- **No normalization inside the function — canonicalization is middleware's
  job, once.** Rows are stored canonical (lowercase, punycode, no trailing dot,
  no port — the §6 CHECK constraint enforces it), and the middleware
  canonicalizes the request host before calling (§5.2 step 1). Non-canonical
  input — mixed case, a trailing dot, a port — therefore matches nothing and
  fails closed, which is exactly what the resolver suite in §13 pins. Two
  normalization points for the same value would drift; one contract, owned by
  the caller, asserted by tests on both sides.
- **Returns a slug, not an org id.** The slug is what `x-two42-org` carries and
  what `app_request_org_id()` already validates. Returning an id would create a
  second, differently-validated path to the same answer; the two would drift.
  The slug is public by construction — it *is* the header value.
- **`status = 'verified'` and `o.status = 'active'`.** An unverified claim
  resolves nothing. Note this is the *first* place `organizations.status` cuts
  an access path — [`tenancy-model.md`](../security/tenancy-model.md) currently
  records that `status` gates nothing outside `listActiveOrgs()`, and that
  paragraph must be updated by the PR that ships this. **Open decision D4**
  covers whether a suspended org's custom domain should stop resolving or
  should resolve and render a suspended notice.
- **No `org_id` predicate, and that is correct.** This function is a
  cross-tenant *routing* primitive: its whole job is to answer for a host whose
  org is not yet known. It is `SECURITY DEFINER`, so
  `schema_tenancy_lint.sql` check 4 will require the source to mention
  `org_id` — the join column satisfies that mechanically, which is exactly the
  case CLAUDE.md warns about ("check 4 only proves the source mentions
  `org_id`"). Review, not lint, is the control here. Keep the function to this
  one statement so review stays cheap.
- **`app_request_org_id()` is not modified.** It stays header-based. Folding a
  host lookup into it would put an `org_domains` join into the InitPlan of
  every RLS policy on every org-owned table, and would widen the one function
  whose simplicity is the security argument for the whole model. Host
  resolution is a routing concern that produces a header value; the DB's
  validation of that header is unchanged, so a broken resolver fails closed
  through the existing path. See **open decision D1** if the maintainer wants
  to revisit.

### 5.2 Middleware changes

`lib/supabase/middleware.ts` `updateSession()` gains a resolution step before
it constructs the Supabase client:

1. Read the host from `request.headers.get("host")` (Vercel sets this to the
   request host; `x-forwarded-host` is the fallback). Lowercase, strip port,
   strip a trailing dot. This is the *only* place the host is normalized — the
   resolver in §5.1 deliberately does none (see its notes).
2. Classify against the platform apex with an **exact label boundary, never a
   raw suffix check** — `host === apex` or `host.endsWith("." + apex)`, so that
   `evil-<apex>` (a registrable name that merely ends with the apex string)
   can never classify as platform. Three sub-cases:
   - `host === apex`: the platform host itself. No subdomain slug; only the
     path-addressed route (#3 in §4) can name an org.
   - `host.endsWith("." + apex)`: take the prefix before `"." + apex`. It must
     be **exactly one label** (no dots) that passes `isValidOrgSlug()` and is
     not reserved — otherwise resolve *no* org. Do **not** fall through to the
     custom-domain lookup: nothing under the platform apex is claimable as a
     custom domain, and multi-label hosts like `a.b.<apex>` are outside the
     wildcard certificate anyway.
   - Neither: a custom-domain candidate; continue to step 3.
3. Call `app_org_slug_for_host(host)` through an **anon** Supabase
   client (no cookies needed for this call — it is a pure function of the
   host).
4. If neither yields a slug, resolve no org — *unless* the host is one the
   deployment explicitly trusts, in which case fall back to
   `resolveOrgSlug()` (the env pin). Trusted hosts are a closed, static set:
   `localhost` / `127.0.0.1` (local dev), the host of `NEXT_PUBLIC_SITE_URL`
   (the self-host single-org case), and Vercel-generated preview hosts
   (`*.vercel.app` for this project). This keeps §5.1's fail-closed property
   intact end-to-end: an unverified or mistyped custom host must render the
   404 path, never the deployment's own tenant — otherwise any stray DNS name
   pointed at the deployment serves the env-pinned org's public surface under
   a domain that org never claimed. The fallback is a *deployment-shape*
   accommodation, not an unknown-host default. The middleware answers an
   unresolved untrusted host itself — a 404 rewrite, before any route runs —
   because the `createClient()` default in §5.3 ends in `resolveOrgSlug()` and
   must never be reachable on a host that resolved nothing.

The resolved slug then feeds the existing `x-two42-org` header on the
middleware client, and is forwarded to the rest of the request via a request
header the app can read:

```ts
// PROPOSAL
requestHeaders.set("x-two42-resolved-org", slug);
```

Two hard requirements on that header:

- **Strip any inbound `x-two42-resolved-org` before setting it.** A client can
  send arbitrary headers; if the middleware does not overwrite unconditionally,
  the header becomes client-controlled and every server component downstream is
  reading attacker input. Set, never append, and strip it on every path through
  `updateSession()` including the early redirects. The header is set **only
  when steps 2–3 resolved an org from the host itself**; on the trusted-host
  fallback (step 4) it is stripped and left unset, so downstream code can
  distinguish "the host names org X" from "the env-pin default applied" — the
  §5.3 mismatch check depends on that distinction.
- **Shape-check the slug before it reaches a header value.** Same reason
  `app/[orgSlug]/join/page.tsx` shape-checks its route param: a `%0d%0a`
  payload reaching undici as a raw header value throws a 500 instead of taking
  the fail-closed path. `isValidOrgSlug()` already exists for this.

**Caching.** A DB round trip per request in middleware is real latency on every
page. Cache the host → slug map in module scope with a short TTL (60s
suggested) and a small bound (say 256 entries). Edge instances are ephemeral
and per-region, so this is a best-effort hot-path cache, not a correctness
mechanism — nothing may depend on it being fresh, and a domain that has just
been verified may take up to the TTL to route. Negative results must be cached
too (with a shorter TTL) or an unknown-host flood becomes a query flood.

### 5.3 Server components and route handlers

`createClient()` in `lib/supabase/server.ts` already accepts an optional
`orgSlug`. It should default to the middleware-resolved value rather than the
env pin:

```ts
// PROPOSAL — lib/supabase/server.ts
const resolved = (await headers()).get("x-two42-resolved-org");
"x-two42-org": orgSlug ?? resolved ?? resolveOrgSlug(),
```

The explicit `orgSlug` argument keeps winning over the *default* — but §4's
precedence rule ("the host wins and a path slug naming a different org is a
404") has to be enforced somewhere, and this is where. Middleware cannot do it
alone: it does not know which path segments are org slugs. So the rule is a
route-level check, and `app/[orgSlug]/join` is the one route that needs it in
v1: before creating a client, read `x-two42-resolved-org`; if it is set (the
host itself resolved an org, per the §5.2 header contract) and the path slug
names a *different* org, return `notFound()` — never create a client for the
path slug. On the platform host and trusted hosts the header is unset, and the
path slug works exactly as today. Any future route
that takes an org slug as a path param inherits the same check; a small
`assertPathOrgMatchesHost(orgSlug)` helper next to `createClient()` keeps it
from being re-derived per route.

`lib/org.ts` must not import `next/headers` to do this. The file's opening
comment is explicit: it is reachable from the client bundle
(`lib/supabase/client.ts` → `app/join/JoinForm.tsx`, a `"use client"` module),
and importing `next/headers` there — statically or via `await import()` — pulls
it into the client graph, breaks `npm run build`, and closes an import cycle.
The `headers()` read belongs in `lib/supabase/server.ts`, which is already
server-only. Any new host-parsing helper added to `lib/org.ts` must be a pure
function of a host string.

### 5.4 The browser client

`lib/supabase/client.ts` runs in the browser and cannot read a request header.
Under wildcard subdomains it could parse `window.location.hostname` — but under
custom domains it cannot, and having two divergent resolution paths for the
same value is precisely how the anonymous join flow breaks in a way nobody sees
until a real visitor hits it (the anon insert goes browser → PostgREST
directly, so a browser client sending a different slug than the page resolved
means the RLS `WITH CHECK` rejects every submit).

**Inject the server-resolved slug; do not re-derive it client-side.** The root
layout reads `x-two42-resolved-org` and passes it to a small client provider;
client components that construct a Supabase client pass it to
`createClient(orgSlug)`, exactly as `app/[orgSlug]/join` already does today.
That route is the working precedent for the whole pattern.

**Explicitly rejected: a client-readable cookie.** Writing the slug to a
non-`httpOnly` cookie in middleware is less code, and it is *not* a privilege
escalation — a forged slug grants nothing, and any org's public surface is
reachable by visiting that org's host anyway. It is rejected because it adds a
second, client-writable source of truth for a value the server already knows,
for no benefit. Note also that auth cookies must stay **host-scoped**: setting
a cookie `Domain=.<platform-apex>` would share sessions across every org's
subdomain. `@supabase/ssr` scopes to the request host by default; do not
override it, and add a regression test that asserts no `Domain` attribute is
set on auth cookies.

### 5.5 A known limit this closes for free

[`tenancy-model.md`](../security/tenancy-model.md) records: "An authenticated
member of org A visiting org B's public page resolves to org A and sees nothing
(fail-closed, not wrong-tenant). Revisited in Phase 5 (#214)."

Host-based routing largely resolves it by construction, because cookies are
host-scoped: a session on `orga.<apex>` does not exist on `orgb.<apex>` or on
org B's custom domain, so the visitor arrives anonymous and org B's public
surface resolves correctly. The residual case is the *path-addressed* route on
the shared platform host, where one session does span both — and
`app/[orgSlug]/join/page.tsx` already handles it by redirecting any signed-in
user to `/dashboard` before resolution happens. The PR that ships §5.2 should
update that paragraph in `tenancy-model.md` rather than leaving it open.

## 6. Schema — `org_domains`

```sql
-- PROPOSAL, not a migration.
create type public.org_domain_status as enum ('pending', 'verified', 'failed');

create table public.org_domains (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations(id) on delete cascade,
  -- Stored lowercase, punycode (A-label) for IDNs, no trailing dot, no port.
  domain text not null,
  status public.org_domain_status not null default 'pending',
  -- Random token published by the org at _two42-verify.<domain> as a TXT
  -- record. Proves control of the name before it is attached to the project.
  verification_token text not null default encode(gen_random_bytes(16), 'hex'),
  verified_at timestamptz,
  -- Set by the attachment worker (§7) — its SOLE writer — after Vercel
  -- confirms the domain is attached to the project and it is in the auth
  -- redirect allowlist (§8). Verification proves *ownership*; attachment is
  -- what makes the host actually route. orgBaseUrl() (§9) requires it before
  -- the custom origin goes into any emailed link. NULLed whenever status
  -- leaves 'verified'.
  attached_at timestamptz,
  -- Attachment lease (§7): the worker's single-flight claim. claimed_at
  -- bounds the lease window; claim_token fences the writer — a worker may
  -- stamp attached_at only with the token its own claim returned, so an
  -- expired/superseded attempt cannot commit late.
  attach_claimed_at timestamptz,
  attach_claim_token uuid,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint org_domains_domain_shape check (
    domain = lower(domain)
    and length(domain) between 4 and 253
    and domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  )
);

-- The DNS namespace is global, so this unique is deliberately NOT per-org.
-- Partial on verified rows: two orgs may both *claim* a name, only one may
-- own it. Without the partial predicate, an org could squat every domain it
-- can think of and permanently block the real owner.
create unique index org_domains_verified_domain_key
  on public.org_domains (domain) where status = 'verified';

-- Cheap dedupe of repeat claims within one org.
create unique index org_domains_org_domain_key on public.org_domains (org_id, domain);

-- The resolver's access path.
create index org_domains_domain_idx on public.org_domains (domain) where status = 'verified';
```

Per the tenancy rules in CLAUDE.md: `org_id` is `not null default
public.app_current_org_id()`, and the FK is single-column into
`organizations` because the tenant root carries no `org_id` — the same shape
every other org-owned table uses (see `20260730010000_org_spine.sql`).

**The global unique is a deviation from the repo's per-org-unique norm and must
be recorded as such** in `tenancy-model.md`. The justification: host → org must
be a function, and DNS names are globally unique whether or not this schema
says so. The information leak it creates (org A learns, via a constraint
violation, that *someone* has verified a domain) is not a new disclosure —
public DNS already answers that question, and the verified domain is by
definition serving a public site.

### 6.1 RLS posture

```sql
-- PROPOSAL
alter table public.org_domains enable row level security;

-- The restrictive isolation floor, verbatim per the Phase 2 template.
create policy "org isolation" on public.org_domains
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

-- Permissive: org admins only. Factored ORG AND (arms), never (ORG AND a) OR b.
create policy "Admins manage org domains" on public.org_domains
  for all to authenticated
  using      (org_id = (select public.app_request_org_id()) and (select public.is_admin()))
  with check (org_id = (select public.app_request_org_id()) and (select public.is_admin()));
```

- **No `anon` permissive policy, on purpose.** Anonymous host resolution goes
  through `app_org_slug_for_host()` and nothing else. Postgres RLS grants
  nothing without a permissive policy, so `anon` reads zero rows from this
  table — which is the intended posture, not the accident that
  `20260801000002` had to fix on `organizations`.
- Helper calls are wrapped `(select public.helper())` so the planner evaluates
  them once per statement. This repo has regressed on that twice.
- `status`, `verified_at`, `attached_at`, and the attachment-lease columns
  are **server-set only**. An org admin who could
  `update … set status = 'verified'` would bypass DNS verification entirely
  and attach any name to their org; one who could set `attached_at` would
  stamp the routing fact without confirmed Vercel state and flip the org's
  canonical origin to an unrouted host (§6.3 step 6, §9). The admin-facing
  write surface must be a route handler that only ever writes `domain` on
  insert — a column-level `GRANT` excluding `status`/`verified_at`/
  `verification_token`/`attached_at`/`attach_claimed_at`/`attach_claim_token`
  from `authenticated` (**decision D2**: the grant, not the policy shape).
  The pgTAP grant-matrix suite must assert each excluded column individually,
  including that `authenticated` cannot write `attached_at`.

### 6.2 Service-role touchpoints and their org anchors

| Site | Why service-role | Org anchor | Scoped queries |
|---|---|---|---|
| `app/api/admin/domains/route.ts` (new) — claim a domain | None needed. The insert runs on the cookie-bound request client under the admin policy above | n/a — RLS is the boundary | — |
| `app/api/admin/domains/[id]/verify/route.ts` (new) — DNS TXT check, then flip `status` | The status transition must not be writable by the admin's own client (§6.1) | The caller's own RLS-scoped `profiles.org_id`, re-read on the request client; the target row is fetched `.eq("id", id).eq("org_id", orgId)` before any write | `org_domains` select + update, both on `(id, org_id)` |
| Middleware host resolution | **Not a service-role site.** `app_org_slug_for_host()` is `SECURITY DEFINER` and runs on the anon client | n/a | n/a |

Both new routes need rows in
[`service-role-inventory.md`](../security/service-role-inventory.md) under
"App routes and pages" **in the same PR**, and the site count in that heading
must be updated — `npm run guard:tenancy` cross-checks both and fails twice
over otherwise.

The verify route is a **Tier B** chain rooted at a `createServiceClient()`
binding, so every chain off it needs an `org_id` predicate. It is not an org
anchor and must not carry an `// org-anchor:` marker — the org comes from the
caller's profile, which is a validated anchor the guard can see as a plain
predicate.

### 6.3 The CNAME / verification flow

1. **Admin claims** `example.church` in `/admin/settings/domains`. Row inserts
   with `status = 'pending'` and a fresh `verification_token`.
2. **UI shows two records** to publish:
   - `TXT  _two42-verify.example.church  →  <verification_token>`
   - `CNAME example.church → cname.vercel-dns.com` (apex domains need an
     ALIAS/ANAME or a provider that flattens; the UI must say so — this is the
     single most common support case in every product that ships this feature)
3. **Admin clicks Verify.** The route resolves the TXT record server-side
   (Node `dns/promises` `resolveTxt`, from a Node-runtime route handler, not
   edge), compares against the stored token, and on match sets
   `status = 'verified'`, `verified_at = now()`. On mismatch it sets
   `last_checked_at` and returns a diagnostic. Rate-limit the verify action per
   org (the `feedback` route's count-in-a-window pattern is the precedent).
4. **The domain is attached to the Vercel project.** See §7.
5. **The domain is added to the Supabase auth redirect allowlist.** See §8.
6. **The attachment worker marks the row attached** (§7), setting
   `attached_at` after Vercel confirms the attachment. The worker is the
   **sole writer** of `attached_at` — the `/platform` surface can trigger a
   retry but never stamps the column itself. Only after the stamp does the
   domain become the org's canonical origin.
   Without this gate there is a window — `status = 'verified'` set, Vercel
   attachment still pending — during which an email built from the custom
   origin would link to a host that does not route anywhere. `verified` is an
   ownership fact; `attached_at` is the routing fact, and §9's `orgBaseUrl()`
   requires both. (The §5.1 resolver gates on `verified` alone, deliberately:
   a verified-but-unattached host never reaches the middleware, because Vercel
   will not route it here — and the moment attachment makes it routable, it
   should resolve.)

Steps 4 through 6 are the ones that are not purely in-app, and they are why
**open decision D3** exists.

## 7. Attaching the domain to Vercel

Two shapes:

- **Wildcard `*.<platform-apex>`** — added once, by an operator, at project
  setup. Vercel issues a wildcard certificate only when the apex's nameservers
  are delegated to Vercel (or via a DNS-01 challenge the operator completes).
  This is a one-time infrastructure task, not per-org code. It must be done
  before subdomain routing is announced, and the spec's §12 rollout puts it
  first for that reason.
- **Per-org custom domains** — each name must be added to the Vercel project
  individually (`POST /v10/projects/{id}/domains`) before Vercel will route it
  or issue a certificate. Automating that requires a Vercel API token in the
  app's environment.

**Decided (D3, 2026-08-16): fully self-serve via an isolated attachment
worker — the app never holds the Vercel token.** The original draft
recommended operator-in-the-loop to keep the deployment-control credential out
of the environment entirely; the maintainer chose automation, with the
credential-isolation concern answered by *where the token lives* rather than
by a human step. The shape:

- The Next.js app — the large, untrusted-input-facing surface — has no Vercel
  credential. Its only power is flipping an `org_domains` row to `verified`,
  which it can do only by passing the TXT check.
- A dedicated attachment worker (a Supabase edge function, matching the
  existing service-key posture in `supabase/functions/`) holds the Vercel
  token as a function secret. It does one job: read rows that are `verified`
  with `attached_at is null`, call `POST /v10/projects/{id}/domains`, stamp
  `attached_at` after Vercel confirms the attachment. Surface persistent
  failures on the `/platform` dashboard rather than silently looping.
- **Attachment is single-flight and fenced.** A scheduled worker invocation
  and a `/platform` manual retry must not race. Each attempt acquires a
  durable claim in one atomic statement that also revalidates row state:

  ```sql
  update public.org_domains
     set attach_claimed_at = now(), attach_claim_token = gen_random_uuid()
   where id = _row_id
     and status = 'verified' and attached_at is null
     and (attach_claimed_at is null
          or attach_claimed_at < now() - interval '10 minutes')
   returning attach_claim_token;
  ```

  Zero rows back means another attempt holds a live lease *or* the row's
  state moved (verification revoked, already attached) — either way, stop.
  The returned token fences the writer: the final stamp is
  `update … set attached_at = now() where id = _row_id and attach_claim_token
  = _token and status = 'verified' and attached_at is null`, so a slow worker
  whose lease expired mid-flight (its token superseded by a newer claim)
  cannot commit a stale result. The lease columns live in the §6 schema
  (`attach_claimed_at`, `attach_claim_token`).
- **The Vercel add-domain call is keyed by the domain name, and its error
  codes are not symmetric.** "Domain already exists **on this project**"
  (Vercel reports this as a 400-class error) is idempotent success — confirm
  via the GET below, then stamp. A **409 conflict means the name is assigned
  to a *different* Vercel project or account** — that is a hard failure to
  surface on `/platform`, never a success: stamping it would emit canonical
  URLs for a host the platform does not route.
- **Uncertain results reconcile before retrying.** On a timeout or ambiguous
  response the worker must not blindly re-POST: it first reads the domain
  back from Vercel (`GET /v9/projects/{id}/domains/{domain}`) and stamps
  `attached_at` if the attachment in fact happened. `attached_at` is only
  ever set from a *confirmed* Vercel state — never optimistically — because
  §9's `orgBaseUrl()` starts emitting the custom origin the moment it is set.
- **The worker is the sole writer of `attached_at`** (§6.3 step 6). The
  `/platform` surface requests a retry by clearing the expired claim, never
  by writing the column.
- **Denylist in the worker**: it refuses the platform apex and any of its
  subdomains outright, so no tenant can attach a name that shadows the
  platform. This check lives in the worker, not only in the claim UI.
- **Entitlement hook**: before attaching, the worker consults a per-org
  entitlement check that is `true` for everyone today and becomes the billing
  gate when Stripe lands (§3) — verification is free; *attachment* is the
  paid event. This is the reason automation wins long-term: a paywalled
  feature with an operator in the loop is a support queue.
- Defense in depth: Vercel independently challenges domains claimed by
  another Vercel account, so a bug in the verify route alone cannot hijack a
  domain Vercel already knows belongs elsewhere.

Residual risk, accepted: Vercel tokens are team-scoped, not finely scoped, so
a compromised *worker* still holds a deployment-control credential. The
mitigation is the same as for the service key those functions already hold —
minimal code in the worker, secrets never in the repo, and review of every
change to `supabase/functions/` (CLAUDE.md already mandates this).

The `/platform` list of domains and their attachment status stays (§6.3
step 6) — as observability and a manual retry surface, no longer as the
mechanism.

Note the asymmetry with §9 still holds, now with a parallel answer: per-org
**sending** domains are automated through the app-held `RESEND_API_KEY`
(blast radius: email, already bounded by §10's send caps); domain
*attachment* is automated through the worker-held Vercel token (blast radius:
deployment, bounded by isolation and the denylist).

## 8. Auth redirect allowlist

This is the part that silently breaks if it is skipped, because the failure is
a redirect to the *wrong host* rather than an error.

**What exists.** `app/api/auth/callback/route.ts` builds its redirect from the
request's own `origin`, so it is already host-relative and needs no change for
custom domains. `app/(auth)/forgot-password/page.tsx` passes
`${window.location.origin}/api/auth/callback?next=/update-password` as
`redirectTo` — also host-relative.

**Why it still breaks.** Supabase Auth rejects any `redirectTo` not matching
`SITE_URL` or the project's redirect allowlist, and *silently falls back to
`SITE_URL`*. A password reset initiated on `example.church` would land the user
on the platform host, on a different cookie scope, session-less. Every org host
— the wildcard pattern and every custom domain — must be in that allowlist.

**Work items:**

- Add `https://*.<platform-apex>/**` to the project's additional redirect URLs
  once. Wildcards match a single label, so one entry covers all subdomains.
- Adding each custom domain is a per-org operator step, paired with §7 (same
  queue, same trigger). It is remote Supabase project configuration —
  **CI/CD and the operator own it; nothing in the app may write it**, per the
  repo's hard database rule.
- Harden `next` in the callback route while it is open: require it to start
  with a single `/` and reject `//` and any scheme-ish prefix. It is not
  exploitable as written (`${origin}//evil.com` parses as a path on `origin`),
  but the invariant should be asserted rather than inferred, and a
  per-host world is the wrong time to be relying on URL-parsing subtleties.
- Document the allowlist in `docs/security/` alongside the domain flow, since
  a missing entry is invisible in CI and only shows up as "password reset sends
  me to the wrong site".

## 9. Per-org base URLs in email — the cross-cutting one

`siteConfig.url` is a single env constant, and it is used to build **every**
link the platform emails:

| Site | Link |
|---|---|
| `app/api/admin/approve/route.ts:66` | `/setup-account?token=…` |
| `app/api/platform/organizations/[id]/invite-owner/route.ts:70` | `/setup-account?token=…` |
| `app/api/admin/invite-bulk/route.ts:75` | `/join` |
| `app/api/family-invites/route.ts:140` | `/join/family/<token>` |
| `app/api/serving/broadcast/route.ts:185,191` | `/serving/go?token=…`, `/serving/<groupId>` |
| `lib/serving/server.ts:107,113,184` | same serving links |
| `lib/email/serving.ts:173`, `lib/email/resend.ts:215` | `/serving`, `/events` |

Under custom domains every one of these mails a link to the *platform* host.
The consequences differ, and the worst is not cosmetic: a `/join/family/<token>`
or `/setup-account?token=…` link on the platform host resolves the platform
deployment's env-pinned org, not the recipient's. The token flows fail closed
(the token row is what resolves the org, and both consume/verify routes already
require it), so this is a broken-link bug rather than a cross-tenant one — but
it breaks the entire onboarding funnel for any org with a custom domain.

**Proposed resolver:** `orgBaseUrl(orgId)` in a new `lib/org-urls.ts`,
returning the org's canonical origin — the custom domain if its row is
`verified` **and** `attached_at` is set (§6.3 step 6; verified alone means
ownership is proven but the host may not route yet, and an emailed link must
never point at an unrouted host), else `https://<slug>.<platform-apex>`, else
`siteConfig.url`. It reads the same `org_domains` row the resolver in §5.1
uses. Every call site above takes an
`orgId` it already holds (or can derive from the anchor it already validated),
so this is a mechanical change, not a re-architecture.

**The edge functions need a mirror.** `supabase/functions/` cannot import from
`lib/`, exactly as with `_shared/branding.ts`. Both reminder functions build
links; both already carry an org-anchored `organizations` select via
`listActiveOrgs()`, so the canonical host can ride along on that same select
with no new query and no new service-role site — the pattern CWA-56 (#322)
established for branding. Do it that way. A change to the URL contract lands on
both sides in one PR.

**Also fix `resolveEmailBranding()` while here.** Its no-`orgId` path resolves
branding from the *request* org, and its own comment says this becomes wrong in
Phase 5 for any caller that had an `org_id` in scope and did not pass it. Audit
the callers, pass `orgId` everywhere it exists, and consider making the
parameter required with a separate explicitly-named
`resolveRequestEmailBranding()` for the genuinely request-scoped callers, so
the dangerous case has to be typed out. The `console.debug` in that branch is
the diagnostic to watch during rollout.

---

# Part B — Per-org sending domains and send caps

## 10. Per-org verified sending domains (Resend)

### 10.1 Lifecycle

Resend's domains API is the mechanism: `resend.domains.create({ name })`
returns the DNS records to publish (a DKIM `TXT`, an SPF `TXT`, and a
`MX` for the return path, depending on region), `resend.domains.verify(id)`
triggers a re-check, and `resend.domains.get(id)` reports status
(`not_started` / `pending` / `verified` / `failure` / `temporary_failure`).

The app already holds `RESEND_API_KEY`, so unlike §7 this can be fully
automated in-app:

1. Admin enters a sending domain in `/admin/settings/email`. Typically a
   subdomain (`mail.example.church`) — recommend it in the UI, since putting
   DKIM/SPF on the apex collides with whatever else the org's IT already runs
   there.
2. The route calls `domains.create`, stores `resend_domain_id` and the returned
   records, and shows them for publishing.
3. Admin clicks Verify → `domains.verify(id)`, then poll `domains.get(id)` and
   persist the status. **Do not add a cron for this.** A re-check on page load,
   throttled by `last_checked_at`, plus the explicit button, covers a flow that
   happens once per org ever.
4. Once `verified`, outbound mail for that org uses
   `noreply@<sending_domain>`. Until then, and on any regression away from
   `verified`, it uses `PLATFORM_ADDRESS` — fail-soft, same contract as
   branding: *a domain problem must never block an email.*

### 10.2 Schema — `org_email_domains`

```sql
-- PROPOSAL, not a migration.
create table public.org_email_domains (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations(id) on delete cascade,
  domain text not null,
  -- Resend's id for the domain. Not a secret; it is a handle, and every call
  -- using it is already authenticated by the platform API key.
  resend_domain_id text,
  -- Mirrors Resend's own status vocabulary rather than inventing one, so a
  -- status nobody anticipated cannot be silently mapped to 'verified'.
  status text not null default 'not_started'
    check (status in ('not_started','pending','verified','failure','temporary_failure')),
  -- The DNS records to publish, as returned by Resend. Public data (a DKIM
  -- public key and an SPF include); rendered to the admin, never to a member.
  dns_records jsonb not null default '[]'::jsonb,
  verified_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint org_email_domains_domain_shape check (
    domain = lower(domain) and length(domain) between 4 and 253
  )
);

-- One sending domain per org for v1. Multiple is a feature nobody has asked
-- for and it multiplies the "which one did this send from" question.
create unique index org_email_domains_org_key on public.org_email_domains (org_id);
```

RLS: the same restrictive floor and the same admin-only permissive policy as
§6.1, with the same server-set-only constraint on `status`, `resend_domain_id`,
`dns_records`, and `verified_at`.

**Deliberately no global unique on `domain`.** Unlike a web host, two orgs
verifying the same mail domain is Resend's problem to reject, and the failure
mode of getting it wrong here (a duplicate row) is much cheaper than the
squatting problem the partial unique in §6 solves.

### 10.3 The `From:` address is an injection boundary

`lib/email/identity.ts` currently guards the display name with `PLAIN_NAME` and
formats an address that is a **platform constant**. Making the address per-org
puts admin-supplied text on the other side of the `<…>` for the first time, and
the existing guards do not cover it — `PLAIN_NAME` validates the name, and
`formatFromHeader()` strips CR/LF from the name, not from the address.

Two rules, both non-negotiable:

- **The local part is a fixed constant.** `noreply@<verified domain>`. Do not
  let admins choose it in v1. This removes an entire class of input from the
  address and costs nothing anyone has asked for.
- **The domain is validated by a new named regex** — `SENDING_DOMAIN` in
  `lib/email/identity.ts`, alongside `PLAIN_NAME`, with the same standing: a
  validation boundary, not a style choice. The exact, anchored pattern:

  ```ts
  // PROPOSAL — lib/email/identity.ts
  const SENDING_DOMAIN =
    /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  ```

  It accepts only fully-lowercase LDH labels (1–63 chars each, no leading or
  trailing hyphen), at least one dot, 4–253 chars total — and by construction
  rejects underscores, trailing dots, ports, whitespace, CR/LF, `@`, `<`/`>`,
  and any non-ASCII byte. It performs **no normalization**: the value must
  already be canonical. IDNs are supported only as punycode A-labels,
  converted at claim time in the admin route; a non-ASCII value read back from
  the DB simply fails the regex — v1 does not attempt IDNA mapping at send
  time. The check runs at *send* time against the value read from the DB, not
  only at write time — the write path already validates, and the read-time
  check is what makes a compromised or hand-edited row non-exploitable. On any
  failure the address is `PLATFORM_ADDRESS` and the fallback is logged; never
  a "cleaned-up" version of the stored value. (This is the same grammar as the
  `org_domains_domain_shape` CHECK in §6 — one definition of a valid hostname,
  wherever it is enforced.)
- **`status = 'verified'` gates the substitution** in the same expression. An
  unverified domain — any of the four non-`verified` statuses — falls back to
  `PLATFORM_ADDRESS`.

Per CLAUDE.md's UI-conventions rule, `supabase/functions/_shared/branding.ts`
mirrors `HEX`, `CONTROL`, and `PLAIN_NAME` **byte-for-byte**. `SENDING_DOMAIN`
joins that set: it lands on both sides in the same PR, the edge functions
apply the same regex-plus-verified-status gate before using a per-org address,
and the PR that ships it adds the constant to CLAUDE.md's named injection
boundaries (§14). Unit tests on both sides assert the fallback: an invalid
stored domain and an unverified row each produce `PLATFORM_ADDRESS`, and a
CR/LF-bearing value can never reach `formatFromHeader()`.

`EmailBranding` gains a `fromAddress: string` field, resolved in
`resolveEmailBranding(orgId)` from the org's `org_email_domains` row and
defaulted to `PLATFORM_ADDRESS`. Every `formatFromHeader(b.orgName,
PLATFORM_ADDRESS)` call site in `lib/email/resend.ts` and
`lib/email/serving.ts` becomes `formatFromHeader(b.orgName, b.fromAddress)`.
Keep the name `fromAddress` distinct from anything member-facing, for the same
reason `orgName` is not called `fromName` — that comment in `identity.ts` is
about a swap that would put a member's personal name on org mail, and the same
care applies here.

Note this is a second query inside `resolveEmailBranding()`, which today reads
`organizations.branding` alone with `.eq("id", orgId)` as its only tenant
boundary. The new read is on an org-owned table and takes `.eq("org_id",
orgId)` — a plain Tier B predicate the guard can see. Update the
`lib/email/identity.ts` row in
[`service-role-inventory.md`](../security/service-role-inventory.md) to name
both tables.

## 11. Per-org send caps

**Purpose, restated because it will drift:** these bound the blast radius of a
bug or an abusive tenant on a shared Resend account and a shared sending
reputation. They are not a billing meter (§3).

### 11.1 Schema

```sql
-- PROPOSAL, not a migration.
create table public.org_email_usage (
  org_id uuid not null default public.app_current_org_id()
    references public.organizations(id) on delete cascade,
  -- UTC day. A rolling window needs a row per send; a daily bucket needs one
  -- row per org per day and is enough to stop a runaway fan-out.
  usage_date date not null default (now() at time zone 'utc')::date,
  sent_count integer not null default 0 check (sent_count >= 0),
  primary key (org_id, usage_date)
);

create table public.org_email_limits (
  org_id uuid primary key default public.app_current_org_id()
    references public.organizations(id) on delete cascade,
  daily_cap integer not null default 500,
  updated_at timestamptz not null default now(),
  constraint org_email_limits_cap_sane check (daily_cap between 0 and 100000)
);
```

Both carry the restrictive isolation floor. `org_email_usage` gets **no
permissive policy at all** in v1 — it is written and read by service-role code
only, and a table with only a restrictive policy is readable by no PostgREST
caller, which is the intended posture. (Adding an admin-facing usage display
later means adding a permissive SELECT arm; the `organizations` history in
[`tenancy-model.md`](../security/tenancy-model.md) is the cautionary tale for
assuming a permissive policy exists.) `org_email_limits` is
**platform-operator-owned, not org-admin-owned** — an org that can raise its
own cap does not have a cap. Writes go through the `/platform` surface, gated
on `requirePlatformAdmin()` like every other cross-org write — and, to be
precise about the mechanism: that gate authorizes, it does not *reach*.
`requirePlatformAdmin()` runs on the cookie-bound request client, which does
not bypass RLS, and the restrictive isolation floor deliberately has no
platform-admin escape hatch. The cap editor therefore follows the existing
`/platform` write pattern (`app/api/platform/organizations/[id]/route.ts`):
after the gate, a `createServiceClient()` write with an explicit
`.eq("org_id", …)` on a target org id first validated against an existing
`organizations` row. That makes it a new service-role site — it gets a row
under "App routes and pages" in
[`service-role-inventory.md`](../security/service-role-inventory.md) in the
same PR (PR 8 in §12), with the heading's site count updated. The org-side
permissive policy, if any, is SELECT-only.

### 11.2 Enforcement must be atomic

Counting rows and then sending is a race: two concurrent fan-outs both read
"under the cap" and both send. Reserve first, in one statement:

```sql
-- PROPOSAL, not a migration.
create or replace function public.email_quota_consume(_org_id uuid, _n integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  _cap integer;
  _ok boolean;
begin
  -- A non-positive _n is a caller bug, not a refusable request: raising makes
  -- the bug loud, and it closes the door on a negative _n walking sent_count
  -- backwards (the >= 0 CHECK on the table is the second lock on that door).
  if _org_id is null or _n is null or _n <= 0 then
    raise exception 'email_quota_consume: _n must be a positive batch size';
  end if;

  select l.daily_cap into _cap
  from public.org_email_limits l where l.org_id = _org_id;
  _cap := coalesce(_cap, 500);

  -- Bounds the INSERT path: without this, the first reserve of a UTC day is
  -- unguarded (ON CONFLICT ... WHERE only constrains the UPDATE arm) and a
  -- fan-out larger than the cap would sail through on a fresh day.
  if _n > _cap then
    return false;
  end if;

  insert into public.org_email_usage as u (org_id, usage_date, sent_count)
  values (_org_id, (now() at time zone 'utc')::date, _n)
  on conflict (org_id, usage_date) do update
    set sent_count = u.sent_count + excluded.sent_count
    where u.sent_count + excluded.sent_count <= _cap
  returning true into _ok;

  return coalesce(_ok, false);
end;
$$;

revoke execute on function public.email_quota_consume(uuid, integer) from public, anon, authenticated;
grant execute on function public.email_quota_consume(uuid, integer) to service_role;
```

This is a `SECURITY DEFINER` function that **writes an org-owned table**, so
per CLAUDE.md it is a tenant boundary of its own and the org checks in its body
replace RLS. The specific tension: the rule says resolve the org from a
server-owned row, never from a caller parameter — and this takes `_org_id` as a
parameter. The resolution is the `serving_signup_apply` precedent
(`20260803010000_serving_signup_rpc.sql`): **EXECUTE is granted to
`service_role` only**, with no `anon` or `authenticated` grant, so the only
callers are server-side paths that already hold a validated `orgId` from an
anchor they verified. That must be stated in the migration header, pinned by a
pgTAP grant-matrix assertion, and recorded in the inventory — the same
treatment the serving RPC pair got. If an authenticated entry point is ever
needed, it gets a separate wrapper that pins the org to
`app_request_org_id()`, exactly as `serving_signup_create` does.

The two guards in the body are load-bearing, not defensive garnish: the
`_n <= 0` raise is what keeps a buggy caller from decrementing usage, and the
`_n > _cap` pre-check is the *only* bound on the INSERT arm. Both are the kind
of thing the pgTAP suite must assert directly — a first-of-day batch larger
than the cap refused, a zero and a negative `_n` raising, and the `>= 0`
CHECK rejecting a direct negative write.

**Call sites:** every fan-out reserves before sending and skips (logging, not
throwing) when refused. That is the Tier A set from the inventory — feedback
admin notifications, serving broadcast, leader cancel notices — plus both
reminder edge functions. Reserve per *batch*, before the first send; a
per-recipient reserve is a round trip per member.

**Reservation semantics, pinned so the call sites cannot each invent one:**

- **`sent_count` counts *reserved attempts*, not confirmed deliveries.** A
  reservation is consumed whether or not Resend accepts every message. The
  counter exists to bound blast radius, so every error it can make must be in
  the conservative direction: over-counting wastes some of one org's daily
  budget; under-counting un-bounds the thing the table exists to bound.
- **`_n` is the size of the final sendable set** — after the null/empty-email
  filter and dedupe the fan-outs already do (the reminder paths skip profiles
  without an email), not the raw recipient list. Reserving for rows that were
  never going to be attempted burns quota for nothing and makes the counter
  unreadable as a diagnostic.
- **A quota RPC *error* is a refusal.** Log and skip the send, exactly as a
  `false` return — never "the quota table was unreachable, send anyway." The
  cap is a fail-closed control or it is not a control.
- **A crash between reserve and send leaks the reservation, and v1 accepts
  that.** Same for a cron retry that re-invokes a fan-out: it re-reserves, and
  messages already counted may be counted again. Both errors are in the
  permitted (conservative) direction, both self-heal at the UTC day rollover,
  and both are bounded by the cap itself. Idempotent reservation keys and
  reconciliation against Resend's accounting are billing-meter machinery — §3
  rules them out until there is a meter to be accurate for. If a leaked
  reservation ever blocks a real send, the operator raises the org's cap for
  the day via the `/platform` editor; that is the entire recovery procedure.

**Two blind spots to state loudly in the PR description**, because neither is
caught by CI:

- `scripts/check-service-role-org-scope.mjs` walks `.from()` chains only, so
  an `.rpc("email_quota_consume", …)` call is invisible to it — the inventory
  already records `.rpc()` as a guard blind spot.
- The guard's scan set is `git ls-files app lib`; the whole
  `supabase/functions/` tree is out of scope. The edge-function quota calls are
  covered by review and by `deno test` only.

## 12. Rollout order

Migrations must land one branch at a time (repo rule), so this is a sequence,
not a fan-out. Each numbered item is a PR.

**Infrastructure prerequisite (no code):** `*.<platform-apex>` added to the
Vercel project with a wildcard certificate issued, and
`https://*.<platform-apex>/**` added to the Supabase project's redirect
allowlist. Nothing in §12.2 onward is testable end-to-end without it.

1. **Reserved slug labels** — denylist in `provision_organization()` (new
   `TN00x`) and its mirror in `lib/org.ts`; pgTAP for the raise. No routing
   change yet. Small, independent, and must precede any slug-as-host work.
2. **`org_domains` + `app_org_slug_for_host()`** — table, enum, indexes, RLS,
   resolver function, grants. pgTAP: isolation, the partial unique, the
   resolver's verified/active gating, and a negative probe. No app code reads
   it yet.
3. **Host-aware org resolution** — middleware host parsing + resolver call +
   `x-two42-resolved-org` (stripped and shape-checked), `lib/supabase/server.ts`
   default, the client-side provider, the cookie-scope regression test.
   Behavior is unchanged for the existing deployment because step 4 of §5.2
   falls back to the env pin for the deployment's own trusted host. This is
   the highest-risk PR in the phase: it touches the request path for every
   route.
4. **Admin domain UI + verify route + attachment worker** — claim, TXT
   check, status transition, and the isolated Vercel-attachment edge function
   (§7: token as a function secret, apex denylist, entitlement hook,
   `attached_at` stamp). `/platform` shows attachment status and a manual
   retry, not a required confirmation step. Inventory rows for both the
   verify route and the worker.
5. **Per-org base URLs** — `orgBaseUrl()`, every `siteConfig.url` call site
   in §9, the edge-function ride-along mirror, and the
   `resolveEmailBranding()` orgId audit. Ships before any org actually has a
   custom domain, so nothing is broken in transit.
6. **`org_email_domains`** — table, RLS, Resend create/verify routes, admin UI.
   No sending change yet.
7. **Per-org `From:`** — the domain regex in `lib/email/identity.ts` and its
   edge mirror, `EmailBranding.fromAddress`, the verified-status gate, and the
   call-site sweep. Inventory update for the second table in
   `resolveEmailBranding()`.
8. **Send caps** — `org_email_usage`, `org_email_limits`,
   `email_quota_consume()`, grant matrix, call-site reserves in app and edge,
   `/platform` cap editor. pgTAP for the atomicity and the first-send-of-day
   bound.

Steps 1–5 and 6–8 are independent of each other and can be worked by different
people, subject to the one-migration-branch-at-a-time rule.

## 13. Test plan

Beyond the suites each PR obviously needs:

- **`tenancy_leak_suite.sql` fixture completeness.** The suite carries per-table
  assertions that org B actually holds rows, so a green run can never be
  vacuous. Every new table in this spec — `org_domains`, `org_email_domains`,
  `org_email_usage`, `org_email_limits` — needs fixtures for **both** seeded
  orgs, or the suite fails. This is the step that gets forgotten.
- **`schema_tenancy_lint.sql` applies automatically** to the new tables (RLS
  enabled, `org_id` present, NOT NULL, the exact `app_current_org_id()`
  default, exactly one restrictive isolation policy, no bare `true`, composite
  FKs). Nothing needs to be added to it; nothing may be added to its allowlist
  to make a new table pass.
- **Resolver suite** — `app_org_slug_for_host()` returns NULL for: unknown
  host, `pending` row, `failed` row, verified row in a suspended org (per D4),
  an empty string, a host with a trailing dot, and mixed case. Positive control
  for a verified row in an active org. The trailing-dot and mixed-case cases
  pin the §5.1 no-normalization contract: canonicalization happens in
  middleware, once, and the resolver rejects non-canonical input by simply not
  matching it.
- **Quota suite** — concurrent `email_quota_consume` under a cap (two sessions,
  one succeeds), the first-send-of-day bound (`_n > _cap` refused on a fresh
  day), a zero and a negative `_n` raising, the `sent_count >= 0` CHECK, the
  day rollover, the grant matrix (`anon`/`authenticated` have no EXECUTE), and
  a refused reserve leaving `sent_count` unchanged. Assert **row counts**, not
  just the absence of an error: a filtered write is a silent success in this
  codebase and has bitten it before.
- **From-address gate** — unit tests on both sides of the mirror
  (`lib/email/identity.ts` and `_shared/branding.ts`): an invalid stored
  domain, each non-`verified` status, and a CR/LF-bearing value all resolve to
  `PLATFORM_ADDRESS`; a verified canonical domain substitutes.
- **`orgBaseUrl()` gating** — a `verified` row without `attached_at` never
  becomes the canonical origin (§6.3 step 6); with it, the custom origin wins.
- **Header hygiene** — a unit test that an inbound `x-two42-resolved-org` is
  overwritten, and one that a CRLF-bearing host cannot reach a header value.
- **`npm run guard:tenancy`** before every push, and the inventory rows in the
  same PR as their call sites.
- **`deno check` + `deno test`** on both edge entry points for any PR touching
  `_shared/` or the reminder functions (§9, §10.3, §11.2 all do).
- **`npm run db:types`** after every migration; CI fails on drift.
- Run pgTAP through the shared stack's container, never `supabase test db`.

## 14. Docs to update, and by which PR

| Doc | Change | PR |
|---|---|---|
| `tenancy-model.md` — "Org resolution" | `x-two42-org` is now host-derived; `app_org_slug_for_host()` added to the helper inventory; the env pin is a fallback | 3 |
| `tenancy-model.md` — "Known limits" | The org-A-member-on-org-B's-page limit is closed for host-addressed routes (§5.5) | 3 |
| `tenancy-model.md` — "Known limits" | `organizations.status` now cuts an access path (host resolution) — the current text says it gates nothing | 2 |
| `tenancy-model.md` — deviations register | The global partial unique on `org_domains.domain` (§6) | 2 |
| `service-role-inventory.md` | Rows for the domain verify route, the quota RPC, and the `/platform` cap editor (§11.1); updated site counts; `lib/email/identity.ts` row names both tables | 4, 7, 8 |
| `CLAUDE.md` | The new `From:`-address regex joins the named injection boundaries and the edge-mirror rule | 7 |
| A new `docs/security/domains.md` (or a section here) | The redirect allowlist, the operator queue, and the manual Vercel step | 4 |

## 15. Risks

- **Middleware is the whole request path.** PR 3 (§12) can take down every
  route for every org. It needs the trusted-host fallback (§5.2 step 4) to
  keep the existing deployment's behavior identical, a canary deploy, and a
  fast revert path — and the trusted-host set must include the deployment's
  own host from day one, or the fallback protects nothing. The negative-result
  cache is a DoS surface if it is unbounded.
- **DNS is not transactional.** A domain can be verified, then have its records
  removed. `status` will read `verified` while the CNAME points nowhere. That
  is acceptable for routing (the site simply stops resolving, which is the
  org's own doing) and *not* acceptable for sending (mail from an
  unauthenticated domain damages the shared platform reputation). Consider a
  periodic re-check of `verified` mail domains — but not in v1, and not as a
  new cron unless the sending volume justifies it. **Open decision D5.**
- **Fail-soft on branding is right; fail-soft on sending domain is subtler.**
  Falling back to `PLATFORM_ADDRESS` when a domain regresses means members
  silently start receiving mail from a different address mid-flight. That is
  strictly better than a bounce, but it should log loudly enough that an
  operator notices.
- **The reserved-label denylist is retroactive.** Enforce it in
  `provision_organization()` only after auditing existing slugs; there is one
  org today (`default`), which makes this cheap now and expensive later.
- **Two orgs, one browser.** A member of two orgs will hold two host-scoped
  sessions. Nothing breaks, but "log out" logs out of one host. Worth a note in
  the UI copy; not worth engineering around at this scale.

## 16. Open decisions for the maintainer

**All seven resolved by the maintainer, 2026-08-16.** Each entry keeps its
original framing with the resolution appended; sections the decisions changed
(§7, §12) have been updated in place.

**D1 — Where does host resolution live?** This spec puts it in a separate
`app_org_slug_for_host()` called from middleware, leaving
`app_request_org_id()` untouched (§5.1). The alternative is teaching
`app_request_org_id()` to resolve an `x-two42-host` header directly, which
removes the app-layer mapping entirely and makes drift impossible — at the cost
of an `org_domains` join in the InitPlan of every RLS policy on every org-owned
table, and a materially larger security-critical function. **Recommendation:
separate resolver.** Confirm before PR 2.

> **Resolved: separate resolver.** `app_request_org_id()` stays untouched;
> `app_org_slug_for_host()` ships as specced in §5.1. Rationale: keep the
> security-kernel function small and cheap; the drift risk is closed by the
> single-canonicalization contract and its tests, not by merging the paths.

**D2 — How is `org_domains.status` protected from org admins?** Column-level
`GRANT` excluding `status`/`verified_at`/`verification_token` from
`authenticated`, or an admin policy that permits INSERT/DELETE but no UPDATE
with the transition done service-side? The column grant is more precise and
matches what `20260802000001` already does on `organizations`; the policy shape is
simpler to read. Either works; pick one before PR 2 so the pgTAP assertions
match.

> **Resolved: column-level GRANT**, matching the existing pattern on
> `organizations` (`20260802000001`). `status`, `verified_at`,
> `verification_token`, `attached_at`, `attach_claimed_at`, and
> `attach_claim_token` are excluded from `authenticated` writes; the verify
> route transitions the verification columns and the attachment worker (§7)
> alone writes the attachment columns. pgTAP asserts the grant matrix
> column-by-column.

**D3 — Automate Vercel domain attachment, or operator-in-the-loop?** §7
recommends operator-in-the-loop for v1 (no Vercel API token in the app
environment). Confirm — this is a security-posture call, not an engineering
one, and it determines whether PR 4 ships a queue or an integration.

> **Resolved: automate in v1** via the isolated attachment worker — see the
> rewritten §7 for the full shape (app never holds the Vercel token; edge
> function holds it as a secret; apex denylist; entitlement hook as the
> future billing gate). PR 4 ships the worker; `/platform` becomes
> observability + manual retry rather than a required queue.

**D4 — Should a suspended org's custom domain stop resolving?** §5.1 gates on
`o.status = 'active'`, which makes a suspended org's site 404 (or fall through
to the platform host). The alternative is to resolve it and render a "this site
is unavailable" page, which is friendlier and leaks that the org exists. Note
that either choice makes `organizations.status` cut an access path for the
first time, which is a documented change to the tenancy model regardless.

> **Resolved: go dark (404).** Fail closed; a suspended org's custom domain
> resolves nothing and discloses nothing. The tenancy-model paragraph on
> `organizations.status` gets updated by the PR that ships §5.1.

**D5 — Re-verify mail domains on a schedule?** §15 argues yes eventually, no in
v1. If yes, it rides on an existing reminder cron rather than a new one, and it
must not flip a domain out of `verified` on a single transient DNS failure.

> **Resolved: deferred — not in v1.** Verify once at claim time; revisit
> scheduled re-verification when more than one org sends on a custom domain.

**D6 — What is the platform apex?** The repo does not pin one:
`NEXT_PUBLIC_SITE_URL` defaults to `http://localhost:3000` and the default
`From:` is `noreply@incouragers.org`. Host parsing needs the apex as
configuration (`NEXT_PUBLIC_PLATFORM_APEX`, suggested), and the wildcard
certificate and redirect allowlist entry both depend on the answer. This blocks
the infrastructure prerequisite in §12.

> **Resolved: the platform apex is `two42.io`.** Org subdomains are
> `<slug>.two42.io`; the wildcard certificate is `*.two42.io`; the Supabase
> redirect-allowlist entry is `https://*.two42.io/**`;
> `NEXT_PUBLIC_PLATFORM_APEX=two42.io`. History note: the platform began as a
> single-class app on `incouragers.org`; that domain is *not* the platform —
> it is expected to return later as org #1's own custom domain, making the
> first org the dogfood tenant for this entire feature. Consequence: the
> default `From:` of `noreply@incouragers.org` must migrate to a `two42.io`
> address in this phase (§9/§10 call sites).

**D7 — Default daily cap.** §11.1 proposes 2000/day/org as a placeholder. The
real number should come from the current Resend plan's limit divided by a
plausible tenant count, with headroom. It is a one-line default; getting it
wrong in either direction is cheap to correct, but it should be a decision
rather than a guess.

> **Resolved: 500/day/org default**, with the per-org override in
> `org_email_limits` as the escape hatch. Revisit the default against the
> Resend plan's actual ceiling whenever the tenant count grows.
