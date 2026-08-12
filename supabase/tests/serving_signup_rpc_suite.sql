-- Transactional serving signup RPC suite (CWA-47 / #313).
--
-- Pins the serving_signup_apply / serving_signup_create pair introduced in
-- 20260803010000: the grant matrix (the caller discrimination IS the grants),
-- the SV00x error contract, the org checks that replace RLS inside the
-- SECURITY DEFINER bodies, idempotent re-signup, and — the point of the
-- ticket — that a mid-way attendee-insert failure leaves ZERO rows in both
-- tables so the Sunday stays claimable.
--
-- Orgs are provisioned fresh; this suite never touches the seeded org.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/serving_signup_rpc_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Two orgs, each with a serving team. Org A additionally gets a second team
-- member (for the different-member SV001 case) and a profile with no team
-- membership (for SV004 and the household rule).
do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  member_a2 uuid := gen_random_uuid();
  outsider_a uuid := gen_random_uuid();
  group_a uuid;
  group_b uuid;
  sunday1 date := current_date + (7 - extract(dow from current_date)::int);
begin
  org_a := public.provision_organization('Serving RPC Org A', 'serving-rpc-org-a', 'owner-a@serving-rpc.example.test');
  org_b := public.provision_organization('Serving RPC Org B', 'serving-rpc-org-b', 'owner-b@serving-rpc.example.test');

  -- Approved requests so handle_new_user() resolves the extra org A signups.
  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Second member', 'member-a2@serving-rpc.example.test', 'approved'),
    (org_a, 'Outsider', 'outsider-a@serving-rpc.example.test', 'approved');

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@serving-rpc.example.test'),
    (owner_b, 'owner-b@serving-rpc.example.test'),
    (member_a2, 'member-a2@serving-rpc.example.test'),
    (outsider_a, 'outsider-a@serving-rpc.example.test');

  insert into public.member_groups (org_id, name, is_serving_role)
    values (org_a, 'org A serving team', true) returning id into group_a;
  insert into public.member_groups (org_id, name, is_serving_role)
    values (org_b, 'org B serving team', true) returning id into group_b;

  insert into public.serving_team_settings (org_id, group_id, enabled) values
    (org_a, group_a, true),
    (org_b, group_b, true);

  insert into public.profile_groups (org_id, profile_id, group_id) values
    (org_a, owner_a, group_a),
    (org_a, member_a2, group_a),
    (org_b, owner_b, group_b);

  perform set_config('svrpc.org_a', org_a::text, true);
  perform set_config('svrpc.org_b', org_b::text, true);
  perform set_config('svrpc.owner_a', owner_a::text, true);
  perform set_config('svrpc.owner_b', owner_b::text, true);
  perform set_config('svrpc.member_a2', member_a2::text, true);
  perform set_config('svrpc.outsider_a', outsider_a::text, true);
  perform set_config('svrpc.group_a', group_a::text, true);
  perform set_config('svrpc.group_b', group_b::text, true);
  perform set_config('svrpc.sunday1', sunday1::text, true);
  perform set_config('svrpc.sunday2', (sunday1 + 7)::text, true);
  perform set_config('svrpc.sunday3', (sunday1 + 14)::text, true);
end $$;

-- ── Shape and grant matrix ──────────────────────────────────────────────────

select has_function('public', 'serving_signup_apply',
  array['uuid', 'date', 'uuid', 'uuid[]'],
  'serving_signup_apply(uuid, date, uuid, uuid[]) exists');
select has_function('public', 'serving_signup_create',
  array['uuid', 'date', 'uuid[]'],
  'serving_signup_create(uuid, date, uuid[]) exists');
select is_definer('public', 'serving_signup_apply',
  array['uuid', 'date', 'uuid', 'uuid[]'],
  'serving_signup_apply is SECURITY DEFINER');
select is_definer('public', 'serving_signup_create',
  array['uuid', 'date', 'uuid[]'],
  'serving_signup_create is SECURITY DEFINER');

select ok(not has_function_privilege('anon',
  'public.serving_signup_apply(uuid,date,uuid,uuid[])', 'execute'),
  'anon may not execute serving_signup_apply');
select ok(not has_function_privilege('authenticated',
  'public.serving_signup_apply(uuid,date,uuid,uuid[])', 'execute'),
  'authenticated may not execute serving_signup_apply directly');
select ok(has_function_privilege('service_role',
  'public.serving_signup_apply(uuid,date,uuid,uuid[])', 'execute'),
  'service_role may execute serving_signup_apply');
select ok(not has_function_privilege('anon',
  'public.serving_signup_create(uuid,date,uuid[])', 'execute'),
  'anon may not execute serving_signup_create');
select ok(has_function_privilege('authenticated',
  'public.serving_signup_create(uuid,date,uuid[])', 'execute'),
  'authenticated may execute serving_signup_create');

-- ── Happy path + idempotent re-signup (authenticated wrapper) ───────────────

do $$
declare
  r record;
  first_err text := 'no error';
  second_err text := 'no error';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('svrpc.owner_a'))::text, true);
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid,
      current_setting('svrpc.sunday1')::date,
      array[current_setting('svrpc.owner_a')::uuid]);
    perform set_config('svrpc.happy_created', r.created::text, true);
    perform set_config('svrpc.happy_org', r.signup_org_id::text, true);
  exception when others then
    first_err := sqlstate;
  end;
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid,
      current_setting('svrpc.sunday1')::date,
      array[current_setting('svrpc.owner_a')::uuid]);
    perform set_config('svrpc.idem_created', r.created::text, true);
  exception when others then
    second_err := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('svrpc.happy_err', first_err, true);
  perform set_config('svrpc.idem_err', second_err, true);
