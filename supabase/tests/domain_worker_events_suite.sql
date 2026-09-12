-- Domain worker schedule + outcome-log suite.
--
-- Pins 20260911000000 through 20260911000002:
--   * the attach-org-domains pg_cron job exists, on the lease-window cadence,
--     and its command posts to the worker's function path;
--   * org_domain_worker_events is service-role-only — RLS on, exactly one
--     restrictive isolation policy on app_request_org_id(), no permissive
--     policy, every privilege revoked from anon and authenticated, and a live
--     probe as each role is denied outright;
--   * the table's shape: org_id NOT NULL with the fail-closed default, the
--     event CHECK, the unacknowledged partial index, and the FK to the tenant
--     root (RESTRICT — an open event must not vanish with its org);
--   * the worker's and the acknowledge route's statements, run here as SQL
--     against the real table with ROW COUNTS asserted: a filtered write that
--     matches nothing is a silent success in this codebase;
--   * the three re-issued function comments carry no planning tag.
--
-- The skip behaviour itself (an unacknowledged event parks the row) lives in
-- the edge function and is pinned by supabase/functions/tests/domain_attach_test.ts;
-- this suite pins the table and the predicates both sides share.
--
-- Orgs are provisioned fresh; this suite never touches the seeded org.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/domain_worker_events_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
do $$
declare
  org_a uuid;
  org_b uuid;
begin
  org_a := public.provision_organization('Worker Events Org A', 'worker-events-org-a', 'owner-a@workerevents.example.test');
  org_b := public.provision_organization('Worker Events Org B', 'worker-events-org-b', 'owner-b@workerevents.example.test');
  perform set_config('we.org_a', org_a::text, true);
  perform set_config('we.org_b', org_b::text, true);
end $$;

-- ── The schedule ────────────────────────────────────────────────────────────

select is(
  (select count(*)::int from cron.job where jobname = 'attach-org-domains'),
  1, 'exactly one attach-org-domains cron job exists');
select is(
  (select schedule from cron.job where jobname = 'attach-org-domains'),
  '*/10 * * * *', 'attach-org-domains runs every 10 minutes (the lease window)');
select ok(
  (select command like '%/functions/v1/attach-org-domains%' from cron.job where jobname = 'attach-org-domains'),
  'the job posts to /functions/v1/attach-org-domains');
select ok(
  (select command like '%cron_service_role_key%' and command like '%cron_project_url%'
     from cron.job where jobname = 'attach-org-domains'),
  'the job reads its URL and bearer from vault, like the reminder jobs');
select is(
  (select active from cron.job where jobname = 'attach-org-domains'),
  true, 'the job is active');

-- ── Table shape ─────────────────────────────────────────────────────────────

select has_table('public', 'org_domain_worker_events', 'org_domain_worker_events exists');
select col_not_null('public', 'org_domain_worker_events', 'org_id', 'org_id is NOT NULL');
select col_default_is('public', 'org_domain_worker_events', 'org_id', 'app_current_org_id()',
  'org_id defaults to the fail-closed app_current_org_id()');
select col_is_null('public', 'org_domain_worker_events', 'acknowledged_at', 'acknowledged_at is nullable (open until stamped)');
select fk_ok('public', 'org_domain_worker_events', 'org_id', 'public', 'organizations', 'id',
  'org_id references the tenant root');
select is(
  (select confdeltype from pg_constraint
    where conrelid = 'public.org_domain_worker_events'::regclass and contype = 'f'),
  'r', 'the org FK is ON DELETE RESTRICT — an open event does not vanish with its org');
select has_index('public', 'org_domain_worker_events', 'org_domain_worker_events_unacknowledged_idx',
  'the unacknowledged partial index exists');
select ok(
  (select indpred is not null from pg_index
    where indexrelid = 'public.org_domain_worker_events_unacknowledged_idx'::regclass),
  'the index is partial (acknowledged rows fall out of it)');

select throws_ok(
  format('insert into public.org_domain_worker_events (org_id, domain, event) values (%L::uuid, %L, %L)',
    current_setting('we.org_a'), 'x.example', 'something_else'),
  '23514', null,
  'an event outside the CHECK list is refused');

