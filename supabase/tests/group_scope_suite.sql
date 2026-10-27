-- Group scope suite: the content tables after the group_id flip.
--
-- Proves, against fixture groups in one org, that a member of group A reads
-- none of group B's content and that a leader of B cannot write into A; that
-- an org admin outside both groups reads nothing (their power is over
-- people); that the structural pins hold (NOT NULL, composite FK, the
-- about_page key, the serving rename, the calendar color boundary); that
-- group_settings and prayer_wall follow the same rule; that the calendar
-- fold is idempotent; and that the signup RPC admits a group leader. Every
-- "cannot" assertion has a paired positive control.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/group_scope_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- One org, two groups. owner leads A, member_a is a plain member of A,
-- leader_b leads B, admin_x is an org admin in no group. One row per content
-- table in each group, seeded as postgres.
do $$
declare
  org uuid;
  owner uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
  leader_b uuid := gen_random_uuid();
  admin_x uuid := gen_random_uuid();
  grp_a uuid; grp_b uuid;
  team_a uuid; team_b uuid;
  cal_a uuid; cal_b uuid;
  event_a uuid; event_b uuid;
  series_a uuid; series_b uuid;
  fund_a uuid; fund_b uuid;
  request_a uuid; request_b uuid;
  signup_a uuid; signup_b uuid;
  sunday date := current_date + (7 - extract(dow from current_date)::int);
begin
  org := public.provision_organization('Group Scope Org', 'owner@group-scope.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org, 'Member A', 'member-a@group-scope.example.test', 'approved'),
    (org, 'Leader B', 'leader-b@group-scope.example.test', 'approved'),
    (org, 'Admin X', 'admin-x@group-scope.example.test', 'approved');
  insert into auth.users (id, email) values
    (owner, 'owner@group-scope.example.test'),
    (member_a, 'member-a@group-scope.example.test'),
    (leader_b, 'leader-b@group-scope.example.test'),
    (admin_x, 'admin-x@group-scope.example.test');
  update public.profiles set role = 'admin' where id = admin_x;

  insert into public.groups (org_id, name) values (org, 'Group A') returning id into grp_a;
  insert into public.groups (org_id, name) values (org, 'Group B') returning id into grp_b;
  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org, grp_a, owner, 'leader'),
    (org, grp_a, member_a, 'member'),
    (org, grp_b, leader_b, 'leader');

  insert into public.teams (org_id, group_id, name, is_serving_role)
    values (org, grp_a, 'A team', true) returning id into team_a;
  insert into public.teams (org_id, group_id, name, is_serving_role)
    values (org, grp_b, 'B team', true) returning id into team_b;
  insert into public.team_members (org_id, profile_id, team_id) values
    (org, member_a, team_a), (org, leader_b, team_b);
  insert into public.serving_team_settings (org_id, team_id, enabled) values
    (org, team_a, true), (org, team_b, true);
  insert into public.serving_signups (org_id, team_id, service_date, created_by)
    values (org, team_a, sunday, member_a) returning id into signup_a;
  insert into public.serving_signups (org_id, team_id, service_date, created_by)
    values (org, team_b, sunday, leader_b) returning id into signup_b;
  insert into public.serving_signup_attendees (org_id, signup_id, profile_id) values
    (org, signup_a, member_a), (org, signup_b, leader_b);
  insert into public.serving_broadcasts (org_id, team_id, sent_by, subject) values
    (org, team_a, owner, 'A broadcast'), (org, team_b, leader_b, 'B broadcast');

  insert into public.event_calendars (org_id, group_id, name)
    values (org, grp_a, 'Group A') returning id into cal_a;
  insert into public.event_calendars (org_id, group_id, name)
    values (org, grp_b, 'Group B') returning id into cal_b;
  insert into public.events (org_id, group_id, calendar_id, title, start_time, created_by)
    values (org, grp_a, cal_a, 'A event', now() + interval '3 days', owner) returning id into event_a;
  insert into public.events (org_id, group_id, calendar_id, title, start_time, created_by)
    values (org, grp_b, cal_b, 'B event', now() + interval '3 days', leader_b) returning id into event_b;
  insert into public.rsvps (org_id, event_id, user_id, status) values
    (org, event_a, owner, 'yes'), (org, event_b, leader_b, 'yes');

  insert into public.announcements (org_id, group_id, title, content, is_published, author_id) values
    (org, grp_a, 'A news', 'body', true, owner),
    (org, grp_a, 'A draft', 'body', false, owner),
    (org, grp_b, 'B news', 'body', true, leader_b);

  insert into public.lecture_series (org_id, group_id, name)
    values (org, grp_a, 'A series') returning id into series_a;
  insert into public.lecture_series (org_id, group_id, name)
    values (org, grp_b, 'B series') returning id into series_b;
  insert into public.lectures (org_id, group_id, title, video_url, series_id) values
    (org, grp_a, 'A lecture', 'https://example.test/a', series_a),
    (org, grp_b, 'B lecture', 'https://example.test/b', series_b);

  insert into public.about_page (org_id, group_id, body) values
    (org, grp_a, 'about A'), (org, grp_b, 'about B');
  insert into public.class_teachers (org_id, group_id, profile_id, title) values
    (org, grp_a, owner, 'Teacher'), (org, grp_b, leader_b, 'Host');

  insert into public.prayer_requests (org_id, group_id, author_id, body)
    values (org, grp_a, member_a, 'A prayer') returning id into request_a;
  insert into public.prayer_requests (org_id, group_id, author_id, body)
    values (org, grp_b, leader_b, 'B prayer') returning id into request_b;
  insert into public.prayer_responses (org_id, group_id, request_id, profile_id) values
    (org, grp_a, request_a, owner), (org, grp_b, request_b, leader_b);
  insert into public.prayer_call_sessions (org_id, group_id, weekday, start_time, event_id) values
    (org, grp_a, 2, '07:00', event_a), (org, grp_b, 3, '07:00', event_b);

  insert into public.giving_funds (org_id, group_id, name, steward_id, created_by)
    values (org, grp_a, 'A fund', owner, owner) returning id into fund_a;
  insert into public.giving_funds (org_id, group_id, name, steward_id, created_by)
    values (org, grp_b, 'B fund', leader_b, leader_b) returning id into fund_b;
  insert into public.giving_fund_methods (org_id, group_id, fund_id, method, custom_handle) values
    (org, grp_a, fund_a, 'zelle', 'a-zelle'), (org, grp_b, fund_b, 'zelle', 'b-zelle');

  insert into public.group_settings (org_id, group_id, weekly_zoom_url) values
    (org, grp_a, 'https://a.example.test/zoom'), (org, grp_b, 'https://b.example.test/zoom');

  perform set_config('gs.org', org::text, true);
  perform set_config('gs.owner', owner::text, true);
  perform set_config('gs.member_a', member_a::text, true);
  perform set_config('gs.leader_b', leader_b::text, true);
  perform set_config('gs.admin_x', admin_x::text, true);
  perform set_config('gs.grp_a', grp_a::text, true);
  perform set_config('gs.grp_b', grp_b::text, true);
  perform set_config('gs.team_a', team_a::text, true);
  perform set_config('gs.team_b', team_b::text, true);
  perform set_config('gs.cal_a', cal_a::text, true);
  perform set_config('gs.event_a', event_a::text, true);
  perform set_config('gs.event_b', event_b::text, true);
  perform set_config('gs.request_a', request_a::text, true);
  perform set_config('gs.fund_a', fund_a::text, true);
  perform set_config('gs.sunday', sunday::text, true);
