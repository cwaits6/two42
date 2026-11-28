-- Church records household anniversary suite: the household anniversary's
-- source is kept once per household, so a household's clear binds everyone
-- in it and the hold between spouses whose records differ lasts whichever
-- is copied first; and a member's clear of a detail the records can supply
-- is remembered while the church's records are connected, whether or not the
-- church supplied it, whether the field is on or off, and whichever of the
-- clear and the field being turned off lands first. A church that never
-- connects stores nothing. That the copy rules keep a 'cleared' source empty
-- is proven in supabase/functions/tests/records-copy_test.ts, and that live
-- mode hides it in lib/integrations/records/live.test.ts.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/church_records_household_anniversary_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.uid(_email text) returns uuid language sql stable as $$
  select id from public.profiles where email = _email;
$$;

-- rows:<n> for a signed-in person's statement, or the SQLSTATE it raises.
create function pg_temp.attempt(_email text, _sql text) returns text language plpgsql as $$
declare n bigint; r text;
begin
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.uid(_email), 'role', 'authenticated')::text, true);
  set local role authenticated;
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
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.uid(_email), 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute _sql into n;
  set local role none;
  return n;
end $$;

create function pg_temp.as_service(_sql text) returns text language plpgsql as $$
declare r text;
begin
  set local role service_role;
  execute _sql into r;
  set local role none;
  return r;
end $$;

create temp table fx (key text primary key, id uuid) on commit drop;
grant select on fx to anon, authenticated, service_role;
create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;

create function pg_temp.date(_month int, _day int, _year int) returns jsonb language sql immutable as $$
  select jsonb_build_object('anniversary_month', _month, 'anniversary_day', _day, 'anniversary_year', _year);
$$;

create function pg_temp.save_fields(_settings jsonb) returns text language sql as $$
  select pg_temp.as_service(format('select public.records_save_field_settings(%L, %L, %L)',
    pg_temp.fx('org'), _settings, pg_temp.fx('admin')));
$$;

-- What a person's plan was read from, as the refresh sends it, with each
-- linked person in the household's church anniversary in _reads.
create function pg_temp.expected(_profile uuid, _reads jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'person', (select l.external_person_id from public.records_person_links l
                where l.profile_id = p.id and l.org_id = p.org_id),
    'profile', public.records_pick(to_jsonb(p), array[
      'first_name', 'last_name', 'preferred_name', 'title', 'suffix', 'gender', 'phone_mobile',
      'phone_work', 'birth_month', 'birth_day', 'birth_year', 'avatar_url']),
    'household', (select public.records_pick(to_jsonb(f), array['anniversary_month', 'anniversary_day', 'anniversary_year'])
                    from public.family_units f where f.id = p.family_id and f.org_id = p.org_id),
    'grade', (select public.records_pick(to_jsonb(m), array['graduation_year'])
                from public.family_members m where m.claimed_profile_id = p.id and m.org_id = p.org_id
               order by m.id limit 1),
    'states', jsonb_build_object('anniversary', (
      select h.state from public.records_household_anniversary h where h.family_id = p.family_id and h.org_id = p.org_id)),
    'anniversaries', _reads)
  from public.profiles p where p.id = _profile;
$$;

-- A person's copy that writes the household's anniversary as the records
-- give it, as a plan that ignored the household's own state would.
create function pg_temp.copy(_key text, _reads jsonb, _value jsonb) returns text language sql as $$
  select pg_temp.as_service(format('select public.records_apply_copy(%L, %L, %L, %L, %L, %L, %L, %L)',
    pg_temp.fx('org'), pg_temp.fx(_key), pg_temp.expected(pg_temp.fx(_key), _reads), '{}', _value, '{}',
    jsonb_build_array(jsonb_build_object('field', 'anniversary', 'state', 'records', 'church_value', _value)),
    '{anniversary}'));
$$;

