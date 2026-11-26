-- Church records copy suite: the field settings, where each value came from,
-- each person's notice and review state, and the refresh's mark. The copy
-- rules themselves are proven in supabase/functions/tests/records-copy_test.ts;
-- this suite proves what the database guarantees around them: the church
-- boundary, that only server code writes settings and sources, who reads
-- which sources, and what a member's edit does to them.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/church_records_copy_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

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

-- The count a signed-in person sees for a query.
create function pg_temp.seen(_email text, _sql text) returns int language plpgsql as $$
declare n int;
begin
  perform pg_temp.enter(_email);
  execute _sql into n;
  set local role none;
  return n;
end $$;

create temp table fx (key text primary key, id uuid) on commit drop;
grant select on fx to anon, authenticated, service_role;
create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;

-- What records_apply_copy() expects: the person's values as they are now.
create function pg_temp.expected(_profile uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'profile', public.records_pick(to_jsonb(p), array[
      'first_name', 'last_name', 'preferred_name', 'title', 'suffix', 'gender', 'phone_mobile',
      'phone_work', 'birth_month', 'birth_day', 'birth_year', 'avatar_url']),
    'household', (select public.records_pick(to_jsonb(f), array['anniversary_month', 'anniversary_day', 'anniversary_year'])
                    from public.family_units f where f.id = p.family_id and f.org_id = p.org_id),
    'grade', (select public.records_pick(to_jsonb(m), array['graduation_year'])
                from public.family_members m where m.claimed_profile_id = p.id and m.org_id = p.org_id limit 1))
  from public.profiles p where p.id = _profile;
$$;

create function pg_temp.state(_profile uuid, _field text) returns text language sql stable as $$
  select state from public.records_field_values where profile_id = _profile and field = _field;
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
  _other := public.provision_organization('Copy Boundary Church', 'owner@copy-boundary.example.test');
  insert into public.access_requests (org_id, name, email, status)
    values (_other, 'Copy Owner', 'owner@copy-boundary.example.test', 'approved');
  insert into auth.users (id, email) values (_owner, 'owner@copy-boundary.example.test');
  update public.profiles set role = 'admin' where id = _owner;
  insert into fx values ('other_org', _other), ('other_admin', _owner);
end $$;

select is(
  (select array_agg(p.role || ':' || (p.org_id = pg_temp.fx('org'))::text order by p.email) from public.profiles p
    where p.id in (pg_temp.fx('admin'), pg_temp.fx('member'), pg_temp.fx('member2'), pg_temp.fx('other_admin'))),
  array['admin:true', 'member:true', 'member:true', 'admin:false'],
  'non-vacuity: a church admin and two members of one church, and a church admin of another');

insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint, connected_by)
  values (pg_temp.fx('org'), 'rock', 'https://rock.example.org', 'k1.kid.iv.sealed', '9012', pg_temp.fx('admin'));
insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
  select pg_temp.fx('org'), connection_id, l.profile_id, l.person
    from public.records_connections,
         (values (pg_temp.fx('member'), '100'), (pg_temp.fx('member2'), '101')) l(profile_id, person)
   where org_id = pg_temp.fx('org');

select public.records_save_field_settings(
  pg_temp.fx('org'), '{"name": "locked", "phone_mobile": "member", "birthday": "member", "anniversary": "member", "grade": "locked"}',
  pg_temp.fx('admin'));

-- ── The boundary on every table ─────────────────────────────────────────────
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.records_field_settings'::regclass, 'public.records_field_values'::regclass,
                  'public.records_person_state'::regclass, 'public.records_refresh_state'::regclass)),
  'row level security is on for all four tables');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('records_field_settings', 'records_field_values', 'records_person_state', 'records_refresh_state')
      and policyname = 'org isolation' and permissive = 'RESTRICTIVE'),
  4, 'all four tables carry the restrictive org isolation policy');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('records_field_settings', 'records_field_values', 'records_person_state', 'records_refresh_state')
      and grantee = 'anon'),
  0, 'anon holds no privilege on any of them');

