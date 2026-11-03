-- Children in the directory: what a parent enters is what shows.
--
-- Proves the sweep clears a child's stored birth year and removes invites on a
-- child without an account, and nothing else, by exact row counts. Then the
-- trigger that keeps the year off, what another member can read directly and
-- through the directory, what a parent and a church admin keep, and the refusal
-- of an invite on every path that can write one.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/children_directory_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- The sweep clears every org on the stack, so whatever a stack already holds is
-- cleared first and the counts below only see these fixtures.
do $$ begin
  perform public.family_members_retire_child_details();
end $$;

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

-- 'rows=N' for a write that ran, else the SQLSTATE it raised.
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

create function pg_temp.as_role_write(_role text, _query text) returns text
  language plpgsql as $$
declare _n bigint;
begin
  perform set_config('request.jwt.claims', '', true);
  execute format('set local role %I', _role);
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

create function pg_temp.id(_name text) returns uuid
  language sql as $$ select current_setting('cd.' || _name)::uuid $$;

create function pg_temp.fm(_name text) returns text
  language sql as $$
  select concat_ws('|', fm.first_name, coalesce(fm.preferred_name, '-'), fm.relationship,
    coalesce(fm.birth_month::text, '-'), coalesce(fm.birth_day::text, '-'), coalesce(fm.birth_year::text, '-'),
    coalesce(fm.avatar_url, '-'))
  from public.family_members fm where fm.id = current_setting('cd.' || _name)::uuid;
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Both triggers are off while the rows they would refuse are built, because the
-- sweep has to find what the old app could have stored.
alter table public.family_members disable trigger family_members_clear_child_year;
alter table public.family_invites disable trigger family_invites_refuse_child;

do $$
declare
  org_a uuid; org_b uuid;
  owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid();
  parent uuid := gen_random_uuid(); spouse uuid := gen_random_uuid();
  grown uuid := gen_random_uuid(); sharer uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid(); elsewhere uuid := gen_random_uuid();
  linked_pending uuid := gen_random_uuid(); b_primary uuid := gen_random_uuid();
  grp uuid; fam uuid; fam_else uuid; fam_b uuid;
  kid uuid; kid_accepted uuid; kid_else uuid; kid_b uuid; claimed_child uuid;
  fm_spouse uuid; fm_parent uuid; fm_sibling uuid; fm_other uuid;
  tok_open uuid; tok_accepted uuid; tok_other uuid; tok_denied uuid;
