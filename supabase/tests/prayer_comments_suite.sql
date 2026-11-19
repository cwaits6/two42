-- Prayer comments suite: comment text is sealed by the server, and who may read
-- a comment depends on keyed hashes only the server can compute, so no client
-- role reaches prayer_comments at all, for either choice on a comment. The
-- server's rules (who sees a private comment, who may delete one) are proven in
-- lib/prayer/commentThread.test.ts and the comment route tests; this suite
-- proves the database refuses every client, the shape the server relies on,
-- the church boundary, and what deleting a request or a person removes.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/prayer_comments_suite.sql
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

-- rows:<n> or the SQLSTATE, as postgres (the service key's view).
create function pg_temp.run(_sql text) returns text language plpgsql as $$
declare n bigint;
begin
  execute _sql;
  get diagnostics n = row_count;
  return 'rows:' || n;
exception when others then
  return sqlstate;
end $$;

create function pg_temp.new_person(_org uuid, _email text) returns uuid language plpgsql as $$
declare _id uuid := gen_random_uuid();
begin
  insert into public.access_requests (org_id, name, email, status, approved_role, reviewed_at)
    values (_org, _email, _email, 'approved', 'member', now());
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', _email,
            'x', jsonb_build_object('org_id', _org), '{}', now(), now());
  return _id;
end $$;

create temp table fx (key text primary key, id uuid) on commit drop;
create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;
create function pg_temp.c(_n int) returns uuid language sql immutable as $$
  select ('c5000000-0000-4000-8000-' || lpad(_n::text, 12, '0'))::uuid;
$$;
create function pg_temp.left_(_n int) returns int language sql stable as $$
  select count(*)::int from public.prayer_comments where id = pg_temp.c(_n);
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Zoe's by-name request in Group B, which she leads; Leo and Isaac are members
-- of it and the church admin a plain member.
select is(
  (select p.email from public.prayer_requests r join public.profiles p on p.id = r.author_id
    where r.id = 'b1000000-0000-0000-0000-000000000001'),
  'zoe.dummyfield@example.test',
  'non-vacuity: the seeded request is Zoe''s');
select is(
  (select array_agg(p.email || '/' || gm.role order by p.email)
     from public.group_members gm join public.profiles p on p.id = gm.profile_id
    where gm.group_id = 'c0000000-0000-0000-0000-00000000000b'
      and p.email in ('admin@local.dev', 'isaac.seedly@example.test',
                      'leo.loremsworth@example.test', 'zoe.dummyfield@example.test')),
  array['admin@local.dev/member', 'isaac.seedly@example.test/member',
        'leo.loremsworth@example.test/member', 'zoe.dummyfield@example.test/leader'],
  'non-vacuity: the writer, member, leader and church admin are in Group B');

insert into fx select 'org', org_id from public.prayer_requests
  where id = 'b1000000-0000-0000-0000-000000000001';
insert into fx values ('request', 'b1000000-0000-0000-0000-000000000001');

-- One comment for each pair of choices.
insert into public.prayer_comments (id, org_id, request_id, writer_id, writer_hash, body_ciphertext, only_asker, hide_name)
values
  (pg_temp.c(1), pg_temp.fx('org'), pg_temp.fx('request'), pg_temp.uid('leo.loremsworth@example.test'), null, 'v1.k.a.b', false, false),
  (pg_temp.c(2), pg_temp.fx('org'), pg_temp.fx('request'), pg_temp.uid('leo.loremsworth@example.test'), null, 'v1.k.a.b', true, false),
  (pg_temp.c(3), pg_temp.fx('org'), pg_temp.fx('request'), null, 'h1.k.leo', 'v1.k.a.b', false, true),
  (pg_temp.c(4), pg_temp.fx('org'), pg_temp.fx('request'), null, 'h1.k.leo', 'v1.k.a.b', true, true);
select is((select count(*)::int from public.prayer_comments where request_id = pg_temp.fx('request')), 4,
  'non-vacuity: four comments, one for each pair of choices');