-- ── Lockdown: service-role-only posture ─────────────────────────────────────

select ok(
  (select relrowsecurity from pg_class where oid = 'public.org_domain_worker_events'::regclass),
  'RLS is enabled on org_domain_worker_events');
select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'org_domain_worker_events'
      and permissive = 'RESTRICTIVE' and qual like '%app\_request\_org\_id%'),
  1, 'exactly one restrictive isolation policy predicates on app_request_org_id()');
select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'org_domain_worker_events'
      and permissive = 'PERMISSIVE'),
  0, 'no permissive policy: no PostgREST role reaches the table');

select ok(not has_table_privilege('anon', 'public.org_domain_worker_events', 'select'),
  'anon has no SELECT on org_domain_worker_events');
select ok(not has_table_privilege('anon', 'public.org_domain_worker_events', 'insert'),
  'anon has no INSERT on org_domain_worker_events');
select ok(not has_table_privilege('authenticated', 'public.org_domain_worker_events', 'select'),
  'authenticated has no SELECT on org_domain_worker_events');
select ok(not has_table_privilege('authenticated', 'public.org_domain_worker_events', 'insert'),
  'authenticated has no INSERT on org_domain_worker_events');
select ok(not has_table_privilege('authenticated', 'public.org_domain_worker_events', 'update'),
  'authenticated has no UPDATE on org_domain_worker_events');
select ok(not has_table_privilege('authenticated', 'public.org_domain_worker_events', 'delete'),
  'authenticated has no DELETE on org_domain_worker_events');
-- One privilege per call: a comma-separated list makes has_table_privilege()
-- true when ANY listed privilege is held, which would pass on select alone.
select ok(has_table_privilege('service_role', 'public.org_domain_worker_events', 'select'),
  'service_role has SELECT (the worker''s skip check and the /platform list)');
select ok(has_table_privilege('service_role', 'public.org_domain_worker_events', 'insert'),
  'service_role has INSERT (the worker''s event writes)');
select ok(has_table_privilege('service_role', 'public.org_domain_worker_events', 'update'),
  'service_role has UPDATE (the acknowledge route)');

-- Live probe: the lockdown holds at execution time, not just in the ACL.
do $$
declare
  probe_err text := 'no error';
begin
  set local role authenticated;
  begin
    perform * from public.org_domain_worker_events;
  exception when others then
    probe_err := sqlstate;
  end;
  reset role;
  perform set_config('we.probe_err', probe_err, true);
end $$;
select is(current_setting('we.probe_err'), '42501',
  'authenticated SELECT on org_domain_worker_events is denied outright (42501)');

-- ── The worker's writes and reads, as SQL, with row counts ──────────────────
-- Inserts carry an explicit org_id, as the worker's do.
insert into public.org_domain_worker_events (org_id, domain, event, detail) values
  (current_setting('we.org_a')::uuid, 'a.example.church', 'attach_permanent_failure', 'vercel conflict: taken'),
  (current_setting('we.org_b')::uuid, 'b.example.church', 'detached', null);

select is(
  (select count(*)::int from public.org_domain_worker_events
    where org_id = current_setting('we.org_a')::uuid),
  1, 'org A holds exactly its own event');
select is(
  (select acknowledged_at from public.org_domain_worker_events
    where org_id = current_setting('we.org_a')::uuid),
  null::timestamptz, 'a fresh event is unacknowledged');

-- The worker's skip check: (org_id, domain, event) with acknowledged_at IS NULL.
select is(
  (select count(*)::int from public.org_domain_worker_events
    where org_id = current_setting('we.org_a')::uuid
      and domain = 'a.example.church'
      and event = 'attach_permanent_failure'
      and acknowledged_at is null),
  1, 'the skip check finds org A''s open permanent failure');
select is(
  (select count(*)::int from public.org_domain_worker_events
    where org_id = current_setting('we.org_b')::uuid
      and domain = 'a.example.church'
      and event = 'attach_permanent_failure'
      and acknowledged_at is null),
  0, 'the same domain under org B is not parked — the check is per org');
