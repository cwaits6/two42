-- Group abilities suite: a leader gives parts of the job to members of their
-- group, directly or, for Prayer care, through a linked team. Exercised from
-- the authenticated role. Every "cannot" has a paired positive control so the
-- suite cannot go green by rejecting everything.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/group_abilities_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Runs one statement as the given person and reports 'ok:<rows>' or the
-- SQLSTATE it raised, so a refusal and a write RLS filtered to nothing read
-- differently.
create function pg_temp.as_person(_who uuid, _sql text) returns text
  language plpgsql
as $$
declare
  _n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _who, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  set local role authenticated;
  begin
    execute _sql;
    get diagnostics _n = row_count;
    reset role;
    return 'ok:' || _n;
  exception when others then
    reset role;
    return sqlstate;
  end;
end $$;

create function pg_temp.ask(_who uuid, _sql text) returns text
  language plpgsql
as $$
declare
  _r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _who, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  set local role authenticated;
  execute _sql into _r;
  reset role;
  return _r;
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Org A, one group G: leader; cal (calendar), mem (members), teams_mgr
-- (teams), carer (prayer_care, given by name); lead_p leads the Prayer team P
-- and pray_member is on it; lead_s leads the open team S; plain and newbie
-- are members with nothing; outsider is in the church but not in G.
-- Org B: its owner, who leads B's backfilled group.
do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  leader uuid := gen_random_uuid();
  cal uuid := gen_random_uuid();
  mem uuid := gen_random_uuid();
  teams_mgr uuid := gen_random_uuid();
  carer uuid := gen_random_uuid();
  lead_p uuid := gen_random_uuid();
  pray_member uuid := gen_random_uuid();
  lead_s uuid := gen_random_uuid();
  plain uuid := gen_random_uuid();
  newbie uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  grp uuid;
  grp_b uuid;
  team_p uuid;
  team_s uuid;
begin
  org_a := public.provision_organization('Abilities Org A', 'owner-a@abilities.example.test');
  org_b := public.provision_organization('Abilities Org B', 'owner-b@abilities.example.test');

  insert into public.access_requests (org_id, name, email, status)
  select org_a, n, n || '@abilities.example.test', 'approved'
  from unnest(array['leader', 'cal', 'mem', 'teams', 'carer', 'lead-p', 'pray', 'lead-s', 'plain', 'newbie', 'outsider']) n;

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@abilities.example.test'),
    (owner_b, 'owner-b@abilities.example.test'),
    (leader, 'leader@abilities.example.test'),
    (cal, 'cal@abilities.example.test'),
    (mem, 'mem@abilities.example.test'),
    (teams_mgr, 'teams@abilities.example.test'),
    (carer, 'carer@abilities.example.test'),
    (lead_p, 'lead-p@abilities.example.test'),
    (pray_member, 'pray@abilities.example.test'),
    (lead_s, 'lead-s@abilities.example.test'),
    (plain, 'plain@abilities.example.test'),
    (newbie, 'newbie@abilities.example.test'),
    (outsider, 'outsider@abilities.example.test');

  perform public.group_model_backfill();

  insert into public.groups (org_id, name) values (org_a, 'Abilities G') returning id into grp;
  insert into public.group_members (org_id, group_id, profile_id, role)
  select org_a, grp, p, case when p = leader then 'leader' else 'member' end
  from unnest(array[leader, cal, mem, teams_mgr, carer, lead_p, pray_member, lead_s, plain]) p;

  insert into public.group_member_abilities (org_id, group_id, profile_id, ability, granted_by) values
    (org_a, grp, cal, 'calendar', leader),
    (org_a, grp, mem, 'members', leader),
    (org_a, grp, teams_mgr, 'teams', leader),
    (org_a, grp, carer, 'prayer_care', leader);

  insert into public.teams (org_id, group_id, name) values (org_a, grp, 'Prayer team') returning id into team_p;
  insert into public.teams (org_id, group_id, name) values (org_a, grp, 'Setup') returning id into team_s;
  insert into public.team_members (org_id, team_id, profile_id, is_leader) values
    (org_a, team_p, lead_p, true),
    (org_a, team_p, pray_member, false),
    (org_a, team_s, lead_s, true);

  select g.id into grp_b from public.groups g where g.org_id = org_b;

  perform set_config('ga.org_a', org_a::text, true);
  perform set_config('ga.owner_a', owner_a::text, true);
  perform set_config('ga.owner_b', owner_b::text, true);
  perform set_config('ga.leader', leader::text, true);
  perform set_config('ga.cal', cal::text, true);
  perform set_config('ga.mem', mem::text, true);
  perform set_config('ga.teams', teams_mgr::text, true);
  perform set_config('ga.carer', carer::text, true);
  perform set_config('ga.lead_p', lead_p::text, true);
  perform set_config('ga.pray', pray_member::text, true);
  perform set_config('ga.lead_s', lead_s::text, true);
  perform set_config('ga.plain', plain::text, true);
  perform set_config('ga.newbie', newbie::text, true);
  perform set_config('ga.outsider', outsider::text, true);
  perform set_config('ga.grp', grp::text, true);
  perform set_config('ga.grp_b', grp_b::text, true);
  perform set_config('ga.team_p', team_p::text, true);
  perform set_config('ga.team_s', team_s::text, true);
