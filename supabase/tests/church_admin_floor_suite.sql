-- Church admin floor suite: profiles_keep_one_church_admin() refuses any
-- role change or delete that would leave an org with no church admin, and
-- counts only the row's own org. Role changes run as the authenticated
-- admin through the profiles UPDATE policy, the path the Members page
-- takes; deletes run as postgres, the only role that reaches them. Every
-- refusal has a paired positive control so the suite cannot go green by
-- refusing everything.
--
-- Two concurrent demotions cannot be raced inside one transaction; they are
-- simulated in sequence, which is the order the per-org lock forces.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/church_admin_floor_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Org A: owner_a is its only church admin; second_a and member_a are plain
-- members. Org B: owner_b plus a second church admin, admin_b. Org C: its
-- owner only, for the org-deletion case.
do $$
declare
  org_a uuid;
  org_b uuid;
  org_c uuid;
  owner_a uuid := gen_random_uuid();
  second_a uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  admin_b uuid := gen_random_uuid();
  owner_c uuid := gen_random_uuid();
begin
  org_a := public.provision_organization('Admin Floor Org A', 'owner-a@admin-floor.example.test');
  org_b := public.provision_organization('Admin Floor Org B', 'owner-b@admin-floor.example.test');
  org_c := public.provision_organization('Admin Floor Org C', 'owner-c@admin-floor.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Second A', 'second-a@admin-floor.example.test', 'approved'),
    (org_a, 'Member A', 'member-a@admin-floor.example.test', 'approved'),
    (org_b, 'Admin B', 'admin-b@admin-floor.example.test', 'approved');

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@admin-floor.example.test'),
    (second_a, 'second-a@admin-floor.example.test'),
    (member_a, 'member-a@admin-floor.example.test'),
    (owner_b, 'owner-b@admin-floor.example.test'),
    (admin_b, 'admin-b@admin-floor.example.test'),
    (owner_c, 'owner-c@admin-floor.example.test');

  update public.profiles set role = 'admin' where id = admin_b;

  perform set_config('af.org_a', org_a::text, true);
  perform set_config('af.org_b', org_b::text, true);
  perform set_config('af.org_c', org_c::text, true);
  perform set_config('af.owner_a', owner_a::text, true);
  perform set_config('af.second_a', second_a::text, true);
  perform set_config('af.member_a', member_a::text, true);
  perform set_config('af.owner_c', owner_c::text, true);
end $$;

select is(
  (select count(*)::int from public.profiles
     where org_id = current_setting('af.org_a')::uuid and role = 'admin'),
  1, 'org A starts with one church admin');
select is(
  (select count(*)::int from public.profiles
     where org_id = current_setting('af.org_b')::uuid and role = 'admin'),
  2, 'org B has two church admins, which must not count for org A');
select is(
  (select role from public.profiles where id = current_setting('af.second_a')::uuid),
  'member', 'second_a starts as a plain member');

-- ── 1. Shape ────────────────────────────────────────────────────────────────
select ok(
  exists (select 1 from pg_catalog.pg_trigger
           where tgrelid = 'public.profiles'::regclass
             and tgname = 'profiles_keep_one_church_admin'
             and not tgisinternal),
  'profiles carries the church admin floor trigger');
select ok(
  not (select prosecdef from pg_catalog.pg_proc
        where oid = 'public.profiles_keep_one_church_admin()'::regprocedure),
  'the trigger function is SECURITY INVOKER');

-- ── 2. The last church admin cannot be demoted or deleted ───────────────────
do $$
declare
  owner_a uuid := current_setting('af.owner_a')::uuid;
  member_a uuid := current_setting('af.member_a')::uuid;
  self_err text := 'none'; pending_err text := 'none';
  member_changed bigint := 0;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  perform set_config('request.headers', '{}', true);

  begin
    update public.profiles set role = 'member' where id = owner_a;
  exception when others then
    self_err := sqlstate;
  end;
  begin
    update public.profiles set role = 'pending' where id = owner_a;
  exception when others then
    pending_err := sqlstate;
  end;

  update public.profiles set role = 'pending' where id = member_a;
  get diagnostics member_changed = row_count;
  update public.profiles set role = 'member' where id = member_a;

  reset role;
  perform set_config('af.s2_self_err', self_err, true);
  perform set_config('af.s2_pending_err', pending_err, true);
  perform set_config('af.s2_member_changed', member_changed::text, true);
end $$;

