-- Household unlisted suite: a household whose people with an account have all
-- left the directory leaves it too, with everyone listed in it.
--
-- Proves, by exact keys and counts, that such a household is gone from the
-- family_units policy, family_directory_people() and families_directory_full
-- for a member in either directory scope; that one listed adult, or no one with
-- an account, keeps it; that its own people and a church admin still read the
-- row; and that the hidden set never crosses churches.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/household_unlisted_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.new_person(_org uuid, _email text, _role text, _family uuid, _unlisted boolean)
  returns uuid language plpgsql as $$
declare _id uuid := gen_random_uuid();
begin
  insert into public.access_requests (org_id, name, email, status, approved_role, reviewed_at)
    values (_org, _email, _email, 'approved', 'member', now());
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', _email,
            'x', jsonb_build_object('org_id', _org), '{}', now(), now());
  update public.profiles set role = _role, family_id = _family, is_unlisted = _unlisted where id = _id;
  return _id;
end $$;

create temp table fx (key text primary key, id uuid) on commit drop;
grant select on fx to authenticated;

create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;

create function pg_temp.sign_in(_viewer text) returns void language plpgsql as $$
begin
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(_viewer), 'role', 'authenticated')::text, true);
end $$;

-- The households a viewer reads, by fixture key, through one surface:
-- 'policy' (family_units), 'people' (family_directory_people() returns anyone)
-- or 'view' (families_directory_full).
create function pg_temp.seen(_viewer text, _surface text) returns text language plpgsql as $$
declare _seen text;
begin
  perform pg_temp.sign_in(_viewer);
  set local role authenticated;
  if _surface = 'policy' then
    select string_agg(x.key, ',' order by x.key) into _seen
      from fx x join public.family_units f on f.id = x.id where x.key like 'h\_%';
  elsif _surface = 'people' then
    select string_agg(x.key, ',' order by x.key) into _seen
      from fx x where x.key like 'h\_%' and public.family_directory_people(x.id) <> '[]'::jsonb;
  else
    select string_agg(x.key, ',' order by x.key) into _seen
      from fx x join public.families_directory_full f on f.id = x.id where x.key like 'h\_%';
  end if;
  reset role;
  return coalesce(_seen, '');
end $$;

create function pg_temp.hidden_ids(_viewer text) returns text language plpgsql as $$
declare _seen text;
begin
  perform pg_temp.sign_in(_viewer);
  set local role authenticated;
  select string_agg(x.key, ',' order by x.key) into _seen
    from fx x where x.id = any (public.unlisted_household_ids());
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
    (_org, 'Household Unlisted Church', 'shared_groups'),
    (_other, 'Household Unlisted Other', 'shared_groups');
  insert into fx values ('org', _org), ('other_org', _other),
    ('h_hidden', gen_random_uuid()), ('h_half', gen_random_uuid()),
    ('h_noaccount', gen_random_uuid()), ('h_viewer', gen_random_uuid()),
    ('h_admin', gen_random_uuid()), ('h_moved', gen_random_uuid()),
    ('h_b_hidden', gen_random_uuid()), ('h_b_member', gen_random_uuid());
  insert into public.family_units (id, org_id, family_name)
  select x.id, case when x.key like 'h\_b\_%' then _other else _org end, x.key
    from fx x where x.key like 'h\_%';
end $$;

insert into fx values
  ('viewer', pg_temp.new_person(pg_temp.fx('org'), 'viewer@household-unlisted.test', 'member', pg_temp.fx('h_viewer'), false)),
  ('hid1', pg_temp.new_person(pg_temp.fx('org'), 'hid1@household-unlisted.test', 'member', pg_temp.fx('h_hidden'), true)),
  ('hid2', pg_temp.new_person(pg_temp.fx('org'), 'hid2@household-unlisted.test', 'member', pg_temp.fx('h_hidden'), true)),
  ('half_u', pg_temp.new_person(pg_temp.fx('org'), 'half-u@household-unlisted.test', 'member', pg_temp.fx('h_half'), true)),
  ('half_l', pg_temp.new_person(pg_temp.fx('org'), 'half-l@household-unlisted.test', 'member', pg_temp.fx('h_half'), false)),
  ('mover', pg_temp.new_person(pg_temp.fx('org'), 'mover@household-unlisted.test', 'member', pg_temp.fx('h_moved'), true)),
  ('admin', pg_temp.new_person(pg_temp.fx('org'), 'admin@household-unlisted.test', 'admin', pg_temp.fx('h_admin'), false)),
  ('b_hidden', pg_temp.new_person(pg_temp.fx('other_org'), 'b-hidden@household-unlisted.test', 'member', pg_temp.fx('h_b_hidden'), true)),
  ('b_member', pg_temp.new_person(pg_temp.fx('other_org'), 'b-member@household-unlisted.test', 'member', pg_temp.fx('h_b_member'), false));