begin
  org_a := public.provision_organization('Children Directory Org A', 'owner-a@children-directory.example.test');
  org_b := public.provision_organization('Children Directory Org B', 'owner-b@children-directory.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Parent', 'parent@children-directory.example.test', 'approved'),
    (org_a, 'Spouse', 'spouse@children-directory.example.test', 'approved'),
    (org_a, 'Grown', 'grown@children-directory.example.test', 'approved'),
    (org_a, 'Sharer', 'sharer@children-directory.example.test', 'approved'),
    (org_a, 'Outsider', 'outsider@children-directory.example.test', 'approved'),
    (org_a, 'Elsewhere', 'elsewhere@children-directory.example.test', 'approved'),
    (org_a, 'Linked Pending', 'pending@children-directory.example.test', 'approved'),
    (org_b, 'B Primary', 'b-primary@children-directory.example.test', 'approved');

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@children-directory.example.test'),
    (owner_b, 'owner-b@children-directory.example.test'),
    (parent, 'parent@children-directory.example.test'),
    (spouse, 'spouse@children-directory.example.test'),
    (grown, 'grown@children-directory.example.test'),
    (sharer, 'sharer@children-directory.example.test'),
    (outsider, 'outsider@children-directory.example.test'),
    (elsewhere, 'elsewhere@children-directory.example.test'),
    (linked_pending, 'pending@children-directory.example.test'),
    (b_primary, 'b-primary@children-directory.example.test');

  insert into public.family_units (org_id, family_name) values (org_a, 'Household') returning id into fam;
  insert into public.family_units (org_id, family_name) values (org_a, 'Elsewhere') returning id into fam_else;
  insert into public.family_units (org_id, family_name) values (org_b, 'Org B') returning id into fam_b;

  update public.profiles set family_id = fam, relationship = 'primary' where id = parent;
  update public.profiles set family_id = fam, relationship = 'spouse' where id = spouse;
  update public.profiles set family_id = fam, relationship = 'child', birth_month = 2, birth_day = 3, birth_year = 1999 where id = grown;
  update public.profiles set family_id = fam, relationship = 'other', role = 'pending' where id = linked_pending;
  update public.profiles set family_id = fam_else, relationship = 'primary' where id = elsewhere;
  update public.profiles set family_id = fam_b, relationship = 'primary' where id = b_primary;

  insert into public.groups (org_id, name) values (org_a, 'Shared') returning id into grp;
  delete from public.group_members where org_id = org_a;
  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org_a, grp, parent, 'member'),
    (org_a, grp, sharer, 'member');

  insert into public.family_members (org_id, family_id, first_name, last_name, preferred_name, relationship, birth_month, birth_day, birth_year, avatar_url)
    values (org_a, fam, 'Legalname', 'Fixture', 'Pip', 'child', 5, 6, 2016, 'kid.png') returning id into kid;
  insert into public.family_members (org_id, family_id, first_name, relationship, birth_year)
    values (org_a, fam, 'Accepted', 'child', 2015) returning id into kid_accepted;
  insert into public.family_members (org_id, family_id, first_name, relationship, birth_month, birth_day, birth_year, claimed_profile_id)
    values (org_a, fam, 'Grown', 'child', 2, 3, 1999, grown) returning id into claimed_child;
  insert into public.family_members (org_id, family_id, first_name, relationship, birth_month, birth_day, birth_year)
    values (org_a, fam, 'Sam', 'spouse', 7, 8, 1980) returning id into fm_spouse;
  insert into public.family_members (org_id, family_id, first_name, relationship, birth_month, birth_day, birth_year)
    values (org_a, fam, 'Pat', 'parent', 9, 10, 1950) returning id into fm_parent;
  insert into public.family_members (org_id, family_id, first_name, relationship, birth_month, birth_day, birth_year)
    values (org_a, fam, 'Sid', 'sibling', 11, 12, 1985) returning id into fm_sibling;
  insert into public.family_members (org_id, family_id, first_name, relationship, birth_month, birth_day, birth_year)
    values (org_a, fam, 'Oli', 'other', 1, 2, 1990) returning id into fm_other;
  insert into public.family_members (org_id, family_id, first_name, relationship, birth_year)
    values (org_a, fam_else, 'Else Kid', 'child', 2014) returning id into kid_else;
  insert into public.family_members (org_id, family_id, first_name, relationship, birth_year)
    values (org_b, fam_b, 'B Kid', 'child', 2013) returning id into kid_b;

  insert into public.family_invites (org_id, family_id, family_member_id, invite_email)
    values (org_a, fam, kid, 'kid@children-directory.example.test') returning token into tok_open;
  insert into public.family_invites (org_id, family_id, family_member_id, invite_email, accepted_at)
    values (org_a, fam, kid_accepted, 'kid2@children-directory.example.test', now()) returning token into tok_accepted;
  insert into public.family_invites (org_id, family_id, family_member_id, invite_email)
    values (org_a, fam, fm_other, 'oli@children-directory.example.test') returning token into tok_other;
  insert into public.family_invites (org_id, family_id, family_member_id, invite_email)
    values (org_a, fam_else, kid_else, 'denied@children-directory.example.test') returning token into tok_denied;

  insert into public.access_requests (org_id, name, email, status, invite_token) values
    (org_a, 'Kid', 'kid@children-directory.example.test', 'pending', tok_open),
    (org_a, 'Oli', 'oli@children-directory.example.test', 'pending', tok_other),
    (org_a, 'Denied', 'denied@children-directory.example.test', 'denied', tok_denied);

  perform set_config('cd.org_a', org_a::text, true);
  perform set_config('cd.org_b', org_b::text, true);
  perform set_config('cd.owner_a', owner_a::text, true);
  perform set_config('cd.parent', parent::text, true);
  perform set_config('cd.spouse', spouse::text, true);
  perform set_config('cd.grown', grown::text, true);
  perform set_config('cd.sharer', sharer::text, true);
  perform set_config('cd.outsider', outsider::text, true);
  perform set_config('cd.elsewhere', elsewhere::text, true);
  perform set_config('cd.linked_pending', linked_pending::text, true);
  perform set_config('cd.b_primary', b_primary::text, true);
  perform set_config('cd.fam', fam::text, true);
  perform set_config('cd.fam_else', fam_else::text, true);
  perform set_config('cd.fam_b', fam_b::text, true);
  perform set_config('cd.kid', kid::text, true);
  perform set_config('cd.kid_accepted', kid_accepted::text, true);
  perform set_config('cd.claimed_child', claimed_child::text, true);
  perform set_config('cd.fm_spouse', fm_spouse::text, true);
  perform set_config('cd.fm_parent', fm_parent::text, true);
  perform set_config('cd.fm_sibling', fm_sibling::text, true);
  perform set_config('cd.fm_other', fm_other::text, true);
  perform set_config('cd.kid_else', kid_else::text, true);
  perform set_config('cd.kid_b', kid_b::text, true);
  perform set_config('cd.tok_other', tok_other::text, true);
  perform set_config('cd.tok_denied', tok_denied::text, true);
