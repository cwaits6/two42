-- Hidden email suite: once a person turns on "Hide my email from the
-- directory", their address reaches only themselves and a church admin of
-- their church, through any read path a signed-in member has.
--
-- Every actor is a seeded person. Chloe hides her address; Henry is the
-- primary of her household; Isaac is a member of Group B with her and Zoe
-- leads it; Amelia shares no group with her. Failures are captured as values,
-- so a schema without these rules reports `not ok` lines instead of aborting
-- the transaction.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/hidden_email_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.uid(_email text) returns uuid language sql stable as $$
  select id from public.profiles where email = _email;
$$;

-- A null email acts as the anon role with no JWT.
create function pg_temp.enter(_email text) returns void language plpgsql as $$
begin
  perform set_config('request.headers', '{}', true);
  if _email is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', pg_temp.uid(_email), 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
end $$;

-- rows:<n> on success, the SQLSTATE on failure.
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

-- The single value a read returns, <null> for null, the SQLSTATE on failure.
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

-- ── Fixtures ────────────────────────────────────────────────────────────────
update public.profiles set hide_email = true where email = 'chloe.mockingham@example.test';

do $$
declare other_org uuid;
begin
  other_org := public.provision_organization('Hidden Email Other Org', 'owner@hidden-other.example.test');
  insert into auth.users (id, email) values (gen_random_uuid(), 'owner@hidden-other.example.test');
end $$;

-- Isaac leads the team; Ruth is on it with announcements off. Caleb and
-- Hannah are on it for the count block, which makes one pending and takes the
-- other's address away.
insert into public.teams (id, org_id, group_id, name)
select 'bbbb0000-0000-0000-0000-0000000000e1', g.org_id, g.id, 'Hidden email suite team'
  from public.groups g where g.id = 'c0000000-0000-0000-0000-00000000000b';
insert into public.team_members (org_id, team_id, profile_id, is_leader)
select p.org_id, 'bbbb0000-0000-0000-0000-0000000000e1', p.id, p.email = 'isaac.seedly@example.test'
  from public.profiles p
 where p.email in ('isaac.seedly@example.test', 'leo.loremsworth@example.test',
                   'chloe.mockingham@example.test', 'ruth.fixtureton@example.test',
                   'caleb.dummyfield@example.test', 'hannah.loremsworth@example.test');
update public.profiles set email_announcements = false where email = 'ruth.fixtureton@example.test';

-- Every person and whether the directory may show their address, read with
-- the owner's rights so the mirror checks below can name people the caller
-- cannot see.
create temp view everyone as
  select id, org_id, (email is not null and not hide_email) as shows_email from public.profiles;
grant select on everyone to authenticated;

select is(
  (select array_agg(p.email || '/' || gm.role order by p.email)
     from public.group_members gm join public.profiles p on p.id = gm.profile_id
    where gm.group_id = 'c0000000-0000-0000-0000-00000000000b'
      and p.email in ('admin@local.dev', 'chloe.mockingham@example.test', 'henry.mockingham@example.test',
                      'isaac.seedly@example.test', 'zoe.dummyfield@example.test')),
  array['admin@local.dev/member', 'chloe.mockingham@example.test/member', 'henry.mockingham@example.test/member',
        'isaac.seedly@example.test/member', 'zoe.dummyfield@example.test/leader'],
  'non-vacuity: the seeded owner, household primary, member, leader and church admin are in Group B with these roles');
select is(
  (select array_agg(email || '/' || relationship order by email) from public.profiles
    where family_id = (select family_id from public.profiles where email = 'chloe.mockingham@example.test')),
  array['chloe.mockingham@example.test/spouse', 'henry.mockingham@example.test/primary'],
  'non-vacuity: Henry is the primary of Chloe''s household');
select is(
  (select role from public.profiles where email = 'admin@local.dev'), 'admin',
  'non-vacuity: admin@local.dev is a church admin');
select is(
  (select count(*)::int from public.group_members a
     join public.group_members b on b.group_id = a.group_id
    where a.profile_id = pg_temp.uid('amelia.demoski@example.test')
      and b.profile_id = pg_temp.uid('chloe.mockingham@example.test')), 0,
  'non-vacuity: Amelia shares no group with Chloe');
