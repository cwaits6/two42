-- Account deletion suite: delete_person(), the one transaction behind
-- lib/account/deletion.ts, and the row-level rules around it.
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

-- ── Prayer requests ─────────────────────────────────────────────────────────
-- 'anon 3' and 'named 1' still carry spouse_a as author_id, so the profile
-- cascade removes them. A hashed anonymous request carries no author at all:
-- the app finds the person's by the hash and passes their ids.
create function pg_temp.h(_n int) returns uuid language sql immutable as $$
  select ('b0000000-0000-4000-8000-' || lpad(_n::text, 12, '0'))::uuid;
$$;
insert into public.prayer_requests (id, org_id, group_id, author_id, body, is_anonymous)
select gen_random_uuid(), pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx('spouse_a'), b, a
from (values ('named 1', false), ('anon 3', true)) v(b, a);
insert into public.prayer_requests (id, org_id, group_id, author_id, author_hash, body, body_ciphertext, is_anonymous)
values
  -- spouse_a's, hashed
  (pg_temp.h(1), pg_temp.fx('org'), pg_temp.fx('group'), null, 'h1.k.mine', null, 'v1.k.a.b', true),
  -- spouse_b's, hashed, and not passed in
  (pg_temp.h(2), pg_temp.fx('org'), pg_temp.fx('group'), null, 'h1.k.theirs', null, 'v1.k.a.b', true),
  -- another church's, hashed
  (pg_temp.h(3), pg_temp.fx('other_org'), pg_temp.fx('other_group'), null, 'h1.k.other', null, 'v1.k.a.b', true),
  -- spouse_b's by name
  (pg_temp.h(4), pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx('spouse_b'), null, 'named b', null, false),
  -- spouse_b's, anonymous, not yet converted
  (pg_temp.h(5), pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx('spouse_b'), null, 'anon b', null, true);

select is(pg_temp.attempt(pg_temp.fx(who),
  format('delete from public.prayer_requests where id = %L', pg_temp.h(1))), '42501',
  who || ' deletes no request from the browser; the server does it with the key')
from unnest(array['spouse_a', 'spouse_b', 'leader', 'outsider']) who;

-- ── Who can call it ─────────────────────────────────────────────────────────
select ok((select p.prosecdef from pg_proc p where p.oid = 'public.delete_person(uuid, uuid, uuid[])'::regprocedure),
  'delete_person is SECURITY DEFINER');
select is((select p.proconfig from pg_proc p where p.oid = 'public.delete_person(uuid, uuid, uuid[])'::regprocedure),
  array['search_path=""'], 'delete_person pins an empty search_path');
select ok(not has_function_privilege('anon', 'public.delete_person(uuid, uuid, uuid[])', 'execute'),
  'anon can''t call it');
select ok(not has_function_privilege('authenticated', 'public.delete_person(uuid, uuid, uuid[])', 'execute'),
  'a signed-in person can''t call it');
select ok(has_function_privilege('service_role', 'public.delete_person(uuid, uuid, uuid[])', 'execute'),
  'the service role can call it');
select ok(has_table_privilege(
    (select p.proowner::regrole::text from pg_proc p where p.oid = 'public.delete_person(uuid, uuid, uuid[])'::regprocedure),
    'auth.users', 'delete'),
  'its owner holds DELETE on auth.users');
select hasnt_function('public', 'delete_person', array['uuid', 'uuid'],
  'the two-argument signature is gone, so no grant is left on it');

-- ── Fixture: everything a deletion touches ──────────────────────────────────
create function pg_temp.d(_n int) returns uuid language sql immutable as $$
  select ('d0000000-0000-4000-8000-' || lpad(_n::text, 12, '0'))::uuid;
$$;
create function pg_temp.f(_n int) returns uuid language sql immutable as $$
  select ('f0000000-0000-4000-8000-' || lpad(_n::text, 12, '0'))::uuid;
$$;
create function pg_temp.e(_n int) returns uuid language sql immutable as $$
  select ('e0000000-0000-4000-8000-' || lpad(_n::text, 12, '0'))::uuid;
$$;

insert into fx values
  ('solo', pg_temp.new_person(pg_temp.fx('org'), 'solo@deletion.test')),
  ('outside_second', pg_temp.new_person(pg_temp.fx('org'), 'outside.second@deletion.test')),
  ('operator', pg_temp.new_person(pg_temp.fx('org'), 'operator@deletion.test')),
  ('other_namesake', pg_temp.new_person(pg_temp.fx('other_org'), 'namesake@deletion.test')),
  ('solo_family', gen_random_uuid());