select is(
  array[
    has_table_privilege('authenticated', 'public.records_field_settings', 'select'),
    has_table_privilege('authenticated', 'public.records_field_settings', 'insert,update,delete'),
    has_table_privilege('authenticated', 'public.records_field_values', 'select'),
    has_table_privilege('authenticated', 'public.records_field_values', 'insert,update,delete'),
    has_table_privilege('authenticated', 'public.records_refresh_state', 'select,insert,update,delete'),
    has_column_privilege('authenticated', 'public.records_person_state', 'notice_seen_at', 'update'),
    has_column_privilege('authenticated', 'public.records_person_state', 'copied_at', 'update'),
    has_column_privilege('authenticated', 'public.records_person_state', 'review_reason', 'select'),
    has_table_privilege('authenticated', 'public.records_person_state', 'insert,delete')
  ],
  array[true, false, true, false, false, true, false, false, false],
  'a signed-in person reads settings and sources, marks the notice seen, and writes nothing else');

select is(
  (select array_agg(distinct pg_temp.attempt(w.who, q.q))
     from (values ('admin@local.dev'), ('leo.loremsworth@example.test')) w(who)
     cross join (values
       (format('insert into public.records_field_settings (org_id, field, mode) values (%L, %L, %L)', pg_temp.fx('org'), 'title', 'member')),
       ('update public.records_field_settings set mode = ''member'''),
       ('delete from public.records_field_settings'),
       (format('insert into public.records_field_values (org_id, profile_id, field, state) values (%L, %L, %L, %L)',
               pg_temp.fx('org'), pg_temp.fx('member'), 'title', 'records')),
       ('update public.records_field_values set state = ''records'''),
       ('delete from public.records_field_values'),
       ('update public.records_person_state set copied_at = null'),
       ('select review_reason from public.records_person_state'),
       ('select * from public.records_refresh_state')
     ) q(q)),
  array['42501'],
  'the church admin and a member are each refused every other read and write');

-- ── Settings ────────────────────────────────────────────────────────────────
select is(
  (select array_agg(field || ':' || mode order by field) from public.records_field_settings where org_id = pg_temp.fx('org')),
  array['anniversary:member', 'birthday:member', 'grade:locked', 'name:locked', 'phone_mobile:member'],
  'the service role saves the church''s settings');

select throws_ok(
  format('select public.records_save_field_settings(%L, %L, %L)', pg_temp.fx('org'), '{"phone_mobile": "locked"}', pg_temp.fx('admin')),
  '23514', null, 'a phone can''t be locked');

select is(
  array[
    has_function_privilege('anon', 'public.records_save_field_settings(uuid, jsonb, uuid)', 'execute'),
    has_function_privilege('authenticated', 'public.records_save_field_settings(uuid, jsonb, uuid)', 'execute'),
    has_function_privilege('service_role', 'public.records_save_field_settings(uuid, jsonb, uuid)', 'execute'),
    has_function_privilege('anon', 'public.records_apply_copy(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text[])', 'execute'),
    has_function_privilege('authenticated', 'public.records_apply_copy(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text[])', 'execute'),
    has_function_privilege('service_role', 'public.records_apply_copy(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text[])', 'execute')
  ],
  array[false, false, true, false, false, true],
  'only the service role saves settings or applies a copy');

insert into public.records_refresh_state (org_id, connection_id, running_since)
  select org_id, connection_id, now() from public.records_connections where org_id = pg_temp.fx('org');
select is(
  public.records_save_field_settings(pg_temp.fx('org'), '{"name": "member"}', pg_temp.fx('admin')),
  'busy', 'settings aren''t saved while a refresh is running, since it works from the ones it read');
update public.records_refresh_state set running_since = now() - interval '20 minutes' where org_id = pg_temp.fx('org');
select is(
  array[
    (select mode from public.records_field_settings where org_id = pg_temp.fx('org') and field = 'name'),
    public.records_save_field_settings(pg_temp.fx('org'),
      '{"name": "locked", "phone_mobile": "member", "birthday": "member", "anniversary": "member", "grade": "locked"}',
      pg_temp.fx('admin'))
  ],
  array['locked', 'saved'], 'nothing changed meanwhile, and a claim past its lease no longer holds a save back');
