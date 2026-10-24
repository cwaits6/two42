-- Group discovery suite: the org switch, the per-group private flag and
-- join policy, the group_join_requests table and the discoverable_groups()
-- / join_group() / pending_group_join_requests() /
-- review_group_join_request() definer functions, exercised from the
-- authenticated role.
--
-- SECURITY DEFINER bypasses RLS, so the org checks inside the functions are
-- the tenant boundary on this surface and no lint sees them; this suite is
-- what pins them. It covers the shape and grants, what a non-member, a
-- member and an org admin each see, open vs approval joining, who may
-- review, the stale request a policy switch leaves behind, the org switch
-- as a ceiling, every direct write path, and the cross-org floor. Every
-- "cannot" has a paired positive control so the suite cannot go green by
-- rejecting everything.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/group_discovery_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Org A: owner_a is the founding admin and is in no group. A1 is public
-- under approval, led by leader_a1 with member_a1 in it; A2 is public and
-- open, led by member_a3; A3 is private with member_a3 in it. seeker_a joins
-- and requests through the suite; lurker_a stays in no group throughout so
-- the visibility assertions always have a non-member to speak for;
-- pending_a signed up and was demoted to pending. Org B: its owner, who
-- leads B1. Users are created before any group so the one-group signup
-- enrolment never fires.
do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  leader_a1 uuid := gen_random_uuid();
  member_a1 uuid := gen_random_uuid();
  member_a3 uuid := gen_random_uuid();
  seeker_a uuid := gen_random_uuid();
  lurker_a uuid := gen_random_uuid();
  pending_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  grp_a1 uuid;
  grp_a2 uuid;
  grp_a3 uuid;
  grp_b1 uuid;
begin
  org_a := public.provision_organization('Group Discovery Org A', 'group-discovery-org-a', 'owner-a@group-discovery.example.test');
  org_b := public.provision_organization('Group Discovery Org B', 'group-discovery-org-b', 'owner-b@group-discovery.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Leader A1', 'leader-a1@group-discovery.example.test', 'approved'),
    (org_a, 'Member A1', 'member-a1@group-discovery.example.test', 'approved'),
    (org_a, 'Member A3', 'member-a3@group-discovery.example.test', 'approved'),
    (org_a, 'Seeker A', 'seeker-a@group-discovery.example.test', 'approved'),
    (org_a, 'Lurker A', 'lurker-a@group-discovery.example.test', 'approved'),
    (org_a, 'Pending A', 'pending-a@group-discovery.example.test', 'approved');

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@group-discovery.example.test'),
    (leader_a1, 'leader-a1@group-discovery.example.test'),
    (member_a1, 'member-a1@group-discovery.example.test'),
    (member_a3, 'member-a3@group-discovery.example.test'),
    (seeker_a, 'seeker-a@group-discovery.example.test'),
    (lurker_a, 'lurker-a@group-discovery.example.test'),
    (pending_a, 'pending-a@group-discovery.example.test'),
    (owner_b, 'owner-b@group-discovery.example.test');

  update public.profiles set role = 'pending' where id = pending_a;
  -- A bare auth.users row carries no name; the leader's list is asserted on these.
  update public.profiles set first_name = 'Seeker', last_name = 'A', preferred_name = 'Sy' where id = seeker_a;
  update public.profiles set first_name = 'Member', last_name = 'A3' where id = member_a3;

  insert into public.groups (org_id, name, description, join_policy, is_private)
    values (org_a, 'A1', 'Thursdays, 7 pm', 'approval', false) returning id into grp_a1;
  insert into public.groups (org_id, name, join_policy, is_private)
    values (org_a, 'A2', 'open', false) returning id into grp_a2;
  insert into public.groups (org_id, name, join_policy, is_private)
    values (org_a, 'A3', 'approval', true) returning id into grp_a3;
  insert into public.groups (org_id, name)
    values (org_b, 'B1') returning id into grp_b1;

  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org_a, grp_a1, leader_a1, 'leader'),
    (org_a, grp_a1, member_a1, 'member'),
    (org_a, grp_a2, member_a3, 'leader'),
    (org_a, grp_a3, member_a3, 'member'),
    (org_b, grp_b1, owner_b, 'leader');

  perform set_config('gd.org_a', org_a::text, true);
  perform set_config('gd.org_b', org_b::text, true);
  perform set_config('gd.owner_a', owner_a::text, true);
  perform set_config('gd.leader_a1', leader_a1::text, true);
  perform set_config('gd.member_a1', member_a1::text, true);
  perform set_config('gd.member_a3', member_a3::text, true);
  perform set_config('gd.seeker_a', seeker_a::text, true);
  perform set_config('gd.lurker_a', lurker_a::text, true);
  perform set_config('gd.pending_a', pending_a::text, true);
  perform set_config('gd.owner_b', owner_b::text, true);
  perform set_config('gd.grp_a1', grp_a1::text, true);
  perform set_config('gd.grp_a2', grp_a2::text, true);
  perform set_config('gd.grp_a3', grp_a3::text, true);
  perform set_config('gd.grp_b1', grp_b1::text, true);