end $$;

select is(
  (select role from public.profiles where id = current_setting('gs.member_a')::uuid),
  'member', 'member_a is a plain org member, so only group membership can grant their reads');
select is(
  (select role from public.profiles where id = current_setting('gs.admin_x')::uuid),
  'admin', 'admin_x is an org admin in no group');

-- ── 1. Reads: own group only; org admins outside the group read nothing ─────
do $$
declare
  member_a uuid := current_setting('gs.member_a')::uuid;
  admin_x uuid := current_setting('gs.admin_x')::uuid;
  grp_a uuid := current_setting('gs.grp_a')::uuid;
  grp_b uuid := current_setting('gs.grp_b')::uuid;
  team_a uuid := current_setting('gs.team_a')::uuid;
  team_b uuid := current_setting('gs.team_b')::uuid;
  own_tables text[] := array[
    'events', 'event_calendars', 'announcements', 'lectures', 'lecture_series',
    'about_page', 'class_teachers', 'prayer_requests', 'prayer_responses',
    'prayer_call_sessions', 'giving_funds', 'giving_fund_methods', 'group_settings'];
  team_tables text[] := array['serving_signups', 'serving_broadcasts', 'serving_team_settings'];
  t text;
  own_c bigint; cross_c bigint; admin_a bigint; admin_b bigint;
begin
  foreach t in array own_tables loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
    execute format('select count(*) filter (where group_id = $1), count(*) filter (where group_id = $2) from public.%I', t)
      into own_c, cross_c using grp_a, grp_b;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_x)::text, true);
    execute format('select count(*) filter (where group_id = $1), count(*) filter (where group_id = $2) from public.%I', t)
      into admin_a, admin_b using grp_a, grp_b;
    reset role;
    perform set_config('gs.r_' || t, format('%s|%s|%s|%s', own_c, cross_c, admin_a, admin_b), true);
  end loop;

  foreach t in array team_tables loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
    execute format('select count(*) filter (where team_id = $1), count(*) filter (where team_id = $2) from public.%I', t)
      into own_c, cross_c using team_a, team_b;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_x)::text, true);
    execute format('select count(*) filter (where team_id = $1), count(*) filter (where team_id = $2) from public.%I', t)
      into admin_a, admin_b using team_a, team_b;
    reset role;
    perform set_config('gs.r_' || t, format('%s|%s|%s|%s', own_c, cross_c, admin_a, admin_b), true);
  end loop;