end $$;

select is((select count(*)::int from public.groups where id = current_setting('ga.grp_b')::uuid), 1,
  'org B has a group of its own');

-- ── 1. Calendar ─────────────────────────────────────────────────────────────
select is(pg_temp.as_person(current_setting('ga.cal')::uuid, format(
  $q$insert into public.events (group_id, title, start_time) values (%L, 'Picnic', now())$q$,
  current_setting('ga.grp'))), 'ok:1',
  'a member given Calendar adds an event');
select is(pg_temp.as_person(current_setting('ga.plain')::uuid, format(
  $q$insert into public.events (group_id, title, start_time) values (%L, 'Picnic', now())$q$,
  current_setting('ga.grp'))), '42501',
  'a member with no ability cannot add an event');
select is(pg_temp.as_person(current_setting('ga.leader')::uuid, format(
  $q$insert into public.events (group_id, title, start_time) values (%L, 'Leader picnic', now())$q$,
  current_setting('ga.grp'))), 'ok:1',
  'a leader still adds an event without any ability row');
select is(pg_temp.as_person(current_setting('ga.cal')::uuid, format(
  $q$delete from public.events where group_id = %L$q$, current_setting('ga.grp'))), 'ok:2',
  'a member given Calendar deletes the group''s events');

-- ── 2. Abilities do not spill into each other ───────────────────────────────
select is(pg_temp.as_person(current_setting('ga.cal')::uuid, format(
  $q$insert into public.announcements (group_id, title, content) values (%L, 'News', 'Body')$q$,
  current_setting('ga.grp'))), '42501',
  'Calendar does not let someone write an announcement');
select is(pg_temp.as_person(current_setting('ga.cal')::uuid, format(
  $q$insert into public.lecture_series (group_id, name) values (%L, 'Romans')$q$,
  current_setting('ga.grp'))), '42501',
  'Calendar does not let someone add a series');
select is(pg_temp.as_person(current_setting('ga.cal')::uuid, format(
  $q$update public.groups set name = 'Renamed' where id = %L$q$, current_setting('ga.grp'))), 'ok:0',
  'no ability lets someone change the group''s details');

-- ── 3. Members ──────────────────────────────────────────────────────────────
select is(pg_temp.as_person(current_setting('ga.mem')::uuid, format(
  $q$insert into public.group_members (group_id, profile_id, role) values (%L, %L, 'leader')$q$,
  current_setting('ga.grp'), current_setting('ga.outsider'))), '42501',
  'a member manager cannot add someone as a leader');
select is(pg_temp.as_person(current_setting('ga.mem')::uuid, format(
  $q$insert into public.group_members (group_id, profile_id, role) values (%L, %L, 'member')$q$,
  current_setting('ga.grp'), current_setting('ga.outsider'))), 'ok:1',
  'a member manager adds someone as a member');
select is(pg_temp.as_person(current_setting('ga.mem')::uuid, format(
  $q$update public.group_members set role = 'leader' where group_id = %L and profile_id = %L$q$,
  current_setting('ga.grp'), current_setting('ga.mem'))), 'ok:0',
  'a member manager cannot make themselves a leader');