insert into public.platform_admins (profile_id) values (pg_temp.fx('operator'));
insert into public.family_units (id, org_id, family_name)
  values (pg_temp.fx('solo_family'), pg_temp.fx('org'), 'Only Solo');
update public.profiles set family_id = pg_temp.fx('solo_family') where id = pg_temp.fx('solo');

-- Their login, as Auth keeps it.
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (pg_temp.fx('spouse_a')::text, pg_temp.fx('spouse_a'), '{}', 'email', now(), now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at)
  values ('c0000000-0000-4000-8000-000000000001', pg_temp.fx('spouse_a'), now(), now());
insert into auth.refresh_tokens (instance_id, token, user_id, revoked, session_id, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', 'deletion-suite-token', pg_temp.fx('spouse_a')::text, false,
          'c0000000-0000-4000-8000-000000000001', now(), now());

insert into public.serving_signups (id, org_id, team_id, service_date, family_id, created_by)
select pg_temp.d(n), pg_temp.fx('org'), pg_temp.fx('team'), d::date, pg_temp.fx('family'), pg_temp.fx(k)
from (values
  (1, '2090-01-01', 'spouse_a'),  -- they booked it, and share it
  (2, '2090-01-08', 'spouse_a'),  -- they booked it, alone
  (3, '2090-01-15', 'spouse_b'),  -- someone else booked it, for them alone
  (4, '2090-01-22', 'spouse_b'),  -- someone else booked it, and is on it too
  (5, '2001-01-07', 'spouse_a'),  -- past, booked alone
  (6, '2001-01-14', 'spouse_b'),  -- past, someone else booked it for them alone
  (7, '2001-01-21', 'spouse_a')   -- past, they booked it, and share it
) v(n, d, k);
insert into public.serving_signup_attendees (signup_id, org_id, profile_id)
select pg_temp.d(n), pg_temp.fx('org'), pg_temp.fx(k)
from (values (1, 'spouse_a'), (1, 'spouse_b'), (2, 'spouse_a'), (3, 'spouse_a'), (4, 'spouse_a'),
             (4, 'spouse_b'), (5, 'spouse_a'), (6, 'spouse_a'), (7, 'spouse_a'), (7, 'spouse_b')) v(n, k);

insert into public.giving_funds (id, org_id, group_id, name, steward_id, co_steward_id, steward_role, created_by) values
  (pg_temp.f(1), pg_temp.fx('org'), pg_temp.fx('group'), 'Passes on', pg_temp.fx('spouse_a'), pg_temp.fx('spouse_b'), 'Treasurer', pg_temp.fx('spouse_a')),
  (pg_temp.f(2), pg_temp.fx('org'), pg_temp.fx('group'), 'No second', pg_temp.fx('spouse_a'), null, null, null),
  (pg_temp.f(3), pg_temp.fx('org'), pg_temp.fx('group'), 'Second has left', pg_temp.fx('spouse_a'), pg_temp.fx('outside_second'), null, null),
  (pg_temp.f(4), pg_temp.fx('org'), pg_temp.fx('group'), 'They are second', pg_temp.fx('spouse_b'), pg_temp.fx('spouse_a'), 'Treasurer', pg_temp.fx('spouse_a'));
insert into public.giving_fund_methods (fund_id, org_id, group_id, method, custom_handle)
select pg_temp.f(n), pg_temp.fx('org'), pg_temp.fx('group'), 'venmo', '@handle' from generate_series(1, 4) n;
delete from public.group_members where profile_id = pg_temp.fx('outside_second');

insert into public.family_members (id, org_id, family_id, first_name, relationship, claimed_profile_id) values
  (pg_temp.e(1), pg_temp.fx('org'), pg_temp.fx('family'), 'Spouse A', 'spouse', pg_temp.fx('spouse_a')),
  (pg_temp.e(2), pg_temp.fx('org'), pg_temp.fx('family'), 'Child', 'child', null),
  (pg_temp.e(3), pg_temp.fx('org'), pg_temp.fx('solo_family'), 'Solo', 'primary', pg_temp.fx('solo')),
  (pg_temp.e(4), pg_temp.fx('org'), pg_temp.fx('solo_family'), 'Solo child', 'child', null),
  (pg_temp.e(5), pg_temp.fx('org'), pg_temp.fx('family'), 'Invited', 'other', null);
