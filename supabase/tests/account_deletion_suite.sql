-- Account deletion suite: what the database does when a person's login goes, and
-- what lib/account/deletion.ts has to do first because the database wouldn't.
--
-- Nothing here touches a seeded person's rows for good: everyone deleted is
-- created below, and the whole file rolls back.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/account_deletion_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.new_person(_org uuid, _email text, _role text default 'member',
                                   _family uuid default null) returns uuid language plpgsql as $$
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

create function pg_temp.enter(_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- rows:<n> on success, the SQLSTATE on failure.
create function pg_temp.attempt(_id uuid, _sql text) returns text language plpgsql as $$
declare n bigint; r text;
begin
  perform pg_temp.enter(_id);
  begin
    execute _sql;
    get diagnostics n = row_count;
    r := 'rows:' || n;
  exception when others then
    r := sqlstate;
  end;
  set local role none;
  return r;
end $$;

-- rows:<n> or the SQLSTATE, as the service role's write would see it.
create function pg_temp.run(_sql text) returns text language plpgsql as $$
declare n bigint;
begin
  execute _sql;
  get diagnostics n = row_count;
  return 'rows:' || n;
exception when others then
  return sqlstate;
end $$;

-- ── Fixture: two churches ───────────────────────────────────────────────────
create temp table fx (key text primary key, id uuid) on commit drop;
grant select on fx to authenticated;

create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;

do $$
declare
  _org uuid := gen_random_uuid();
  _other uuid := gen_random_uuid();
  _group uuid := gen_random_uuid();
  _other_group uuid := gen_random_uuid();
  _family uuid := gen_random_uuid();
  _team uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name) values
    (_org, 'Deletion Church'),
    (_other, 'Other Church');
  insert into public.groups (id, org_id, name) values
    (_group, _org, 'Deletion Group'), (_other_group, _other, 'Other Group');
  insert into public.family_units (id, org_id, family_name) values (_family, _org, 'Shared');
  insert into public.teams (id, org_id, group_id, name) values (_team, _org, _group, 'Set-up');

  insert into fx values ('org', _org), ('other_org', _other), ('group', _group),
    ('other_group', _other_group), ('family', _family), ('team', _team);
end $$;

insert into fx values
  ('admin_a', pg_temp.new_person(pg_temp.fx('org'), 'a.admin@deletion.test', 'admin')),
  ('admin_b', pg_temp.new_person(pg_temp.fx('org'), 'b.admin@deletion.test', 'admin')),
  ('spouse_a', pg_temp.new_person(pg_temp.fx('org'), 'a.spouse@deletion.test', 'member', pg_temp.fx('family'))),
  ('spouse_b', pg_temp.new_person(pg_temp.fx('org'), 'b.spouse@deletion.test', 'member', pg_temp.fx('family'))),
  ('leader', pg_temp.new_person(pg_temp.fx('org'), 'leader@deletion.test')),
  ('outsider', pg_temp.new_person(pg_temp.fx('other_org'), 'outsider@deletion.test', 'admin'));

insert into public.group_members (org_id, group_id, profile_id, role)
select pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx(k), r
from (values ('spouse_a', 'member'), ('spouse_b', 'member'), ('leader', 'leader')) v(k, r)
on conflict (group_id, profile_id) do update set role = excluded.role;
insert into public.group_members (org_id, group_id, profile_id, role)
values (pg_temp.fx('other_org'), pg_temp.fx('other_group'), pg_temp.fx('outsider'), 'leader')
on conflict (group_id, profile_id) do update set role = excluded.role;
insert into public.team_members (org_id, team_id, profile_id)
select pg_temp.fx('org'), pg_temp.fx('team'), pg_temp.fx(k) from (values ('spouse_a'), ('spouse_b')) v(k);

-- ── A prayer request: the author deletes it, by name or anonymous ───────────
insert into public.prayer_requests (id, org_id, group_id, author_id, body, is_anonymous)
select gen_random_uuid(), pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx('spouse_a'), b, a
from (values ('anon 1', true), ('anon 2', true), ('named 1', false), ('anon 3', true)) v(b, a);

select is(pg_temp.attempt(pg_temp.fx('spouse_b'),
  $$delete from public.prayer_requests where body = 'anon 1'$$), 'rows:0',
  'another member deletes no anonymous request');