end $$;

-- ── The sweep ───────────────────────────────────────────────────────────────
do $$ begin
  perform set_config('cd.counts', public.family_members_retire_child_details()::text, true);
end $$;

alter table public.family_members enable trigger family_members_clear_child_year;
alter table public.family_invites enable trigger family_invites_refuse_child;

create function pg_temp.swept(_key text) returns bigint
  language sql as $$ select (current_setting('cd.counts')::jsonb ->> _key)::bigint $$;

select is(pg_temp.swept('child_birth_year'), 4::bigint,
  'the sweep clears four children''s years, one of them in another org');
select is(pg_temp.swept('child_invite_requests'), 1::bigint,
  'the sweep removes the one unused access request on a child''s open invite');
select is(pg_temp.swept('child_invites'), 3::bigint,
  'the sweep removes open, accepted and denied-request invites on children');

select is(pg_temp.fm('kid'), 'Legalname|Pip|child|5|6|-|kid.png',
  'a child loses only the year: names, month, day and photo stay');
select is(pg_temp.fm('kid_b'), 'B Kid|-|child|-|-|-|-', 'another org''s child is cleared too');
select is(pg_temp.fm('claimed_child'), 'Grown|-|child|2|3|1999|-', 'a child with an account keeps the year');
select is(pg_temp.fm('fm_spouse'), 'Sam|-|spouse|7|8|1980|-', 'a spouse keeps the year');
select is(pg_temp.fm('fm_parent'), 'Pat|-|parent|9|10|1950|-', 'a parent keeps the year');
select is(pg_temp.fm('fm_sibling'), 'Sid|-|sibling|11|12|1985|-', 'a sibling keeps the year');
select is(pg_temp.fm('fm_other'), 'Oli|-|other|1|2|1990|-', 'someone else keeps the year');
select is(
  (select birth_year from public.profiles where id = pg_temp.id('grown')),
  1999::smallint, 'a profile with relationship child keeps its year');

select is(
  (select count(*) from public.family_invites where token = pg_temp.id('tok_other')),
  1::bigint, 'an invite on someone other than a child stays');
select is(
  (select count(*) from public.access_requests where invite_token = pg_temp.id('tok_other')),
  1::bigint, 'the access request on that invite stays');
select is(
  (select count(*) from public.access_requests where email = 'kid@children-directory.example.test'),
  0::bigint, 'the child''s access request is gone, so handle_new_user finds nothing for that email');
select is(
  (select count(*) from public.access_requests
    where email = 'denied@children-directory.example.test' and status = 'denied' and invite_token is null),
  1::bigint, 'a denied access request stays, as a denial, without its invite');

do $$ begin
  perform set_config('cd.counts2', public.family_members_retire_child_details()::text, true);
end $$;
select is(current_setting('cd.counts2')::jsonb,
  '{"child_birth_year": 0, "child_invite_requests": 0, "child_invites": 0}'::jsonb,
  'a second sweep changes nothing');

select is(
  pg_temp.as_role_write('authenticated', 'select public.family_members_retire_child_details()'),
  '42501', 'an authenticated caller cannot run the sweep');
select is(
  pg_temp.as_role_write('service_role', 'select public.family_members_retire_child_details()'),
  '42501', 'the service role cannot run the sweep');