-- ── No client reads a comment ───────────────────────────────────────────────
select is(
  (select array_agg(t.who || ':' || pg_temp.attempt(nullif(t.who, 'anon'), t.q) order by t.who, t.q)
     from (values ('leo.loremsworth@example.test'), ('zoe.dummyfield@example.test'),
                  ('isaac.seedly@example.test'), ('admin@local.dev'), ('anon')) w(who)
     cross join lateral (values
       ('select count(*) from public.prayer_comments'),
       (format('select * from public.prayer_comments where id = %L', pg_temp.c(1))),
       (format('select * from public.prayer_comments where id = %L', pg_temp.c(2))),
       (format('select * from public.prayer_comments where id = %L', pg_temp.c(3))),
       (format('select * from public.prayer_comments where id = %L', pg_temp.c(4))),
       ('select body_ciphertext, writer_hash from public.prayer_comments where only_asker')
     ) q(q)
     cross join lateral (select w.who, q.q) t),
  (select array_agg(t.who || ':42501' order by t.who, t.q)
     from (values ('leo.loremsworth@example.test'), ('zoe.dummyfield@example.test'),
                  ('isaac.seedly@example.test'), ('admin@local.dev'), ('anon')) w(who)
     cross join lateral (values
       ('select count(*) from public.prayer_comments'),
       (format('select * from public.prayer_comments where id = %L', pg_temp.c(1))),
       (format('select * from public.prayer_comments where id = %L', pg_temp.c(2))),
       (format('select * from public.prayer_comments where id = %L', pg_temp.c(3))),
       (format('select * from public.prayer_comments where id = %L', pg_temp.c(4))),
       ('select body_ciphertext, writer_hash from public.prayer_comments where only_asker')
     ) q(q)
     cross join lateral (select w.who, q.q) t),
  'the writer, the asker and leader, another member, the church admin and anon are each refused every read, group or private, named or hidden');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'prayer_comments'
      and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0,
  'no client role holds any privilege on prayer_comments');

-- ── No client writes a comment ──────────────────────────────────────────────
select is(
  (select array_agg(pg_temp.attempt(w.who, format(
      'insert into public.prayer_comments (id, org_id, request_id, writer_id, writer_hash, body_ciphertext, only_asker, hide_name) values (gen_random_uuid(), %L, %L, %s, %s, %L, %L, %L)',
      pg_temp.fx('org'), pg_temp.fx('request'),
      case when c.hide then 'null' else quote_literal(pg_temp.uid(w.who)) end,
      case when c.hide then quote_literal('h1.k.x') else 'null' end,
      'Plain text the server never sealed', c.private::text, c.hide::text)) order by w.who, c.private, c.hide)
     from (values ('leo.loremsworth@example.test'), ('zoe.dummyfield@example.test')) w(who)
     cross join (values (false, false), (true, false), (false, true), (true, true)) c(private, hide)),
  array_fill('42501'::text, array[8]),
  'a member and a leader are refused an insert with either choice, on or off');
select is(
  (select array_agg(pg_temp.attempt(w.who, q.q) order by w.who, q.q)
     from (values ('leo.loremsworth@example.test'), ('zoe.dummyfield@example.test'), ('admin@local.dev')) w(who)
     cross join (values
       (format('update public.prayer_comments set only_asker = false where id = %L', pg_temp.c(2))),
       (format('update public.prayer_comments set hide_name = false, writer_hash = null where id = %L', pg_temp.c(3))),
       (format('delete from public.prayer_comments where id = %L', pg_temp.c(1))),
       (format('delete from public.prayer_comments where id = %L', pg_temp.c(4)))) q(q)),
  array_fill('42501'::text, array[12]),
  'the writer, the asker and leader, and the church admin are refused every update and delete');
select is(pg_temp.attempt(null, format('delete from public.prayer_comments where id = %L', pg_temp.c(1))), '42501',
  'anon is refused a delete');
select is((select count(*)::int from public.prayer_comments where request_id = pg_temp.fx('request')), 4,
  'every comment is still there after the refused writes');

-- ── Shape ───────────────────────────────────────────────────────────────────
select is(pg_temp.run(format(
  'insert into public.prayer_comments (id, org_id, request_id, writer_id, writer_hash, body_ciphertext, hide_name) values (gen_random_uuid(), %L, %L, %L, %L, %L, true)',
  pg_temp.fx('org'), pg_temp.fx('request'), pg_temp.uid('leo.loremsworth@example.test'), 'h1.k.x', 'v1.k.a.b')),
  '23514', 'a hidden-name comment cannot also store its writer');
