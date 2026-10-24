-- Directory visibility suite: group membership as the people boundary.
--
-- Proves the rewritten profiles / family_units / family_members SELECT
-- policies and the views over them against two fixture orgs: a member reads
-- the people who share a group with them, every profile when the org admin
-- opens the directory, always themselves and their own household; an org
-- admin reads everyone. Also pins the setting's column, grants and single
-- write policy, the three helpers' truth table and ACLs, and the signup
-- enrolment rule for a one-group org. Every "cannot" assertion has a
-- paired positive control so the suite cannot go green by hiding everything.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/directory_visibility_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Probe helpers: run one statement as an authenticated actor ──────────────
-- SET LOCAL ROLE inside the function lasts until reset role; a failed
-- statement rolls the role change back with its subtransaction.
create function pg_temp.as_count(_actor uuid, _query text) returns bigint
  language plpgsql as $$
declare _result bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  set local role authenticated;
  execute _query into _result;
  reset role;
  return _result;
end $$;

create function pg_temp.as_text(_actor uuid, _query text) returns text
  language plpgsql as $$
declare _result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  set local role authenticated;
  execute _query into _result;
  reset role;
  return _result;
end $$;

-- 'rows=N' for a write that ran, else the SQLSTATE it raised.
create function pg_temp.as_write(_actor uuid, _query text) returns text
  language plpgsql as $$
declare _n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  set local role authenticated;
  begin
    execute _query;
    get diagnostics _n = row_count;
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'rows=' || _n;
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  m0 uuid := gen_random_uuid();
  m1 uuid := gen_random_uuid();
  m2 uuid := gen_random_uuid();
  m3 uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid();
  grp_1 uuid; grp_2 uuid;
  fam0 uuid; fam1 uuid; fam2 uuid; fam3 uuid;
begin
  org_a := public.provision_organization('Directory Visibility Org A', 'owner-a@directory-visibility.example.test');
  org_b := public.provision_organization('Directory Visibility Org B', 'owner-b@directory-visibility.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Member 0', 'm0@directory-visibility.example.test', 'approved'),
    (org_a, 'Member 1', 'm1@directory-visibility.example.test', 'approved'),
    (org_a, 'Member 2', 'm2@directory-visibility.example.test', 'approved'),
    (org_a, 'Member 3', 'm3@directory-visibility.example.test', 'approved'),
    (org_b, 'Member B1', 'b1@directory-visibility.example.test', 'approved');

  -- Neither org has a group yet, so none of these signups is enrolled: the
  -- zero-groups half of the enrolment rule, asserted below.
  insert into auth.users (id, email) values
    (owner_a, 'owner-a@directory-visibility.example.test'),
    (m0, 'm0@directory-visibility.example.test'),
    (m1, 'm1@directory-visibility.example.test'),
    (m2, 'm2@directory-visibility.example.test'),
    (m3, 'm3@directory-visibility.example.test'),
    (owner_b, 'owner-b@directory-visibility.example.test'),
    (b1, 'b1@directory-visibility.example.test');

  perform set_config('dv.enrolled_with_no_groups',
    (select count(*) from public.group_members where org_id in (org_a, org_b))::text, true);

  -- Org A: G1 = {m1, m2}, G2 = {m3}; m0 is in no group; the admin is in none.
  insert into public.groups (org_id, name) values (org_a, 'G1') returning id into grp_1;
  insert into public.groups (org_id, name) values (org_a, 'G2') returning id into grp_2;
  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org_a, grp_1, m1, 'member'),
    (org_a, grp_1, m2, 'member'),
    (org_a, grp_2, m3, 'member');

  -- One household per member; m3's has a child with no account.
  insert into public.family_units (org_id, family_name) values (org_a, 'Household 0') returning id into fam0;
  insert into public.family_units (org_id, family_name) values (org_a, 'Household 1') returning id into fam1;
  insert into public.family_units (org_id, family_name) values (org_a, 'Household 2') returning id into fam2;
  insert into public.family_units (org_id, family_name) values (org_a, 'Household 3') returning id into fam3;
  update public.profiles set family_id = fam0 where id = m0;
  update public.profiles set family_id = fam1 where id = m1;
  update public.profiles set family_id = fam2 where id = m2;
  update public.profiles set family_id = fam3 where id = m3;
  insert into public.family_members (org_id, family_id, first_name, relationship)
    values (org_a, fam3, 'Kid', 'child');

  -- Org B is the one-group case: the backfill gives it its group and enrols
  -- both approved members. Org A already has groups and is left alone.
  perform public.group_model_backfill();

  perform set_config('dv.org_a', org_a::text, true);
  perform set_config('dv.org_b', org_b::text, true);
  perform set_config('dv.owner_a', owner_a::text, true);
  perform set_config('dv.m0', m0::text, true);
  perform set_config('dv.m1', m1::text, true);
  perform set_config('dv.m2', m2::text, true);
  perform set_config('dv.m3', m3::text, true);
  perform set_config('dv.owner_b', owner_b::text, true);
  perform set_config('dv.b1', b1::text, true);
  perform set_config('dv.grp_1', grp_1::text, true);
  perform set_config('dv.grp_2', grp_2::text, true);
  perform set_config('dv.fam0', fam0::text, true);
  perform set_config('dv.fam2', fam2::text, true);
  perform set_config('dv.fam3', fam3::text, true);
  perform set_config('dv.grp_b', (select id from public.groups where org_id = org_b)::text, true);
