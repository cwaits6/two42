-- Prayer anonymity suite: nobody but its author learns who wrote an anonymous
-- request, through the wall, the table, or a write. Only server code holding the
-- prayer keys writes requests, so every client write is refused, and a request
-- in the server's anonymous form stores no author at all.
--
-- Every actor is a seeded person, because the rule is about real roles: Leo is
-- a member of Group B, Zoe leads it, the church admin is a plain member of it
-- and leads Group A. Failures are captured as values, so a schema without
-- these rules reports `not ok` lines instead of aborting the transaction.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/prayer_anonymity_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
-- Not enabled on a fresh local stack, enabled on the shared one and possibly on
-- a hosted project, and the column grant has to hold wherever it is on.
create extension if not exists pg_graphql;
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

-- rows:<n> on success, the full error text on failure, for proving two
-- failures are indistinguishable.
create function pg_temp.attempt_text(_email text, _sql text) returns text language plpgsql as $$
declare n bigint; r text; d text;
begin
  perform pg_temp.enter(_email);
  begin
    execute _sql;
    get diagnostics n = row_count;
    r := 'rows:' || n;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    r := sqlstate || ':' || sqlerrm || ':' || coalesce(d, '');
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
select is(
  (select array_agg(p.email || '/' || gm.role order by p.email)
     from public.group_members gm join public.profiles p on p.id = gm.profile_id
    where gm.group_id = 'c0000000-0000-0000-0000-00000000000b'
      and p.email in ('admin@local.dev', 'caleb.dummyfield@example.test',
                      'isaac.seedly@example.test', 'leo.loremsworth@example.test',
                      'zoe.dummyfield@example.test')),
  array['admin@local.dev/member', 'caleb.dummyfield@example.test/member',
        'isaac.seedly@example.test/member', 'leo.loremsworth@example.test/member',
        'zoe.dummyfield@example.test/leader'],
  'non-vacuity: the seeded author, member, leader and church admin are in Group B with these roles');
select is(
  (select role from public.profiles where email = 'admin@local.dev'), 'admin',
  'non-vacuity: admin@local.dev is a church admin');
select is(
  (select gm.role from public.group_members gm join public.groups g on g.id = gm.group_id
    where gm.profile_id = pg_temp.uid('admin@local.dev') and g.name = 'Group A'), 'leader',
  'non-vacuity: the church admin leads Group A');
select is(
  (select gm.role from public.group_members gm join public.groups g on g.id = gm.group_id
    where gm.profile_id = pg_temp.uid('mia.fakeworth@example.test') and g.name = 'Group A'), 'member',
  'non-vacuity: Mia is a member of Group A');
select is(
  (select count(*)::int from public.group_members
    where profile_id = pg_temp.uid('amelia.demoski@example.test')
      and group_id = 'c0000000-0000-0000-0000-00000000000b'), 0,
  'non-vacuity: Amelia is outside Group B');

-- ...a1, ...a2: Isaac, anonymous. ...b1: Isaac, by name. ...c1: Caleb,
-- anonymous. ...d1: Mia, anonymous, Group A. ...e1: Isaac, for switching.
-- ...f1, ...f2, ...f3: Isaac, Caleb, Mia, anonymous, for deleting.
insert into public.prayer_requests (id, org_id, group_id, author_id, body, is_anonymous)
select ('aaaa0000-0000-0000-0000-0000000000' || f.k)::uuid, p.org_id, g.id, p.id, 'fixture ' || f.k, f.anon
from (values
  ('a1', 'isaac.seedly@example.test', 'Group B', true),
  ('a2', 'isaac.seedly@example.test', 'Group B', true),
  ('b1', 'isaac.seedly@example.test', 'Group B', false),
  ('c1', 'caleb.dummyfield@example.test', 'Group B', true),
  ('d1', 'mia.fakeworth@example.test', 'Group A', true),
  ('e1', 'isaac.seedly@example.test', 'Group B', true),
  ('f1', 'isaac.seedly@example.test', 'Group B', true),
  ('f2', 'caleb.dummyfield@example.test', 'Group B', true),
  ('f3', 'mia.fakeworth@example.test', 'Group A', true)
) f(k, email, grp, anon)
join public.profiles p on p.email = f.email
join public.groups g on g.name = f.grp and g.org_id = p.org_id;