-- Two people's church anniversaries, by fixture key.
create function pg_temp.reads(_a text, _x jsonb, _b text, _y jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(pg_temp.fx(_a), _x, pg_temp.fx(_b), _y);
$$;

-- A household's anniversary month and its source, as month/state:church month.
create function pg_temp.household(_key text) returns text language sql stable as $$
  select coalesce(f.anniversary_month::text, 'none') || '/'
         || coalesce((select h.state || ':' || coalesce(h.church_value ->> 'anniversary_month', 'none')
                        from public.records_household_anniversary h where h.family_id = f.id), 'no source')
    from public.family_units f where f.id = pg_temp.fx(_key);
$$;

-- A person's source for a field, as state:church value, or 'no source'.
create function pg_temp.source(_key text, _field text) returns text language sql stable as $$
  select coalesce((select v.state || ':' || v.church_value::text from public.records_field_values v
                    where v.profile_id = pg_temp.fx(_key) and v.field = _field), 'no source');
$$;

create function pg_temp.address_source(_key text) returns text language sql stable as $$
  select coalesce((select v.state || ':' || v.church_value::text from public.records_household_values v
                    where v.family_id = pg_temp.fx(_key) and v.field = 'address'), 'no source');
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Six couples, each a household's primary and spouse, all linked to the
-- church's records, and Isaac alone in his. Mia is in the church but not
-- linked. The Mockingham, Loremsworth and Testwell households are linked to
-- their families.
insert into fx select 'org', org_id from public.profiles where email = 'admin@local.dev';
insert into fx values ('admin', pg_temp.uid('admin@local.dev'));
insert into fx select k, pg_temp.uid(e) from (values
  ('henry', 'henry.mockingham@example.test'), ('chloe', 'chloe.mockingham@example.test'),
  ('leo', 'leo.loremsworth@example.test'), ('hannah', 'hannah.loremsworth@example.test'),
  ('ava', 'ava.sampleton@example.test'), ('noah', 'noah.sampleton@example.test'),
  ('oliver', 'oliver.stubbins@example.test'), ('ivy', 'ivy.stubbins@example.test'),
  ('grace', 'grace.testwell@example.test'), ('owen', 'owen.testwell@example.test'),
  ('zoe', 'zoe.dummyfield@example.test'), ('caleb', 'caleb.dummyfield@example.test'),
  ('isaac', 'isaac.seedly@example.test'), ('ruth', 'ruth.fixtureton@example.test'),
  ('mia', 'mia.fakeworth@example.test')) as t(k, e);
insert into fx select h, family_id from (values
  ('mockingham', 'henry'), ('loremsworth', 'leo'), ('sampleton', 'ava'), ('stubbins', 'oliver'),
  ('testwell', 'grace'), ('dummyfield', 'zoe'), ('seedly', 'isaac')) as t(h, k)
  join public.profiles p on p.id = pg_temp.fx(t.k);

select is(
  (select count(*)::int from public.profiles p
    where p.id in (select id from fx where key in ('henry', 'chloe', 'leo', 'hannah', 'ava', 'noah',
                                                    'oliver', 'ivy', 'grace', 'owen', 'zoe', 'caleb'))
      and p.role = 'member' and p.relationship in ('primary', 'spouse')
      and p.family_id in (select id from fx where key in ('mockingham', 'loremsworth', 'sampleton', 'stubbins',
                                                          'testwell', 'dummyfield'))),
  12, 'non-vacuity: six households, each with a primary and a spouse');

update public.family_units set anniversary_month = null, anniversary_day = null, anniversary_year = null
 where id in (select id from fx where key in ('mockingham', 'loremsworth', 'sampleton', 'stubbins', 'testwell',
                                               'dummyfield', 'seedly'));

-- Another church, connected and live, with a household anniversary the
-- household cleared, to show nothing here reaches it.
do $$
declare
  _other uuid;
  _owner uuid := gen_random_uuid();
  _family uuid;
  _connection uuid;
begin
  _other := public.provision_organization('Anniversary Boundary Church', 'owner@anniversary-boundary.example.test');
  insert into public.access_requests (org_id, name, email, status)
    values (_other, 'Anniversary Owner', 'owner@anniversary-boundary.example.test', 'approved');
  insert into auth.users (id, email) values (_owner, 'owner@anniversary-boundary.example.test');
  insert into public.family_units (org_id, family_name) values (_other, 'Boundary') returning id into _family;
  update public.profiles set role = 'admin', family_id = _family, relationship = 'primary' where id = _owner;
  insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint, connected_by)
    values (_other, 'rock', 'https://rock.boundary.example', 'k1.kid.iv.sealed', '1111', _owner)
    returning connection_id into _connection;
  insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
    values (_other, _connection, _owner, '900');
  insert into public.records_org_settings (org_id, mode) values (_other, 'live');
  insert into public.records_field_values (org_id, profile_id, field, state)
    values (_other, _owner, 'anniversary', 'cleared');
  insert into fx values ('other_org', _other), ('other_owner', _owner), ('boundary', _family);
