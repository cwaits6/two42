-- Church records households suite: who sees a household's suggested
-- children, adding and dismissing one, confirming a household suggestion, and
-- the sources of a linked household's address and home phone. The rules that
-- work out suggestions and copies are proven in
-- supabase/functions/tests/records-households_test.ts; this suite proves what
-- the database guarantees around them.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/church_records_households_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(102);

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

-- A value a signed-in person's call returns, or the SQLSTATE it raises.
create function pg_temp.call(_email text, _sql text) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.enter(_email);
  begin
    execute _sql into r;
    r := coalesce(r, 'null');
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

create function pg_temp.kids_seen(_email text) returns int language sql as $$
  select pg_temp.seen(_email, 'select count(*)::int from public.records_child_suggestions');
$$;

create function pg_temp.household_state(_field text) returns text language sql stable as $$
  select state from public.records_household_values where family_id = pg_temp.fx('home') and field = _field;
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- The Mockingham household: Henry (primary) and Chloe (spouse). Ethan joins
-- it as "other" and Walter as a pending spouse, neither of whom is one of its
-- adults. Isaac is the primary of another household; Ruth is in none.
insert into fx select 'org', org_id from public.profiles where email = 'admin@local.dev';
insert into fx values ('admin', pg_temp.uid('admin@local.dev'));
insert into fx values ('henry', pg_temp.uid('henry.mockingham@example.test'));
insert into fx values ('chloe', pg_temp.uid('chloe.mockingham@example.test'));
insert into fx values ('isaac', pg_temp.uid('isaac.seedly@example.test'));
insert into fx values ('leo', pg_temp.uid('leo.loremsworth@example.test'));
insert into fx values ('hannah', pg_temp.uid('hannah.loremsworth@example.test'));
insert into fx select 'home', family_id from public.profiles where email = 'henry.mockingham@example.test';
insert into fx select 'seedly', family_id from public.profiles where email = 'isaac.seedly@example.test';
insert into fx select 'loremsworth', family_id from public.profiles where email = 'leo.loremsworth@example.test';

update public.profiles set family_id = pg_temp.fx('home'), relationship = 'other'
 where email = 'ethan.placeholder@example.test';
update public.profiles set family_id = pg_temp.fx('home'), relationship = 'spouse', role = 'pending'
 where email = 'walter.nullington@example.test';
update public.profiles set family_id = null where email = 'ruth.fixtureton@example.test';

do $$
declare
  _other uuid;
  _owner uuid := gen_random_uuid();
  _family uuid;
begin
  _other := public.provision_organization('Households Boundary Church', 'owner@households-boundary.example.test');
  insert into public.access_requests (org_id, name, email, status)
    values (_other, 'Households Owner', 'owner@households-boundary.example.test', 'approved');
  insert into auth.users (id, email) values (_owner, 'owner@households-boundary.example.test');
  insert into public.family_units (org_id, family_name) values (_other, 'Boundary') returning id into _family;
  update public.profiles set role = 'admin', family_id = _family, relationship = 'primary' where id = _owner;
  insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint, connected_by)
    values (_other, 'rock', 'https://rock.boundary.example', 'k1.kid.iv.sealed', '1111', _owner);
  insert into public.records_household_suggestions (org_id, connection_id, external_family_id, target_family_id, people, ready)
    select _other, connection_id, 'B1', _family, '[]', true from public.records_connections where org_id = _other;
  insert into fx values ('other_org', _other), ('other_admin', _owner), ('other_home', _family);
  insert into fx select 'other_suggestion', id from public.records_household_suggestions where org_id = _other;
end $$;

select is(
  (select array_agg(p.email || ':' || p.role || ':' || p.relationship || ':' || coalesce((p.family_id = pg_temp.fx('home'))::text, 'none')
                    order by p.email)
     from public.profiles p
    where p.email in ('henry.mockingham@example.test', 'chloe.mockingham@example.test', 'ethan.placeholder@example.test',
                      'walter.nullington@example.test', 'isaac.seedly@example.test', 'ruth.fixtureton@example.test')),
  array['chloe.mockingham@example.test:member:spouse:true', 'ethan.placeholder@example.test:member:other:true',
        'henry.mockingham@example.test:member:primary:true', 'isaac.seedly@example.test:member:primary:false',
        'ruth.fixtureton@example.test:member:primary:none', 'walter.nullington@example.test:pending:spouse:true'],
  'non-vacuity: the household, its other people, a member of another household and one of none');

insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint, connected_by)
  values (pg_temp.fx('org'), 'rock', 'https://rock.example.org', 'k1.kid.iv.sealed', '9012', pg_temp.fx('admin'));
insert into fx select 'connection', connection_id from public.records_connections where org_id = pg_temp.fx('org');
insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
  select pg_temp.fx('org'), pg_temp.fx('connection'), l.profile_id, l.person
    from (values (pg_temp.fx('henry'), '100'), (pg_temp.fx('chloe'), '101'),
                 (pg_temp.fx('isaac'), '102'), (pg_temp.fx('leo'), '103')) l(profile_id, person);
insert into public.records_household_links (org_id, family_id, connection_id, external_family_id, confirmed_by)
  values (pg_temp.fx('org'), pg_temp.fx('home'), pg_temp.fx('connection'), 'F1', pg_temp.fx('admin'));

-- ── The boundary on every table ─────────────────────────────────────────────
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.records_org_settings'::regclass, 'public.records_household_links'::regclass,
                  'public.records_household_values'::regclass, 'public.records_household_suggestions'::regclass,
                  'public.records_child_suggestions'::regclass)),
  'row level security is on for all five tables');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('records_org_settings', 'records_household_links', 'records_household_values',
                        'records_household_suggestions', 'records_child_suggestions')
      and policyname = 'org isolation' and permissive = 'RESTRICTIVE'),
  5, 'each table has the restrictive org isolation policy');

select hasnt_column('public', 'records_child_suggestions', 'birth_year', 'a suggested child has nowhere to keep a birth year');

-- ── Suggested children: nothing while the switch is off ────────────────────
select is(
  public.records_sync_child_suggestions(pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('home'), 'F1',
    '[{"external_person_id": "200", "first_name": "Lily", "last_name": "Mockingham", "birth_month": 3, "birth_day": 3, "graduation_year": 2034, "photo": "7"}]'),
  0, 'with the switch off (no settings row), no child is suggested');
select is((select count(*)::int from public.records_child_suggestions where org_id = pg_temp.fx('org')), 0,
  'and nothing about the child is stored');

select is(public.records_save_children_setting(pg_temp.fx('org'), true, pg_temp.fx('admin')), 'saved',
  'a church admin turns the switch on through the server');
select is(
  public.records_sync_child_suggestions(pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('home'), 'F1',
    '[{"external_person_id": "200", "first_name": "Lily", "last_name": "Mockingham", "birth_month": 3, "birth_day": 3, "graduation_year": 2034, "photo": "7"},
      {"external_person_id": "201", "first_name": "Max", "last_name": "Mockingham", "birth_month": null, "birth_day": null, "graduation_year": null, "photo": null}]'),
  2, 'with it on, the household''s two children are suggested');
select is(
  public.records_sync_child_suggestions(pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('home'), 'F9', '[{"external_person_id": "202", "first_name": "Zed", "last_name": "Other"}]'),
  0, 'children of a family the household isn''t linked to are never suggested to it');
select is(
  public.records_sync_child_suggestions(pg_temp.fx('org'), gen_random_uuid(), pg_temp.fx('home'), 'F1', '[{"external_person_id": "202", "first_name": "Zed", "last_name": "Other"}]'),
  0, 'nor by a refresh of another connection linked to the same family');