do $$
declare other_org uuid;
begin
  other_org := public.provision_organization('Anonymity Other Org', 'owner@anonymity-other.example.test');
  insert into auth.users (id, email) values (gen_random_uuid(), 'owner@anonymity-other.example.test');
  perform set_config('pa.other_org', other_org::text, true);
end $$;

-- ── Grants and shape ────────────────────────────────────────────────────────
select is(has_column_privilege(r, 'public.prayer_requests', 'author_id', 'select'), false,
          r || ' cannot select author_id') from unnest(array['anon', 'authenticated']) r;
select is(has_column_privilege(r, 'public.prayer_requests', 'author_id', 'update'), false,
          r || ' cannot update author_id') from unnest(array['anon', 'authenticated']) r;
select is(has_table_privilege(r, 'public.prayer_requests', p), false,
          r || ' has no ' || p || ' on prayer_requests')
from unnest(array['anon', 'authenticated']) r
cross join unnest(array['insert', 'update', 'delete', 'truncate']) p;
select is(has_any_column_privilege(r, 'public.prayer_requests', p), false,
          r || ' has no column-level ' || p || ' on prayer_requests')
from unnest(array['anon', 'authenticated']) r
cross join unnest(array['insert', 'update']) p;
select is(has_column_privilege('authenticated', 'public.prayer_requests', c, 'select'), true,
          'authenticated reads ' || c || ', which the server opens')