end $$;

insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint, connected_by)
  values (pg_temp.fx('org'), 'rock', 'https://rock.example.org', 'k1.kid.iv.sealed', '9012', pg_temp.fx('admin'));
insert into fx select 'connection', connection_id from public.records_connections where org_id = pg_temp.fx('org');
insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
  select pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx(k), (100 + n)::text
    from unnest(array['henry', 'chloe', 'leo', 'hannah', 'ava', 'noah', 'oliver', 'ivy', 'grace', 'owen',
                      'zoe', 'caleb', 'isaac', 'ruth']) with ordinality as t(k, n);
insert into public.records_household_links (org_id, family_id, connection_id, external_family_id, confirmed_by)
  select pg_temp.fx('org'), pg_temp.fx(k), pg_temp.fx('connection'), f, pg_temp.fx('admin')
    from (values ('mockingham', 'F1'), ('loremsworth', 'F2'), ('testwell', 'F3')) as t(k, f);
insert into public.records_field_settings (org_id, field, mode)
  select pg_temp.fx('org'), f, 'member' from unnest(array['phone_mobile', 'birthday', 'anniversary', 'address', 'photo']) f;
insert into public.records_field_settings (org_id, field, mode)
  select pg_temp.fx('org'), f, 'locked' from unnest(array['name', 'gender']) f;

-- ── Moving the per-person sources to the household ──────────────────────────
-- Old sources as copies and members left them: both spouses following the
-- church; one following it and one cleared; a clear by someone alone in a
-- household another person has since joined; spouses whose records differ,
-- the first one copied standing; one changed and one still the church's;
-- spouses whose records differ with nothing copied; and the other church's
-- clear made in live mode.
savepoint moved;
update public.profiles set family_id = pg_temp.fx('seedly'), relationship = 'spouse' where id = pg_temp.fx('ruth');
update public.family_units set anniversary_month = 6, anniversary_day = 1, anniversary_year = 2001
 where id in (pg_temp.fx('mockingham'), pg_temp.fx('sampleton'));
update public.family_units set anniversary_month = 9, anniversary_day = 9, anniversary_year = 2009
 where id = pg_temp.fx('stubbins');
insert into public.records_field_values (org_id, profile_id, field, state, church_value, updated_at)
  select pg_temp.fx('org'), pg_temp.fx(k), 'anniversary', s, v, now() - (n || ' minutes')::interval
    from (values
      ('henry', 'records', pg_temp.date(6, 1, 2001), 1), ('chloe', 'records', pg_temp.date(6, 1, 2001), 2),
      ('leo', 'records', pg_temp.date(6, 1, 2001), 1), ('hannah', 'cleared', pg_temp.date(6, 1, 2001), 2),
      ('isaac', 'cleared', pg_temp.date(6, 1, 2001), 1),
      ('ava', 'records', pg_temp.date(6, 1, 2001), 2), ('noah', 'records', pg_temp.date(7, 2, 1999), 1),
      ('oliver', 'changed', pg_temp.date(6, 1, 2001), 1), ('ivy', 'records', pg_temp.date(6, 1, 2001), 2),
      ('grace', 'records', pg_temp.date(6, 1, 2001), 1), ('owen', 'records', pg_temp.date(7, 2, 1999), 2)
    ) as t(k, s, v, n);