select is(current_setting('af.s2_self_err'), 'CA001',
  'the only church admin cannot make themselves a member, though another org has two admins');
select is(current_setting('af.s2_pending_err'), 'CA001',
  'the only church admin cannot move themselves to pending');
select is(current_setting('af.s2_member_changed'), '1',
  'the church admin can still change a member''s role');

select throws_ok(
  format($q$ delete from public.profiles where id = %L $q$, current_setting('af.owner_a')),
  'CA001', null,
  'deleting the only church admin''s profile is refused');
select throws_ok(
  format($q$ delete from auth.users where id = %L $q$, current_setting('af.owner_a')),
  'CA001', null,
  'deleting the only church admin''s account is refused at the profile cascade');
select is(
  (select role from public.profiles where id = current_setting('af.owner_a')::uuid),
  'admin', 'the only church admin is still a church admin');

-- ── 3. Two church admins can demote each other ──────────────────────────────
do $$
declare
  owner_a uuid := current_setting('af.owner_a')::uuid;
  second_a uuid := current_setting('af.second_a')::uuid;
  promoted bigint := 0; demoted_second bigint := 0; demoted_owner bigint := 0;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  perform set_config('request.headers', '{}', true);

  update public.profiles set role = 'admin' where id = second_a;
  get diagnostics promoted = row_count;
  update public.profiles set role = 'member' where id = second_a;
  get diagnostics demoted_second = row_count;
  update public.profiles set role = 'admin' where id = second_a;

  perform set_config('request.jwt.claims', json_build_object('sub', second_a)::text, true);
  update public.profiles set role = 'member' where id = owner_a;
  get diagnostics demoted_owner = row_count;
  update public.profiles set role = 'admin' where id = owner_a;

  reset role;
  perform set_config('af.s3_promoted', promoted::text, true);
  perform set_config('af.s3_demoted_second', demoted_second::text, true);
  perform set_config('af.s3_demoted_owner', demoted_owner::text, true);
end $$;

select is(current_setting('af.s3_promoted'), '1', 'the church admin can add a second church admin');
select is(current_setting('af.s3_demoted_second'), '1',
  'with two church admins, the first can demote the second');
select is(current_setting('af.s3_demoted_owner'), '1',
  'with two church admins, the second can demote the first');

-- ── 4. Both of two admins stepping down leaves one ──────────────────────────
-- second_a is a church admin again after section 3.
do $$
declare
  owner_a uuid := current_setting('af.owner_a')::uuid;
  second_a uuid := current_setting('af.second_a')::uuid;
  both_err text := 'none'; owner_stepped bigint := 0; second_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  perform set_config('request.headers', '{}', true);

  begin
    update public.profiles set role = 'member' where id in (owner_a, second_a);
  exception when others then
    both_err := sqlstate;
  end;

  update public.profiles set role = 'member' where id = owner_a;
  get diagnostics owner_stepped = row_count;

  perform set_config('request.jwt.claims', json_build_object('sub', second_a)::text, true);
  begin
    update public.profiles set role = 'member' where id = second_a;
  exception when others then
    second_err := sqlstate;
  end;

  reset role;
  perform set_config('af.s4_both_err', both_err, true);
  perform set_config('af.s4_owner_stepped', owner_stepped::text, true);
  perform set_config('af.s4_second_err', second_err, true);
end $$;

select is(current_setting('af.s4_both_err'), 'CA001',
  'one statement demoting both church admins is refused as a whole');
select is(current_setting('af.s4_owner_stepped'), '1',
  'the first of two church admins can step down');
select is(current_setting('af.s4_second_err'), 'CA001',
  'the second church admin cannot then step down too');
select results_eq(
  format($q$ select id from public.profiles where org_id = %L and role = 'admin' $q$,
    current_setting('af.org_a')),
  format($q$ values (%L::uuid) $q$, current_setting('af.second_a')),
  'after both demotions are attempted, exactly one church admin remains');

select lives_ok(
  format($q$ delete from public.profiles where id = %L $q$, current_setting('af.owner_a')),
  'a former church admin''s profile can be deleted while another admin remains');

-- ── 5. Deleting the church takes its last admin with it ─────────────────────
select lives_ok(
  format($q$ delete from public.organizations where id = %L $q$, current_setting('af.org_c')),
  'deleting an organization cascades past its only church admin');
select is(
  (select count(*)::int from public.profiles where id = current_setting('af.owner_c')::uuid),
  0, 'the deleted organization''s church admin profile is gone');

select * from finish();
rollback;