select is(pg_temp.as_person(current_setting('ga.mem')::uuid, format(
  $q$delete from public.group_members where group_id = %L and profile_id = %L$q$,
  current_setting('ga.grp'), current_setting('ga.leader'))), 'ok:0',
  'a member manager cannot remove a leader');
select is(pg_temp.as_person(current_setting('ga.mem')::uuid, format(
  $q$delete from public.group_members where group_id = %L and profile_id = %L$q$,
  current_setting('ga.grp'), current_setting('ga.outsider'))), 'ok:1',
  'a member manager removes a member');
select is(pg_temp.as_person(current_setting('ga.plain')::uuid, format(
  $q$insert into public.group_members (group_id, profile_id, role) values (%L, %L, 'member')$q$,
  current_setting('ga.grp'), current_setting('ga.outsider'))), '42501',
  'a member with no ability cannot add a member');
select is(pg_temp.as_person(current_setting('ga.mem')::uuid, format(
  $q$insert into public.group_invites (group_id, created_by) values (%L, %L)$q$,
  current_setting('ga.grp'), current_setting('ga.mem'))), 'ok:1',
  'a member manager makes an invite link');
select is(pg_temp.as_person(current_setting('ga.plain')::uuid, format(
  $q$insert into public.group_invites (group_id, created_by) values (%L, %L)$q$,
  current_setting('ga.grp'), current_setting('ga.plain'))), '42501',
  'a member with no ability cannot make an invite link');

insert into public.group_join_requests (org_id, group_id, profile_id)
  values (current_setting('ga.org_a')::uuid, current_setting('ga.grp')::uuid, current_setting('ga.newbie')::uuid);

select is(pg_temp.ask(current_setting('ga.mem')::uuid, format(
  $q$select count(*)::text from public.pending_group_join_requests(%L)$q$, current_setting('ga.grp'))), '1',
  'a member manager sees the requests to join');
select is(pg_temp.ask(current_setting('ga.plain')::uuid, format(
  $q$select count(*)::text from public.pending_group_join_requests(%L)$q$, current_setting('ga.grp'))), '0',
  'a member with no ability sees no requests to join');
select is(pg_temp.as_person(current_setting('ga.mem')::uuid, format(
  $q$select public.review_group_join_request(r.id, true) from public.group_join_requests r where r.group_id = %L and r.status = 'pending'$q$,
  current_setting('ga.grp'))), 'ok:1',
  'a member manager approves a request to join');
select is((select role from public.group_members
  where group_id = current_setting('ga.grp')::uuid and profile_id = current_setting('ga.newbie')::uuid), 'member',
  'the approved person joins as a member');

-- ── 4. Granting abilities ───────────────────────────────────────────────────
select is(pg_temp.as_person(current_setting('ga.mem')::uuid, format(
  $q$insert into public.group_member_abilities (group_id, profile_id, ability, granted_by) values (%L, %L, 'calendar', %L)$q$,
  current_setting('ga.grp'), current_setting('ga.plain'), current_setting('ga.mem'))), '42501',
  'a member manager cannot give someone an ability');
select is(pg_temp.as_person(current_setting('ga.mem')::uuid, format(
  $q$insert into public.group_member_abilities (group_id, profile_id, ability, granted_by) values (%L, %L, 'calendar', %L)$q$,
  current_setting('ga.grp'), current_setting('ga.mem'), current_setting('ga.mem'))), '42501',
  'a member manager cannot give themselves another ability');
select is(pg_temp.as_person(current_setting('ga.leader')::uuid, format(
  $q$insert into public.group_member_abilities (group_id, profile_id, ability, granted_by) values (%L, %L, 'lessons', %L)$q$,
  current_setting('ga.grp'), current_setting('ga.plain'), current_setting('ga.cal'))), '42501',
  'a grant must name the leader who made it');
select is(pg_temp.as_person(current_setting('ga.leader')::uuid, format(
  $q$insert into public.group_member_abilities (group_id, profile_id, ability, granted_by) values (%L, %L, 'lessons', %L)$q$,
  current_setting('ga.grp'), current_setting('ga.plain'), current_setting('ga.leader'))), 'ok:1',
  'a leader gives a member Lessons');