-- The data move, exactly as 20261215000000_church_records_household_anniversary.sql runs it.
insert into public.records_household_anniversary (org_id, family_id, connection_id, state, church_value, updated_at)
select v.org_id, p.family_id, (array_agg(l.connection_id))[1],
       case when bool_or(v.state = 'cleared') then 'cleared'
            when bool_or(v.state = 'changed') then 'changed'
            else 'records' end,
       case when exists (select 1 from public.records_org_settings s where s.org_id = v.org_id and s.mode = 'live')
              then '{}'::jsonb
            else coalesce(
              (array_agg(v.church_value order by v.updated_at desc) filter (
                 where not public.records_is_empty(public.records_pick(v.church_value, public.records_field_columns('anniversary')))
                   and public.records_pick(v.church_value, public.records_field_columns('anniversary'))
                       = public.records_pick(jsonb_build_object('anniversary_month', f.anniversary_month,
                           'anniversary_day', f.anniversary_day, 'anniversary_year', f.anniversary_year),
                         public.records_field_columns('anniversary'))))[1],
              case when count(distinct public.records_pick(v.church_value, public.records_field_columns('anniversary'))) filter (
                          where not public.records_is_empty(public.records_pick(v.church_value, public.records_field_columns('anniversary')))) = 1
                   then (array_agg(v.church_value order by v.updated_at desc) filter (
                          where not public.records_is_empty(public.records_pick(v.church_value, public.records_field_columns('anniversary')))))[1]
              end,
              '{}'::jsonb)
       end,
       max(v.updated_at)
  from public.records_field_values v
  join public.profiles p on p.id = v.profile_id and p.org_id = v.org_id
  join public.family_units f on f.id = p.family_id and f.org_id = p.org_id
  join public.records_person_links l on l.org_id = v.org_id and l.profile_id = v.profile_id
 where v.field = 'anniversary'
 group by v.org_id, p.family_id, f.anniversary_month, f.anniversary_day, f.anniversary_year;

select is(
  array[pg_temp.household('mockingham'), pg_temp.household('loremsworth'), pg_temp.household('seedly'),
        pg_temp.household('sampleton'), pg_temp.household('stubbins'), pg_temp.household('testwell')],
  array['6/records:6', 'none/cleared:6', 'none/cleared:6', '6/records:6', '9/changed:6', 'none/records:none'],
  'each household gets one source: a clear binds it, then a change, and the church''s value is the one it holds or the one the records agree on');
select is(pg_temp.household('dummyfield'), 'none/no source', 'a household with no old source gets none');
select is((select state || ':' || church_value::text from public.records_household_anniversary where family_id = pg_temp.fx('boundary')),
  'cleared:{}', 'the other church''s clear made in live mode moves too, keeping no church value');
select is((select count(*)::int from public.records_field_values where field = 'anniversary'
             and org_id in (pg_temp.fx('org'), pg_temp.fx('other_org'))), 12,
  'the old sources stay where they were, for app code still deployed while this rolls out');
select is((select count(*)::int from public.records_household_anniversary where org_id = pg_temp.fx('other_org')), 1,
  'each church''s sources move within it');
rollback to savepoint moved;

insert into public.records_household_anniversary (org_id, family_id, connection_id, state)
  select pg_temp.fx('other_org'), pg_temp.fx('boundary'), connection_id, 'cleared'
    from public.records_connections where org_id = pg_temp.fx('other_org');

-- ── The first copy of an anniversary ────────────────────────────────────────
select is(pg_temp.copy('ava', pg_temp.reads('ava', pg_temp.date(6, 1, 2001), 'noah', pg_temp.date(6, 1, 2001)),
                       pg_temp.date(6, 1, 2001)),
  'applied', 'a household that never set or cleared its anniversary gets the first copy');
select is(pg_temp.household('sampleton'), '6/records:6', 'written, with its source following the church');
select is(pg_temp.copy('oliver', pg_temp.reads('oliver', pg_temp.date(null, null, null), 'ivy', pg_temp.date(3, 3, 2003)),
                       pg_temp.date(3, 3, 2003)),
  'applied', 'a spouse with no anniversary in the records doesn''t hold back the other''s');
select is(pg_temp.household('stubbins'), '3/records:3', 'so the household takes the one the records hold');

-- ── Spouses whose records differ ────────────────────────────────────────────
select is(pg_temp.copy('grace', pg_temp.reads('grace', pg_temp.date(6, 1, 2001), 'owen', pg_temp.date(7, 2, 1999)),
                       pg_temp.date(6, 1, 2001)),
  'held', 'with the spouses'' records differing, the first one copied is held');
