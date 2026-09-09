-- Per-org email send cap suite.
--
-- Pins email_quota_consume() from 20260825000000: the grant matrix (the
-- caller discrimination IS the grants, mirroring serving_signup_apply), the
-- first-send-of-day bound (_n > _cap on the INSERT arm), the cap boundary on
-- the UPDATE arm, override precedence via org_email_limits, the loud-failure
-- guards (_n <= 0 / NULL raise; sent_count >= 0 CHECK), day independence,
-- and the service-role-only lockdown of both tables.
--
-- Every reserve outcome asserts the COUNTER VALUE or ROW COUNT explicitly,
-- never just the boolean: a filtered UPDATE whose WHERE clause matches
-- nothing is a silent success in this codebase and has bitten it before.
--
-- Atomicity under concurrency is a property of the single
-- INSERT ... ON CONFLICT ... DO UPDATE ... WHERE statement (one row-level
-- lock for the statement's duration), not something a sequential pgTAP
-- session can race; this suite pins the boundary logic that statement
-- enforces. No dblink/pg_background precedent exists in this repo, and none
-- is introduced here — a deliberate scope decision, stated in the PR.
--
-- Orgs are provisioned fresh; this suite never touches the seeded org.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/org_email_quota_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Org A: no org_email_limits row (the 500 default applies).
-- Org B: override daily_cap = 5 (precedence).
-- Org C: override daily_cap = 0 (fully throttled).
do $$
declare
  org_a uuid;
  org_b uuid;
  org_c uuid;
begin
  org_a := public.provision_organization('Quota Org A', 'quota-org-a', 'owner-a@quota.example.test');
  org_b := public.provision_organization('Quota Org B', 'quota-org-b', 'owner-b@quota.example.test');
  org_c := public.provision_organization('Quota Org C', 'quota-org-c', 'owner-c@quota.example.test');

  insert into public.org_email_limits (org_id, daily_cap) values
    (org_b, 5),
    (org_c, 0);

  -- Day-independence fixture: yesterday's near-cap usage for org A must not
  -- constrain today's reserves (each (org_id, usage_date) row is its own
  -- bucket).
  insert into public.org_email_usage (org_id, usage_date, sent_count)
    values (org_a, (now() at time zone 'utc')::date - 1, 499);

  perform set_config('quota.org_a', org_a::text, true);
  perform set_config('quota.org_b', org_b::text, true);
  perform set_config('quota.org_c', org_c::text, true);
  perform set_config('quota.today', ((now() at time zone 'utc')::date)::text, true);
end $$;

-- ── Shape and grant matrix ──────────────────────────────────────────────────

select has_function('public', 'email_quota_consume',
  array['uuid', 'integer'],
  'email_quota_consume(uuid, integer) exists');
select is_definer('public', 'email_quota_consume',
  array['uuid', 'integer'],
  'email_quota_consume is SECURITY DEFINER');

select ok(not has_function_privilege('anon',
  'public.email_quota_consume(uuid,integer)', 'execute'),
  'anon may not execute email_quota_consume');
select ok(not has_function_privilege('authenticated',
  'public.email_quota_consume(uuid,integer)', 'execute'),
  'authenticated may not execute email_quota_consume');
select ok(has_function_privilege('service_role',
  'public.email_quota_consume(uuid,integer)', 'execute'),
  'service_role may execute email_quota_consume');

-- ── Table lockdown: service-role-only posture ───────────────────────────────
-- Both tables carry only the restrictive isolation policy (no permissive
-- arm) AND a full privilege revoke — no PostgREST role reaches them at all.

select ok(not has_table_privilege('anon', 'public.org_email_usage', 'select'),
  'anon has no SELECT on org_email_usage');
select ok(not has_table_privilege('authenticated', 'public.org_email_usage', 'select'),
  'authenticated has no SELECT on org_email_usage');
select ok(not has_table_privilege('authenticated', 'public.org_email_usage', 'insert'),
  'authenticated has no INSERT on org_email_usage');
select ok(not has_table_privilege('authenticated', 'public.org_email_usage', 'update'),
  'authenticated has no UPDATE on org_email_usage');
select ok(not has_table_privilege('authenticated', 'public.org_email_usage', 'delete'),
  'authenticated has no DELETE on org_email_usage');
select ok(not has_table_privilege('anon', 'public.org_email_limits', 'select'),
  'anon has no SELECT on org_email_limits');
select ok(not has_table_privilege('authenticated', 'public.org_email_limits', 'select'),
  'authenticated has no SELECT on org_email_limits');
select ok(not has_table_privilege('authenticated', 'public.org_email_limits', 'insert'),
  'authenticated has no INSERT on org_email_limits');
select ok(not has_table_privilege('authenticated', 'public.org_email_limits', 'update'),
  'authenticated has no UPDATE on org_email_limits');
select ok(not has_table_privilege('authenticated', 'public.org_email_limits', 'delete'),
  'authenticated has no DELETE on org_email_limits');

-- Live probe: the lockdown holds at execution time, not just in the ACL.
do $$
declare
  probe_err text := 'no error';
begin
  set local role authenticated;
  begin
    perform * from public.org_email_usage;
  exception when others then
    probe_err := sqlstate;
  end;
  reset role;
  perform set_config('quota.probe_err', probe_err, true);
end $$;

select is(current_setting('quota.probe_err'), '42501',
  'authenticated SELECT on org_email_usage is denied outright (42501)');

-- ── First-send-of-day bound (the INSERT-arm guard) ──────────────────────────
-- Must run BEFORE any successful reserve for org A today: the guard only
-- matters on a fresh (org, day) bucket, where ON CONFLICT ... WHERE cannot
-- constrain anything.

