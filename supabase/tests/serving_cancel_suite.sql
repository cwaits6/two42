-- Serving cancel suite: who can remove a date from the schedule.
--
-- A denied delete succeeds with 0 rows, so every case asserts the row count of
-- the statement the route issues. Henry tapped Sign up for himself and Chloe,
-- his spouse, on a team in Group B; Leo leads the team, Isaac is on it without
-- being listed, Zoe leads the group, Caleb is in the group but not on the team.
-- The other org's owner is provisioned here because the seed has one org.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/serving_cancel_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.uid(_email text) returns uuid language sql stable as $$
  select id from public.profiles where email = _email;
$$;

create function pg_temp.enter(_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.uid(_email), 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- rows:<n> on success, the SQLSTATE on failure, so a policy that recurses
-- reports 42P17 on its own line instead of aborting the transaction.
create function pg_temp.attempt(_email text, _sql text) returns text language plpgsql as $$
declare n bigint; r text;
begin
  perform pg_temp.enter(_email);
  begin
    execute _sql;
    get diagnostics n = row_count;
    r := 'rows:' || n;
  exception when others then
    r := sqlstate;
  end;
  set local role none;
  return r;
end $$;

create function pg_temp.val(_email text, _sql text) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.enter(_email);
  begin
    execute _sql into r;
    r := coalesce(r, '<null>');
  exception when others then
    r := sqlstate;
  end;
  set local role none;
  return r;
end $$;

create function pg_temp.signup(_key text) returns uuid language sql immutable as $$
  select ('aaaa0000-0000-0000-0000-0000000000' || _key)::uuid;
$$;

-- The same statement the signups route issues: `.delete().eq("id", …).select()`.
create function pg_temp.cancel_sql(_key text) returns text language sql immutable as $$
  select format('delete from public.serving_signups where id = %L returning id', pg_temp.signup(_key));
$$;

create function pg_temp.signup_exists(_key text) returns boolean language sql stable as $$
  select exists (select 1 from public.serving_signups where id = pg_temp.signup(_key));
$$;

create function pg_temp.attendee_count(_key text) returns int language sql stable as $$
  select count(*)::int from public.serving_signup_attendees where signup_id = pg_temp.signup(_key);
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
select is(
  (select array_agg(p.email || '/' || gm.role order by p.email)
     from public.group_members gm join public.profiles p on p.id = gm.profile_id
    where gm.group_id = 'c0000000-0000-0000-0000-00000000000b'
      and p.email in ('caleb.dummyfield@example.test', 'chloe.mockingham@example.test',
                      'henry.mockingham@example.test', 'isaac.seedly@example.test',
                      'leo.loremsworth@example.test', 'zoe.dummyfield@example.test')),
  array['caleb.dummyfield@example.test/member', 'chloe.mockingham@example.test/member',
        'henry.mockingham@example.test/member', 'isaac.seedly@example.test/member',
        'leo.loremsworth@example.test/member', 'zoe.dummyfield@example.test/leader'],
  'non-vacuity: the seeded people are in Group B with these roles');
select is(
  (select array_agg(relationship order by relationship) from public.profiles
    where family_id = (select family_id from public.profiles where email = 'henry.mockingham@example.test')
      and email in ('henry.mockingham@example.test', 'chloe.mockingham@example.test')),
  array['primary', 'spouse'],
  'non-vacuity: Henry and Chloe are one household''s primary and spouse');

insert into public.teams (id, org_id, group_id, name)
select 'aaaa0000-0000-0000-0000-000000000001', g.org_id, g.id, 'Cancel suite team'
  from public.groups g where g.id = 'c0000000-0000-0000-0000-00000000000b';

insert into public.team_members (org_id, team_id, profile_id, is_leader)
select p.org_id, 'aaaa0000-0000-0000-0000-000000000001', p.id, p.email = 'leo.loremsworth@example.test'
  from public.profiles p
 where p.email in ('henry.mockingham@example.test', 'chloe.mockingham@example.test',
                   'isaac.seedly@example.test', 'leo.loremsworth@example.test');

-- One signup per case, each Henry's for himself and Chloe unless named below;
-- ab is Isaac's alone, so Chloe is listed on the others but not on it.
insert into public.serving_signups (id, org_id, team_id, service_date, family_id, created_by)
select pg_temp.signup(c.key), p.org_id, 'aaaa0000-0000-0000-0000-000000000001',
       date '2030-01-06' + (c.n * 7), p.family_id, p.id
  from (values
    (0, 'a1', 'henry.mockingham@example.test'),
    (1, 'b1', 'henry.mockingham@example.test'),
    (2, 'c1', 'henry.mockingham@example.test'),
    (3, 'd1', 'henry.mockingham@example.test'),
    (4, 'e1', 'henry.mockingham@example.test'),
    (5, 'f1', 'henry.mockingham@example.test'),
    (6, 'ab', 'isaac.seedly@example.test')
  ) as c(n, key, email)
  join public.profiles p on p.email = c.email;

insert into public.serving_signup_attendees (org_id, signup_id, profile_id)
select p.org_id, pg_temp.signup(a.key), p.id
  from (values
    ('a1', 'henry.mockingham@example.test'), ('a1', 'chloe.mockingham@example.test'),
    ('b1', 'henry.mockingham@example.test'), ('b1', 'chloe.mockingham@example.test'),
    ('c1', 'henry.mockingham@example.test'), ('c1', 'chloe.mockingham@example.test'),
    ('d1', 'henry.mockingham@example.test'), ('d1', 'chloe.mockingham@example.test'),
    ('e1', 'henry.mockingham@example.test'), ('e1', 'chloe.mockingham@example.test'),
    ('f1', 'henry.mockingham@example.test'), ('f1', 'chloe.mockingham@example.test'),
    ('ab', 'isaac.seedly@example.test')
  ) as a(key, email)
  join public.profiles p on p.email = a.email;

do $$
begin
  perform public.provision_organization('Cancel suite other org', 'owner@cancel-suite.example.test');
  insert into auth.users (id, email)
    values (gen_random_uuid(), 'owner@cancel-suite.example.test');
end $$;

select isnt(
  (select org_id from public.profiles where email = 'owner@cancel-suite.example.test'),
  (select org_id from public.profiles where email = 'henry.mockingham@example.test'),
  'non-vacuity: the other org''s owner resolves into a different org');

-- ── Denied, with the date left whole ────────────────────────────────────────
select is(pg_temp.attempt('isaac.seedly@example.test', pg_temp.cancel_sql('e1')), 'rows:0',
  'a team member not listed on the date removes 0 rows');
select is(pg_temp.attempt('caleb.dummyfield@example.test', pg_temp.cancel_sql('e1')), 'rows:0',
  'a group member who is not on the team removes 0 rows');
select is(pg_temp.attempt('owner@cancel-suite.example.test', pg_temp.cancel_sql('e1')), 'rows:0',
  'someone in another org removes 0 rows');
select is(pg_temp.attempt('chloe.mockingham@example.test', pg_temp.cancel_sql('ab')), 'rows:0',
  'being listed on other dates does not reach this one');
select ok(pg_temp.signup_exists('e1') and pg_temp.signup_exists('ab'),
  'the denied dates are still on the schedule');
select is(pg_temp.attendee_count('e1'), 2, 'the denied date still lists both people');

-- ── Allowed, and everyone on the date goes with it ──────────────────────────
select is(pg_temp.attempt('chloe.mockingham@example.test', pg_temp.cancel_sql('a1')), 'rows:1',
  'the spouse listed on the date, who did not create it, removes 1 row');
select ok(not pg_temp.signup_exists('a1'), 'the spouse''s cancel opens the date');
select is(pg_temp.attendee_count('a1'), 0,
  'the attendee rows go with the signup through the foreign key for the spouse');

select is(pg_temp.attempt('henry.mockingham@example.test', pg_temp.cancel_sql('b1')), 'rows:1',
  'the person who tapped Sign up removes 1 row');
select is(pg_temp.attempt('leo.loremsworth@example.test', pg_temp.cancel_sql('c1')), 'rows:1',
  'the team lead removes 1 row');
select is(pg_temp.attempt('zoe.dummyfield@example.test', pg_temp.cancel_sql('d1')), 'rows:1',
  'the group leader removes 1 row');
select ok(not (pg_temp.signup_exists('b1') or pg_temp.signup_exists('c1') or pg_temp.signup_exists('d1')),
  'each of those cancels opened its date');

do $$
declare n bigint;
begin
  set local role service_role;
  delete from public.serving_signups where id = pg_temp.signup('f1');
  get diagnostics n = row_count;
  set local role none;
  perform set_config('cancel.service_rows', n::text, true);
end $$;
select is(current_setting('cancel.service_rows'), '1',
  'the service-role delete behind an emailed cancel link removes 1 row');

-- ── Who is serving stays as it was ──────────────────────────────────────────
select is(
  pg_temp.attempt('chloe.mockingham@example.test', format(
    'delete from public.serving_signup_attendees where signup_id = %L and profile_id = %L returning signup_id',
    pg_temp.signup('e1'), pg_temp.uid('chloe.mockingham@example.test'))),
  'rows:0',
  'a listed spouse who did not create the date cannot take a name off it');
select is(pg_temp.attendee_count('e1'), 2, 'the date still lists both people');

-- ── Recursion ───────────────────────────────────────────────────────────────
-- Postgres raises 42P17 when policy expansion revisits a relation, whichever
-- command the second policy is for, and the attendee select policy reads
-- serving_signups. The delete policy has to stay out of that chain.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'serving_signups' and cmd = 'DELETE'
      and qual like '%serving_signup_attendees%'),
  0, 'the delete policy reaches the attendee table only through its definer helper');
