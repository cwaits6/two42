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
canonical URL for an org becomes its verified custom domain if it has one, else
its platform subdomain; `/[orgSlug]/…` stays reachable and should emit
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
  where d.domain = lower(trim(both '.' from _host))
    and d.status = 'verified'
    and o.status = 'active';
$$;

revoke execute on function public.app_org_slug_for_host(text) from public;
grant execute on function public.app_org_slug_for_host(text) to anon, authenticated, service_role;
```

Notes on the shape, each one deliberate:

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
   strip a trailing dot.
2. If the host ends with the platform apex, take the first label as the slug —
   pure string work, no lookup. Reject it if it fails `isValidOrgSlug()` or is
   a reserved label.
3. Otherwise call `app_org_slug_for_host(host)` through an **anon** Supabase
   client (no cookies needed for this call — it is a pure function of the
   host).
4. If neither yields a slug, fall back to `resolveOrgSlug()` (the env pin) so
   local dev, preview deployments, and the self-host single-org case keep
   working unchanged. This is the one permitted fallback, and it is a fallback
   to *the configured deployment's own org*, never to another tenant's.

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
  reading attacker input. Set, never append, and set it on every path through
  `updateSession()` including the early redirects.
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

The explicit `orgSlug` argument keeps winning, so `app/[orgSlug]/join` is
unaffected.

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
- `status` and `verified_at` are **server-set only**. An org admin who could
  `update … set status = 'verified'` would bypass DNS verification entirely and
  attach any name to their org. The admin-facing write surface must be a route
  handler that only ever writes `domain` on insert and `status` never — either
  a column-level `GRANT` excluding `status`/`verified_at`/`verification_token`
  from `authenticated`, or an update policy restricted to no columns plus a
  service-role-only transition path. **Open decision D2.**

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

Steps 4 and 5 are the ones that are not purely in-app, and they are why **open
decision D3** exists.

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

**Recommendation for v1: operator-in-the-loop, no Vercel token in the app.**
The launch is one org. A Vercel API token scoped to the project is a
deployment-control credential — strictly more powerful than the Supabase
service key, since it can change where the domain points — and adding it to the
app's environment to save an operator two minutes, at one tenant, is a bad
trade. The `org_domains` row is the source of truth and the record of intent;
an operator adds the name in the Vercel dashboard when a row reaches
`verified`. Ship a `/platform` list of verified-but-unattached domains so the
operator has a queue rather than a Slack message. Revisit when the manual step
actually hurts, which is a real signal and not one to pre-empt.

Note the asymmetry with §9: per-org **sending** domains *can* be fully
automated, because the app already holds `RESEND_API_KEY` and that key's blast
radius is email, which the send caps in §10 already bound. Domain attachment
and mail-domain verification look like the same problem and are not.

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
returning the org's canonical origin — verified custom domain, else
`https://<slug>.<platform-apex>`, else `siteConfig.url`. It reads the same
`org_domains` row the resolver in §5.1 uses. Every call site above takes an
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
- **The domain is validated by a new named regex** in `lib/email/identity.ts`,
  alongside `PLAIN_NAME`, with the same standing: a validation boundary, not a
  style choice. LDH labels, 1–63 chars per label, ≤253 total, at least one dot,
  no leading/trailing hyphen, no underscore, no trailing dot. It is checked at
  *send* time against the value read from the DB, not only at write time — the
  write path already validates, and the read-time check is what makes a
  compromised or hand-edited row non-exploitable.
- **`status = 'verified'` gates the substitution** in the same expression. An
  unverified domain falls back to `PLATFORM_ADDRESS`.

Per CLAUDE.md's UI-conventions rule, `supabase/functions/_shared/branding.ts`
mirrors `HEX`, `CONTROL`, and `PLAIN_NAME` **byte-for-byte**. The new domain
regex joins that set: it lands on both sides in the same PR, and the edge
functions must apply the same verified-status gate before using a per-org
address.

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
  sent_count integer not null default 0,
  primary key (org_id, usage_date)
);