-- ── The year stays off a child without an account ───────────────────────────
select is(
  pg_temp.as_write(pg_temp.id('parent'), format(
    $q$insert into public.family_members (family_id, first_name, relationship, birth_month, birth_day, birth_year)
       values (%L, 'New Kid', 'child', 3, 4, 2019)$q$, pg_temp.id('fam'))),
  'rows=1', 'an insert naming a year on a child goes through');
select is(
  (select concat_ws('|', birth_month, birth_day, coalesce(birth_year::text, '-'))
     from public.family_members where first_name = 'New Kid'),
  '3|4|-', 'that insert stores the month and day, and no year');

select is(
  pg_temp.as_write(pg_temp.id('parent'), format(
    'update public.family_members set birth_year = 2011 where id = %L', pg_temp.id('kid'))),
  'rows=1', 'an update naming a year on a child matches the row');
select is(
  (select birth_year from public.family_members where id = pg_temp.id('kid')),
  null::smallint, 'and stores no year');

select is(
  pg_temp.as_write(pg_temp.id('parent'), format(
    $q$insert into public.family_members (family_id, first_name, relationship, birth_year)
       values (%L, 'New Adult', 'other', 1975)$q$, pg_temp.id('fam'))),
  'rows=1', 'a parent can insert an adult with a year');
select is(
  (select birth_year from public.family_members where first_name = 'New Adult'),
  1975::smallint, 'an adult''s year is stored');

select is(
  pg_temp.as_write(pg_temp.id('parent'), format(
    $q$update public.family_members set relationship = 'child' where first_name = 'New Adult' and family_id = %L$q$,
    pg_temp.id('fam'))),
  'rows=1', 'relabelling someone to Child matches the row');
select is(
  (select birth_year from public.family_members where first_name = 'New Adult'),
  null::smallint, 'relabelling to Child clears the year');

select is(
  pg_temp.as_write(pg_temp.id('owner_a'), format(
    'update public.family_members set birth_year = 1998 where id = %L', pg_temp.id('claimed_child'))),
  'rows=1', 'a church admin can change the year on a child with an account');
select is(
  (select birth_year from public.family_members where id = pg_temp.id('claimed_child')),
  1998::smallint, 'and the change is stored');

-- ── Other members' direct reads of family_members ───────────────────────────
create function pg_temp.table_count(_actor text, _fam text) returns bigint
  language plpgsql as $$
begin
  return pg_temp.as_text(pg_temp.id(_actor),
    format('select count(*) from public.family_members where family_id = %L', pg_temp.id(_fam)))::bigint;
end $$;

select is(pg_temp.table_count('sharer', 'fam'), 0::bigint, 'a member sharing a group reads no family_members row');
select is(pg_temp.table_count('outsider', 'fam'), 0::bigint, 'a member sharing nothing reads no family_members row');
select is(pg_temp.table_count('linked_pending', 'fam'), 0::bigint, 'a pending account linked to the household reads none');
select is(pg_temp.table_count('b_primary', 'fam'), 0::bigint, 'another org''s member reads none');
select is(pg_temp.table_count('elsewhere', 'fam'), 0::bigint, 'another household''s primary reads none');

update public.organizations set directory_visibility = 'org' where id = pg_temp.id('org_a');
select is(pg_temp.table_count('outsider', 'fam'), 0::bigint, 'an org-wide directory still gives no family_members row');

-- ── What a parent and a church admin keep ───────────────────────────────────
update public.organizations set directory_visibility = 'shared_groups' where id = pg_temp.id('org_a');

select is(pg_temp.table_count('parent', 'fam'), 9::bigint, 'the primary reads every row in the household');
select is(pg_temp.table_count('spouse', 'fam'), 9::bigint, 'the spouse reads every row in the household');
select is(pg_temp.table_count('grown', 'fam'), 9::bigint, 'an adult child with an account reads every row in the household');
select is(pg_temp.table_count('owner_a', 'fam'), 9::bigint, 'the church admin reads every row in the household');
select is(pg_temp.table_count('owner_a', 'fam_else'), 1::bigint, 'the church admin reads another household''s rows');
select is(
  pg_temp.as_text(pg_temp.id('parent'), format(
    'select concat_ws(''|'', first_name, birth_month, birth_day) from public.family_members where id = %L', pg_temp.id('kid'))),
  'Legalname|5|6', 'the parent reads the child''s full name and birthday to edit them');