select is(pg_temp.copy('owen', pg_temp.reads('grace', pg_temp.date(6, 1, 2001), 'owen', pg_temp.date(7, 2, 1999)),
                       pg_temp.date(7, 2, 1999)),
  'held', 'and so is the second');
select is(pg_temp.household('testwell'), 'none/no source', 'nothing writes the anniversary');

select is(pg_temp.copy('hannah', pg_temp.reads('leo', pg_temp.date(6, 1, 2001), 'hannah', pg_temp.date(7, 2, 1999)),
                       pg_temp.date(7, 2, 1999)),
  'held', 'in the other order, the spouse copied first is held');
select is(pg_temp.copy('leo', pg_temp.reads('leo', pg_temp.date(6, 1, 2001), 'hannah', pg_temp.date(7, 2, 1999)),
                       pg_temp.date(6, 1, 2001)),
  'held', 'and so is the other');
select is(pg_temp.household('loremsworth'), 'none/no source', 'nothing writes it either way round');

select is(pg_temp.copy('noah', pg_temp.reads('ava', pg_temp.date(6, 1, 2001), 'noah', pg_temp.date(7, 2, 1999)),
                       pg_temp.date(7, 2, 1999)),
  'held', 'once one spouse''s records change, the copy of that spouse is held');
select is(pg_temp.copy('ava', pg_temp.reads('ava', pg_temp.date(6, 1, 2001), 'noah', pg_temp.date(7, 2, 1999)),
                       pg_temp.date(6, 1, 2001)),
  'held', 'and the other spouse''s copy after it is held too, since the household''s source stays');
select is(pg_temp.household('sampleton'), '6/records:6', 'the anniversary and its source stay as they were');

select is(pg_temp.copy('owen', pg_temp.reads('grace', pg_temp.date(5, 5, 2005), 'owen', pg_temp.date(5, 5, 2005)),
                       pg_temp.date(5, 5, 2005)),
  'applied', 'once the records agree the anniversary is copied');
select is(pg_temp.household('testwell'), '5/records:5', 'with a source that follows the church');

select is(pg_temp.copy('grace', jsonb_build_object(pg_temp.fx('grace'), pg_temp.date(5, 5, 2005)), pg_temp.date(5, 5, 2005)),
  'stale', 'a copy that didn''t read every linked person in the household is refused');
select is(pg_temp.copy('grace', pg_temp.reads('grace', pg_temp.date(5, 5, 2005), 'mia', pg_temp.date(5, 5, 2005)),
                       pg_temp.date(5, 5, 2005)),
  'stale', 'and so is one that read someone not linked in it');

-- ── A household's clear ─────────────────────────────────────────────────────
select is(pg_temp.copy('henry', pg_temp.reads('henry', pg_temp.date(6, 1, 2001), 'chloe', pg_temp.date(6, 1, 2001)),
                       pg_temp.date(6, 1, 2001)),
  'applied', 'non-vacuity: the Mockingham anniversary is copied');
select is(pg_temp.attempt('henry.mockingham@example.test', format(
  'update public.family_units set anniversary_month = null, anniversary_day = null, anniversary_year = null where id = %L',
  pg_temp.fx('mockingham'))), 'rows:1', 'Henry clears the household''s anniversary');
select is(pg_temp.household('mockingham'), 'none/cleared:6', 'once, for the household');
select is(pg_temp.copy('chloe', pg_temp.reads('henry', pg_temp.date(8, 8, 2008), 'chloe', pg_temp.date(8, 8, 2008)),
                       pg_temp.date(8, 8, 2008)),
  'applied', 'Chloe''s records change and her copy is applied');
select is(pg_temp.copy('henry', pg_temp.reads('henry', pg_temp.date(8, 8, 2008), 'chloe', pg_temp.date(8, 8, 2008)),
                       pg_temp.date(8, 8, 2008)),
  'applied', 'and so is Henry''s');
select is(pg_temp.household('mockingham'), 'none/cleared:8',
  'the anniversary stays cleared whichever spouse''s records change, with the church''s value beside it');
select is(pg_temp.attempt('chloe.mockingham@example.test', format(
  'update public.family_units set anniversary_month = 4, anniversary_day = 4, anniversary_year = 2004 where id = %L',
  pg_temp.fx('mockingham'))), 'rows:1', 'Chloe sets it again');