create table public.org_email_limits (
  org_id uuid primary key default public.app_current_org_id()
    references public.organizations(id) on delete cascade,
  daily_cap integer not null default 2000,
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
**platform-operator-owned, not org-admin-owned** — an org that can raise its own
cap does not have a cap. Writes go through the `/platform` surface, gated on
`requirePlatformAdmin()` like every other cross-org write; the org-side
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
  select coalesce(l.daily_cap, 2000) into _cap
  from public.org_email_limits l where l.org_id = _org_id;
  _cap := coalesce(_cap, 2000);

  insert into public.org_email_usage (org_id, usage_date, sent_count)
  values (_org_id, (now() at time zone 'utc')::date, _n)
  on conflict (org_id, usage_date) do update
    set sent_count = public.org_email_usage.sent_count + excluded.sent_count
    where public.org_email_usage.sent_count + excluded.sent_count <= _cap
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

Note the insert path with `_n` alone cannot exceed the cap on the *first* send
of a day — `on conflict … where` only guards the update. Add the same bound to
the insert (a `where` on an `insert … select`, or a pre-check) or a fan-out
larger than the cap sails through on a fresh day. This is the kind of thing the
pgTAP suite must assert directly.

**Call sites:** every fan-out reserves before sending and skips (logging, not
throwing) when refused. That is the Tier A set from the inventory — feedback
admin notifications, serving broadcast, leader cancel notices — plus both
reminder edge functions. Reserve per *batch*, with `_n` = recipient count,
before the first send; a per-recipient reserve is a round trip per member.

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
   falls back to the env pin. This is the highest-risk PR in the phase: it
   touches the request path for every route.
4. **Admin domain UI + verify route** — claim, TXT check, status transition,
   `/platform` queue of verified-but-unattached domains. Inventory rows.
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
  for a verified row in an active org.
- **Quota suite** — concurrent `email_quota_consume` under a cap (two sessions,
  one succeeds), the first-send-of-day bound, the day rollover, the grant
  matrix (`anon`/`authenticated` have no EXECUTE), and a refused reserve
  leaving `sent_count` unchanged. Assert **row counts**, not just the absence
  of an error: a filtered write is a silent success in this codebase and has
  bitten it before.
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
| `service-role-inventory.md` | Rows for the domain verify route and the quota RPC; updated site counts; `lib/email/identity.ts` row names both tables | 4, 7, 8 |
| `CLAUDE.md` | The new `From:`-address regex joins the named injection boundaries and the edge-mirror rule | 7 |
| A new `docs/security/domains.md` (or a section here) | The redirect allowlist, the operator queue, and the manual Vercel step | 4 |

## 15. Risks

- **Middleware is the whole request path.** PR 3 (§12) can take down every
  route for every org. It needs the env-pin fallback to be genuinely
  unconditional, a canary deploy, and a fast revert path. The negative-result
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

**D1 — Where does host resolution live?** This spec puts it in a separate
`app_org_slug_for_host()` called from middleware, leaving
`app_request_org_id()` untouched (§5.1). The alternative is teaching
`app_request_org_id()` to resolve an `x-two42-host` header directly, which
removes the app-layer mapping entirely and makes drift impossible — at the cost
of an `org_domains` join in the InitPlan of every RLS policy on every org-owned
table, and a materially larger security-critical function. **Recommendation:
separate resolver.** Confirm before PR 2.

**D2 — How is `org_domains.status` protected from org admins?** Column-level
`GRANT` excluding `status`/`verified_at`/`verification_token` from
`authenticated`, or an admin policy that permits INSERT/DELETE but no UPDATE
with the transition done service-side? The column grant is more precise and
matches what `20260802000001` already does on `organizations`; the policy shape is
simpler to read. Either works; pick one before PR 2 so the pgTAP assertions
match.

**D3 — Automate Vercel domain attachment, or operator-in-the-loop?** §7
recommends operator-in-the-loop for v1 (no Vercel API token in the app
environment). Confirm — this is a security-posture call, not an engineering
one, and it determines whether PR 4 ships a queue or an integration.

**D4 — Should a suspended org's custom domain stop resolving?** §5.1 gates on
`o.status = 'active'`, which makes a suspended org's site 404 (or fall through
to the platform host). The alternative is to resolve it and render a "this site
is unavailable" page, which is friendlier and leaks that the org exists. Note
that either choice makes `organizations.status` cut an access path for the
first time, which is a documented change to the tenancy model regardless.

**D5 — Re-verify mail domains on a schedule?** §15 argues yes eventually, no in
v1. If yes, it rides on an existing reminder cron rather than a new one, and it
must not flip a domain out of `verified` on a single transient DNS failure.

**D6 — What is the platform apex?** The repo does not pin one:
`NEXT_PUBLIC_SITE_URL` defaults to `http://localhost:3000` and the default
`From:` is `noreply@incouragers.org`. Host parsing needs the apex as
configuration (`NEXT_PUBLIC_PLATFORM_APEX`, suggested), and the wildcard
certificate and redirect allowlist entry both depend on the answer. This blocks
the infrastructure prerequisite in §12.

**D7 — Default daily cap.** §11.1 proposes 2000/day/org as a placeholder. The
real number should come from the current Resend plan's limit divided by a
plausible tenant count, with headroom. It is a one-line default; getting it
wrong in either direction is cheap to correct, but it should be a decision
rather than a guess.
