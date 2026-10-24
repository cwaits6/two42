-- Platform org lifecycle suite (CWA-11 Phase 4a: #317, #318, approved_role).
--
-- Pins the org_status enum (#317), the narrowed anon column grant on
-- organizations (#318), and the founding-admin handoff: provision_organization()
-- stamps access_requests.approved_role = 'admin' on the owner row,
-- handle_new_user() honors it at signup, and the anon-reachable INSERT policy
-- pins the column to NULL so no visitor can self-request admin.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/platform_org_lifecycle_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── #317: org_status is a real enum ─────────────────────────────────────────

select has_type('public', 'org_status', 'org_status enum exists');
select enum_has_labels('public', 'org_status', array['active', 'suspended'],
  'org_status carries exactly active and suspended');
select col_type_is('public', 'organizations', 'status', 'org_status',
  'organizations.status is typed org_status');

-- Negative probe: a value outside the enum is a type error, not a CHECK
-- violation to forget about.
select throws_ok(
  $$ update public.organizations set status = 'paused' $$,
  '22P02', null,
  'a status outside the enum is rejected');

-- ── #318: anon column grant narrowed to (id, slug, branding) ────────────────

select ok(
  not has_column_privilege('anon', 'public.organizations', 'name', 'select'),
  'anon may not read organizations.name');
select ok(
  has_column_privilege('anon', 'public.organizations', 'id', 'select'),
  'anon may read organizations.id');
select ok(
  has_column_privilege('anon', 'public.organizations', 'slug', 'select'),
  'anon may read organizations.slug');
select ok(
  has_column_privilege('anon', 'public.organizations', 'branding', 'select'),
  'anon may read organizations.branding');
-- The narrowing was surgical: authenticated keeps name.
select ok(
  has_column_privilege('authenticated', 'public.organizations', 'name', 'select'),
  'authenticated still reads organizations.name');

-- ── Anonymous requests resolve no org, header or not ────────────────────────

set local role anon;
select set_config('request.headers', json_build_object('x-two42-org', 'default')::text, true);
select is(
  (select count(*) from public.organizations where branding is not null),
  0::bigint,
  'anon reads no organizations row even with an x-two42-org header');
select is(
  (select public.app_request_org_id()),
  null::uuid,
  'app_request_org_id() is NULL for anon whatever the header says');
reset role;
select set_config('request.headers', '{}', true);

-- ── approved_role: column shape ─────────────────────────────────────────────

select has_column('public', 'access_requests', 'approved_role',
  'access_requests.approved_role exists');
select col_is_null('public', 'access_requests', 'approved_role',
  'approved_role is nullable — NULL keeps today''s member behavior');
select throws_ok(
  $$ insert into public.access_requests (org_id, name, email, status, approved_role)
     values ('00000000-0000-0000-0000-000000000001', 'Bad Role', 'bad-role@lifecycle.example.test', 'pending', 'owner') $$,
  '23514', null,
  'approved_role rejects values outside (member, admin)');

-- ── approved_role: no anonymous INSERT can reach it ─────────────────────────
-- access_requests has no INSERT policy for any client role since the slug
-- join form went away, so a visitor cannot self-request at all, let alone
-- as an admin.

do $$
declare
  admin_attempt_err text := 'no error';
  plain_attempt_err text := 'no error';
begin
  set local role anon;
  perform set_config('request.headers', json_build_object('x-two42-org', 'default')::text, true);
  begin
    insert into public.access_requests (org_id, name, email, status, approved_role)
    values ('00000000-0000-0000-0000-000000000001', 'Escalator', 'escalator@lifecycle.example.test', 'pending', 'admin');
  exception when others then
    admin_attempt_err := sqlstate;
  end;
  begin
    insert into public.access_requests (org_id, name, email, status)
    values ('00000000-0000-0000-0000-000000000001', 'Honest Visitor', 'honest@lifecycle.example.test', 'pending');
  exception when others then
    plain_attempt_err := sqlstate;
  end;
  reset role;
  perform set_config('request.headers', '{}', true);
  perform set_config('lifecycle.admin_attempt_err', admin_attempt_err, true);
  perform set_config('lifecycle.plain_attempt_err', plain_attempt_err, true);
end $$;

select is(current_setting('lifecycle.admin_attempt_err'), '42501',
  'anon INSERT with approved_role = admin is rejected (RLS 42501)');
select is(current_setting('lifecycle.plain_attempt_err'), '42501',
  'anon INSERT without approved_role is rejected too: no public write path remains (RLS 42501)');

-- ── provision_organization() stamps the founding admin ──────────────────────

do $$
declare
  _org_id uuid;
begin
  _org_id := public.provision_organization(
    'Lifecycle Suite Org', 'owner@lifecycle.example.test'
  );
  perform set_config('lifecycle.org_id', _org_id::text, true);
end $$;

select is(
  (select approved_role from public.access_requests
    where org_id = current_setting('lifecycle.org_id')::uuid
      and email = 'owner@lifecycle.example.test'),
  'admin',
  'provisioning seeds the owner''s access request with approved_role = admin');
select is(
  (select status from public.access_requests
    where org_id = current_setting('lifecycle.org_id')::uuid
      and email = 'owner@lifecycle.example.test'),
  'approved',
  'the owner''s seeded access request is approved');
select is(
  (select status from public.organizations
    where id = current_setting('lifecycle.org_id')::uuid),
  'active'::public.org_status,
  'a provisioned org starts active (as the enum)');

-- ── handle_new_user() honors approved_role ──────────────────────────────────

-- The founding owner signs up → admin in the new org.
do $$
declare
  u uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (u, 'owner@lifecycle.example.test');
  perform set_config('lifecycle.owner_user', u::text, true);
end $$;

select is(
  (select role from public.profiles where id = current_setting('lifecycle.owner_user')::uuid),
  'admin',
  'the founding owner signs up as role = admin');
select is(
  (select org_id from public.profiles where id = current_setting('lifecycle.owner_user')::uuid),
  current_setting('lifecycle.org_id')::uuid,
  'the founding owner lands in the provisioned org');

-- An approved request with approved_role NULL keeps today's behavior.
do $$
declare
  u uuid := gen_random_uuid();
begin
  insert into public.access_requests (org_id, name, email, status)
  values (current_setting('lifecycle.org_id')::uuid, 'Plain Member', 'plain-member@lifecycle.example.test', 'approved');
  insert into auth.users (id, email) values (u, 'plain-member@lifecycle.example.test');
  perform set_config('lifecycle.member_user', u::text, true);
end $$;

select is(
  (select role from public.profiles where id = current_setting('lifecycle.member_user')::uuid),
  'member',
  'an approved request with approved_role NULL still signs up as member');

-- ── is_platform_admin() both ways ───────────────────────────────────────────

do $$
declare
  owner_user uuid := current_setting('lifecycle.owner_user')::uuid;
  before_grant boolean;
  after_grant boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_user)::text, true);
  before_grant := public.is_platform_admin();
  reset role;

  insert into public.platform_admins (profile_id) values (owner_user);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_user)::text, true);
  after_grant := public.is_platform_admin();
  reset role;

  perform set_config('lifecycle.before_grant', before_grant::text, true);
  perform set_config('lifecycle.after_grant', after_grant::text, true);
end $$;

select is(current_setting('lifecycle.before_grant'), 'false',
  'is_platform_admin() is false for a plain authenticated principal');
select is(current_setting('lifecycle.after_grant'), 'true',
  'is_platform_admin() is true once the principal is in platform_admins');

select * from finish();
rollback;