-- After the people: someone who joins a church with one group is added to it.
insert into fx values ('group', gen_random_uuid());
insert into public.groups (id, org_id, name) values (pg_temp.fx('group'), pg_temp.fx('org'), 'Household Unlisted Group');
insert into public.group_members (org_id, group_id, profile_id, role)
select pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx(k), 'member'
from unnest(array['viewer', 'hid1', 'hid2', 'half_u', 'half_l', 'mover']) k;

-- A child with no account in every household, so family_directory_people()
-- has a row to gate.
insert into public.family_members (org_id, family_id, first_name, last_name, relationship)
select u.org_id, u.id, 'Child', u.family_name, 'child'
from fx x join public.family_units u on u.id = x.id
where x.key like 'h\_%';

-- ── The hidden set ──────────────────────────────────────────────────────────
select is(pg_temp.hidden_ids('viewer'), 'h_hidden,h_moved',
  'the hidden set is exactly the households whose people with an account are all unlisted');
select is(pg_temp.hidden_ids('b_member'), 'h_b_hidden',
  'another church''s hidden set holds only its own household');

-- ── A member, directory limited to shared groups ────────────────────────────
select is(pg_temp.seen('viewer', 'policy'), 'h_half,h_viewer',
  'a member does not see a household whose adults all left the directory, and sees one with a listed adult');
select is(pg_temp.seen('viewer', 'people'), 'h_half,h_viewer',
  'family_directory_people() returns no one for a hidden household');
select is(pg_temp.seen('viewer', 'view'), 'h_half,h_viewer',
  'the directory view leaves out a hidden household');
select pg_temp.sign_in('viewer');
set local role authenticated;
select is(public.family_directory_people(pg_temp.fx('h_hidden')), '[]'::jsonb,
  'a hidden household''s child is not returned to a member who shares a group with its adults');
reset role;

-- ── A member, directory open to the whole church ────────────────────────────
update public.organizations set directory_visibility = 'org' where id = pg_temp.fx('org');

select is(pg_temp.seen('viewer', 'policy'), 'h_admin,h_half,h_noaccount,h_viewer',
  'with the directory open, a member sees every household but the hidden ones');
select is(pg_temp.seen('viewer', 'people'), 'h_admin,h_half,h_noaccount,h_viewer',
  'family_directory_people() agrees with the directory open');
select is(pg_temp.seen('viewer', 'view'), 'h_admin,h_half,h_noaccount,h_viewer',
  'the directory view agrees with the directory open');

select pg_temp.sign_in('viewer');
set local role authenticated;
select is(
  (select jsonb_array_length(family_members_list) from public.families_directory_full
    where id = pg_temp.fx('h_noaccount')),
  1, 'a household with no one with an account still lists its child');
select is(
  (select jsonb_array_length(members) from public.families_directory_full
    where id = pg_temp.fx('h_half')),
  1, 'a household with one listed adult shows that adult only');
select is(
  (select (members -> 0 ->> 'id')::uuid from public.families_directory_full
    where id = pg_temp.fx('h_half')),
  pg_temp.fx('half_l'), 'the adult shown is the listed one');
select is(
  (select count(*) from public.family_units where id = pg_temp.fx('h_b_hidden') or id = pg_temp.fx('h_b_member')),
  0::bigint, 'an open directory shows nothing from another church');
reset role;

-- ── The hidden household's own people ───────────────────────────────────────
select is(pg_temp.seen('hid1', 'policy'), 'h_admin,h_half,h_hidden,h_noaccount,h_viewer',
  'someone who left the directory still reads their own household');
select pg_temp.sign_in('hid1');
set local role authenticated;
select is(
  (select count(*) from public.family_members where family_id = pg_temp.fx('h_hidden')),
  1::bigint, 'someone who left the directory still reads the people in their own household');