-- ── Suggested children: who sees them ───────────────────────────────────────
select is(pg_temp.kids_seen('henry.mockingham@example.test'), 2, 'the household''s primary sees its two suggested children');
select is(pg_temp.kids_seen('chloe.mockingham@example.test'), 2, 'the household''s spouse sees them');
select is(pg_temp.kids_seen('ethan.placeholder@example.test'), 0, 'someone else in the household sees none');
select is(pg_temp.kids_seen('walter.nullington@example.test'), 0, 'a pending spouse in the household sees none');
select is(pg_temp.kids_seen('isaac.seedly@example.test'), 0, 'the primary of another household sees none');
select is(pg_temp.kids_seen('ruth.fixtureton@example.test'), 0, 'a member in no household sees none');
select is(pg_temp.kids_seen('admin@local.dev'), 0, 'a church admin outside the household sees none');
select is(pg_temp.kids_seen('owner@households-boundary.example.test'), 0, 'a church admin of another church sees none');
select is(pg_temp.attempt(null, 'select count(*) from public.records_child_suggestions'), '42501',
  'a signed-out request can''t read them at all');
select is(pg_temp.attempt('henry.mockingham@example.test', 'select external_person_id from public.records_child_suggestions'),
  '42501', 'not even the household reads a child''s id in the records');
select is(pg_temp.attempt('henry.mockingham@example.test', 'select photo from public.records_child_suggestions'),
  '42501', 'or the photo''s token');

update public.records_org_settings set suggest_children = false where org_id = pg_temp.fx('org');
select is(pg_temp.kids_seen('henry.mockingham@example.test'), 0, 'with the switch off, the household sees none of its rows');
select is(
  pg_temp.call('henry.mockingham@example.test',
    format('select public.records_add_suggested_child(%L)::text',
           (select id from public.records_child_suggestions where external_person_id = '200'))),
  'RC001', 'and can''t add one');
update public.records_org_settings set suggest_children = true where org_id = pg_temp.fx('org');

insert into fx select 'lily', id from public.records_child_suggestions where external_person_id = '200';
insert into fx select 'max', id from public.records_child_suggestions where external_person_id = '201';

-- ── Adding and dismissing ───────────────────────────────────────────────────
select is(
  pg_temp.call('isaac.seedly@example.test', format('select public.records_add_suggested_child(%L)::text', pg_temp.fx('lily'))),
  'RC001', 'another household''s primary can''t add the child');
select is(
  pg_temp.call('ethan.placeholder@example.test', format('select public.records_add_suggested_child(%L)::text', pg_temp.fx('lily'))),
  'RC001', 'someone in the household who isn''t one of its adults can''t');
select is(
  pg_temp.call('owner@households-boundary.example.test', format('select public.records_add_suggested_child(%L)::text', pg_temp.fx('lily'))),
  'RC001', 'a church admin of another church can''t');
select is(
  pg_temp.call(null, format('select public.records_add_suggested_child(%L)::text', pg_temp.fx('lily'))),
  '42501', 'a signed-out request can''t call it');
select is((select count(*)::int from public.family_members where family_id = pg_temp.fx('home') and first_name = 'Lily'), 0,
  'none of the refused adds wrote anything');

insert into fx select 'lily_entry',
  pg_temp.call('henry.mockingham@example.test', format('select public.records_add_suggested_child(%L)::text', pg_temp.fx('lily')))::uuid;
select is(
  (select row(m.first_name, m.last_name, m.relationship, m.birth_month, m.birth_day, m.birth_year, m.graduation_year, m.is_class_member)::text
     from public.family_members m where m.id = pg_temp.fx('lily_entry') and m.family_id = pg_temp.fx('home')),
  row('Lily', 'Mockingham', 'child', 3::smallint, 3::smallint, null::smallint, 2034::smallint, false)::text,
  'the household''s primary adds her as a child of the household, with no birth year');
select is(
  (select row(state, first_name, last_name, birth_month, graduation_year, photo, family_member_id = pg_temp.fx('lily_entry'))::text
     from public.records_child_suggestions where id = pg_temp.fx('lily')),
  row('added', null::text, null::text, null::smallint, null::smallint, '7', true)::text,
  'her suggestion keeps only the decision, and the photo token for the refresh');
select is(pg_temp.kids_seen('henry.mockingham@example.test'), 1, 'she is no longer suggested');
select is(
  pg_temp.call('chloe.mockingham@example.test', format('select public.records_add_suggested_child(%L)::text', pg_temp.fx('lily'))),
  'RC001', 'and can''t be added twice');

