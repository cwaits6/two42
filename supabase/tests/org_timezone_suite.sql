-- organizations.timezone: the default, the validator, the column grants and
-- the one write path (the org's own admin).
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/org_timezone_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- ── Probe helpers: run one statement as an authenticated actor ──────────────
create function pg_temp.as_text(_actor uuid, _query text) returns text
  language plpgsql as $$
declare _result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  set local role authenticated;
  execute _query into _result;
  reset role;
  return _result;
end $$;

-- 'rows=N' for a write that ran, else the SQLSTATE it raised. A filtered
-- UPDATE reports success with zero rows, so the count is the assertion.
create function pg_temp.as_write(_actor uuid, _query text) returns text
  language plpgsql as $$
declare _n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  set local role authenticated;
  begin
    execute _query;
    get diagnostics _n = row_count;
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'rows=' || _n;
end $$;

-- ── Fixtures: two orgs, each with its admin; org A also has a member ───────
do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
begin
  org_a := public.provision_organization('Timezone Org A', 'owner-a@timezone.example.test');
  org_b := public.provision_organization('Timezone Org B', 'owner-b@timezone.example.test');
  insert into public.access_requests (org_id, name, email, status)
    values (org_a, 'Member A', 'member-a@timezone.example.test', 'approved');
  insert into auth.users (id, email) values
    (owner_a, 'owner-a@timezone.example.test'),
    (member_a, 'member-a@timezone.example.test'),
    (owner_b, 'owner-b@timezone.example.test');
  perform set_config('tz.org_a', org_a::text, true);
  perform set_config('tz.org_b', org_b::text, true);
  perform set_config('tz.owner_a', owner_a::text, true);
  perform set_config('tz.member_a', member_a::text, true);
  perform set_config('tz.owner_b', owner_b::text, true);
end $$;

-- Org B starts in a different zone than org A, so a read that crosses orgs
-- returns a value that gives the leak away.
update public.organizations set timezone = 'Asia/Tokyo'
  where id = current_setting('tz.org_b')::uuid;

select is(
  (select role from public.profiles where id = current_setting('tz.owner_a')::uuid),
  'admin', 'fixture: org A''s owner is its admin');
select is(
  (select role from public.profiles where id = current_setting('tz.owner_b')::uuid),
  'admin', 'fixture: org B''s owner is its admin');
select is(
  (select role from public.profiles where id = current_setting('tz.member_a')::uuid),
  'member', 'fixture: org A''s member is a plain member');

-- ── 1. The column and its default ───────────────────────────────────────────
select col_not_null('public', 'organizations', 'timezone', 'organizations.timezone is NOT NULL');
select col_default_is('public', 'organizations', 'timezone', 'America/New_York',
  'organizations.timezone defaults to America/New_York');
select is(
  (select timezone from public.organizations where id = current_setting('tz.org_a')::uuid),
  'America/New_York', 'a newly provisioned org starts in America/New_York');
select has_trigger('public', 'organizations', 'organizations_timezone_check',
  'organizations carries the timezone validator trigger');

-- ── 2. Column grants ────────────────────────────────────────────────────────
select ok(has_column_privilege('authenticated', 'public.organizations', 'timezone', 'select'),
  'authenticated may read organizations.timezone');
select ok(has_column_privilege('authenticated', 'public.organizations', 'timezone', 'update'),
  'authenticated may update organizations.timezone (the policy narrows it to the org admin)');
select ok(not has_column_privilege('anon', 'public.organizations', 'timezone', 'select'),
  'anon may not read organizations.timezone');
select ok(not has_column_privilege('anon', 'public.organizations', 'timezone', 'update'),
  'anon may not update organizations.timezone');

-- ── 3. Every member reads their own org's zone ──────────────────────────────
select is(
  pg_temp.as_text(current_setting('tz.member_a')::uuid,
    'select timezone from public.organizations'),
  'America/New_York', 'a plain member reads their own org''s zone');
select is(
  pg_temp.as_text(current_setting('tz.member_a')::uuid,
    'select count(*)::text from public.organizations'),
  '1', 'a plain member sees only their own org row');
select is(
  pg_temp.as_text(current_setting('tz.owner_b')::uuid,
    format('select timezone from public.organizations where id = %L', current_setting('tz.org_a'))),
  null, 'the admin of org B cannot read org A''s zone by id');

-- ── 4. The write path ───────────────────────────────────────────────────────
select is(
  pg_temp.as_write(current_setting('tz.owner_a')::uuid,
    format('update public.organizations set timezone = %L where id = %L',
      'America/Chicago', current_setting('tz.org_a'))),
  'rows=1', 'the org admin sets their own org''s zone');
select is(
  (select timezone from public.organizations where id = current_setting('tz.org_a')::uuid),
  'America/Chicago', 'the admin''s write landed');

select is(
  pg_temp.as_write(current_setting('tz.member_a')::uuid,
    format('update public.organizations set timezone = %L where id = %L',
      'America/Denver', current_setting('tz.org_a'))),
  'rows=0', 'a plain member''s update touches zero rows');
select is(
  (select timezone from public.organizations where id = current_setting('tz.org_a')::uuid),
  'America/Chicago', 'the member''s write changed nothing');

select is(
  pg_temp.as_write(current_setting('tz.owner_b')::uuid,
    format('update public.organizations set timezone = %L where id = %L',
      'America/Denver', current_setting('tz.org_a'))),
  'rows=0', 'the admin of org B cannot change org A');
select is(
  (select timezone from public.organizations where id = current_setting('tz.org_a')::uuid),
  'America/Chicago', 'org B''s write changed nothing in org A');

select is(
  pg_temp.as_write(current_setting('tz.owner_b')::uuid,
    format('update public.organizations set timezone = %L where id = %L',
      'America/Denver', current_setting('tz.org_b'))),
  'rows=1', 'the admin of org B sets their own org''s zone');

-- ── 5. The validator ────────────────────────────────────────────────────────
select is(
  pg_temp.as_write(current_setting('tz.owner_a')::uuid,
    format('update public.organizations set timezone = %L where id = %L',
      'Nowhere/Bogus', current_setting('tz.org_a'))),
  '23514', 'an unknown zone is refused as a check violation on the admin''s write');
select is(
  (select timezone from public.organizations where id = current_setting('tz.org_a')::uuid),
  'America/Chicago', 'the refused write changed nothing');

-- Names `at time zone` would take but Intl cannot format in: a POSIX rule
-- string, an offset, the posix/ duplicate tree, a case variant and the
-- Factory placeholder. The stored set must be exactly what every reader can use.
select is(
  pg_temp.as_write(current_setting('tz.owner_a')::uuid,
    format('update public.organizations set timezone = %L where id = %L',
      'EST5EDT,M3.2.0,M11.1.0', current_setting('tz.org_a'))),
  '23514', 'a POSIX rule string is refused');
select is(
  pg_temp.as_write(current_setting('tz.owner_a')::uuid,
    format('update public.organizations set timezone = %L where id = %L',
      'UTC+5', current_setting('tz.org_a'))),
  '23514', 'an offset is refused');
select is(
  pg_temp.as_write(current_setting('tz.owner_a')::uuid,
    format('update public.organizations set timezone = %L where id = %L',
      'posix/America/New_York', current_setting('tz.org_a'))),
  '23514', 'the posix/ duplicate of a zone is refused');
select is(
  pg_temp.as_write(current_setting('tz.owner_a')::uuid,
    format('update public.organizations set timezone = %L where id = %L',
      'america/chicago', current_setting('tz.org_a'))),
  '23514', 'a case variant is refused');
select is(
  pg_temp.as_write(current_setting('tz.owner_a')::uuid,
    format('update public.organizations set timezone = %L where id = %L',
      'Factory', current_setting('tz.org_a'))),
  '23514', 'the Factory placeholder is refused');
select is(
  (select timezone from public.organizations where id = current_setting('tz.org_a')::uuid),
  'America/Chicago', 'none of the refused writes changed anything');

-- anon holds no SELECT grant on the column, so the read is refused outright.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  'select timezone from public.organizations',
  '42501', null,
  'anon cannot read organizations.timezone');