select is(
  pg_temp.attempt('isaac.seedly@example.test', format(
    'select id from public.profiles where id = %L', pg_temp.uid('chloe.mockingham@example.test'))),
  'rows:1', 'non-vacuity: a member in her group reads Chloe''s row');

-- ── Direct reads of the table ───────────────────────────────────────────────
-- Column privileges are what close these: a row policy cannot hide one
-- column, and filtering or ordering on it reads it as surely as selecting it.
select todo_start('needs SELECT on profiles.email taken from client roles');
select is(
  pg_temp.val(reader.email, format(route.sql, pg_temp.uid('chloe.mockingham@example.test'))),
  '42501',
  reader.who || ' is refused: ' || route.what)
from (values
  ('isaac.seedly@example.test', 'a member'),
  ('zoe.dummyfield@example.test', 'a group leader'),
  ('henry.mockingham@example.test', 'the household primary')
) reader(email, who)
cross join (values
  ('select the hidden email', 'select count(email) from public.profiles where id = %L'),
  ('select all columns', 'select count(*) from (select * from public.profiles where id = %L) p'),
  ('filter on the hidden email', $q$select count(*) from public.profiles where email = 'chloe.mockingham@example.test' -- %s$q$),
  ('order by email', 'select count(*) from (select id from public.profiles order by email) p -- %s')
) route(what, sql);
select todo_end();