end $$;

select ok(split_part(current_setting('gs.r_' || t), '|', 1)::int >= 1,
  format('non-vacuity: a member of A reads A''s %s', t))
from unnest(array[
  'events', 'event_calendars', 'announcements', 'lectures', 'lecture_series',
  'about_page', 'class_teachers', 'prayer_requests', 'prayer_responses',
  'prayer_call_sessions', 'giving_funds', 'giving_fund_methods', 'group_settings',
  'serving_signups', 'serving_team_settings']) as t;
select is(split_part(current_setting('gs.r_' || t), '|', 2)::int, 0,
  format('a member of A reads no %s of B', t))
from unnest(array[
  'events', 'event_calendars', 'announcements', 'lectures', 'lecture_series',
  'about_page', 'class_teachers', 'prayer_requests', 'prayer_responses',
  'prayer_call_sessions', 'giving_funds', 'giving_fund_methods', 'group_settings',
  'serving_signups', 'serving_broadcasts', 'serving_team_settings']) as t;
select is(split_part(current_setting('gs.r_' || t), '|', 3)::int
          + split_part(current_setting('gs.r_' || t), '|', 4)::int, 0,
  format('an org admin in no group reads no %s of either group', t))
from unnest(array[
  'events', 'event_calendars', 'announcements', 'lectures', 'lecture_series',
  'about_page', 'class_teachers', 'prayer_requests', 'prayer_responses',
  'prayer_call_sessions', 'giving_funds', 'giving_fund_methods', 'group_settings',
  'serving_signups', 'serving_broadcasts', 'serving_team_settings']) as t;
select is(split_part(current_setting('gs.r_serving_broadcasts'), '|', 1)::int, 0,
  'a plain team member (not a lead) reads no serving broadcasts even in their own group');

-- Drafts are leaders-only; the plain member sees only the published row.
do $$
declare
  member_a uuid := current_setting('gs.member_a')::uuid;
  owner uuid := current_setting('gs.owner')::uuid;
  grp_a uuid := current_setting('gs.grp_a')::uuid;
  member_sees bigint; leader_sees bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
  select count(*) into member_sees from public.announcements where group_id = grp_a;
  perform set_config('request.jwt.claims', json_build_object('sub', owner)::text, true);
  select count(*) into leader_sees from public.announcements where group_id = grp_a;
  reset role;
  perform set_config('gs.ann_member', member_sees::text, true);
  perform set_config('gs.ann_leader', leader_sees::text, true);
end $$;
select is(current_setting('gs.ann_member')::int, 1, 'a member reads only the published announcement of their group');
select is(current_setting('gs.ann_leader')::int, 2, 'the group''s leader reads its draft too');

-- rsvps and prayer_wall follow the parent row's visibility.
do $$
declare
  member_a uuid := current_setting('gs.member_a')::uuid;
  event_a uuid := current_setting('gs.event_a')::uuid;
  event_b uuid := current_setting('gs.event_b')::uuid;
  grp_b uuid := current_setting('gs.grp_b')::uuid;
  rsvp_a bigint; rsvp_b bigint; wall_b bigint; wall_a bigint; teams_b bigint; roster_b bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
  select count(*) filter (where event_id = event_a), count(*) filter (where event_id = event_b)
    into rsvp_a, rsvp_b from public.rsvps;
  select count(*) filter (where group_id = grp_b), count(*) filter (where group_id <> grp_b)
    into wall_b, wall_a from public.prayer_wall;
  select count(*) into teams_b from public.teams where group_id = grp_b;
  select count(*) into roster_b from public.team_members
    where team_id = current_setting('gs.team_b')::uuid;
  reset role;
  perform set_config('gs.rsvp_a', rsvp_a::text, true);
  perform set_config('gs.rsvp_b', rsvp_b::text, true);
  perform set_config('gs.wall_a', wall_a::text, true);
  perform set_config('gs.wall_b', wall_b::text, true);
  perform set_config('gs.teams_b', teams_b::text, true);
  perform set_config('gs.roster_b', roster_b::text, true);
end $$;
select ok(current_setting('gs.rsvp_a')::int >= 1, 'non-vacuity: a member of A reads RSVPs on A''s event');
select is(current_setting('gs.rsvp_b')::int, 0, 'a member of A reads no RSVPs on B''s event');
select ok(current_setting('gs.wall_a')::int >= 1, 'non-vacuity: prayer_wall shows A''s request to a member of A');
select is(current_setting('gs.wall_b')::int, 0, 'prayer_wall exposes group_id and shows no B request to a member of A');
select is(current_setting('gs.teams_b')::int, 0, 'a member of A reads no teams of B');
select is(current_setting('gs.roster_b')::int, 0, 'a member of A reads no team roster of B');

