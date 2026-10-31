-- Team roster suite: what a team lead can do to their own team's members,
-- exercised from the authenticated role.
--
-- A team lead adds group members to their team and removes its non-lead
-- members. They cannot add a lead, change anyone's lead flag, remove a lead,
-- touch another team, add someone outside the group, or reach another org.
-- Every write records its row_count or SQLSTATE, so a refusal that silently
-- writes nothing cannot pass as a success, and every refusal has a paired
-- positive control so the suite cannot go green by rejecting everything.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/team_roster_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Org A, one group with two teams. lead_a and colead_a lead team T1 as plain
-- org and group members; member_a is on T1 and T2; joiner_a is in the group
-- but on no team; outsider_a is in the org but not the group.
-- Org B: lead_b leads team TB.
do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  lead_a uuid := gen_random_uuid();
  colead_a uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
  joiner_a uuid := gen_random_uuid();
  outsider_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  lead_b uuid := gen_random_uuid();
  grp_a uuid;
  grp_b uuid;
  t1 uuid;
  t2 uuid;
  tb uuid;
begin
  org_a := public.provision_organization('Team Roster Org A', 'owner-a@team-roster.example.test');
  org_b := public.provision_organization('Team Roster Org B', 'owner-b@team-roster.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Lead A', 'lead-a@team-roster.example.test', 'approved'),
    (org_a, 'Colead A', 'colead-a@team-roster.example.test', 'approved'),
    (org_a, 'Member A', 'member-a@team-roster.example.test', 'approved'),
    (org_a, 'Joiner A', 'joiner-a@team-roster.example.test', 'approved'),
    (org_a, 'Outsider A', 'outsider-a@team-roster.example.test', 'approved'),
    (org_b, 'Lead B', 'lead-b@team-roster.example.test', 'approved');

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@team-roster.example.test'),
    (lead_a, 'lead-a@team-roster.example.test'),
    (colead_a, 'colead-a@team-roster.example.test'),
    (member_a, 'member-a@team-roster.example.test'),
    (joiner_a, 'joiner-a@team-roster.example.test'),
    (outsider_a, 'outsider-a@team-roster.example.test'),
    (owner_b, 'owner-b@team-roster.example.test'),
    (lead_b, 'lead-b@team-roster.example.test');

  insert into public.groups (org_id, name) values (org_a, 'Team Roster A') returning id into grp_a;
  insert into public.groups (org_id, name) values (org_b, 'Team Roster B') returning id into grp_b;
  insert into public.teams (org_id, group_id, name) values (org_a, grp_a, 'Team Roster T1') returning id into t1;
  insert into public.teams (org_id, group_id, name) values (org_a, grp_a, 'Team Roster T2') returning id into t2;
  insert into public.teams (org_id, group_id, name) values (org_b, grp_b, 'Team Roster TB') returning id into tb;

  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org_a, grp_a, owner_a, 'leader'),
    (org_a, grp_a, lead_a, 'member'),
    (org_a, grp_a, colead_a, 'member'),
    (org_a, grp_a, member_a, 'member'),
    (org_a, grp_a, joiner_a, 'member'),
    (org_b, grp_b, owner_b, 'leader'),
    (org_b, grp_b, lead_b, 'member');
  insert into public.team_members (org_id, profile_id, team_id, is_leader) values
    (org_a, lead_a, t1, true),
    (org_a, colead_a, t1, true),
    (org_a, member_a, t1, false),
    (org_a, member_a, t2, false),
    (org_b, lead_b, tb, true);

  perform set_config('tr.org_a', org_a::text, true);
  perform set_config('tr.org_b', org_b::text, true);
  perform set_config('tr.lead_a', lead_a::text, true);
  perform set_config('tr.colead_a', colead_a::text, true);
  perform set_config('tr.member_a', member_a::text, true);
  perform set_config('tr.joiner_a', joiner_a::text, true);
  perform set_config('tr.outsider_a', outsider_a::text, true);
  perform set_config('tr.owner_b', owner_b::text, true);
  perform set_config('tr.lead_b', lead_b::text, true);
  perform set_config('tr.t1', t1::text, true);
  perform set_config('tr.t2', t2::text, true);
  perform set_config('tr.tb', tb::text, true);
end $$;

select is(
  (select role from public.profiles where id = current_setting('tr.lead_a')::uuid),
  'member', 'the team lead is a plain org member, so every write below passes through the team-lead arm');
select is(
  (select role from public.profiles where id = current_setting('tr.lead_b')::uuid),
  'member', 'the org-B team lead is a plain org member');