select is(
  pg_temp.call('isaac.seedly@example.test', format('select public.records_dismiss_suggested_child(%L)::text', pg_temp.fx('max'))),
  'RC001', 'another household''s primary can''t dismiss a child');
select is(
  pg_temp.call('chloe.mockingham@example.test', format('select public.records_dismiss_suggested_child(%L)::text', pg_temp.fx('max'))),
  '', 'the household''s spouse dismisses him');
select is(
  (select row(state, first_name, last_name, photo)::text from public.records_child_suggestions where id = pg_temp.fx('max')),
  row('dismissed', null::text, null::text, null::text)::text, 'his suggestion keeps nothing about him but the decision');

select is(
  public.records_sync_child_suggestions(pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('home'), 'F1',
    '[{"external_person_id": "200", "first_name": "Lily", "last_name": "Mockingham", "birth_month": 3, "birth_day": 3, "graduation_year": 2034, "photo": "7"},
      {"external_person_id": "201", "first_name": "Max", "last_name": "Mockingham", "birth_month": null, "birth_day": null, "graduation_year": null, "photo": null}]'),
  0, 'the next refresh brings neither back');
select is(
  (select array_agg(state order by external_person_id) from public.records_child_suggestions where family_id = pg_temp.fx('home')),
  array['added', 'dismissed'], 'they stay added and dismissed');
select is(pg_temp.kids_seen('henry.mockingham@example.test'), 0, 'and are suggested to nobody');

select is(
  public.records_sync_child_suggestions(pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('home'), 'F1',
    '[{"external_person_id": "203", "first_name": "June", "last_name": "Mockingham"}]'),
  1, 'a new child in the family is suggested');
select is(
  public.records_sync_child_suggestions(pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('home'), 'F1',
    '[{"external_person_id": "203", "first_name": "June", "last_name": "Mockingham"},
      {"external_person_id": "204", "first_name": "Rosé", "last_name": "Mockingham"}]'),
  1, 'and another');
insert into public.family_members (org_id, family_id, first_name, last_name, relationship)
  values (pg_temp.fx('org'), pg_temp.fx('home'), 'rose', 'Mockingham', 'child');
select is(
  pg_temp.call('henry.mockingham@example.test', format('select public.records_add_suggested_child(%L)::text',
    (select id from public.records_child_suggestions where external_person_id = '204'))),
  (select id::text from public.family_members where family_id = pg_temp.fx('home') and first_name = 'rose'),
  'adding a child the household entered meanwhile under the same name settles on that entry');
select is((select count(*)::int from public.family_members where family_id = pg_temp.fx('home') and first_name ilike 'ros%'), 1,
  'rather than adding them twice');
select is(
  public.records_sync_child_suggestions(pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('home'), 'F1',
    '[{"external_person_id": "203", "first_name": "June", "last_name": "Mockingham"},
      {"external_person_id": "204", "first_name": "Rosé", "last_name": "Mockingham"},
      {"external_person_id": "205", "first_name": "Rose", "last_name": "Mockingham"}]'),
  1, 'another child of the same name is suggested');
select isnt(
  pg_temp.call('henry.mockingham@example.test', format('select public.records_add_suggested_child(%L)::text',
    (select id from public.records_child_suggestions where external_person_id = '205'))),
  (select id::text from public.family_members where family_id = pg_temp.fx('home') and first_name = 'rose'),
  'adding them doesn''t settle on the entry the first was added as');
select is((select count(*)::int from public.family_members where family_id = pg_temp.fx('home') and first_name ilike 'ros%'), 2,
  'they get their own entry');
insert into public.family_members (org_id, family_id, first_name, last_name, relationship)
  values (pg_temp.fx('org'), pg_temp.fx('home'), 'June', 'Mockingham', 'parent');
select isnt(
  pg_temp.call('henry.mockingham@example.test', format('select public.records_add_suggested_child(%L)::text',
    (select id from public.records_child_suggestions where external_person_id = '203'))),
  (select id::text from public.family_members where family_id = pg_temp.fx('home') and first_name = 'June' and relationship = 'parent'),
  'adding a child doesn''t settle on an adult of the same name');
