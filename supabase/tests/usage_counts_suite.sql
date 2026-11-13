-- Usage counts: the table holds nothing about a person, only the signed-in
-- person's own church is ever written, only a known route pattern is stored,
-- church admins read their own church and members read nothing, the nightly
-- prune removes only rows older than its cutoff, and the counts go with the
-- church.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/usage_counts_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.new_person(_org uuid, _email text, _role text) returns uuid
  language plpgsql as $$
declare _id uuid := gen_random_uuid();
begin
  insert into public.access_requests (org_id, name, email, status, approved_role, reviewed_at)
    values (_org, _email, _email, 'approved', 'member', now());
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', _email,
            'x', jsonb_build_object('org_id', _org), '{}', now(), now());
  update public.profiles set role = _role where id = _id;
  return _id;
end $$;

-- The first value of a query run as a signed-in person (or anon when _id is
-- null), as text, or the SQLSTATE.
create function pg_temp.as_person(_id uuid, _sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.headers', '{}', true);
  if _id is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', _id, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  begin
    execute _sql into r;
  exception when others then
    r := sqlstate;
  end;
  set local role none;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;

create function pg_temp.record(_id uuid, _pattern text, _kind text) returns text
  language sql as $$
  select pg_temp.as_person(_id,
    format('select public.usage_count_record(%L, %L)::text', _pattern, _kind));
$$;

create temp table fx (key text primary key, id uuid) on commit drop;
grant select on fx to authenticated, anon, service_role;

create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;

create function pg_temp.rows_of(_org uuid) returns bigint language sql stable as $$
  select count(*) from public.usage_counts where org_id = _org;
$$;

do $$
declare
  _a uuid := gen_random_uuid();
  _b uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name) values (_a, 'Usage Church A'), (_b, 'Usage Church B');
  insert into fx values ('org_a', _a), ('org_b', _b);
end $$;

insert into fx values
  ('admin_a', pg_temp.new_person(pg_temp.fx('org_a'), 'admin-a@usage.test', 'admin')),
  ('member_a', pg_temp.new_person(pg_temp.fx('org_a'), 'member-a@usage.test', 'member')),
  ('admin_b', pg_temp.new_person(pg_temp.fx('org_b'), 'admin-b@usage.test', 'admin'));

-- ── The table holds nothing about a person ──────────────────────────────────
select columns_are('public', 'usage_counts',
  array['org_id', 'usage_date', 'kind', 'pattern', 'total'],
  'usage_counts has only the church, the day, the kind, the pattern and the total');
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'usage_counts'
      and column_name ~ '(profile|user|person|email|name|ip|device|agent|token|created_by|session)'),
  0::bigint, 'no column of usage_counts names a person, an address, a device or a token');
select is(
  (select count(*) from pg_constraint c
    where c.conrelid = 'public.usage_counts'::regclass and c.contype = 'f'
      and c.confrelid <> 'public.organizations'::regclass),
  0::bigint, 'the only foreign key of usage_counts is to the church');

-- ── Who can reach what ──────────────────────────────────────────────────────
select ok(not has_table_privilege('anon', 'public.usage_counts', 'select, insert, update, delete'),
  'anon has no privilege on usage_counts');
select ok(has_table_privilege('authenticated', 'public.usage_counts', 'select'),
  'authenticated can select usage_counts, bounded by RLS');
select ok(not has_table_privilege('authenticated', 'public.usage_counts', 'insert, update, delete'),
  'authenticated cannot write usage_counts directly');

select is(
  array(select p.proname::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('usage_page_patterns', 'usage_count_record', 'usage_count_totals', 'usage_counts_prune')
      and has_function_privilege('anon', p.oid, 'execute')
    order by 1),
  array[]::text[], 'anon can execute none of the usage functions');
select is(
  array(select p.proname::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('usage_page_patterns', 'usage_count_record', 'usage_count_totals', 'usage_counts_prune')
      and has_function_privilege('authenticated', p.oid, 'execute')
    order by 1),
  array['usage_count_record', 'usage_count_totals'],
  'authenticated can execute only the recorder and the totals');
select ok(has_function_privilege('service_role', 'public.usage_counts_prune(uuid, date, integer)', 'execute'),
  'the service role can prune');
select ok((select p.prosecdef from pg_proc p where p.oid = 'public.usage_count_record(text, text)'::regprocedure),
  'usage_count_record is SECURITY DEFINER');