-- ── 1. Adding: a group member as a non-lead, never as a lead ───────────────
do $$
declare
  org_a uuid := current_setting('tr.org_a')::uuid;
  t1 uuid := current_setting('tr.t1')::uuid;
  joiner_a uuid := current_setting('tr.joiner_a')::uuid;
  as_lead_err text := 'none'; added bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('tr.lead_a'))::text, true);
  perform set_config('request.headers', '{}', true);

  begin
    insert into public.team_members (org_id, profile_id, team_id, is_leader)
      values (org_a, joiner_a, t1, true);
  exception when others then
    as_lead_err := sqlstate;
  end;

  insert into public.team_members (org_id, profile_id, team_id)
    values (org_a, joiner_a, t1);
  get diagnostics added = row_count;

  reset role;
  perform set_config('tr.as_lead_err', as_lead_err, true);
  perform set_config('tr.added', added::text, true);
end $$;

select is(current_setting('tr.as_lead_err'), '42501',
  'a team lead cannot add someone to their team as a lead');
select is(current_setting('tr.added')::int, 1,
  'a team lead adds a group member to their team');
select is(
  (select is_leader from public.team_members
    where team_id = current_setting('tr.t1')::uuid and profile_id = current_setting('tr.joiner_a')::uuid),
  false, 'the added person is a non-lead team member');

-- ── 2. The lead flag: no change in either direction ────────────────────────
do $$
declare
  t1 uuid := current_setting('tr.t1')::uuid;
  promoted bigint; demoted bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('tr.lead_a'))::text, true);
  perform set_config('request.headers', '{}', true);

  update public.team_members set is_leader = true
    where team_id = t1 and profile_id = current_setting('tr.member_a')::uuid;
  get diagnostics promoted = row_count;
  update public.team_members set is_leader = false
    where team_id = t1 and profile_id = current_setting('tr.colead_a')::uuid;
  get diagnostics demoted = row_count;

  reset role;
  perform set_config('tr.promoted', promoted::text, true);
  perform set_config('tr.demoted', demoted::text, true);
end $$;

select is(current_setting('tr.promoted')::int, 0,
  'a team lead cannot make a team member a lead');
select is(current_setting('tr.demoted')::int, 0,
  'a team lead cannot unmake another lead');
select is(
  (select count(*)::int from public.team_members
    where team_id = current_setting('tr.t1')::uuid and is_leader),
  2, 'the team still has exactly its two leads');

-- ── 3. Removing: non-leads only ─────────────────────────────────────────────
do $$
declare
  t1 uuid := current_setting('tr.t1')::uuid;
  colead_removed bigint; self_removed bigint; member_removed bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('tr.lead_a'))::text, true);
  perform set_config('request.headers', '{}', true);

  delete from public.team_members
    where team_id = t1 and profile_id = current_setting('tr.colead_a')::uuid;
  get diagnostics colead_removed = row_count;
  delete from public.team_members
    where team_id = t1 and profile_id = current_setting('tr.lead_a')::uuid;
  get diagnostics self_removed = row_count;
  delete from public.team_members
    where team_id = t1 and profile_id = current_setting('tr.member_a')::uuid;
  get diagnostics member_removed = row_count;

  reset role;
  perform set_config('tr.colead_removed', colead_removed::text, true);
  perform set_config('tr.self_removed', self_removed::text, true);
  perform set_config('tr.member_removed', member_removed::text, true);
end $$;

select is(current_setting('tr.colead_removed')::int, 0,
  'a team lead cannot remove another lead');
select is(current_setting('tr.self_removed')::int, 0,
  'a team lead cannot remove themselves, since they are a lead');
select is(current_setting('tr.member_removed')::int, 1,
  'a team lead removes a non-lead team member');

-- ── 4. Another team in the same group, and someone outside the group ───────
do $$
declare
  org_a uuid := current_setting('tr.org_a')::uuid;
  t1 uuid := current_setting('tr.t1')::uuid;
  t2 uuid := current_setting('tr.t2')::uuid;
  other_team_err text := 'none'; other_team_removed bigint; outsider_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('tr.lead_a'))::text, true);
  perform set_config('request.headers', '{}', true);

  begin
    insert into public.team_members (org_id, profile_id, team_id)
      values (org_a, current_setting('tr.joiner_a')::uuid, t2);
  exception when others then
    other_team_err := sqlstate;
  end;
  delete from public.team_members
    where team_id = t2 and profile_id = current_setting('tr.member_a')::uuid;
  get diagnostics other_team_removed = row_count;

  begin
    insert into public.team_members (org_id, profile_id, team_id)
      values (org_a, current_setting('tr.outsider_a')::uuid, t1);
  exception when others then
    outsider_err := sqlstate;
  end;

  reset role;
  perform set_config('tr.other_team_err', other_team_err, true);
  perform set_config('tr.other_team_removed', other_team_removed::text, true);
  perform set_config('tr.outsider_err', outsider_err, true);