select is(pg_temp.household('mockingham'), '4/changed:8', 'which makes it the household''s own');
select is(pg_temp.copy('henry', pg_temp.reads('henry', pg_temp.date(8, 8, 2008), 'chloe', pg_temp.date(8, 8, 2008)),
                       pg_temp.date(8, 8, 2008)),
  'applied', 'a copy after it is applied');
select is(pg_temp.household('mockingham'), '4/changed:8', 'and leaves the date she set');

-- ── A clear and a field turned off, in either order ─────────────────────────
-- Chloe clears her mobile, Oliver his household's anniversary and Henry its
-- address before the church admin turns those fields off; Henry clears his
-- mobile, Leo his household's anniversary and its address after.
update public.profiles set phone_mobile = '+15125550101' where id = pg_temp.fx('henry');
update public.profiles set phone_mobile = '+15125550102' where id = pg_temp.fx('chloe');
update public.family_units set anniversary_month = 6, anniversary_day = 1, anniversary_year = 2001,
       address_line1 = '1 Oak St', city = 'Austin', state = 'TX', postal_code = '78701'
 where id = pg_temp.fx('loremsworth');
update public.family_units set address_line1 = '2 Elm St', city = 'Austin', state = 'TX', postal_code = '78702'
 where id = pg_temp.fx('mockingham');
insert into public.records_field_values (org_id, profile_id, field, state, church_value) values
  (pg_temp.fx('org'), pg_temp.fx('henry'), 'phone_mobile', 'records', '{"phone_mobile": "+15125550101"}'),
  (pg_temp.fx('org'), pg_temp.fx('chloe'), 'phone_mobile', 'records', '{"phone_mobile": "+15125550102"}');
insert into public.records_household_anniversary (org_id, family_id, connection_id, state, church_value)
  values (pg_temp.fx('org'), pg_temp.fx('loremsworth'), pg_temp.fx('connection'), 'records', pg_temp.date(6, 1, 2001));
insert into public.records_household_values (org_id, family_id, field, state, church_value) values
  (pg_temp.fx('org'), pg_temp.fx('mockingham'), 'address', 'records',
   '{"address_line1": "2 Elm St", "address_line2": null, "city": "Austin", "state": "TX", "postal_code": "78702"}'),
  (pg_temp.fx('org'), pg_temp.fx('loremsworth'), 'address', 'records',
   '{"address_line1": "1 Oak St", "address_line2": null, "city": "Austin", "state": "TX", "postal_code": "78701"}');

select is(
  array[
    pg_temp.attempt('chloe.mockingham@example.test',
      format('update public.profiles set phone_mobile = null where id = %L', pg_temp.fx('chloe'))),
    pg_temp.attempt('oliver.stubbins@example.test', format(
      'update public.family_units set anniversary_month = null, anniversary_day = null, anniversary_year = null where id = %L',
      pg_temp.fx('stubbins'))),
    pg_temp.attempt('henry.mockingham@example.test', format(
      'update public.family_units set address_line1 = null, city = null, state = null, postal_code = null where id = %L',
      pg_temp.fx('mockingham')))
  ],
  array['rows:1', 'rows:1', 'rows:1'], 'members clear a mobile, an anniversary and an address');
select is(pg_temp.save_fields('{"name": "locked", "gender": "locked", "birthday": "member", "photo": "member"}'), 'saved',
  'then the church admin turns those fields off');
select is(
  array[
    pg_temp.attempt('henry.mockingham@example.test',
      format('update public.profiles set phone_mobile = null where id = %L', pg_temp.fx('henry'))),
    pg_temp.attempt('leo.loremsworth@example.test', format(
      'update public.family_units set anniversary_month = null, anniversary_day = null, anniversary_year = null, '
      'address_line1 = null, city = null, state = null, postal_code = null where id = %L', pg_temp.fx('loremsworth')))
  ],
  array['rows:1', 'rows:1'], 'and other members clear them after');
select is(pg_temp.save_fields(
  '{"name": "locked", "gender": "locked", "birthday": "member", "photo": "member", "phone_mobile": "member", "anniversary": "member", "address": "member"}'),
  'saved', 'the church admin turns them on again');