select is(
  pg_temp.val('chloe.mockingham@example.test', format(
    'select count(*)::text from public.serving_signups s
       join public.serving_signup_attendees a on a.signup_id = s.id where s.id = %L',
    pg_temp.signup('e1'))),
  '2', 'the schedule read of a signup and its attendees does not recurse');

-- ── Policy shape ────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'serving_signups'
      and policyname = 'org isolation' and permissive = 'RESTRICTIVE'),
  1, 'the attendee arm composes under the restrictive isolation policy');
select ok(
  (select bool_and(qual like '%( SELECT app_request_org_id() AS app_request_org_id)%'
               and qual like '%( SELECT auth.uid() AS uid)%'
               and qual like '%is_serving_signup_attendee(id)%')
     from pg_policies
    where schemaname = 'public' and tablename = 'serving_signups' and cmd = 'DELETE'),
  'the delete policy wraps its zero-argument helpers and carries the attendee arm');

-- ── The helper ──────────────────────────────────────────────────────────────
select has_function('public', 'is_serving_signup_attendee', array['uuid'],
  'is_serving_signup_attendee(uuid) exists');
select is_definer('public', 'is_serving_signup_attendee', array['uuid'],
  'is_serving_signup_attendee is SECURITY DEFINER');
select ok(not has_function_privilege('anon', 'public.is_serving_signup_attendee(uuid)', 'execute'),
  'anon may not execute is_serving_signup_attendee');