end $$;

select is(current_setting('svrpc.happy_err'), 'no error',
  'happy path: member signs up without error');
select is(current_setting('svrpc.happy_created'), 'true',
  'happy path: created = true');
select is(current_setting('svrpc.happy_org'), current_setting('svrpc.org_a'),
  'happy path: reported org is the group''s org');
select is(
  (select count(*) from public.serving_signups
    where group_id = current_setting('svrpc.group_a')::uuid
      and service_date = current_setting('svrpc.sunday1')::date
      and org_id = current_setting('svrpc.org_a')::uuid),
  1::bigint,
  'happy path: exactly one signup row, carrying org A');
select is(
  (select count(*) from public.serving_signup_attendees a
    join public.serving_signups s on s.id = a.signup_id
    where s.group_id = current_setting('svrpc.group_a')::uuid
      and s.service_date = current_setting('svrpc.sunday1')::date
      and a.org_id = current_setting('svrpc.org_a')::uuid),
  1::bigint,
  'happy path: exactly one attendee row, carrying org A');

select is(current_setting('svrpc.idem_err'), 'no error',
  'idempotency: the same member re-signing is not an error');
select is(current_setting('svrpc.idem_created'), 'false',
  'idempotency: re-signup reports created = false');
select is(
  (select count(*) from public.serving_signups
    where group_id = current_setting('svrpc.group_a')::uuid
      and service_date = current_setting('svrpc.sunday1')::date),
  1::bigint,
  'idempotency: still exactly one signup row');
select is(
  (select count(*) from public.serving_signup_attendees a
    join public.serving_signups s on s.id = a.signup_id
    where s.group_id = current_setting('svrpc.group_a')::uuid
      and s.service_date = current_setting('svrpc.sunday1')::date),
  1::bigint,
  'idempotency: still exactly one attendee row');

-- ── Error contract through the authenticated wrapper ────────────────────────

do $$
declare
  r record;
  taken_err text := 'no error';
  crossgroup_err text := 'no error';
  crossattendee_err text := 'no error';
  nonmember_err text := 'no error';
  disabled_err text := 'no error';