select is(
  array[pg_temp.source('chloe', 'phone_mobile'), pg_temp.source('henry', 'phone_mobile'),
        pg_temp.household('stubbins'), pg_temp.household('loremsworth'),
        pg_temp.address_source('mockingham'), pg_temp.address_source('loremsworth')],
  array['cleared:{}', 'cleared:{}', 'none/cleared:none', 'none/cleared:none', 'cleared:{}', 'cleared:{}'],
  'every clear is remembered whichever landed first, without the church''s value, so the next copy keeps it empty');

-- ── A clear of a detail the church hasn't supplied ──────────────────────────
update public.profiles set gender = 'male' where id = pg_temp.fx('owen');
insert into public.family_members (org_id, family_id, first_name, last_name, relationship, claimed_profile_id, graduation_year)
  values (pg_temp.fx('org'), pg_temp.fx('testwell'), 'Owen', 'Testwell', 'spouse', pg_temp.fx('owen'), 2030);
select is(pg_temp.source('owen', 'birthday'), 'no source', 'non-vacuity: Owen''s birthday has no source');
select is(pg_temp.attempt('owen.testwell@example.test',
  format('update public.profiles set birth_month = 2, birth_day = 3, birth_year = 1990 where id = %L', pg_temp.fx('owen'))),
  'rows:1', 'Owen enters his birthday');
select is(pg_temp.source('owen', 'birthday'), 'no source', 'which is his own two42 data, needing no source');
select is(pg_temp.attempt('owen.testwell@example.test',
  format('update public.profiles set birth_month = null, birth_day = null, birth_year = null where id = %L', pg_temp.fx('owen'))),
  'rows:1', 'then clears it');
select is(pg_temp.source('owen', 'birthday'), 'cleared:{}', 'and the clear is remembered');
select is(pg_temp.as_service(format('select public.records_apply_copy(%L, %L, %L, %L, %L, %L, %L, %L)',
    pg_temp.fx('org'), pg_temp.fx('owen'),
    pg_temp.expected(pg_temp.fx('owen'), null) || '{"states": {"birthday": null}}',
    '{"birth_month": 2, "birth_day": 3, "birth_year": 1990}', '{}', '{}',
    '[{"field": "birthday", "state": "records", "church_value": {"birth_month": 2, "birth_day": 3, "birth_year": 1990}}]',
    '{birthday}')),
  'stale', 'a copy planned before the clear, when the church first supplies the birthday, is refused');
select is((select birth_month from public.profiles where id = pg_temp.fx('owen')), null::smallint, 'so it stays empty');
select is(pg_temp.attempt('admin@local.dev',
  format('update public.family_members set graduation_year = null where claimed_profile_id = %L', pg_temp.fx('owen'))),
  'rows:1', 'a church admin clears his grade, which has no source either');
select is(pg_temp.source('owen', 'grade'), 'cleared:{}', 'and that clear is remembered too');

select is(pg_temp.attempt('grace.testwell@example.test', format(
  'update public.family_units set address_line1 = %L, city = %L where id = %L', '3 Ash St', 'Austin', pg_temp.fx('testwell'))),
  'rows:1', 'Grace enters her linked household''s address');
select is(pg_temp.attempt('grace.testwell@example.test', format(
  'update public.family_units set address_line1 = null, address_line2 = null, city = null, state = null, postal_code = null, '
  'anniversary_month = null, anniversary_day = null, anniversary_year = null where id = %L',
  pg_temp.fx('testwell'))),
  'rows:1', 'then clears it and the anniversary');
select is(array[pg_temp.address_source('testwell'), pg_temp.household('testwell')],
  array['cleared:{}', 'none/cleared:none'], 'both clears are remembered for the household');

select is(pg_temp.attempt('owen.testwell@example.test',
  format('update public.profiles set phone_work = %L where id = %L', '', pg_temp.fx('owen'))),
  'rows:1', 'Owen saves a work phone that was always empty');
select is(pg_temp.source('owen', 'phone_work'), 'no source', 'which isn''t a clear');
select is(pg_temp.attempt('owen.testwell@example.test',
  format('update public.profiles set gender = null where id = %L', pg_temp.fx('owen'))),
  'rows:1', 'Owen clears his gender, which the church locks');