select is(
  pg_temp.as_text(pg_temp.id('owner_a'), format(
    'select birth_year::text from public.family_members where id = %L', pg_temp.id('fm_spouse'))),
  '1980', 'the church admin reads an adult''s year');
select is(
  pg_temp.as_text(pg_temp.id('parent'), format(
    'select birth_year::text from public.family_members where id = %L', pg_temp.id('fm_spouse'))),
  '1980', 'the parent reads an adult''s year');

select is(
  pg_temp.as_write(pg_temp.id('spouse'), format(
    $q$update public.family_members set birth_month = 6 where id = %L$q$, pg_temp.id('kid'))),
  'rows=1', 'the spouse can update a child');
select is(
  pg_temp.as_write(pg_temp.id('owner_a'), format(
    $q$update public.family_members set birth_month = 5 where id = %L$q$, pg_temp.id('kid'))),
  'rows=1', 'the church admin can update a child');
select is(
  pg_temp.as_write(pg_temp.id('owner_a'), format(
    $q$insert into public.family_members (org_id, family_id, first_name, relationship) values (%L, %L, 'Admin Added', 'child')$q$,
    pg_temp.id('org_a'), pg_temp.id('fam'))),
  'rows=1', 'the church admin can add a child');
select is(
  pg_temp.as_write(pg_temp.id('owner_a'), format(
    $q$delete from public.family_members where first_name = 'Admin Added' and family_id = %L$q$, pg_temp.id('fam'))),
  'rows=1', 'the church admin can delete a child');
select is(
  pg_temp.as_write(pg_temp.id('parent'), format(
    $q$delete from public.family_members where first_name = 'New Kid' and family_id = %L$q$, pg_temp.id('fam'))),
  'rows=1', 'the parent can delete a child');
select is(
  pg_temp.as_write(pg_temp.id('elsewhere'), format(
    $q$update public.family_members set birth_month = 1 where id = %L$q$, pg_temp.id('kid'))),
  'rows=0', 'another household''s primary updates nothing');
select is(
  (select birth_month from public.family_members where id = pg_temp.id('kid')),
  5::smallint, 'the child''s row is unchanged by that update');
select is(
  pg_temp.as_write(pg_temp.id('elsewhere'), format(
    'delete from public.family_members where id = %L', pg_temp.id('kid'))),
  'rows=0', 'another household''s primary deletes nothing');
select is(
  pg_temp.as_write(pg_temp.id('elsewhere'), format(
    $q$insert into public.family_members (family_id, first_name, relationship) values (%L, 'Intruder', 'child')$q$, pg_temp.id('fam'))),
  '42501', 'another household''s primary adds nothing');

-- ── The directory view and function ─────────────────────────────────────────
create function pg_temp.person(_actor text, _name text) returns jsonb
  language plpgsql as $$
begin
  return pg_temp.as_text(pg_temp.id(_actor), format(
    $q$select p from public.families_directory_full f, jsonb_array_elements(f.family_members_list) p
        where f.id = %L and p->>'id' = %L$q$, pg_temp.id('fam'), pg_temp.id(_name)))::jsonb;
end $$;

select is(
  pg_temp.as_text(pg_temp.id('sharer'), format(
    'select jsonb_array_length(family_members_list)::text from public.families_directory_full where id = %L', pg_temp.id('fam'))),
  '8', 'a member sharing a group gets the household''s people through the directory');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.person('sharer', 'kid')) k),
  array['avatar_url', 'birth_day', 'birth_month', 'claimed_profile_id', 'first_name', 'id',
        'is_class_member', 'last_name', 'preferred_name', 'relationship'],
  'each person carries exactly what the directory uses, and no birth year');
select is(pg_temp.person('sharer', 'kid') ->> 'first_name', 'Pip',
  'a child with a preferred name is read by that name only');
select is(
  pg_temp.as_text(pg_temp.id('sharer'), format(
    'select count(*)::text from public.families_directory_full where id = %L and family_members_list::text like %L',
    pg_temp.id('fam'), '%Legalname%')),
  '0', 'the child''s other first name is nowhere in the list');
select is(pg_temp.person('sharer', 'fm_spouse') ->> 'first_name', 'Sam', 'an adult''s first name is unchanged');
select is(pg_temp.person('sharer', 'fm_spouse') ? 'birth_year', false, 'an adult''s year is not in the list either');
select is(pg_temp.person('sharer', 'fm_spouse') ->> 'birth_month', '7', 'an adult''s month is in the list');