begin
  -- A different org A member tries the Sunday owner A already holds → SV001.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('svrpc.member_a2'))::text, true);
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid,
      current_setting('svrpc.sunday1')::date,
      array[current_setting('svrpc.member_a2')::uuid]);
  exception when others then
    taken_err := sqlstate;
  end;
  reset role;

  -- Owner A names org B's group → SV002 (the request-org pin fails first).
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('svrpc.owner_a'))::text, true);
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_b')::uuid,
      current_setting('svrpc.sunday1')::date,
      array[current_setting('svrpc.owner_a')::uuid]);
  exception when others then
    crossgroup_err := sqlstate;
  end;

  -- Owner A smuggles org B's owner into the attendee list → SV002.
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid,
      current_setting('svrpc.sunday2')::date,
      array[current_setting('svrpc.owner_a')::uuid,
            current_setting('svrpc.owner_b')::uuid]);
  exception when others then
    crossattendee_err := sqlstate;
  end;
  reset role;

  -- An org A profile with no profile_groups row for the team → SV004.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('svrpc.outsider_a'))::text, true);
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid,
      current_setting('svrpc.sunday2')::date,
      array[current_setting('svrpc.outsider_a')::uuid]);
  exception when others then
    nonmember_err := sqlstate;
  end;
  reset role;

  -- Signups disabled for the team → SV003 (re-enabled before the next block).
  update public.serving_team_settings
    set enabled = false
    where group_id = current_setting('svrpc.group_a')::uuid;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('svrpc.owner_a'))::text, true);
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid,
      current_setting('svrpc.sunday2')::date,
      array[current_setting('svrpc.owner_a')::uuid]);
  exception when others then
    disabled_err := sqlstate;
  end;
  reset role;
  update public.serving_team_settings
    set enabled = true
    where group_id = current_setting('svrpc.group_a')::uuid;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('svrpc.taken_err', taken_err, true);
  perform set_config('svrpc.crossgroup_err', crossgroup_err, true);
  perform set_config('svrpc.crossattendee_err', crossattendee_err, true);
  perform set_config('svrpc.nonmember_err', nonmember_err, true);
  perform set_config('svrpc.disabled_err', disabled_err, true);
end $$;

select is(current_setting('svrpc.taken_err'), 'SV001',
  'a DIFFERENT member claiming a held Sunday raises SV001');
select is(
  (select count(*) from public.serving_signups
    where group_id = current_setting('svrpc.group_a')::uuid
      and service_date = current_setting('svrpc.sunday1')::date),
  1::bigint,
  'SV001 left the existing signup row alone');

select is(current_setting('svrpc.crossgroup_err'), 'SV002',
  'a cross-org group id raises SV002');
select is(
  (select count(*) from public.serving_signups
    where group_id = current_setting('svrpc.group_b')::uuid),
  0::bigint,
  'cross-org group attempt wrote no signup rows in either org');
select is(
  (select count(*) from public.serving_signup_attendees a
    join public.serving_signups s on s.id = a.signup_id
    where s.group_id = current_setting('svrpc.group_b')::uuid),
  0::bigint,
  'cross-org group attempt wrote no attendee rows in either org');

select is(current_setting('svrpc.crossattendee_err'), 'SV002',
  'a cross-org attendee raises SV002');
select is(
  (select count(*) from public.serving_signups
    where group_id = current_setting('svrpc.group_a')::uuid
      and service_date = current_setting('svrpc.sunday2')::date),
  0::bigint,
  'cross-org attendee attempt wrote nothing');

select is(current_setting('svrpc.nonmember_err'), 'SV004',
  'an actor who is not on the team raises SV004');
select is(current_setting('svrpc.disabled_err'), 'SV003',
  'a team with signups disabled raises SV003');

-- ── Core guards through serving_signup_apply (the service-role surface) ─────

do $$
declare
  r record;
  unknown_err text := 'no error';
  empty_err text := 'no error';
  noactor_err text := 'no error';
  household_err text := 'no error';
  nosession_err text := 'no error';
  dup_err text := 'no error';
