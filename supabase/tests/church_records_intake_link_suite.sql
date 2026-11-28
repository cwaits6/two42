-- Church records sending new people, once a person is linked: linking someone
-- drops the consent they gave that hasn't been sent, so nothing waits for them
-- and nothing is sent. A send already claimed, sent or failed, and a
-- withdrawal, stay as they are. Proves the cleanup stays inside the link's
-- church, and that no client role can call it.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/church_records_intake_link_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.uid(_email text) returns uuid language sql stable as $$
  select id from public.profiles where email = _email;
$$;

create temp table fx (key text primary key, id uuid) on commit drop;
create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;

create function pg_temp.requests(_org uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(p.email || ':' || r.state order by p.email), '{}')
    from public.records_intake_requests r join public.profiles p on p.id = r.profile_id
   where r.org_id = _org;
$$;

create function pg_temp.link(_org uuid, _profile uuid, _person text) returns void language sql as $$
  insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
    select org_id, connection_id, _profile, _person from public.records_connections where org_id = _org;
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
  _member uuid := gen_random_uuid();
begin
  _other := public.provision_organization('Intake Link Church', 'owner@intake-link.example.test');
  insert into public.access_requests (org_id, name, email, status)
    values (_other, 'Link Owner', 'owner@intake-link.example.test', 'approved'),
           (_other, 'Link Member', 'member@intake-link.example.test', 'approved');
  insert into auth.users (id, email) values (_owner, 'owner@intake-link.example.test'),
                                            (_member, 'member@intake-link.example.test');
  update public.profiles set role = 'admin' where id = _owner;
  insert into fx values ('other_org', _other), ('other_admin', _owner), ('other_member', _member);
end $$;

select is(
  (select array_agg((p.org_id = pg_temp.fx('org'))::text order by p.email) from public.profiles p
    where p.id in (pg_temp.fx('admin'), pg_temp.fx('member'), pg_temp.fx('member2'),
                   pg_temp.fx('other_admin'), pg_temp.fx('other_member'))),
  array['true', 'true', 'true', 'false', 'false'],
  'non-vacuity: three people of one church and two of another');

insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint, connected_by)
  values (pg_temp.fx('org'), 'rock', 'https://rock.example.org', 'k1.kid.iv.sealed', '9012', pg_temp.fx('admin')),
         (pg_temp.fx('other_org'), 'rock', 'https://rock.other.example.org', 'k1.kid.iv.other', '3456', pg_temp.fx('other_admin'));
insert into public.records_intake_settings (org_id, connection_id, key_ciphertext, key_hint, destination_id, destination_name)
  select org_id, connection_id, 'k1.kid.iv.write', '1234', '42', 'New people from two42'
    from public.records_connections;

-- ── An unsent consent goes with the link ────────────────────────────────────
select is(
  array[
    public.records_intake_consent(pg_temp.fx('org'), pg_temp.fx('member')),
    public.records_intake_consent(pg_temp.fx('other_org'), pg_temp.fx('other_member'))
  ],
  array['saved', 'saved'],
  'non-vacuity: a person in each church consented at sign-up');

select pg_temp.link(pg_temp.fx('org'), pg_temp.fx('member'), '101');

select is(
  pg_temp.requests(pg_temp.fx('org')),
  '{}'::text[],
  'linking a person drops their sign-up consent, so nothing waits for them');

select is(
  pg_temp.requests(pg_temp.fx('other_org')),
  array['member@intake-link.example.test:consented'],
  'and leaves a consent in another church alone');

-- ── A consent accepted at profile setup, not yet claimed ────────────────────
create temp table acc on commit drop as
  select public.records_intake_accept(pg_temp.fx('org'), pg_temp.fx('member2')) as id;

select isnt((select id from acc), null, 'non-vacuity: profile setup accepted the consent');

select pg_temp.link(pg_temp.fx('org'), pg_temp.fx('member2'), '102');

select is(
  array[
    public.records_intake_claim(pg_temp.fx('org'), pg_temp.fx('member2'), (select id from acc)),
    (select count(*)::text from public.records_intake_requests
      where org_id = pg_temp.fx('org') and profile_id = pg_temp.fx('member2'))
  ],
  array['linked', '0'],
  'linking after profile setup accepted the consent drops it, and the queued send claims nothing');

-- ── What already happened stays ─────────────────────────────────────────────
delete from public.records_person_links where org_id = pg_temp.fx('org');
insert into public.records_intake_requests (org_id, profile_id, state, failure, claimed_at, finished_at)
  values (pg_temp.fx('org'), pg_temp.fx('admin'), 'sent', null, now(), now()),
         (pg_temp.fx('org'), pg_temp.fx('member'), 'failed', 'rejected', now(), now()),
         (pg_temp.fx('org'), pg_temp.fx('member2'), 'sending', null, now(), null);
select pg_temp.link(pg_temp.fx('org'), pg_temp.fx('admin'), '100');
select pg_temp.link(pg_temp.fx('org'), pg_temp.fx('member'), '101');
select pg_temp.link(pg_temp.fx('org'), pg_temp.fx('member2'), '102');

select is(
  pg_temp.requests(pg_temp.fx('org')),
  array['admin@local.dev:sent', 'isaac.seedly@example.test:sending', 'leo.loremsworth@example.test:failed'],
  'linking keeps a send already sent, failed or claimed');

delete from public.records_person_links where org_id = pg_temp.fx('org') and profile_id = pg_temp.fx('member');
delete from public.records_intake_requests where org_id = pg_temp.fx('org') and profile_id = pg_temp.fx('member');
select public.records_intake_withdraw(pg_temp.fx('org'), pg_temp.fx('member'));
select pg_temp.link(pg_temp.fx('org'), pg_temp.fx('member'), '101');

select is(
  (select state::text from public.records_intake_requests
    where org_id = pg_temp.fx('org') and profile_id = pg_temp.fx('member')),
  'withdrawn',
  'linking keeps a withdrawal');

-- ── The church boundary ─────────────────────────────────────────────────────
select throws_ok(
  format($q$insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
            select org_id, connection_id, %L, '900' from public.records_connections where org_id = %L$q$,
         pg_temp.fx('other_member'), pg_temp.fx('org')),
  '23503', null, 'a link can''t name a person of another church, so it can''t drop their consent');

select is(
  (select array_agg(has_function_privilege(r, 'public.records_intake_link_cleanup()', 'execute') order by r)
     from unnest(array['anon', 'authenticated']) r),
  array[false, false],
  'no client role can call the cleanup');

select * from finish();
rollback;