select is((select count(*)::int from public.family_members where family_id = pg_temp.fx('home') and first_name = 'June' and relationship = 'child'), 1,
  'the child gets their own entry');
select is(
  public.records_sync_child_suggestions(pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('home'), 'F1',
    '[{"external_person_id": "203", "first_name": "June", "last_name": "Mockingham"},
      {"external_person_id": "204", "first_name": "Rosé", "last_name": "Mockingham"},
      {"external_person_id": "205", "first_name": "Rose", "last_name": "Mockingham"},
      {"external_person_id": "206", "first_name": "Ada", "last_name": "Mockingham"}]'),
  1, 'one more child is suggested');
select is(public.records_save_children_setting(pg_temp.fx('org'), false, pg_temp.fx('admin')), 'saved',
  'the church admin turns the switch off');
select is(
  (select array_agg(state || ':' || coalesce(photo, '-') order by external_person_id)
     from public.records_child_suggestions where family_id = pg_temp.fx('home')),
  array['added:-', 'dismissed:-', 'added:-', 'added:-', 'added:-'],
  'turning it off removes the open suggestion and the waiting photo token, keeping the decisions');

-- ── What members can't do ───────────────────────────────────────────────────
select is(pg_temp.attempt('henry.mockingham@example.test', format(
    'update public.records_child_suggestions set state = %L where id = %L', 'open', pg_temp.fx('max'))),
  '42501', 'a member can''t change a suggestion directly');
select is(pg_temp.attempt('admin@local.dev', 'select count(*) from public.records_household_links'), '42501',
  'household links are the server''s alone');
select is(pg_temp.attempt('admin@local.dev', 'select count(*) from public.records_household_suggestions'), '42501',
  'and so are household suggestions');
select is(pg_temp.attempt('admin@local.dev', format(
    'update public.records_org_settings set suggest_children = true where org_id = %L', pg_temp.fx('org'))),
  '42501', 'not even a church admin turns the switch on outside the server');
select is(pg_temp.attempt('henry.mockingham@example.test', format(
    'insert into public.records_household_values (org_id, family_id, field, state) values (%L, %L, %L, %L)',
    pg_temp.fx('org'), pg_temp.fx('home'), 'address', 'records')),
  '42501', 'a member can''t write a household source');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('records_save_children_setting', 'records_replace_household_suggestions', 'records_confirm_household',
                        'records_apply_household_copy', 'records_sync_child_suggestions', 'records_household_value_edit')
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  null, 'no client role can execute the service-key functions');

-- ── Confirming a household suggestion ───────────────────────────────────────
create temp table before_households on commit drop as
  select id, family_id, relationship from public.profiles;
select is(
  public.records_replace_household_suggestions(pg_temp.fx('org'), pg_temp.fx('connection'), jsonb_build_array(
    jsonb_build_object('external_family_id', 'F2', 'target_family_id', pg_temp.fx('seedly'), 'family_name', null, 'ready', false,
      'people', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.fx('leo'), 'from_family_id', pg_temp.fx('loremsworth'), 'from_relationship', 'primary', 'relationship', 'spouse'))),
    jsonb_build_object('external_family_id', 'F3', 'target_family_id', gen_random_uuid(), 'family_name', null, 'ready', true, 'people', '[]'::jsonb))),
  1, 'the refresh''s suggestions are stored, leaving out one into a household that no longer exists');
select is(
  (select count(*)::int from public.profiles p join before_households b using (id)
    where (p.family_id, p.relationship) is distinct from (b.family_id, b.relationship)),
  0, 'storing suggestions changes nobody''s household');
insert into fx select 'leo_suggestion', id from public.records_household_suggestions where external_family_id = 'F2';

insert into public.records_refresh_state (org_id, connection_id, running_since)
  values (pg_temp.fx('org'), pg_temp.fx('connection'), now())
  on conflict (org_id) do update set running_since = excluded.running_since;
select is(public.records_confirm_household(pg_temp.fx('org'), pg_temp.fx('leo_suggestion'), pg_temp.fx('admin')), 'busy',
  'a confirmation is refused while a refresh is replacing the suggestions');