select is(pg_temp.as_person(current_setting('ga.leader')::uuid, format(
  $q$insert into public.group_member_abilities (group_id, profile_id, ability, granted_by) values (%L, %L, 'lessons', %L)$q$,
  current_setting('ga.grp'), current_setting('ga.outsider'), current_setting('ga.leader'))), '23503',
  'an ability goes only to someone in the group');
select is(pg_temp.as_person(current_setting('ga.leader')::uuid, format(
  $q$insert into public.group_member_abilities (group_id, profile_id, ability, granted_by) values (%L, %L, 'everything', %L)$q$,
  current_setting('ga.grp'), current_setting('ga.plain'), current_setting('ga.leader'))), '23514',
  'an ability is one of the fixed list');
select is(pg_temp.as_person(current_setting('ga.plain')::uuid, format(
  $q$insert into public.lecture_series (group_id, name) values (%L, 'Romans')$q$,
  current_setting('ga.grp'))), 'ok:1',
  'the new Lessons ability works at once');
select is(pg_temp.as_person(current_setting('ga.leader')::uuid, format(
  $q$delete from public.group_member_abilities where group_id = %L and profile_id = %L and ability = 'lessons'$q$,
  current_setting('ga.grp'), current_setting('ga.plain'))), 'ok:1',
  'a leader takes an ability back');
select is(pg_temp.as_person(current_setting('ga.plain')::uuid, format(
  $q$insert into public.lecture_series (group_id, name) values (%L, 'Galatians')$q$,
  current_setting('ga.grp'))), '42501',
  'a removed ability stops working');

-- ── 5. Prayer care through a linked team ────────────────────────────────────
select is(pg_temp.ask(current_setting('ga.pray')::uuid, format(
  $q$select public.has_group_ability(%L, 'prayer_care')::text$q$, current_setting('ga.grp'))), 'false',
  'before the link, the Prayer team holds no Prayer care');
select is(pg_temp.as_person(current_setting('ga.lead_p')::uuid, format(
  $q$insert into public.team_abilities (team_id, ability, granted_by) values (%L, 'prayer_care', %L)$q$,
  current_setting('ga.team_p'), current_setting('ga.lead_p'))), '42501',
  'a team lead cannot link their own team to Prayer care');
select is(pg_temp.as_person(current_setting('ga.carer')::uuid, format(
  $q$insert into public.team_abilities (team_id, ability, granted_by) values (%L, 'prayer_care', %L)$q$,
  current_setting('ga.team_p'), current_setting('ga.carer'))), '42501',
  'someone given Prayer care cannot link a team; only a leader can');
select is(pg_temp.as_person(current_setting('ga.leader')::uuid, format(
  $q$insert into public.team_abilities (team_id, ability, granted_by) values (%L, 'calendar', %L)$q$,
  current_setting('ga.team_s'), current_setting('ga.leader'))), '23514',
  'a team can be linked to Prayer care only');
select is(pg_temp.as_person(current_setting('ga.leader')::uuid, format(
  $q$insert into public.team_abilities (team_id, ability, granted_by) values (%L, 'prayer_care', %L)$q$,
  current_setting('ga.team_p'), current_setting('ga.leader'))), 'ok:1',
  'a leader links the Prayer team to Prayer care');
select is(pg_temp.ask(current_setting('ga.pray')::uuid, format(
  $q$select public.has_group_ability(%L, 'prayer_care')::text$q$, current_setting('ga.grp'))), 'true',
  'every member of the linked team holds Prayer care');
select is(pg_temp.ask(current_setting('ga.pray')::uuid, format(
  $q$select public.has_group_ability_directly(%L, 'prayer_care')::text$q$, current_setting('ga.grp'))), 'false',
  'holding it through the team is not holding it directly');

-- The linked team is closed: its lead and the teams ability no longer change it.
select is(pg_temp.as_person(current_setting('ga.lead_p')::uuid, format(
  $q$insert into public.team_members (team_id, profile_id) values (%L, %L)$q$,
  current_setting('ga.team_p'), current_setting('ga.plain'))), '42501',
  'the linked team''s lead cannot add someone to it');
