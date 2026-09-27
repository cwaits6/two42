-- Group model suite: the org → group → team + label foundation.
--
-- Proves the one-group backfill against fixture orgs (CI applies migrations
-- to an empty database, so the migration's own run has nothing to observe),
-- the first within-org visibility boundary (a member of group A cannot read
-- or write group B), the structural same-group rule on labels, the helper
-- truth table, the grant matrix, and the structural pins the rename
-- depends on. Every "cannot" assertion has a paired positive control so the
-- suite cannot go green by rejecting everything.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/group_model_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Pinned before the fixture below lifts it for the carry-over scenario.
select col_not_null('public', 'teams', 'group_id', 'teams.group_id is NOT NULL');

-- ── Fixtures ────────────────────────────────────────────────────────────────
do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
  member_a2 uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  team_a uuid;
  team_b uuid;
  teams_before bigint;
  team_members_before bigint;
begin
  org_a := public.provision_organization('Group Model Org A', 'group-model-org-a', 'owner-a@group-model.example.test');
  org_b := public.provision_organization('Group Model Org B', 'group-model-org-b', 'owner-b@group-model.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Member A', 'member-a@group-model.example.test', 'approved'),
    (org_a, 'Member A2', 'member-a2@group-model.example.test', 'approved');

  -- Owners sign up after provisioning and become founding admins through
  -- approved_role = 'admin'; the two members resolve as plain members.
  insert into auth.users (id, email) values
    (owner_a, 'owner-a@group-model.example.test'),
    (member_a, 'member-a@group-model.example.test'),
    (member_a2, 'member-a2@group-model.example.test'),
    (owner_b, 'owner-b@group-model.example.test');

  -- The pending control: approved by request, then demoted before the
  -- backfill runs, so enrolment must skip them.
  update public.profiles set role = 'pending' where id = member_a2;

  -- Teams that predate the group model carry no group. The NOT NULL is
  -- lifted for this transaction only so the fixture can reproduce that
  -- state; the rollback restores it.
  alter table public.teams alter column group_id drop not null;
  insert into public.teams (org_id, name, is_serving_role)
    values (org_a, 'A serving team', true) returning id into team_a;
  insert into public.teams (org_id, name, is_serving_role)
    values (org_b, 'B serving team', true) returning id into team_b;
  insert into public.team_members (org_id, profile_id, team_id, is_leader) values
    (org_a, owner_a, team_a, true),
    (org_b, owner_b, team_b, false);

  select count(*) into teams_before from public.teams;
  select count(*) into team_members_before from public.team_members;

  perform public.group_model_backfill();

  perform set_config('gm.org_a', org_a::text, true);
  perform set_config('gm.org_b', org_b::text, true);
  perform set_config('gm.owner_a', owner_a::text, true);
  perform set_config('gm.member_a', member_a::text, true);
  perform set_config('gm.member_a2', member_a2::text, true);
  perform set_config('gm.owner_b', owner_b::text, true);
  perform set_config('gm.team_a', team_a::text, true);
  perform set_config('gm.team_b', team_b::text, true);
  perform set_config('gm.teams_before', teams_before::text, true);
  perform set_config('gm.team_members_before', team_members_before::text, true);
  perform set_config('gm.grp_a', (select id from public.groups where org_id = org_a)::text, true);
  perform set_config('gm.grp_b', (select id from public.groups where org_id = org_b)::text, true);
end $$;

-- ── 1. Backfill: exactly one group per org, named from branding ─────────────

select is(
  (select count(*)::int from public.groups
    where org_id in (current_setting('gm.org_a')::uuid, current_setting('gm.org_b')::uuid)),
  2, 'the backfill created exactly one group across the two fixture orgs');
select is(
  (select count(distinct org_id)::int from public.groups
    where org_id in (current_setting('gm.org_a')::uuid, current_setting('gm.org_b')::uuid)),
  2, 'each fixture org got its own group');

select is(
  (select name from public.groups where id = current_setting('gm.grp_a')::uuid),
  (select branding ->> 'display_name' from public.organizations
    where id = current_setting('gm.org_a')::uuid),
  'org A''s group is named from branding.display_name');
select is(
  (select name from public.groups where id = current_setting('gm.grp_a')::uuid),
  'Group Model Org A',
  'non-vacuity: the group name is the provisioned display name');

-- ── 2. Backfill: every approved member enrolled, every admin a leader ────────

select is(
  (select count(*)::int from public.group_members
    where group_id = current_setting('gm.grp_a')::uuid),
  2, 'org A''s group holds exactly its two approved members');
select is(
  (select role from public.group_members
    where group_id = current_setting('gm.grp_a')::uuid
      and profile_id = current_setting('gm.owner_a')::uuid),
  'leader', 'the org admin is a leader of the backfilled group');
select is(
  (select role from public.group_members
    where group_id = current_setting('gm.grp_a')::uuid
      and profile_id = current_setting('gm.member_a')::uuid),
  'member', 'an approved member is a member of the backfilled group');
select is(
  (select count(*)::int from public.group_members
    where group_id = current_setting('gm.grp_a')::uuid
      and profile_id = current_setting('gm.member_a2')::uuid),
  0, 'a pending profile is not enrolled');
select is(
  (select joined_at is not null from public.group_members
    where group_id = current_setting('gm.grp_a')::uuid
      and profile_id = current_setting('gm.member_a')::uuid),
  true, 'bulk enrolment stamps joined_at');

-- ── 3. Backfill: every team carried over, counts unchanged ──────────────────

select is(
  (select group_id from public.teams where id = current_setting('gm.team_a')::uuid),
  current_setting('gm.grp_a')::uuid,
  'org A''s pre-existing team now belongs to org A''s group');
select is(
  (select group_id from public.teams where id = current_setting('gm.team_b')::uuid),
  current_setting('gm.grp_b')::uuid,
  'org B''s pre-existing team now belongs to org B''s group');
select is(
  (select count(*)::int from public.teams where group_id is null),
  0, 'no team is left without a group');
select is(
  (select count(*) from public.teams),
  current_setting('gm.teams_before')::bigint,
  'the team count is unchanged by the backfill');
select is(
  (select count(*) from public.team_members),
  current_setting('gm.team_members_before')::bigint,
  'the team membership count is unchanged by the backfill');

-- ── 4. Backfill is idempotent ───────────────────────────────────────────────

select public.group_model_backfill();

select is(
  (select count(*)::int from public.groups
    where org_id in (current_setting('gm.org_a')::uuid, current_setting('gm.org_b')::uuid)),
  2, 'a second backfill run creates no further groups');
select is(
  (select count(*)::int from public.group_members
    where group_id = current_setting('gm.grp_a')::uuid),
  2, 'a second backfill run enrols nobody twice');

-- ── 5. Within-org boundary: a member of group A1 cannot see group A2 ────────
-- As postgres: re-approve member_a2 and give them their own group A2 in the
-- same org. member_a is in A1 only.
do $$
declare
  org_a uuid := current_setting('gm.org_a')::uuid;
  member_a2 uuid := current_setting('gm.member_a2')::uuid;
  grp_a2 uuid;
begin
  update public.profiles set role = 'member' where id = member_a2;
  insert into public.groups (org_id, name) values (org_a, 'Group Model A2') returning id into grp_a2;
  insert into public.group_members (org_id, group_id, profile_id, role)
    values (org_a, grp_a2, member_a2, 'member');
  perform set_config('gm.grp_a2', grp_a2::text, true);
  perform set_config('gm.a2_membership',
    (select id from public.group_members where group_id = grp_a2 and profile_id = member_a2)::text, true);
end $$;

do $$
declare
  member_a uuid := current_setting('gm.member_a')::uuid;
  own_members bigint; other_members bigint; visible_groups bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
  perform set_config('request.headers', '{}', true);

  select count(*) into own_members from public.group_members
    where group_id = current_setting('gm.grp_a')::uuid;
  select count(*) into other_members from public.group_members
    where group_id = current_setting('gm.grp_a2')::uuid;
  select count(*) into visible_groups from public.groups;

  reset role;
  perform set_config('gm.own_members', own_members::text, true);
  perform set_config('gm.other_members', other_members::text, true);
  perform set_config('gm.visible_groups', visible_groups::text, true);
end $$;

select is(current_setting('gm.other_members')::int, 0,
  'a member of group A1 reads no group_members rows of group A2 in the same org');
select cmp_ok(current_setting('gm.own_members')::int, '>=', 2,
  'non-vacuity: the same member reads their own group''s roster');
select is(current_setting('gm.visible_groups')::int, 1,
  'a member sees only the group they belong to');

-- ── 6. A leader of A1 cannot write A2 ───────────────────────────────────────
update public.group_members set role = 'leader'
  where group_id = current_setting('gm.grp_a')::uuid
    and profile_id = current_setting('gm.member_a')::uuid;

do $$
declare
  org_a uuid := current_setting('gm.org_a')::uuid;
  member_a uuid := current_setting('gm.member_a')::uuid;
  member_a2 uuid := current_setting('gm.member_a2')::uuid;
  grp_a uuid := current_setting('gm.grp_a')::uuid;
  grp_a2 uuid := current_setting('gm.grp_a2')::uuid;
  insert_err text := 'none';
  updated bigint; deleted bigint; own_insert bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
  perform set_config('request.headers', '{}', true);

  begin
    insert into public.group_members (org_id, group_id, profile_id)
      values (org_a, grp_a2, member_a);
  exception when others then
    insert_err := sqlstate;
  end;

  update public.group_members set role = 'leader' where group_id = grp_a2;
  get diagnostics updated = row_count;
  delete from public.group_members where group_id = grp_a2;
  get diagnostics deleted = row_count;

  -- Positive control: the same leader can enrol someone into their own group.
  insert into public.group_members (org_id, group_id, profile_id)
    values (org_a, grp_a, member_a2);
  get diagnostics own_insert = row_count;

  reset role;
  perform set_config('gm.cross_insert_err', insert_err, true);
  perform set_config('gm.cross_updated', updated::text, true);
  perform set_config('gm.cross_deleted', deleted::text, true);
  perform set_config('gm.own_insert', own_insert::text, true);
end $$;

select is(current_setting('gm.cross_insert_err'), '42501',
  'a leader of A1 cannot insert a membership into A2');
select is(current_setting('gm.cross_updated')::int, 0,
  'a leader of A1 updates no rows of A2');
select is(current_setting('gm.cross_deleted')::int, 0,
  'a leader of A1 deletes no rows of A2');
select is(current_setting('gm.own_insert')::int, 1,
  'positive control: the same leader enrols a member into A1');
select is(
  (select count(*)::int from public.group_members
    where group_id = current_setting('gm.grp_a2')::uuid),
  1, 'A2''s roster is intact after the cross-group write attempts');

-- ── 7. Labels: a label from A1 cannot be attached to a member of A2 ─────────
do $$
declare
  org_a uuid := current_setting('gm.org_a')::uuid;
  grp_a uuid := current_setting('gm.grp_a')::uuid;
  label_a1 uuid;
begin
  insert into public.group_labels (org_id, group_id, name)
    values (org_a, grp_a, 'Tuesday table') returning id into label_a1;
  perform set_config('gm.label_a1', label_a1::text, true);
  perform set_config('gm.a1_membership_a2',
    (select id from public.group_members
      where group_id = grp_a and profile_id = current_setting('gm.member_a2')::uuid)::text, true);
end $$;

-- Structural, as postgres (no RLS in play): both composite FKs carry
-- group_id, so the label's group and the membership's group must agree.
select throws_ok(
  $$ insert into public.group_member_labels (org_id, group_id, group_member_id, label_id)
     values (current_setting('gm.org_a')::uuid, current_setting('gm.grp_a2')::uuid,
             current_setting('gm.a2_membership')::uuid, current_setting('gm.label_a1')::uuid) $$,
  '23503', null,
  'a label defined in A1 cannot be attached to a membership of A2 (label FK)');
select throws_ok(
  $$ insert into public.group_member_labels (org_id, group_id, group_member_id, label_id)
     values (current_setting('gm.org_a')::uuid, current_setting('gm.grp_a')::uuid,
             current_setting('gm.a2_membership')::uuid, current_setting('gm.label_a1')::uuid) $$,
  '23503', null,
  'a membership of A2 cannot carry a label under A1''s group id (member FK)');

do $$
declare
  org_a uuid := current_setting('gm.org_a')::uuid;
  member_a uuid := current_setting('gm.member_a')::uuid;
  grp_a uuid := current_setting('gm.grp_a')::uuid;
  grp_a2 uuid := current_setting('gm.grp_a2')::uuid;
  attached bigint; label_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
  perform set_config('request.headers', '{}', true);

  -- Positive control: the A1 leader attaches an A1 label to an A1 member.
  insert into public.group_member_labels (org_id, group_id, group_member_id, label_id)
    values (org_a, grp_a, current_setting('gm.a1_membership_a2')::uuid,
            current_setting('gm.label_a1')::uuid);
  get diagnostics attached = row_count;

  begin
    insert into public.group_labels (org_id, group_id, name) values (org_a, grp_a2, 'Intruder');
  exception when others then
    label_err := sqlstate;
  end;

  reset role;
  perform set_config('gm.label_attached', attached::text, true);
  perform set_config('gm.label_err', label_err, true);
end $$;

select is(current_setting('gm.label_attached')::int, 1,
  'positive control: a leader of A1 attaches an A1 label to an A1 member');
select is(current_setting('gm.label_err'), '42501',
  'a leader of A1 cannot define a label in A2');

-- ── 8. Helper truth table ───────────────────────────────────────────────────
do $$
declare
  member_a uuid := current_setting('gm.member_a')::uuid;
  owner_a uuid := current_setting('gm.owner_a')::uuid;
  owner_b uuid := current_setting('gm.owner_b')::uuid;
  grp_a uuid := current_setting('gm.grp_a')::uuid;
  grp_a2 uuid := current_setting('gm.grp_a2')::uuid;
  team_a uuid := current_setting('gm.team_a')::uuid;
  r text;
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);

  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
  r := public.is_group_member(grp_a)::text || ',' || public.is_group_leader(grp_a)::text || ','
    || public.is_group_member(grp_a2)::text || ',' || public.is_group_leader(grp_a2)::text;
  perform set_config('gm.truth_member_a', r, true);

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  perform set_config('gm.team_lead_owner_a', public.is_team_lead(team_a)::text, true);

  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  r := public.is_group_member(grp_a)::text || ',' || public.is_group_leader(grp_a)::text || ','
    || public.is_team_lead(team_a)::text;
  perform set_config('gm.truth_owner_b', r, true);

  reset role;