begin
  set local role service_role;

  -- Unknown group id (valid uuid, no row) → SV002.
  begin
    select * into r from public.serving_signup_apply(
      gen_random_uuid(),
      current_setting('svrpc.sunday2')::date,
      current_setting('svrpc.owner_a')::uuid,
      array[current_setting('svrpc.owner_a')::uuid]);
  exception when others then
    unknown_err := sqlstate;
  end;

  -- Empty attendee list → SV002.
  begin
    select * into r from public.serving_signup_apply(
      current_setting('svrpc.group_a')::uuid,
      current_setting('svrpc.sunday2')::date,
      current_setting('svrpc.owner_a')::uuid,
      '{}'::uuid[]);
  exception when others then
    empty_err := sqlstate;
  end;

  -- Attendee list that does not include the actor → SV002.
  begin
    select * into r from public.serving_signup_apply(
      current_setting('svrpc.group_a')::uuid,
      current_setting('svrpc.sunday2')::date,
      current_setting('svrpc.owner_a')::uuid,
      array[current_setting('svrpc.member_a2')::uuid]);
  exception when others then
    noactor_err := sqlstate;
  end;

  -- Same-org attendee outside the actor's household → SV002.
  begin
    select * into r from public.serving_signup_apply(
      current_setting('svrpc.group_a')::uuid,
      current_setting('svrpc.sunday2')::date,
      current_setting('svrpc.owner_a')::uuid,
      array[current_setting('svrpc.owner_a')::uuid,
            current_setting('svrpc.outsider_a')::uuid]);
  exception when others then
    household_err := sqlstate;
  end;

  -- Duplicate ids in the attendee list → one attendee row, no error.
  begin
    select * into r from public.serving_signup_apply(
      current_setting('svrpc.group_b')::uuid,
      current_setting('svrpc.sunday2')::date,
      current_setting('svrpc.owner_b')::uuid,
      array[current_setting('svrpc.owner_b')::uuid,
            current_setting('svrpc.owner_b')::uuid]);
    perform set_config('svrpc.dup_created', r.created::text, true);
  exception when others then
    dup_err := sqlstate;
  end;

  reset role;

  -- serving_signup_create with no session (auth.uid() NULL) → SV002, never a
  -- NULL-org write.
  perform set_config('request.jwt.claims', '', true);
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid,
      current_setting('svrpc.sunday2')::date,
      array[current_setting('svrpc.owner_a')::uuid]);
  exception when others then
    nosession_err := sqlstate;
  end;

  perform set_config('svrpc.unknown_err', unknown_err, true);
  perform set_config('svrpc.empty_err', empty_err, true);
  perform set_config('svrpc.noactor_err', noactor_err, true);
  perform set_config('svrpc.household_err', household_err, true);
  perform set_config('svrpc.nosession_err', nosession_err, true);
  perform set_config('svrpc.dup_err', dup_err, true);
end $$;

select is(current_setting('svrpc.unknown_err'), 'SV002',
  'an unknown group id raises SV002');
select is(current_setting('svrpc.empty_err'), 'SV002',
  'an empty attendee list raises SV002');
select is(current_setting('svrpc.noactor_err'), 'SV002',
  'an attendee list without the actor raises SV002');
select is(current_setting('svrpc.household_err'), 'SV002',
  'a same-org attendee outside the actor''s household raises SV002');
select is(current_setting('svrpc.nosession_err'), 'SV002',
  'serving_signup_create without a session raises SV002');
select is(current_setting('svrpc.dup_err'), 'no error',
  'duplicate attendee ids are not an error');
select is(current_setting('svrpc.dup_created'), 'true',
  'duplicate-attendee signup still created the signup');
select is(
  (select count(*) from public.serving_signup_attendees a
    join public.serving_signups s on s.id = a.signup_id
    where s.group_id = current_setting('svrpc.group_b')::uuid
      and s.service_date = current_setting('svrpc.sunday2')::date),
  1::bigint,
  'duplicate attendee ids collapse to one attendee row');

-- ── Atomicity: a mid-way attendee failure leaves ZERO rows (#313) ───────────
-- This zero is the whole point of the ticket: before the RPC, a failed
-- attendee insert plus a failed compensating delete left an orphan
-- serving_signups row that wedged the Sunday at 409 forever.

create or replace function pg_temp.svrpc_force_failure() returns trigger
language plpgsql as $$
begin
  raise exception 'forced attendee failure (svrpc suite)';
end $$;

create trigger svrpc_force_failure
  before insert on public.serving_signup_attendees
  for each row execute function pg_temp.svrpc_force_failure();

do $$
declare
  r record;
  forced_err text := 'no error';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('svrpc.owner_a'))::text, true);
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid,
      current_setting('svrpc.sunday3')::date,
      array[current_setting('svrpc.owner_a')::uuid]);
  exception when others then
    forced_err := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('svrpc.forced_err', forced_err, true);