end $$;

select is(
  (select role from public.profiles where id = current_setting('gd.owner_a')::uuid),
  'admin', 'owner_a is the org A admin');
select is(
  (select count(*)::int from public.group_members where profile_id = current_setting('gd.owner_a')::uuid),
  0, 'owner_a is in no group, so every admin-path result below came through the admin arm');
select is(
  (select role from public.profiles where id = current_setting('gd.lurker_a')::uuid),
  'member', 'lurker_a is a plain approved member');
select is(
  (select count(*)::int from public.group_members where profile_id = current_setting('gd.lurker_a')::uuid),
  0, 'lurker_a is in no group');
select is(
  (select group_discovery from public.organizations where id = current_setting('gd.org_a')::uuid),
  true, 'org A starts with discovery on (the column default)');

-- ── 1. Shape and grants ─────────────────────────────────────────────────────
select col_not_null('public', 'organizations', 'group_discovery', 'organizations.group_discovery is NOT NULL');
select col_default_is('public', 'organizations', 'group_discovery', 'true', 'organizations.group_discovery defaults to true');
select ok(has_column_privilege('authenticated', 'public.organizations', 'group_discovery', 'select'),
  'authenticated may read organizations.group_discovery');
select ok(has_column_privilege('authenticated', 'public.organizations', 'group_discovery', 'update'),
  'authenticated may update organizations.group_discovery (the policy narrows it to the org admin)');
select ok(not has_column_privilege('anon', 'public.organizations', 'group_discovery', 'select'),
  'anon may not read organizations.group_discovery');

select col_not_null('public', 'groups', 'is_private', 'groups.is_private is NOT NULL');
select col_default_is('public', 'groups', 'is_private', 'false', 'groups.is_private defaults to false');
select col_not_null('public', 'groups', 'join_policy', 'groups.join_policy is NOT NULL');
select col_default_is('public', 'groups', 'join_policy', 'approval', 'groups.join_policy defaults to approval');
select throws_ok(
  format($q$ update public.groups set join_policy = 'invite' where id = %L $q$, current_setting('gd.grp_a1')),
  '23514', null, 'join_policy refuses a value outside open / approval');

select ok(
  (select pg_get_expr(d.adbin, d.adrelid) in ('app_current_org_id()', 'public.app_current_org_id()')
     from pg_catalog.pg_attrdef d
     join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
     where d.adrelid = 'public.group_join_requests'::regclass and a.attname = 'org_id'),
  'group_join_requests.org_id defaults to app_current_org_id()');
select throws_ok(
  format($q$ insert into public.group_join_requests (org_id, group_id, profile_id, status)
           values (%L, %L, %L, 'withdrawn') $q$,
    current_setting('gd.org_a'), current_setting('gd.grp_a1'), current_setting('gd.lurker_a')),
  '23514', null, 'group_join_requests.status refuses a value outside pending / approved / declined');
select ok(
  (select indexdef like '%WHERE (status = ''pending''%'
     from pg_catalog.pg_indexes
     where schemaname = 'public' and indexname = 'group_join_requests_one_pending_idx'),
  'one pending request per (group, member) is a partial unique index');
select is(
  (select count(*)::int from unnest(array['group_join_requests_group_id_fkey', 'group_join_requests_profile_id_fkey']) as c(name)
   where exists (
     select 1 from pg_constraint con
     where con.conname = c.name and con.contype = 'f'
       and (select array_agg(a.attname::text order by a.attname)
            from unnest(con.conkey) k(attnum)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum)
           in (array['group_id', 'org_id'], array['org_id', 'profile_id']))),
  2, 'both FKs out of group_join_requests are composite on org_id');
select is(
  (select count(*)::int from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'group_join_requests' and permissive = 'RESTRICTIVE'),
  1, 'group_join_requests carries exactly one restrictive isolation policy');
select is(
  (select coalesce(array_agg(cmd order by cmd), '{}') from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'group_join_requests' and permissive = 'PERMISSIVE'),
  array['SELECT'], 'the only permissive policy on group_join_requests is the SELECT');
select ok(
  not has_table_privilege('authenticated', 'public.group_join_requests', 'insert')
  and not has_table_privilege('authenticated', 'public.group_join_requests', 'update')
  and not has_table_privilege('authenticated', 'public.group_join_requests', 'delete'),
  'authenticated holds no INSERT, UPDATE or DELETE on group_join_requests');
