-- org_domains + app_org_slug_for_host() (Phase 5 PR 2, CWA-66 / #359).
-- Per-org claimed/verified custom hostnames, plus the SECURITY DEFINER
-- resolver middleware will use for host-based org routing. Schema only: no
-- app code reads the table or calls the resolver yet — host-aware routing is
-- PR 3, the admin claim/verify/remove surface and the Vercel attachment
-- worker are PR 4. See docs/plans/phase-5-domains-email.md §5.1, §6–6.2, §7
-- and decisions D1/D2/D4, plus CLAUDE.md's tenancy rules.

-- 'removing' is the detach tombstone (spec §7.1): the row stays until the
-- PR-4 worker has removed the name from Vercel, so external state can never
-- outlive the row that owns it. Nothing in this PR sets it — it exists now
-- so the partial unique below can already cover it.
-- 'failed' likewise is not set by anything in this PR; PR 4's verify route
-- will use it to record a DNS TXT check that did not match, leaving the
-- claim visible to the admin for a retry rather than deleting it.
create type public.org_domain_status as enum ('pending', 'verified', 'failed', 'removing');

create table public.org_domains (
  id uuid primary key default gen_random_uuid(),
  -- Single-column FK: organizations is the tenant root and carries no
  -- org_id of its own (CLAUDE.md's one named exception to composite FKs).
  org_id uuid not null default public.app_current_org_id()
    -- RESTRICT, not CASCADE: attached rows and 'removing' tombstones are the
    -- §7.1 detach workflow's only record of a Vercel-side attachment, and FK
    -- cascades bypass RLS DELETE policies entirely. Deleting an organization
    -- must wait until its domains are released (detached and hard-deleted).
    references public.organizations(id) on delete restrict,
  -- Stored canonical: lowercase, punycode (A-label) for IDNs, no trailing
  -- dot, no port. The resolver does no normalization (§5.1) — the caller
  -- canonicalizes once, and non-canonical input matches nothing.
  domain text not null,
  status public.org_domain_status not null default 'pending',
  -- Random token the org publishes at _two42-verify.<domain> as a TXT
  -- record. Proves control of the name before it is attached (PR 4).
  verification_token text not null default encode(gen_random_bytes(16), 'hex'),
  verified_at timestamptz,
  -- Set by the PR-4 attachment worker (§7) — its SOLE writer — after Vercel
  -- confirms the domain is attached to the project. Verification proves
  -- *ownership*; attachment is what makes the host actually route. NULLed
  -- whenever status leaves 'verified' — except into 'removing', where it is
  -- kept as the "Vercel cleanup still owed" marker until the worker
  -- detaches (§7.1).
  attached_at timestamptz,
  -- Attachment lease (§7): the worker's single-flight claim. claimed_at
  -- bounds the lease window; claim_token fences the writer — a worker may
  -- stamp attached_at only with the token its own claim returned, so an
  -- expired/superseded attempt cannot commit late. NULL until PR 4 writes
  -- them.
  attach_claimed_at timestamptz,
  attach_claim_token uuid,
  -- Stamped by PR-4's verify route on every DNS TXT check attempt, used to
  -- rate-limit repeat verify clicks (§6.1). Not read or written by anything
  -- in this PR.
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint org_domains_domain_shape check (
    domain = lower(domain)
    and length(domain) between 4 and 253
    and domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  )
);

-- The DNS namespace is global, so this unique is deliberately NOT per-org —
-- a recorded deviation from the repo's per-org-unique norm (see the
-- tenancy-model.md "Known limits" bullet added by this PR). Partial on
-- verified rows: two orgs may both *claim* a name, only one may own it.
-- Without the partial predicate, an org could squat every domain it can
-- think of and permanently block the real owner. 'removing' tombstones are
-- included so a name cannot be re-verified while its previous owner's
-- Vercel cleanup is still pending (§7.1).
create unique index org_domains_verified_domain_key
  on public.org_domains (domain) where status in ('verified', 'removing');

-- Cheap dedupe of repeat claims within one org.
create unique index org_domains_org_domain_key on public.org_domains (org_id, domain);

-- The resolver's access path.
create index org_domains_domain_idx on public.org_domains (domain) where status = 'verified';

alter table public.org_domains enable row level security;

-- The restrictive isolation floor, verbatim per the Phase 2 template.
create policy "org isolation" on public.org_domains
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

-- Permissive: org admins only. Factored ORG AND (arms), never (ORG AND a) OR b.
-- No anon permissive policy, on purpose: anonymous host resolution goes
-- through app_org_slug_for_host() below and nothing else, so anon reads
-- zero rows from this table.
create policy "Admins manage org domains" on public.org_domains
  for all to authenticated
  using      (org_id = (select public.app_request_org_id()) and (select public.is_admin()))
  with check (org_id = (select public.app_request_org_id()) and (select public.is_admin()));

-- Direct DELETE is confined to rows that own nothing outside the database.
-- An attached row (or a tombstone mid-cleanup) is released through the PR-4
-- remove route + worker instead (§7.1), so Vercel state can never be
-- orphaned by a plain delete. Deliberately does NOT mention org_id: the
-- isolation floor above already binds the org, and schema_tenancy_lint.sql
-- counts "exactly one restrictive policy whose qual references org_id".
create policy "Admins delete unattached org domains" on public.org_domains
  as restrictive for delete to authenticated
  using (attached_at is null and status <> 'removing');

-- Lock the whole table down first: Supabase's default privileges grant ALL
-- on every new public table to anon and authenticated at CREATE TABLE time.
-- anon gets nothing at all — no anonymous surface reads this table.
revoke all on public.org_domains from anon, authenticated;

-- authenticated (narrowed further to same-org admins by the RLS policies
-- above) — decision D2: column-level GRANT, no UPDATE on any column:
--   SELECT   — the whole row. The "Admins manage" policy already means a
--              non-admin org member sees zero ROWS, so there's nothing to
--              hide per-column from an admin who can see the row at all.
--   INSERT   — `domain` only. status/verification_token/verified_at/
--              attached_at/attach_claimed_at/attach_claim_token/
--              last_checked_at keep their DEFAULT (or stay NULL); an INSERT
--              naming any of them fails on a privilege error (42501) before
--              it ever reaches a CHECK — an admin cannot self-verify at
--              claim time.
--   DELETE   — bounded by the restrictive delete policy above: only rows
--              with attached_at IS NULL and status <> 'removing' — rows
--              that own nothing in Vercel.
--   No UPDATE grant at all, on any column. `domain` is immutable after
--              insert (§7 relies on this) — re-claiming is DELETE + a fresh
--              claim. status, verification_token, verified_at, attached_at,
--              and the lease columns are server-set-only: written
--              exclusively by the PR-4 verify route and attachment worker,
--              which bypass grants entirely.
grant select on public.org_domains to authenticated;
grant insert (domain) on public.org_domains to authenticated;
grant delete on public.org_domains to authenticated;

-- The host → org-slug resolver (spec §5.1, decision D1: separate function;
-- app_request_org_id() stays untouched). SECURITY DEFINER granted to anon
-- so middleware can resolve a host without a service-role client and
-- without making org_domains anon-readable: it answers exactly one question
-- ("which org slug, if any, owns this verified host?") with minimal
-- disclosure. No org_id predicate, and that is correct — this is a
-- cross-tenant *routing* primitive whose whole job is to answer for a host
-- whose org is not yet known; the join column satisfies
-- schema_tenancy_lint.sql check 4 mechanically, and review (a single
-- statement, kept deliberately minimal) is the real control here.
-- o.status = 'active' is decision D4: a suspended org's verified domain
-- resolves NULL — it goes dark rather than routing.
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

comment on function public.app_org_slug_for_host(text) is
  'Resolves a request host to an org slug for host-based routing (Phase 5). Verified/active gating only — no normalization: the caller (middleware) canonicalizes the host once. Returns NULL (fails closed) for any unmatched, unverified, or suspended-org host. Not yet called from application code (PR 3).';

revoke execute on function public.app_org_slug_for_host(text) from public;
grant execute on function public.app_org_slug_for_host(text) to anon, authenticated, service_role;