update public.profiles set phone_mobile = '555-0100', relationship = 'spouse', first_name = 'Ada' where id = pg_temp.fx('spouse_a');
do $$
begin
  perform pg_temp.enter(pg_temp.fx('spouse_a'));
  update public.family_units set phone_profile_id = pg_temp.fx('spouse_a') where id = pg_temp.fx('family');
  set local role none;
end $$;

insert into public.announcements (org_id, group_id, title, content, author_id)
values (pg_temp.fx('org'), pg_temp.fx('group'), 'Kept', 'Stays', pg_temp.fx('spouse_a'));
insert into public.feedback (org_id, profile_id, type, message)
values (pg_temp.fx('org'), pg_temp.fx('spouse_a'), 'idea', 'Kept without a name');

-- Sign-up records. a.old@ is an address they have left.
insert into public.group_invites (id, org_id, group_id)
values ('b0000000-0000-4000-8000-000000000001', pg_temp.fx('org'), pg_temp.fx('group'));
insert into public.access_requests (id, org_id, name, email, status, approved_role, reviewed_at, signup_token) values
  ('a0000000-0000-4000-8000-000000000001', pg_temp.fx('org'), 'Other case', 'A.SPOUSE@deletion.test', 'denied', null, now(), null),
  ('a0000000-0000-4000-8000-000000000002', pg_temp.fx('org'), 'Linked, spent', 'a.old@deletion.test', 'approved', 'member', now(), null),
  ('a0000000-0000-4000-8000-000000000003', pg_temp.fx('org'), 'Linked, live link', 'a.old2@deletion.test', 'approved', 'member', now(), 'deletion-suite-live-link'),
  ('a0000000-0000-4000-8000-000000000004', pg_temp.fx('org'), 'Their spouse', 'a.old3@deletion.test', 'approved', 'member', now(), null),
  ('a0000000-0000-4000-8000-000000000005', pg_temp.fx('org'), 'Wildcard lookalike', 'a_spouse@deletion.test', 'approved', 'member', now(), null),
  ('a0000000-0000-4000-8000-000000000006', pg_temp.fx('other_org'), 'Other church, same address', 'a.spouse@deletion.test', 'approved', 'member', now(), null);
insert into public.group_invite_uses (id, org_id, invite_id, group_id, email, outcome, profile_id, access_request_id) values
  ('b1000000-0000-4000-8000-000000000001', pg_temp.fx('org'), 'b0000000-0000-4000-8000-000000000001', pg_temp.fx('group'), 'a.old@deletion.test', 'joined', pg_temp.fx('spouse_a'), 'a0000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000002', pg_temp.fx('org'), 'b0000000-0000-4000-8000-000000000001', pg_temp.fx('group'), 'a.old2@deletion.test', 'joined', pg_temp.fx('spouse_a'), 'a0000000-0000-4000-8000-000000000003'),
  ('b1000000-0000-4000-8000-000000000003', pg_temp.fx('org'), 'b0000000-0000-4000-8000-000000000001', pg_temp.fx('group'), 'a.spouse@deletion.test', 'signup_sent', null, null),
  ('b1000000-0000-4000-8000-000000000004', pg_temp.fx('org'), 'b0000000-0000-4000-8000-000000000001', pg_temp.fx('group'), 'a.old3@deletion.test', 'signup_sent', null, null);

-- Links their uses have used up, one for each way a use is matched to them, and
-- one with a use left to prove the refusals below come from the count.
insert into public.group_invites (id, org_id, group_id, max_uses) values
  ('b0000000-0000-4000-8000-000000000002', pg_temp.fx('org'), pg_temp.fx('group'), 1),
  ('b0000000-0000-4000-8000-000000000003', pg_temp.fx('org'), pg_temp.fx('group'), 1),
  ('b0000000-0000-4000-8000-000000000004', pg_temp.fx('org'), pg_temp.fx('group'), 1),
  ('b0000000-0000-4000-8000-000000000005', pg_temp.fx('org'), pg_temp.fx('group'), 2);