select ok(
  not has_table_privilege('anon', 'public.group_join_requests', 'insert')
  and not has_table_privilege('anon', 'public.group_join_requests', 'update')
  and not has_table_privilege('anon', 'public.group_join_requests', 'delete'),
  'anon holds no INSERT, UPDATE or DELETE on group_join_requests');
select ok(has_table_privilege('authenticated', 'public.group_join_requests', 'select'),
  'positive control: authenticated holds SELECT on group_join_requests');

select has_function('public', 'discoverable_groups', array[]::text[], 'discoverable_groups() exists');
select has_function('public', 'join_group', array['uuid'], 'join_group(uuid) exists');
select has_function('public', 'join_group_apply', array['uuid', 'uuid'], 'join_group_apply(uuid, uuid) exists');
select has_function('public', 'pending_group_join_requests', array['uuid'], 'pending_group_join_requests(uuid) exists');
select has_function('public', 'review_group_join_request', array['uuid', 'boolean'], 'review_group_join_request(uuid, boolean) exists');
select is_definer('public', 'discoverable_groups', array[]::text[], 'discoverable_groups() is SECURITY DEFINER');
select is_definer('public', 'join_group', array['uuid'], 'join_group() is SECURITY DEFINER');
select is_definer('public', 'pending_group_join_requests', array['uuid'], 'pending_group_join_requests() is SECURITY DEFINER');
select is_definer('public', 'review_group_join_request', array['uuid', 'boolean'], 'review_group_join_request() is SECURITY DEFINER');
select isnt_definer('public', 'join_group_apply', array['uuid', 'uuid'],
  'join_group_apply() is a plain function reached only through the definer entry points');

select ok(has_function_privilege('authenticated', 'public.discoverable_groups()', 'execute'),
  'authenticated can execute discoverable_groups()');
select ok(has_function_privilege('authenticated', 'public.join_group(uuid)', 'execute'),
  'authenticated can execute join_group()');
select ok(has_function_privilege('authenticated', 'public.pending_group_join_requests(uuid)', 'execute'),
  'authenticated can execute pending_group_join_requests()');
select ok(has_function_privilege('authenticated', 'public.review_group_join_request(uuid, boolean)', 'execute'),
  'authenticated can execute review_group_join_request()');
select ok(not has_function_privilege('anon', 'public.discoverable_groups()', 'execute'),
  'anon cannot execute discoverable_groups()');
select ok(not has_function_privilege('anon', 'public.join_group(uuid)', 'execute'),
  'anon cannot execute join_group()');
select ok(not has_function_privilege('anon', 'public.pending_group_join_requests(uuid)', 'execute'),
  'anon cannot execute pending_group_join_requests()');
select ok(not has_function_privilege('anon', 'public.review_group_join_request(uuid, boolean)', 'execute'),
  'anon cannot execute review_group_join_request()');
select ok(not has_function_privilege('anon', 'public.join_group_apply(uuid, uuid)', 'execute'),
  'anon cannot execute join_group_apply()');
select ok(not has_function_privilege('authenticated', 'public.join_group_apply(uuid, uuid)', 'execute'),
  'authenticated cannot execute join_group_apply()');
select ok(not has_function_privilege('service_role', 'public.join_group_apply(uuid, uuid)', 'execute'),
  'service_role cannot execute join_group_apply()');

-- ── 2. A private group is invisible and unjoinable for a non-member ─────────
do $$
declare
  grp_a3 uuid := current_setting('gd.grp_a3')::uuid;
  lurker_a uuid := current_setting('gd.lurker_a')::uuid;
  member_a3 uuid := current_setting('gd.member_a3')::uuid;
  owner_a uuid := current_setting('gd.owner_a')::uuid;
  lurker_list text; lurker_reads_a3 bigint; join_err text := 'none';
  a3_for_member text; a3_for_owner text; owner_list text;
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);

  perform set_config('request.jwt.claims', json_build_object('sub', lurker_a)::text, true);
  select string_agg(name || ':' || coalesce(viewer_role, '-') || ':' || join_policy || ':' || member_count, ',' order by name)
    into lurker_list from public.discoverable_groups();
  select count(*) into lurker_reads_a3 from public.groups where id = grp_a3;
  begin
    perform public.join_group(grp_a3);
  exception when others then
    join_err := sqlstate;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a3)::text, true);
  select name || ':' || coalesce(viewer_role, '-') || ':' || is_private::text
    into a3_for_member from public.discoverable_groups() where id = grp_a3;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  select name || ':' || coalesce(viewer_role, '-') || ':' || is_private::text
    into a3_for_owner from public.discoverable_groups() where id = grp_a3;
  select string_agg(name, ',' order by name) into owner_list from public.discoverable_groups();

  reset role;
  perform set_config('gd.s2_lurker_list', lurker_list, true);
  perform set_config('gd.s2_lurker_reads_a3', lurker_reads_a3::text, true);
  perform set_config('gd.s2_join_err', join_err, true);
  perform set_config('gd.s2_a3_for_member', coalesce(a3_for_member, 'none'), true);
  perform set_config('gd.s2_a3_for_owner', coalesce(a3_for_owner, 'none'), true);
  perform set_config('gd.s2_owner_list', owner_list, true);