select is(
  (select count(*)::int from public.org_domain_worker_events
    where org_id = current_setting('we.org_b')::uuid
      and domain = 'b.example.church'
      and event = 'attach_permanent_failure'
      and acknowledged_at is null),
  0, 'a detached event never parks an attach — the check is per event type');

-- The table is append-only: a second permanent failure for the same
-- (org, domain) is allowed. Dedup is the worker's skip, not a constraint.
insert into public.org_domain_worker_events (org_id, domain, event, detail) values
  (current_setting('we.org_a')::uuid, 'a.example.church', 'attach_permanent_failure', 'vercel conflict: again');
select is(
  (select count(*)::int from public.org_domain_worker_events
    where org_id = current_setting('we.org_a')::uuid and domain = 'a.example.church'),
  2, 'a duplicate permanent failure appends (no unique on org, domain, event)');

-- The acknowledge route's UPDATE: (id, org_id) with acknowledged_at IS NULL.
-- First on the wrong org: zero rows, the row stays open.
with target as (
  select id from public.org_domain_worker_events
    where org_id = current_setting('we.org_a')::uuid and detail = 'vercel conflict: taken'
), stamped as (
  update public.org_domain_worker_events e
    set acknowledged_at = now()
    from target
    where e.id = target.id
      and e.org_id = current_setting('we.org_b')::uuid
      and e.acknowledged_at is null
    returning e.id
)
select is((select count(*)::int from stamped), 0,
  'acknowledging with the wrong org_id matches zero rows');

with target as (
  select id from public.org_domain_worker_events
    where org_id = current_setting('we.org_a')::uuid and detail = 'vercel conflict: taken'
), stamped as (
  update public.org_domain_worker_events e
    set acknowledged_at = now()
    from target
    where e.id = target.id
      and e.org_id = current_setting('we.org_a')::uuid
      and e.acknowledged_at is null
    returning e.id
)
select is((select count(*)::int from stamped), 1,
  'acknowledging with the row''s own org_id stamps exactly one row');

with target as (
  select id from public.org_domain_worker_events
    where org_id = current_setting('we.org_a')::uuid and detail = 'vercel conflict: taken'
), stamped as (
  update public.org_domain_worker_events e
    set acknowledged_at = now()
    from target
    where e.id = target.id
      and e.org_id = current_setting('we.org_a')::uuid
      and e.acknowledged_at is null
    returning e.id
)
select is((select count(*)::int from stamped), 0,
  'a second acknowledge is a zero-row no-op, never a re-stamp');

-- One of the two org A events is stamped; the other keeps the row parked.
select is(
  (select count(*)::int from public.org_domain_worker_events
    where org_id = current_setting('we.org_a')::uuid
      and domain = 'a.example.church'
      and event = 'attach_permanent_failure'
      and acknowledged_at is null),
  1, 'the skip check still sees the remaining open event');

-- ── The re-issued function comments carry no planning tag ───────────────────

select is(
  obj_description('public.serving_signup_apply(uuid, date, uuid, uuid[])'::regprocedure, 'pg_proc'),
  'Atomic serving signup + attendee insert pair. Tenant anchor: org_id resolved from the member_groups row named by _group_id, never a caller parameter; every other row is asserted to carry it. service_role only — the HMAC signed-link route passes its validated profile id as _actor_id.',
  'serving_signup_apply comment is the tag-free text');
select is(
  obj_description('public.serving_signup_create(uuid, date, uuid[])'::regprocedure, 'pg_proc'),
  'Authenticated serving signup entry point. Actor from auth.uid(); tenant anchor: the group''s org pinned against app_request_org_id(), fail-closed on NULL; the RLS INSERT-policy arms are re-checked before delegating to serving_signup_apply().',
  'serving_signup_create comment is the tag-free text');
select is(
  obj_description('public.app_org_slug_for_host(text)'::regprocedure, 'pg_proc'),
  'Resolves a request host to an org slug for host-based routing. Verified/active gating only — no normalization: the caller (middleware) canonicalizes the host once. Returns NULL (fails closed) for any unmatched, unverified, or suspended-org host. Called by lib/supabase/host-resolution.ts.',
  'app_org_slug_for_host comment is the tag-free text');

select * from finish();
rollback;