end $$;

select is(current_setting('gm.truth_member_a'), 'true,true,false,false',
  'member_a: member and leader of A1, neither of A2');
select is(current_setting('gm.team_lead_owner_a'), 'true',
  'is_team_lead() is true for the team lead of a carried-over team');
select is(current_setting('gm.truth_owner_b'), 'false,false,false',
  'an org-B admin is neither member nor leader of an org-A group, nor lead of its team');

-- ── 9. Grants ───────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.is_group_member(uuid)', 'execute'),
  'anon cannot execute is_group_member()');
select ok(not has_function_privilege('anon', 'public.is_group_leader(uuid)', 'execute'),
  'anon cannot execute is_group_leader()');
select ok(not has_function_privilege('anon', 'public.is_team_lead(uuid)', 'execute'),
  'anon cannot execute is_team_lead()');
select ok(has_function_privilege('authenticated', 'public.is_group_member(uuid)', 'execute'),
  'authenticated can execute is_group_member()');
select ok(has_function_privilege('authenticated', 'public.is_group_leader(uuid)', 'execute'),
  'authenticated can execute is_group_leader()');
select ok(has_function_privilege('authenticated', 'public.is_team_lead(uuid)', 'execute'),
  'authenticated can execute is_team_lead()');
select ok(not has_function_privilege('anon', 'public.group_model_backfill()', 'execute'),
  'anon cannot execute group_model_backfill()');