end $$;

select is(current_setting('gd.s2_lurker_list'), 'A1:-:approval:2,A2:-:open:1',
  'a non-member lists the two public groups with no role, their policy and member count, and not the private one');
select is(current_setting('gd.s2_lurker_reads_a3')::int, 0,
  'the groups SELECT policy still hides the private group from a non-member, so its deep link stays a 404');
select is(current_setting('gd.s2_join_err'), 'GJ001',
  'join_group() on the private group gets GJ001, the same as an unknown id');
select is(
  (select count(*)::int from public.group_members
    where group_id = current_setting('gd.grp_a3')::uuid and profile_id = current_setting('gd.lurker_a')::uuid),
  0, 'and no membership was written');
select is(current_setting('gd.s2_a3_for_member'), 'A3:member:true',
  'positive control: a member of the private group lists it with their role');
select is(current_setting('gd.s2_a3_for_owner'), 'A3:-:true',
  'the org admin lists the private group with is_private set and no role');
select is(current_setting('gd.s2_owner_list'), 'A1,A2,A3',
  'the org admin lists every group in the org and nothing from org B');

-- ── 3. Open joins at once; approval files one pending request ───────────────
do $$
declare
  grp_a1 uuid := current_setting('gd.grp_a1')::uuid;
  grp_a2 uuid := current_setting('gd.grp_a2')::uuid;
  seeker_a uuid := current_setting('gd.seeker_a')::uuid;
  open_result text; again_err text := 'none';
  request_result text; request_again text; pending_rows bigint; a1_row text;
  own_requests bigint;
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims', json_build_object('sub', seeker_a)::text, true);

  open_result := public.join_group(grp_a2);
  begin
    perform public.join_group(grp_a2);
  exception when others then
    again_err := sqlstate;
  end;

  request_result := public.join_group(grp_a1);
  request_again := public.join_group(grp_a1);
  select count(*) into own_requests from public.group_join_requests;
  select name || ':' || coalesce(viewer_role, '-') || ':' || coalesce(request_status, '-')
    into a1_row from public.discoverable_groups() where id = grp_a1;

  reset role;
  select count(*) into pending_rows from public.group_join_requests
    where group_id = grp_a1 and profile_id = seeker_a and status = 'pending';

  perform set_config('gd.s3_open_result', open_result, true);
  perform set_config('gd.s3_again_err', again_err, true);
  perform set_config('gd.s3_request_result', request_result, true);
  perform set_config('gd.s3_request_again', request_again, true);
  perform set_config('gd.s3_pending_rows', pending_rows::text, true);
  perform set_config('gd.s3_a1_row', a1_row, true);
  perform set_config('gd.s3_own_requests', own_requests::text, true);
end $$;

select is(current_setting('gd.s3_open_result'), 'joined',
  'join_group() on an open group returns joined');
select is(
  (select role || ':' || (added_by = profile_id)::text || ':' || (org_id = current_setting('gd.org_a')::uuid)::text
     from public.group_members
     where group_id = current_setting('gd.grp_a2')::uuid and profile_id = current_setting('gd.seeker_a')::uuid),
  'member:true:true', 'and writes one membership as member, added by the joiner, in org A');
select is(current_setting('gd.s3_again_err'), 'GJ003',
  'joining the same group again gets GJ003');
select is(current_setting('gd.s3_request_result'), 'requested',
  'join_group() on an approval group returns requested');
select is(current_setting('gd.s3_request_again'), 'requested',
  'asking again still returns requested');
select is(current_setting('gd.s3_pending_rows')::int, 1,
  'and there is exactly one pending request: the partial unique index absorbed the repeat');
select is(
  (select count(*)::int from public.group_members
    where group_id = current_setting('gd.grp_a1')::uuid and profile_id = current_setting('gd.seeker_a')::uuid),
  0, 'no membership was written for the approval group');
select is(current_setting('gd.s3_a1_row'), 'A1:-:pending',
  'the requester''s discovery row for that group reads request_status = pending');
select is(current_setting('gd.s3_own_requests')::int, 1,
  'the requester reads their own request through the SELECT policy');

-- ── 4. Cross-org floor ──────────────────────────────────────────────────────
do $$
declare
  org_a uuid := current_setting('gd.org_a')::uuid;
  grp_a2 uuid := current_setting('gd.grp_a2')::uuid;
  owner_b uuid := current_setting('gd.owner_b')::uuid;
  req uuid;
  b_list text; b_join_err text := 'none'; b_reads bigint; b_review_err text := 'none';
  b_pending bigint;