-- ── 2. Writes: a leader of B cannot insert into A; the A leader can ─────────
do $$
declare
  leader_b uuid := current_setting('gs.leader_b')::uuid;
  owner uuid := current_setting('gs.owner')::uuid;
  org uuid := current_setting('gs.org')::uuid;
  grp_a uuid := current_setting('gs.grp_a')::uuid;
  cal_a uuid := current_setting('gs.cal_a')::uuid;
  stmts text[] := array[
    format('insert into public.announcements (org_id, group_id, title, content, author_id) values (%L, %L, ''x'', ''x'', $1)', org, grp_a),
    format('insert into public.events (org_id, group_id, calendar_id, title, start_time, created_by) values (%L, %L, %L, ''x'', now(), $1)', org, grp_a, cal_a),
    format('insert into public.lectures (org_id, group_id, title, video_url) values (%L, %L, ''x'', ''https://example.test/x'')', org, grp_a),
    format('insert into public.lecture_series (org_id, group_id, name) values (%L, %L, ''x'')', org, grp_a),
    format('insert into public.giving_funds (org_id, group_id, name, steward_id, created_by) values (%L, %L, ''x'', $1, $1)', org, grp_a),
    format('insert into public.prayer_call_sessions (org_id, group_id, weekday, start_time) values (%L, %L, 1, ''07:00'')', org, grp_a),
    format('insert into public.class_teachers (org_id, group_id, profile_id) values (%L, %L, $1)', org, grp_a),
    format('insert into public.group_settings (org_id, group_id, zoom_meeting_time) values (%L, %L, ''x'') on conflict (group_id) do update set zoom_meeting_time = ''x''', org, grp_a)];
  names text[] := array['announcements', 'events', 'lectures', 'lecture_series', 'giving_funds',
    'prayer_call_sessions', 'class_teachers', 'group_settings'];
  s text; i int; err text; ok_err text;
begin
  for i in 1 .. array_length(stmts, 1) loop
    s := stmts[i];
    err := 'none'; ok_err := 'none';
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', leader_b)::text, true);
    begin
      execute s using leader_b;
    exception when others then
      err := sqlstate;
    end;
    reset role;
    perform set_config('gs.w_' || names[i], err, true);
  end loop;

  -- Positive controls as the A leader (class_teachers would collide with the
  -- fixture row, so that control uses a different person).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner)::text, true);
  for i in 1 .. array_length(stmts, 1) loop
    s := stmts[i];
    ok_err := 'ok';
    begin
      if names[i] = 'class_teachers' then
        execute s using current_setting('gs.member_a')::uuid;
      else
        execute s using owner;
      end if;
    exception when others then
      ok_err := sqlstate || ' ' || sqlerrm;
    end;
    perform set_config('gs.ok_' || names[i], ok_err, true);
  end loop;
  reset role;
end $$;

select is(current_setting('gs.w_' || t), '42501', format('a leader of B cannot insert a %s row into A', t))
from unnest(array['announcements', 'events', 'lectures', 'lecture_series', 'giving_funds',
  'prayer_call_sessions', 'class_teachers', 'group_settings']) as t;
select is(current_setting('gs.ok_' || t), 'ok', format('positive control: the A leader inserts a %s row into A', t))
from unnest(array['announcements', 'events', 'lectures', 'lecture_series', 'giving_funds',
  'prayer_call_sessions', 'class_teachers', 'group_settings']) as t;

-- A member cannot update their group's announcement (0 rows); the author
-- updates their own prayer request (1 row); group_settings are leader-only.
do $$
declare
  member_a uuid := current_setting('gs.member_a')::uuid;
  owner uuid := current_setting('gs.owner')::uuid;
  grp_a uuid := current_setting('gs.grp_a')::uuid;
  n_ann int; n_prayer int; n_settings_member int; n_settings_leader int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
  update public.announcements set title = 'defaced' where group_id = grp_a;
  get diagnostics n_ann = row_count;
  update public.prayer_requests set is_answered = true where id = current_setting('gs.request_a')::uuid;
  get diagnostics n_prayer = row_count;
  update public.group_settings set zoom_meeting_time = 'x' where group_id = grp_a;
  get diagnostics n_settings_member = row_count;
  perform set_config('request.jwt.claims', json_build_object('sub', owner)::text, true);
  update public.group_settings set zoom_meeting_time = 'Thursdays 7pm' where group_id = grp_a;
  get diagnostics n_settings_leader = row_count;
  reset role;
  perform set_config('gs.u_ann', n_ann::text, true);
  perform set_config('gs.u_prayer', n_prayer::text, true);
  perform set_config('gs.u_settings_member', n_settings_member::text, true);
  perform set_config('gs.u_settings_leader', n_settings_leader::text, true);
end $$;
select is(current_setting('gs.u_ann')::int, 0, 'a plain member updates no announcement of their own group');
select is(current_setting('gs.u_prayer')::int, 1, 'the author updates their own prayer request');
select is(current_setting('gs.u_settings_member')::int, 0, 'a plain member updates no group_settings row');
select is(current_setting('gs.u_settings_leader')::int, 1, 'positive control: the group''s leader updates its settings row');