end $$;

drop trigger svrpc_force_failure on public.serving_signup_attendees;

select isnt(current_setting('svrpc.forced_err'), 'no error',
  'the forced attendee failure surfaced as an error');
select is(
  (select count(*) from public.serving_signups
    where group_id = current_setting('svrpc.group_a')::uuid
      and service_date = current_setting('svrpc.sunday3')::date),
  0::bigint,
  'forced mid-way failure left ZERO signup rows — the Sunday stays claimable');
select is(
  (select count(*) from public.serving_signup_attendees a
    join public.serving_signups s on s.id = a.signup_id
    where s.group_id = current_setting('svrpc.group_a')::uuid
      and s.service_date = current_setting('svrpc.sunday3')::date),
  0::bigint,
  'forced mid-way failure left ZERO attendee rows');

-- The Sunday really is still claimable after the forced failure.
do $$
declare
  r record;
  retry_err text := 'no error';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('svrpc.owner_a'))::text, true);
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid,
      current_setting('svrpc.sunday3')::date,
      array[current_setting('svrpc.owner_a')::uuid]);
    perform set_config('svrpc.retry_created', r.created::text, true);
  exception when others then
    retry_err := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('svrpc.retry_err', retry_err, true);
end $$;

select is(current_setting('svrpc.retry_err'), 'no error',
  'retrying after the forced failure succeeds');
select is(current_setting('svrpc.retry_created'), 'true',
  'the retry claims the Sunday fresh (created = true)');

-- ── Additive re-signup, household acceptance, admin arm ─────────────────────
-- Everything above this line asserts a rejection. A suite made only of
-- rejection assertions cannot tell a correct implementation from one that
-- rejects everything: guarding the attendee insert with `if _created then`
-- (which breaks additive re-signup outright), rejecting every spouse, and
-- deleting the is_admin/is_group_leader arms each passed the suite as it
-- stood. These are the acceptance assertions that catch those.
do $$
declare
  org_a uuid := current_setting('svrpc.org_a')::uuid;
  fam uuid;
  spouse_a uuid := gen_random_uuid();
  admin_a uuid := gen_random_uuid();
begin
  insert into public.family_units (org_id, family_name) values (org_a, 'Serving RPC Household')
    returning id into fam;
  update public.profiles set family_id = fam, relationship = 'primary'
    where id = current_setting('svrpc.owner_a')::uuid;

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Spouse A', 'spouse-a@serving-rpc.example.test', 'approved'),
    (org_a, 'Admin A',  'admin-a@serving-rpc.example.test',  'approved');
  insert into auth.users (id, email) values
    (spouse_a, 'spouse-a@serving-rpc.example.test'),
    (admin_a,  'admin-a@serving-rpc.example.test');

  update public.profiles set family_id = fam, relationship = 'spouse' where id = spouse_a;
  update public.profiles set role = 'admin' where id = admin_a;

  perform set_config('svrpc.spouse_a', spouse_a::text, true);
  perform set_config('svrpc.admin_a', admin_a::text, true);
  perform set_config('svrpc.sunday4', (current_setting('svrpc.sunday1')::date + 21)::text, true);
  perform set_config('svrpc.sunday5', (current_setting('svrpc.sunday1')::date + 28)::text, true);
  perform set_config('svrpc.sunday6', (current_setting('svrpc.sunday1')::date + 35)::text, true);
end $$;