end $$;

select is(
  (select count(*)::int from public.groups where org_id = current_setting('dv.org_b')::uuid),
  1, 'fixture: org B has exactly one group');
select is(
  (select count(*)::int from public.group_members
    where group_id = current_setting('dv.grp_b')::uuid),
  2, 'fixture: both approved members of org B are enrolled in its group');

-- ── 1. Default (shared_groups): a shared group is the boundary ──────────────

select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.m2'))),
  1::bigint, 'm1 reads m2''s profile (they share G1)');
select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.m3'))),
  0::bigint, 'm1 reads no row for m3 (no shared group) under shared_groups');
select is(
  pg_temp.as_count(current_setting('dv.m3')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.m1'))),
  0::bigint, 'm3 reads no row for m1 either: the rule is symmetric');
select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.m1'))),
  1::bigint, 'm1 always reads their own profile');

-- A member in no group keeps themselves and their household, nothing else.
select is(
  pg_temp.as_count(current_setting('dv.m0')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.m0'))),
  1::bigint, 'a member in no group reads their own profile');
select is(
  pg_temp.as_count(current_setting('dv.m0')::uuid,
    format('select count(*) from public.family_units where id = %L', current_setting('dv.fam0'))),
  1::bigint, 'a member in no group reads their own household');
select is(
  pg_temp.as_count(current_setting('dv.m0')::uuid,
    format('select count(*) from public.profiles where org_id = %L', current_setting('dv.org_a'))),
  1::bigint, 'a member in no group reads nobody else');

-- ── 2. The org admin reads everyone ─────────────────────────────────────────

select is(
  pg_temp.as_count(current_setting('dv.owner_a')::uuid,
    format('select count(*) from public.profiles where org_id = %L', current_setting('dv.org_a'))),
  5::bigint, 'the org admin reads all five org A profiles under shared_groups');

-- ── 3. directory_visibility = org opens the directory, and the arm is live ──

update public.organizations set directory_visibility = 'org'
  where id = current_setting('dv.org_a')::uuid;

select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.m3'))),
  1::bigint, 'with directory_visibility = org, m1 reads m3');
select is(
  pg_temp.as_count(current_setting('dv.m3')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.m1'))),
  1::bigint, 'with directory_visibility = org, m3 reads m1');
select is(
  pg_temp.as_count(current_setting('dv.m0')::uuid,
    format('select count(*) from public.profiles where org_id = %L', current_setting('dv.org_a'))),
  5::bigint, 'with directory_visibility = org, a member in no group reads the whole org');

update public.organizations set directory_visibility = 'shared_groups'
  where id = current_setting('dv.org_a')::uuid;

select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.m3'))),
  0::bigint, 'reverting to shared_groups hides m3 from m1 again: the policy reads the live value');

-- ── 4. Households follow the same rule ──────────────────────────────────────

select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.family_units where id = %L', current_setting('dv.fam3'))),
  0::bigint, 'm1 reads no family_units row for m3''s household under shared_groups');
select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.family_members where family_id = %L', current_setting('dv.fam3'))),
  0::bigint, 'm1 reads no family_members row of m3''s household under shared_groups');
select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.family_units where id = %L', current_setting('dv.fam2'))),
  1::bigint, 'positive control: m1 reads m2''s household');

update public.organizations set directory_visibility = 'org'
  where id = current_setting('dv.org_a')::uuid;
select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.family_units where id = %L', current_setting('dv.fam3'))),
  1::bigint, 'with directory_visibility = org, m1 reads m3''s household');
