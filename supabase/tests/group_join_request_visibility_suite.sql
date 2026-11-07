-- Group join request visibility suite: who can count and list a group's
-- requests to join. The Group settings row and its Requests section show a
-- leader that group's waiting requests; this pins that a member of the group
-- reads none, a leader reads only the groups they lead, and a leader of two
-- groups reads each group's own, through both the table's SELECT policy (the
-- frame's count) and pending_group_join_requests() (the list). Every "none"
-- has a positive control beside it.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/group_join_request_visibility_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- One org. leader_one leads G1 only; leader_two leads G1 and G2; member_one
-- is a plain member of G1. asker_one asks to join G1 and asker_two asks to
-- join G2; neither is in a group. Users are created before any group so the
-- one-group signup enrolment never fires.
do $$
declare
  org uuid;
  owner uuid := gen_random_uuid();
  leader_one uuid := gen_random_uuid();
  leader_two uuid := gen_random_uuid();
  member_one uuid := gen_random_uuid();
  asker_one uuid := gen_random_uuid();
  asker_two uuid := gen_random_uuid();
  grp_one uuid;
  grp_two uuid;
begin
  org := public.provision_organization('Join Request Visibility Org', 'owner@join-visibility.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org, 'Leader One', 'leader-one@join-visibility.example.test', 'approved'),
    (org, 'Leader Two', 'leader-two@join-visibility.example.test', 'approved'),
    (org, 'Member One', 'member-one@join-visibility.example.test', 'approved'),
    (org, 'Asker One', 'asker-one@join-visibility.example.test', 'approved'),
    (org, 'Asker Two', 'asker-two@join-visibility.example.test', 'approved');

  insert into auth.users (id, email) values
    (owner, 'owner@join-visibility.example.test'),
    (leader_one, 'leader-one@join-visibility.example.test'),
    (leader_two, 'leader-two@join-visibility.example.test'),
    (member_one, 'member-one@join-visibility.example.test'),
    (asker_one, 'asker-one@join-visibility.example.test'),
    (asker_two, 'asker-two@join-visibility.example.test');

  insert into public.groups (org_id, name, join_policy, is_private)
    values (org, 'G1', 'approval', false) returning id into grp_one;
  insert into public.groups (org_id, name, join_policy, is_private)
    values (org, 'G2', 'approval', false) returning id into grp_two;

  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org, grp_one, leader_one, 'leader'),
    (org, grp_one, leader_two, 'leader'),
    (org, grp_two, leader_two, 'leader'),
    (org, grp_one, member_one, 'member');

  insert into public.group_join_requests (org_id, group_id, profile_id, status) values
    (org, grp_one, asker_one, 'pending'),
    (org, grp_two, asker_two, 'pending');

  perform set_config('jv.leader_one', leader_one::text, true);
  perform set_config('jv.leader_two', leader_two::text, true);
  perform set_config('jv.member_one', member_one::text, true);
  perform set_config('jv.asker_one', asker_one::text, true);
  perform set_config('jv.asker_two', asker_two::text, true);
  perform set_config('jv.grp_one', grp_one::text, true);
  perform set_config('jv.grp_two', grp_two::text, true);
end $$;

select is(
  (select count(*)::int from public.group_join_requests where status = 'pending'
     and group_id in (current_setting('jv.grp_one')::uuid, current_setting('jv.grp_two')::uuid)),
  2, 'each group has one pending request to join');

-- ── What each person counts and lists ───────────────────────────────────────
-- The count is the frame's read; the list is the Requests section's.
do $$
declare
  grp_one uuid := current_setting('jv.grp_one')::uuid;
  grp_two uuid := current_setting('jv.grp_two')::uuid;
  person text;
  counted_one int; counted_two int; listed_one text; listed_two text;
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);
  foreach person in array array['member_one', 'leader_one', 'leader_two'] loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', current_setting('jv.' || person))::text, true);
    select count(*) into counted_one from public.group_join_requests
      where group_id = grp_one and status = 'pending';
    select count(*) into counted_two from public.group_join_requests
      where group_id = grp_two and status = 'pending';
    select coalesce(string_agg(r.id::text, ','), '') into listed_one
      from public.pending_group_join_requests(grp_one) r;
    select coalesce(string_agg(r.id::text, ','), '') into listed_two
      from public.pending_group_join_requests(grp_two) r;
    perform set_config('jv.' || person || '.counted_one', counted_one::text, true);
    perform set_config('jv.' || person || '.counted_two', counted_two::text, true);
    perform set_config('jv.' || person || '.listed_one', listed_one, true);
    perform set_config('jv.' || person || '.listed_two', listed_two, true);
  end loop;
  reset role;
end $$;

create temp table jv_requests on commit drop as
  select id, group_id, profile_id from public.group_join_requests
  where group_id in (current_setting('jv.grp_one')::uuid, current_setting('jv.grp_two')::uuid);

select is(current_setting('jv.member_one.counted_one')::int, 0,
  'a member of G1 counts none of its requests to join');
select is(current_setting('jv.member_one.listed_one'), '',
  'a member of G1 lists none of its requests to join');
select is(current_setting('jv.member_one.counted_two')::int, 0,
  'a member of G1 counts none of G2''s requests to join');

select is(current_setting('jv.leader_one.counted_one')::int, 1,
  'a leader of G1 counts its one request to join');
select is(current_setting('jv.leader_one.listed_one'),
  (select id::text from jv_requests where profile_id = current_setting('jv.asker_one')::uuid),
  'a leader of G1 lists its requester');
select is(current_setting('jv.leader_one.counted_two')::int, 0,
  'a leader of G1 only counts none of G2''s requests to join');
select is(current_setting('jv.leader_one.listed_two'), '',
  'a leader of G1 only lists none of G2''s requests to join');

select is(current_setting('jv.leader_two.counted_one')::int, 1,
  'a leader of both groups counts G1''s one request');
select is(current_setting('jv.leader_two.counted_two')::int, 1,
  'a leader of both groups counts G2''s one request');
select is(current_setting('jv.leader_two.listed_one'),
  (select id::text from jv_requests where profile_id = current_setting('jv.asker_one')::uuid),
  'a leader of both groups lists G1''s own requester under G1');
select is(current_setting('jv.leader_two.listed_two'),
  (select id::text from jv_requests where profile_id = current_setting('jv.asker_two')::uuid),
  'a leader of both groups lists G2''s own requester under G2');

select * from finish();
rollback;
