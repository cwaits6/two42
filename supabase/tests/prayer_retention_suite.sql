-- organizations.prayer_request_retention_months: off for every church, the
-- column grants, the one write path (the org's own admin) and the nightly job.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/prayer_retention_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

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

create function pg_temp.set_months(_org text, _months text) returns text
  language sql as $$
    select format('update public.organizations set prayer_request_retention_months = %s where id = %L', _months, _org)
  $$;

create function pg_temp.months(_org text) returns integer
  language sql as $$
    select prayer_request_retention_months from public.organizations where id = _org::uuid
  $$;

-- ── Every church already here is off, before the fixtures add any ───────────
select is(
  (select count(*)::int from public.organizations where prayer_request_retention_months is not null),
  0, 'no existing church has the setting on');

do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
begin
  org_a := public.provision_organization('Retention Org A', 'owner-a@retention.example.test');
  org_b := public.provision_organization('Retention Org B', 'owner-b@retention.example.test');
  insert into public.access_requests (org_id, name, email, status)
    values (org_a, 'Member A', 'member-a@retention.example.test', 'approved');
  insert into auth.users (id, email) values
    (owner_a, 'owner-a@retention.example.test'),
    (member_a, 'member-a@retention.example.test'),
    (owner_b, 'owner-b@retention.example.test');
  perform set_config('pr.org_a', org_a::text, true);
  perform set_config('pr.org_b', org_b::text, true);
  perform set_config('pr.owner_a', owner_a::text, true);
  perform set_config('pr.member_a', member_a::text, true);
  perform set_config('pr.owner_b', owner_b::text, true);
end $$;

select is(
  (select role from public.profiles where id = current_setting('pr.owner_a')::uuid),
  'admin', 'fixture: org A''s owner is its admin');
select is(
  (select role from public.profiles where id = current_setting('pr.member_a')::uuid),
  'member', 'fixture: org A''s member is a plain member');

-- ── The column ──────────────────────────────────────────────────────────────
select col_is_null('public', 'organizations', 'prayer_request_retention_months',
  'the column is nullable: null is off');
select col_hasnt_default('public', 'organizations', 'prayer_request_retention_months',
  'the column has no default, so adding it turned no church on');
select is(pg_temp.months(current_setting('pr.org_a')), null,
  'a newly provisioned church starts off');

-- ── Grants ──────────────────────────────────────────────────────────────────
select ok(has_column_privilege('authenticated', 'public.organizations', 'prayer_request_retention_months', 'select'),
  'authenticated may read the column');
select ok(has_column_privilege('authenticated', 'public.organizations', 'prayer_request_retention_months', 'update'),
  'authenticated may update the column (the policy narrows it to the church admin)');
select ok(not has_column_privilege('anon', 'public.organizations', 'prayer_request_retention_months', 'select'),
  'anon may not read the column');
select ok(not has_column_privilege('anon', 'public.organizations', 'prayer_request_retention_months', 'update'),
  'anon may not update the column');
select ok(has_table_privilege('service_role', 'public.organizations', 'select'),
  'the nightly job can read the setting');

-- ── The write path ──────────────────────────────────────────────────────────
select is(
  pg_temp.as_write(current_setting('pr.owner_a')::uuid, pg_temp.set_months(current_setting('pr.org_a'), '6')),
  'rows=1', 'the church admin turns it on');
select is(pg_temp.months(current_setting('pr.org_a')), 6, 'the admin''s write landed');

select is(
  pg_temp.as_write(current_setting('pr.member_a')::uuid, pg_temp.set_months(current_setting('pr.org_a'), '24')),
  'rows=0', 'a non-admin of the same church touches zero rows');
select is(pg_temp.months(current_setting('pr.org_a')), 6, 'the member''s write changed nothing');

select is(
  pg_temp.as_write(current_setting('pr.owner_b')::uuid, pg_temp.set_months(current_setting('pr.org_a'), '24')),
  'rows=0', 'another church''s admin touches zero rows');
select is(pg_temp.months(current_setting('pr.org_a')), 6, 'the other admin''s write changed nothing');
select is(pg_temp.months(current_setting('pr.org_b')), null, 'and did not land on their own church');

select is(
  pg_temp.as_write(current_setting('pr.owner_a')::uuid, pg_temp.set_months(current_setting('pr.org_a'), 'null')),
  'rows=1', 'the church admin turns it off again');
select is(pg_temp.months(current_setting('pr.org_a')), null, 'off is null');

-- ── Only the offered periods ────────────────────────────────────────────────
select is(
  pg_temp.as_write(current_setting('pr.owner_a')::uuid, pg_temp.set_months(current_setting('pr.org_a'), '12')),
  'rows=1', '1 year is offered');
select is(
  pg_temp.as_write(current_setting('pr.owner_a')::uuid, pg_temp.set_months(current_setting('pr.org_a'), '24')),
  'rows=1', '2 years is offered');
select is(
  pg_temp.as_write(current_setting('pr.owner_a')::uuid, pg_temp.set_months(current_setting('pr.org_a'), '1')),
  '23514', 'a period that was not offered is refused');
select is(
  pg_temp.as_write(current_setting('pr.owner_a')::uuid, pg_temp.set_months(current_setting('pr.org_a'), '0')),
  '23514', 'zero, which would delete everything, is refused');
select is(pg_temp.months(current_setting('pr.org_a')), 24, 'the refused writes changed nothing');

-- ── Reads ───────────────────────────────────────────────────────────────────
select is(
  pg_temp.as_text(current_setting('pr.owner_b')::uuid,
    format('select prayer_request_retention_months::text from public.organizations where id = %L', current_setting('pr.org_a'))),
  null, 'another church''s admin cannot read this church''s setting');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  'select prayer_request_retention_months from public.organizations',
  '42501', null, 'anon cannot read the setting');
reset role;

-- ── The nightly job ─────────────────────────────────────────────────────────
select is(
  (select schedule from cron.job where jobname = 'clean-up-expired-data-nightly'),
  '0 9 * * *', 'the cleanup runs at 09:00 UTC, clear of the 15:00 UTC reminders');
select ok(
  (select command like '%/functions/v1/clean-up-expired-data%' from cron.job where jobname = 'clean-up-expired-data-nightly'),
  'the cron calls the deployed function');

select * from finish();
rollback;