select is(pg_temp.as_person(current_setting('ga.teams')::uuid, format(
  $q$insert into public.team_members (team_id, profile_id) values (%L, %L)$q$,
  current_setting('ga.team_p'), current_setting('ga.plain'))), '42501',
  'the teams ability does not reach a team linked to Prayer care');
select is(pg_temp.as_person(current_setting('ga.pray')::uuid, format(
  $q$insert into public.team_members (team_id, profile_id) values (%L, %L)$q$,
  current_setting('ga.team_p'), current_setting('ga.plain'))), '42501',
  'holding Prayer care through the team does not let someone add to it');
select is(pg_temp.as_person(current_setting('ga.lead_p')::uuid, format(
  $q$delete from public.team_members where team_id = %L and profile_id = %L$q$,
  current_setting('ga.team_p'), current_setting('ga.pray'))), 'ok:0',
  'the linked team''s lead cannot remove someone from it');
select is(pg_temp.as_person(current_setting('ga.carer')::uuid, format(
  $q$insert into public.team_members (team_id, profile_id) values (%L, %L)$q$,
  current_setting('ga.team_p'), current_setting('ga.plain'))), 'ok:1',
  'someone given Prayer care directly adds to the linked team');
select is(pg_temp.as_person(current_setting('ga.leader')::uuid, format(
  $q$delete from public.team_members where team_id = %L and profile_id = %L$q$,
  current_setting('ga.team_p'), current_setting('ga.plain'))), 'ok:1',
  'a leader removes someone from the linked team');

-- An open team keeps today's rules, with the teams ability in the leader's place.
select is(pg_temp.as_person(current_setting('ga.lead_s')::uuid, format(
  $q$insert into public.team_members (team_id, profile_id) values (%L, %L)$q$,
  current_setting('ga.team_s'), current_setting('ga.plain'))), 'ok:1',
  'an open team''s lead adds a member');
select is(pg_temp.as_person(current_setting('ga.lead_s')::uuid, format(
  $q$insert into public.team_members (team_id, profile_id, is_leader) values (%L, %L, true)$q$,
  current_setting('ga.team_s'), current_setting('ga.cal'))), '42501',
  'an open team''s lead cannot add another lead');
select is(pg_temp.as_person(current_setting('ga.teams')::uuid, format(
  $q$insert into public.team_members (team_id, profile_id, is_leader) values (%L, %L, true)$q$,
  current_setting('ga.team_s'), current_setting('ga.cal'))), 'ok:1',
  'the teams ability adds a lead to an open team');
select is(pg_temp.as_person(current_setting('ga.teams')::uuid, format(
  $q$insert into public.teams (group_id, name) values (%L, 'Hospitality')$q$,
  current_setting('ga.grp'))), 'ok:1',
  'the teams ability adds a team');

-- A request for the prayer team reaches the team, the leaders and its author only.
insert into public.prayer_requests (org_id, group_id, author_id, body, audience) values
  (current_setting('ga.org_a')::uuid, current_setting('ga.grp')::uuid, current_setting('ga.plain')::uuid, 'team only', 'prayer_team'),
  (current_setting('ga.org_a')::uuid, current_setting('ga.grp')::uuid, current_setting('ga.plain')::uuid, 'whole group', 'group');

select is(pg_temp.ask(current_setting('ga.lead_s')::uuid, format(
  $q$select string_agg(body, ',' order by body) from public.prayer_requests where group_id = %L$q$, current_setting('ga.grp'))),
  'whole group', 'a member outside the prayer team reads only the whole-group request');
select is(pg_temp.ask(current_setting('ga.pray')::uuid, format(
  $q$select string_agg(body, ',' order by body) from public.prayer_requests where group_id = %L$q$, current_setting('ga.grp'))),
  'team only,whole group', 'a member of the linked prayer team reads the prayer-team request');
select is(pg_temp.ask(current_setting('ga.leader')::uuid, format(
  $q$select count(*)::text from public.prayer_wall where group_id = %L and audience = 'prayer_team'$q$, current_setting('ga.grp'))),
  '1', 'a leader reads it on the wall, marked for the prayer team');
