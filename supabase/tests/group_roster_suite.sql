-- Group roster suite: the leader-facing writes behind the roster and the
-- Labels manager, exercised from the authenticated role.
--
-- group_model_suite.sql pins the same-group label rule at the FK level as
-- postgres and the cross-group label definition; this suite adds what the
-- roster UI relies on: the RLS arms a leader and a plain member hit when
-- attaching labels, changing roles, removing and adding members, deleting a
-- label (which detaches it everywhere), name uniqueness, the colour shape,
-- and the cross-org floor. Every "cannot" has a paired positive control so
-- the suite cannot go green by rejecting everything.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/group_roster_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Org A: leader_a1 leads A1 as a plain org member; member_a1 and member_a3
-- are members of A1; member_a2 is a member of A2 only. Org B: its owner.
do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  leader_a1 uuid := gen_random_uuid();
  member_a1 uuid := gen_random_uuid();
  member_a2 uuid := gen_random_uuid();
  member_a3 uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  grp_a1 uuid;
  grp_a2 uuid;
begin
  org_a := public.provision_organization('Group Roster Org A', 'owner-a@group-roster.example.test');
  org_b := public.provision_organization('Group Roster Org B', 'owner-b@group-roster.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Leader A1', 'leader-a1@group-roster.example.test', 'approved'),
    (org_a, 'Member A1', 'member-a1@group-roster.example.test', 'approved'),
    (org_a, 'Member A2', 'member-a2@group-roster.example.test', 'approved'),
    (org_a, 'Member A3', 'member-a3@group-roster.example.test', 'approved');

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@group-roster.example.test'),
    (leader_a1, 'leader-a1@group-roster.example.test'),
    (member_a1, 'member-a1@group-roster.example.test'),
    (member_a2, 'member-a2@group-roster.example.test'),
    (member_a3, 'member-a3@group-roster.example.test'),
    (owner_b, 'owner-b@group-roster.example.test');

  -- Kept out of the backfill so A2 is their only group.
  update public.profiles set role = 'pending' where id = member_a2;

  perform public.group_model_backfill();

  select id into grp_a1 from public.groups where org_id = org_a;
  update public.group_members set role = 'leader'
    where group_id = grp_a1 and profile_id = leader_a1;

  update public.profiles set role = 'member' where id = member_a2;
  insert into public.groups (org_id, name) values (org_a, 'Group Roster A2') returning id into grp_a2;
  insert into public.group_members (org_id, group_id, profile_id, role)
    values (org_a, grp_a2, member_a2, 'member');

  perform set_config('gr.org_a', org_a::text, true);
  perform set_config('gr.org_b', org_b::text, true);
  perform set_config('gr.leader_a1', leader_a1::text, true);
  perform set_config('gr.member_a1', member_a1::text, true);
  perform set_config('gr.member_a2', member_a2::text, true);
  perform set_config('gr.member_a3', member_a3::text, true);
  perform set_config('gr.owner_b', owner_b::text, true);
  perform set_config('gr.grp_a1', grp_a1::text, true);
  perform set_config('gr.grp_a2', grp_a2::text, true);
  perform set_config('gr.m_a1', (select id from public.group_members where group_id = grp_a1 and profile_id = member_a1)::text, true);
  perform set_config('gr.m_a3', (select id from public.group_members where group_id = grp_a1 and profile_id = member_a3)::text, true);
  perform set_config('gr.m_a2', (select id from public.group_members where group_id = grp_a2 and profile_id = member_a2)::text, true);
end $$;

select is(
  (select role from public.profiles where id = current_setting('gr.leader_a1')::uuid),
  'member', 'the A1 leader is a plain org member, so every write below passes through the leader arm');
select is(
  (select role from public.group_members where id = current_setting('gr.m_a1')::uuid),
  'member', 'member_a1 starts as a member of A1');