delete from public.records_refresh_state where org_id = pg_temp.fx('org');

select is(
  pg_temp.seen('leo.loremsworth@example.test', 'select count(*)::int from public.records_field_settings'),
  5, 'a member reads the church''s settings');
select is(
  pg_temp.seen('owner@copy-boundary.example.test', 'select count(*)::int from public.records_field_settings'),
  0, 'a church admin of another church reads none of them');

-- ── Applying a copy ─────────────────────────────────────────────────────────
-- Leo and Isaac share Leo's household for the anniversary, and Leo has a household member row for a grade.
update public.profiles set family_id = (select family_id from public.profiles where id = pg_temp.fx('member'))
 where id = pg_temp.fx('member2');
insert into public.family_members (family_id, first_name, relationship, claimed_profile_id, graduation_year, org_id)
  select family_id, 'Leo', 'child', id, 2031, org_id from public.profiles where id = pg_temp.fx('member');

select is(
  public.records_apply_copy(
    pg_temp.fx('org'), pg_temp.fx('member'), pg_temp.expected(pg_temp.fx('member')),
    '{"phone_mobile": "+15125550101", "birth_month": 3, "birth_day": 4, "birth_year": null}',
    '{"anniversary_month": 6, "anniversary_day": 1, "anniversary_year": 2001}',
    '{"graduation_year": 2032}',
    '[{"field": "name", "state": "records", "church_value": {"first_name": "Leo", "last_name": "Loremsworth"}},
      {"field": "phone_mobile", "state": "records", "church_value": {"phone_mobile": "+15125550101"}},
      {"field": "birthday", "state": "records", "church_value": {"birth_month": 3, "birth_day": 4, "birth_year": null}},
      {"field": "anniversary", "state": "records", "church_value": {"anniversary_month": 6, "anniversary_day": 1, "anniversary_year": 2001}},
      {"field": "grade", "state": "records", "church_value": {"graduation_year": 2032}}]',
    '{phone_mobile,birthday,anniversary,grade}'),
  'applied', 'a copy is applied');

select is(
  (select (p.phone_mobile, p.birth_month, p.birth_day, f.anniversary_month, m.graduation_year,
           s.copied_at is not null, s.notice_filled_at is not null)::text
     from public.profiles p
     join public.family_units f on f.id = p.family_id
     join public.family_members m on m.claimed_profile_id = p.id
     join public.records_person_state s on s.profile_id = p.id
    where p.id = pg_temp.fx('member')),
  '(+15125550101,3,4,6,2032,t,t)', 'the copy writes the profile, household and grade, and records the notice');

select public.records_apply_copy(
  pg_temp.fx('org'), pg_temp.fx('member2'), pg_temp.expected(pg_temp.fx('member2')),
  '{"phone_mobile": "+15125550102"}', '{}', '{}',
  '[{"field": "phone_mobile", "state": "records", "church_value": {"phone_mobile": "+15125550102"}},
    {"field": "anniversary", "state": "records", "church_value": {"anniversary_month": 6, "anniversary_day": 1, "anniversary_year": 2001}}]',
  '{}');

-- Linked spouses whose records hold different anniversaries: the first one copied stands.
savepoint anniversary_differs;
select is(
  public.records_apply_copy(
    pg_temp.fx('org'), pg_temp.fx('member2'), pg_temp.expected(pg_temp.fx('member2')),
    '{"phone_mobile": "+15125550103"}', '{"anniversary_month": 7, "anniversary_day": 2, "anniversary_year": 1999}', '{}',
    '[{"field": "phone_mobile", "state": "records", "church_value": {"phone_mobile": "+15125550103"}},
      {"field": "anniversary", "state": "records", "church_value": {"anniversary_month": 7, "anniversary_day": 2, "anniversary_year": 1999}}]',
    '{anniversary}'),
  'held', 'a spouse''s copy with a different anniversary is applied without it');