select is(
  pg_temp.as_text(pg_temp.id('outsider'), format(
    'select count(*)::text from public.families_directory_full where id = %L', pg_temp.id('fam'))),
  '0', 'a member sharing nothing gets no row from the view');
create function pg_temp.people_len(_actor text, _fam text) returns text
  language plpgsql as $$
begin
  return pg_temp.as_text(pg_temp.id(_actor), format(
    'select jsonb_array_length(public.family_directory_people(%L))::text', pg_temp.id(_fam)));
end $$;
select is(pg_temp.people_len('sharer', 'fam'), '8', 'the function answers a member sharing a group');
select is(pg_temp.people_len('outsider', 'fam'), '0', 'a direct call returns nothing for a household the caller can''t see');
select is(pg_temp.people_len('linked_pending', 'fam'), '0', 'a direct call returns nothing for a pending account');
select is(pg_temp.people_len('b_primary', 'fam'), '0', 'a direct call returns nothing across orgs');
select is(pg_temp.people_len('owner_a', 'fam'), '8', 'the function answers the church admin');
select is(pg_temp.people_len('parent', 'fam'), '8', 'the function answers the household');
select is(
  pg_temp.as_role_write('anon', format('select public.family_directory_people(%L)', pg_temp.id('fam'))),
  '42501', 'an anonymous call has no execute grant');

update public.organizations set directory_visibility = 'org' where id = pg_temp.id('org_a');
select is(pg_temp.people_len('outsider', 'fam'), '8', 'an org-wide directory answers any member');
select is(pg_temp.people_len('linked_pending', 'fam'), '0', 'an org-wide directory still refuses a pending account');
update public.organizations set directory_visibility = 'shared_groups' where id = pg_temp.id('org_a');

-- The deployed app selects these by name from the view and the table.
select is(
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns where table_schema = 'public' and table_name = 'families_directory_full'),
  'id,family_name,photo_url,address_line1,address_line2,city,state,postal_code,phone_home,anniversary,created_at,updated_at,members,family_members_list,org_id,anniversary_month,anniversary_day,anniversary_year,phone_profile_id',
  'the view keeps every column, in order');
select is(
  (select array_to_string(c.reloptions, ',') from pg_class c where c.oid = 'public.families_directory_full'::regclass),
  'security_invoker=true', 'the view stays security_invoker');
select is(
  (select count(*) from information_schema.view_table_usage
    where table_schema = 'public' and table_name = 'family_members' and view_schema = 'public'),
  0::bigint, 'no view reads family_members directly, so none can return a stored column');

-- ── family_invites reads ────────────────────────────────────────────────────
create function pg_temp.invite_count(_actor text) returns text
  language plpgsql as $$
begin
  return pg_temp.as_text(pg_temp.id(_actor),
    format('select count(*)::text from public.family_invites where token = %L', pg_temp.id('tok_other')));
end $$;
select is(pg_temp.invite_count('sharer'), '0', 'a member sharing a group reads no invite');
select is(pg_temp.invite_count('outsider'), '0', 'an unrelated member reads no invite');
select is(pg_temp.invite_count('elsewhere'), '0', 'another household''s primary reads no invite');
select is(pg_temp.invite_count('linked_pending'), '0', 'a pending account reads no invite');
select is(pg_temp.invite_count('b_primary'), '0', 'another org reads no invite');
select is(pg_temp.invite_count('parent'), '1', 'the primary reads their household''s invite');
select is(pg_temp.invite_count('spouse'), '1', 'the spouse reads their household''s invite');
select is(pg_temp.invite_count('owner_a'), '1', 'the church admin reads the invite');

-- ── Refusing an invite ──────────────────────────────────────────────────────
create function pg_temp.invite_total() returns bigint
  language sql as $$
  select count(*) from public.family_invites
   where org_id in (current_setting('cd.org_a')::uuid, current_setting('cd.org_b')::uuid);
$$;
do $$ begin perform set_config('cd.invites_before', pg_temp.invite_total()::text, true); end $$;

select is(
  pg_temp.as_write(pg_temp.id('parent'), format(
    $q$insert into public.family_invites (family_id, family_member_id, invite_email) values (%L, %L, 'x1@children-directory.example.test')$q$,
    pg_temp.id('fam'), pg_temp.id('kid'))),
  'HP002', 'a direct insert by the primary on their own child is refused');