-- ── 1. A leader defines labels in their own group only, and attaches them to its members only ──
do $$
declare
  org_a uuid := current_setting('gr.org_a')::uuid;
  leader_a1 uuid := current_setting('gr.leader_a1')::uuid;
  grp_a1 uuid := current_setting('gr.grp_a1')::uuid;
  grp_a2 uuid := current_setting('gr.grp_a2')::uuid;
  m_a1 uuid := current_setting('gr.m_a1')::uuid;
  m_a2 uuid := current_setting('gr.m_a2')::uuid;
  label_a1 uuid;
  define_err text := 'none'; own_define bigint;
  attach_a2_err text := 'none'; attach_a1_fk_err text := 'none'; own_attach bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  perform set_config('request.headers', '{}', true);

  begin
    insert into public.group_labels (org_id, group_id, name) values (org_a, grp_a2, 'Intruder');
  exception when others then
    define_err := sqlstate;
  end;

  insert into public.group_labels (org_id, group_id, name)
    values (org_a, grp_a1, 'Tuesday table') returning id into label_a1;
  get diagnostics own_define = row_count;

  -- Under A2's group id the leader arm fails before any FK is consulted.
  begin
    insert into public.group_member_labels (org_id, group_id, group_member_id, label_id)
      values (org_a, grp_a2, m_a2, label_a1);
  exception when others then
    attach_a2_err := sqlstate;
  end;

  -- Under A1's group id the policy passes and the member FK refuses.
  begin
    insert into public.group_member_labels (org_id, group_id, group_member_id, label_id)
      values (org_a, grp_a1, m_a2, label_a1);
  exception when others then
    attach_a1_fk_err := sqlstate;
  end;

  insert into public.group_member_labels (org_id, group_id, group_member_id, label_id)
    values (org_a, grp_a1, m_a1, label_a1);
  get diagnostics own_attach = row_count;

  reset role;
  perform set_config('gr.label_a1', label_a1::text, true);
  perform set_config('gr.define_err', define_err, true);
  perform set_config('gr.own_define', own_define::text, true);
  perform set_config('gr.attach_a2_err', attach_a2_err, true);
  perform set_config('gr.attach_a1_fk_err', attach_a1_fk_err, true);
  perform set_config('gr.own_attach', own_attach::text, true);
end $$;

select is(current_setting('gr.define_err'), '42501',
  'a leader of A1 cannot create a label in A2');
select is(current_setting('gr.own_define')::int, 1,
  'positive control: the same leader creates a label in A1');
select is(current_setting('gr.attach_a2_err'), '42501',
  'a leader of A1 cannot attach an A1 label to an A2 member under A2''s group id (leader arm)');
select is(current_setting('gr.attach_a1_fk_err'), '23503',
  'a leader of A1 cannot attach an A1 label to an A2 member under A1''s group id (member FK)');
select is(current_setting('gr.own_attach')::int, 1,
  'positive control: the same leader attaches the label to an A1 member');
select is(
  (select count(*)::int from public.group_member_labels
    where group_member_id = current_setting('gr.m_a2')::uuid),
  0, 'the A2 membership carries no label after the cross-group attempts');