-- rsvps: a member of A cannot RSVP to B's event; A's event works.
do $$
declare
  member_a uuid := current_setting('gs.member_a')::uuid;
  org uuid := current_setting('gs.org')::uuid;
  err_b text := 'none'; err_a text := 'ok';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
  begin
    insert into public.rsvps (org_id, event_id, user_id, status)
    values (org, current_setting('gs.event_b')::uuid, member_a, 'yes');
  exception when others then
    err_b := sqlstate;
  end;
  begin
    insert into public.rsvps (org_id, event_id, user_id, status)
    values (org, current_setting('gs.event_a')::uuid, member_a, 'yes');
  exception when others then
    err_a := sqlstate;
  end;
  reset role;
  perform set_config('gs.rsvp_err_b', err_b, true);
  perform set_config('gs.rsvp_err_a', err_a, true);
end $$;
select is(current_setting('gs.rsvp_err_b'), '42501', 'a member of A cannot RSVP to an event of B');
select is(current_setting('gs.rsvp_err_a'), 'ok', 'positive control: the same member RSVPs to an event of A');

-- ── 2b. Updates: a writer cannot move a row into a group they are not in ────
-- The author and steward arms grant the UPDATE; only WITH CHECK pins the
-- target group. Rows without dependants are used so the composite FKs cannot
-- mask a missing predicate.
do $$
declare
  member_a uuid := current_setting('gs.member_a')::uuid;
  org uuid := current_setting('gs.org')::uuid;
  grp_a uuid := current_setting('gs.grp_a')::uuid;
  grp_b uuid := current_setting('gs.grp_b')::uuid;
  req uuid; fund uuid; err text; n int;
begin
  insert into public.prayer_requests (org_id, group_id, author_id, body)
    values (org, grp_a, member_a, 'movable') returning id into req;
  insert into public.giving_funds (org_id, group_id, name, steward_id, created_by)
    values (org, grp_a, 'movable', member_a, member_a) returning id into fund;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);

  err := 'none';
  begin
    update public.prayer_requests set group_id = grp_b where id = req;
  exception when others then err := sqlstate; end;
  perform set_config('gs.mv_prayer', err, true);
  update public.prayer_requests set body = 'edited' where id = req;
  get diagnostics n = row_count;
  perform set_config('gs.ok_prayer_update', n::text, true);

  err := 'none';
  begin
    update public.giving_funds set group_id = grp_b where id = fund;
  exception when others then err := sqlstate; end;
  perform set_config('gs.mv_fund', err, true);
  update public.giving_funds set name = 'edited' where id = fund;
  get diagnostics n = row_count;
  perform set_config('gs.ok_fund_update', n::text, true);

  reset role;
end $$;
select is(current_setting('gs.mv_prayer'), '42501',
  'a poster cannot move their own prayer request into a group they are not in');
select is(current_setting('gs.ok_prayer_update'), '1',
  'non-vacuity: the poster can still edit the request inside their group');
select is(current_setting('gs.mv_fund'), '42501',
  'a steward cannot move their fund into a group they are not in');
select is(current_setting('gs.ok_fund_update'), '1',
  'non-vacuity: the steward can still edit the fund inside their group');

-- ── 2c. Membership is the floor under every arm ─────────────────────────────
-- A steward who leaves the group keeps no write on the fund; a leader cannot
-- delete the group's calendar; an event image is readable only inside the
-- event's group; an org admin outside the group reads none of it.
do $$
declare
  org uuid := current_setting('gs.org')::uuid;
  grp_a uuid := current_setting('gs.grp_a')::uuid;
  owner uuid := current_setting('gs.owner')::uuid;
  member_a uuid := current_setting('gs.member_a')::uuid;
  leader_b uuid := current_setting('gs.leader_b')::uuid;
  admin_x uuid := current_setting('gs.admin_x')::uuid;
  cal_a uuid := current_setting('gs.cal_a')::uuid;
  event_a uuid := current_setting('gs.event_a')::uuid;
  fund uuid; err text; n int;
begin
  insert into public.giving_funds (org_id, group_id, name, steward_id, created_by)
    values (org, grp_a, 'stewarded', member_a, member_a) returning id into fund;
  insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('event-images', org || '/events/' || event_a || '/cover.jpg', owner, owner);

  -- The steward can act while a member ...
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
  insert into public.giving_fund_methods (org_id, group_id, fund_id, method, custom_handle)
    values (org, grp_a, fund, 'zelle', 'steward-zelle');
  get diagnostics n = row_count;
  perform set_config('gs.steward_in', n::text, true);
  reset role;

  -- ... and not after leaving the group.
  delete from public.group_members where group_id = grp_a and profile_id = member_a;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
  err := 'none';
  begin
    insert into public.giving_fund_methods (org_id, group_id, fund_id, method, custom_handle)
      values (org, grp_a, fund, 'venmo', 'ex-steward');
  exception when others then err := sqlstate; end;
  perform set_config('gs.steward_out_insert', err, true);
  delete from public.giving_funds;
  get diagnostics n = row_count;
  perform set_config('gs.steward_out_delete', n::text, true);
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner)::text, true);
  delete from public.event_calendars where id = cal_a;
  get diagnostics n = row_count;
  perform set_config('gs.leader_cal_delete', n::text, true);
  select count(*) into n from storage.objects where bucket_id = 'event-images';
  perform set_config('gs.img_leader_a', n::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', leader_b)::text, true);
  select count(*) into n from storage.objects where bucket_id = 'event-images';
  perform set_config('gs.img_leader_b', n::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_x)::text, true);
  select count(*) into n from storage.objects where bucket_id = 'event-images';
  perform set_config('gs.img_admin_x', n::text, true);
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{}', true);
  select count(*) into n from storage.objects where bucket_id = 'event-images';
  perform set_config('gs.img_anon', n::text, true);
  reset role;

  -- Later sections expect the fixture memberships.
  insert into public.group_members (org_id, group_id, profile_id, role) values (org, grp_a, member_a, 'member');
  insert into public.team_members (org_id, profile_id, team_id)
    values (org, member_a, current_setting('gs.team_a')::uuid);