select is(
  public.email_quota_consume(current_setting('quota.org_a')::uuid, 501),
  false,
  'fresh day: a first batch over the 500 default is refused');
select is(
  (select count(*) from public.org_email_usage
    where org_id = current_setting('quota.org_a')::uuid
      and usage_date = current_setting('quota.today')::date),
  0::bigint,
  'refused first-of-day reserve inserted NO usage row');

-- ── Basic reserve + counter value ───────────────────────────────────────────

select is(
  public.email_quota_consume(current_setting('quota.org_a')::uuid, 10),
  true,
  'fresh day: a batch of 10 under the default cap is granted');
select is(
  (select sent_count from public.org_email_usage
    where org_id = current_setting('quota.org_a')::uuid
      and usage_date = current_setting('quota.today')::date),
  10,
  'granted reserve wrote sent_count = 10 exactly');

-- Day independence: yesterday's 499 for org A did not count against today.
select is(
  (select sent_count from public.org_email_usage
    where org_id = current_setting('quota.org_a')::uuid
      and usage_date = current_setting('quota.today')::date - 1),
  499,
  'yesterday''s bucket is untouched by today''s reserves');

-- ── Cap boundary on the UPDATE arm ──────────────────────────────────────────

select is(
  public.email_quota_consume(current_setting('quota.org_a')::uuid, 480),
  true,
  'accumulating to 490 is granted');
select is(
  public.email_quota_consume(current_setting('quota.org_a')::uuid, 10),
  true,
  'reserving exactly to the cap (490 + 10 = 500) is granted');
select is(
  (select sent_count from public.org_email_usage
    where org_id = current_setting('quota.org_a')::uuid
      and usage_date = current_setting('quota.today')::date),
  500,
  'counter sits exactly at the cap');
select is(
  public.email_quota_consume(current_setting('quota.org_a')::uuid, 1),
  false,
  'one past the cap is refused');
-- A refused reserve must leave sent_count
-- unchanged — the filtered UPDATE not matching is a silent no-op that still
-- returns without error, so the boolean alone proves nothing.
select is(
  (select sent_count from public.org_email_usage
    where org_id = current_setting('quota.org_a')::uuid
      and usage_date = current_setting('quota.today')::date),
  500,
  'refused reserve left sent_count unchanged at 500');

-- ── Loud-failure guards ─────────────────────────────────────────────────────

select throws_ok(
  format('select public.email_quota_consume(%L::uuid, 0)', current_setting('quota.org_a')),
  'P0001', 'email_quota_consume: _n must be a positive batch size',
  '_n = 0 raises (a caller bug, not a refusable request)');
select throws_ok(
  format('select public.email_quota_consume(%L::uuid, -1)', current_setting('quota.org_a')),
  'P0001', 'email_quota_consume: _n must be a positive batch size',
  '_n = -1 raises (cannot walk sent_count backwards)');
select throws_ok(
  format('select public.email_quota_consume(%L::uuid, null)', current_setting('quota.org_a')),
  'P0001', 'email_quota_consume: _n must be a positive batch size',
  'NULL _n raises');
select throws_ok(
  'select public.email_quota_consume(null, 5)',
  'P0001', 'email_quota_consume: _n must be a positive batch size',
  'NULL _org_id raises');

-- The >= 0 CHECK is the second lock on the negative-count door.
select throws_ok(
  format(
    'update public.org_email_usage set sent_count = -1 where org_id = %L::uuid and usage_date = %L::date',
    current_setting('quota.org_a'), current_setting('quota.today')),
  '23514', null,
  'a direct negative sent_count write violates the >= 0 CHECK');

-- ── Override precedence (org_email_limits beats the 500 default) ────────────

select is(
  public.email_quota_consume(current_setting('quota.org_b')::uuid, 6),
  false,
  'override org, fresh day: a first batch over its cap of 5 is refused');
select is(
  (select count(*) from public.org_email_usage
    where org_id = current_setting('quota.org_b')::uuid
      and usage_date = current_setting('quota.today')::date),
  0::bigint,
  'override org: refused first-of-day reserve inserted NO usage row');
select is(
  public.email_quota_consume(current_setting('quota.org_b')::uuid, 5),
  true,
  'override org: reserving exactly its cap of 5 is granted');
select is(
  (select sent_count from public.org_email_usage
    where org_id = current_setting('quota.org_b')::uuid
      and usage_date = current_setting('quota.today')::date),
  5,
  'override org: counter sits exactly at its cap');
select is(
  public.email_quota_consume(current_setting('quota.org_b')::uuid, 1),
  false,
  'override org: one past its cap is refused');
select is(
  (select sent_count from public.org_email_usage
    where org_id = current_setting('quota.org_b')::uuid
      and usage_date = current_setting('quota.today')::date),
  5,
  'override org: refused reserve left sent_count unchanged at 5');

-- ── daily_cap = 0: a fully throttled org ────────────────────────────────────

select is(
  public.email_quota_consume(current_setting('quota.org_c')::uuid, 1),
  false,
  'cap 0: every reserve is refused');
select is(
  (select count(*) from public.org_email_usage
    where org_id = current_setting('quota.org_c')::uuid),
  0::bigint,
  'cap 0: no usage row is ever created');

-- ── Cross-org independence ──────────────────────────────────────────────────
-- Org A at its cap and org B at its override never touched each other's
-- buckets: exactly one today-row each, keyed by their own org_id.

select is(
  (select count(*) from public.org_email_usage
    where usage_date = current_setting('quota.today')::date
      and org_id in (current_setting('quota.org_a')::uuid,
                     current_setting('quota.org_b')::uuid)),
  2::bigint,
  'each org holds exactly its own today-bucket (no shared counter)');

select * from finish();
rollback;