reset role;
select is(pg_temp.seen('hid1', 'view'), 'h_admin,h_half,h_noaccount,h_viewer',
  'the directory view leaves their own hidden household out, as it leaves them out');

-- ── A church admin ──────────────────────────────────────────────────────────
select is(pg_temp.seen('admin', 'policy'), 'h_admin,h_half,h_hidden,h_moved,h_noaccount,h_viewer',
  'a church admin still reads a hidden household');
select pg_temp.sign_in('admin');
set local role authenticated;
select is(
  (select count(*) from public.family_members where family_id = pg_temp.fx('h_hidden')),
  1::bigint, 'a church admin still reads the people in a hidden household');
select is(
  (select count(*) from public.family_units where id = pg_temp.fx('h_b_hidden')),
  0::bigint, 'a church admin reads no household in another church');
reset role;
select is(pg_temp.seen('admin', 'view'), 'h_admin,h_half,h_noaccount,h_viewer',
  'the directory view leaves a hidden household out for a church admin too');

-- ── Another church ──────────────────────────────────────────────────────────
update public.organizations set directory_visibility = 'org' where id = pg_temp.fx('other_org');
select is(pg_temp.seen('b_member', 'policy'), 'h_b_member',
  'a member of another church sees neither church''s hidden household nor any of the first church''s');
select is(pg_temp.seen('b_member', 'view'), 'h_b_member',
  'the directory view agrees for a member of another church');

-- ── Changes that bring a household back ─────────────────────────────────────
update public.profiles set is_unlisted = false where id = pg_temp.fx('hid2');
select is(pg_temp.seen('viewer', 'view'), 'h_admin,h_half,h_hidden,h_noaccount,h_viewer',
  'one adult rejoining the directory brings the household back');
select is(pg_temp.seen('viewer', 'policy'), 'h_admin,h_half,h_hidden,h_noaccount,h_viewer',
  'the policy agrees once an adult rejoins');

update public.profiles set family_id = pg_temp.fx('h_hidden') where id = pg_temp.fx('mover');
select is(pg_temp.seen('viewer', 'view'), 'h_admin,h_half,h_hidden,h_moved,h_noaccount,h_viewer',
  'a household whose only person with an account moved out shows as one with no account holder');

-- ── Structure and privileges ────────────────────────────────────────────────
select ok(has_function_privilege('authenticated', 'public.unlisted_household_ids()', 'execute'),
  'a signed-in person can call unlisted_household_ids()');
select ok(not has_function_privilege('anon', 'public.unlisted_household_ids()', 'execute'),
  'anon can''t call unlisted_household_ids()');
select ok((select prosecdef from pg_proc where oid = 'public.unlisted_household_ids()'::regprocedure),
  'unlisted_household_ids() is SECURITY DEFINER, since other members can''t read unlisted profiles');
select is((select proconfig from pg_proc where oid = 'public.unlisted_household_ids()'::regprocedure),
  array['search_path=""'], 'unlisted_household_ids() pins an empty search_path');
select ok(not (select prosecdef from pg_proc
                where oid = 'public.household_visible(uuid, boolean, boolean, uuid, boolean, uuid[])'::regprocedure),
  'household_visible() runs as its caller');
select is((select proconfig from pg_proc
            where oid = 'public.household_visible(uuid, boolean, boolean, uuid, boolean, uuid[])'::regprocedure),
  null, 'household_visible() has no SET clause, so the policy inlines it');
select is(to_regprocedure('public.household_visible(uuid, boolean, boolean, uuid, boolean)'), null,
  'no form of household_visible() without the hidden households remains');
select ok(
  (select qual ~ 'SELECT unlisted_household_ids\(\)'
     from pg_policies
    where schemaname = 'public' and tablename = 'family_units'
      and policyname = 'Members can view family units'),
  'the family_units policy passes the hidden households, wrapped in a subselect');
select ok(pg_get_viewdef('public.families_directory_full'::regclass) ~ 'unlisted_household_ids\(\)',
  'families_directory_full leaves out the hidden households');
select ok((select prosrc ~ 'public\.unlisted_household_ids\(\)' from pg_proc
            where oid = 'public.family_directory_people(uuid)'::regprocedure),
  'family_directory_people() passes the hidden households');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~ 'is_unlisted' and p.prosrc ~ 'bool_and'),
  1::bigint, 'only unlisted_household_ids() states which households are hidden');

select * from finish();
rollback;
