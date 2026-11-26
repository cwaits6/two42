-- Gender, title and suffix on profiles, and a child's graduation year on
-- family_members: the checks each column refuses, the column grants, the read
-- paths that carry them, and that a child's grade reaches only someone who
-- can already see the household.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/profile_fields_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

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

-- 'ok' for a write that ran, else the SQLSTATE it raised.
create function pg_temp.writes(_query text) returns text
  language plpgsql as $$
begin
  execute _query;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

create function pg_temp.id(_name text) returns uuid
  language sql as $$ select current_setting('pf.' || _name)::uuid $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
do $$
declare
  org_a uuid; org_b uuid;
  owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid();
  parent uuid := gen_random_uuid(); sharer uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid(); b_member uuid := gen_random_uuid();
  grp uuid; fam uuid; kid uuid;
begin
  org_a := public.provision_organization('Profile Fields Org A', 'owner-a@profile-fields.example.test');
  org_b := public.provision_organization('Profile Fields Org B', 'owner-b@profile-fields.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Parent', 'parent@profile-fields.example.test', 'approved'),
    (org_a, 'Sharer', 'sharer@profile-fields.example.test', 'approved'),
    (org_a, 'Outsider', 'outsider@profile-fields.example.test', 'approved'),
    (org_b, 'B Member', 'b-member@profile-fields.example.test', 'approved');

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@profile-fields.example.test'),
    (owner_b, 'owner-b@profile-fields.example.test'),
    (parent, 'parent@profile-fields.example.test'),
    (sharer, 'sharer@profile-fields.example.test'),
    (outsider, 'outsider@profile-fields.example.test'),
    (b_member, 'b-member@profile-fields.example.test');

  insert into public.family_units (org_id, family_name) values (org_a, 'Fieldton') returning id into fam;
  update public.profiles
     set family_id = fam, relationship = 'primary', first_name = 'Bill', last_name = 'Fieldton',
         gender = 'male', title = 'Dr.', suffix = 'Jr.'
   where id = parent;

  insert into public.groups (org_id, name) values (org_a, 'Shared') returning id into grp;
  delete from public.group_members where org_id = org_a;
  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org_a, grp, parent, 'member'),
    (org_a, grp, sharer, 'member');

  -- A birth year on a child without an account is cleared by its trigger.
  insert into public.family_members (org_id, family_id, first_name, relationship, birth_year, graduation_year)
    values (org_a, fam, 'Kit', 'child', 2016, 2035) returning id into kid;

  perform set_config('pf.org_a', org_a::text, true);
  perform set_config('pf.parent', parent::text, true);
  perform set_config('pf.sharer', sharer::text, true);
  perform set_config('pf.outsider', outsider::text, true);
  perform set_config('pf.b_member', b_member::text, true);
  perform set_config('pf.fam', fam::text, true);
  perform set_config('pf.kid', kid::text, true);
  perform set_config('pf.grp', grp::text, true);
end $$;

update public.organizations set directory_visibility = 'shared_groups' where id = pg_temp.id('org_a');

-- ── The checks ──────────────────────────────────────────────────────────────
select is(pg_temp.writes(format($q$update public.profiles set gender = 'other' where id = %L$q$, pg_temp.id('parent'))),
  '23514', 'gender is male or female only');
select is(pg_temp.writes(format($q$update public.profiles set gender = 'female' where id = %L$q$, pg_temp.id('sharer'))),
  'ok', 'gender takes female');
select is(pg_temp.writes(format($q$update public.profiles set gender = null where id = %L$q$, pg_temp.id('sharer'))),
  'ok', 'gender clears to null');
select is(pg_temp.writes(format($q$update public.profiles set title = %L where id = %L$q$, repeat('t', 41), pg_temp.id('sharer'))),
  '23514', 'a title is 40 characters or fewer');
select is(pg_temp.writes(format($q$update public.profiles set title = %L where id = %L$q$, repeat('t', 40), pg_temp.id('sharer'))),
  'ok', 'a title of 40 characters is kept');
select is(pg_temp.writes(format($q$update public.profiles set title = '' where id = %L$q$, pg_temp.id('sharer'))),
  '23514', 'an empty title is null, not empty text');
select is(pg_temp.writes(format($q$update public.profiles set title = ' Dr.' where id = %L$q$, pg_temp.id('sharer'))),
  '23514', 'a title is stored trimmed');
select is(pg_temp.writes(format($q$update public.profiles set suffix = %L where id = %L$q$, repeat('s', 21), pg_temp.id('sharer'))),
  '23514', 'a suffix is 20 characters or fewer');
