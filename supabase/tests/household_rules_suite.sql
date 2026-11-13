-- Household rules suite: who can see a household, and who is a child without an
-- account, are each stated once.
--
-- The family_units policy and family_directory_people() both read
-- household_visible(), and this proves they agree for every viewer and household
-- below, by exact counts. is_child_without_account() is checked against the case
-- table between the marker lines, which lib/household.test.ts also reads, so the
-- SQL and app rules can't drift apart unnoticed.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/household_rules_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.new_person(_org uuid, _email text, _role text, _family uuid) returns uuid
  language plpgsql as $$
declare _id uuid := gen_random_uuid();
begin
  insert into public.access_requests (org_id, name, email, status, approved_role, reviewed_at)
    values (_org, _email, _email, 'approved', 'member', now());
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', _email,
            'x', jsonb_build_object('org_id', _org), '{}', now(), now());
  update public.profiles set role = _role, family_id = _family where id = _id;
  return _id;
end $$;

create temp table fx (key text primary key, id uuid) on commit drop;
grant select on fx to authenticated;

create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;

-- The households a viewer can see, by fixture key, through the policy.
create function pg_temp.by_policy(_viewer text) returns text language plpgsql as $$
declare _seen text;
begin
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(_viewer), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select string_agg(x.key, ',' order by x.key) into _seen
    from fx x join public.family_units f on f.id = x.id
   where x.key like 'h%';
  reset role;
  return coalesce(_seen, '');
end $$;

-- The same, through family_directory_people(), which anyone signed in can call
-- on any household id.
create function pg_temp.by_function(_viewer text) returns text language plpgsql as $$
declare _seen text;
begin
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(_viewer), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select string_agg(x.key, ',' order by x.key) into _seen
    from fx x
   where x.key like 'h%'
     and public.family_directory_people(x.id) <> '[]'::jsonb;
  reset role;
  return coalesce(_seen, '');
end $$;

-- ── Fixture: two churches ───────────────────────────────────────────────────
do $$
declare
  _org uuid := gen_random_uuid();
  _other uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name, directory_visibility) values
    (_org, 'Household Rules Church', 'shared_groups'),
    (_other, 'Household Rules Other', 'shared_groups');
  insert into public.family_units (id, org_id, family_name) values
    (gen_random_uuid(), _org, 'Own'), (gen_random_uuid(), _org, 'Shared'),
    (gen_random_uuid(), _org, 'Apart'), (gen_random_uuid(), _org, 'Admin'),
    (gen_random_uuid(), _other, 'Elsewhere');
  insert into fx
    select 'h1_own', id from public.family_units where org_id = _org and family_name = 'Own'
    union all select 'h2_shared', id from public.family_units where org_id = _org and family_name = 'Shared'
    union all select 'h3_apart', id from public.family_units where org_id = _org and family_name = 'Apart'
    union all select 'h4_admin', id from public.family_units where org_id = _org and family_name = 'Admin'
    union all select 'h5_other', id from public.family_units where org_id = _other and family_name = 'Elsewhere';
  insert into fx values ('org', _org), ('other_org', _other);
end $$;

insert into fx values
  ('viewer', pg_temp.new_person(pg_temp.fx('org'), 'viewer@household-rules.test', 'member', pg_temp.fx('h1_own'))),
  ('sharer', pg_temp.new_person(pg_temp.fx('org'), 'sharer@household-rules.test', 'member', pg_temp.fx('h2_shared'))),
  ('apart', pg_temp.new_person(pg_temp.fx('org'), 'apart@household-rules.test', 'member', pg_temp.fx('h3_apart'))),
  ('admin', pg_temp.new_person(pg_temp.fx('org'), 'admin@household-rules.test', 'admin', pg_temp.fx('h4_admin'))),
  ('elsewhere', pg_temp.new_person(pg_temp.fx('other_org'), 'elsewhere@household-rules.test', 'member', pg_temp.fx('h5_other')));

-- After the people: someone who joins a church with one group is added to it.
insert into fx values ('group', gen_random_uuid());
insert into public.groups (id, org_id, name) values (pg_temp.fx('group'), pg_temp.fx('org'), 'Household Rules Group');
insert into public.group_members (org_id, group_id, profile_id, role)
select pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx(k), 'member'
from unnest(array['viewer', 'sharer']) k;

insert into public.family_members (org_id, family_id, first_name, last_name, relationship)
select u.org_id, u.id, 'Listed', u.family_name, 'primary'
from fx f
join public.family_units u on u.id = f.id
where f.key like 'h%';

select is((select count(*) from public.family_members m join fx f on f.id = m.family_id where f.key like 'h%'),
  5::bigint, 'every household lists someone, so the function has a row to gate');

-- ── The policy and the function agree for each viewer ───────────────────────
select is(pg_temp.by_policy('viewer'), 'h1_own,h2_shared',
  'a member sees their own household and one that shares a group, and not one that doesn''t');
select is(pg_temp.by_function('viewer'), pg_temp.by_policy('viewer'),
  'family_directory_people() returns people for exactly the households the policy shows a member');

select is(pg_temp.by_policy('admin'), 'h1_own,h2_shared,h3_apart,h4_admin',
  'a church admin sees every household in their church and none in another');
select is(pg_temp.by_function('admin'), pg_temp.by_policy('admin'),
  'family_directory_people() agrees for a church admin');

select is(pg_temp.by_policy('elsewhere'), 'h5_other',
  'someone in another church sees only their own church''s household');
select is(pg_temp.by_function('elsewhere'), pg_temp.by_policy('elsewhere'),
  'family_directory_people() agrees for someone in another church');

