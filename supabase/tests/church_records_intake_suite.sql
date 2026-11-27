-- Church records sending new people: the church's setting with its write key,
-- and each person's consent and once-only send. Proves the church boundary on
-- both tables, that no client role reads or writes them, that nothing is
-- stored while sending is off, that a linked person is never claimed, and
-- that a person is claimed at most once.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/church_records_intake_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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

create temp table fx (key text primary key, id uuid) on commit drop;
grant select on fx to anon, authenticated, service_role;
create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;

create function pg_temp.requests(_org uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(p.email || ':' || r.state order by p.email), '{}')
    from public.records_intake_requests r join public.profiles p on p.id = r.profile_id
   where r.org_id = _org;
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into fx select 'org', org_id from public.profiles where email = 'admin@local.dev';
insert into fx values ('admin', pg_temp.uid('admin@local.dev'));
insert into fx values ('member', pg_temp.uid('leo.loremsworth@example.test'));
insert into fx values ('member2', pg_temp.uid('isaac.seedly@example.test'));

do $$
declare
  _other uuid;
  _owner uuid := gen_random_uuid();
begin
  _other := public.provision_organization('Intake Boundary Church', 'owner@intake-boundary.example.test');
  insert into public.access_requests (org_id, name, email, status)
    values (_other, 'Intake Owner', 'owner@intake-boundary.example.test', 'approved');
  insert into auth.users (id, email) values (_owner, 'owner@intake-boundary.example.test');
  update public.profiles set role = 'admin' where id = _owner;
  insert into fx values ('other_org', _other), ('other_admin', _owner);
end $$;

select is(
  (select array_agg(p.role || ':' || (p.org_id = pg_temp.fx('org'))::text order by p.email) from public.profiles p
    where p.id in (pg_temp.fx('admin'), pg_temp.fx('member'), pg_temp.fx('member2'), pg_temp.fx('other_admin'))),
  array['admin:true', 'member:true', 'member:true', 'admin:false'],
  'non-vacuity: a church admin and two members of one church, and a church admin of another');

insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint, connected_by)
  values (pg_temp.fx('org'), 'rock', 'https://rock.example.org', 'k1.kid.iv.sealed', '9012', pg_temp.fx('admin')),
         (pg_temp.fx('other_org'), 'rock', 'https://rock.other.example.org', 'k1.kid.iv.other', '3456', pg_temp.fx('other_admin'));
insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
  select org_id, connection_id, pg_temp.fx('member2'), '101' from public.records_connections where org_id = pg_temp.fx('org');

-- ── With sending off, nothing is stored ─────────────────────────────────────
select is(
  array[
    public.records_intake_consent(pg_temp.fx('org'), pg_temp.fx('member')),
    public.records_intake_claim(pg_temp.fx('org'), pg_temp.fx('member'))
  ],
  array['off', 'off'],
  'with sending off, consent and claim both answer off');

select is(
  (select count(*)::int from public.records_intake_requests),
  0, 'with sending off, no consent or send is stored for anyone');

-- ── The boundary on both tables ─────────────────────────────────────────────
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.records_intake_settings'::regclass, 'public.records_intake_requests'::regclass)),
  'row level security is on for both tables');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('records_intake_settings', 'records_intake_requests')
      and policyname = 'org isolation' and permissive = 'RESTRICTIVE'),
  2, 'both tables carry the restrictive org isolation policy');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('records_intake_settings', 'records_intake_requests')
      and grantee in ('anon', 'authenticated')),
  0, 'anon and authenticated hold no privilege on either table');

insert into public.records_intake_settings (org_id, connection_id, key_ciphertext, key_hint, destination_id, destination_name, enabled_by)
  select org_id, connection_id, 'k1.kid.iv.write', '1234', '42', 'New people from two42', pg_temp.fx('admin')
    from public.records_connections where org_id = pg_temp.fx('org');
insert into public.records_intake_settings (org_id, connection_id, key_ciphertext, key_hint, destination_id, destination_name)
  select org_id, connection_id, 'k1.kid.iv.otherwrite', '7890', '77', 'Other church intake'
    from public.records_connections where org_id = pg_temp.fx('other_org');
insert into public.records_intake_requests (org_id, profile_id, state, finished_at)
  values (pg_temp.fx('other_org'), pg_temp.fx('other_admin'), 'sent', now());

select is(
  (select array_agg(distinct pg_temp.attempt(w.who, q.q))
     from (values ('admin@local.dev'), ('leo.loremsworth@example.test'), (null)) w(who)
     cross join (values
       ('select * from public.records_intake_settings'),
       ('select * from public.records_intake_requests'),
       ('update public.records_intake_settings set destination_id = ''1'''),
       ('delete from public.records_intake_settings'),
       ('delete from public.records_intake_requests'),
       (format('insert into public.records_intake_requests (org_id, profile_id, state) values (%L, %L, %L)',
               pg_temp.fx('org'), pg_temp.fx('member'), 'consented'))
     ) q(q)),
  array['42501'],
  'a church admin, a member and an anonymous request are each refused every read and write');