end $$;

select is(current_setting('tr.other_team_err'), '42501',
  'a team lead cannot add anyone to a team they do not lead');
select is(current_setting('tr.other_team_removed')::int, 0,
  'a team lead cannot remove anyone from a team they do not lead');
select is(
  (select count(*)::int from public.team_members where team_id = current_setting('tr.t2')::uuid),
  1, 'the other team keeps its member');
select is(current_setting('tr.outsider_err'), '23514',
  'a team lead cannot add someone who is not in the team''s group');

-- ── 5. A plain team member has no roster writes ────────────────────────────
do $$
declare
  t1 uuid := current_setting('tr.t1')::uuid;
  add_err text := 'none'; removed bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('tr.joiner_a'))::text, true);
  perform set_config('request.headers', '{}', true);

  begin
    insert into public.team_members (org_id, profile_id, team_id)
      values (current_setting('tr.org_a')::uuid, current_setting('tr.member_a')::uuid, t1);
  exception when others then
    add_err := sqlstate;
  end;
  delete from public.team_members where team_id = t1 and not is_leader;
  get diagnostics removed = row_count;

  reset role;
  perform set_config('tr.member_add_err', add_err, true);
  perform set_config('tr.member_removed_any', removed::text, true);
end $$;

select is(current_setting('tr.member_add_err'), '42501',
  'a team member who is not a lead cannot add anyone');
select is(current_setting('tr.member_removed_any')::int, 0,
  'a team member who is not a lead cannot remove anyone');

-- ── 6. Nothing crosses orgs ─────────────────────────────────────────────────
-- Each insert names someone in the target team's group, so the membership
-- trigger passes and the refusal comes from the policies.
do $$
declare
  org_a uuid := current_setting('tr.org_a')::uuid;
  org_b uuid := current_setting('tr.org_b')::uuid;
  t1 uuid := current_setting('tr.t1')::uuid;
  tb uuid := current_setting('tr.tb')::uuid;
  b_into_a_err text := 'none'; b_into_a_own_org_err text := 'none'; b_removed bigint;
  a_into_b_err text := 'none'; a_removed bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('tr.lead_b'))::text, true);
  perform set_config('request.headers', '{}', true);

  begin
    insert into public.team_members (org_id, profile_id, team_id)
      values (org_a, current_setting('tr.member_a')::uuid, t1);
  exception when others then
    b_into_a_err := sqlstate;
  end;
  begin
    insert into public.team_members (org_id, profile_id, team_id)
      values (org_b, current_setting('tr.lead_b')::uuid, t1);
  exception when others then
    b_into_a_own_org_err := sqlstate;
  end;
  delete from public.team_members where team_id = t1;
  get diagnostics b_removed = row_count;

  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('tr.lead_a'))::text, true);
  begin
    insert into public.team_members (org_id, profile_id, team_id)
      values (org_b, current_setting('tr.owner_b')::uuid, tb);
  exception when others then
    a_into_b_err := sqlstate;
  end;
  delete from public.team_members where team_id = tb;
  get diagnostics a_removed = row_count;

  reset role;
  perform set_config('tr.b_into_a_err', b_into_a_err, true);
  perform set_config('tr.b_into_a_own_org_err', b_into_a_own_org_err, true);
  perform set_config('tr.b_removed', b_removed::text, true);
  perform set_config('tr.a_into_b_err', a_into_b_err, true);
  perform set_config('tr.a_removed', a_removed::text, true);
end $$;

select is(current_setting('tr.b_into_a_err'), '42501',
  'an org-B team lead cannot add anyone to an org-A team');
select ok(current_setting('tr.b_into_a_own_org_err') <> 'none',
  'an org-B team lead cannot attach an org-A team to an org-B row');
select is(current_setting('tr.b_removed')::int, 0,
  'an org-B team lead removes nobody from an org-A team');
select is(current_setting('tr.a_into_b_err'), '42501',
  'an org-A team lead cannot add anyone to an org-B team');
select is(current_setting('tr.a_removed')::int, 0,
  'an org-A team lead removes nobody from an org-B team');
select is(
  (select count(*)::int from public.team_members where team_id = current_setting('tr.t1')::uuid),
  3, 'T1 ends with its two leads and the added member');
select is(
  (select count(*)::int from public.team_members where team_id = current_setting('tr.tb')::uuid),
  1, 'the org-B team keeps its lead');

select * from finish();
rollback;