insert into public.group_invite_uses (id, org_id, invite_id, group_id, email, outcome, profile_id) values
  ('b1000000-0000-4000-8000-000000000005', pg_temp.fx('org'), 'b0000000-0000-4000-8000-000000000002', pg_temp.fx('group'), 'a.spouse@deletion.test', 'joined', pg_temp.fx('spouse_a')),
  ('b1000000-0000-4000-8000-000000000006', pg_temp.fx('org'), 'b0000000-0000-4000-8000-000000000003', pg_temp.fx('group'), 'a.old4@deletion.test', 'signup_sent', pg_temp.fx('spouse_a')),
  ('b1000000-0000-4000-8000-000000000007', pg_temp.fx('org'), 'b0000000-0000-4000-8000-000000000004', pg_temp.fx('group'), 'A.Spouse@deletion.test', 'signup_sent', null),
  ('b1000000-0000-4000-8000-000000000008', pg_temp.fx('org'), 'b0000000-0000-4000-8000-000000000005', pg_temp.fx('group'), 'a.old5@deletion.test', 'joined', pg_temp.fx('spouse_a'));
insert into public.family_invites (id, org_id, family_id, family_member_id, invite_email, accepted_at) values
  ('b2000000-0000-4000-8000-000000000001', pg_temp.fx('org'), pg_temp.fx('family'), pg_temp.e(5), 'A.Spouse@deletion.test', null),
  ('b2000000-0000-4000-8000-000000000002', pg_temp.fx('org'), pg_temp.fx('family'), pg_temp.e(5), 'a.old3@deletion.test', null);

-- Photos, on today's keys and on keys from before org partitioning.
insert into storage.objects (bucket_id, name) values
  ('avatars', pg_temp.fx('org') || '/profiles/' || pg_temp.fx('spouse_a') || '/avatar.jpg'),
  ('avatars', pg_temp.fx('spouse_a') || '/avatar.jpg'),
  ('avatars', pg_temp.fx('org') || '/family-members/' || pg_temp.e(1) || '/avatar.jpg'),
  ('avatars', 'family-members/' || pg_temp.e(1) || '/avatar.jpg'),
  ('avatars', pg_temp.fx('org') || '/family-members/' || pg_temp.e(2) || '/avatar.jpg'),
  ('avatars', pg_temp.fx('org') || '/families/' || pg_temp.fx('family') || '/photo.jpg'),
  ('avatars', pg_temp.fx('org') || '/profiles/' || pg_temp.fx('spouse_b') || '/avatar.jpg'),
  ('avatars', pg_temp.fx('org') || '/family-members/' || pg_temp.e(4) || '/avatar.jpg'),
  ('avatars', pg_temp.fx('org') || '/families/' || pg_temp.fx('solo_family') || '/photo.jpg'),
  ('avatars', 'families/' || pg_temp.fx('solo_family') || '/photo.jpg');

-- ── Helpers around the call ─────────────────────────────────────────────────
create temp table result (who text primary key, body jsonb) on commit drop;

-- 'deleted', or the SQLSTATE it raised. Called as the service role, as the app
-- does, with two arguments when no anonymous requests are passed.
create function pg_temp.delete_person(_who text, _org uuid, _requests uuid[] default null)
  returns text language plpgsql as $$
declare _body jsonb; _id uuid := pg_temp.fx(_who);
begin
  set local role service_role;
  if _requests is null then
    _body := public.delete_person(_id, _org);
  else
    _body := public.delete_person(_id, _org, _requests);
  end if;
  set local role none;
  insert into result values (_who, _body);
  return 'deleted';
exception when others then
  set local role none;
  return sqlstate;
end $$;

-- Every row a deletion could touch, so a refusal or rollback is shown to leave
-- all of it as it was.
create function pg_temp.fingerprint() returns text language sql stable as $$
  select concat_ws(',',
    (select count(*) from auth.users), (select count(*) from auth.identities),
    (select count(*) from auth.sessions), (select count(*) from auth.refresh_tokens),
    (select count(*) from public.profiles), (select count(*) from public.group_members),
    (select count(*) from public.serving_signups), (select count(*) from public.serving_signup_attendees),
    (select count(*) from public.giving_funds), (select count(*) from public.giving_fund_methods),
    (select count(*) from public.access_requests), (select count(*) from public.group_invite_uses),
    (select count(*) from public.family_invites), (select count(*) from public.family_members),
    (select count(*) from public.family_units), (select count(*) from public.prayer_requests),
    (select string_agg(created_by::text, ',' order by id) from public.serving_signups where org_id = pg_temp.fx('org')),
    (select string_agg(concat(steward_id, co_steward_id, steward_role, is_active, needs_review), ',' order by id)
       from public.giving_funds where org_id = pg_temp.fx('org')));