select is(pg_temp.ask(current_setting('ga.plain')::uuid, format(
  $q$select count(*)::text from public.prayer_wall where group_id = %L and audience = 'prayer_team' and mine$q$, current_setting('ga.grp'))),
  '1', 'its author reads it back as their own');
select is(pg_temp.ask(current_setting('ga.carer')::uuid, format(
  $q$select count(*)::text from public.prayer_requests where group_id = %L and audience = 'prayer_team'$q$, current_setting('ga.grp'))),
  '1', 'someone given Prayer care by name reads it');
select throws_ok(
  format($q$insert into public.prayer_requests (org_id, group_id, author_hash, is_anonymous, body, audience)
    values (%L, %L, 'h', true, 'x', 'prayer_team')$q$, current_setting('ga.org_a'), current_setting('ga.grp')),
  '23514', null, 'a prayer-team request always carries its author''s name');

-- Unlinking reopens the team.
select is(pg_temp.as_person(current_setting('ga.carer')::uuid, format(
  $q$delete from public.team_abilities where team_id = %L$q$, current_setting('ga.team_p'))), 'ok:0',
  'only a leader unlinks a team');
select is(pg_temp.as_person(current_setting('ga.leader')::uuid, format(
  $q$delete from public.team_abilities where team_id = %L$q$, current_setting('ga.team_p'))), 'ok:1',
  'a leader unlinks the Prayer team');
select is(pg_temp.ask(current_setting('ga.pray')::uuid, format(
  $q$select public.has_group_ability(%L, 'prayer_care')::text$q$, current_setting('ga.grp'))), 'false',
  'unlinking takes Prayer care from the team''s members');
select is(pg_temp.ask(current_setting('ga.pray')::uuid, format(
  $q$select count(*)::text from public.prayer_requests where group_id = %L and audience = 'prayer_team'$q$, current_setting('ga.grp'))),
  '0', 'and with it the prayer-team requests');

-- ── 6. Pending, leaving, and other churches ─────────────────────────────────
update public.profiles set role = 'pending' where id = current_setting('ga.cal')::uuid;
select is(pg_temp.ask(current_setting('ga.cal')::uuid, format(
  $q$select public.has_group_ability(%L, 'calendar')::text$q$, current_setting('ga.grp'))), 'false',
  'a person moved back to pending holds no ability');
update public.profiles set role = 'member' where id = current_setting('ga.cal')::uuid;
select is(pg_temp.ask(current_setting('ga.cal')::uuid, format(
  $q$select public.has_group_ability(%L, 'calendar')::text$q$, current_setting('ga.grp'))), 'true',
  'and holds it again once approved');

delete from public.group_members
  where group_id = current_setting('ga.grp')::uuid and profile_id = current_setting('ga.cal')::uuid;
select is((select count(*)::int from public.group_member_abilities
  where profile_id = current_setting('ga.cal')::uuid), 0,
  'leaving the group removes the person''s abilities in it');

select is(pg_temp.ask(current_setting('ga.owner_b')::uuid, format(
  $q$select count(*)::text from public.group_member_abilities where group_id = %L$q$, current_setting('ga.grp'))), '0',
  'another church''s admin reads none of this group''s abilities');
select is(pg_temp.ask(current_setting('ga.owner_b')::uuid, format(
  $q$select public.has_group_ability(%L, 'members')::text$q$, current_setting('ga.grp'))), 'false',
  'another church''s admin holds no ability in this group');
select is(pg_temp.ask(current_setting('ga.plain')::uuid, format(
  $q$select count(*)::text from public.group_member_abilities where group_id = %L$q$, current_setting('ga.grp'))), '3',
  'a member of the group reads who holds which ability');

-- ── 7. Grants ───────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.has_group_ability(uuid, text)', 'execute'),
  'anon cannot execute has_group_ability()');
select ok(not has_table_privilege('anon', 'public.group_member_abilities', 'select'),
  'anon has no privilege on group_member_abilities');
select ok(not has_table_privilege('authenticated', 'public.team_abilities', 'update'),
  'a team link is added or removed, never edited');

select * from finish();
rollback;