-- ── 2. A plain member reads labels and writes none ──────────────────────────
do $$
declare
  org_a uuid := current_setting('gr.org_a')::uuid;
  member_a1 uuid := current_setting('gr.member_a1')::uuid;
  grp_a1 uuid := current_setting('gr.grp_a1')::uuid;
  m_a3 uuid := current_setting('gr.m_a3')::uuid;
  label_a1 uuid := current_setting('gr.label_a1')::uuid;
  seen_labels bigint; seen_applied bigint;
  define_err text := 'none'; attach_err text := 'none';
  renamed bigint; deleted bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  perform set_config('request.headers', '{}', true);

  select count(*) into seen_labels from public.group_labels where group_id = grp_a1;
  select count(*) into seen_applied from public.group_member_labels where group_id = grp_a1;

  begin
    insert into public.group_labels (org_id, group_id, name) values (org_a, grp_a1, 'Member label');
  exception when others then
    define_err := sqlstate;
  end;
  begin
    insert into public.group_member_labels (org_id, group_id, group_member_id, label_id)
      values (org_a, grp_a1, m_a3, label_a1);
  exception when others then
    attach_err := sqlstate;
  end;
  update public.group_labels set name = 'Renamed' where id = label_a1;
  get diagnostics renamed = row_count;
  delete from public.group_labels where id = label_a1;
  get diagnostics deleted = row_count;

  reset role;
  perform set_config('gr.member_seen_labels', seen_labels::text, true);
  perform set_config('gr.member_seen_applied', seen_applied::text, true);
  perform set_config('gr.member_define_err', define_err, true);
  perform set_config('gr.member_attach_err', attach_err, true);
  perform set_config('gr.member_renamed', renamed::text, true);
  perform set_config('gr.member_deleted', deleted::text, true);
end $$;

select cmp_ok(current_setting('gr.member_seen_labels')::int, '>=', 1,
  'non-vacuity: a member of A1 reads A1''s labels');
select cmp_ok(current_setting('gr.member_seen_applied')::int, '>=', 1,
  'non-vacuity: a member of A1 reads A1''s label applications');
select is(current_setting('gr.member_define_err'), '42501',
  'a plain member cannot create a label');
select is(current_setting('gr.member_attach_err'), '42501',
  'a plain member cannot attach a label');
select is(current_setting('gr.member_renamed')::int, 0,
  'a plain member renames no label');
select is(current_setting('gr.member_deleted')::int, 0,
  'a plain member deletes no label');
select is(
  (select name from public.group_labels where id = current_setting('gr.label_a1')::uuid),
  'Tuesday table', 'the label is unchanged after the member''s write attempts');

-- ── 3. Role change and removal ──────────────────────────────────────────────
do $$
declare
  grp_a1 uuid := current_setting('gr.grp_a1')::uuid;
  leader_a1 uuid := current_setting('gr.leader_a1')::uuid;
  member_a1 uuid := current_setting('gr.member_a1')::uuid;
  m_a1 uuid := current_setting('gr.m_a1')::uuid;
  m_a2 uuid := current_setting('gr.m_a2')::uuid;
  promoted bigint; demoted bigint; member_updated bigint;
  cross_deleted bigint; own_deleted bigint;
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);

  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  update public.group_members set role = 'leader' where id = m_a1 and group_id = grp_a1;
  get diagnostics promoted = row_count;
  update public.group_members set role = 'member' where id = m_a1 and group_id = grp_a1;
  get diagnostics demoted = row_count;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  update public.group_members set role = 'leader' where group_id = grp_a1;
  get diagnostics member_updated = row_count;

  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  delete from public.group_members where id = m_a2;
  get diagnostics cross_deleted = row_count;
  delete from public.group_members where id = m_a1 and group_id = grp_a1;
  get diagnostics own_deleted = row_count;

  reset role;
  perform set_config('gr.promoted', promoted::text, true);
  perform set_config('gr.demoted', demoted::text, true);
  perform set_config('gr.member_updated', member_updated::text, true);
  perform set_config('gr.cross_deleted', cross_deleted::text, true);
  perform set_config('gr.own_deleted', own_deleted::text, true);
end $$;

select is(current_setting('gr.promoted')::int, 1,
  'a leader promotes a member of their group to leader');
select is(current_setting('gr.demoted')::int, 1,
  'a leader demotes that leader back to member');
select is(current_setting('gr.member_updated')::int, 0,
  'a plain member changes nobody''s role');
select is(current_setting('gr.cross_deleted')::int, 0,
  'a leader of A1 removes nobody from A2');
select is(current_setting('gr.own_deleted')::int, 1,
  'positive control: the same leader removes a member of A1');