begin
  select id into req from public.group_join_requests
    where group_id = current_setting('gd.grp_a1')::uuid and status = 'pending';

  set local role authenticated;
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);

  select string_agg(name, ',' order by name) into b_list from public.discoverable_groups();
  begin
    perform public.join_group(grp_a2);
  exception when others then
    b_join_err := sqlstate;
  end;
  select count(*) into b_reads from public.group_join_requests where org_id = org_a;
  select count(*) into b_pending from public.pending_group_join_requests(current_setting('gd.grp_a1')::uuid);
  begin
    perform public.review_group_join_request(req, true);
  exception when others then
    b_review_err := sqlstate;
  end;

  reset role;
  perform set_config('gd.req_seeker_a1', req::text, true);
  perform set_config('gd.s4_b_list', b_list, true);
  perform set_config('gd.s4_b_join_err', b_join_err, true);
  perform set_config('gd.s4_b_reads', b_reads::text, true);
  perform set_config('gd.s4_b_pending', b_pending::text, true);
  perform set_config('gd.s4_b_review_err', b_review_err, true);
end $$;

select is(current_setting('gd.s4_b_list'), 'B1',
  'org B''s admin lists only org B''s group (non-vacuity: org A has three)');
select is(current_setting('gd.s4_b_join_err'), 'GJ001',
  'org B''s admin joining an open org A group gets GJ001, the same as an unknown id');
select is(current_setting('gd.s4_b_reads')::int, 0,
  'org B''s admin reads none of org A''s join requests');
select is(current_setting('gd.s4_b_pending')::int, 0,
  'org B''s admin gets an empty pending list for an org A group');
select is(current_setting('gd.s4_b_review_err'), 'GJ004',
  'org B''s admin reviewing an org A request gets GJ004, the same as a missing id');
select is(
  (select status from public.group_join_requests where id = current_setting('gd.req_seeker_a1')::uuid),
  'pending', 'and the org A request stays pending');

-- ── 5. Only leaders and org admins list and review ──────────────────────────
do $$
declare
  grp_a1 uuid := current_setting('gd.grp_a1')::uuid;
  leader_a1 uuid := current_setting('gd.leader_a1')::uuid;
  member_a1 uuid := current_setting('gd.member_a1')::uuid;
  member_a3 uuid := current_setting('gd.member_a3')::uuid;
  owner_a uuid := current_setting('gd.owner_a')::uuid;
  req uuid := current_setting('gd.req_seeker_a1')::uuid;
  req2 uuid; req3 uuid;
  member_sees bigint; leader_row text; member_review_err text := 'none';
  approve_result text; again_err text := 'none'; ghost_err text := 'none';
  hidden_email_row text; decline_result text; refile_result text; admin_result text;
  decline_members bigint;
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);

  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  select count(*) into member_sees from public.pending_group_join_requests(grp_a1);
  begin
    perform public.review_group_join_request(req, true);
  exception when others then
    member_review_err := sqlstate;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  select coalesce(first_name, '-') || ':' || coalesce(last_name, '-') || ':' || coalesce(preferred_name, '-') || ':' || coalesce(email, '-')
    into leader_row from public.pending_group_join_requests(grp_a1);
  approve_result := public.review_group_join_request(req, true);
  begin
    perform public.review_group_join_request(req, true);
  exception when others then
    again_err := sqlstate;
  end;
  begin
    perform public.review_group_join_request(gen_random_uuid(), false);
  exception when others then
    ghost_err := sqlstate;
  end;

  -- A second requester, with their email hidden, for the decline path.
  reset role;
  update public.profiles set hide_email = true where id = member_a3;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a3)::text, true);
  perform public.join_group(grp_a1);
  reset role;
  select id into req2 from public.group_join_requests
    where group_id = grp_a1 and profile_id = member_a3 and status = 'pending';
  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  select coalesce(first_name, '-') || ':' || coalesce(email, '-')
    into hidden_email_row from public.pending_group_join_requests(grp_a1);
  decline_result := public.review_group_join_request(req2, false);
  reset role;
  select count(*) into decline_members from public.group_members
    where group_id = grp_a1 and profile_id = member_a3;
  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a3)::text, true);
  refile_result := public.join_group(grp_a1);
  reset role;
  select id into req3 from public.group_join_requests
    where group_id = grp_a1 and profile_id = member_a3 and status = 'pending';
  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  admin_result := public.review_group_join_request(req3, true);

  reset role;
  perform set_config('gd.req2', req2::text, true);
  perform set_config('gd.req3', req3::text, true);
  perform set_config('gd.s5_member_sees', member_sees::text, true);
  perform set_config('gd.s5_leader_row', coalesce(leader_row, 'none'), true);
  perform set_config('gd.s5_member_review_err', member_review_err, true);
  perform set_config('gd.s5_approve_result', approve_result, true);
  perform set_config('gd.s5_again_err', again_err, true);
  perform set_config('gd.s5_ghost_err', ghost_err, true);
  perform set_config('gd.s5_hidden_email_row', coalesce(hidden_email_row, 'none'), true);
  perform set_config('gd.s5_decline_result', decline_result, true);
  perform set_config('gd.s5_decline_members', decline_members::text, true);
  perform set_config('gd.s5_refile_result', refile_result, true);
  perform set_config('gd.s5_admin_result', admin_result, true);