select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.family_members where family_id = %L', current_setting('dv.fam3'))),
  1::bigint, 'with directory_visibility = org, m1 reads the child in m3''s household');
update public.organizations set directory_visibility = 'shared_groups'
  where id = current_setting('dv.org_a')::uuid;

-- ── 5. The directory views narrow with the base tables ──────────────────────

select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.profiles_directory where id = %L', current_setting('dv.m3'))),
  0::bigint, 'profiles_directory excludes m3 for m1 under shared_groups');
select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.profiles_directory where id = %L', current_setting('dv.m2'))),
  1::bigint, 'positive control: profiles_directory lists m2 for m1');
select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.families_directory_full where id = %L', current_setting('dv.fam3'))),
  0::bigint, 'families_directory_full excludes m3''s household for m1 under shared_groups');

update public.organizations set directory_visibility = 'org'
  where id = current_setting('dv.org_a')::uuid;
select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.profiles_directory where id = %L', current_setting('dv.m3'))),
  1::bigint, 'with directory_visibility = org, profiles_directory lists m3 for m1');
select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.families_directory_full where id = %L', current_setting('dv.fam3'))),
  1::bigint, 'with directory_visibility = org, families_directory_full lists m3''s household for m1');
update public.organizations set directory_visibility = 'shared_groups'
  where id = current_setting('dv.org_a')::uuid;

-- ── 6. A one-group org sees no change ───────────────────────────────────────

