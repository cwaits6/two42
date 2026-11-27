-- Church records live suite: switching between copy and live, what Copy ->
-- Live removes and keeps, the guards that keep live mode from storing an
-- address, birthday, anniversary or grade from the records, a member hiding a
-- detail shown live, and one church's church-records rows unreachable from
-- another on every records_* table. Which people the directory asks the
-- records about is proven in lib/integrations/records/live.test.ts; the
-- refresh leaving live-only fields out in supabase/functions/tests/records-refresh_test.ts.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/church_records_live_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.uid(_email text) returns uuid language sql stable as $$
  select id from public.profiles where email = _email;
$$;

create function pg_temp.enter(_email text) returns void language plpgsql as $$
begin
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.uid(_email), 'role', 'authenticated')::text, true);
  set local role authenticated;
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

-- The SQLSTATE a statement run as the service role raises, or 'ok'.
create function pg_temp.as_service(_sql text) returns text language plpgsql as $$
declare r text := 'ok';
begin
  set local role service_role;
  begin
    execute _sql;
  exception when others then
    r := sqlstate;
  end;
  set local role none;
  return r;
end $$;

create temp table fx (key text primary key, id uuid) on commit drop;
create function pg_temp.fx_rows(_tbl text, _org uuid) returns int language plpgsql as $$
declare n int;
begin
  execute format('select count(*)::int from public.%I where org_id = %L', _tbl, _org) into n;
  return n;
end $$;
grant select on fx to anon, authenticated, service_role;
create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;

-- Every address, birthday, anniversary or grade from the records two42 holds
-- for a church: a live-only source that is the church's or keeps its value,
-- and a child suggestion carrying a birthday or grade.
create function pg_temp.live_details_stored(_org uuid) returns int language sql stable as $$
  select (
    (select count(*) from public.records_field_values
      where org_id = _org and field in ('birthday', 'anniversary', 'grade')
        and (state = 'records' or church_value <> '{}'::jsonb))
  + (select count(*) from public.records_household_values
      where org_id = _org and field = 'address' and (state = 'records' or church_value <> '{}'::jsonb))
  + (select count(*) from public.records_child_suggestions
      where org_id = _org and (birth_month is not null or birth_day is not null or graduation_year is not null))
  )::int;
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Henry (primary) and Chloe (spouse) share the Mockingham household, linked
-- to family F1; Isaac is the primary of the Seedly household, linked to F2,
-- and Ruth joins it as his spouse. Mia and her household aren't linked at all.
insert into fx select 'org', org_id from public.profiles where email = 'admin@local.dev';
insert into fx values ('admin', pg_temp.uid('admin@local.dev'));
insert into fx values ('henry', pg_temp.uid('henry.mockingham@example.test'));
insert into fx values ('chloe', pg_temp.uid('chloe.mockingham@example.test'));
insert into fx values ('isaac', pg_temp.uid('isaac.seedly@example.test'));
insert into fx values ('ruth', pg_temp.uid('ruth.fixtureton@example.test'));
insert into fx values ('mia', pg_temp.uid('mia.fakeworth@example.test'));
insert into fx select 'home', family_id from public.profiles where email = 'henry.mockingham@example.test';
insert into fx select 'seedly', family_id from public.profiles where email = 'isaac.seedly@example.test';

select is(
  (select array_agg(p.email || ':' || p.relationship || ':' || coalesce((p.family_id = pg_temp.fx('home'))::text, 'none') order by p.email)
     from public.profiles p
    where p.email in ('henry.mockingham@example.test', 'chloe.mockingham@example.test', 'isaac.seedly@example.test',
                      'mia.fakeworth@example.test')),
  array['chloe.mockingham@example.test:spouse:true', 'henry.mockingham@example.test:primary:true',
        'isaac.seedly@example.test:primary:false', 'mia.fakeworth@example.test:primary:false'],
  'non-vacuity: a household''s primary and spouse, the primary of another, and someone else');

update public.profiles set family_id = pg_temp.fx('seedly'), relationship = 'spouse' where id = pg_temp.fx('ruth');

insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint, connected_by)
  values (pg_temp.fx('org'), 'rock', 'https://rock.example.org', 'k1.kid.iv.sealed', '9012', pg_temp.fx('admin'));
insert into fx select 'connection', connection_id from public.records_connections where org_id = pg_temp.fx('org');
insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
  select pg_temp.fx('org'), pg_temp.fx('connection'), l.profile_id, l.person
    from (values (pg_temp.fx('henry'), '100'), (pg_temp.fx('chloe'), '101'), (pg_temp.fx('isaac'), '102'), (pg_temp.fx('ruth'), '103')) l(profile_id, person);
insert into public.records_household_links (org_id, family_id, connection_id, external_family_id, confirmed_by)
  values (pg_temp.fx('org'), pg_temp.fx('home'), pg_temp.fx('connection'), 'F1', pg_temp.fx('admin')),
         (pg_temp.fx('org'), pg_temp.fx('seedly'), pg_temp.fx('connection'), 'F2', pg_temp.fx('admin'));
insert into public.records_field_settings (org_id, field, mode)
  select pg_temp.fx('org'), f, 'member' from unnest(array['birthday', 'anniversary', 'address', 'phone_mobile']) f;
insert into public.records_field_settings (org_id, field, mode) values (pg_temp.fx('org'), 'grade', 'locked');