$$;

create temp table before_delete (fingerprint text) on commit drop;
insert into before_delete select pg_temp.fingerprint();
create function pg_temp.untouched() returns boolean language sql stable as $$
  select pg_temp.fingerprint() = (select fingerprint from before_delete);
$$;

-- ── Refusals ────────────────────────────────────────────────────────────────
select is(pg_temp.delete_person('spouse_a', pg_temp.fx('other_org')), 'AD001',
  'a church that isn''t theirs gets the same answer as nobody at all');
select ok(pg_temp.untouched(), 'and nothing changes');
select is(pg_temp.delete_person('outsider', pg_temp.fx('org')), 'AD001',
  'an admin can''t reach someone in another church');
select is(pg_temp.delete_person('spouse_a', null), 'AD001', 'a missing church is refused');
select ok(pg_temp.untouched(), 'and nothing changes');
select is(pg_temp.delete_person('operator', pg_temp.fx('org')), 'AD002', 'a platform operator is refused');
select is((select count(*) from public.platform_admins where profile_id = pg_temp.fx('operator')), 1::bigint,
  'and stays an operator');
select ok(pg_temp.untouched(), 'and nothing changes');

-- ── A late failure takes everything back ────────────────────────────────────
-- Fires during the auth.users cascade, the last thing the function does, once
-- every other step has written.
create function pg_temp.late_step() returns trigger language plpgsql as $$
begin
  if current_setting('deletion_suite.fail', true) = 'on' then
    raise exception 'forced late failure' using errcode = 'DS999';
  end if;
  if current_setting('deletion_suite.demote', true) = 'on' then
    update public.profiles set role = 'member' where id = pg_temp.fx('admin_b');
  end if;
  return old;
end $$;
create trigger a_late_step before delete on public.profiles
  for each row execute function pg_temp.late_step();

select set_config('deletion_suite.fail', 'on', true);
select is(pg_temp.delete_person('spouse_a', pg_temp.fx('org'), array[pg_temp.h(1)]), 'DS999',
  'a failure at the last step reaches the caller');
select set_config('deletion_suite.fail', 'off', true);
select ok(pg_temp.untouched(), 'and every earlier step is rolled back with it');
select is((select created_by from public.serving_signups where id = pg_temp.d(1)), pg_temp.fx('spouse_a'),
  'the serving date didn''t move');
select is((select steward_id from public.giving_funds where id = pg_temp.f(1)), pg_temp.fx('spouse_a'),
  'the fund didn''t pass on');
select is((select needs_review from public.giving_funds where id = pg_temp.f(1)), false, 'or need review');
select is((select count(*) from public.family_members where id = pg_temp.e(1)), 1::bigint,
  'the household entry is still there');
select is((select count(*) from public.access_requests where email = 'a.spouse@deletion.test' and org_id = pg_temp.fx('org')), 1::bigint,
  'the access request is still there');
select is((select count(*) from auth.identities where user_id = pg_temp.fx('spouse_a')), 1::bigint,
  'and they can still sign in');
select is((select count(*) from public.prayer_requests where id = pg_temp.h(1)), 1::bigint,
  'and their hashed anonymous request is still there');

-- ── The last church admin ───────────────────────────────────────────────────
-- Another admin is demoted between the check and the cascade, the race the
-- function's own refusal can't see, so the trigger is what refuses.
select set_config('deletion_suite.demote', 'on', true);
select is(pg_temp.delete_person('admin_a', pg_temp.fx('org')), 'CA001',
  'the trigger refuses when the other admin goes after the check');
select set_config('deletion_suite.demote', 'off', true);
select is((select role from public.profiles where id = pg_temp.fx('admin_b')), 'admin',
  'and the demotion that raced it rolls back too');
select ok(pg_temp.untouched(), 'with nothing else changed');
drop trigger a_late_step on public.profiles;

select is(pg_temp.delete_person('admin_b', pg_temp.fx('org')), 'deleted',
  'a church admin can be deleted while another stays');
update before_delete set fingerprint = pg_temp.fingerprint();
select is(pg_temp.delete_person('admin_a', pg_temp.fx('org')), 'CA001',
  'the last church admin is refused');
select ok(pg_temp.untouched(), 'and nothing changes');
select is((select count(*) from auth.users where id = pg_temp.fx('admin_a')), 1::bigint,
  'their login is still there');