select is(
  pg_temp.as_count(current_setting('dv.b1')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.owner_b'))),
  1::bigint, 'in the one-group org, a member reads the admin''s profile under the default');
select is(
  pg_temp.as_count(current_setting('dv.owner_b')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.b1'))),
  1::bigint, 'in the one-group org, the admin reads the member');
select is(
  pg_temp.as_count(current_setting('dv.b1')::uuid,
    format('select count(*) from public.profiles_directory where org_id = %L', current_setting('dv.org_b'))),
  2::bigint, 'in the one-group org, the directory lists both members');

select col_default_is('public', 'organizations', 'directory_visibility', 'shared_groups',
  'organizations.directory_visibility defaults to shared_groups');
select col_not_null('public', 'organizations', 'directory_visibility',
  'organizations.directory_visibility is NOT NULL');
select throws_ok(
  format('update public.organizations set directory_visibility = ''everyone'' where id = %L',
    current_setting('dv.org_a')),
  '23514',
  null,
  'directory_visibility accepts only shared_groups and org');

-- ── 7. Signup enrolment: one group enrols, otherwise nobody ─────────────────

select is(current_setting('dv.enrolled_with_no_groups')::int, 0,
  'a signup into an org with no groups is enrolled nowhere');

do $$
declare
  org_a uuid := current_setting('dv.org_a')::uuid;
  org_b uuid := current_setting('dv.org_b')::uuid;
  b2 uuid := gen_random_uuid();
  a4 uuid := gen_random_uuid();
  invitee uuid := gen_random_uuid();
  fam_b uuid;
  fm_b uuid;
begin
  insert into public.access_requests (org_id, name, email, status) values
    (org_b, 'Member B2', 'b2@directory-visibility.example.test', 'approved'),
    (org_a, 'Member A4', 'a4@directory-visibility.example.test', 'approved');
  insert into auth.users (id, email) values
    (b2, 'b2@directory-visibility.example.test'),
    (a4, 'a4@directory-visibility.example.test');

  -- A family-invite signup: no access request, so handle_new_user() lands
  -- the profile as pending and the claim route promotes it later.
  insert into public.family_units (org_id, family_name) values (org_b, 'Household B') returning id into fam_b;
  insert into public.family_members (org_id, family_id, first_name, relationship)
    values (org_b, fam_b, 'Invitee', 'spouse') returning id into fm_b;
  insert into public.family_invites (org_id, family_member_id, family_id, invite_email)
    values (org_b, fm_b, fam_b, 'invitee@directory-visibility.example.test');
  insert into auth.users (id, email) values (invitee, 'invitee@directory-visibility.example.test');

  perform set_config('dv.b2', b2::text, true);
  perform set_config('dv.a4', a4::text, true);
  perform set_config('dv.invitee', invitee::text, true);
end $$;

select is(
  (select role from public.group_members
    where group_id = current_setting('dv.grp_b')::uuid
      and profile_id = current_setting('dv.b2')::uuid),
  'member', 'a signup into a one-group org is enrolled in that group as a member');
select is(
  (select count(*)::int from public.group_members
    where profile_id = current_setting('dv.a4')::uuid),
  0, 'a signup into a two-group org is enrolled nowhere');
select is(
  (select role from public.profiles where id = current_setting('dv.invitee')::uuid),
  'pending', 'fixture: the family-invite signup landed as pending');
select is(
  (select count(*)::int from public.group_members
    where profile_id = current_setting('dv.invitee')::uuid),
  0, 'a family-invite signup into a one-group org is not enrolled');

-- ── 8. The setting's write path: the org's own admin, this column only ──────

select is(
  pg_temp.as_write(current_setting('dv.owner_a')::uuid,
    format('update public.organizations set directory_visibility = ''org'' where id = %L',
      current_setting('dv.org_a'))),
  'rows=1', 'the org admin updates directory_visibility on their own org');
select is(
  (select directory_visibility from public.organizations where id = current_setting('dv.org_a')::uuid),
  'org', 'the admin''s write is persisted');

update public.organizations set directory_visibility = 'shared_groups'
  where id = current_setting('dv.org_a')::uuid;

select is(
  pg_temp.as_write(current_setting('dv.m1')::uuid,
    format('update public.organizations set directory_visibility = ''org'' where id = %L',
      current_setting('dv.org_a'))),
  'rows=0', 'a plain member''s update affects no row');
select is(
  (select directory_visibility from public.organizations where id = current_setting('dv.org_a')::uuid),
  'shared_groups', 'the member''s write changed nothing');
select is(
  pg_temp.as_write(current_setting('dv.owner_b')::uuid,
    format('update public.organizations set directory_visibility = ''org'' where id = %L',
      current_setting('dv.org_a'))),
  'rows=0', 'another org''s admin updates no row of org A');
select is(
  pg_temp.as_write(current_setting('dv.owner_a')::uuid,
    format('update public.organizations set name = ''x'' where id = %L', current_setting('dv.org_a'))),
  '42501', 'the org admin cannot update organizations.name: a column privilege, not a zero-row filter');
select is(
  pg_temp.as_write(current_setting('dv.m1')::uuid,
    format('update public.organizations set status = ''suspended'' where id = %L', current_setting('dv.org_a'))),
  '42501', 'a member cannot update organizations.status');

-- ── 9. Grants ───────────────────────────────────────────────────────────────

select ok(has_function_privilege('authenticated', 'public.org_directory_visible()', 'execute'),
  'authenticated can execute org_directory_visible()');
select ok(has_function_privilege('authenticated', 'public.shares_group_with(uuid)', 'execute'),
  'authenticated can execute shares_group_with()');
select ok(has_function_privilege('authenticated', 'public.shares_group_with_household(uuid)', 'execute'),
  'authenticated can execute shares_group_with_household()');
select ok(not has_function_privilege('anon', 'public.org_directory_visible()', 'execute'),
  'anon cannot execute org_directory_visible()');
select ok(not has_function_privilege('anon', 'public.shares_group_with(uuid)', 'execute'),
  'anon cannot execute shares_group_with()');
select ok(not has_function_privilege('anon', 'public.shares_group_with_household(uuid)', 'execute'),
  'anon cannot execute shares_group_with_household()');
select ok(has_column_privilege('authenticated', 'public.organizations', 'directory_visibility', 'select'),
  'authenticated may read organizations.directory_visibility');
select ok(not has_column_privilege('anon', 'public.organizations', 'directory_visibility', 'select'),
  'anon may not read organizations.directory_visibility');
select ok(has_column_privilege('authenticated', 'public.organizations', 'directory_visibility', 'update'),
  'authenticated may update organizations.directory_visibility (RLS narrows it to the org admin)');
select ok(not has_table_privilege('authenticated', 'public.organizations', 'update'),
  'authenticated holds no table-level UPDATE on organizations');

-- ── 10. Helper truth table ──────────────────────────────────────────────────

select is(
  pg_temp.as_text(current_setting('dv.m1')::uuid,
    format('select public.shares_group_with(%L)::text', current_setting('dv.m2'))),
  'true', 'shares_group_with(m2) is true for m1');
select is(
  pg_temp.as_text(current_setting('dv.m1')::uuid,
    format('select public.shares_group_with(%L)::text', current_setting('dv.m3'))),
  'false', 'shares_group_with(m3) is false for m1');
select is(
  pg_temp.as_text(current_setting('dv.m1')::uuid,
    format('select public.shares_group_with(%L)::text', current_setting('dv.b1'))),
  'false', 'shares_group_with() is false for a profile in another org');
select is(
  pg_temp.as_text(current_setting('dv.m1')::uuid,
    format('select public.shares_group_with_household(%L)::text', current_setting('dv.fam2'))),
  'true', 'shares_group_with_household(m2''s household) is true for m1');
select is(
  pg_temp.as_text(current_setting('dv.m1')::uuid,
    format('select public.shares_group_with_household(%L)::text', current_setting('dv.fam3'))),
  'false', 'shares_group_with_household(m3''s household) is false for m1');
select is(
  pg_temp.as_text(current_setting('dv.m1')::uuid, 'select public.org_directory_visible()::text'),
  'false', 'org_directory_visible() is false under the default');

update public.organizations set directory_visibility = 'org'
  where id = current_setting('dv.org_a')::uuid;
select is(
  pg_temp.as_text(current_setting('dv.m1')::uuid, 'select public.org_directory_visible()::text'),
  'true', 'org_directory_visible() is true once the org opens its directory');
select is(
  pg_temp.as_text(current_setting('dv.b1')::uuid, 'select public.org_directory_visible()::text'),
  'false', 'org_directory_visible() reads the caller''s own org, not another org''s setting');

-- ── 11. Pending accounts and unlisted profiles stay outside every arm but their own ──
-- A family-invite claim links a still-pending account to its household, so
-- the own-household arms must not open the household tables to it.

do $$
declare
  org_a uuid := current_setting('dv.org_a')::uuid;
  fam1 uuid := (select family_id from public.profiles where id = current_setting('dv.m1')::uuid);
  pending_a uuid := gen_random_uuid();
  fm uuid;
begin
  insert into public.family_members (org_id, family_id, first_name, relationship)
    values (org_a, fam1, 'Spouse', 'spouse') returning id into fm;
  insert into public.family_invites (org_id, family_member_id, family_id, invite_email)
    values (org_a, fm, fam1, 'pending-a@directory-visibility.example.test');
  insert into auth.users (id, email) values (pending_a, 'pending-a@directory-visibility.example.test');
  -- What the claim route does, and what a leader could do later.
  update public.profiles set family_id = fam1 where id = pending_a;
  insert into public.group_members (org_id, group_id, profile_id, role)
    values (org_a, current_setting('dv.grp_1')::uuid, pending_a, 'member');

  update public.profiles set is_unlisted = true where id = current_setting('dv.m2')::uuid;

  perform set_config('dv.pending_a', pending_a::text, true);
  perform set_config('dv.fam1', fam1::text, true);
end $$;

select is(
  (select role from public.profiles where id = current_setting('dv.pending_a')::uuid),
  'pending', 'fixture: the family-invite signup into org A landed as pending');
select is(
  pg_temp.as_count(current_setting('dv.pending_a')::uuid,
    format('select count(*) from public.family_units where id = %L', current_setting('dv.fam1'))),
  0::bigint, 'a pending account linked to a household reads no family_units row for it');
select is(
  pg_temp.as_count(current_setting('dv.pending_a')::uuid,
    format('select count(*) from public.family_members where family_id = %L', current_setting('dv.fam1'))),
  0::bigint, 'a pending account linked to a household reads no family_members row for it');
select is(
  pg_temp.as_count(current_setting('dv.pending_a')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.m1'))),
  0::bigint, 'a pending account reads no profile of a household or group mate');
select is(
  pg_temp.as_count(current_setting('dv.pending_a')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.pending_a'))),
  1::bigint, 'positive control: a pending account reads its own profile');
select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.family_units where id = %L', current_setting('dv.fam1'))),
  1::bigint, 'positive control: an approved member reads their own household');
select is(
  pg_temp.as_count(current_setting('dv.m2')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.pending_a'))),
  0::bigint, 'a pending account in a shared group is still outside the directory arm');

select is(
  pg_temp.as_count(current_setting('dv.m1')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.m2'))),
  0::bigint, 'an unlisted profile is hidden from a group mate');
select is(
  pg_temp.as_count(current_setting('dv.m2')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.m2'))),
  1::bigint, 'positive control: an unlisted member reads their own profile');
select is(
  pg_temp.as_count(current_setting('dv.owner_a')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('dv.m2'))),
  1::bigint, 'the org admin reads an unlisted profile');

select * from finish();
rollback;