select is(public.records_save_children_setting(pg_temp.fx('org'), true, pg_temp.fx('admin')), 'busy',
  'so is the children switch, since that refresh read it when it started');
select is((select suggest_children from public.records_org_settings where org_id = pg_temp.fx('org')), false,
  'and the switch stays as it was');
update public.records_refresh_state set running_since = null where org_id = pg_temp.fx('org');

select is(public.records_confirm_household(pg_temp.fx('org'), pg_temp.fx('other_suggestion'), pg_temp.fx('admin')), 'gone',
  'another church''s suggestion is no suggestion here');
select is((select count(*)::int from public.records_household_suggestions where org_id = pg_temp.fx('other_org')), 1,
  'and is left as it was');

update public.profiles set family_id = null where id = pg_temp.fx('leo');
select is(public.records_confirm_household(pg_temp.fx('org'), pg_temp.fx('leo_suggestion'), pg_temp.fx('admin')), 'stale',
  'someone who moved since the refresh makes the suggestion stale');
select is((select family_id from public.profiles where id = pg_temp.fx('leo')), null, 'and nothing moves');
update public.profiles set family_id = pg_temp.fx('loremsworth') where id = pg_temp.fx('leo');

-- Isaac, already in the household, is what made it this family's.
update public.records_household_suggestions
   set basis = jsonb_build_array(
     jsonb_build_object('profile_id', pg_temp.fx('isaac'), 'external_person_id', '102', 'family_id', pg_temp.fx('seedly')),
     jsonb_build_object('profile_id', pg_temp.fx('leo'), 'external_person_id', '103', 'family_id', pg_temp.fx('loremsworth')))
 where id = pg_temp.fx('leo_suggestion');
update public.records_person_links set external_person_id = '199' where profile_id = pg_temp.fx('leo');
select is(public.records_confirm_household(pg_temp.fx('org'), pg_temp.fx('leo_suggestion'), pg_temp.fx('admin')), 'stale',
  'someone relinked to another person in the records since the refresh makes it stale');
update public.records_person_links set external_person_id = '103' where profile_id = pg_temp.fx('leo');
update public.profiles set family_id = null where id = pg_temp.fx('isaac');
select is(public.records_confirm_household(pg_temp.fx('org'), pg_temp.fx('leo_suggestion'), pg_temp.fx('admin')), 'stale',
  'so does someone leaving the household the suggestion chose because of them');
select is((select family_id from public.profiles where id = pg_temp.fx('leo')), pg_temp.fx('loremsworth'), 'and nobody moves');
update public.profiles set family_id = pg_temp.fx('seedly') where id = pg_temp.fx('isaac');
update public.profiles set relationship = 'other' where id = pg_temp.fx('leo');
select is(public.records_confirm_household(pg_temp.fx('org'), pg_temp.fx('leo_suggestion'), pg_temp.fx('admin')), 'stale',
  'someone named whose relationship changed since the refresh makes it stale, so the change isn''t undone');
select is((select relationship from public.profiles where id = pg_temp.fx('leo')), 'other', 'and their relationship stays');
update public.profiles set relationship = 'primary' where id = pg_temp.fx('leo');

select is(public.records_confirm_household(pg_temp.fx('org'), pg_temp.fx('leo_suggestion'), pg_temp.fx('admin')), 'confirmed',
  'the church admin confirms it');
select is(
  (select row(family_id = pg_temp.fx('seedly'), relationship)::text from public.profiles where id = pg_temp.fx('leo')),
  row(true, 'spouse')::text, 'the person it names is in its household, as it named them');
select is(
  (select row(family_id, connection_id = pg_temp.fx('connection'), confirmed_by = pg_temp.fx('admin'))::text
     from public.records_household_links where external_family_id = 'F2'),
  row(pg_temp.fx('seedly'), true, true)::text, 'the household is linked to its family');
select is((select count(*)::int from public.records_household_suggestions where id = pg_temp.fx('leo_suggestion')), 0,
  'and the suggestion is done');
select is(
  (select count(*)::int from public.profiles where id = pg_temp.fx('hannah') and family_id = pg_temp.fx('loremsworth')),
  1, 'the household he left keeps everyone else in it');

insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
  values (pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('hannah'), '105'),
         (pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.uid('ruth.fixtureton@example.test'), '104');
select public.records_replace_household_suggestions(pg_temp.fx('org'), pg_temp.fx('connection'), jsonb_build_array(
  jsonb_build_object('external_family_id', 'F2', 'target_family_id', pg_temp.fx('seedly'), 'family_name', null, 'ready', false,
    'people', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.fx('hannah'), 'from_family_id', pg_temp.fx('loremsworth'), 'from_relationship', 'spouse', 'relationship', 'primary'))),
  jsonb_build_object('external_family_id', 'F5', 'target_family_id', pg_temp.fx('home'), 'family_name', null, 'ready', false,
    'people', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.fx('hannah'), 'from_family_id', pg_temp.fx('loremsworth'), 'from_relationship', 'spouse', 'relationship', 'other'))),
  jsonb_build_object('external_family_id', 'F4', 'target_family_id', null, 'family_name', 'Fixtureton', 'ready', true,
    'people', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.uid('ruth.fixtureton@example.test'), 'from_family_id', null, 'from_relationship', 'primary', 'relationship', 'primary')))));
create temp table before_guards on commit drop as select id, family_id, relationship from public.profiles;
create temp table before_units on commit drop as select id from public.family_units;

select is(
  public.records_confirm_household(pg_temp.fx('org'),
    (select id from public.records_household_suggestions where external_family_id = 'F2'), pg_temp.fx('admin')),
  'stale', 'a suggestion naming a primary for a household that keeps its own primary is stale');
select is(
  public.records_confirm_household(pg_temp.fx('org'),
    (select id from public.records_household_suggestions where external_family_id = 'F5'), pg_temp.fx('admin')),
  'stale', 'so is one into a household linked to another family');
select is(
  (select count(*)::int from public.profiles p join before_guards b using (id)
    where (p.family_id, p.relationship) is distinct from (b.family_id, b.relationship)),
  0, 'and neither moves anyone');

select is(
  public.records_confirm_household(pg_temp.fx('org'),
    (select id from public.records_household_suggestions where external_family_id = 'F4'), pg_temp.fx('admin')),
  'confirmed', 'the church admin confirms a suggestion for a new household');
select is(
  (select row(f.org_id = pg_temp.fx('org'), f.family_name, p.relationship, f.id in (select id from before_units))::text
     from public.profiles p join public.family_units f on f.id = p.family_id
    where p.id = pg_temp.uid('ruth.fixtureton@example.test')),
  row(true, 'Fixtureton', 'primary', false)::text, 'the person it names is the primary of a new household in this church');
select is(
  (select l.family_id from public.records_household_links l where l.org_id = pg_temp.fx('org') and l.external_family_id = 'F4'),
  (select family_id from public.profiles where id = pg_temp.uid('ruth.fixtureton@example.test')),
  'and the new household is linked to its family');

-- ── A linked household's address and home phone ─────────────────────────────
select is(
  public.records_apply_household_copy(pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('home'),
    jsonb_build_object('family', 'F9', 'household', '{}'::jsonb, 'states', '{}'::jsonb), '{}', '[]'),
  'unlinked', 'a copy read from another family isn''t written');
select is(
  public.records_apply_household_copy(pg_temp.fx('org'), gen_random_uuid(), pg_temp.fx('home'),
    jsonb_build_object('family', 'F1', 'household', '{}'::jsonb, 'states', '{}'::jsonb), '{}', '[]'),
  'unlinked', 'nor one from a refresh of another connection');
select is(
  public.records_apply_household_copy(pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('other_home'),
    jsonb_build_object('family', 'F1', 'household', '{}'::jsonb, 'states', '{}'::jsonb), '{}', '[]'),
  'gone', 'nor one for another church''s household');
select is(
  public.records_apply_household_copy(pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('home'),
    jsonb_build_object('family', 'F1',
      'household', (select public.records_pick(to_jsonb(f), array['address_line1', 'phone_home']) || '{"address_line1": "Not What It Holds"}'
                      from public.family_units f where f.id = pg_temp.fx('home')),
      'states', '{}'::jsonb),
    '{"address_line1": "12 Oak St"}', '[]'),
  'stale', 'a copy worked out from values that changed meanwhile isn''t written');