select is(
  (select count(*)::int from public.group_member_labels
    where group_member_id = current_setting('gr.m_a1')::uuid),
  0, 'removing a member drops their label applications (member FK cascade)');
select is(
  (select count(*)::int from public.group_members where id = current_setting('gr.m_a2')::uuid),
  1, 'the A2 membership is intact after the cross-group delete attempt');

-- ── 4. Deleting a label detaches it from every member ───────────────────────
-- member_a1 is back in A1 as postgres so two members can carry the label.
do $$
declare
  org_a uuid := current_setting('gr.org_a')::uuid;
  grp_a1 uuid := current_setting('gr.grp_a1')::uuid;
  leader_a1 uuid := current_setting('gr.leader_a1')::uuid;
  member_a1 uuid := current_setting('gr.member_a1')::uuid;
  m_a3 uuid := current_setting('gr.m_a3')::uuid;
  label_a1 uuid := current_setting('gr.label_a1')::uuid;
  m_a1 uuid;
  applied bigint; label_deleted bigint;
begin
  insert into public.group_members (org_id, group_id, profile_id)
    values (org_a, grp_a1, member_a1) returning id into m_a1;
  perform set_config('gr.m_a1_again', m_a1::text, true);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  perform set_config('request.headers', '{}', true);

  insert into public.group_member_labels (org_id, group_id, group_member_id, label_id)
    values (org_a, grp_a1, m_a1, label_a1), (org_a, grp_a1, m_a3, label_a1);
  get diagnostics applied = row_count;
  delete from public.group_labels where id = label_a1 and group_id = grp_a1;
  get diagnostics label_deleted = row_count;

  reset role;
  perform set_config('gr.bulk_applied', applied::text, true);
  perform set_config('gr.label_deleted', label_deleted::text, true);
end $$;

select is(current_setting('gr.bulk_applied')::int, 2,
  'a leader applies a label to two members in one statement');
select is(current_setting('gr.label_deleted')::int, 1,
  'a leader deletes a label of their group');
select is(
  (select count(*)::int from public.group_member_labels
    where label_id = current_setting('gr.label_a1')::uuid),
  0, 'deleting the label detaches it from every member (label FK cascade)');
select is(
  (select count(*)::int from public.group_members
    where id in (current_setting('gr.m_a1_again')::uuid, current_setting('gr.m_a3')::uuid)),
  2, 'the memberships survive the label delete');

-- ── 5. Add member ───────────────────────────────────────────────────────────
do $$
declare
  org_a uuid := current_setting('gr.org_a')::uuid;
  grp_a1 uuid := current_setting('gr.grp_a1')::uuid;
  leader_a1 uuid := current_setting('gr.leader_a1')::uuid;
  member_a1 uuid := current_setting('gr.member_a1')::uuid;
  member_a2 uuid := current_setting('gr.member_a2')::uuid;
  added bigint; dup_err text := 'none'; member_add_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);

  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  insert into public.group_members (org_id, group_id, profile_id, role, added_by)
    values (org_a, grp_a1, member_a2, 'member', leader_a1);
  get diagnostics added = row_count;
  begin
    insert into public.group_members (org_id, group_id, profile_id)
      values (org_a, grp_a1, member_a2);
  exception when others then
    dup_err := sqlstate;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  begin
    insert into public.group_members (org_id, group_id, profile_id)
      values (org_a, grp_a1, gen_random_uuid());
  exception when others then
    member_add_err := sqlstate;
  end;

  reset role;
  perform set_config('gr.added', added::text, true);
  perform set_config('gr.dup_err', dup_err, true);
  perform set_config('gr.member_add_err', member_add_err, true);
end $$;

select is(current_setting('gr.added')::int, 1,
  'a leader adds a person from another group to their group');
select is(current_setting('gr.dup_err'), '23505',
  'adding the same person twice is a unique violation');
select is(current_setting('gr.member_add_err'), '42501',
  'a plain member cannot add anyone');