select is(pg_temp.source('owen', 'gender'), 'no source', 'which records no clear: the next copy fills a locked field');
select is(pg_temp.attempt('owen.testwell@example.test',
  format('update public.profiles set birth_month = 2, birth_day = 3 where id = %L', pg_temp.fx('owen'))),
  'rows:1', 'Owen enters his birthday again');
select is(pg_temp.source('owen', 'birthday'), 'changed:{}', 'which makes it his own');

-- ── Who isn't linked, and a church that never connects ──────────────────────
update public.profiles set birth_month = 4, birth_day = 4 where id = pg_temp.fx('mia');
select is(pg_temp.attempt('mia.fakeworth@example.test',
  format('update public.profiles set birth_month = null, birth_day = null where id = %L', pg_temp.fx('mia'))),
  'rows:1', 'Mia, who isn''t linked to the records, clears her birthday');
select is(pg_temp.source('mia', 'birthday'), 'no source', 'and nothing is stored about her');

do $$
declare
  _org uuid;
  _owner uuid := gen_random_uuid();
  _family uuid;
begin
  _org := public.provision_organization('Unconnected Church', 'owner@unconnected.example.test');
  insert into public.access_requests (org_id, name, email, status)
    values (_org, 'Unconnected Owner', 'owner@unconnected.example.test', 'approved');
  insert into auth.users (id, email) values (_owner, 'owner@unconnected.example.test');
  insert into public.family_units (org_id, family_name, anniversary_month, anniversary_day, address_line1, city)
    values (_org, 'Unconnected', 5, 6, '4 Pine St', 'Austin') returning id into _family;
  update public.profiles
     set role = 'admin', family_id = _family, relationship = 'primary', phone_mobile = '+15125550177',
         birth_month = 1, birth_day = 1, avatar_url = 'https://example.test/a.jpg'
   where id = _owner;
  insert into public.records_field_settings (org_id, field, mode)
    select _org, f, 'member' from unnest(array['phone_mobile', 'birthday', 'anniversary', 'address', 'photo']) f;
  insert into fx values ('unconnected', _org), ('unconnected_owner', _owner), ('unconnected_home', _family);
end $$;
select is(
  array[
    pg_temp.attempt('owner@unconnected.example.test', format(
      'update public.profiles set phone_mobile = null, birth_month = null, birth_day = null, avatar_url = null where id = %L',
      pg_temp.fx('unconnected_owner'))),
    pg_temp.attempt('owner@unconnected.example.test', format(
      'update public.family_units set anniversary_month = null, anniversary_day = null, address_line1 = null, city = null where id = %L',
      pg_temp.fx('unconnected_home')))
  ],
  array['rows:1', 'rows:1'], 'a church that never connected its records: its members'' clears save');
select is(
  (select count(*)::int from public.records_field_values where org_id = pg_temp.fx('unconnected'))
  + (select count(*)::int from public.records_household_values where org_id = pg_temp.fx('unconnected'))
  + (select count(*)::int from public.records_household_anniversary where org_id = pg_temp.fx('unconnected')),
  0, 'and it stores no cleared rows');

-- ── Another church ──────────────────────────────────────────────────────────
select is(
  array[
    pg_temp.seen('henry.mockingham@example.test', format(
      'select count(*)::int from public.records_household_anniversary where org_id = %L', pg_temp.fx('other_org'))),
    pg_temp.seen('admin@local.dev', format(
      'select count(*)::int from public.records_household_anniversary where org_id = %L', pg_temp.fx('other_org'))),
    pg_temp.seen('owner@anniversary-boundary.example.test', format(
      'select count(*)::int from public.records_household_anniversary where org_id = %L', pg_temp.fx('org')))
  ],
  array[0, 0, 0], 'nobody reads another church''s household anniversary sources');
select is(pg_temp.seen('oliver.stubbins@example.test', 'select count(*)::int from public.records_household_anniversary'),
  1, 'non-vacuity: a member reads their own household''s');
select is((select array_agg(state || ':' || church_value::text) from public.records_household_anniversary
            where org_id = pg_temp.fx('other_org')),
  array['cleared:{}'], 'and nothing this church did reached the other''s');

select * from finish();
rollback;