select is(
  (select (f.anniversary_month, p.phone_mobile,
           (select count(*) from public.records_field_values v where v.profile_id = p.id and v.field = 'anniversary'),
           s.notice_filled_at is not null)::text
     from public.profiles p
     join public.family_units f on f.id = p.family_id
     join public.records_person_state s on s.profile_id = p.id
    where p.id = pg_temp.fx('member2')),
  '(6,+15125550103,0,f)',
  'the household keeps the anniversary already copied, the spouse''s differing one isn''t recorded or announced, and the rest of the copy lands');
rollback to savepoint anniversary_differs;

-- Both spouses cleared the anniversary, then the church corrected both records.
savepoint anniversary_cleared;
update public.records_field_values set state = 'cleared' where org_id = pg_temp.fx('org') and field = 'anniversary';
select is(
  public.records_apply_copy(
    pg_temp.fx('org'), pg_temp.fx('member2'), pg_temp.expected(pg_temp.fx('member2')),
    '{}', '{}', '{}',
    '[{"field": "anniversary", "state": "cleared", "church_value": {"anniversary_month": 7, "anniversary_day": 2, "anniversary_year": 1999}}]',
    '{}'),
  'held', 'non-vacuity: a cleared anniversary that differs from the spouse''s records is held');
select is(
  (select state from public.records_field_values where profile_id = pg_temp.fx('member2') and field = 'anniversary'),
  'cleared', 'a member''s cleared anniversary is kept while their records differ from their spouse''s');
rollback to savepoint anniversary_cleared;

-- Both spouses changed the anniversary, then the church corrected both records.
savepoint anniversary_corrected;
update public.records_field_values set state = 'changed' where org_id = pg_temp.fx('org') and field = 'anniversary';
select is(
  public.records_apply_copy(
    pg_temp.fx('org'), pg_temp.fx('member'), pg_temp.expected(pg_temp.fx('member')),
    '{}', '{}', '{}',
    '[{"field": "anniversary", "state": "changed", "church_value": {"anniversary_month": 5, "anniversary_day": 5, "anniversary_year": 2005}}]',
    '{}'),
  'held', 'non-vacuity: the first corrected spouse is held against the other''s older records');
select is(
  public.records_apply_copy(
    pg_temp.fx('org'), pg_temp.fx('member2'), pg_temp.expected(pg_temp.fx('member2')),
    '{}', '{}', '{}',
    '[{"field": "anniversary", "state": "changed", "church_value": {"anniversary_month": 5, "anniversary_day": 5, "anniversary_year": 2005}}]',
    '{}'),
  'applied', 'once both spouses'' records agree, the second spouse''s copy is no longer held');
select is(
  (select array_agg(distinct (state, church_value ->> 'anniversary_month')::text)
     from public.records_field_values where org_id = pg_temp.fx('org') and field = 'anniversary'),
  array['(changed,5)'], 'a held change keeps its state and takes the corrected church value');
rollback to savepoint anniversary_corrected;

-- Both spouses changed the anniversary to the household's value; the church corrected only the first's records.
savepoint anniversary_matches;
update public.records_field_values
   set state = 'changed', church_value = '{"anniversary_month": 5, "anniversary_day": 5, "anniversary_year": 2005}'
 where org_id = pg_temp.fx('org') and field = 'anniversary';
select is(
  public.records_apply_copy(
    pg_temp.fx('org'), pg_temp.fx('member'), pg_temp.expected(pg_temp.fx('member')),
    '{}', '{}', '{}',
    '[{"field": "anniversary", "state": "records", "church_value": {"anniversary_month": 6, "anniversary_day": 1, "anniversary_year": 2001}}]',
    '{}'),
  'held', 'non-vacuity: the corrected spouse is held against the other''s older records');
select is(
  (select (state, church_value ->> 'anniversary_month')::text
     from public.records_field_values where profile_id = pg_temp.fx('member') and field = 'anniversary'),
  '(records,6)', 'a held change that now matches the church''s value goes back to the church''s records');