select is(pg_temp.by_policy('apart'), 'h3_apart',
  'a member who shares no group sees only their own household');
select is(pg_temp.by_function('apart'), pg_temp.by_policy('apart'),
  'family_directory_people() agrees for a member who shares no group');

update public.organizations set directory_visibility = 'org' where id = pg_temp.fx('org');

select is(pg_temp.by_policy('viewer'), 'h1_own,h2_shared,h3_apart,h4_admin',
  'with the directory open, a member sees every household in their church');
select is(pg_temp.by_function('viewer'), pg_temp.by_policy('viewer'),
  'family_directory_people() agrees with the directory open');
select is(pg_temp.by_policy('elsewhere'), 'h5_other',
  'an open directory in one church shows nothing to another');
select is(pg_temp.by_function('elsewhere'), pg_temp.by_policy('elsewhere'),
  'family_directory_people() agrees for another church with the directory open');

update public.profiles set role = 'pending' where id = pg_temp.fx('viewer');
select is(pg_temp.by_policy('viewer'), '',
  'someone waiting for approval sees no household, not even their own');
select is(pg_temp.by_function('viewer'), pg_temp.by_policy('viewer'),
  'family_directory_people() agrees for someone waiting for approval');

-- ── Each rule is written once ───────────────────────────────────────────────
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~ '''child'''
      and p.proname <> 'is_child_without_account'),
  0::bigint, 'no function but is_child_without_account() spells out the child rule');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and (qual ~ '''child''' or with_check ~ '''child''')),
  0::bigint, 'no policy spells out the child rule');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~ 'shares_group_with_household\('
      and p.proname not in ('household_visible', 'shares_group_with_household')),
  0::bigint, 'no function but household_visible() checks for a shared group with a household');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and qual ~ 'shares_group_with_household'),
  0::bigint, 'no policy checks for a shared group with a household itself');
select ok(
  (select qual ~ '\( SELECT household_visible\(family_units\.id'
     from pg_policies
    where schemaname = 'public' and tablename = 'family_units'
      and policyname = 'Members can view family units'),
  'the family_units policy reads household_visible(), wrapped in a subselect');
select ok(
  (select prosrc ~ 'public\.household_visible\(' from pg_proc
    where oid = 'public.family_directory_people(uuid)'::regprocedure),
  'family_directory_people() reads household_visible()');

-- ── Neither helper gains privileges ─────────────────────────────────────────
select ok(not (select prosecdef from pg_proc where oid = 'public.household_visible(uuid, boolean, boolean, uuid, boolean)'::regprocedure),
  'household_visible() runs as its caller');
select ok(not (select prosecdef from pg_proc where oid = 'public.is_child_without_account(text, uuid)'::regprocedure),
  'is_child_without_account() runs as its caller');
-- A SET clause would stop Postgres inlining household_visible() into the policy.
select is((select proconfig from pg_proc where oid = 'public.household_visible(uuid, boolean, boolean, uuid, boolean)'::regprocedure),
  null, 'household_visible() has no SET clause, so the policy inlines it');
select ok(not has_function_privilege('anon', 'public.household_visible(uuid, boolean, boolean, uuid, boolean)', 'execute'),
  'anon can''t call household_visible()');
select ok(has_function_privilege('authenticated', 'public.household_visible(uuid, boolean, boolean, uuid, boolean)', 'execute'),
  'a signed-in member can, as the policy needs');
select ok(not has_function_privilege('anon', 'public.is_child_without_account(text, uuid)', 'execute'),
  'anon can''t call is_child_without_account()');
select ok(has_function_privilege('authenticated', 'public.is_child_without_account(text, uuid)', 'execute'),
  'a signed-in member can, as the family_members trigger runs as them');
select ok(has_function_privilege('service_role', 'public.is_child_without_account(text, uuid)', 'execute'),
  'the service role can, as its family_members writes run the trigger too');

-- ── The child rule, case by case ────────────────────────────────────────────
-- lib/household.test.ts parses the rows between the marker lines: one
-- (relationship, claimed_profile_id, expected) per line.
create temp table child_cases (relationship text, claimed_profile_id uuid, expected boolean) on commit drop;
insert into child_cases values
-- child rule cases: begin
  ('primary', null, false),
  ('primary', '00000000-0000-0000-0000-0000000000c1', false),
  ('spouse', null, false),
  ('spouse', '00000000-0000-0000-0000-0000000000c1', false),
  ('child', null, true),
  ('child', '00000000-0000-0000-0000-0000000000c1', false),
  ('parent', null, false),
  ('parent', '00000000-0000-0000-0000-0000000000c1', false),
  ('sibling', null, false),
  ('sibling', '00000000-0000-0000-0000-0000000000c1', false),
  ('other', null, false),
  ('other', '00000000-0000-0000-0000-0000000000c1', false),
  (null, null, false)
-- child rule cases: end
;

select is(public.is_child_without_account(c.relationship, c.claimed_profile_id), c.expected,
  format('is_child_without_account(%s, %s)', coalesce(c.relationship, 'null'),
    case when c.claimed_profile_id is null then 'no account' else 'an account' end))
from child_cases c;

select set_eq(
  $$select (regexp_matches(pg_get_constraintdef(c.oid), '''(\w+)''', 'g'))[1]
    from pg_constraint c
    where c.conrelid = 'public.family_members'::regclass and c.conname = 'family_members_relationship_check'$$,
  $$select relationship from child_cases where relationship is not null
    group by relationship
    having bool_or(claimed_profile_id is null) and bool_or(claimed_profile_id is not null)$$,
  'every relationship family_members allows is checked with and without an account');

select * from finish();
rollback;