select is((select count(*) from public.profiles where id = pg_temp.fx('outsider') and role = 'admin'), 1::bigint,
  'another church''s admin doesn''t count toward this church');
select is(pg_temp.delete_person('outsider', pg_temp.fx('other_org')), 'CA001',
  'and the only admin of that church is refused in the same way');

-- Replies on a series date and on a one-time event, the second dated by the
-- trigger, as a build that sends no date saves it.
with e as (
  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode)
  values (pg_temp.fx('org'), pg_temp.fx('group'), 'Weekly', now() + interval '1 day', 'weekly', 'never')
  returning id)
insert into fx select 'reply_series', id from e;
with e as (
  insert into public.events (org_id, group_id, title, start_time)
  values (pg_temp.fx('org'), pg_temp.fx('group'), 'Once', now() + interval '2 days')
  returning id)
insert into fx select 'reply_single', id from e;
insert into public.rsvps (org_id, event_id, user_id, status, occurrence_date) values
  (pg_temp.fx('org'), pg_temp.fx('reply_series'), pg_temp.fx('spouse_a'), 'yes', current_date + 8),
  (pg_temp.fx('org'), pg_temp.fx('reply_single'), pg_temp.fx('spouse_a'), 'maybe', current_date + 2),
  (pg_temp.fx('org'), pg_temp.fx('reply_series'), pg_temp.fx('spouse_b'), 'no', current_date + 8);

-- ── The delete itself ───────────────────────────────────────────────────────
select is(pg_temp.delete_person('spouse_a', pg_temp.fx('org'),
            array[pg_temp.h(1), pg_temp.h(3), pg_temp.h(4), pg_temp.h(5)]),
  'deleted', 'one spouse is deleted');
select is((select count(*) from public.rsvps where user_id = pg_temp.fx('spouse_a')), 0::bigint,
  'their replies go, for every date');
select is((select count(*) from public.rsvps where user_id = pg_temp.fx('spouse_b')), 1::bigint,
  'and the other spouse''s reply stays');

select is((select count(*) from auth.users where id = pg_temp.fx('spouse_a')), 0::bigint, 'their login is gone');
select is((select count(*) from auth.identities where user_id = pg_temp.fx('spouse_a')), 0::bigint, 'with its identity');
select is((select count(*) from auth.sessions where user_id = pg_temp.fx('spouse_a')), 0::bigint, 'and sessions');
select is((select count(*) from auth.refresh_tokens where token = 'deletion-suite-token'), 0::bigint, 'and refresh tokens');
select is((select count(*) from public.profiles where id = pg_temp.fx('spouse_a')), 0::bigint, 'the profile goes');
select is((select count(*) from public.prayer_requests where body in ('anon 3', 'named 1')), 0::bigint,
  'their requests that still name them go through the foreign key');
select is((select count(*) from public.prayer_requests where id = pg_temp.h(1)), 0::bigint,
  'their hashed anonymous request goes, found by the ids passed in');
select is((select array_agg(id order by id) from public.prayer_requests where id in
             (pg_temp.h(2), pg_temp.h(3), pg_temp.h(4), pg_temp.h(5))),
  array[pg_temp.h(2), pg_temp.h(3), pg_temp.h(4), pg_temp.h(5)],
  'a request not passed in, another church''s, and one that is by name or names its author all stay');
select is((select count(*) from public.group_members where profile_id = pg_temp.fx('spouse_a')), 0::bigint, 'their group memberships go');
select is((select count(*) from public.team_members where profile_id = pg_temp.fx('spouse_a')), 0::bigint, 'their team memberships go');

select is((select created_by from public.serving_signups where id = pg_temp.d(1)), pg_temp.fx('spouse_b'),
  'a date they booked and share moves to the other person');
select is((select array_agg(profile_id) from public.serving_signup_attendees where signup_id = pg_temp.d(1)),
  array[pg_temp.fx('spouse_b')], 'who is the one left on it');
select is((select count(*) from public.serving_signups where id in (pg_temp.d(2), pg_temp.d(3))), 0::bigint,
  'a future date with nobody left on it opens up, whoever booked it');
select is((select created_by from public.serving_signups where id = pg_temp.d(4)), pg_temp.fx('spouse_b'),
  'a date someone else booked with others on it stays');
select is((select count(*) from public.serving_signups where id = pg_temp.d(5)), 0::bigint,
  'a past date they booked alone goes, through the created_by cascade');
