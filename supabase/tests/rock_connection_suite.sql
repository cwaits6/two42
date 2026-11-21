-- Rock connection suite: a church's Rock key is sealed by the server and the
-- links are confirmed through server code that checks the caller is a church
-- admin, so no client role reaches rock_connections or rock_person_links at
-- all. The server's rules (who may link, what a suggestion shows) are proven
-- in the route tests under app/api/admin/rock; this suite proves the database
-- refuses every client, the shape the server relies on, the church boundary,
-- and what disconnecting or deleting a person removes.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/rock_connection_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.uid(_email text) returns uuid language sql stable as $$
  select id from public.profiles where email = _email;
$$;

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

create temp table fx (key text primary key, id uuid) on commit drop;
grant select on fx to anon, authenticated;
create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into fx select 'org', org_id from public.profiles where email = 'admin@local.dev';
insert into fx values ('admin', pg_temp.uid('admin@local.dev'));
insert into fx values ('member', pg_temp.uid('leo.loremsworth@example.test'));
insert into fx values ('member2', pg_temp.uid('isaac.seedly@example.test'));

select is(
  (select array_agg(p.role order by p.email) from public.profiles p
    where p.id in (pg_temp.fx('admin'), pg_temp.fx('member'), pg_temp.fx('member2'))
      and p.org_id = pg_temp.fx('org')),
  array['admin', 'member', 'member'],
  'non-vacuity: a church admin and two members of one church');

insert into public.rock_connections (org_id, base_url, key_ciphertext, key_hint, connected_by)
  values (pg_temp.fx('org'), 'https://rock.example.org', 'r1.kid.iv.sealed', '9012', pg_temp.fx('admin'));
insert into public.rock_person_links (org_id, profile_id, rock_person_id, linked_by)
  values (pg_temp.fx('org'), pg_temp.fx('member'), 100, pg_temp.fx('admin'));

-- ── No client reaches either table ──────────────────────────────────────────
select is(
  (select array_agg(distinct pg_temp.attempt(w.who, q.q))
     from (values ('admin@local.dev'), ('leo.loremsworth@example.test'), (null)) w(who)
     cross join (values
       ('select * from public.rock_connections'),
       ('select key_ciphertext from public.rock_connections'),
       ('select * from public.rock_person_links'),
       (format('insert into public.rock_person_links (org_id, profile_id, rock_person_id) values (%L, %L, 200)',
               pg_temp.fx('org'), pg_temp.fx('member2'))),
       (format('update public.rock_connections set base_url = %L', 'https://evil.example')),
       ('delete from public.rock_person_links'),
       ('delete from public.rock_connections')
     ) q(q)),
  array['42501'],
  'the church admin, a member and anon are each refused every read and write on both tables');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('rock_connections', 'rock_person_links')
      and grantee in ('anon', 'authenticated')),
  0, 'anon and authenticated hold no privilege on either table');

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.rock_connections'::regclass, 'public.rock_person_links'::regclass)),
  'row level security is on for both tables');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('rock_connections', 'rock_person_links')
      and policyname = 'org isolation' and permissive = 'RESTRICTIVE'),
  2, 'both tables carry the restrictive org isolation policy');

-- ── Shape the server relies on ──────────────────────────────────────────────
select is(
  pg_temp.run(format('insert into public.rock_connections (org_id, base_url, key_ciphertext, key_hint) values (%L, %L, %L, %L)',
    pg_temp.fx('org'), 'https://second.example.org', 'x', '1234')),
  '23505', 'a church has one Rock connection');

select is(
  (select array_agg(pg_temp.run(format(
     'update public.rock_connections set base_url = %L where org_id = %L', u, pg_temp.fx('org')))
     order by u)
   from unnest(array['http://rock.example.org', 'https://rock.example.org/api', 'https://user@rock.example.org']) u),
  array['23514', '23514', '23514'],
  'the address is stored only as an https origin');

select is(
  pg_temp.run(format('update public.rock_connections set key_hint = %L where org_id = %L', 'whole-key', pg_temp.fx('org'))),
  '23514', 'the key hint holds at most four characters');

select is(
  pg_temp.run(format('insert into public.rock_person_links (org_id, profile_id, rock_person_id) values (%L, %L, 101)',
    pg_temp.fx('org'), pg_temp.fx('member'))),
  '23505', 'a profile links to one Rock person');

select is(
  pg_temp.run(format('insert into public.rock_person_links (org_id, profile_id, rock_person_id) values (%L, %L, 100)',
    pg_temp.fx('org'), pg_temp.fx('member2'))),
  '23505', 'a Rock person links to one profile');

select is(
  pg_temp.run(format('insert into public.rock_person_links (org_id, profile_id, rock_person_id) values (%L, %L, 0)',
    pg_temp.fx('org'), pg_temp.fx('member2'))),
  '23514', 'a Rock person id is positive');

-- ── Church boundary ─────────────────────────────────────────────────────────
do $$
declare _other uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name) values (_other, 'Rock Boundary Church');
  insert into fx values ('other_org', _other);
end $$;

select is(
  pg_temp.run(format('insert into public.rock_person_links (org_id, profile_id, rock_person_id) values (%L, %L, 300)',
    pg_temp.fx('other_org'), pg_temp.fx('member2'))),
  '23503', 'a church without a Rock connection can''t hold links');

insert into public.rock_connections (org_id, base_url, key_ciphertext, key_hint)
  values (pg_temp.fx('other_org'), 'https://rock.other.example', 'r1.kid.iv.other', 'abcd');

select is(
  pg_temp.run(format('insert into public.rock_person_links (org_id, profile_id, rock_person_id) values (%L, %L, 300)',
    pg_temp.fx('other_org'), pg_temp.fx('member2'))),
  '23503', 'another church can''t link a profile from this one');

select is(
  pg_temp.run(format('update public.rock_connections set connected_by = %L where org_id = %L',
    pg_temp.fx('admin'), pg_temp.fx('other_org'))),
  '23503', 'a connection can''t name a church admin from another church');

-- ── What goes with what ─────────────────────────────────────────────────────
insert into public.rock_person_links (org_id, profile_id, rock_person_id)
  values (pg_temp.fx('org'), pg_temp.fx('member2'), 101);

delete from public.profiles where id = pg_temp.fx('member2');
select is(
  (select count(*)::int from public.rock_person_links where org_id = pg_temp.fx('org')),
  1, 'deleting a person removes their link and no other');

delete from public.rock_connections where org_id = pg_temp.fx('org');
select is(
  (select count(*)::int from public.rock_person_links where org_id = pg_temp.fx('org')),
  0, 'disconnecting removes every link of the church');
select is(
  (select count(*)::int from public.profiles where id = pg_temp.fx('member')),
  1, 'disconnecting leaves the linked profile in place');
select is(
  (select count(*)::int from public.rock_connections where org_id = pg_temp.fx('other_org')),
  1, 'disconnecting one church leaves another church''s connection');

select * from finish();
rollback;