select is((select p.proconfig from pg_proc p where p.oid = 'public.usage_count_record(text, text)'::regprocedure),
  array['search_path=""'], 'usage_count_record pins an empty search_path');
select ok(not (select p.prosecdef from pg_proc p where p.oid = 'public.usage_count_totals(uuid, integer)'::regprocedure),
  'usage_count_totals runs as the caller, so RLS applies');

-- ── Recording ───────────────────────────────────────────────────────────────
select is(pg_temp.record(pg_temp.fx('member_a'), '/g/[groupId]/calendar', 'view'), 'true',
  'a member records a view of a known pattern');
select is(pg_temp.record(pg_temp.fx('member_a'), '/g/[groupId]/calendar', 'view'), 'true',
  'a second view of the same pattern is recorded');
select is(pg_temp.record(pg_temp.fx('member_a'), '/g/[groupId]/calendar', 'error'), 'true',
  'an error state is recorded');
select is(pg_temp.rows_of(pg_temp.fx('org_a')), 2::bigint,
  'church A holds one row per kind for the pattern');
select is(
  (select total from public.usage_counts
    where org_id = pg_temp.fx('org_a') and kind = 'view' and pattern = '/g/[groupId]/calendar'
      and usage_date = (now() at time zone 'utc')::date),
  2, 'two views of one pattern on one day are one row with a total of 2');

select is(pg_temp.record(pg_temp.fx('member_a'), '/g/c0000000-0000-0000-0000-00000000000b/calendar', 'view'),
  'false', 'a real group address is refused');
select is(pg_temp.record(pg_temp.fx('member_a'), '/join/Zk3-secret-invite-token', 'view'), 'false',
  'an invite address is refused');
select is(pg_temp.record(pg_temp.fx('member_a'), 'anything a browser sends', 'view'), 'false',
  'arbitrary text is refused');
select is(pg_temp.record(pg_temp.fx('member_a'), null, 'view'), 'false', 'a null pattern is refused');
select is(pg_temp.record(pg_temp.fx('member_a'), '/dashboard', 'click'), 'false', 'an unknown kind is refused');
select is(pg_temp.record(pg_temp.fx('member_a'), '/dashboard', null), 'false', 'a null kind is refused');
select is(pg_temp.rows_of(pg_temp.fx('org_a')), 2::bigint, 'a refused call stores nothing');
select is(
  (select count(*) from public.usage_counts
    where pattern ~ '[0-9a-f]{8}-' or pattern ~ 'secret'),
  0::bigint, 'no stored pattern holds an id or a token');

select is(pg_temp.record(null, '/dashboard', 'view'), '42501', 'anon cannot call the recorder');
select is(
  pg_temp.as_person(gen_random_uuid(), $$select public.usage_count_record('/dashboard', 'view')::text$$),
  'false', 'a signed-in principal with no church records nothing');
select is(
  pg_temp.as_person(pg_temp.fx('member_a'),
    $$insert into public.usage_counts (org_id, usage_date, kind, pattern, total)
      values ((select id from fx where key = 'org_a'), current_date, 'view', '/dashboard', 1000)
      returning 'inserted'$$),
  '42501', 'a member cannot write a count directly');

select is(pg_temp.record(pg_temp.fx('admin_b'), '/dashboard', 'view'), 'true',
  'a church B admin records a view');
select is(
  (select count(*) from public.usage_counts where pattern = '/dashboard' and org_id = pg_temp.fx('org_b')),
  1::bigint, 'the church B view lands in church B');
select is(
  (select count(*) from public.usage_counts where pattern = '/dashboard' and org_id = pg_temp.fx('org_a')),
  0::bigint, 'and not in church A');

-- ── Reading ─────────────────────────────────────────────────────────────────
select is(pg_temp.as_person(pg_temp.fx('admin_a'), 'select count(*)::text from public.usage_counts'),
  '2', 'a church A admin sees exactly church A''s rows');
select is(pg_temp.as_person(pg_temp.fx('member_a'), 'select count(*)::text from public.usage_counts'),
  '0', 'a member sees no rows');
select is(pg_temp.as_person(null, 'select count(*)::text from public.usage_counts'),
  '42501', 'anon cannot read the table');
select is(pg_temp.as_person(pg_temp.fx('admin_b'), 'select count(*)::text from public.usage_counts'),
  '1', 'a church B admin sees exactly church B''s row');
