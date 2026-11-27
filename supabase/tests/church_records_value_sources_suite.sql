-- Church records value sources suite: a member's clear outlives the field
-- being turned off and on, in copy mode, in live mode and across Live -> Copy,
-- and confirming a household asks the next refresh to copy the people it
-- moves in full. That a kept 'cleared' source leaves the detail empty at the
-- next copy is proven in supabase/functions/tests/records-copy_test.ts and
-- records-households_test.ts, and that it hides a live detail in
-- lib/integrations/records/live.test.ts.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/church_records_value_sources_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.uid(_email text) returns uuid language sql stable as $$
  select id from public.profiles where email = _email;
$$;

-- A value a signed-in person's call returns, or the SQLSTATE it raises.
create function pg_temp.call(_email text, _sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.uid(_email), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute _sql into r;
    r := coalesce(r, 'null');
  exception when others then
    r := sqlstate;
  end;
  set local role none;
  return r;
end $$;

-- The service role's call, as the server makes it.
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

create function pg_temp.save_fields(_settings jsonb) returns text language sql as $$
  select pg_temp.as_service(format('select public.records_save_field_settings(%L, %L, %L)',
    pg_temp.fx('org'), _settings, pg_temp.fx('admin')));
$$;

create function pg_temp.save_mode(_mode text) returns text language sql as $$
  select pg_temp.as_service(format('select public.records_save_mode(%L, %L, %L) ->> ''outcome''',
    pg_temp.fx('org'), _mode, pg_temp.fx('admin')));
$$;

-- Each source still held for the church, as person:field:state, the
-- household's under its name.
create function pg_temp.sources() returns text[] language sql stable as $$
  select coalesce(array_agg(s order by s), '{}') from (
    select k.key || ':' || v.field || ':' || v.state as s
      from public.records_field_values v join fx k on k.id = v.profile_id
     where v.org_id = pg_temp.fx('org')
    union all
    select 'home:' || v.field || ':' || v.state
      from public.records_household_values v
     where v.org_id = pg_temp.fx('org') and v.family_id = pg_temp.fx('home')
  ) t;
$$;

create function pg_temp.copied(_key text) returns boolean language sql stable as $$
  select copied_at is not null from public.records_person_state where profile_id = pg_temp.fx(_key);
$$;

create function pg_temp.copy_everyone() returns void language sql as $$
  update public.records_person_state set copied_at = now() where org_id = pg_temp.fx('org');
$$;

-- What a person's plan was read from, as the refresh sends it.
create function pg_temp.expected(_profile uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'person', (select l.external_person_id from public.records_person_links l
                where l.profile_id = p.id and l.org_id = p.org_id),
    'profile', public.records_pick(to_jsonb(p), array[
      'first_name', 'last_name', 'preferred_name', 'title', 'suffix', 'gender', 'phone_mobile',
      'phone_work', 'birth_month', 'birth_day', 'birth_year', 'avatar_url']),
    'household', (select public.records_pick(to_jsonb(f), array['anniversary_month', 'anniversary_day', 'anniversary_year'])
                    from public.family_units f where f.id = p.family_id and f.org_id = p.org_id),
    'grade', (select public.records_pick(to_jsonb(m), array['graduation_year'])
                from public.family_members m where m.claimed_profile_id = p.id and m.org_id = p.org_id limit 1))
  from public.profiles p where p.id = _profile;
$$;

-- Leo's full copy as a first fill of the household's anniversary would plan it.
create function pg_temp.copy_leo() returns text language sql as $$
  select pg_temp.as_service(format('select public.records_apply_copy(%L, %L, %L, %L, %L, %L, %L, %L)',
    pg_temp.fx('org'), pg_temp.fx('leo'), pg_temp.expected(pg_temp.fx('leo')), '{}',
    '{"anniversary_month": 6, "anniversary_day": 1, "anniversary_year": 2001}', '{}',
    '[{"field": "anniversary", "state": "records", "church_value": {"anniversary_month": 6, "anniversary_day": 1, "anniversary_year": 2001}}]',
    '{anniversary}'));
$$;

create function pg_temp.fixtureton_anniversary() returns text language sql stable as $$
  select coalesce(anniversary_month::text, 'null') from public.family_units where id = pg_temp.fx('fixtureton');
$$;

-- Ruth clears her household's anniversary, which leaves her source cleared.
create function pg_temp.ruth_clears() returns void language sql as $$
  update public.family_units set anniversary_month = null, anniversary_day = null, anniversary_year = null
   where id = pg_temp.fx('fixtureton');
  insert into public.records_field_values (org_id, profile_id, field, state, church_value)
  values (pg_temp.fx('org'), pg_temp.fx('ruth'), 'anniversary', 'cleared',
          '{"anniversary_month": 6, "anniversary_day": 1, "anniversary_year": 2001}')
  on conflict (org_id, profile_id, field) do update set state = 'cleared';
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Henry (primary) and Chloe (spouse) share the Mockingham household, linked
-- to family F1. Isaac is the primary of another household. Leo and Hannah
-- are the Loremsworth household's primary and spouse, and Ruth is the primary
-- of her own; all are linked.
insert into fx select 'org', org_id from public.profiles where email = 'admin@local.dev';
insert into fx values ('admin', pg_temp.uid('admin@local.dev'));
insert into fx values ('henry', pg_temp.uid('henry.mockingham@example.test'));
insert into fx values ('chloe', pg_temp.uid('chloe.mockingham@example.test'));
insert into fx values ('isaac', pg_temp.uid('isaac.seedly@example.test'));
insert into fx values ('leo', pg_temp.uid('leo.loremsworth@example.test'));
insert into fx values ('hannah', pg_temp.uid('hannah.loremsworth@example.test'));
insert into fx values ('ruth', pg_temp.uid('ruth.fixtureton@example.test'));
insert into fx select 'home', family_id from public.profiles where email = 'henry.mockingham@example.test';
insert into fx select 'loremsworth', family_id from public.profiles where email = 'leo.loremsworth@example.test';
insert into fx select 'fixtureton', family_id from public.profiles where email = 'ruth.fixtureton@example.test';

select is(
  (select array_agg(p.email || ':' || p.role || ':' || p.relationship order by p.email)
     from public.profiles p
    where p.id in (select id from fx where key in ('henry', 'chloe', 'isaac', 'leo', 'hannah', 'ruth'))),
  array['chloe.mockingham@example.test:member:spouse', 'hannah.loremsworth@example.test:member:spouse',
        'henry.mockingham@example.test:member:primary', 'isaac.seedly@example.test:member:primary',
        'leo.loremsworth@example.test:member:primary', 'ruth.fixtureton@example.test:member:primary'],
  'non-vacuity: two households'' primary and spouse, and two people in households of their own');

-- Another church with its own linked person and sources, to show nothing
-- here reaches it.
do $$
declare
  _other uuid;
  _owner uuid := gen_random_uuid();
  _family uuid;
  _connection uuid;
begin
  _other := public.provision_organization('Sources Boundary Church', 'owner@sources-boundary.example.test');
  insert into public.access_requests (org_id, name, email, status)
    values (_other, 'Sources Owner', 'owner@sources-boundary.example.test', 'approved');
  insert into auth.users (id, email) values (_owner, 'owner@sources-boundary.example.test');
  insert into public.family_units (org_id, family_name) values (_other, 'Boundary') returning id into _family;
  update public.profiles set role = 'admin', family_id = _family, relationship = 'primary' where id = _owner;
  insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint, connected_by)
    values (_other, 'rock', 'https://rock.boundary.example', 'k1.kid.iv.sealed', '1111', _owner)
    returning connection_id into _connection;
  insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
    values (_other, _connection, _owner, '900');
  insert into public.records_field_values (org_id, profile_id, field, state, church_value)
    values (_other, _owner, 'birthday', 'cleared', '{"birth_month": 4, "birth_day": 4, "birth_year": 1970}'),
           (_other, _owner, 'phone_work', 'records', '{"phone_work": "+15125550199"}');
  insert into public.records_person_state (org_id, profile_id, copied_at) values (_other, _owner, now());
  insert into public.records_household_suggestions (org_id, connection_id, external_family_id, target_family_id, people, ready)
    values (_other, _connection, 'B1', _family, '[]', true);
  insert into fx values ('other_org', _other), ('other_admin', _owner);
  insert into fx select 'other_suggestion', id from public.records_household_suggestions where org_id = _other;