select is(pg_temp.writes(format($q$update public.profiles set suffix = 'III ' where id = %L$q$, pg_temp.id('sharer'))),
  '23514', 'a suffix is stored trimmed');
select is(pg_temp.writes(format($q$update public.profiles set suffix = 'III' where id = %L$q$, pg_temp.id('sharer'))),
  'ok', 'a suffix is kept');
select is(pg_temp.writes(format($q$update public.family_members set graduation_year = 1999 where id = %L$q$, pg_temp.id('kid'))),
  '23514', 'a graduation year is 2000 or later');
select is(pg_temp.writes(format($q$update public.family_members set graduation_year = 2101 where id = %L$q$, pg_temp.id('kid'))),
  '23514', 'a graduation year is 2100 or earlier');

select is(
  (select concat_ws('|', coalesce(birth_year::text, '-'), graduation_year::text) from public.family_members where id = pg_temp.id('kid')),
  '-|2035', 'a child without an account keeps a graduation year and never a birth year');

-- ── Grants ──────────────────────────────────────────────────────────────────
select ok(has_column_privilege('authenticated', 'public.profiles', c, 'select'), 'authenticated reads profiles.' || c)
from unnest(array['gender', 'title', 'suffix']) c;
select ok(not has_column_privilege('authenticated', 'public.profiles', 'email', 'select'),
  'profiles.email stays without a column grant');

-- ── Read paths ──────────────────────────────────────────────────────────────
select hasnt_column('public', 'profiles_directory', 'title', 'the directory never carries a title');
select hasnt_column('public', 'families_directory_full', 'graduation_year', 'the grade is inside the household people, not a column');
select is(
  pg_temp.as_text(pg_temp.id('sharer'), format(
    $q$select concat_ws('|', suffix, gender) from public.profiles_directory where id = %L$q$, pg_temp.id('parent'))),
  'Jr.|male', 'a member sharing a group reads the suffix and gender from the directory');
select is(
  pg_temp.as_text(pg_temp.id('sharer'), format(
    $q$select m->>'suffix' from public.families_directory_full f, jsonb_array_elements(f.members) m
        where f.id = %L and m->>'id' = %L$q$, pg_temp.id('fam'), pg_temp.id('parent'))),
  'Jr.', 'the household''s people with an account carry their suffix');
select has_column('public', 'prayer_wall', 'suffix', 'prayer_wall carries the author''s suffix');
select is(
  (select pg_get_function_result('public.pending_group_join_requests(uuid)'::regprocedure)),
  'TABLE(id uuid, created_at timestamp with time zone, first_name text, last_name text, preferred_name text, email text, suffix text)',
  'pending_group_join_requests() adds only the suffix, last');
select ok(not has_function_privilege('anon', 'public.pending_group_join_requests(uuid)', 'execute'),
  'anon still cannot run pending_group_join_requests()');
select ok(has_function_privilege('authenticated', 'public.pending_group_join_requests(uuid)', 'execute'),
  'authenticated still runs pending_group_join_requests()');
select is_definer('public', 'pending_group_join_requests', array['uuid'], 'pending_group_join_requests() stays SECURITY DEFINER');

-- ── A child's grade reaches only someone who can see the household ──────────
select is(
  pg_temp.as_text(pg_temp.id('sharer'), format(
    $q$select p->>'graduation_year' from public.families_directory_full f, jsonb_array_elements(f.family_members_list) p
        where f.id = %L and p->>'id' = %L$q$, pg_temp.id('fam'), pg_temp.id('kid'))),
  '2035', 'a member sharing a group reads the child''s graduation year');
select is(
  pg_temp.as_text(pg_temp.id('outsider'), format(
    'select count(*)::text from public.families_directory_full where id = %L', pg_temp.id('fam'))),
  '0', 'a member of the church sharing no group gets no household row');
select is(
  pg_temp.as_text(pg_temp.id('outsider'), format(
    'select public.family_directory_people(%L)::text', pg_temp.id('fam'))),
  '[]', 'a direct call gives them none of the household''s people');
select is(
  pg_temp.as_text(pg_temp.id('outsider'), format(
    'select count(*)::text from public.family_members where id = %L', pg_temp.id('kid'))),
  '0', 'nor does the table');
select is(
  pg_temp.as_text(pg_temp.id('b_member'), format(
    'select public.family_directory_people(%L)::text', pg_temp.id('fam'))),
  '[]', 'another church''s member gets none of them');

select * from finish();
rollback;