select is(
  pg_temp.as_person(pg_temp.fx('admin_a'),
    $$select count(*)::text from public.usage_counts where org_id = (select id from fx where key = 'org_b')$$),
  '0', 'a church A admin filtering on church B gets no rows');
select is(
  pg_temp.as_person(pg_temp.fx('admin_a'),
    $$select count(*)::text from public.usage_count_totals((select id from fx where key = 'org_a'), 30)$$),
  '2', 'a church A admin gets church A''s totals');
select is(
  pg_temp.as_person(pg_temp.fx('admin_a'),
    $$select count(*)::text from public.usage_count_totals((select id from fx where key = 'org_b'), 30)$$),
  '0', 'a church A admin asking for church B''s totals gets no rows');
select is(
  pg_temp.as_person(pg_temp.fx('member_a'),
    $$select count(*)::text from public.usage_count_totals((select id from fx where key = 'org_a'), 30)$$),
  '0', 'a member gets no totals');
select is(
  pg_temp.as_person(pg_temp.fx('admin_a'),
    $$select total::text from public.usage_count_totals((select id from fx where key = 'org_a'), 7)
      where kind = 'view' and pattern = '/g/[groupId]/calendar'$$),
  '2', 'the totals add a pattern''s views');

-- ── The window and the prune ────────────────────────────────────────────────
insert into public.usage_counts (org_id, usage_date, kind, pattern, total) values
  (pg_temp.fx('org_a'), current_date - interval '13 months' - interval '2 days', 'view', '/directory', 3),
  (pg_temp.fx('org_a'), current_date - interval '13 months' - interval '1 day', 'view', '/directory', 4),
  (pg_temp.fx('org_a'), current_date - interval '13 months' - interval '1 day', 'error', '/directory', 1),
  (pg_temp.fx('org_a'), current_date - interval '13 months', 'view', '/directory', 5),
  (pg_temp.fx('org_a'), current_date - 10, 'view', '/directory', 6),
  (pg_temp.fx('org_b'), current_date - interval '13 months' - interval '1 day', 'view', '/directory', 7);

select is(
  pg_temp.as_person(pg_temp.fx('admin_a'),
    $$select total::text from public.usage_count_totals((select id from fx where key = 'org_a'), 7)
      where kind = 'view' and pattern = '/directory'$$),
  null, 'a count from ten days ago is outside a 7-day window');
select is(
  pg_temp.as_person(pg_temp.fx('admin_a'),
    $$select total::text from public.usage_count_totals((select id from fx where key = 'org_a'), 30)
      where kind = 'view' and pattern = '/directory'$$),
  '6', 'and inside a 30-day window');

set local role service_role;
select is(public.usage_counts_prune(pg_temp.fx('org_a'), (current_date - interval '13 months')::date, 2), 2,
  'a prune deletes at most its limit');
select is(public.usage_counts_prune(pg_temp.fx('org_a'), (current_date - interval '13 months')::date, 500), 1,
  'the next call deletes the rest of the old rows');
select is(public.usage_counts_prune(pg_temp.fx('org_a'), (current_date - interval '13 months')::date, 500), 0,
  'and then nothing');
set local role none;

select is(
  (select count(*) from public.usage_counts
    where org_id = pg_temp.fx('org_a') and usage_date < (current_date - interval '13 months')::date),
  0::bigint, 'church A keeps no row older than 13 months');
select is(
  (select count(*) from public.usage_counts
    where org_id = pg_temp.fx('org_a') and usage_date = (current_date - interval '13 months')::date),
  1::bigint, 'a row on the cutoff stays');
select is(pg_temp.rows_of(pg_temp.fx('org_a')), 4::bigint,
  'church A keeps its recent rows and the one on the cutoff');
select is(pg_temp.rows_of(pg_temp.fx('org_b')), 2::bigint,
  'church B''s old row is untouched by church A''s prune');

-- ── The counts go with the church ───────────────────────────────────────────
delete from public.organizations where id = pg_temp.fx('org_a');
select is(pg_temp.rows_of(pg_temp.fx('org_a')), 0::bigint, 'removing a church removes its counts');
select is(pg_temp.rows_of(pg_temp.fx('org_b')), 2::bigint, 'and leaves another church''s');

select * from finish();
rollback;