end $$;

create temp table other_before on commit drop as
  select field, state, church_value from public.records_field_values where org_id = pg_temp.fx('other_org');

insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint, connected_by)
  values (pg_temp.fx('org'), 'rock', 'https://rock.example.org', 'k1.kid.iv.sealed', '9012', pg_temp.fx('admin'));
insert into fx select 'connection', connection_id from public.records_connections where org_id = pg_temp.fx('org');
insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
  select pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx(k), p
    from (values ('henry', '100'), ('chloe', '101'), ('isaac', '102'), ('leo', '103'), ('hannah', '104'), ('ruth', '105')) l(k, p);
insert into public.records_person_state (org_id, profile_id, copied_at)
  select pg_temp.fx('org'), pg_temp.fx(k), now() from unnest(array['henry', 'chloe', 'isaac', 'leo', 'hannah', 'ruth']) k;
insert into public.records_household_links (org_id, family_id, connection_id, external_family_id, confirmed_by)
  values (pg_temp.fx('org'), pg_temp.fx('home'), pg_temp.fx('connection'), 'F1', pg_temp.fx('admin'));
insert into public.records_field_settings (org_id, field, mode)
  select pg_temp.fx('org'), f, 'member' from unnest(array['birthday', 'anniversary', 'address', 'phone_home', 'phone_mobile']) f;