rollback to savepoint anniversary_matches;

select is(
  public.records_apply_copy(
    pg_temp.fx('org'), pg_temp.fx('member'),
    jsonb_set(pg_temp.expected(pg_temp.fx('member')), '{profile,phone_mobile}', '"+15125550000"'),
    '{"phone_mobile": "+15125550999"}', '{}', '{}', '[]', '{}'),
  'stale', 'a copy worked out from values that have changed since is refused');
select is(
  (select phone_mobile from public.profiles where id = pg_temp.fx('member')),
  '+15125550101', 'and writes nothing');

select is(
  public.records_apply_copy(pg_temp.fx('org'), pg_temp.fx('admin'), pg_temp.expected(pg_temp.fx('admin')),
    '{"phone_mobile": "+15125550999"}', '{}', '{}', '[]', '{}'),
  'unlinked', 'a profile without a link gets no copy');
select is(
  public.records_apply_copy(pg_temp.fx('org'), pg_temp.fx('other_admin'), pg_temp.expected(pg_temp.fx('other_admin')),
    '{"phone_mobile": "+15125550999"}', '{}', '{}', '[]', '{}'),
  'gone', 'a profile from another church is not this church''s to copy into');

-- ── Who reads the sources ───────────────────────────────────────────────────
-- Leo manages the household; Isaac is in it without managing it; Zoe is in none.
update public.profiles set relationship = 'primary' where id = pg_temp.fx('member');
update public.profiles set relationship = 'other' where id = pg_temp.fx('member2');
update public.profiles set family_id = null where email = 'zoe.dummyfield@example.test';
select is(
  array[
    pg_temp.seen('leo.loremsworth@example.test',
      format('select count(*)::int from public.records_field_values where profile_id = %L', pg_temp.fx('member'))),
    pg_temp.seen('leo.loremsworth@example.test',
      format('select count(*)::int from public.records_field_values where profile_id = %L', pg_temp.fx('member2'))),
    pg_temp.seen('isaac.seedly@example.test',
      format('select count(*)::int from public.records_field_values where profile_id = %L', pg_temp.fx('member'))),
    pg_temp.seen('isaac.seedly@example.test',
      format('select count(*)::int from public.records_field_values where profile_id = %L and field = %L',
             pg_temp.fx('member'), 'anniversary')),
    pg_temp.seen('zoe.dummyfield@example.test', 'select count(*)::int from public.records_field_values'),
    pg_temp.seen('admin@local.dev', 'select count(*)::int from public.records_field_values'),
    pg_temp.seen('owner@copy-boundary.example.test', 'select count(*)::int from public.records_field_values')
  ],
  array[5, 2, 1, 1, 0, 7, 0],
  'a member reads their own sources; a household manager those of the people they edit; the rest of the household only the anniversary; nobody else any; a church admin every one in their church only');

select is(
  array[
    pg_temp.attempt('leo.loremsworth@example.test',
      format('update public.records_person_state set notice_seen_at = now() where profile_id = %L', pg_temp.fx('member2'))),
    pg_temp.attempt('leo.loremsworth@example.test',
      format('update public.records_person_state set notice_seen_at = now() where profile_id = %L', pg_temp.fx('member')))
  ],
  array['rows:0', 'rows:1'],
  'a member marks only their own notice seen');

-- ── A member's edit ─────────────────────────────────────────────────────────
select pg_temp.attempt('leo.loremsworth@example.test',
  format('update public.profiles set phone_mobile = %L where id = %L', '+15125550199', pg_temp.fx('member')));
select is(pg_temp.state(pg_temp.fx('member'), 'phone_mobile'), 'changed', 'a member''s edit marks the phone changed');

select pg_temp.attempt('leo.loremsworth@example.test',
  format('update public.profiles set phone_mobile = %L where id = %L', '+15125550101', pg_temp.fx('member')));
select is(pg_temp.state(pg_temp.fx('member'), 'phone_mobile'), 'records', 'the church''s value again marks it from the records');