do $$
declare
  r record;
  solo_err text := 'no error'; add_err text := 'no error';
  spouse_err text := 'no error'; admin_err text := 'no error'; nullid_err text := 'no error';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('svrpc.owner_a'))::text, true);
  -- Sign up alone, then re-sign adding the spouse: the additive contract.
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid, current_setting('svrpc.sunday4')::date,
      array[current_setting('svrpc.owner_a')::uuid]);
  exception when others then solo_err := sqlstate; end;
  -- Seeded BEFORE the call, not only after it. If the RPC raises, the
  -- handler below records add_err but would leave this setting undefined,
  -- and the single-argument current_setting() that reads it further down
  -- then raises 42704 — aborting the whole suite instead of printing the
  -- FAIL line that says what actually broke.
  perform set_config('svrpc.add_created', 'unset', true);
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid, current_setting('svrpc.sunday4')::date,
      array[current_setting('svrpc.owner_a')::uuid, current_setting('svrpc.spouse_a')::uuid]);
    perform set_config('svrpc.add_created', r.created::text, true);
  exception when others then add_err := sqlstate; end;
  -- Spouse accepted on a first signup too.
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid, current_setting('svrpc.sunday5')::date,
      array[current_setting('svrpc.owner_a')::uuid, current_setting('svrpc.spouse_a')::uuid]);
  exception when others then spouse_err := sqlstate; end;
  reset role;

  -- An org admin who is NOT on the team may still sign up (is_admin arm).
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('svrpc.admin_a'))::text, true);
  begin
    select * into r from public.serving_signup_create(
      current_setting('svrpc.group_a')::uuid, current_setting('svrpc.sunday6')::date,
      array[current_setting('svrpc.admin_a')::uuid]);
  exception when others then admin_err := sqlstate; end;
  reset role;

  -- A NULL element in the attendee array must be rejected, not inserted. This
  -- is what pins count(*) over the DISTINCT subquery against a "simplification"
  -- to count(distinct ...), under which the NULL reaches the insert and the
  -- NOT NULL violation aborts the whole transaction as a 500.
  set local role service_role;
  begin
    select * into r from public.serving_signup_apply(
      current_setting('svrpc.group_b')::uuid, current_setting('svrpc.sunday6')::date,
      current_setting('svrpc.owner_b')::uuid,
      array[current_setting('svrpc.owner_b')::uuid, null]::uuid[]);
  exception when others then nullid_err := sqlstate; end;
  reset role;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('svrpc.solo_err', solo_err, true);
  perform set_config('svrpc.add_err', add_err, true);
  perform set_config('svrpc.spouse_err', spouse_err, true);
  perform set_config('svrpc.admin_err', admin_err, true);
  perform set_config('svrpc.nullid_err', nullid_err, true);
end $$;

-- ON CONFLICT ON CONSTRAINT binds by name, so a future composite-PK migration
-- would keep the name valid while silently changing dedup semantics.
select col_is_pk('public', 'serving_signup_attendees', array['signup_id', 'profile_id'],
  'serving_signup_attendees_pkey is (signup_id, profile_id) — the ON CONFLICT target');
select ok(has_function_privilege('service_role',
  'public.serving_signup_create(uuid,date,uuid[])', 'execute'),
  'service_role may execute serving_signup_create');

select is(current_setting('svrpc.solo_err'), 'no error',
  'additive: the initial solo signup succeeds');
select is(current_setting('svrpc.add_err'), 'no error',
  'additive: re-signing to add a spouse is not an error');
select is(current_setting('svrpc.add_created'), 'false',
  'additive: the re-signup reused the existing signup row (created = false)');
select is(
  (select count(*) from public.serving_signup_attendees a
    join public.serving_signups s on s.id = a.signup_id
    where s.group_id = current_setting('svrpc.group_a')::uuid
      and s.service_date = current_setting('svrpc.sunday4')::date),
  2::bigint,
  'additive: re-signup ADDED the spouse — two attendee rows on one signup');

select is(current_setting('svrpc.spouse_err'), 'no error',
  'household: a same-household spouse is an accepted attendee');
select is(
  (select count(*) from public.serving_signup_attendees a
    join public.serving_signups s on s.id = a.signup_id
    where s.group_id = current_setting('svrpc.group_a')::uuid
      and s.service_date = current_setting('svrpc.sunday5')::date),
  2::bigint,
  'household: both actor and spouse got attendee rows');

select is(current_setting('svrpc.admin_err'), 'no error',
  'authz: an org admin not on the team may sign up (is_admin arm)');
select is(current_setting('svrpc.nullid_err'), 'SV002',
  'a NULL element in the attendee array raises SV002');

select * from finish();
rollback;