select ok(has_function_privilege('authenticated', 'public.is_serving_signup_attendee(uuid)', 'execute'),
  'authenticated may execute is_serving_signup_attendee');

select is(
  pg_temp.val('chloe.mockingham@example.test',
    format('select public.is_serving_signup_attendee(%L)::text', pg_temp.signup('e1'))),
  'true', 'the helper says yes for someone listed on the date');
select is(
  pg_temp.val('isaac.seedly@example.test',
    format('select public.is_serving_signup_attendee(%L)::text', pg_temp.signup('e1'))),
  'false', 'the helper says no for someone not listed on the date');
select is(
  pg_temp.val('owner@cancel-suite.example.test',
    format('select public.is_serving_signup_attendee(%L)::text', pg_temp.signup('e1'))),
  'false', 'the helper says no for someone in another org');

update public.profiles set role = 'pending' where email = 'chloe.mockingham@example.test';
select is(
  pg_temp.val('chloe.mockingham@example.test',
    format('select public.is_serving_signup_attendee(%L)::text', pg_temp.signup('e1'))),
  'false', 'the helper says no for someone moved back to pending');
select is(pg_temp.attempt('chloe.mockingham@example.test', pg_temp.cancel_sql('e1')), 'rows:0',
  'someone moved back to pending removes 0 rows from a date they are listed on');
update public.profiles set role = 'member' where email = 'chloe.mockingham@example.test';

-- ── Left the group ──────────────────────────────────────────────────────────
-- Leaving removes team_members rows but not attendee rows or created_by, so the
-- delete policy's arms stay true and the group-member select policy has to refuse.
delete from public.group_members gm
 using public.profiles p
 where gm.profile_id = p.id
   and gm.group_id = 'c0000000-0000-0000-0000-00000000000b'
   and p.email in ('henry.mockingham@example.test', 'chloe.mockingham@example.test');
select is(
  pg_temp.val('chloe.mockingham@example.test',
    format('select public.is_serving_signup_attendee(%L)::text', pg_temp.signup('e1'))),
  'true', 'someone who left the group is still listed, so the helper alone does not stop them');
select is(pg_temp.attempt('chloe.mockingham@example.test', pg_temp.cancel_sql('e1')), 'rows:0',
  'someone listed who left the group removes 0 rows');
select is(pg_temp.attempt('henry.mockingham@example.test', pg_temp.cancel_sql('e1')), 'rows:0',
  'the person who tapped Sign up and left the group removes 0 rows');
select ok(pg_temp.signup_exists('e1'), 'the date stays on the schedule after they left');

select * from finish();
rollback;