end $$;
select is(current_setting('gs.steward_in'), '1', 'non-vacuity: a steward in the group adds a payment method');
select is(current_setting('gs.steward_out_insert'), '42501', 'a steward who left the group cannot add a payment method');
select is(current_setting('gs.steward_out_delete'), '0', 'a steward who left the group cannot delete the fund');
select is(current_setting('gs.leader_cal_delete'), '0', 'a leader cannot delete the group''s calendar');
select is(current_setting('gs.img_leader_a'), '1', 'non-vacuity: a leader of A reads A''s event image');
select is(current_setting('gs.img_leader_b'), '0', 'a leader of B reads no image of A''s event');
select is(current_setting('gs.img_admin_x'), '0', 'an org admin outside the group reads no event image');
select is(current_setting('gs.img_anon'), '0', 'anon reads no event image');

-- ── 2d. A team member is a member of the team's group ───────────────────────
do $$
declare
  org uuid := current_setting('gs.org')::uuid;
  grp_a uuid := current_setting('gs.grp_a')::uuid;
  team_a uuid := current_setting('gs.team_a')::uuid;
  leader_b uuid := current_setting('gs.leader_b')::uuid;
  admin_x uuid := current_setting('gs.admin_x')::uuid;
  owner uuid := current_setting('gs.owner')::uuid;
  err text; n int;
begin
  err := 'none';
  begin
    insert into public.team_members (org_id, profile_id, team_id) values (org, leader_b, team_a);
  exception when others then err := sqlstate; end;
  perform set_config('gs.tm_outsider', err, true);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_x)::text, true);
  err := 'none';
  begin
    insert into public.team_members (org_id, profile_id, team_id, is_leader)
      values (org, admin_x, team_a, true);
  exception when others then err := sqlstate; end;
  reset role;
  perform set_config('gs.tm_admin_self', err, true);

  insert into public.team_members (org_id, profile_id, team_id) values (org, owner, team_a);
  get diagnostics n = row_count;
  perform set_config('gs.tm_member_ok', n::text, true);
  delete from public.group_members where group_id = grp_a and profile_id = owner;
  select count(*) into n from public.team_members where team_id = team_a and profile_id = owner;
  perform set_config('gs.tm_after_leave', n::text, true);
  insert into public.group_members (org_id, group_id, profile_id, role) values (org, grp_a, owner, 'leader');

  -- Moving a team to another group, or re-pointing a membership row, prunes
  -- the same way as leaving.
  insert into public.team_members (org_id, profile_id, team_id) values (org, owner, team_a);
  update public.teams set group_id = current_setting('gs.grp_b')::uuid where id = team_a;
  select count(*) into n from public.team_members where team_id = team_a;
  perform set_config('gs.tm_after_move', n::text, true);
  update public.teams set group_id = grp_a where id = team_a;
  insert into public.team_members (org_id, profile_id, team_id) values (org, owner, team_a);
  update public.group_members set group_id = current_setting('gs.grp_b')::uuid
    where group_id = grp_a and profile_id = owner;
  select count(*) into n from public.team_members where team_id = team_a and profile_id = owner;
  perform set_config('gs.tm_after_repoint', n::text, true);
  update public.group_members set group_id = grp_a
    where group_id = current_setting('gs.grp_b')::uuid and profile_id = owner;
end $$;
select is(current_setting('gs.tm_outsider'), '23514', 'a profile outside the group cannot be put on its team');
select is(current_setting('gs.tm_admin_self'), '23514', 'an org admin outside the group cannot enrol themselves on its team');
select is(current_setting('gs.tm_member_ok'), '1', 'non-vacuity: a group member joins the team');
select is(current_setting('gs.tm_after_leave'), '0', 'leaving the group leaves its teams');
select is(current_setting('gs.tm_after_move'), '0', 'moving a team to another group drops members not in it');
select is(current_setting('gs.tm_after_repoint'), '0', 're-pointing a membership row leaves the old group''s teams');