end $$;

select is(current_setting('gd.s5_member_sees')::int, 0,
  'a plain member of the group gets an empty pending list');
select is(current_setting('gd.s5_member_review_err'), 'GJ004',
  'a plain member reviewing a request gets GJ004');
select is(current_setting('gd.s5_leader_row'), 'Seeker:A:Sy:seeker-a@group-discovery.example.test',
  'positive control: the leader lists the request with the requester''s names, preferred name and email');
select is(current_setting('gd.s5_approve_result'), 'approved',
  'the leader''s approve returns approved');
select is(
  (select role || ':' || (added_by = current_setting('gd.leader_a1')::uuid)::text
     from public.group_members
     where group_id = current_setting('gd.grp_a1')::uuid and profile_id = current_setting('gd.seeker_a')::uuid),
  'member:true', 'and writes the membership as member, added by the leader');
select is(
  (select status || ':' || (reviewed_by = current_setting('gd.leader_a1')::uuid)::text || ':' || (reviewed_at is not null)::text
     from public.group_join_requests where id = current_setting('gd.req_seeker_a1')::uuid),
  'approved:true:true', 'the request is approved and stamped with the reviewer');
select is(current_setting('gd.s5_again_err'), 'GJ004',
  'reviewing the same request again gets GJ004');
select is(current_setting('gd.s5_ghost_err'), 'GJ004',
  'reviewing an id that never existed gets GJ004');
select is(current_setting('gd.s5_hidden_email_row'), 'Member:-',
  'a requester with hide_email set is listed without their email');
select is(current_setting('gd.s5_decline_result'), 'declined',
  'the leader''s decline returns declined');
select is(
  (select status || ':' || (reviewed_by = current_setting('gd.leader_a1')::uuid)::text
     from public.group_join_requests where id = current_setting('gd.req2')::uuid),
  'declined:true', 'and the request is declined with the reviewer stamped');
select is(current_setting('gd.s5_decline_members')::int, 0,
  'a decline writes no membership');
select is(current_setting('gd.s5_refile_result'), 'requested',
  'a declined requester may ask again');
select is(current_setting('gd.s5_admin_result'), 'approved',
  'positive control for the admin arm: the org admin, in no group, approves the new request');
select is(
  (select count(*)::int from public.group_members
    where group_id = current_setting('gd.grp_a1')::uuid and profile_id = current_setting('gd.member_a3')::uuid),
  1, 'and the membership is written');

-- ── 5b. Review stays inside the group, the flag and the requester ───────────
-- A leader of a different group in the same org holds no review rights here;
-- lurker_a's request is the subject, filed under approval and left pending.
do $$
declare
  grp_a1 uuid := current_setting('gd.grp_a1')::uuid;
  leader_a1 uuid := current_setting('gd.leader_a1')::uuid;
  member_a3 uuid := current_setting('gd.member_a3')::uuid;
  lurker_a uuid := current_setting('gd.lurker_a')::uuid;
  req4 uuid;
  other_rows bigint; other_err text := 'none'; lead_rows bigint;
  null_err text := 'none'; null_status text; stale_err text := 'none';
  stale_members bigint; control_result text;
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims', json_build_object('sub', lurker_a)::text, true);
  perform public.join_group(grp_a1);
  reset role;
  select id into req4 from public.group_join_requests
    where group_id = grp_a1 and profile_id = lurker_a and status = 'pending';
  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a3)::text, true);
  select count(*) into other_rows from public.pending_group_join_requests(grp_a1);
  begin
    perform public.review_group_join_request(req4, true);
  exception when others then
    other_err := sqlstate;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  select count(*) into lead_rows from public.pending_group_join_requests(grp_a1);
  begin
    perform public.review_group_join_request(req4, null);
  exception when others then
    null_err := sqlstate;
  end;
  reset role;
  select status into null_status from public.group_join_requests where id = req4;

  update public.profiles set role = 'pending' where id = lurker_a;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  begin
    perform public.review_group_join_request(req4, true);
  exception when others then
    stale_err := sqlstate;
  end;
  reset role;
  select count(*) into stale_members from public.group_members
    where group_id = grp_a1 and profile_id = lurker_a;
  update public.profiles set role = 'member' where id = lurker_a;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  control_result := public.review_group_join_request(req4, false);
  reset role;

  perform set_config('gd.s5b_other_rows', other_rows::text, true);
  perform set_config('gd.s5b_other_err', other_err, true);
  perform set_config('gd.s5b_lead_rows', lead_rows::text, true);
  perform set_config('gd.s5b_null_err', null_err, true);
  perform set_config('gd.s5b_null_status', null_status, true);
  perform set_config('gd.s5b_stale_err', stale_err, true);
  perform set_config('gd.s5b_stale_members', stale_members::text, true);
  perform set_config('gd.s5b_control_result', control_result, true);