-- What a copy left and what members did with it: Henry cleared his birthday
-- and the household its anniversary (both spouses' sources) and address;
-- Chloe's birthday and the household's home phone are still the church's, and
-- Isaac changed his birthday.
update public.profiles set birth_month = null, birth_day = null, birth_year = null where id = pg_temp.fx('henry');
update public.profiles set birth_month = 7, birth_day = 8, birth_year = 1975 where id = pg_temp.fx('isaac');
update public.family_units set anniversary_month = null, anniversary_day = null, anniversary_year = null,
       address_line1 = null, address_line2 = null, city = null, state = null, postal_code = null
 where id = pg_temp.fx('home');
insert into public.records_field_values (org_id, profile_id, field, state, church_value)
  values (pg_temp.fx('org'), pg_temp.fx('henry'), 'birthday', 'cleared', '{"birth_month": 1, "birth_day": 2, "birth_year": 1980}'),
         (pg_temp.fx('org'), pg_temp.fx('henry'), 'anniversary', 'cleared', '{"anniversary_month": 6, "anniversary_day": 9, "anniversary_year": 2001}'),
         (pg_temp.fx('org'), pg_temp.fx('chloe'), 'anniversary', 'cleared', '{"anniversary_month": 6, "anniversary_day": 9, "anniversary_year": 2001}'),
         (pg_temp.fx('org'), pg_temp.fx('chloe'), 'birthday', 'records', '{"birth_month": 3, "birth_day": 4, "birth_year": 1982}'),
         (pg_temp.fx('org'), pg_temp.fx('isaac'), 'birthday', 'changed', '{"birth_month": 5, "birth_day": 6, "birth_year": 1975}');
insert into public.records_household_values (org_id, family_id, field, state, church_value)
  values (pg_temp.fx('org'), pg_temp.fx('home'), 'address', 'cleared',
          '{"address_line1": "12 Oak St", "address_line2": null, "city": "Austin", "state": "TX", "postal_code": "78701"}'),
         (pg_temp.fx('org'), pg_temp.fx('home'), 'phone_home', 'records', '{"phone_home": "+15125550122"}');

-- ── Copy mode: off and on ───────────────────────────────────────────────────
select is(pg_temp.save_fields('{"phone_mobile": "member"}'), 'saved',
  'the church admin turns the birthday, anniversary, address and home phone off');
select is(pg_temp.sources(),
  array['chloe:anniversary:cleared', 'henry:anniversary:cleared', 'henry:birthday:cleared', 'home:address:cleared'],
  'every member''s clear stays, and the sources that followed the church or a member''s change go');
select is(
  (select count(*)::int from public.records_field_values where org_id = pg_temp.fx('org') and church_value <> '{}'::jsonb)
  + (select count(*)::int from public.records_household_values where org_id = pg_temp.fx('org') and church_value <> '{}'::jsonb),
  0, 'a kept clear forgets the church''s value of a field no longer copied');
select is((select birth_month from public.profiles where id = pg_temp.fx('isaac')), 7::smallint,
  'a value a member changed stays as their own two42 data');

select pg_temp.copy_everyone();
select is(pg_temp.save_fields('{"phone_mobile": "member", "birthday": "member", "anniversary": "member", "address": "member"}'),
  'saved', 'the church admin turns them on again');
select is(pg_temp.sources(),
  array['chloe:anniversary:cleared', 'henry:anniversary:cleared', 'henry:birthday:cleared', 'home:address:cleared'],
  'the clears are there for the next copy, which keeps a cleared detail empty');
select is((select count(*)::int from public.records_person_state where org_id = pg_temp.fx('org') and copied_at is not null), 0,
  'and the next refresh copies everyone in full');

-- ── Live mode: off and on, then Live -> Copy ────────────────────────────────
select is(pg_temp.save_mode('live'), 'saved', 'the church admin switches to live');
select is(pg_temp.call('isaac.seedly@example.test', 'select public.records_live_hide(''birthday'', true)'), '',
  'Isaac hides the birthday shown live');
select is(pg_temp.sources(),
  array['chloe:anniversary:cleared', 'henry:anniversary:cleared', 'henry:birthday:cleared', 'home:address:cleared',
        'isaac:birthday:cleared'],
  'live mode keeps every clear, his hide included');

select is(pg_temp.save_fields('{"phone_mobile": "member"}'), 'saved', 'in live mode the fields are turned off');
select is(pg_temp.save_fields('{"phone_mobile": "member", "birthday": "member", "anniversary": "member", "address": "member"}'),
  'saved', 'and on again');
select is(pg_temp.sources(),
  array['chloe:anniversary:cleared', 'henry:anniversary:cleared', 'henry:birthday:cleared', 'home:address:cleared',
        'isaac:birthday:cleared'],
  'every clear is still there, so the directory keeps the details hidden');

select pg_temp.copy_everyone();
select is(pg_temp.save_mode('copy'), 'saved', 'the church admin switches back to copy');
select is(pg_temp.sources(),
  array['chloe:anniversary:cleared', 'henry:anniversary:cleared', 'henry:birthday:cleared', 'home:address:cleared',
        'isaac:birthday:cleared'],
  'the clears carry into copy mode');
select is((select count(*)::int from public.records_person_state where org_id = pg_temp.fx('org') and copied_at is not null), 0,
  'whose full copy keeps each of them empty');

select is((select array_agg(field || ':' || state || ':' || church_value::text order by field)
             from public.records_field_values where org_id = pg_temp.fx('other_org')),
          (select array_agg(field || ':' || state || ':' || church_value::text order by field) from other_before),
  'another church''s sources are untouched by this church''s saves');
select is((select copied_at is not null from public.records_person_state where profile_id = pg_temp.fx('other_admin')), true,
  'and its people aren''t asked for a full copy');

-- ── Confirming a household ──────────────────────────────────────────────────
-- Leo leaves the Loremsworth household to join Ruth's as her spouse; Hannah
-- stays where she is.
select pg_temp.copy_everyone();
insert into public.records_household_suggestions
  (org_id, connection_id, external_family_id, target_family_id, family_name, people, basis, ready)
values (pg_temp.fx('org'), pg_temp.fx('connection'), 'F2', pg_temp.fx('fixtureton'), null,
  jsonb_build_array(jsonb_build_object('profile_id', pg_temp.fx('leo'), 'from_family_id', pg_temp.fx('loremsworth'),
                                       'from_relationship', 'primary', 'relationship', 'spouse')),
  jsonb_build_array(
    jsonb_build_object('profile_id', pg_temp.fx('ruth'), 'external_person_id', '105', 'family_id', pg_temp.fx('fixtureton')),
    jsonb_build_object('profile_id', pg_temp.fx('leo'), 'external_person_id', '103', 'family_id', pg_temp.fx('loremsworth'))),
  false);
insert into fx select 'suggestion', id from public.records_household_suggestions where org_id = pg_temp.fx('org');

select is(pg_temp.as_service(format('select public.records_confirm_household(%L, %L, %L)',
            pg_temp.fx('org'), pg_temp.fx('other_suggestion'), pg_temp.fx('admin'))), 'gone',
  'another church''s suggestion is no suggestion here');
select is((select copied_at is not null from public.records_person_state where profile_id = pg_temp.fx('other_admin')), true,
  'and nobody there is asked for a full copy');

select is(pg_temp.as_service(format('select public.records_confirm_household(%L, %L, %L)',
            pg_temp.fx('org'), pg_temp.fx('suggestion'), pg_temp.fx('admin'))), 'confirmed',
  'the church admin confirms the household');
select is((select family_id = pg_temp.fx('fixtureton') from public.profiles where id = pg_temp.fx('leo')), true,
  'Leo is in Ruth''s household');
select is(pg_temp.copied('leo'), false,
  'the person it moved is copied in full at the next refresh, which brings in the household''s anniversary');
select is(array[pg_temp.copied('ruth'), pg_temp.copied('hannah'), pg_temp.copied('henry')], array[true, true, true],
  'nobody it didn''t move is asked for a full copy');
select is((select copied_at is not null from public.records_person_state where profile_id = pg_temp.fx('other_admin')), true,
  'nor anyone in another church');

-- ── The full copy of someone who joined ─────────────────────────────────────
update public.family_units set anniversary_month = null, anniversary_day = null, anniversary_year = null
 where id = pg_temp.fx('fixtureton');
select is(pg_temp.copy_leo(), 'applied', 'non-vacuity: with no clear, Leo''s full copy is applied');
select is(pg_temp.fixtureton_anniversary(), '6', 'and brings in the household''s anniversary');

delete from public.records_field_values where profile_id = pg_temp.fx('leo') and field = 'anniversary';
select pg_temp.ruth_clears();
select is(pg_temp.copy_leo(), 'held', 'Leo''s full copy is held against the anniversary Ruth cleared');
select is(pg_temp.fixtureton_anniversary(), 'null', 'so the household''s anniversary stays empty');
select is(pg_temp.sources() @> array['ruth:anniversary:cleared'] and not pg_temp.sources() && array['leo:anniversary:records'],
  true, 'Ruth''s clear stands and Leo gets no source that follows the church');

select pg_temp.save_fields('{"phone_mobile": "member", "birthday": "member", "address": "member"}');
select is(pg_temp.save_fields('{"phone_mobile": "member", "birthday": "member", "anniversary": "member", "address": "member"}'),
  'saved', 'the church admin turns the anniversary off and on with Ruth''s clear in place');
select is(pg_temp.copy_leo(), 'held', 'Leo''s full copy after it is held as well');
select is(pg_temp.fixtureton_anniversary(), 'null', 'and the household''s anniversary still stays empty');

select * from finish();
rollback;