select is(
  (select array_agg(distinct pg_temp.attempt(w.who, q.q))
     from (values ('admin@local.dev'), ('leo.loremsworth@example.test')) w(who)
     cross join (values
       (format('select public.records_intake_consent(%L, %L)', pg_temp.fx('org'), pg_temp.fx('member'))),
       (format('select public.records_intake_claim(%L, %L)', pg_temp.fx('org'), pg_temp.fx('member')))
     ) q(q)),
  array['42501'],
  'neither function is executable by a signed-in person');

select is(
  array[
    has_function_privilege('anon', 'public.records_intake_consent(uuid, uuid)', 'execute'),
    has_function_privilege('anon', 'public.records_intake_claim(uuid, uuid)', 'execute'),
    has_function_privilege('authenticated', 'public.records_intake_consent(uuid, uuid)', 'execute'),
    has_function_privilege('authenticated', 'public.records_intake_claim(uuid, uuid)', 'execute'),
    has_function_privilege('service_role', 'public.records_intake_consent(uuid, uuid)', 'execute'),
    has_function_privilege('service_role', 'public.records_intake_claim(uuid, uuid)', 'execute')
  ],
  array[false, false, false, false, true, true],
  'only the service role executes the functions');

select throws_ok(
  format('insert into public.records_intake_requests (org_id, profile_id, state) values (%L, %L, %L)',
         pg_temp.fx('org'), pg_temp.fx('other_admin'), 'consented'),
  '23503', null, 'a request can''t name a profile of another church');

select throws_ok(
  format('select public.records_intake_consent(%L, %L)', pg_temp.fx('org'), pg_temp.fx('other_admin')),
  '23503', null, 'consent can''t be recorded under one church for a person of another');

select throws_ok(
  format($q$insert into public.records_intake_settings (org_id, connection_id, key_ciphertext, key_hint, destination_id, destination_name)
            select %L, connection_id, 'x', '1', '1', 'x' from public.records_connections where org_id = %L$q$,
         gen_random_uuid(), pg_temp.fx('org')),
  '23503', null, 'a setting can''t name another church''s connection');

select throws_ok(
  format('insert into public.records_intake_requests (org_id, profile_id, state) values (%L, %L, %L)',
         pg_temp.fx('org'), pg_temp.fx('admin'), 'failed'),
  '23514', null, 'a failed send must say why');

-- ── Consent and claim ───────────────────────────────────────────────────────
select is(
  public.records_intake_consent(pg_temp.fx('org'), pg_temp.fx('member')),
  'saved', 'with sending on, an unlinked person''s consent is saved');

select is(
  public.records_intake_consent(pg_temp.fx('org'), pg_temp.fx('member2')),
  'linked', 'a linked person''s consent is refused');

select is(
  pg_temp.requests(pg_temp.fx('org')),
  array['leo.loremsworth@example.test:consented'],
  'only the unlinked person''s consent is stored');

select is(
  array[
    public.records_intake_claim(pg_temp.fx('org'), pg_temp.fx('member')),
    public.records_intake_claim(pg_temp.fx('org'), pg_temp.fx('member')),
    public.records_intake_consent(pg_temp.fx('org'), pg_temp.fx('member'))
  ],
  array['claimed', 'already', 'saved'],
  'the first claim takes the send, a second gets already, and a later consent changes nothing');

select is(
  pg_temp.requests(pg_temp.fx('org')),
  array['leo.loremsworth@example.test:sending'],
  'the claimed send stays claimed');

select is(
  public.records_intake_claim(pg_temp.fx('org'), pg_temp.fx('member2')),
  'linked', 'a linked person is never claimed');

select is(
  public.records_intake_claim(pg_temp.fx('org'), pg_temp.fx('admin')),
  'claimed', 'a person who didn''t tick the box at sign-up can be claimed from profile setup');

update public.records_intake_requests set state = 'failed', failure = 'unauthorized', finished_at = now()
 where org_id = pg_temp.fx('org') and profile_id = pg_temp.fx('admin');

select is(
  public.records_intake_claim(pg_temp.fx('org'), pg_temp.fx('admin')),
  'already', 'a failed send is never claimed again');

-- ── Turning sending off ─────────────────────────────────────────────────────
update public.records_intake_requests set state = 'consented'
 where org_id = pg_temp.fx('org') and profile_id = pg_temp.fx('member');
delete from public.records_intake_settings where org_id = pg_temp.fx('org');

select is(
  pg_temp.requests(pg_temp.fx('org')),
  array['admin@local.dev:failed'],
  'turning sending off drops the consents not yet sent and keeps the sends');

select is(
  pg_temp.requests(pg_temp.fx('other_org')),
  array['owner@intake-boundary.example.test:sent'],
  'and leaves another church''s rows alone');

delete from public.records_connections where org_id = pg_temp.fx('other_org');

select is(
  (select count(*)::int from public.records_intake_settings where org_id = pg_temp.fx('other_org')),
  0, 'disconnecting removes the church''s setting and its write key');

select * from finish();
rollback;