from unnest(array['body_ciphertext', 'author_hash']) c;
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'prayer_requests' and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  0, 'prayer_requests has no client write policy left');
select hasnt_trigger('public', 'prayer_requests', t, t || ' is gone')
from unnest(array['prayer_requests_author_sets_anonymity', 'prayer_requests_touch_updated_at']) t;
select is(
  (select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.prayer_wall'::regclass),
  true, 'prayer_wall stays security_invoker');
select columns_are('public', 'prayer_wall', array[
  'id', 'body', 'is_anonymous', 'is_answered', 'created_at', 'mine', 'first_name', 'last_name',
  'preferred_name', 'avatar_url', 'praying_count', 'i_am_praying', 'org_id', 'group_id',
  'body_ciphertext', 'author_hash'
], 'prayer_wall keeps its columns and has no author column');
select is(
  (select count(*)::int
     from pg_depend d
     join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
    where d.classid = 'pg_rewrite'::regclass
      and d.refobjid = 'public.prayer_requests'::regclass
      and a.attname = 'author_id'),
  0, 'no view depends on prayer_requests.author_id');

-- ── Direct reads ────────────────────────────────────────────────────────────
select is(
  pg_temp.attempt(reader.email, format(route.sql, pg_temp.uid('isaac.seedly@example.test'))),
  '42501',
  reader.who || ' is refused: ' || route.what)
from (values
  ('leo.loremsworth@example.test', 'a member'),
  ('zoe.dummyfield@example.test', 'a group leader'),
  ('admin@local.dev', 'a church admin')
) reader(email, who)
cross join (values
  ('select author_id', 'select author_id from public.prayer_requests where id = ''aaaa0000-0000-0000-0000-0000000000a1'' -- %s'),
  ('select *', 'select * from public.prayer_requests where id = ''aaaa0000-0000-0000-0000-0000000000a1'' -- %s'),
  ('whole-row reference', 'select to_jsonb(r) from public.prayer_requests r -- %s'),
  ('filter on author_id', 'select id from public.prayer_requests where author_id = ''%s'''),
  ('order by author_id', 'select id from public.prayer_requests order by author_id -- %s'),
  ('group by author_id', 'select count(*) from public.prayer_requests group by author_id -- %s'),
  ('join to profiles on author_id', 'select p.first_name from public.prayer_requests r join public.profiles p on p.id = r.author_id -- %s')
) route(what, sql);

select is(
  pg_temp.attempt(reader.email,
    'select id from public.prayer_requests where id = ''aaaa0000-0000-0000-0000-0000000000a1'''),
  'rows:1',
  'non-vacuity: ' || reader.who || ' reads the request itself')
from (values
  ('leo.loremsworth@example.test', 'a member'),
  ('zoe.dummyfield@example.test', 'a group leader'),
  ('admin@local.dev', 'a church admin')
) reader(email, who);

analyze public.prayer_requests;
select is(
  pg_temp.val('leo.loremsworth@example.test',
    $q$select count(*) from pg_stats where schemaname = 'public' and tablename = 'prayer_requests' and attname = 'author_id'$q$),
  '0', 'planner statistics do not list author_id values to a member');

-- ── The wall ────────────────────────────────────────────────────────────────
select is(
  pg_temp.val(reader.email, format($q$
    select concat_ws('|', mine::text, first_name, last_name, preferred_name, avatar_url)
    from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000%s'$q$, row_key)),
  'false',
  reader.who || ' sees no author on anonymous request ' || row_key)
from (values
  ('leo.loremsworth@example.test', 'a member'),
  ('zoe.dummyfield@example.test', 'a group leader'),
  ('admin@local.dev', 'a church admin')
) reader(email, who)
cross join (values ('a1'), ('a2'), ('c1')) k(row_key);

select is(
  pg_temp.val(reader.email, $q$
    select concat_ws('|', mine::text, first_name) from public.prayer_wall
    where id = 'aaaa0000-0000-0000-0000-0000000000b1'$q$),
  'false|Isaac',
  reader.who || ' sees the name on a by-name request')
from (values
  ('leo.loremsworth@example.test', 'a member'),
  ('zoe.dummyfield@example.test', 'a group leader'),
  ('admin@local.dev', 'a church admin')
) reader(email, who);

select is(
  pg_temp.val('isaac.seedly@example.test', format($q$
    select concat_ws('|', mine::text, first_name) from public.prayer_wall
    where id = 'aaaa0000-0000-0000-0000-0000000000%s'$q$, row_key)),
  'true|Isaac',
  'the author sees request ' || row_key || ' as theirs')
from (values ('a1'), ('a2'), ('b1')) k(row_key);

select is(
  pg_temp.val('caleb.dummyfield@example.test', $q$
    select mine from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000a1'$q$),
  'false', 'another anonymous author does not see Isaac''s request as theirs');

select ok(
  pg_temp.attempt(null, 'select id from public.prayer_wall') in ('rows:0', '42501'),
  'a request with no session reads nothing from the wall');

-- ── The helper ──────────────────────────────────────────────────────────────
select is(
  (select prosecdef from pg_proc where proname = 'prayer_request_visible_author'),
  true, 'the helper is security definer');
select is(
  (select proconfig from pg_proc where proname = 'prayer_request_visible_author'),
  array['search_path=""'], 'the helper pins an empty search_path');
select is(
  (select has_function_privilege(r, p.oid, 'execute') from pg_proc p where p.proname = 'prayer_request_visible_author'),
  false, r || ' cannot execute the helper')
from unnest(array['public', 'anon', 'service_role']) r;
select is(
  (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.proname = 'prayer_request_visible_author'),
  true, 'authenticated can execute the helper');

select is(
  pg_temp.val(reader.email, format(
    $q$select public.prayer_request_visible_author('aaaa0000-0000-0000-0000-0000000000%s')$q$, row_key)),
  '<null>',
  reader.who || ' gets nothing from the helper for request ' || row_key)
from (values
  ('leo.loremsworth@example.test', 'a member'),
  ('zoe.dummyfield@example.test', 'a group leader'),
  ('admin@local.dev', 'a church admin')
) reader(email, who)
cross join (values ('a1'), ('c1')) k(row_key);

select is(
  pg_temp.val('isaac.seedly@example.test',
    $q$select public.prayer_request_visible_author('aaaa0000-0000-0000-0000-0000000000a1')$q$),
  pg_temp.uid('isaac.seedly@example.test')::text,
  'the author gets themselves from the helper');
select is(
  pg_temp.val('leo.loremsworth@example.test',
    $q$select public.prayer_request_visible_author('aaaa0000-0000-0000-0000-0000000000b1')$q$),
  pg_temp.uid('isaac.seedly@example.test')::text,
  'a member gets the author of a by-name request');
select is(
  pg_temp.val('amelia.demoski@example.test',
    $q$select public.prayer_request_visible_author('aaaa0000-0000-0000-0000-0000000000b1')$q$),
  '<null>', 'someone outside the group gets nothing, by name or not');
select is(
  pg_temp.val('owner@anonymity-other.example.test',
    $q$select public.prayer_request_visible_author('aaaa0000-0000-0000-0000-0000000000b1')$q$),
  '<null>', 'someone in another church gets nothing');
select is(
  pg_temp.attempt(null,
    $q$select public.prayer_request_visible_author('aaaa0000-0000-0000-0000-0000000000b1')$q$),
  '42501', 'a request with no session cannot call the helper');

-- A household is not an exception to anonymous, and the name masking of an
-- unlisted author must hold on the id too, or their by-name requests link up.
update public.profiles
   set family_id = (select family_id from public.profiles where email = 'isaac.seedly@example.test')
 where email = 'caleb.dummyfield@example.test';
select is(
  pg_temp.val('caleb.dummyfield@example.test',
    $q$select public.prayer_request_visible_author('aaaa0000-0000-0000-0000-0000000000a1')$q$),
  '<null>', 'someone in the author''s household gets nothing on an anonymous request');

update public.profiles set is_unlisted = true where email = 'isaac.seedly@example.test';
select is(
  pg_temp.val('leo.loremsworth@example.test',
    $q$select public.prayer_request_visible_author('aaaa0000-0000-0000-0000-0000000000b1')$q$),
  '<null>', 'a member gets no id for an unlisted by-name author');
select is(
  pg_temp.val('leo.loremsworth@example.test',
    $q$select concat_ws('|', mine::text, first_name) from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000b1'$q$),
  'false', 'a member sees no name for an unlisted by-name author');
select is(
  pg_temp.val('admin@local.dev',
    $q$select concat_ws('|', mine::text, first_name) from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000b1'$q$),
  'false|Isaac', 'a church admin sees the name of an unlisted by-name author');
select is(
  pg_temp.val('caleb.dummyfield@example.test',
    $q$select concat_ws('|', mine::text, first_name) from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000b1'$q$),
  'false|Isaac', 'the household sees the name of an unlisted by-name author');
update public.profiles set is_unlisted = false where email = 'isaac.seedly@example.test';

-- An author who left the group: the directory rule hides their name from the
-- remaining members, so the id must stay hidden as well.
update public.profiles
   set family_id = null
 where email = 'caleb.dummyfield@example.test';
update public.organizations o
   set directory_visibility = 'shared_groups'
 where o.id = (select org_id from public.profiles where email = 'isaac.seedly@example.test');
delete from public.group_members
 where profile_id = pg_temp.uid('isaac.seedly@example.test')
   and group_id = 'c0000000-0000-0000-0000-00000000000b';
select is(
  pg_temp.val('caleb.dummyfield@example.test',
    $q$select public.prayer_request_visible_author('aaaa0000-0000-0000-0000-0000000000b1')$q$),
  '<null>', 'a member gets no id for a by-name author they share no group with');
select is(
  pg_temp.val('caleb.dummyfield@example.test',
    $q$select concat_ws('|', mine::text, first_name) from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000b1'$q$),
  'false', 'a member sees no name for a by-name author they share no group with');
insert into public.group_members (org_id, group_id, profile_id, role)
select org_id, 'c0000000-0000-0000-0000-00000000000b', id, 'member'
  from public.profiles where email = 'isaac.seedly@example.test';

-- The helper's by-name arm is a hand copy of the profiles read policy, which a
-- definer function cannot reuse. Every caller in the group must get the id
-- exactly where that policy shows them the profile.
create function pg_temp.helper_follows_profiles_policy(_state text) returns setof text language sql as $$
  select is(
    pg_temp.val(caller, $q$select public.prayer_request_visible_author('aaaa0000-0000-0000-0000-0000000000b1')$q$) <> '<null>',
    pg_temp.val(caller, format('select id from public.profiles where id = %L', pg_temp.uid('isaac.seedly@example.test'))) <> '<null>',
    caller || ' gets the id only where the profile is visible: ' || _state)
  from unnest(array['admin@local.dev', 'caleb.dummyfield@example.test',
                    'leo.loremsworth@example.test', 'zoe.dummyfield@example.test']) caller;
$$;

select pg_temp.helper_follows_profiles_policy('shared groups, in the group');

update public.profiles set is_unlisted = true where email = 'isaac.seedly@example.test';
select pg_temp.helper_follows_profiles_policy('shared groups, unlisted');

update public.profiles
   set family_id = (select family_id from public.profiles where email = 'isaac.seedly@example.test')
 where email = 'caleb.dummyfield@example.test';
select pg_temp.helper_follows_profiles_policy('shared groups, unlisted, one caller in the household');
update public.profiles set family_id = null where email = 'caleb.dummyfield@example.test';
update public.profiles set is_unlisted = false where email = 'isaac.seedly@example.test';

update public.profiles set role = 'pending' where email = 'isaac.seedly@example.test';
select pg_temp.helper_follows_profiles_policy('shared groups, pending');
update public.profiles set role = 'member' where email = 'isaac.seedly@example.test';

delete from public.group_members
 where profile_id = pg_temp.uid('isaac.seedly@example.test')
   and group_id = 'c0000000-0000-0000-0000-00000000000b';
select pg_temp.helper_follows_profiles_policy('shared groups, left the group');

update public.organizations o
   set directory_visibility = 'org'
 where o.id = (select org_id from public.profiles where email = 'isaac.seedly@example.test');
select pg_temp.helper_follows_profiles_policy('whole church, left the group');

update public.profiles set is_unlisted = true where email = 'isaac.seedly@example.test';
select pg_temp.helper_follows_profiles_policy('whole church, unlisted');
update public.profiles set is_unlisted = false where email = 'isaac.seedly@example.test';

update public.organizations o
   set directory_visibility = 'shared_groups'
 where o.id = (select org_id from public.profiles where email = 'isaac.seedly@example.test');
insert into public.group_members (org_id, group_id, profile_id, role)
select org_id, 'c0000000-0000-0000-0000-00000000000b', id, 'member'
  from public.profiles where email = 'isaac.seedly@example.test';

-- ── No client writes ────────────────────────────────────────────────────────
-- The author, a leader, a church admin who leads another group, and a member
-- all get the same refusal, so a write cannot tell them apart.
select is(
  pg_temp.attempt(who.email, format(w.sql, row_key)),
  '42501', who.who || ' is refused: ' || w.what || ' on ' || row_key)
from (values
  ('isaac.seedly@example.test', 'the author'),
  ('zoe.dummyfield@example.test', 'a leader'),
  ('admin@local.dev', 'a church admin'),
  ('leo.loremsworth@example.test', 'a member')
) who(email, who)
cross join (values
  ('update', $q$update public.prayer_requests set body = 'x' where id = 'aaaa0000-0000-0000-0000-0000000000%s'$q$),
  ('update returning *', $q$update public.prayer_requests set is_answered = true where id = 'aaaa0000-0000-0000-0000-0000000000%s' returning *$q$),
  ('unmask', $q$update public.prayer_requests set is_anonymous = false where id = 'aaaa0000-0000-0000-0000-0000000000%s'$q$),
  ('delete', $q$delete from public.prayer_requests where id = 'aaaa0000-0000-0000-0000-0000000000%s'$q$),
  ('delete returning author_id', $q$delete from public.prayer_requests where id = 'aaaa0000-0000-0000-0000-0000000000%s' returning author_id$q$)
) w(what, sql)
cross join (values ('a1'), ('b1'), ('c1')) k(row_key);
select is(
  pg_temp.attempt(who, sql), '42501', what)
from (values
  ('isaac.seedly@example.test', 'the author cannot post from the browser',
   $q$insert into public.prayer_requests (author_id, group_id, body) values (auth.uid(), 'c0000000-0000-0000-0000-00000000000b', 'mine') returning id$q$),
  ('isaac.seedly@example.test', 'nobody can store text the server did not seal',
   $q$insert into public.prayer_requests (author_hash, group_id, body_ciphertext, is_anonymous) values ('h1.x.y', 'c0000000-0000-0000-0000-00000000000b', 'v1.forged', true)$q$),
  ('leo.loremsworth@example.test', 'a member cannot post in someone else''s name',
   format($q$insert into public.prayer_requests (author_id, group_id, body) values ('%s', 'c0000000-0000-0000-0000-00000000000b', 'forged')$q$,
          pg_temp.uid('isaac.seedly@example.test'))),
  ('zoe.dummyfield@example.test', 'a leader cannot take over a request through an upsert',
   $q$insert into public.prayer_requests (id, author_id, group_id, body) values ('aaaa0000-0000-0000-0000-0000000000a1', auth.uid(), 'c0000000-0000-0000-0000-00000000000b', 'u') on conflict (id) do update set author_id = excluded.author_id$q$),
  ('zoe.dummyfield@example.test', 'a leader cannot probe the author through an upsert condition',
   $q$insert into public.prayer_requests (id, author_id, group_id, body) values ('aaaa0000-0000-0000-0000-0000000000a1', auth.uid(), 'c0000000-0000-0000-0000-00000000000b', 'u') on conflict (id) do update set body = 'probe' where public.prayer_requests.author_id = auth.uid()$q$)
) a(who, what, sql);
select is(
  (select concat_ws('|', body, is_anonymous::text, is_answered::text) from public.prayer_requests
    where id = 'aaaa0000-0000-0000-0000-0000000000a1'),
  'fixture a1|true|false', 'the refused writes left the request as it was');
select is(
  pg_temp.attempt_text('zoe.dummyfield@example.test', $q$update public.prayer_requests set is_anonymous = false where id = 'aaaa0000-0000-0000-0000-0000000000a1'$q$),
  pg_temp.attempt_text('zoe.dummyfield@example.test', $q$update public.prayer_requests set is_anonymous = false where id = 'aaaa0000-0000-0000-0000-0000000000c1'$q$),
  'a leader''s attempt to unmask fails identically whoever wrote the request');

-- A foreign key names the constraint it trips, so without a guard the error
-- from changing a person's id says whether that person has written a request.
select is(
  pg_temp.attempt_text('admin@local.dev', format($q$update public.profiles set id = '11111111-1111-1111-1111-111111111111' where id = %L$q$, pg_temp.uid('isaac.seedly@example.test'))),
  pg_temp.attempt_text('admin@local.dev', format($q$update public.profiles set id = '11111111-1111-1111-1111-111111111111' where id = %L$q$, pg_temp.uid('ruth.fixtureton@example.test'))),
  'changing a person''s id fails identically whether or not they wrote a request');
select unalike(
  pg_temp.attempt_text('admin@local.dev', format($q$update public.profiles set id = '11111111-1111-1111-1111-111111111111' where id = %L$q$, pg_temp.uid('isaac.seedly@example.test'))),
  '%prayer_requests%', 'the refusal does not mention prayer requests');
select is(
  pg_temp.attempt('admin@local.dev', format($q$update public.profiles set id = id where id = %L$q$, pg_temp.uid('isaac.seedly@example.test'))),
  'rows:1', 'an edit that leaves the id unchanged goes through');
select is(
  pg_temp.attempt_text('admin@local.dev', format($q$update public.profiles set org_id = %L where id = %L$q$, current_setting('pa.other_org'), pg_temp.uid('isaac.seedly@example.test'))),
  pg_temp.attempt_text('admin@local.dev', format($q$update public.profiles set org_id = %L where id = %L$q$, current_setting('pa.other_org'), pg_temp.uid('leo.loremsworth@example.test'))),
  'moving a person to another church fails on row security, not on the foreign key');
select is(
  pg_temp.attempt('admin@local.dev', format($q$delete from public.profiles where id = %L$q$, pg_temp.uid('isaac.seedly@example.test'))),
  'rows:0', 'a church admin cannot delete a person, so the cascade is not an oracle');
select is(
  (select count(*)::int from public.prayer_requests where author_id = pg_temp.uid('isaac.seedly@example.test')) > 0,
  true, 'the author''s requests remain');

-- ── Removing a person from a group ──────────────────────────────────────────
select is(
  pg_temp.attempt('zoe.dummyfield@example.test', format(
    $q$delete from public.group_members where group_id = 'c0000000-0000-0000-0000-00000000000b' and profile_id = '%s'$q$,
    pg_temp.uid(email))),
  'rows:1', 'a leader removes ' || email || ' from the group whether or not they wrote a request')
from (values ('isaac.seedly@example.test'), ('ruth.fixtureton@example.test')) e(email);
select is(
  pg_temp.val('leo.loremsworth@example.test', $q$
    select concat_ws('|', body, mine::text, first_name) from public.prayer_wall
    where id = 'aaaa0000-0000-0000-0000-0000000000a1'$q$),
  'fixture a1|false', 'the request stays, still anonymous, after its author is removed');
insert into public.group_members (org_id, group_id, profile_id, role)
select org_id, 'c0000000-0000-0000-0000-00000000000b', id, 'member'
  from public.profiles where email in ('isaac.seedly@example.test', 'ruth.fixtureton@example.test');

-- ── The stored forms ────────────────────────────────────────────────────────
-- Request e1 as the server stores it once anonymous: no author_id, only a hash
-- the database cannot compute or check.
update public.prayer_requests
   set author_id = null, author_hash = 'h1.0000beef.not-a-real-mac', body = null, body_ciphertext = 'v1.0000beef.aXY.c2VhbGVk'
 where id = 'aaaa0000-0000-0000-0000-0000000000e1';
select is(
  (select author_id from public.prayer_requests where id = 'aaaa0000-0000-0000-0000-0000000000e1'),
  null, 'an anonymous request in the server''s form stores no author, even for the table owner');
select is(
  pg_temp.val(reader, $q$select public.prayer_request_visible_author('aaaa0000-0000-0000-0000-0000000000e1')$q$),
  '<null>', 'the helper names no author of a hashed request to ' || reader)
from unnest(array['isaac.seedly@example.test', 'leo.loremsworth@example.test',
                  'zoe.dummyfield@example.test', 'admin@local.dev']) reader;
select is(
  pg_temp.val(reader, $q$select concat_ws('|', mine::text, first_name, body, body_ciphertext) from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000e1'$q$),
  'false|v1.0000beef.aXY.c2VhbGVk',
  reader || ' gets the sealed text and no author from the wall; the server opens it and matches the hash')
from unnest(array['isaac.seedly@example.test', 'leo.loremsworth@example.test']) reader;

-- Switching to by-name writes the author and clears the hash.
update public.prayer_requests
   set is_anonymous = false, author_id = pg_temp.uid('isaac.seedly@example.test'), author_hash = null
 where id = 'aaaa0000-0000-0000-0000-0000000000e1';
select is(
  pg_temp.val('leo.loremsworth@example.test', $q$select concat_ws('|', mine::text, first_name) from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000e1'$q$),
  'false|Isaac', 'a member sees the name once the author shares it');
select is(
  pg_temp.val('isaac.seedly@example.test', $q$select mine::text from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000e1'$q$),
  'true', 'the author sees a by-name request as theirs from the view');

-- One text form and one author form, always.
select throws_ok(
  format('update public.prayer_requests set %s where id = ''aaaa0000-0000-0000-0000-0000000000e1''', w.set_clause),
  '23514', format('new row for relation "prayer_requests" violates check constraint "%s"', w.con),
  w.what)
from (values
  ('both text forms', $q$body = 'plain', body_ciphertext = 'v1.a.b.c'$q$, 'prayer_requests_one_body'),
  ('no text', $q$body = null, body_ciphertext = null$q$, 'prayer_requests_one_body'),
  ('an author and a hash', $q$author_hash = 'h1.a.b'$q$, 'prayer_requests_one_author'),
  ('neither author form', $q$is_anonymous = true, author_id = null$q$, 'prayer_requests_one_author'),
  ('a by-name request with only a hash', $q$author_id = null, author_hash = 'h1.a.b'$q$, 'prayer_requests_named_has_author')
) w(what, set_clause, con);
-- ── Every other route ───────────────────────────────────────────────────────
select hasnt_column('public', 'prayer_responses', 'author_id',
  'prayer_responses carries no author');
select is(
  pg_temp.attempt('leo.loremsworth@example.test', format(
    $q$insert into public.prayer_responses (request_id, profile_id, group_id) values ('aaaa0000-0000-0000-0000-0000000000%s', auth.uid(), 'c0000000-0000-0000-0000-00000000000b')$q$, row_key)),
  'rows:1', 'a member prays for anonymous request ' || row_key || ' whoever wrote it')
from (values ('a1'), ('c1')) k(row_key);

select is(
  (select count(*)::int from pg_publication_tables
    where schemaname = 'public' and tablename in ('prayer_requests', 'prayer_responses', 'prayer_wall')),
  0, 'no publication streams prayer rows');

select ok(
  pg_temp.val('leo.loremsworth@example.test', format($q$select graphql.resolve('%s')::text$q$, query))
    like '%"errors"%',
  'GraphQL refuses ' || what)
from (values
  ('author_id on a request', '{ prayer_requestsCollection(first: 1) { edges { node { id author_id } } } }'),
  ('a filter on author_id', format('{ prayer_requestsCollection(filter: {author_id: {eq: "%s"}}) { edges { node { id } } } }', pg_temp.uid('isaac.seedly@example.test'))),
  ('the profile of a request', '{ prayer_requestsCollection(first: 1) { edges { node { id profiles { first_name } } } } }'),
  ('the requests of a profile', '{ profilesCollection(first: 1) { edges { node { id prayer_requestsCollection { edges { node { id } } } } } } }')
) q(what, query);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.prosrc ~ 'prayer_(requests|responses|wall)'
      and has_function_privilege('authenticated', p.oid, 'execute')),
  array['prayer_request_visible_author'],
  'the helper is the only definer function a member can call that reads prayer rows');

-- Home dates an answered prayer by this column, which prayer_wall does not carry.
select matches(
  pg_temp.attempt('leo.loremsworth@example.test', 'select updated_at from public.prayer_requests'),
  '^rows:[1-9]',
  'a member can read when a request last changed');

select * from finish();
rollback;
