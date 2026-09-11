-- Platform-operator gate on custom sending domains, and a recoverable
-- cleanup state for the claim route's failure path. Additive only.
--
-- Why a gate: Resend's account tier caps total domains across every tenant
-- (10 today), so once self-serve org creation opens, any stranger's org could
-- burn a scarce, billed slot. Custom domains are now opt-in per org, flipped
-- only from /platform.
--
-- Why a cleanup state: when the claim route creates the Resend domain and a
-- later step fails, it removes the Resend domain again. If that removal also
-- fails, the route used to delete the DB row anyway, leaving the orphaned
-- resend_domain_id nowhere but the logs. The row now stays, marked
-- cleanup_pending, until a retry finishes the provider-side removal.

-- organizations is the tenant root (no org_id column) — CLAUDE.md's named
-- exception. Default false: no org gets custom domains until a platform
-- operator flips it via app/api/platform/organizations/[id]/route.ts.
-- Deliberately NOT granted to anon/authenticated: organizations carries
-- column-level SELECT grants only (20260801000002 / 20260802000001), so ADD
-- COLUMN exposes nothing. The org's own admin must never read or flip this
-- from their own client; they learn its effect only via the claim route's
-- 403.
alter table public.organizations
  add column custom_email_domain_enabled boolean not null default false;

comment on column public.organizations.custom_email_domain_enabled is
  'Platform-operator-only gate on custom sending-domain claims. Flippable only from /platform (app/api/platform/organizations/[id]/route.ts); never exposed to the org''s own admin.';

-- Widen the status vocabulary with cleanup_pending: a claim whose Resend
-- cleanup itself failed keeps its row (and resend_domain_id) in this state
-- instead of being deleted, so the orphaned Resend domain stays reconcilable.
-- The unique-per-org index then turns a fresh claim during cleanup into a
-- clean conflict instead of a second domains.create against Resend.
-- Drop + recreate rather than a bare ADD CHECK: Postgres named the inline
-- column CHECK <table>_<column>_check, and there is exactly one CHECK on
-- this column to replace (confirmed against supabase/schema.sql).
alter table public.org_email_domains
  drop constraint org_email_domains_status_check;
alter table public.org_email_domains
  add constraint org_email_domains_status_check
  check (status in (
    'not_started', 'pending', 'verified', 'failure', 'temporary_failure',
    'failed', 'partially_verified', 'partially_failed', 'cleanup_pending'
  ));

-- When the most recent provider cleanup attempt failed, for the /platform
-- retry card's "stuck since" display. Nullable; irrelevant once the row is
-- deleted after a successful retry. Same server-set-only posture as status /
-- resend_domain_id / dns_records / verified_at / last_checked_at: the table's
-- grants to authenticated are column-scoped (INSERT domain only, no UPDATE),
-- so ADD COLUMN exposes nothing to write.
alter table public.org_email_domains
  add column cleanup_failed_at timestamptz;

comment on column public.org_email_domains.cleanup_failed_at is
  'Set when a Resend domains.remove attempt failed and the row was kept as cleanup_pending. Cleared by deleting the row once cleanup succeeds.';