-- ── The directory view ──────────────────────────────────────────────────────
select is(
  (select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.profiles_directory'::regclass),
  true, 'profiles_directory stays security_invoker');
select columns_are('public', 'profiles_directory', array[
  'id', 'first_name', 'last_name', 'preferred_name', 'avatar_url', 'role', 'relationship', 'bio',
  'family_id', 'created_at', 'email', 'phone_mobile', 'phone_home', 'phone_work', 'address_line1',
  'address_line2', 'city', 'state', 'postal_code', 'birth_month', 'birth_day', 'birth_year',
  'anniversary', 'occupation', 'employer', 'groups', 'org_id'
], 'profiles_directory keeps its columns');

select is(
  pg_temp.val('isaac.seedly@example.test', format(
    'select email from public.profiles_directory where id = %L', pg_temp.uid('henry.mockingham@example.test'))),
  'henry.mockingham@example.test', 'a member reads a visible email from the directory');
select is(
  pg_temp.val('isaac.seedly@example.test',
    $q$select count(*) from public.profiles_directory where email = 'henry.mockingham@example.test'$q$),
  '1', 'a member finds a visible email by filtering the directory');

select is(
  pg_temp.val(reader.email, format(
    $q$select count(*) || ' row, ' || count(email) || ' email' from public.profiles_directory where id = %L$q$,
    pg_temp.uid('chloe.mockingham@example.test'))),
  '1 row, 0 email',
  reader.who || ' sees Chloe in the directory with no email')
from (values
  ('isaac.seedly@example.test', 'a member'),
  ('zoe.dummyfield@example.test', 'a group leader'),
  ('henry.mockingham@example.test', 'the household primary'),
  ('admin@local.dev', 'a church admin'),
  ('chloe.mockingham@example.test', 'Chloe herself')
) reader(email, who);
select is(
  pg_temp.val(reader.email,
    $q$select count(*) from public.profiles_directory where email = 'chloe.mockingham@example.test'$q$),
  '0',
  reader.who || ' cannot confirm the hidden email by filtering the directory')
from (values
  ('isaac.seedly@example.test', 'a member'),
  ('zoe.dummyfield@example.test', 'a group leader'),
  ('henry.mockingham@example.test', 'the household primary')
) reader(email, who);

-- ── The helpers ─────────────────────────────────────────────────────────────
select is(
  (select prosecdef from pg_proc where proname = fn),
  true, fn || ' is security definer')
from unnest(array['profile_directory_email', 'admin_member_emails', 'serving_team_email_count']) fn;
select is(
  (select proconfig from pg_proc where proname = fn),
  array['search_path=""'], fn || ' pins an empty search_path')
from unnest(array['profile_directory_email', 'admin_member_emails', 'serving_team_email_count']) fn;
select is(
  (select has_function_privilege(r, p.oid, 'execute') from pg_proc p where p.proname = fn),
  false, r || ' cannot execute ' || fn)
from unnest(array['profile_directory_email', 'admin_member_emails', 'serving_team_email_count']) fn
cross join unnest(array['public', 'anon', 'service_role']) r;
select is(
  (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.proname = fn),
  true, 'authenticated can execute ' || fn)
from unnest(array['profile_directory_email', 'admin_member_emails', 'serving_team_email_count']) fn;

select is(
  pg_temp.val('isaac.seedly@example.test', format(
    'select public.profile_directory_email(%L)', pg_temp.uid('henry.mockingham@example.test'))),
  'henry.mockingham@example.test', 'a member gets a visible email from the helper');
select is(
  pg_temp.val(reader.email, format(
    'select public.profile_directory_email(%L)', pg_temp.uid('chloe.mockingham@example.test'))),
  '<null>',
  reader.who || ' gets no hidden email from the helper')
from (values
  ('isaac.seedly@example.test', 'a member'),
  ('zoe.dummyfield@example.test', 'a group leader'),
  ('henry.mockingham@example.test', 'the household primary'),
  ('admin@local.dev', 'a church admin')
) reader(email, who);
select is(
  pg_temp.attempt(null, format(
    'select public.profile_directory_email(%L)', pg_temp.uid('henry.mockingham@example.test'))),
  '42501', 'a request with no session cannot call the helper');

-- The helper's visibility arms are a hand copy of the profiles read policy,
-- which a definer function cannot reuse. For each caller below it must return
-- an address for exactly the people whose row that policy shows them. Chloe
-- and Ruth are callers so that the states below reach every arm: a person
-- seen only through the household, and a caller who is pending.
create function pg_temp.helper_follows_profiles_policy(_state text) returns setof text language sql as $$
  select is(
    pg_temp.val(caller, $q$
      select coalesce(string_agg(e.id::text, ',' order by e.id), 'nobody') from everyone e
       where public.profile_directory_email(e.id) is not null$q$),
    pg_temp.val(caller, $q$
      select coalesce(string_agg(e.id::text, ',' order by e.id), 'nobody') from everyone e
       where e.shows_email and exists (select 1 from public.profiles p where p.id = e.id)$q$),
    caller || ' gets an email only where the profile is visible: ' || _state)
  from unnest(array['admin@local.dev', 'amelia.demoski@example.test', 'henry.mockingham@example.test',
                    'isaac.seedly@example.test', 'zoe.dummyfield@example.test',
                    'chloe.mockingham@example.test', 'ruth.fixtureton@example.test',
                    'owner@hidden-other.example.test']) caller;
$$;

select is(
  (select directory_visibility from public.organizations
    where id = (select org_id from public.profiles where email = 'isaac.seedly@example.test')),
  'shared_groups', 'non-vacuity: the seeded church shows the directory by shared group');
select pg_temp.helper_follows_profiles_policy('shared groups');
select isnt(
  pg_temp.val('isaac.seedly@example.test',
    'select count(*) from everyone e where public.profile_directory_email(e.id) is not null'),
  pg_temp.val('admin@local.dev',
    'select count(*) from everyone e where public.profile_directory_email(e.id) is not null'),
  'non-vacuity: a member and a church admin get different sets from the helper');
select is(
  pg_temp.val('owner@hidden-other.example.test',
    'select count(*) from everyone e where public.profile_directory_email(e.id) is not null'),
  '1', 'someone in another church gets only their own email from the helper');

update public.profiles set is_unlisted = true where email = 'henry.mockingham@example.test';
select pg_temp.helper_follows_profiles_policy('shared groups, one person unlisted');
select is(
  pg_temp.val('isaac.seedly@example.test', format(
    'select public.profile_directory_email(%L)', pg_temp.uid('henry.mockingham@example.test'))),
  '<null>', 'a member gets no email for an unlisted person');
select is(
  pg_temp.val('chloe.mockingham@example.test', format(
    'select public.profile_directory_email(%L)', pg_temp.uid('henry.mockingham@example.test'))),
  'henry.mockingham@example.test', 'someone in an unlisted person''s household still gets their visible email');
update public.profiles set is_unlisted = false where email = 'henry.mockingham@example.test';

-- Henry in no group: Chloe sees him only through the household.
create temp table henry_groups as
  select * from public.group_members where profile_id = pg_temp.uid('henry.mockingham@example.test');
delete from public.group_members where profile_id = pg_temp.uid('henry.mockingham@example.test');
select pg_temp.helper_follows_profiles_policy('shared groups, a household member in no shared group');
select is(
  pg_temp.val(reader.email, format(
    'select public.profile_directory_email(%L)', pg_temp.uid('henry.mockingham@example.test'))),
  reader.want,
  reader.who || ' and a person in no group of theirs')
from (values
  ('chloe.mockingham@example.test', 'henry.mockingham@example.test', 'the household gets the visible email: Chloe'),
  ('isaac.seedly@example.test', '<null>', 'nobody else does: a member')
) reader(email, want, who);
insert into public.group_members select * from henry_groups;

update public.profiles set role = 'pending' where email = 'ruth.fixtureton@example.test';
select pg_temp.helper_follows_profiles_policy('shared groups, one person pending');
update public.profiles set role = 'member' where email = 'ruth.fixtureton@example.test';

update public.organizations set directory_visibility = 'org'
 where id = (select org_id from public.profiles where email = 'isaac.seedly@example.test');
select pg_temp.helper_follows_profiles_policy('whole church');

-- Pending callers, where the whole church is otherwise visible: someone not
-- yet approved reads their own address and nobody else's, a household
-- member's included.
update public.profiles set role = 'pending'
 where email in ('ruth.fixtureton@example.test', 'chloe.mockingham@example.test');
select pg_temp.helper_follows_profiles_policy('whole church, two callers pending');
select is(
  pg_temp.val('ruth.fixtureton@example.test',
    $q$select coalesce(string_agg(public.profile_directory_email(e.id), ','), 'nobody') from everyone e
        where public.profile_directory_email(e.id) is not null$q$),
  'ruth.fixtureton@example.test', 'a pending person gets their own visible email from the helper and no other');
select is(
  pg_temp.val(reader.email, format(
    'select public.profile_directory_email(%L)', pg_temp.uid('henry.mockingham@example.test'))),
  '<null>',
  reader.who || ' gets no email for a member')
from (values
  ('ruth.fixtureton@example.test', 'a pending person'),
  ('chloe.mockingham@example.test', 'a pending person in the member''s household')
) reader(email, who);
update public.profiles set role = 'member'
 where email in ('ruth.fixtureton@example.test', 'chloe.mockingham@example.test');
update public.organizations set directory_visibility = 'shared_groups'
 where id = (select org_id from public.profiles where email = 'isaac.seedly@example.test');

-- ── The household's own read path ───────────────────────────────────────────
-- The profiles update policy calls get_profile_email() as the signed-in
-- person, so that grant stays. Nothing calls it without a session.
select is(
  has_function_privilege(r, 'public.get_profile_email(uuid)', 'execute'),
  r = 'authenticated', r || ': execute on get_profile_email')
from unnest(array['public', 'anon', 'authenticated']) r;

-- ── The owner ───────────────────────────────────────────────────────────────
select is(
  pg_temp.val('chloe.mockingham@example.test', 'select public.get_own_email()'),
  'chloe.mockingham@example.test', 'a person reads their own hidden email');

-- ── A church admin ──────────────────────────────────────────────────────────
select is(
  pg_temp.val('admin@local.dev', 'select count(*) from public.admin_member_emails()'),
  (select count(*)::text from public.profiles
    where org_id = (select org_id from public.profiles where email = 'admin@local.dev')),
  'a church admin reads one row for every person in their church');
select is(
  pg_temp.val('admin@local.dev', format(
    'select email from public.admin_member_emails() where profile_id = %L',
    pg_temp.uid('chloe.mockingham@example.test'))),
  'chloe.mockingham@example.test', 'a church admin reads a hidden email');
select is(
  pg_temp.val('admin@local.dev', format(
    'select count(*) from public.admin_member_emails() where profile_id = %L',
    pg_temp.uid('owner@hidden-other.example.test'))),
  '0', 'a church admin reads no email from another church');
select is(
  pg_temp.val('owner@hidden-other.example.test', $q$
    select count(*) || ' row, ' || count(*) filter (where e.org_id = p.org_id) || ' own church'
      from public.admin_member_emails() a
      join everyone e on e.id = a.profile_id
      join public.profiles p on p.id = auth.uid()$q$),
  '1 row, 1 own church', 'another church''s admin reads only their own church');
select is(
  pg_temp.val(reader.email, 'select count(*) from public.admin_member_emails()'),
  '0', reader.who || ' reads nothing from the church admin path')
from (values
  ('isaac.seedly@example.test', 'a member'),
  ('zoe.dummyfield@example.test', 'a group leader'),
  ('henry.mockingham@example.test', 'the household primary')
) reader(email, who);
select is(
  pg_temp.attempt(null, 'select * from public.admin_member_emails()'),
  '42501', 'a request with no session cannot call the church admin path');

-- ── The setting itself ──────────────────────────────────────────────────────
select is(
  pg_temp.attempt(actor.email, format(
    'update public.profiles set hide_email = false where id = %L', pg_temp.uid('chloe.mockingham@example.test'))),
  'rows:0', actor.who || ', outside the household, cannot change the setting')
from (values
  ('isaac.seedly@example.test', 'a member'),
  ('zoe.dummyfield@example.test', 'a group leader')
) actor(email, who);
select is(
  (select hide_email from public.profiles where email = 'chloe.mockingham@example.test'),
  true, 'the email stays hidden');
select is(
  pg_temp.attempt('henry.mockingham@example.test', format(
    'update public.profiles set hide_email = false where id = %L', pg_temp.uid('chloe.mockingham@example.test'))),
  'rows:1', 'the household primary can change the setting');
select is(
  pg_temp.val('isaac.seedly@example.test', format(
    'select email from public.profiles_directory where id = %L', pg_temp.uid('chloe.mockingham@example.test'))),
  'chloe.mockingham@example.test', 'a member reads the email once it is shown again');
select is(
  pg_temp.attempt('chloe.mockingham@example.test', 'update public.profiles set hide_email = true where id = auth.uid()'),
  'rows:1', 'a person hides their own email');
select is(
  pg_temp.val('isaac.seedly@example.test', format(
    'select public.profile_directory_email(%L)', pg_temp.uid('chloe.mockingham@example.test'))),
  '<null>', 'the helper stops returning it at once');

-- ── The team email count ────────────────────────────────────────────────────
-- The send's three rules, one person each: Ruth has announcements off, Caleb
-- is pending and Hannah has no address. Isaac, Leo and Chloe are left.
update public.profiles set role = 'pending' where email = 'caleb.dummyfield@example.test';
update public.profiles set email = null where email = 'hannah.loremsworth@example.test';
select is(
  (select count(*)::int || ' on the team, ' || count(*) filter (where p.role = 'pending') || ' pending, '
          || count(*) filter (where p.email is null) || ' with no email, '
          || count(*) filter (where not p.email_announcements) || ' with announcements off'
     from public.team_members tm join public.profiles p on p.id = tm.profile_id
    where tm.team_id = 'bbbb0000-0000-0000-0000-0000000000e1'),
  '6 on the team, 1 pending, 1 with no email, 1 with announcements off',
  'non-vacuity: the team holds one person for each rule the count applies');
select is(
  pg_temp.val(caller.email,
    $q$select public.serving_team_email_count('bbbb0000-0000-0000-0000-0000000000e1')$q$),
  '3',
  caller.who || ' gets the number an email to the team reaches: hidden addresses included; pending, no address and announcements off left out')
from (values
  ('isaac.seedly@example.test', 'the team lead'),
  ('zoe.dummyfield@example.test', 'the group leader')
) caller(email, who);
select is(
  pg_temp.val(caller.email,
    $q$select public.serving_team_email_count('bbbb0000-0000-0000-0000-0000000000e1')$q$),
  '<null>',
  caller.who || ' gets no count')
from (values
  ('leo.loremsworth@example.test', 'a team member'),
  ('amelia.demoski@example.test', 'a leader of another group'),
  ('admin@local.dev', 'a church admin who leads neither the team nor its group'),
  ('owner@hidden-other.example.test', 'another church''s admin')
) caller(email, who);
select is(
  pg_temp.attempt(null,
    $q$select public.serving_team_email_count('bbbb0000-0000-0000-0000-0000000000e1')$q$),
  '42501', 'a request with no session cannot call the count');

select * from finish();
rollback;