select is(pg_temp.attempt(pg_temp.fx('outsider'),
  $$delete from public.prayer_requests where body = 'anon 1'$$), 'rows:0',
  'someone in another church deletes no request');
select is(pg_temp.attempt(pg_temp.fx('spouse_a'),
  $$delete from public.prayer_requests where body = 'anon 1'$$), 'rows:1',
  'the author deletes their anonymous request');
select is(pg_temp.attempt(pg_temp.fx('spouse_a'),
  $$delete from public.prayer_requests where body = 'named 1'$$), 'rows:1',
  'the author deletes their request by name');
select is(pg_temp.attempt(pg_temp.fx('leader'),
  $$delete from public.prayer_requests where body = 'anon 2'$$), 'rows:1',
  'a leader keeps the right to delete a request in their group');

-- ── A serving date both spouses are on ──────────────────────────────────────
insert into public.serving_signups (id, org_id, team_id, service_date, family_id, created_by)
values
  ('d0000000-0000-4000-8000-000000000001', pg_temp.fx('org'), pg_temp.fx('team'), '2030-01-06', pg_temp.fx('family'), pg_temp.fx('spouse_a')),
  ('d0000000-0000-4000-8000-000000000002', pg_temp.fx('org'), pg_temp.fx('team'), '2030-01-13', pg_temp.fx('family'), pg_temp.fx('spouse_a'));
insert into public.serving_signup_attendees (signup_id, org_id, profile_id) values
  ('d0000000-0000-4000-8000-000000000001', pg_temp.fx('org'), pg_temp.fx('spouse_a')),
  ('d0000000-0000-4000-8000-000000000001', pg_temp.fx('org'), pg_temp.fx('spouse_b')),
  ('d0000000-0000-4000-8000-000000000002', pg_temp.fx('org'), pg_temp.fx('spouse_a'));

select is(pg_temp.run(format(
  $$update public.serving_signups set created_by = %L
    where id = 'd0000000-0000-4000-8000-000000000001' and org_id = %L and created_by = %L$$,
  pg_temp.fx('spouse_b'), pg_temp.fx('other_org'), pg_temp.fx('spouse_a'))), 'rows:0',
  'moving a serving date with another church''s filter matches nothing');
select is(pg_temp.run(format(
  $$update public.serving_signups set created_by = %L
    where id = 'd0000000-0000-4000-8000-000000000001' and org_id = %L and created_by = %L$$,
  pg_temp.fx('spouse_b'), pg_temp.fx('org'), pg_temp.fx('spouse_a'))), 'rows:1',
  'the serving date moves to the remaining attendee with no migration');

-- ── Household facts before the login goes ───────────────────────────────────
insert into public.family_members (id, org_id, family_id, first_name, relationship, claimed_profile_id) values
  ('e0000000-0000-4000-8000-000000000001', pg_temp.fx('org'), pg_temp.fx('family'), 'Spouse A', 'spouse', pg_temp.fx('spouse_a')),
  ('e0000000-0000-4000-8000-000000000002', pg_temp.fx('org'), pg_temp.fx('family'), 'Child', 'child', null);
update public.family_units set phone_profile_id = null where id = pg_temp.fx('family');
update public.profiles set phone_mobile = '555-0100', relationship = 'spouse' where id = pg_temp.fx('spouse_a');
do $$
begin
  perform pg_temp.enter(pg_temp.fx('spouse_a'));
  update public.family_units set phone_profile_id = pg_temp.fx('spouse_a') where id = pg_temp.fx('family');
  set local role none;
end $$;

-- ── Content that stays, and a fund that doesn't ─────────────────────────────
insert into public.announcements (org_id, group_id, title, content, author_id)
values (pg_temp.fx('org'), pg_temp.fx('group'), 'Kept', 'Stays', pg_temp.fx('spouse_a'));
insert into public.giving_funds (id, org_id, group_id, name, steward_id)
values ('f0000000-0000-4000-8000-000000000001', pg_temp.fx('org'), pg_temp.fx('group'), 'Goes with them', pg_temp.fx('spouse_a'));
insert into public.giving_funds (id, org_id, group_id, name, steward_id, co_steward_id, created_by)
values ('f0000000-0000-4000-8000-000000000002', pg_temp.fx('org'), pg_temp.fx('group'), 'Stays', pg_temp.fx('spouse_b'), pg_temp.fx('spouse_a'), pg_temp.fx('spouse_a'));
insert into public.feedback (org_id, profile_id, type, message)
values (pg_temp.fx('org'), pg_temp.fx('spouse_a'), 'idea', 'Kept without a name');