-- What a copy left: Henry's birthday, the household's anniversary (both
-- spouses' sources) and address, and Isaac's grade on his own household
-- member row, all still the church's; Isaac's birthday, which he changed;
-- Henry's mobile, which live mode keeps; and an open suggested child. And
-- what a member made their own, which Copy -> Live keeps: Chloe's grade, the
-- Seedly household's address, and its anniversary, which Isaac changed while
-- Ruth's source for it is still the church's.
update public.profiles set birth_month = 1, birth_day = 2, birth_year = 1980, phone_mobile = '+15125550100'
 where id = pg_temp.fx('henry');
update public.profiles set birth_month = 5, birth_day = 5, birth_year = null where id = pg_temp.fx('isaac');
update public.family_units set anniversary_month = 6, anniversary_day = 9, anniversary_year = 2001,
       address_line1 = '12 Oak St', city = 'Austin', state = 'TX', postal_code = '78701'
 where id = pg_temp.fx('home');
insert into public.family_members (org_id, family_id, first_name, last_name, relationship, claimed_profile_id, graduation_year)
  values (pg_temp.fx('org'), pg_temp.fx('seedly'), 'Isaac', 'Seedly', 'primary', pg_temp.fx('isaac'), 2030);
insert into fx select 'isaac_row', id from public.family_members where claimed_profile_id = pg_temp.fx('isaac') order by id limit 1;
insert into public.family_members (org_id, family_id, first_name, last_name, relationship, claimed_profile_id, graduation_year)
  values (pg_temp.fx('org'), pg_temp.fx('home'), 'Chloe', 'Mockingham', 'spouse', pg_temp.fx('chloe'), 2031);
insert into fx select 'chloe_row', id from public.family_members where claimed_profile_id = pg_temp.fx('chloe') order by id limit 1;
update public.family_units set anniversary_month = 8, anniversary_day = 11, anniversary_year = 2018,
       address_line1 = '707 Example Place', city = 'Springfield', state = 'IL', postal_code = '62704'
 where id = pg_temp.fx('seedly');
insert into public.records_field_values (org_id, profile_id, field, state, church_value) values
  (pg_temp.fx('org'), pg_temp.fx('henry'), 'birthday', 'records', '{"birth_month": 1, "birth_day": 2, "birth_year": 1980}'),
  (pg_temp.fx('org'), pg_temp.fx('henry'), 'anniversary', 'records', '{"anniversary_month": 6, "anniversary_day": 9, "anniversary_year": 2001}'),
  (pg_temp.fx('org'), pg_temp.fx('chloe'), 'anniversary', 'records', '{"anniversary_month": 6, "anniversary_day": 9, "anniversary_year": 2001}'),
  (pg_temp.fx('org'), pg_temp.fx('henry'), 'phone_mobile', 'records', '{"phone_mobile": "+15125550100"}'),
  (pg_temp.fx('org'), pg_temp.fx('isaac'), 'birthday', 'changed', '{"birth_month": 7, "birth_day": 7, "birth_year": null}'),
  (pg_temp.fx('org'), pg_temp.fx('isaac'), 'grade', 'records', '{"graduation_year": 2030}'),
  (pg_temp.fx('org'), pg_temp.fx('chloe'), 'grade', 'changed', '{"graduation_year": 2029}'),
  (pg_temp.fx('org'), pg_temp.fx('isaac'), 'anniversary', 'changed', '{"anniversary_month": 8, "anniversary_day": 12, "anniversary_year": 2018}'),
  (pg_temp.fx('org'), pg_temp.fx('ruth'), 'anniversary', 'records', '{"anniversary_month": 8, "anniversary_day": 12, "anniversary_year": 2018}');
insert into public.records_household_values (org_id, family_id, field, state, church_value) values
  (pg_temp.fx('org'), pg_temp.fx('home'), 'address', 'records',
   '{"address_line1": "12 Oak St", "address_line2": null, "city": "Austin", "state": "TX", "postal_code": "78701"}'),
  (pg_temp.fx('org'), pg_temp.fx('seedly'), 'address', 'changed',
   '{"address_line1": "9 Elm St", "address_line2": null, "city": "Springfield", "state": "IL", "postal_code": "62704"}');
insert into public.records_child_suggestions (org_id, family_id, external_person_id, first_name, last_name, birth_month, birth_day, graduation_year)
  values (pg_temp.fx('org'), pg_temp.fx('home'), '200', 'Lily', 'Mockingham', 3, 3, 2034);
insert into public.records_person_state (org_id, profile_id, copied_at)
  select pg_temp.fx('org'), id, now() from (values (pg_temp.fx('henry')), (pg_temp.fx('chloe')), (pg_temp.fx('isaac'))) p(id);

-- Another church with a row in every records_* table.
do $$
declare
  _other uuid;
  _owner uuid := gen_random_uuid();
  _family uuid;
  _connection uuid;
begin
  _other := public.provision_organization('Live Boundary Church', 'owner@live-boundary.example.test');
  insert into public.access_requests (org_id, name, email, status)
    values (_other, 'Live Owner', 'owner@live-boundary.example.test', 'approved');
  insert into auth.users (id, email) values (_owner, 'owner@live-boundary.example.test');
  insert into public.family_units (org_id, family_name) values (_other, 'Boundary') returning id into _family;
  update public.profiles set role = 'admin', family_id = _family, relationship = 'primary' where id = _owner;
  insert into public.records_connections (org_id, provider, base_url, key_ciphertext, key_hint, connected_by)
    values (_other, 'rock', 'https://rock.boundary.example', 'k1.kid.iv.sealed', '1111', _owner)
    returning connection_id into _connection;
  insert into public.records_person_links (org_id, connection_id, profile_id, external_person_id)
    values (_other, _connection, _owner, '900');
  insert into public.records_field_settings (org_id, field, mode) values (_other, 'birthday', 'member');
  insert into public.records_field_values (org_id, profile_id, field, state) values (_other, _owner, 'birthday', 'cleared');
  insert into public.records_person_state (org_id, profile_id, notice_filled_at) values (_other, _owner, now());
  insert into public.records_refresh_state (org_id, connection_id) values (_other, _connection);
  insert into public.records_org_settings (org_id, suggest_children, mode) values (_other, true, 'live');
  insert into public.records_household_links (org_id, family_id, connection_id, external_family_id)
    values (_other, _family, _connection, 'B1');
  insert into public.records_household_values (org_id, family_id, field, state) values (_other, _family, 'address', 'cleared');
  insert into public.records_household_suggestions (org_id, connection_id, external_family_id, target_family_id, people, ready)
    values (_other, _connection, 'B1', _family, '[]', true);
  insert into public.records_child_suggestions (org_id, family_id, external_person_id, first_name, last_name)
    values (_other, _family, '901', 'Boundary', 'Child');
  insert into fx values ('other_org', _other), ('other_owner', _owner);
end $$;

-- ── The mode ────────────────────────────────────────────────────────────────
select is((select mode from public.records_org_settings where org_id = pg_temp.fx('other_org')), 'live',
  'the mode is kept with the church''s other switches');
select is(public.records_save_mode(pg_temp.fx('org'), 'copy', pg_temp.fx('admin')), '{"outcome": "saved", "removed": 0}'::jsonb,
  'a church with no settings row is in copy mode, so choosing copy changes nothing');
select is((select count(*)::int from public.records_org_settings where org_id = pg_temp.fx('org')), 0,
  'and writes nothing');
select throws_ok(
  format('select public.records_save_mode(%L, %L, %L)', pg_temp.fx('org'), 'everything', pg_temp.fx('admin')),
  '22023', null, 'an unknown mode is refused');
select is(pg_temp.attempt('admin@local.dev',
  format('select public.records_save_mode(%L, %L, %L)', pg_temp.fx('org'), 'live', pg_temp.fx('admin'))),
  '42501', 'a church admin can''t call it directly: only the server, after checking them');
select is(pg_temp.attempt('admin@local.dev', format('select public.records_live_copied_count(%L)', pg_temp.fx('org'))),
  '42501', 'nor read the count directly');

-- ── Copy -> Live ────────────────────────────────────────────────────────────
select is(public.records_live_copied_count(pg_temp.fx('org')), 6,
  'the count names each detail still the church''s once: the birthday, grade, the anniversary of two spouses, the address, and the suggested child''s birthday and grade');

update public.records_refresh_state set running_since = now() where org_id = pg_temp.fx('org');
select is(public.records_save_mode(pg_temp.fx('org'), 'live', pg_temp.fx('admin')), '{"outcome": "busy"}'::jsonb,
  'switching is refused while a refresh holds its claim');
select is(public.records_live_copied_count(pg_temp.fx('org')), 6, 'and removes nothing');
update public.records_refresh_state set running_since = null where org_id = pg_temp.fx('org');

select is(public.records_save_mode(pg_temp.fx('org'), 'live', pg_temp.fx('admin')),
  '{"outcome": "saved", "removed": 6}'::jsonb, 'switching to live says how many details it removed');
select is((select mode from public.records_org_settings where org_id = pg_temp.fx('org')), 'live', 'the church is live');

select is((select array[birth_month, birth_day, birth_year] from public.profiles where id = pg_temp.fx('henry')),
  array[null, null, null]::smallint[], 'a birthday still the church''s is removed, year and all');
select is((select array[anniversary_month, anniversary_day, anniversary_year] from public.family_units where id = pg_temp.fx('home')),
  array[null, null, null]::smallint[], 'so is the household''s anniversary');
select is((select coalesce(address_line1, city, state, postal_code) from public.family_units where id = pg_temp.fx('home')),
  null, 'and its address');
select is((select graduation_year from public.family_members where id = pg_temp.fx('isaac_row')), null::smallint,
  'and a grade');
select is(
  (select array[birth_month, birth_day, graduation_year] from public.records_child_suggestions where external_person_id = '200'),
  array[null, null, null]::smallint[], 'a suggested child keeps no birthday or grade');
select is((select first_name from public.records_child_suggestions where external_person_id = '200'), 'Lily',
  'but is still suggested by name');
select is((select array[birth_month, birth_day] from public.profiles where id = pg_temp.fx('isaac')),
  array[5, 5]::smallint[], 'a birthday the member changed in two42 stays');
select is(
  (select state || ':' || church_value::text from public.records_field_values where profile_id = pg_temp.fx('isaac') and field = 'birthday'),
  'changed:{}', 'still the member''s, with the church''s value forgotten');
select is((select phone_mobile from public.profiles where id = pg_temp.fx('henry')), '+15125550100',
  'and what live mode keeps from the records stays, with its source');
select is((select state from public.records_field_values where profile_id = pg_temp.fx('henry') and field = 'phone_mobile'),
  'records', 'still following the records');
select is((select array[anniversary_month, anniversary_day, anniversary_year] from public.family_units where id = pg_temp.fx('seedly')),
  array[8, 11, 2018]::smallint[], 'an anniversary one of the couple changed stays the household''s');
select is(
  (select state || ':' || church_value::text from public.records_field_values where profile_id = pg_temp.fx('isaac') and field = 'anniversary'),
  'changed:{}', 'with the church''s value forgotten');
select is((select address_line1 || ', ' || city || ' ' || state || ' ' || postal_code from public.family_units where id = pg_temp.fx('seedly')),
  '707 Example Place, Springfield IL 62704', 'an address the household changed stays');
select is(
  (select state || ':' || church_value::text from public.records_household_values where family_id = pg_temp.fx('seedly') and field = 'address'),
  'changed:{}', 'with the church''s value forgotten');
select is((select graduation_year from public.family_members where id = pg_temp.fx('chloe_row')), 2031::smallint,
  'and so does a grade the member changed');
select is(
  (select state || ':' || church_value::text from public.records_field_values where profile_id = pg_temp.fx('chloe') and field = 'grade'),
  'changed:{}', 'still theirs');
select is(pg_temp.live_details_stored(pg_temp.fx('org')), 0,
  'the promise: no address, birthday, anniversary or grade from the records is stored');

-- ── The guards ──────────────────────────────────────────────────────────────
select throws_ok(
  format($q$select public.records_apply_copy(%L, %L,
    jsonb_build_object('person', '100', 'profile', '{}'::jsonb,
      'household', (select jsonb_build_object('anniversary_month', anniversary_month, 'anniversary_day', anniversary_day,
                                              'anniversary_year', anniversary_year)
                      from public.family_units where id = %L),
      'grade', (select jsonb_build_object('graduation_year', graduation_year) from public.family_members
                 where claimed_profile_id = %L order by id limit 1),
      'states', '{}'::jsonb),
    '{"birth_month": 4, "birth_day": 12}', '{}', '{}',
    '[{"field": "birthday", "state": "records", "church_value": {"birth_month": 4, "birth_day": 12, "birth_year": null}}]',
    '{birthday}')$q$, pg_temp.fx('org'), pg_temp.fx('henry'), pg_temp.fx('home'), pg_temp.fx('henry')),
  'RC002', null, 'a copy that would store a birthday from the records is refused in live mode');
select is((select birth_month from public.profiles where id = pg_temp.fx('henry')), null::smallint,
  'and writes nothing at all');
select is(pg_temp.as_service(format(
  $q$insert into public.records_household_values (org_id, family_id, field, state, church_value)
     values (%L, %L, 'address', 'records', '{"address_line1": "12 Oak St"}')$q$, pg_temp.fx('org'), pg_temp.fx('home'))),
  'RC002', 'so is a household address');
select is(pg_temp.as_service(format(
  $q$update public.records_field_values set church_value = '{"birth_month": 8}'
      where profile_id = %L and field = 'birthday'$q$, pg_temp.fx('isaac'))),
  'RC002', 'keeping the church''s value on a member''s own source is refused');
select is(pg_temp.as_service(format(
  $q$update public.records_child_suggestions set birth_month = 3, birth_day = 3 where org_id = %L$q$, pg_temp.fx('org'))),
  'RC002', 'and so is a child''s birthday');
select is(pg_temp.as_service(format(
  $q$insert into public.records_field_values (org_id, profile_id, field, state, church_value)
     values (%L, %L, 'gender', 'records', '{"gender": "male"}')$q$, pg_temp.fx('org'), pg_temp.fx('henry'))),
  'ok', 'what live mode stores is still copied');

-- ── A member hiding a detail shown live ─────────────────────────────────────
select is(pg_temp.attempt('henry.mockingham@example.test', $q$select public.records_live_hide('birthday', true)$q$),
  'rows:1', 'a linked member hides their own birthday');
select is((select state from public.records_field_values where profile_id = pg_temp.fx('henry') and field = 'birthday'),
  'cleared', 'as a clear, the way two42 hides a detail');
select is(pg_temp.attempt('henry.mockingham@example.test', $q$select public.records_live_hide('birthday', false)$q$),
  'rows:1', 'and shows it again');
select is((select count(*)::int from public.records_field_values where profile_id = pg_temp.fx('henry') and field = 'birthday'),
  0, 'so it comes from the records again');
select is(pg_temp.attempt('chloe.mockingham@example.test', $q$select public.records_live_hide('anniversary', true)$q$),
  'rows:1', 'the household''s spouse hides its anniversary');
select is(
  (select array_agg(state order by profile_id) from public.records_field_values
    where field = 'anniversary' and profile_id in (pg_temp.fx('henry'), pg_temp.fx('chloe'))),
  array['cleared', 'cleared'], 'for both of its linked people');
select is(pg_temp.attempt('henry.mockingham@example.test', $q$select public.records_live_hide('address', true)$q$),
  'rows:1', 'its primary hides its address');
select is((select state from public.records_household_values where family_id = pg_temp.fx('home') and field = 'address'),
  'cleared', 'as the household''s clear');
select is(pg_temp.attempt('mia.fakeworth@example.test', $q$select public.records_live_hide('address', true)$q$),
  'RC001', 'a household not linked to the records has no address to hide');
select is(pg_temp.attempt('mia.fakeworth@example.test', $q$select public.records_live_hide('birthday', true)$q$),
  'RC001', 'nor does someone not linked have a birthday to hide');
select is(pg_temp.attempt('henry.mockingham@example.test', $q$select public.records_live_hide('grade', true)$q$),
  'RC001', 'and a grade isn''t a member''s to hide');

-- ── Live -> Copy ────────────────────────────────────────────────────────────
select is(public.records_save_mode(pg_temp.fx('org'), 'copy', pg_temp.fx('admin')),
  '{"outcome": "saved", "removed": 0}'::jsonb, 'switching back to copy removes nothing');
select is((select count(*)::int from public.records_person_state where org_id = pg_temp.fx('org') and copied_at is not null),
  0, 'and asks the next refresh to copy everyone in full');
select is((select state from public.records_household_values where family_id = pg_temp.fx('home') and field = 'address'),
  'cleared', 'where a clear made in live mode stays the household''s');
select is(pg_temp.attempt('henry.mockingham@example.test', $q$select public.records_live_hide('birthday', true)$q$),
  'RC001', 'with nothing live, there is nothing to hide');

-- ── One church's rows unreachable from another, on every records_* table ────
-- A table added later without a row here fails the first check until it is covered.
create temp table records_tables (name text primary key) on commit drop;
insert into records_tables values
  ('records_child_suggestions'), ('records_connections'), ('records_field_settings'), ('records_field_values'),
  ('records_household_links'), ('records_household_suggestions'), ('records_household_values'),
  ('records_org_settings'), ('records_person_links'), ('records_person_state'), ('records_refresh_state');
select is(
  (select array_agg(tablename::text order by tablename) from pg_tables where schemaname = 'public' and tablename like 'records\_%'),
  (select array_agg(name order by name) from records_tables),
  'every records_* table is covered below');
select is(
  (select array_agg(name order by name) from records_tables t
    where pg_temp.fx_rows(t.name, pg_temp.fx('other_org')) = 0),
  null, 'non-vacuity: the other church has a row in every one of them');

create temp table reach (who text, tbl text, seen text) on commit drop;
grant insert, select on reach to authenticated;
do $$
declare
  _who text;
  _tbl text;
  _seen text;
begin
  foreach _who in array array['admin@local.dev', 'henry.mockingham@example.test'] loop
    for _tbl in select name from records_tables loop
      perform pg_temp.enter(_who);
      if not has_column_privilege(format('public.%I', _tbl), 'org_id', 'select') then
        _seen := 'no access';
      else
        begin
          execute format('select count(*)::text from public.%I where org_id = %L', _tbl, pg_temp.fx('other_org')) into _seen;
        exception when insufficient_privilege then
          _seen := 'no access';
        end;
      end if;
      set local role none;
      insert into reach values (_who, _tbl, _seen);
    end loop;
  end loop;
end $$;
select is(
  (select array_agg(who || ' ' || tbl || ' ' || seen order by who, tbl) from reach where seen not in ('0', 'no access')),
  null, 'neither a church admin nor a member reads any of another church''s church-records rows');
select ok((select count(*) from reach where seen = '0') > 0,
  'non-vacuity: some of those tables are readable, and filtered to the reader''s own church');

select * from finish();
rollback;