reset role;

select is(
  (select prosecdef from pg_catalog.pg_proc where proname = 'organizations_timezone_check'),
  false, 'the validator trigger function is not SECURITY DEFINER');

reset role;
select throws_ok(
  format('update public.organizations set timezone = %L where id = %L',
    'Nowhere/Bogus', current_setting('tz.org_b')),
  '23514', 'organizations.timezone: unknown time zone "Nowhere/Bogus"',
  'the validator refuses Nowhere/Bogus regardless of role');
select throws_ok(
  format('update public.organizations set timezone = %L where id = %L',
    'localtime', current_setting('tz.org_b')),
  '23514', 'organizations.timezone: unknown time zone "localtime"',
  'the validator refuses localtime, a Postgres-only name');
select throws_ok(
  format('update public.organizations set timezone = %L where id = %L',
    'posixrules', current_setting('tz.org_b')),
  '23514', 'organizations.timezone: unknown time zone "posixrules"',
  'the validator refuses posixrules, a Postgres-only name');
select lives_ok(
  format('update public.organizations set timezone = %L where id = %L',
    'America/Chicago', current_setting('tz.org_b')),
  'the validator accepts America/Chicago');
select lives_ok(
  format('update public.organizations set timezone = %L where id = %L',
    'Asia/Kolkata', current_setting('tz.org_b')),
  'the validator accepts a current IANA name Intl.supportedValuesOf() may list under an older spelling');
select lives_ok(
  format('update public.organizations set timezone = %L where id = %L',
    'UTC', current_setting('tz.org_b')),
  'the validator accepts UTC');

select * from finish();
rollback;