end $$;

select is(current_setting('gd.s5b_lead_rows')::int, 1,
  'positive control: the group''s own leader lists the pending request');
select is(current_setting('gd.s5b_other_rows')::int, 0,
  'a leader of a different group in the same org gets an empty pending list');
select is(current_setting('gd.s5b_other_err'), 'GJ004',
  'and reviewing the request gets GJ004');
select is(current_setting('gd.s5b_null_err'), '22004',
  'a NULL approve flag is rejected with 22004');
select is(current_setting('gd.s5b_null_status'), 'pending',
  'and leaves the request pending');
select is(current_setting('gd.s5b_stale_err'), 'GJ002',
  'approving a requester who has since been demoted to pending gets GJ002');
select is(current_setting('gd.s5b_stale_members')::int, 0,
  'and writes no membership');
select is(current_setting('gd.s5b_control_result'), 'declined',
  'positive control: the group''s own leader still reviews the request once the account is active');

-- ── 6. A stale request under an open policy ─────────────────────────────────
-- A pending request filed under approval; the policy flips to open; joining
-- resolves the request with nobody as reviewer.
update public.groups set join_policy = 'approval' where id = current_setting('gd.grp_a2')::uuid;
do $$
declare
  grp_a2 uuid := current_setting('gd.grp_a2')::uuid;
  member_a1 uuid := current_setting('gd.member_a1')::uuid;
  first_result text; second_result text;
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  first_result := public.join_group(grp_a2);
  reset role;

  update public.groups set join_policy = 'open' where id = grp_a2;

  set local role authenticated;
  second_result := public.join_group(grp_a2);
  reset role;

  perform set_config('gd.s6_first_result', first_result, true);
  perform set_config('gd.s6_second_result', second_result, true);
end $$;

select is(current_setting('gd.s6_first_result'), 'requested',
  'under approval the member''s join_group() files a request');
select is(current_setting('gd.s6_second_result'), 'joined',
  'once the policy is open the same member''s join_group() joins');
select is(
  (select status || ':' || coalesce(reviewed_by::text, 'nobody') || ':' || (reviewed_at is not null)::text
     from public.group_join_requests
     where group_id = current_setting('gd.grp_a2')::uuid and profile_id = current_setting('gd.member_a1')::uuid),
  'approved:nobody:true', 'and the stale request reads approved with no reviewer');

-- ── 7. The org switch is a ceiling ──────────────────────────────────────────
update public.organizations set group_discovery = false where id = current_setting('gd.org_a')::uuid;
do $$
declare
  grp_a1 uuid := current_setting('gd.grp_a1')::uuid;
  lurker_a uuid := current_setting('gd.lurker_a')::uuid;
  member_a1 uuid := current_setting('gd.member_a1')::uuid;
  owner_a uuid := current_setting('gd.owner_a')::uuid;
  lurker_rows bigint; member_list text; owner_rows bigint; join_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);

  perform set_config('request.jwt.claims', json_build_object('sub', lurker_a)::text, true);
  select count(*) into lurker_rows from public.discoverable_groups();
  begin
    perform public.join_group(grp_a1);
  exception when others then
    join_err := sqlstate;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  select string_agg(name || ':' || coalesce(viewer_role, '-'), ',' order by name) into member_list from public.discoverable_groups();

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  select count(*) into owner_rows from public.discoverable_groups();

  reset role;
  perform set_config('gd.s7_lurker_rows', lurker_rows::text, true);
  perform set_config('gd.s7_join_err', join_err, true);
  perform set_config('gd.s7_member_list', member_list, true);
  perform set_config('gd.s7_owner_rows', owner_rows::text, true);
end $$;
update public.organizations set group_discovery = true where id = current_setting('gd.org_a')::uuid;

select is(current_setting('gd.s7_lurker_rows')::int, 0,
  'with discovery off a member in no group lists nothing');
select is(current_setting('gd.s7_join_err'), 'GJ001',
  'and join_group() on a public group gets GJ001');
select is(current_setting('gd.s7_member_list'), 'A1:member,A2:member',
  'a member lists exactly their own groups');
select is(current_setting('gd.s7_owner_rows')::int, 0,
  'the org admin, in no group, lists nothing either: the switch is a ceiling for admins too');