select ok(not has_function_privilege('authenticated', 'public.group_model_backfill()', 'execute'),
  'authenticated cannot execute group_model_backfill()');
select ok(not has_function_privilege('service_role', 'public.group_model_backfill()', 'execute'),
  'service_role cannot execute group_model_backfill()');
select ok(
  not (select prosecdef from pg_proc where oid = 'public.group_model_backfill()'::regprocedure),
  'group_model_backfill() is not SECURITY DEFINER');

-- ── 10. Structural pins ─────────────────────────────────────────────────────
select ok(not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name in ('member_groups', 'profile_groups')),
  'member_groups and profile_groups no longer exist');
select ok(exists (
    select 1 from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
    where con.conname = 'teams_group_id_fkey' and a.attname = 'org_id'),
  'teams_group_id_fkey is composite on org_id');
select ok(exists (
    select 1 from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
    where con.conname = 'team_members_team_id_fkey' and a.attname = 'org_id'),
  'team_members_team_id_fkey is composite on org_id');
select ok(exists (
    select 1 from pg_constraint
    where conrelid = 'public.groups'::regclass and conname = 'groups_id_org_unique' and contype = 'u'),
  'groups carries unique (id, org_id)');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.group_members'::regclass and contype = 'f'
      and confrelid = 'public.groups'::regclass),
  1, 'group_members has exactly one FK into groups');