select is((select count(*) from public.serving_signups where id = pg_temp.d(6)), 1::bigint,
  'a past date someone else booked for them stays as history');
select is((select count(*) from public.serving_signup_attendees where signup_id = pg_temp.d(6)), 0::bigint,
  'without them on it');
select is((select created_by from public.serving_signups where id = pg_temp.d(7)), pg_temp.fx('spouse_b'),
  'a past date they share moves like a future one');
select is((select jsonb_agg(d->>'service_date' order by d->>'service_date')
            from result, jsonb_array_elements(body->'opened_dates') d where who = 'spouse_a'),
  '["2090-01-08", "2090-01-15"]'::jsonb, 'only the future dates that opened are returned to notify about');
select is((select body->'opened_dates'->0->>'team_name' from result where who = 'spouse_a'), 'Set-up',
  'with the team''s name, which the notice needs');
select is((select body->>'first_name' from result where who = 'spouse_a'), 'Ada',
  'and the person''s name fields, for the notice after their profile is gone');

select is((select steward_id from public.giving_funds where id = pg_temp.f(1)), pg_temp.fx('spouse_b'),
  'a fund with a second person in the group goes to them');
select is((select co_steward_id from public.giving_funds where id = pg_temp.f(1)), null::uuid, 'the second slot empties');
select is((select steward_role from public.giving_funds where id = pg_temp.f(1)), null::text, 'the role clears');
select is((select needs_review from public.giving_funds where id = pg_temp.f(1)), true, 'the fund needs review');
select is((select is_active from public.giving_funds where id = pg_temp.f(1)), true, 'and isn''t retired, so confirming puts it back');
select is((select custom_handle from public.giving_fund_methods where fund_id = pg_temp.f(1)), '@handle',
  'its payment methods stay for a leader to check');
select is((select count(*) from public.giving_funds where id in (pg_temp.f(2), pg_temp.f(3)) and steward_id is null and co_steward_id is null and needs_review),
  2::bigint, 'a fund with no second person in the group stays, with no recipient');
select is((select count(*) from public.giving_fund_methods where fund_id in (pg_temp.f(2), pg_temp.f(3))), 2::bigint, 'with its payment methods');
select is((select co_steward_id from public.giving_funds where id = pg_temp.f(4)), null::uuid,
  'a fund they are second on stays, with the slot empty');
select is((select is_active and not needs_review from public.giving_funds where id = pg_temp.f(4)), true, 'and stays live');
select is((select steward_role from public.giving_funds where id = pg_temp.f(4)), 'Treasurer', 'with its recipient''s role');

