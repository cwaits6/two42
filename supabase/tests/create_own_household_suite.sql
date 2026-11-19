-- create_own_household(): a member with no household adds one during profile
-- setup. Pins the grant matrix, each refusal, that the org comes from the
-- caller's own profile, and what happens to a household its maker leaves.
--
-- Orgs are provisioned fresh; this suite never touches the seeded org.
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/create_own_household_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
  housed_a uuid := gen_random_uuid();
  pending_a uuid := gen_random_uuid();
  other_family uuid;
begin
  org_a := public.provision_organization('Own Household Org A', 'owner-a@own-household.example.test');
  org_b := public.provision_organization('Own Household Org B', 'owner-b@own-household.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Member A', 'member-a@own-household.example.test', 'approved'),
    (org_a, 'Housed A', 'housed-a@own-household.example.test', 'approved'),
    (org_a, 'Pending A', 'pending-a@own-household.example.test', 'approved');

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@own-household.example.test'),
    (owner_b, 'owner-b@own-household.example.test'),
    (member_a, 'member-a@own-household.example.test'),
    (housed_a, 'housed-a@own-household.example.test'),
    (pending_a, 'pending-a@own-household.example.test');

  update public.profiles set role = 'pending' where id = pending_a;

  insert into public.family_units (org_id, family_name)
    values (org_a, 'Existing Family') returning id into other_family;
  update public.profiles set family_id = other_family where id = housed_a;

  perform set_config('ownhh.org_a', org_a::text, true);
  perform set_config('ownhh.org_b', org_b::text, true);
  perform set_config('ownhh.owner_a', owner_a::text, true);
  perform set_config('ownhh.owner_b', owner_b::text, true);
  perform set_config('ownhh.member_a', member_a::text, true);
  perform set_config('ownhh.housed_a', housed_a::text, true);
  perform set_config('ownhh.pending_a', pending_a::text, true);
  perform set_config('ownhh.other_family', other_family::text, true);
end $$;

-- Runs create_own_household() as _sub and returns the SQLSTATE, or 'ok:<id>'.
create function pg_temp.create_as(_sub text, _name text) returns text
  language plpgsql as $$
declare
  _id uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _sub)::text, true);
  set local role authenticated;
  begin
    _id := public.create_own_household(_name);
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'ok:' || _id;
end $$;

-- ── Shape and grants ────────────────────────────────────────────────────────

select has_function('public', 'create_own_household', array['text'],
  'create_own_household(text) exists');
select is_definer('public', 'create_own_household', array['text'],
  'create_own_household is SECURITY DEFINER');
select ok(
  (select 'search_path=""' = any (proconfig) from pg_proc
    where oid = 'public.create_own_household(text)'::regprocedure),
  'create_own_household pins an empty search_path');
select ok(not has_function_privilege('anon', 'public.create_own_household(text)', 'execute'),
  'anon may not execute create_own_household');
select ok(has_function_privilege('authenticated', 'public.create_own_household(text)', 'execute'),
  'authenticated may execute create_own_household');
select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
     where p.oid = 'public.create_own_household(text)'::regprocedure
       and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC has no execute grant on create_own_household');

-- ── Refusals ────────────────────────────────────────────────────────────────

select is(pg_temp.create_as(current_setting('ownhh.pending_a'), 'Pending Family'), '42501',
  'a pending profile is refused');
select is(pg_temp.create_as(gen_random_uuid()::text, 'Nobody Family'), '42501',
  'a principal with no profile is refused');
select is(pg_temp.create_as(current_setting('ownhh.member_a'), '   '), '22023',
  'a blank name is refused');
select is(pg_temp.create_as(current_setting('ownhh.housed_a'), 'Second Family'), 'HH001',
  'a member already in a household is refused');
select is(
  (select family_id from public.profiles where id = current_setting('ownhh.housed_a')::uuid),
  current_setting('ownhh.other_family')::uuid,
  'the refused member stays in their household');

select throws_ok(
  $$ set local role anon; select public.create_own_household('Anon Family') $$,
  '42501', null,
  'anon is refused');
reset role;

select is(
  (select count(*)::int from public.family_units
    where org_id in (current_setting('ownhh.org_a')::uuid, current_setting('ownhh.org_b')::uuid)
      and family_name <> 'Existing Family'),
  0,
  'no refused call left a household behind');

-- ── A non-admin member adds their household ─────────────────────────────────

select matches(
  set_config('ownhh.created',
    pg_temp.create_as(current_setting('ownhh.member_a'), '  Member Family '), true),
  '^ok:', 'a member with no household can add one');
select set_config('ownhh.family', substr(current_setting('ownhh.created'), 4), true);

select is(
  (select family_id from public.profiles where id = current_setting('ownhh.member_a')::uuid),
  current_setting('ownhh.family')::uuid,
  'the member is in the household they added');
select is(
  (select family_name from public.family_units where id = current_setting('ownhh.family')::uuid),
  'Member Family',
  'the household carries the trimmed name');
select is(
  (select org_id from public.family_units where id = current_setting('ownhh.family')::uuid),
  current_setting('ownhh.org_a')::uuid,
  'the household takes the org of the caller''s profile');

-- The member can read it back through the family_units policy.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('ownhh.member_a'))::text, true);
set local role authenticated;
select is(
  (select family_name from public.family_units where id = current_setting('ownhh.family')::uuid),
  'Member Family',
  'the member can see the household they added');
reset role;

select is(pg_temp.create_as(current_setting('ownhh.member_a'), 'Member Family'), 'HH001',
  'adding a second household is refused');
select is(
  (select count(*)::int from public.family_units where org_id = current_setting('ownhh.org_a')::uuid),
  2,
  'the refused second call created nothing');

-- A church admin in another org gets a household in their own org.
select matches(
  set_config('ownhh.created_b',
    pg_temp.create_as(current_setting('ownhh.owner_b'), 'Owner Family'), true),
  '^ok:', 'a church admin with no household can add one');
select is(
  (select org_id from public.family_units
    where id = substr(current_setting('ownhh.created_b'), 4)::uuid),
  current_setting('ownhh.org_b')::uuid,
  'a second org''s caller gets a household in their own org');

-- ── Leaving the household they added ────────────────────────────────────────
-- Joining another household is a write to the member's own profile, as the
-- wizard's Finish makes it. The household they added then holds nobody, and
-- the directory and the household search both drop a household with no people.

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('ownhh.member_a'))::text, true);
set local role authenticated;
update public.profiles set family_id = current_setting('ownhh.other_family')::uuid
 where id = current_setting('ownhh.member_a')::uuid;
reset role;

select is(
  (select family_id from public.profiles where id = current_setting('ownhh.member_a')::uuid),
  current_setting('ownhh.other_family')::uuid,
  'the member ends up in the household they joined');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('ownhh.owner_a'))::text, true);
set local role authenticated;
select is(
  (select members from public.families_directory_full where id = current_setting('ownhh.family')::uuid),
  '[]'::jsonb,
  'the household they left lists no people in the directory');
select is(
  (select family_members_list from public.families_directory_full where id = current_setting('ownhh.family')::uuid),
  '[]'::jsonb,
  'the household they left lists no people without an account');
reset role;

select * from finish();
rollback;