-- ── 3. Structural pins ──────────────────────────────────────────────────────
select is(
  (select count(*)::int
   from information_schema.columns c
   join information_schema.tables t
     on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public' and c.column_name = 'group_id'
     and t.table_type = 'BASE TABLE' and c.is_nullable = 'YES'
     -- group_requests.group_id is the link set when a request is approved,
     -- not the key its rows are scoped by: a pending request has no group,
     -- and its policies gate on org_id and the requester.
     -- access_requests.group_id is the group an invite link enrols a signup
     -- into; an admin-approved request names none, and the table is scoped
     -- by org_id alone.
     and c.table_name not in ('group_requests', 'access_requests')),
  0, 'no public base table allows a NULL group_id');

select is(
  (select count(*)::int from unnest(array[
    'events', 'event_calendars', 'announcements', 'lectures', 'lecture_series',
    'about_page', 'class_teachers', 'prayer_requests', 'prayer_responses',
    'prayer_call_sessions', 'giving_funds', 'giving_fund_methods', 'group_settings']) as t(name)
   where exists (
     select 1 from pg_constraint con
     where con.conrelid = ('public.' || t.name)::regclass
       and con.contype = 'f'
       and con.confrelid = 'public.groups'::regclass
       and (select array_agg(a.attname::text order by a.attname)
            from unnest(con.conkey) k(attnum)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum)
           = array['group_id', 'org_id'])),
  13, 'every content table has a composite (group_id, org_id) FK into groups');

select col_is_pk('public', 'about_page', array['group_id'], 'about_page is keyed by group_id');
select hasnt_column('public', 'about_page', 'id', 'about_page lost its singleton id');
select ok(exists (
    select 1 from pg_constraint
    where conrelid = 'public.class_teachers'::regclass
      and conname = 'class_teachers_group_id_profile_id_key' and contype = 'u'),
  'class_teachers is unique on (group_id, profile_id)');

select has_column('public', t, 'team_id', format('%s carries team_id', t))
from unnest(array['serving_signups', 'serving_broadcasts', 'serving_team_settings']) as t;
select hasnt_column('public', t, 'group_id', format('%s no longer has a group_id column', t))
from unnest(array['serving_signups', 'serving_broadcasts', 'serving_team_settings']) as t;

