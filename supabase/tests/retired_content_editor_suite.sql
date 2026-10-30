-- The content_editor role is retired: no catalog object names it, the
-- role check refuses it, and a former content editor (now a member) passes
-- the member check and fails the admin check.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/retired_content_editor_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create function pg_temp.as_bool(_actor uuid, _query text) returns boolean
  language plpgsql as $$
declare _result boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  set local role authenticated;
  execute _query into _result;
  reset role;
  return _result;
end $$;

do $$
declare
  org uuid;
  former uuid := gen_random_uuid();
  owner uuid := gen_random_uuid();
begin
  org := public.provision_organization('Retired Role Org', 'owner@retired-role.example.test');
  insert into public.access_requests (org_id, name, email, status)
    values (org, 'Former Editor', 'former@retired-role.example.test', 'approved');
  insert into auth.users (id, email) values
    (owner, 'owner@retired-role.example.test'),
    (former, 'former@retired-role.example.test');
  perform set_config('retired.former', former::text, true);
end $$;

select is(
  (select count(*)::int from pg_catalog.pg_policies
    where coalesce(qual, '') ~ 'content_editor' or coalesce(with_check, '') ~ 'content_editor'),
  0, 'no policy names content_editor');

select is(
  (select count(*)::int from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and (p.prosrc ~ 'content_editor' or p.proname ~ 'content_editor')),
  0, 'no function names content_editor');

select is(
  (select count(*)::int from pg_catalog.pg_views
    where schemaname not in ('pg_catalog', 'information_schema')
      and definition ~ 'content_editor'),
  0, 'no view names content_editor');

select throws_ok(
  format($$ update public.profiles set role = 'content_editor' where id = %L $$,
         current_setting('retired.former')),
  '23514', null, 'the role check refuses content_editor');

select is(
  (select role from public.profiles where id = current_setting('retired.former')::uuid),
  'member', 'fixture: the former content editor is a member');

select is(
  pg_temp.as_bool(current_setting('retired.former')::uuid, 'select public.is_member()'),
  true, 'a former content editor passes the member check');

select is(
  pg_temp.as_bool(current_setting('retired.former')::uuid, 'select public.is_admin()'),
  false, 'a former content editor cannot pass the admin check');

select * from finish();
rollback;