-- ── 6. Label name uniqueness and colour shape ───────────────────────────────
do $$
declare
  org_a uuid := current_setting('gr.org_a')::uuid;
  grp_a1 uuid := current_setting('gr.grp_a1')::uuid;
  leader_a1 uuid := current_setting('gr.leader_a1')::uuid;
  created bigint; dup_err text := 'none'; color_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  perform set_config('request.headers', '{}', true);

  insert into public.group_labels (org_id, group_id, name, color) values (org_a, grp_a1, 'Tuesday table', '#B85C38');
  get diagnostics created = row_count;
  begin
    insert into public.group_labels (org_id, group_id, name) values (org_a, grp_a1, 'Tuesday table');
  exception when others then
    dup_err := sqlstate;
  end;
  begin
    insert into public.group_labels (org_id, group_id, name, color) values (org_a, grp_a1, 'Red', 'red');
  exception when others then
    color_err := sqlstate;
  end;

  reset role;
  perform set_config('gr.recreated', created::text, true);
  perform set_config('gr.name_dup_err', dup_err, true);
  perform set_config('gr.color_err', color_err, true);
end $$;

select is(current_setting('gr.recreated')::int, 1,
  'positive control: a label with a six-digit hex colour is accepted');
select is(current_setting('gr.name_dup_err'), '23505',
  'a second label with the same name in the same group is a unique violation');
select lives_ok(
  $$ insert into public.group_labels (org_id, group_id, name)
     values (current_setting('gr.org_a')::uuid, current_setting('gr.grp_a2')::uuid, 'Tuesday table') $$,
  'the same label name is free in another group');
select is(current_setting('gr.color_err'), '23514',
  'a colour outside the six-digit hex shape is a check violation');

-- ── 7. Structural pins ──────────────────────────────────────────────────────
select hasnt_column('public', 'teams', 'show_in_directory_filter',
  'teams no longer carries show_in_directory_filter');
select is(
  (select confdeltype from pg_constraint where conname = 'group_member_labels_label_fkey'),
  'c', 'group_member_labels_label_fkey cascades on delete');
select is(
  (select confdeltype from pg_constraint where conname = 'group_member_labels_member_fkey'),
  'c', 'group_member_labels_member_fkey cascades on delete');
select ok(exists (
    select 1 from pg_constraint con
    where con.conrelid = 'public.group_labels'::regclass
      and con.conname = 'group_labels_group_name_key' and con.contype = 'u'
      and (select array_agg(a.attname::text order by k.ord)
           from unnest(con.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum)
          = array['group_id', 'name']),
  'group_labels_group_name_key is unique on (group_id, name)');

-- ── 8. Cross-org floor ──────────────────────────────────────────────────────
do $$
declare
  org_a uuid := current_setting('gr.org_a')::uuid;
  grp_a1 uuid := current_setting('gr.grp_a1')::uuid;
  owner_b uuid := current_setting('gr.owner_b')::uuid;
  seen bigint; insert_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  perform set_config('request.headers', '{}', true);

  select count(*) into seen from public.group_labels where org_id = org_a;
  begin
    insert into public.group_labels (org_id, group_id, name) values (org_a, grp_a1, 'From B');
  exception when others then
    insert_err := sqlstate;
  end;

  reset role;
  perform set_config('gr.b_seen', seen::text, true);
  perform set_config('gr.b_insert_err', insert_err, true);
end $$;

select is(current_setting('gr.b_seen')::int, 0,
  'an org-B admin reads no org-A labels');
select is(current_setting('gr.b_insert_err'), '42501',
  'an org-B admin cannot create a label under org A (restrictive floor)');
select cmp_ok(
  (select count(*)::int from public.group_labels where org_id = current_setting('gr.org_a')::uuid),
  '>=', 1, 'non-vacuity: org A holds labels the org-B admin could not see');

select * from finish();
rollback;