select is(
  pg_temp.as_write(pg_temp.id('parent'), format(
    $q$insert into public.family_invites (family_id, family_member_id, invite_email) values (%L, %L, 'x2@children-directory.example.test')$q$,
    pg_temp.id('fam'), pg_temp.id('kid_else'))),
  'HP002', 'naming another household''s child is refused, though the caller can''t read that row');
select is(
  pg_temp.as_write(pg_temp.id('owner_a'), format(
    $q$insert into public.family_invites (family_id, family_member_id, invite_email) values (%L, %L, 'x3@children-directory.example.test')$q$,
    pg_temp.id('fam'), pg_temp.id('kid'))),
  'HP002', 'a church admin''s insert is refused');
select is(
  pg_temp.as_role_write('service_role', format(
    $q$insert into public.family_invites (org_id, family_id, family_member_id, invite_email) values (%L, %L, %L, 'x4@children-directory.example.test')$q$,
    pg_temp.id('org_a'), pg_temp.id('fam'), pg_temp.id('kid'))),
  'HP002', 'a service-role insert is refused');
select is(pg_temp.invite_total()::text, current_setting('cd.invites_before'), 'none of those refusals wrote a row');
select is(
  (select count(*) from public.family_invites where invite_email like 'x_@children-directory.example.test'),
  0::bigint, 'no refused address is stored');

select is(
  pg_temp.as_write(pg_temp.id('parent'), format(
    $q$update public.family_invites set family_member_id = %L where token = %L$q$,
    pg_temp.id('kid'), pg_temp.id('tok_other'))),
  'HP002', 'moving an invite onto a child is refused');
select is(
  (select family_member_id from public.family_invites where token = pg_temp.id('tok_other')),
  pg_temp.id('fm_other'), 'the invite stays on its person');

select is(
  pg_temp.as_write(pg_temp.id('parent'), format(
    $q$insert into public.family_invites (family_id, family_member_id, invite_email) values (%L, %L, 'sid@children-directory.example.test')$q$,
    pg_temp.id('fam'), pg_temp.id('fm_sibling'))),
  'rows=1', 'an invite on an adult household member goes through');
select is(
  pg_temp.as_write(pg_temp.id('parent'), format(
    $q$insert into public.family_invites (family_id, family_member_id, invite_email) values (%L, %L, 'grown2@children-directory.example.test')$q$,
    pg_temp.id('fam'), pg_temp.id('claimed_child'))),
  'rows=1', 'the trigger doesn''t refuse a child who has an account');
delete from public.family_invites where invite_email = 'grown2@children-directory.example.test';

-- ── Becoming a child without an account ends the invite ─────────────────────
select is(
  pg_temp.as_write(pg_temp.id('parent'), format(
    $q$update public.family_members set relationship = 'child' where id = %L$q$, pg_temp.id('fm_other'))),
  'rows=1', 'the primary relabels someone with an open invite to Child');
select is(
  (select count(*) from public.family_invites where family_member_id = pg_temp.id('fm_other')),
  0::bigint, 'that person''s invite is gone');
select is(
  (select count(*) from public.access_requests where email = 'oli@children-directory.example.test'),
  0::bigint, 'that person''s unused access request is gone');
select is(
  (select count(*) from public.family_invites where family_member_id = pg_temp.id('fm_sibling')),
  1::bigint, 'another person''s invite stays');
select is(
  (select birth_year from public.family_members where id = pg_temp.id('fm_other')),
  null::smallint, 'the relabelled person''s year is cleared');

insert into public.family_invites (org_id, family_id, family_member_id, invite_email, accepted_at)
  values (pg_temp.id('org_a'), pg_temp.id('fam'), pg_temp.id('claimed_child'), 'grown3@children-directory.example.test', now());
update public.family_members set claimed_profile_id = null where id = pg_temp.id('claimed_child');
select is(
  (select birth_year from public.family_members where id = pg_temp.id('claimed_child')),
  null::smallint, 'a child who loses their account link loses the stored year');
select is(
  (select count(*) from public.family_invites where family_member_id = pg_temp.id('claimed_child')),
  0::bigint, 'and the invite that linked them');

select * from finish();
rollback;