-- ── 8. A pending account gets nothing ───────────────────────────────────────
do $$
declare
  grp_a2 uuid := current_setting('gd.grp_a2')::uuid;
  pending_a uuid := current_setting('gd.pending_a')::uuid;
  rows_seen bigint; join_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pending_a)::text, true);
  select count(*) into rows_seen from public.discoverable_groups();
  begin
    perform public.join_group(grp_a2);
  exception when others then
    join_err := sqlstate;
  end;
  reset role;
  perform set_config('gd.s8_rows_seen', rows_seen::text, true);
  perform set_config('gd.s8_join_err', join_err, true);
end $$;

select is(current_setting('gd.s8_rows_seen')::int, 0,
  'a pending account''s discoverable_groups() returns no rows');
select is(current_setting('gd.s8_join_err'), 'GJ002',
  'a pending account''s join_group() gets GJ002');

-- ── 9. Direct write paths ───────────────────────────────────────────────────
do $$
declare
  org_a uuid := current_setting('gd.org_a')::uuid;
  grp_a1 uuid := current_setting('gd.grp_a1')::uuid;
  leader_a1 uuid := current_setting('gd.leader_a1')::uuid;
  member_a1 uuid := current_setting('gd.member_a1')::uuid;
  lurker_a uuid := current_setting('gd.lurker_a')::uuid;
  owner_a uuid := current_setting('gd.owner_a')::uuid;
  leader_private bigint; member_private bigint; leader_policy bigint; member_policy bigint;
  admin_switch bigint; member_switch bigint;
  insert_err text := 'none'; update_err text := 'none'; delete_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);

  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  update public.groups set is_private = true where id = grp_a1;
  get diagnostics leader_private = row_count;
  update public.groups set join_policy = 'open' where id = grp_a1;
  get diagnostics leader_policy = row_count;
  begin
    insert into public.group_join_requests (org_id, group_id, profile_id) values (org_a, grp_a1, lurker_a);
  exception when others then
    insert_err := sqlstate;
  end;
  begin
    update public.group_join_requests set status = 'approved', reviewed_at = now() where group_id = grp_a1;
  exception when others then
    update_err := sqlstate;
  end;
  begin
    delete from public.group_join_requests where group_id = grp_a1;
  exception when others then
    delete_err := sqlstate;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  update public.groups set is_private = false where id = grp_a1;
  get diagnostics member_private = row_count;
  update public.groups set join_policy = 'approval' where id = grp_a1;
  get diagnostics member_policy = row_count;
  update public.organizations set group_discovery = false where id = org_a;
  get diagnostics member_switch = row_count;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  update public.organizations set group_discovery = false where id = org_a;
  get diagnostics admin_switch = row_count;

  reset role;
  perform set_config('gd.s9_leader_private', leader_private::text, true);
  perform set_config('gd.s9_member_private', member_private::text, true);
  perform set_config('gd.s9_leader_policy', leader_policy::text, true);
  perform set_config('gd.s9_member_policy', member_policy::text, true);
  perform set_config('gd.s9_admin_switch', admin_switch::text, true);
  perform set_config('gd.s9_member_switch', member_switch::text, true);
  perform set_config('gd.s9_insert_err', insert_err, true);
  perform set_config('gd.s9_update_err', update_err, true);
  perform set_config('gd.s9_delete_err', delete_err, true);
end $$;

select is(current_setting('gd.s9_leader_private')::int, 1,
  'the leader''s is_private change matches one row');
select is(current_setting('gd.s9_member_private')::int, 0,
  'a member''s is_private change matches zero rows');
select is(current_setting('gd.s9_leader_policy')::int, 1,
  'the leader''s join_policy change matches one row');
select is(current_setting('gd.s9_member_policy')::int, 0,
  'a member''s join_policy change matches zero rows');
select is(
  (select is_private::text || ':' || join_policy from public.groups where id = current_setting('gd.grp_a1')::uuid),
  'true:open', 'and the group carries what the leader set');
select is(current_setting('gd.s9_admin_switch')::int, 1,
  'the org admin''s discovery switch change matches one row');
select is(current_setting('gd.s9_member_switch')::int, 0,
  'a member''s discovery switch change matches zero rows');
select is(
  (select group_discovery from public.organizations where id = current_setting('gd.org_a')::uuid),
  false, 'and the org carries what the admin set');
select is(current_setting('gd.s9_insert_err'), '42501',
  'a leader cannot insert a join request directly: the table grants no INSERT');
select is(current_setting('gd.s9_update_err'), '42501',
  'a leader cannot update a join request directly: the table grants no UPDATE');
select is(current_setting('gd.s9_delete_err'), '42501',
  'a leader cannot delete a join request directly: the table grants no DELETE');

select * from finish();
rollback;
