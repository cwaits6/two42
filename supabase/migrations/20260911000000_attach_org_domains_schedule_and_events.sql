-- Schedule the custom-domain attachment worker, and give it a durable
-- outcome log.
--
-- 1. attach-org-domains shipped deployed but unscheduled (the migration
--    slot was held), so nothing invoked it without an operator running
--    `supabase functions invoke` by hand. Every 10 minutes matches the
--    single-flight lease window (ATTACH_LEASE_WINDOW_MS in
--    _shared/domain-lease.ts): a run more often than that only finds rows
--    it cannot claim. Same helper and shape as the reminder jobs in
--    20260729000000_reminder_cron_schedules.sql; cron.schedule() upserts by
--    job name, so re-applying converges rather than duplicating.
--
-- 2. org_domain_worker_events: the two outcomes the worker already
--    classifies but could only report in its HTTP response and function
--    logs — a permanent Vercel refusal (409/403/402) and a completed detach
--    — now outlive the run that produced them. The worker inserts each with
--    an explicit org_id (it runs with BYPASSRLS, so that value IS the tenant
--    boundary) and skips a row that already has an unacknowledged
--    permanent-failure event, making "no retry" literal instead of "retry
--    every lease window". /platform/domains lists rows where
--    acknowledged_at is null and stamps it from the operator's checklist:
--    a detached event is the to-do to remove the name from the Supabase
--    auth redirect allowlist, which the tombstone's hard-delete would
--    otherwise erase. Details: docs/security/domains.md.

select private.schedule_edge_reminder(
  'attach-org-domains',
  '*/10 * * * *',
  '/functions/v1/attach-org-domains',
  '{}'::jsonb
);

create table public.org_domain_worker_events (
  id uuid primary key default gen_random_uuid(),
  -- Single-column FK: organizations is the tenant root and carries no
  -- org_id of its own (CLAUDE.md's one named exception to composite FKs).
  -- RESTRICT, not CASCADE: an unacknowledged event is an operator to-do
  -- and must not disappear with the org row.
  org_id uuid not null default public.app_current_org_id()
    references public.organizations(id) on delete restrict,
  -- Free text, deliberately NOT an FK to org_domains: a detached event must
  -- outlive the tombstone it describes — that is the whole point.
  domain text not null,
  event text not null check (event in ('attach_permanent_failure', 'detached')),
  detail text,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

-- Serves both the worker's per-(org, domain) skip check and /platform's
-- "list everything unacknowledged" read; acknowledged rows fall out of it.
create index org_domain_worker_events_unacknowledged_idx
  on public.org_domain_worker_events (org_id, domain)
  where acknowledged_at is null;

alter table public.org_domain_worker_events enable row level security;

-- The isolation floor, and deliberately the ONLY policy: a table with a
-- restrictive policy and no permissive one is readable and writable by no
-- PostgREST caller. Both writers (the worker) and the reader (/platform)
-- run service-role. An org-facing view later means adding a permissive
-- SELECT arm, not relaxing this one.
create policy "org isolation" on public.org_domain_worker_events
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

-- Lock the whole table down: Supabase's default privileges grant ALL on
-- every new public table to anon and authenticated at CREATE TABLE time.
-- No further grants to either role — service_role bypasses grants entirely.
revoke all on public.org_domain_worker_events from anon, authenticated;

comment on table public.org_domain_worker_events is
  'Append-only outcome log written by the attach-org-domains worker (service role, explicit org_id on every insert) and acknowledged from /platform/domains. attach_permanent_failure: a Vercel 409/403/402 — the row is skipped until acknowledged. detached: the tombstone was hard-deleted after Vercel confirmed removal — the operator''s cue to delist the name from the auth redirect allowlist.';