select is(pg_temp.run(format(
  'insert into public.prayer_comments (id, org_id, request_id, body_ciphertext, hide_name) values (gen_random_uuid(), %L, %L, %L, true)',
  pg_temp.fx('org'), pg_temp.fx('request'), 'v1.k.a.b')),
  '23514', 'a hidden-name comment needs its writer hash');
select is(pg_temp.run(format(
  'insert into public.prayer_comments (id, org_id, request_id, writer_hash, body_ciphertext) values (gen_random_uuid(), %L, %L, %L, %L)',
  pg_temp.fx('org'), pg_temp.fx('request'), 'h1.k.x', 'v1.k.a.b')),
  '23514', 'a named comment cannot carry a writer hash in place of its writer');
select is(pg_temp.run(format(
  'insert into public.prayer_comments (id, org_id, request_id, writer_id, body_ciphertext) values (gen_random_uuid(), %L, %L, %L, null)',
  pg_temp.fx('org'), pg_temp.fx('request'), pg_temp.uid('leo.loremsworth@example.test'))),
  '23502', 'a comment needs sealed text');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'prayer_comments' and column_name in ('body', 'writer_name')),
  0, 'there is no plaintext column');

insert into public.prayer_comments (id, org_id, request_id, writer_id, body_ciphertext)
  values (pg_temp.c(5), pg_temp.fx('org'), pg_temp.fx('request'), pg_temp.uid('leo.loremsworth@example.test'), 'v1.k.a.b');
select is((select only_asker::text || '/' || hide_name::text from public.prayer_comments where id = pg_temp.c(5)),
  'false/false', 'a comment is for the group and named unless chosen otherwise');

select set_config('request.jwt.claims', '', true);
select is(pg_temp.run(format(
  'insert into public.prayer_comments (id, request_id, writer_id, body_ciphertext) values (gen_random_uuid(), %L, %L, %L)',
  pg_temp.fx('request'), pg_temp.uid('leo.loremsworth@example.test'), 'v1.k.a.b')),
  '23502', 'with no principal the org_id default resolves nothing and the insert fails');

-- ── Church boundary ─────────────────────────────────────────────────────────
do $$
declare
  _other uuid := gen_random_uuid();
  _group uuid := gen_random_uuid();
  _request uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name) values (_other, 'Comment Boundary Church');
  insert into public.groups (id, org_id, name) values (_group, _other, 'Elsewhere');
  insert into fx values ('other_org', _other), ('other_group', _group);
  insert into fx values ('outsider', pg_temp.new_person(_other, 'outsider@comments.test'));
  insert into public.prayer_requests (id, org_id, group_id, author_id, body, is_anonymous)
    values (_request, _other, _group, pg_temp.fx('outsider'), 'Elsewhere', false);
  insert into fx values ('other_request', _request);
end $$;

select is(pg_temp.run(format(
  'insert into public.prayer_comments (id, org_id, request_id, writer_id, body_ciphertext) values (gen_random_uuid(), %L, %L, %L, %L)',
  pg_temp.fx('other_org'), pg_temp.fx('request'), pg_temp.fx('outsider'), 'v1.k.a.b')),
  '23503', 'a comment in one church cannot hang off another church''s request');
select is(pg_temp.run(format(
  'insert into public.prayer_comments (id, org_id, request_id, writer_id, body_ciphertext) values (gen_random_uuid(), %L, %L, %L, %L)',
  pg_temp.fx('org'), pg_temp.fx('request'), pg_temp.fx('outsider'), 'v1.k.a.b')),
  '23503', 'a named comment cannot name a writer from another church');