-- ── The login goes ──────────────────────────────────────────────────────────
select is(pg_temp.run(format($$delete from auth.users where id = %L$$, pg_temp.fx('spouse_a'))),
  'rows:1', 'deleting one spouse''s login succeeds');

select is((select count(*) from public.profiles where id = pg_temp.fx('spouse_a')), 0::bigint,
  'the profile goes with the login');
select is((select count(*) from public.prayer_requests where body = 'anon 3'), 0::bigint,
  'their anonymous prayer request goes too');
select is((select count(*) from public.group_members where profile_id = pg_temp.fx('spouse_a')), 0::bigint,
  'their group memberships go');
select is((select count(*) from public.team_members where profile_id = pg_temp.fx('spouse_a')), 0::bigint,
  'their team memberships go');

select is((select created_by from public.serving_signups where id = 'd0000000-0000-4000-8000-000000000001'),
  pg_temp.fx('spouse_b'), 'the other spouse keeps the date they share');
select is((select array_agg(profile_id) from public.serving_signup_attendees
            where signup_id = 'd0000000-0000-4000-8000-000000000001'),
  array[pg_temp.fx('spouse_b')], 'and is the one left on it');
select is((select count(*) from public.serving_signups where id = 'd0000000-0000-4000-8000-000000000002'), 0::bigint,
  'a date they booked for themself alone goes, which is why a shared one has to move first');

select is((select count(*) from public.family_units where id = pg_temp.fx('family')), 1::bigint,
  'the shared household stays');
select is((select family_id from public.profiles where id = pg_temp.fx('spouse_b')),
  pg_temp.fx('family'), 'the other spouse stays in it');
select is((select phone_profile_id from public.family_units where id = pg_temp.fx('family')), null::uuid,
  'the household phone stops pointing at them, with the phone rule not in the way');
select is((select count(*) from public.family_members where id = 'e0000000-0000-4000-8000-000000000002'), 1::bigint,
  'a child''s entry stays with the household');
select is((select claimed_profile_id from public.family_members where id = 'e0000000-0000-4000-8000-000000000001'),
  null::uuid, 'their claimed entry only unclaims, which is why the app deletes it first');

select is((select author_id from public.announcements where title = 'Kept'), null::uuid,
  'an announcement stays, with the author link cleared');
select is((select count(*) from public.giving_funds where id = 'f0000000-0000-4000-8000-000000000001'), 0::bigint,
  'a fund they receive is deleted, which is what the confirmation says');
select is((select co_steward_id from public.giving_funds where id = 'f0000000-0000-4000-8000-000000000002'), null::uuid,
  'a fund they are second on stays, with the slot empty');
select is((select profile_id from public.feedback where message = 'Kept without a name'), null::uuid,
  'feedback stays, without a name');
select is((select count(*) from public.access_requests where email = 'a.spouse@deletion.test'), 1::bigint,
  'an access request outlives the login, which is why the app deletes it first');

-- ── The last church admin ───────────────────────────────────────────────────
select is(pg_temp.run(format($$delete from auth.users where id = %L$$, pg_temp.fx('admin_b'))), 'rows:1',
  'a church admin can be removed while another stays');
select is(pg_temp.run(format($$delete from auth.users where id = %L$$, pg_temp.fx('admin_a'))), 'CA001',
  'the last church admin''s login can''t be deleted');
select is((select count(*) from public.profiles where id = pg_temp.fx('admin_a')), 1::bigint,
  'and their profile is still there');
select is((select count(*) from auth.users where id = pg_temp.fx('admin_a')), 1::bigint,
  'and so is their login, so nothing is half deleted');
select is((select count(*) from public.profiles where id = pg_temp.fx('outsider') and role = 'admin'), 1::bigint,
  'another church''s admin doesn''t count toward this church');

select * from finish();
rollback;