select throws_ok(
  format($$ insert into public.event_calendars (org_id, group_id, name, color) values (%L, %L, 'bad', 'red') $$,
         current_setting('gs.org'), current_setting('gs.grp_a')),
  '23514', null, 'event_calendars.color rejects a non-hex value');
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'event_calendars' and column_name = 'color'),
  '''#B85C38''::text', 'event_calendars.color defaults to Clay');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in (
        'events', 'event_calendars', 'announcements', 'lectures', 'lecture_series',
        'about_page', 'class_teachers', 'prayer_requests', 'prayer_responses',
        'prayer_call_sessions', 'giving_funds', 'giving_fund_methods', 'group_settings',
        'rsvps', 'serving_signups', 'serving_signup_attendees', 'serving_broadcasts',
        'serving_team_settings')
      and (coalesce(qual, '') ~ 'is_(admin|content_editor)\('
           or coalesce(with_check, '') ~ 'is_(admin|content_editor)\(')),
  0, 'no content policy gates on is_admin() or is_content_editor()');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('teams', 'team_members') and cmd = 'SELECT'
      and qual ~ 'is_admin\(' and qual ~ 'is_group_member\('),
  2, 'teams and team_members reads admit org admins or group members');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'group_settings'
      and permissive = 'RESTRICTIVE' and qual like '%app\_request\_org\_id%'),
  1, 'group_settings carries the restrictive isolation policy');

-- Provisioning seeds nothing group-owned any more.
select is(
  (select count(*)::int from public.site_settings where org_id = current_setting('gs.org')::uuid),
  2, 'provisioning seeds only the two giving keys');
select is(
  (select count(*)::int from public.event_calendars
    where org_id = current_setting('gs.org')::uuid and group_id not in (current_setting('gs.grp_a')::uuid, current_setting('gs.grp_b')::uuid)),
  0, 'provisioning seeds no calendar');

-- ── 4. The calendar fold is per group and idempotent ────────────────────────
do $$
declare
  org uuid := current_setting('gs.org')::uuid;
  grp_a uuid := current_setting('gs.grp_a')::uuid;
  grp_b uuid := current_setting('gs.grp_b')::uuid;
  cal_a uuid := current_setting('gs.cal_a')::uuid;
  extra1 uuid; extra2 uuid;
  events_before bigint;
  cal_b_name text;
begin
  select name into cal_b_name from public.event_calendars where group_id = grp_b;
  -- now() is the transaction's start for every row here, so the extras get
  -- an explicit later created_at to make the fixture calendar the oldest.
  insert into public.event_calendars (org_id, group_id, name, color, created_at)
    values (org, grp_a, 'A extra 1', '#111111', now() + interval '1 minute') returning id into extra1;
  insert into public.event_calendars (org_id, group_id, name, color, created_at)
    values (org, grp_a, 'A extra 2', '#222222', now() + interval '2 minutes') returning id into extra2;
  insert into public.events (org_id, group_id, calendar_id, title, start_time) values
    (org, grp_a, extra1, 'on extra 1', now()),
    (org, grp_a, extra2, 'on extra 2', now());
  update public.event_calendars set name = 'renamed', color = '#333333' where id = cal_a;
  select count(*) into events_before from public.events where group_id = grp_a;

  perform public.group_content_backfill();

  perform set_config('gs.fold_cals', (select count(*) from public.event_calendars where group_id = grp_a)::text, true);
  perform set_config('gs.fold_survivor', (select id from public.event_calendars where group_id = grp_a)::text, true);
  perform set_config('gs.fold_name', (select name from public.event_calendars where group_id = grp_a), true);
  perform set_config('gs.fold_color', (select color from public.event_calendars where group_id = grp_a), true);
  perform set_config('gs.fold_strays', (select count(*) from public.events where group_id = grp_a and calendar_id is distinct from cal_a)::text, true);
  perform set_config('gs.fold_events', (select count(*) from public.events where group_id = grp_a)::text, true);
  perform set_config('gs.fold_events_before', events_before::text, true);
  perform set_config('gs.fold_b_name', (select name from public.event_calendars where group_id = grp_b), true);
  perform set_config('gs.fold_b_name_before', cal_b_name, true);

  perform public.group_content_backfill();
  perform set_config('gs.fold_again_cals', (select count(*) from public.event_calendars where org_id = org)::text, true);
  perform set_config('gs.fold_again_name', (select name from public.event_calendars where group_id = grp_a), true);
end $$;
select is(current_setting('gs.fold_cals')::int, 1, 'the fold leaves group A exactly one calendar');
select is(current_setting('gs.fold_survivor'), current_setting('gs.cal_a'), 'the oldest calendar survives');
select is(current_setting('gs.fold_name'), 'Group A', 'the survivor is named after the group');
select is(current_setting('gs.fold_color'), '#B85C38', 'the survivor is recolored Clay');
select is(current_setting('gs.fold_strays')::int, 0, 'every event of group A points at the survivor');
select is(current_setting('gs.fold_events'), current_setting('gs.fold_events_before'), 'the fold keeps every event');
select is(current_setting('gs.fold_b_name'), current_setting('gs.fold_b_name_before'), 'group B''s calendar is untouched');
select is(current_setting('gs.fold_again_cals')::int, 2, 'a second call changes nothing');
select is(current_setting('gs.fold_again_name'), 'Group A', 'a second call leaves the survivor''s name alone');

-- ── 4b. The backfill gives a group-less org a group before adopting content ─
do $$
declare
  org uuid; cal uuid; n int; err text := 'ok';
begin
  insert into public.organizations (name, branding, status)
    values ('Groupless', '{}'::jsonb, 'active')
    returning id into org;
  alter table public.event_calendars alter column group_id drop not null;
  insert into public.event_calendars (org_id, name, color) values (org, 'Prayer Calls', '#2F6BA8');
  begin
    perform public.group_model_backfill();
    perform public.group_content_backfill();
  exception when others then err := sqlstate || ' ' || sqlerrm; end;
  alter table public.event_calendars alter column group_id set not null;
  perform set_config('gs.bf_err', err, true);
  select count(*) into n from public.groups where org_id = org;
  perform set_config('gs.bf_groups', n::text, true);
  select count(*) into n from public.event_calendars c
    join public.groups g on g.id = c.group_id where g.org_id = org;
  perform set_config('gs.bf_cals', n::text, true);
end $$;
select is(current_setting('gs.bf_err'), 'ok', 'an org with a calendar but no group does not abort the backfill');
select is(current_setting('gs.bf_groups'), '1', 'the group-model backfill gave it one group');
select is(current_setting('gs.bf_cals'), '1', 'the calendar was adopted by that group');

-- ── 5. The signup RPC admits a group leader, and only for their group ───────
do $$
declare
  owner uuid := current_setting('gs.owner')::uuid;
  leader_b uuid := current_setting('gs.leader_b')::uuid;
  team_a uuid := current_setting('gs.team_a')::uuid;
  sunday date := current_setting('gs.sunday')::date + 7;
  own_err text := 'ok'; cross_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner)::text, true);
  begin
    perform public.serving_signup_create(team_a, sunday, array[owner]);
  exception when others then
    own_err := sqlstate;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', leader_b)::text, true);
  begin
    perform public.serving_signup_create(team_a, sunday + 7, array[leader_b]);
  exception when others then
    cross_err := sqlstate;
  end;
  reset role;
  perform set_config('gs.rpc_own', own_err, true);
  perform set_config('gs.rpc_cross', cross_err, true);
end $$;
select is(current_setting('gs.rpc_own'), 'ok', 'a leader of A who is not on the team signs up for A''s team');
select is(current_setting('gs.rpc_cross'), 'SV004', 'a leader of B is refused on A''s team');

select * from finish();
rollback;