select is(
  (select array_agg(policyname || '/' || permissive || '/' || qual order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'prayer_comments'),
  array['org isolation/RESTRICTIVE/(org_id = ( SELECT app_request_org_id() AS app_request_org_id))'],
  'the restrictive org isolation policy is the only policy on prayer_comments');

-- ── Deleting a request or a person ──────────────────────────────────────────
insert into public.prayer_requests (id, org_id, group_id, author_id, body, is_anonymous)
  values ('b5000000-0000-4000-8000-000000000001', pg_temp.fx('org'), 'c0000000-0000-0000-0000-00000000000b',
          pg_temp.uid('isaac.seedly@example.test'), 'Short-lived', false);
insert into public.prayer_comments (id, org_id, request_id, writer_id, body_ciphertext)
  values (pg_temp.c(6), pg_temp.fx('org'), 'b5000000-0000-4000-8000-000000000001',
          pg_temp.uid('leo.loremsworth@example.test'), 'v1.k.a.b');
select is(pg_temp.run($$delete from public.prayer_requests where id = 'b5000000-0000-4000-8000-000000000001'$$),
  'rows:1', 'the request is deleted');
select is(pg_temp.left_(6), 0, 'deleting a request removes its comments');

-- A church of its own, so deleting people touches nothing seeded.
do $$
declare
  _org uuid := gen_random_uuid();
  _group uuid := gen_random_uuid();
  _request uuid := 'b5000000-0000-4000-8000-000000000002';
begin
  insert into public.organizations (id, name) values (_org, 'Comment Deletion Church');
  insert into public.groups (id, org_id, name) values (_group, _org, 'Deletion Group');
  insert into fx values ('del_org', _org);
  insert into fx values ('asker', pg_temp.new_person(_org, 'asker@comments.test')),
                        ('writer', pg_temp.new_person(_org, 'writer@comments.test')),
                        ('other', pg_temp.new_person(_org, 'other@comments.test'));
  insert into public.prayer_requests (id, org_id, group_id, author_id, body, is_anonymous)
    values (_request, _org, _group, pg_temp.fx('asker'), 'Stays', false);
  insert into public.prayer_comments (id, org_id, request_id, writer_id, writer_hash, body_ciphertext, hide_name)
  values
    (pg_temp.c(10), _org, _request, pg_temp.fx('writer'), null, 'v1.k.a.b', false),
    (pg_temp.c(11), _org, _request, null, 'h1.k.writer', 'v1.k.a.b', true),
    (pg_temp.c(12), _org, _request, null, 'h1.k.other', 'v1.k.a.b', true),
    (pg_temp.c(13), _org, _request, pg_temp.fx('other'), null, 'v1.k.a.b', false);
  -- Another church's hidden-name comment, passed in by mistake.
  insert into public.prayer_comments (id, org_id, request_id, writer_hash, body_ciphertext, hide_name)
    values (pg_temp.c(14), pg_temp.fx('other_org'), pg_temp.fx('other_request'), 'h1.k.far', 'v1.k.a.b', true);
end $$;

select lives_ok(
  format($$select public.delete_person(%L, %L, '{}', array[%L, %L, %L]::uuid[])$$,
         pg_temp.fx('writer'), pg_temp.fx('del_org'), pg_temp.c(11), pg_temp.c(13), pg_temp.c(14)),
  'delete_person takes the hidden-name comment ids');
select is(pg_temp.left_(10), 0, 'their named comment goes with their profile');
select is(pg_temp.left_(11), 0, 'their hidden-name comment, passed in, is deleted');
select is(pg_temp.left_(12), 1, 'someone else''s hidden-name comment, not passed in, stays');
select is(pg_temp.left_(13), 1, 'a named comment by someone else, passed in, stays');
select is(pg_temp.left_(14), 1, 'another church''s hidden-name comment, passed in, stays');

select lives_ok(
  format($$select public.delete_person(_person_id => %L, _org_id => %L, _anonymous_request_ids => '{}')$$,
         pg_temp.fx('other'), pg_temp.fx('del_org')),
  'the three-argument call still resolves');
select is(pg_temp.left_(13), 0, 'and removes that person''s named comment');
select is(pg_temp.left_(12), 1, 'without touching hidden-name comments it was not given');

select lives_ok(
  format($$select public.delete_person(%L, %L)$$, pg_temp.fx('asker'), pg_temp.fx('del_org')),
  'deleting the person who asked');
select is(pg_temp.left_(12), 0, 'removes their request, and every comment on it with it');

select * from finish();
rollback;