select ok(exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'group_members'
      and indexdef like '%(profile_id, org_id)%'),
  'group_members is indexed on (profile_id, org_id)');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('serving_signups', 'serving_signup_attendees', 'serving_broadcasts', 'serving_team_settings')
      and (qual like '%is_group_leader%' or with_check like '%is_group_leader%')),
  0, 'no serving policy still calls is_group_leader()');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and (qual like '%is_team_lead%' or with_check like '%is_team_lead%')
      and (tablename, policyname) in (
        ('serving_signups', 'Members can create serving signups'),
        ('serving_signups', 'Members can delete own serving signups'),
        ('serving_signup_attendees', 'Signup owners can remove attendees'),
        ('serving_broadcasts', 'Leaders and admins can view serving broadcasts'),
        ('serving_broadcasts', 'Leaders and admins can log serving broadcasts'),
        ('serving_team_settings', 'Leaders and admins can insert serving settings'),
        ('serving_team_settings', 'Leaders and admins can update serving settings'))),
  7, 'all seven serving policies are re-pointed at is_team_lead()');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('teams', 'team_members')
      and (policyname ilike '%member groups%' or policyname ilike '%profile groups%')),
  0, 'no policy on teams or team_members keeps the old table name');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('groups', 'group_members', 'group_labels', 'group_member_labels')
      and permissive = 'RESTRICTIVE' and qual like '%app\_request\_org\_id%'),
  4, 'every new table carries the restrictive isolation policy');

select * from finish();
rollback;
