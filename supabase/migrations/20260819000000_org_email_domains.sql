-- org_email_domains (Phase 5 PR 6, CWA-70 / #363). Per-org sending domain
-- claimed and verified through Resend. One row per org (v1); no sending
-- change ships in this migration — see docs/plans/phase-5-domains-email.md
-- §10 and CLAUDE.md's tenancy rules.

create table public.org_email_domains (
  id uuid primary key default gen_random_uuid(),
  -- Single-column FK: organizations is the tenant root and carries no
  -- org_id of its own (CLAUDE.md's one named exception to composite FKs).
  org_id uuid not null default public.app_current_org_id()
    references public.organizations(id) on delete cascade,
  domain text not null,
  -- Resend's id for the domain. Not a secret — a handle, and every call
  -- using it is already authenticated by the platform API key.
  resend_domain_id text,
  -- Mirrors Resend's own status vocabulary rather than inventing one, so a
  -- status nobody anticipated cannot be silently mapped to 'verified'. The
  -- list is the union of the values Resend's REST docs name (failure,
  -- temporary_failure) and the ones the installed `resend` SDK's
  -- DomainStatus type declares (failed, partially_verified,
  -- partially_failed); anything else still fails the CHECK loudly.
  status text not null default 'not_started'
    check (status in (
      'not_started', 'pending', 'verified',
      'failure', 'temporary_failure',
      'failed', 'partially_verified', 'partially_failed'
    )),
  -- DNS records to publish, as returned by Resend. Public data (a DKIM
  -- public key, an SPF include) — rendered to the admin only.
  dns_records jsonb not null default '[]'::jsonb,
  verified_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint org_email_domains_domain_shape check (
    domain = lower(domain) and length(domain) between 4 and 253
  )
);

-- One sending domain per org for v1 (deliberate — see spec §10.2).
create unique index org_email_domains_org_key on public.org_email_domains (org_id);

alter table public.org_email_domains enable row level security;

create policy "org isolation" on public.org_email_domains
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "Admins manage org email domains" on public.org_email_domains
  for all to authenticated
  using      (org_id = (select public.app_request_org_id()) and (select public.is_admin()))
  with check (org_id = (select public.app_request_org_id()) and (select public.is_admin()));

-- Lock the whole table down first: Supabase's default privileges grant ALL
-- on every new public table to anon and authenticated at CREATE TABLE time
-- (20260801000002_org_branding_backfill.sql hit the same trap on
-- organizations). anon gets nothing at all — no anonymous surface reads
-- this table.
revoke all on public.org_email_domains from anon, authenticated;

-- authenticated (narrowed further to same-org admins by the RLS policies
-- above):
--   SELECT   — the whole row. No member-vs-admin column split exists here;
--              the "Admins manage" policy already means a non-admin org
--              member sees zero ROWS, so there's nothing to hide per-column
--              from an admin who can see the row at all.
--   INSERT   — `domain` only. status/resend_domain_id/dns_records/
--              verified_at/last_checked_at keep their DEFAULT (or stay
--              NULL); an INSERT naming any of them fails on a privilege
--              error before it ever reaches a CHECK constraint — an admin
--              cannot self-verify at claim time either.
--   DELETE   — unconditional (still bounded by the RLS policies above: same
--              org, admin only). No external resource depends on this row
--              the way an attached org_domains row will depend on Vercel
--              state (docs/plans/phase-5-domains-email.md §6, not yet
--              built), so no restrictive delete policy is needed here.
--   No UPDATE grant at all, on any column. `domain` is immutable after
--              insert — re-claiming is DELETE + a fresh claim. status,
--              resend_domain_id, dns_records, verified_at, and
--              last_checked_at are server-set-only: written exclusively by
--              the service-role create/verify routes, which bypass grants
--              entirely.
grant select on public.org_email_domains to authenticated;
grant insert (domain) on public.org_email_domains to authenticated;
grant delete on public.org_email_domains to authenticated;
