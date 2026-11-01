-- Prayer anonymity suite: nobody but its author learns who wrote an anonymous
-- request, through the wall, the table, a write's return value, or a write
-- that succeeds or fails depending on who the author is.
--
-- Every actor is a seeded person, because the rule is about real roles: Leo is
-- a member of Group B, Zoe leads it, the church admin is a plain member of it
-- and leads Group A. Failures are captured as values, so an unfixed schema
-- reports `not ok` lines instead of aborting the transaction.
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
select is(has_column_privilege('authenticated', 'public.prayer_requests', 'author_id', 'insert'), true,
          'authenticated can still name itself as author on insert');
select is(
  (select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.prayer_wall'::regclass),
  true, 'prayer_wall stays security_invoker');
select columns_are('public', 'prayer_wall', array[
  'id', 'body', 'is_anonymous', 'is_answered', 'created_at', 'mine', 'first_name', 'last_name',
  'preferred_name', 'avatar_url', 'praying_count', 'i_am_praying', 'org_id', 'group_id'
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

-- ── Writes return nothing about the author ──────────────────────────────────
select is(
  pg_temp.attempt('zoe.dummyfield@example.test', route.sql),
  '42501', 'a leader is refused: ' || route.what)
from (values
  ('update returning author_id', $q$update public.prayer_requests set body = 'x' where id = 'aaaa0000-0000-0000-0000-0000000000a1' returning author_id$q$),
  ('update returning *', $q$update public.prayer_requests set body = 'x' where id = 'aaaa0000-0000-0000-0000-0000000000a1' returning *$q$),
  ('update filtered on author_id', $q$update public.prayer_requests set body = 'x' where author_id = auth.uid()$q$),
  ('delete returning author_id', $q$delete from public.prayer_requests where id = 'aaaa0000-0000-0000-0000-0000000000a1' returning author_id$q$),
  ('delete returning *', $q$delete from public.prayer_requests where id = 'aaaa0000-0000-0000-0000-0000000000a1' returning *$q$),
  ('delete filtered on author_id', $q$delete from public.prayer_requests where author_id = auth.uid()$q$)
) route(what, sql);
select is(
  (select body from public.prayer_requests where id = 'aaaa0000-0000-0000-0000-0000000000a1'),
  'fixture a1', 'the refused writes left the request as it was');

select is(
  pg_temp.attempt('isaac.seedly@example.test', format(
    $q$insert into public.prayer_requests (author_id, group_id, body) values (auth.uid(), 'c0000000-0000-0000-0000-00000000000b', 'returning') %s$q$, ret)),
  expected, 'an insert ' || ret)
from (values
  ('returning author_id', '42501'),
  ('returning *', '42501'),
  ('returning id, created_at', 'rows:1')
) r(ret, expected);

-- ── Moderation, with row counts ─────────────────────────────────────────────
select is(
  pg_temp.attempt('zoe.dummyfield@example.test', format(
    $q$update public.prayer_requests set body = 'edited' where id = 'aaaa0000-0000-0000-0000-0000000000%s'$q$, row_key)),
  'rows:1', 'a leader edits request ' || row_key || ' whoever wrote it')
from (values ('a2'), ('c1')) k(row_key);
select is(
  (select array_agg(body order by id) from public.prayer_requests
    where id in ('aaaa0000-0000-0000-0000-0000000000a2', 'aaaa0000-0000-0000-0000-0000000000c1')),
  array['edited', 'edited'], 'the leader''s edits landed');
select is(
  pg_temp.attempt('zoe.dummyfield@example.test', format(
    $q$delete from public.prayer_requests where id = 'aaaa0000-0000-0000-0000-0000000000%s'$q$, row_key)),
  'rows:1', 'a leader deletes request ' || row_key || ' whoever wrote it')
from (values ('f1'), ('f2')) k(row_key);

select is(
  pg_temp.attempt('admin@local.dev', $q$update public.prayer_requests set body = 'admin edit' where id = 'aaaa0000-0000-0000-0000-0000000000d1'$q$),
  'rows:1', 'a church admin leading the group edits an anonymous request');
select is(
  pg_temp.attempt('admin@local.dev', $q$delete from public.prayer_requests where id = 'aaaa0000-0000-0000-0000-0000000000f3'$q$),
  'rows:1', 'a church admin leading the group deletes an anonymous request');
select is(
  pg_temp.val('admin@local.dev', $q$select concat_ws('|', mine::text, first_name) from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000d1'$q$),
  'false', 'the edit taught the church admin nothing about the author');
select is(
  pg_temp.attempt('admin@local.dev', format(sql, row_key)),
  'rows:0', 'a church admin who only belongs to the group has no moderation on ' || row_key || ': ' || what)
from (values
  ('update', $q$update public.prayer_requests set body = 'admin edit' where id = 'aaaa0000-0000-0000-0000-0000000000%s'$q$),
  ('delete', $q$delete from public.prayer_requests where id = 'aaaa0000-0000-0000-0000-0000000000%s'$q$)
) w(what, sql)
cross join (values ('a1'), ('c1')) k(row_key);

-- ── Writes are not an oracle ────────────────────────────────────────────────
select is(
  pg_temp.attempt('leo.loremsworth@example.test', format(sql, row_key)),
  'rows:0', 'a member''s ' || what || ' on ' || row_key || ' matches nothing, whoever wrote it')
from (values
  ('update', $q$update public.prayer_requests set body = 'x' where id = 'aaaa0000-0000-0000-0000-0000000000%s'$q$),
  ('delete', $q$delete from public.prayer_requests where id = 'aaaa0000-0000-0000-0000-0000000000%s'$q$)
) w(what, sql)
cross join (values ('a1'), ('c1')) k(row_key);

select is(
  pg_temp.attempt_text('zoe.dummyfield@example.test', $q$update public.prayer_requests set is_anonymous = false where id = 'aaaa0000-0000-0000-0000-0000000000a1'$q$),
  pg_temp.attempt_text('zoe.dummyfield@example.test', $q$update public.prayer_requests set is_anonymous = false where id = 'aaaa0000-0000-0000-0000-0000000000c1'$q$),
  'a leader''s attempt to unmask fails identically whoever wrote the request');
select is(
  pg_temp.attempt('zoe.dummyfield@example.test', $q$update public.prayer_requests set is_anonymous = false where id = 'aaaa0000-0000-0000-0000-0000000000a1'$q$),
  '42501', 'a leader cannot make an anonymous request by name');
select is(
  (select is_anonymous from public.prayer_requests where id = 'aaaa0000-0000-0000-0000-0000000000a1'),
  true, 'the request stays anonymous');
select is(
  pg_temp.attempt('zoe.dummyfield@example.test', $q$update public.prayer_requests set is_anonymous = true where id = 'aaaa0000-0000-0000-0000-0000000000b1'$q$),
  '42501', 'a leader cannot make a by-name request anonymous');
select is(
  pg_temp.attempt('zoe.dummyfield@example.test', $q$update public.prayer_requests set is_anonymous = true where id = 'aaaa0000-0000-0000-0000-0000000000a1'$q$),
  'rows:1', 'a leader''s edit that leaves is_anonymous unchanged goes through');

select is(
  pg_temp.attempt('zoe.dummyfield@example.test', route.sql),
  expected, route.what)
from (values
  ('a leader cannot take over a request by setting author_id',
   $q$update public.prayer_requests set author_id = auth.uid() where id = 'aaaa0000-0000-0000-0000-0000000000a1'$q$, '42501'),
  ('a leader cannot take over a request through an upsert',
   $q$insert into public.prayer_requests (id, author_id, group_id, body) values ('aaaa0000-0000-0000-0000-0000000000a1', auth.uid(), 'c0000000-0000-0000-0000-00000000000b', 'u') on conflict (id) do update set author_id = excluded.author_id$q$, '42501'),
  ('a leader cannot probe the author through an upsert condition',
   $q$insert into public.prayer_requests (id, author_id, group_id, body) values ('aaaa0000-0000-0000-0000-0000000000a1', auth.uid(), 'c0000000-0000-0000-0000-00000000000b', 'u') on conflict (id) do update set body = 'probe' where public.prayer_requests.author_id = auth.uid()$q$, '42501')
) route(what, sql, expected);
select is(
  pg_temp.attempt('leo.loremsworth@example.test', format(
    $q$insert into public.prayer_requests (author_id, group_id, body) values ('%s', 'c0000000-0000-0000-0000-00000000000b', 'forged')$q$,
    pg_temp.uid('isaac.seedly@example.test'))),
  '42501', 'a member cannot post in someone else''s name');

-- A foreign key names the constraint it trips, so without a guard the error
-- from changing a person's id says whether that person has written a request.
select is(
  pg_temp.attempt_text('admin@local.dev', $q$update public.profiles set id = '11111111-1111-1111-1111-111111111111' where email = 'isaac.seedly@example.test'$q$),
  pg_temp.attempt_text('admin@local.dev', $q$update public.profiles set id = '11111111-1111-1111-1111-111111111111' where email = 'ruth.fixtureton@example.test'$q$),
  'changing a person''s id fails identically whether or not they wrote a request');
select unalike(
  pg_temp.attempt_text('admin@local.dev', $q$update public.profiles set id = '11111111-1111-1111-1111-111111111111' where email = 'isaac.seedly@example.test'$q$),
  '%prayer_requests%', 'the refusal does not mention prayer requests');
select is(
  pg_temp.attempt('admin@local.dev', $q$update public.profiles set id = id where email = 'isaac.seedly@example.test'$q$),
  'rows:1', 'an edit that leaves the id unchanged goes through');
select is(
  pg_temp.attempt_text('admin@local.dev', format($q$update public.profiles set org_id = '%s' where email = 'isaac.seedly@example.test'$q$, current_setting('pa.other_org'))),
  pg_temp.attempt_text('admin@local.dev', format($q$update public.profiles set org_id = '%s' where email = 'leo.loremsworth@example.test'$q$, current_setting('pa.other_org'))),
  'moving a person to another church fails on row security, not on the foreign key');
select is(
  pg_temp.attempt('admin@local.dev', $q$delete from public.profiles where email = 'isaac.seedly@example.test'$q$),
  'rows:0', 'a church admin cannot delete a person, so the cascade is not an oracle');
select is(
  (select count(*)::int from public.prayer_requests where author_id = pg_temp.uid('isaac.seedly@example.test')) > 0,
  true, 'the author''s requests remain');

select is(
  pg_temp.attempt_text('zoe.dummyfield@example.test', $q$update public.prayer_requests set body = '' where id = 'aaaa0000-0000-0000-0000-0000000000a1'$q$),
  '23514:new row for relation "prayer_requests" violates check constraint "prayer_requests_body_check":',
  'a check violation names no author in its detail');
select is(
  pg_temp.attempt_text('leo.loremsworth@example.test', $q$insert into public.prayer_requests (id, author_id, group_id, body) values ('aaaa0000-0000-0000-0000-0000000000a1', auth.uid(), 'c0000000-0000-0000-0000-00000000000b', 'dup')$q$),
  '23505:duplicate key value violates unique constraint "prayer_requests_pkey":',
  'a duplicate id names no author in its detail');

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

-- ── Switching ───────────────────────────────────────────────────────────────
select is(
  pg_temp.attempt('isaac.seedly@example.test', $q$update public.prayer_requests set is_anonymous = false where id = 'aaaa0000-0000-0000-0000-0000000000e1'$q$),
  'rows:1', 'the author makes an anonymous request by name');
select is(
  pg_temp.val('leo.loremsworth@example.test', $q$select concat_ws('|', mine::text, first_name) from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000e1'$q$),
  'false|Isaac', 'a member sees the name once the author shares it');
select is(
  pg_temp.val('leo.loremsworth@example.test', $q$select concat_ws('|', mine::text, first_name) from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000a1'$q$),
  'false', 'the author''s other anonymous request stays anonymous');
select is(
  pg_temp.attempt('isaac.seedly@example.test', $q$update public.prayer_requests set is_anonymous = true where id = 'aaaa0000-0000-0000-0000-0000000000e1'$q$),
  'rows:1', 'the author makes the by-name request anonymous');
select is(
  pg_temp.val('leo.loremsworth@example.test', $q$select concat_ws('|', mine::text, first_name) from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000e1'$q$),
  'false', 'a member no longer sees the name');
select is(
  pg_temp.val('leo.loremsworth@example.test', $q$select public.prayer_request_visible_author('aaaa0000-0000-0000-0000-0000000000e1')$q$),
  '<null>', 'the helper no longer returns the author');
select is(
  pg_temp.val('isaac.seedly@example.test', $q$select concat_ws('|', mine::text, first_name) from public.prayer_wall where id = 'aaaa0000-0000-0000-0000-0000000000e1'$q$),
  'true|Isaac', 'the author still sees it as theirs');

-- ── The author keeps their own request ──────────────────────────────────────
select is(
  pg_temp.attempt('isaac.seedly@example.test', sql), 'rows:1', 'the author can ' || what)
from (values
  ('edit the body', $q$update public.prayer_requests set body = 'mine' where id = 'aaaa0000-0000-0000-0000-0000000000e1'$q$),
  ('mark it answered', $q$update public.prayer_requests set is_answered = true where id = 'aaaa0000-0000-0000-0000-0000000000e1' returning id$q$),
  ('delete it', $q$delete from public.prayer_requests where id = 'aaaa0000-0000-0000-0000-0000000000e1' returning id$q$)
) w(what, sql);

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

select * from finish();
rollback;