select is(
  public.records_save_field_settings(pg_temp.fx('org'), '{"address": "member", "phone_home": "member"}', pg_temp.fx('admin')),
  'saved', 'the church admin fills the address and home phone from the records');

select is(
  public.records_apply_household_copy(pg_temp.fx('org'), pg_temp.fx('connection'), pg_temp.fx('home'),
    jsonb_build_object('family', 'F1',
      'household', (select public.records_pick(to_jsonb(f), array['address_line1', 'address_line2', 'city', 'state', 'postal_code', 'phone_home', 'phone_profile_id'])
                      from public.family_units f where f.id = pg_temp.fx('home')),
      'states', '{"address": null, "phone_home": null}'::jsonb),
    '{"address_line1": "12 Oak St", "address_line2": null, "city": "Austin", "state": "TX", "postal_code": "78701", "phone_home": "+15125550122"}',
    '[{"field": "address", "state": "records", "church_value": {"address_line1": "12 Oak St", "address_line2": null, "city": "Austin", "state": "TX", "postal_code": "78701"}},
      {"field": "phone_home", "state": "records", "church_value": {"phone_home": "+15125550122"}}]'),
  'applied', 'the family''s address and home phone fill the linked household');
select is(
  (select row(address_line1, city, phone_home)::text from public.family_units where id = pg_temp.fx('home')),
  row('12 Oak St', 'Austin', '+15125550122')::text, 'and are written to it');

select is(pg_temp.seen('henry.mockingham@example.test', 'select count(*)::int from public.records_household_values'), 2,
  'the household reads where its address and phone came from');
select is(pg_temp.seen('isaac.seedly@example.test', 'select count(*)::int from public.records_household_values'), 0,
  'another household doesn''t');
select is(pg_temp.seen('owner@households-boundary.example.test', 'select count(*)::int from public.records_household_values'), 0,
  'nor does another church');

select is(pg_temp.attempt('henry.mockingham@example.test', format(
    'update public.family_units set address_line1 = %L where id = %L', '9 Elm Rd', pg_temp.fx('home'))),
  'rows:1', 'the household''s primary changes the address');
select is(pg_temp.household_state('address'), 'changed', 'and it is theirs from then on');
select is(pg_temp.attempt('chloe.mockingham@example.test', format(
    'update public.family_units set address_line1 = null, address_line2 = null, city = null, state = null, postal_code = null where id = %L',
    pg_temp.fx('home'))),
  'rows:1', 'the spouse clears it');
select is(pg_temp.household_state('address'), 'cleared', 'a clear is recorded, so the copy leaves it cleared');

select is(pg_temp.attempt('chloe.mockingham@example.test', format(
    'update public.family_units set phone_profile_id = %L where id = %L', pg_temp.fx('chloe'), pg_temp.fx('home'))),
  'rows:1', 'the spouse makes her own number the household phone');
select is(pg_temp.household_state('phone_home'), 'cleared', 'which clears the church''s home phone, and that sticks');

update public.family_units set address_line1 = '1 Service Way' where id = pg_temp.fx('home');
select is(pg_temp.household_state('address'), 'cleared', 'a write by the server isn''t counted as the household''s edit');

select is(
  public.records_save_field_settings(pg_temp.fx('org'), '{"phone_home": "member"}', pg_temp.fx('admin')),
  'saved', 'the church admin stops filling the address from the records');
select is(
  (select array_agg(field || ':' || state || ':' || church_value::text order by field)
     from public.records_household_values where family_id = pg_temp.fx('home') and field = 'address'),
  array['address:cleared:{}'], 'the household''s clear of the address stays, without the church''s value');
select is(
  (select array_agg(field) from public.records_field_settings where org_id = pg_temp.fx('org')),
  array['phone_home'], 'the address is no longer filled from the records');
select is(
  (select address_line1 from public.family_units where id = pg_temp.fx('home')),
  '1 Service Way', 'and the household keeps the address it has');

select * from finish();
rollback;