select is((select count(*) from public.access_requests where id in
    ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002')), 0::bigint,
  'requests at their address, whatever the case, and linked ones with a spent link go');
select is((select array_agg(name order by name) from public.access_requests where id in
    ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000005')),
  array['Linked, live link', 'Their spouse', 'Wildcard lookalike'],
  'a live setup link, a spouse at an old address and a lookalike address all stay');
select is((select count(*) from public.access_requests where id = 'a0000000-0000-4000-8000-000000000006'), 1::bigint,
  'the same address in another church stays');
select is((select count(*) from public.group_invite_uses where id in (
    'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000003',
    'b1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000007',
    'b1000000-0000-4000-8000-000000000008')), 7::bigint,
  'their invite uses stay, and one at their address with no profile, because max_uses counts them');
select is((select count(*) from public.group_invite_uses where id in (
    'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000003',
    'b1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000007',
    'b1000000-0000-4000-8000-000000000008')
    and (profile_id is not null or access_request_id is not null or coalesce(email, 'deleted') <> 'deleted')), 0::bigint,
  'and none of them holds a profile, a request or an address');
select is((select count(*) from public.group_invite_uses where email = 'deleted'), 3::bigint,
  'a signup_sent use holds the placeholder its constraint requires, not an address');
select is((select count(*) from public.group_invite_uses
    where lower(email) in ('a.spouse@deletion.test', 'a.old@deletion.test', 'a.old2@deletion.test',
                           'a.old4@deletion.test', 'a.old5@deletion.test')), 0::bigint,
  'no use anywhere holds an address of theirs');

-- rows on success, the SQLSTATE on refusal: what someone holding the link gets.
create function pg_temp.redeem(_invite uuid) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform public.group_invite_redeem(
    (select i.token from public.group_invites i where i.id = _invite),
    'Someone New', 'someone.new@deletion.test', 'deletion-suite-new-link', now() + interval '1 day');
  return 'redeemed';
exception when others then
  return sqlstate;
end $$;
create function pg_temp.join_link(_who uuid, _invite uuid) returns text language plpgsql as $$
declare _token uuid := (select i.token from public.group_invites i where i.id = _invite); r text;
begin
  perform pg_temp.enter(_who);
  begin
    r := public.group_invite_join(_token);
  exception when others then
    r := sqlstate;
  end;
  set local role none;
  return r;
end $$;

delete from public.group_members where group_id = pg_temp.fx('group') and profile_id = pg_temp.fx('spouse_b');
select is(pg_temp.redeem('b0000000-0000-4000-8000-000000000002'), 'GI001', 'a link they used up stays dead for a new person');
select is(pg_temp.redeem('b0000000-0000-4000-8000-000000000003'), 'GI001', 'so does one they used through a setup link');
select is(pg_temp.redeem('b0000000-0000-4000-8000-000000000004'), 'GI001', 'and one used at their address with no profile');
select is(pg_temp.join_link(pg_temp.fx('spouse_b'), 'b0000000-0000-4000-8000-000000000002'), 'GI001', 'and for a signed-in member');
select is(pg_temp.redeem('b0000000-0000-4000-8000-000000000005'), 'redeemed', 'positive control: a link with a use left still works');
select is((select count(*) from public.group_invite_uses where id = 'b1000000-0000-4000-8000-000000000004'), 1::bigint,
  'one at an old address with no profile stays');
select is((select array_agg(id) from public.family_invites where id in
    ('b2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002')),
  array['b2000000-0000-4000-8000-000000000002'::uuid],
  'an unclaimed household invite at their address goes, one at an old address stays');

select is((select count(*) from public.family_units where id = pg_temp.fx('family')), 1::bigint, 'the shared household stays');
select is((select family_id from public.profiles where id = pg_temp.fx('spouse_b')), pg_temp.fx('family'),
  'the other spouse stays in it');
select is((select phone_profile_id from public.family_units where id = pg_temp.fx('family')), null::uuid,
  'the household phone stops pointing at them');
select is((select count(*) from public.family_members where id = pg_temp.e(2)), 1::bigint, 'a child''s entry stays');
select is((select count(*) from public.family_members where id = pg_temp.e(1)), 0::bigint, 'their own entry goes');

select is((select author_id from public.announcements where title = 'Kept'), null::uuid,
  'an announcement stays, with the author link cleared');
select is((select profile_id from public.feedback where message = 'Kept without a name'), null::uuid,
  'feedback stays, without a name');

select is((select array_agg(k order by k) from result, jsonb_array_elements_text(body->'photo_keys') k where who = 'spouse_a'),
  (select array_agg(k order by k) from unnest(array[
    pg_temp.fx('org') || '/profiles/' || pg_temp.fx('spouse_a') || '/avatar.jpg',
    pg_temp.fx('spouse_a') || '/avatar.jpg',
    pg_temp.fx('org') || '/family-members/' || pg_temp.e(1) || '/avatar.jpg',
    'family-members/' || pg_temp.e(1) || '/avatar.jpg'
  ]) k),
  'their photos come back on both key layouts, and nobody else''s');

-- ── The last person in a household ──────────────────────────────────────────
select is(pg_temp.delete_person('solo', pg_temp.fx('org')), 'deleted', 'the last person in a household is deleted');
select is((select count(*) from public.family_units where id = pg_temp.fx('solo_family')), 0::bigint, 'the household goes');
select is((select count(*) from public.family_members where id in (pg_temp.e(3), pg_temp.e(4))), 0::bigint, 'with its entries');
select is((select array_agg(k order by k) from result, jsonb_array_elements_text(body->'photo_keys') k where who = 'solo'),
  (select array_agg(k order by k) from unnest(array[
    pg_temp.fx('org') || '/family-members/' || pg_temp.e(4) || '/avatar.jpg',
    pg_temp.fx('org') || '/families/' || pg_temp.fx('solo_family') || '/photo.jpg',
    'families/' || pg_temp.fx('solo_family') || '/photo.jpg'
  ]) k),
  'and every photo in it comes back');

select is(pg_temp.delete_person('solo', pg_temp.fx('org')), 'AD001', 'deleting them again finds nobody');

select * from finish();
rollback;