select pg_temp.attempt('leo.loremsworth@example.test',
  format('update public.profiles set birth_month = null, birth_day = null, birth_year = null where id = %L', pg_temp.fx('member')));
select is(pg_temp.state(pg_temp.fx('member'), 'birthday'), 'cleared', 'a member''s clear marks the birthday cleared');

select is(
  pg_temp.attempt('leo.loremsworth@example.test',
    format('update public.profiles set first_name = %L, occupation = %L where id = %L', 'Lionel', 'Plumber', pg_temp.fx('member'))),
  'rows:1', 'a member''s save that touches a locked name still saves');
select is(
  (select (first_name, occupation)::text from public.profiles where id = pg_temp.fx('member')),
  '(Leo,Plumber)', 'the locked name keeps the church''s value and the rest of the save lands');

select pg_temp.attempt('admin@local.dev',
  format('update public.family_members set graduation_year = 2030 where claimed_profile_id = %L', pg_temp.fx('member')));
select is(
  (select graduation_year from public.family_members where claimed_profile_id = pg_temp.fx('member')),
  2032::smallint, 'a locked grade keeps the church''s value, even for a church admin');

select is(
  pg_temp.attempt('leo.loremsworth@example.test',
    format('update public.family_units set anniversary_month = 7 where id = (select family_id from public.profiles where id = %L)',
           pg_temp.fx('member'))),
  'rows:1', 'non-vacuity: a member edits their household''s anniversary');
select is(
  array[pg_temp.state(pg_temp.fx('member'), 'anniversary'), pg_temp.state(pg_temp.fx('member2'), 'anniversary')],
  array['changed', 'changed'], 'an anniversary edit marks it changed for everyone in the household');

set local role service_role;
update public.profiles set phone_mobile = '+15125550123' where id = pg_temp.fx('member2');
set local role none;
select is(pg_temp.state(pg_temp.fx('member2'), 'phone_mobile'), 'records', 'a write by the service role is not a member''s edit');

-- ── Turning a field off, and disconnecting ──────────────────────────────────
select public.records_save_field_settings(
  pg_temp.fx('org'), '{"name": "locked", "birthday": "member", "anniversary": "member", "grade": "locked"}', pg_temp.fx('admin'));
select is(
  (select count(*)::int from public.records_field_values where org_id = pg_temp.fx('org') and field = 'phone_mobile'),
  0, 'turning a field off removes its sources');
select is(
  (select count(*)::int from public.records_person_state where org_id = pg_temp.fx('org') and copied_at is not null),
  0, 'and asks the next refresh to copy everyone in full');

insert into public.records_refresh_state (org_id, connection_id, cursor)
  select org_id, connection_id, '2026-11-20T10:00:00' from public.records_connections where org_id = pg_temp.fx('org');

delete from public.records_connections where org_id = pg_temp.fx('org');
select is(
  array[
    (select count(*)::int from public.records_field_values where org_id = pg_temp.fx('org')),
    (select count(*)::int from public.records_person_state where org_id = pg_temp.fx('org')),
    (select count(*)::int from public.records_refresh_state where org_id = pg_temp.fx('org')),
    (select count(*)::int from public.records_field_settings where org_id = pg_temp.fx('org'))
  ],
  array[0, 0, 0, 4],
  'disconnecting removes the sources, person state and refresh mark, and keeps the church''s settings');
select is(
  (select (p.phone_mobile, p.first_name, f.anniversary_month)::text
     from public.profiles p join public.family_units f on f.id = p.family_id where p.id = pg_temp.fx('member')),
  '(+15125550101,Leo,7)', 'every copied value stays in place');
select is(
  pg_temp.attempt('leo.loremsworth@example.test',
    format('update public.profiles set first_name = %L where id = %L', 'Lionel', pg_temp.fx('member'))),
  'rows:1', 'and editable: the name is no longer locked');
select is(
  (select first_name from public.profiles where id = pg_temp.fx('member')),
  'Lionel', 'the edit lands');

select * from finish();
rollback;
