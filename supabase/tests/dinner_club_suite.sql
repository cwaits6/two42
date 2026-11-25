-- Dinner club: who reads a host's address and a party's food notes, before
-- and after the tables are published, who writes seasons, parties, dinners
-- and replies, what publish checks and returns, and who the day-before
-- reminder reaches.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/dinner_club_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Org A, group G: leader l; host h (party ph) and the couple g1 + g2 (party
-- pg) at table one; host h2 (ph2) and u (pu) at table two; n, a member who
-- did not sign up. om is in group O of the same church, admin_a is the
-- church admin and in no group, xb leads a group in org B.
do $$
declare
  org_a uuid;
  org_b uuid;
  admin_a uuid := gen_random_uuid();
  xb uuid := gen_random_uuid();
  l uuid := gen_random_uuid();
  h uuid := gen_random_uuid();
  g1 uuid := gen_random_uuid();
  g2 uuid := gen_random_uuid();
  h2 uuid := gen_random_uuid();
  u uuid := gen_random_uuid();
  n uuid := gen_random_uuid();
  om uuid := gen_random_uuid();
  grp uuid;
  grp_o uuid;
  grp_b uuid;
begin
  org_a := public.provision_organization('Dinner Club Org A', 'admin-a@dinner-club.example.test');
  org_b := public.provision_organization('Dinner Club Org B', 'xb@dinner-club.example.test');
  update public.organizations set timezone = 'America/Chicago' where id = org_a;

  insert into public.access_requests (org_id, name, email, status)
  select org_a, who, who || '@dinner-club.example.test', 'approved'
  from unnest(array['l', 'h', 'g1', 'g2', 'h2', 'u', 'n', 'om']) as who;
  insert into auth.users (id, email) values
    (admin_a, 'admin-a@dinner-club.example.test'),
    (xb, 'xb@dinner-club.example.test'),
    (l, 'l@dinner-club.example.test'),
    (h, 'h@dinner-club.example.test'),
    (g1, 'g1@dinner-club.example.test'),
    (g2, 'g2@dinner-club.example.test'),
    (h2, 'h2@dinner-club.example.test'),
    (u, 'u@dinner-club.example.test'),
    (n, 'n@dinner-club.example.test'),
    (om, 'om@dinner-club.example.test');

  insert into public.groups (org_id, name) values (org_a, 'dinner group') returning id into grp;
  insert into public.groups (org_id, name) values (org_a, 'other group') returning id into grp_o;
  insert into public.groups (org_id, name) values (org_b, 'org b group') returning id into grp_b;
  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org_a, grp, l, 'leader'),
    (org_a, grp, h, 'member'),
    (org_a, grp, g1, 'member'),
    (org_a, grp, g2, 'member'),
    (org_a, grp, h2, 'member'),
    (org_a, grp, u, 'member'),
    (org_a, grp, n, 'member'),
    (org_a, grp_o, om, 'leader'),
    (org_b, grp_b, xb, 'leader');

  perform set_config('dc.org_a', org_a::text, true);
  perform set_config('dc.org_b', org_b::text, true);
  perform set_config('dc.admin_a', admin_a::text, true);
  perform set_config('dc.xb', xb::text, true);
  perform set_config('dc.l', l::text, true);
  perform set_config('dc.h', h::text, true);
  perform set_config('dc.g1', g1::text, true);
  perform set_config('dc.g2', g2::text, true);
  perform set_config('dc.h2', h2::text, true);
  perform set_config('dc.u', u::text, true);
  perform set_config('dc.n', n::text, true);
  perform set_config('dc.om', om::text, true);
  perform set_config('dc.grp', grp::text, true);
  perform set_config('dc.grp_o', grp_o::text, true);
  perform set_config('dc.grp_b', grp_b::text, true);
end $$;

create function pg_temp.id(_name text) returns uuid language sql stable as $$
  select current_setting('dc.' || _name)::uuid;
$$;

create function pg_temp.keep(_name text, _value text) returns text language sql as $$
  select set_config('dc.' || _name, _value, true);
$$;

-- Runs one statement as a signed-in person and returns how many rows it
-- wrote, or the SQLSTATE.
create function pg_temp.wrote(_who text, _sql text) returns text language plpgsql as $$
declare n bigint; out text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('dc.' || _who))::text, true);
  perform set_config('request.headers', '{}', true);
  begin
    execute _sql;
    get diagnostics n = row_count;
    out := n::text;
  exception when others then
    out := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return out;
end $$;

-- One value a signed-in person reads, as text, or the SQLSTATE.
create function pg_temp.read_as(_who text, _sql text) returns text language plpgsql as $$
declare out text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('dc.' || _who))::text, true);
  perform set_config('request.headers', '{}', true);
  begin
    execute _sql into out;
  exception when others then
    out := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return out;
end $$;

create function pg_temp.count_as(_who text, _table text, _where text) returns text language sql as $$
  select pg_temp.read_as(_who, format('select count(*) from public.%I where %s', _table, _where));
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.dinner_my_party_ids()', 'execute'),
  'anon runs no dinner club policy helper');
select ok(not has_function_privilege('anon', 'public.dinner_party_create(uuid, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.dinner_tables_publish(uuid)', 'execute'),
  'anon runs neither sign-up nor publish');
select ok(not has_function_privilege('authenticated', 'public.dinner_reminder_claim(uuid, uuid, date)', 'execute')
  and has_function_privilege('service_role', 'public.dinner_reminder_claim(uuid, uuid, date)', 'execute'),
  'only the service key claims reminders');
select is(pg_temp.wrote('l', 'select * from public.dinner_reminder_passes'), '42501',
  'a signed-in person cannot read the reminder record');
select is(pg_temp.wrote('l', 'select * from public.dinner_reminder_sends'), '42501',
  'nor its sends');
select is((select count(*)::int from cron.job where jobname = 'send-dinner-reminders-daily'
    and schedule = '0 15-17 * * *' and command like '%/functions/v1/send-dinner-reminders%'), 1,
  'the reminder job fires at 15:00, 16:00 and 17:00 UTC');
select ok(public.usage_page_patterns() @> array[
    '/g/[groupId]/dinner-club',
    '/g/[groupId]/dinner-club/seasons/new',
    '/g/[groupId]/dinner-club/seasons/[seasonId]',
    '/g/[groupId]/dinner-club/seasons/[seasonId]/edit',
    '/g/[groupId]/dinner-club/seasons/[seasonId]/tables'],
  'usage counts accept the dinner club pages');

-- ── The switch ──────────────────────────────────────────────────────────────
insert into public.group_settings (org_id, group_id) values (pg_temp.id('org_a'), pg_temp.id('grp_o'));
select is((select dinner_club_enabled from public.group_settings where group_id = pg_temp.id('grp_o')), false,
  'a group''s dinner club is off until a leader turns it on');
select is((select email_dinner_club from public.profiles where id = pg_temp.id('n')), true,
  'dinner club email is on for a person until they turn it off');
select is(pg_temp.wrote('admin_a', format(
    'update public.profiles set email_dinner_club = false where id = %L', pg_temp.id('n'))), '42501',
  'a church admin cannot turn it off for someone else');

-- ── Seasons ─────────────────────────────────────────────────────────────────
select is(pg_temp.wrote('n', format(
    'insert into public.dinner_seasons (group_id, title, format, starts_on, ends_on, repeat_kind, repeat_weeks, weekday, signup_closes_on) '
    'values (%L, ''Supper Club'', ''same_table_one_host'', ''2031-01-04'', ''2031-04-30'', ''weeks'', 4, 6, ''2030-12-31'')',
    pg_temp.id('grp'))), '42501',
  'a member cannot add a season');
select pg_temp.keep('season', pg_temp.read_as('l', format(
    'insert into public.dinner_seasons (group_id, title, format, starts_on, ends_on, repeat_kind, repeat_weeks, weekday, signup_closes_on) '
    'values (%L, ''Supper Club'', ''same_table_one_host'', ''2031-01-04'', ''2031-04-30'', ''weeks'', 4, 6, ''2030-12-31'') returning id',
    pg_temp.id('grp'))));
select isnt((select status from public.dinner_seasons where id = pg_temp.id('season')), null, 'a leader adds a season');
select is(pg_temp.wrote('l', format(
    'insert into public.dinner_seasons (group_id, title, format, status, starts_on, ends_on, repeat_kind, repeat_weeks, weekday, signup_closes_on) '
    'values (%L, ''Opened'', ''new_tables'', ''open'', ''2031-01-04'', ''2031-04-30'', ''weeks'', 4, 6, ''2030-12-31'')',
    pg_temp.id('grp'))), 'DC003',
  'a season starts as a draft');
select is(pg_temp.count_as('n', 'dinner_seasons', format('id = %L', pg_temp.id('season'))), '0',
  'a member does not see a draft season');
select is(pg_temp.count_as('l', 'dinner_seasons', format('id = %L', pg_temp.id('season'))), '1',
  'its leader does');

select is(pg_temp.wrote('l', format(
    'insert into public.dinner_season_dates (season_id, group_id, starts_at) values '
    '(%1$L, %2$L, ''2031-01-04 18:00-06''), (%1$L, %2$L, ''2031-02-01 18:00-06'')',
    pg_temp.id('season'), pg_temp.id('grp'))), '2',
  'a leader adds the season''s dates');
select is(pg_temp.wrote('l', format(
    'insert into public.dinner_season_dates (season_id, group_id, starts_at) values (%L, %L, ''2031-05-02 18:00-05'')',
    pg_temp.id('season'), pg_temp.id('grp'))), 'DC004',
  'a date outside the season is refused');
select pg_temp.keep('d1', (select id::text from public.dinner_season_dates where season_id = pg_temp.id('season') order by starts_at limit 1));
select pg_temp.keep('d2', (select id::text from public.dinner_season_dates where season_id = pg_temp.id('season') order by starts_at desc limit 1));

select is(pg_temp.wrote('n', format('update public.dinner_seasons set status = ''open'' where id = %L', pg_temp.id('season'))), '0',
  'a member cannot open sign-ups');
select is(pg_temp.wrote('l', format('update public.dinner_seasons set status = ''open'' where id = %L', pg_temp.id('season'))), '1',
  'its leader opens sign-ups');
select is(pg_temp.count_as('n', 'dinner_seasons', format('id = %L', pg_temp.id('season'))), '1',
  'a member of the group sees a season taking sign-ups');
select is(pg_temp.count_as('n', 'dinner_season_dates', format('season_id = %L', pg_temp.id('season'))), '2',
  'and its dates');
select is(pg_temp.count_as('om', 'dinner_seasons', 'true'), '0',
  'a member of another group in the church sees no season');
select is(pg_temp.count_as('admin_a', 'dinner_seasons', 'true'), '0',
  'nor does a church admin outside the group');
select is(pg_temp.count_as('xb', 'dinner_seasons', 'true'), '0',
  'nor anyone in another church');
select is(pg_temp.wrote('l', format('delete from public.dinner_seasons where id = %L', pg_temp.id('season'))), '0',
  'a season taking sign-ups cannot be deleted');
select is(pg_temp.wrote('l', format(
    'insert into public.dinner_seasons (group_id, title, format, starts_on, ends_on, repeat_kind, repeat_week_of_month, weekday, signup_closes_on) '
    'values (%L, ''Second'', ''new_tables'', ''2031-01-04'', ''2031-04-30'', ''monthly_weekday'', 2, 6, ''2030-12-31'')',
    pg_temp.id('grp'))), '1',
  'a second season can be drafted');
select pg_temp.keep('season2', (select id::text from public.dinner_seasons where group_id = pg_temp.id('grp') and title = 'Second'));
select is(pg_temp.wrote('l', format('update public.dinner_seasons set status = ''open'' where id = %L', pg_temp.id('season2'))), '23505',
  'but only one season per group takes sign-ups or runs at a time');
select is(pg_temp.wrote('l', format('update public.dinner_seasons set status = ''published'' where id = %L', pg_temp.id('season2'))), 'DC003',
  'only publishing tables publishes a season');
select is(pg_temp.wrote('l', format('delete from public.dinner_seasons where id = %L', pg_temp.id('season2'))), '1',
  'a leader deletes a draft season');

-- ── Sign-ups ────────────────────────────────────────────────────────────────
select pg_temp.keep('ph', pg_temp.read_as('h', format(
  'select public.dinner_party_create(%L, array[%L]::uuid[])', pg_temp.id('season'), pg_temp.id('h'))));
select pg_temp.keep('pg', pg_temp.read_as('g1', format(
  'select public.dinner_party_create(%L, array[%L, %L]::uuid[])', pg_temp.id('season'), pg_temp.id('g1'), pg_temp.id('g2'))));
select pg_temp.keep('ph2', pg_temp.read_as('h2', format(
  'select public.dinner_party_create(%L, array[%L]::uuid[])', pg_temp.id('season'), pg_temp.id('h2'))));
select pg_temp.keep('pu', pg_temp.read_as('u', format(
  'select public.dinner_party_create(%L, array[%L]::uuid[])', pg_temp.id('season'), pg_temp.id('u'))));
select is((select count(*)::int from public.dinner_party_members where season_id = pg_temp.id('season')), 5,
  'members sign up alone and as a couple with another member of the group');
select is(pg_temp.read_as('g2', format(
    'select public.dinner_party_create(%L, array[%L]::uuid[])', pg_temp.id('season'), pg_temp.id('g2'))), '23505',
  'a person is in one party per season');
select is(pg_temp.read_as('om', format(
    'select public.dinner_party_create(%L, array[%L]::uuid[])', pg_temp.id('season'), pg_temp.id('om'))), 'DC001',
  'a member of another group cannot sign up');
select is(pg_temp.read_as('n', format(
    'select public.dinner_party_create(%L, array[%L, %L]::uuid[])', pg_temp.id('season'), pg_temp.id('n'), pg_temp.id('xb'))), 'DC002',
  'a partner from another church is refused');
select is(pg_temp.read_as('n', format(
    'select public.dinner_party_create(%L, array[%L, %L]::uuid[])', pg_temp.id('season'), pg_temp.id('n'), pg_temp.id('om'))), 'DC002',
  'a partner from another group is refused');
select is(pg_temp.read_as('n', format(
    'select public.dinner_party_create(%L, array[%L]::uuid[])', pg_temp.id('season'), pg_temp.id('u'))), 'DC001',
  'a member signs up only a party they are in');
select pg_temp.keep('pn', pg_temp.read_as('l', format(
  'select public.dinner_party_create(%L, array[%L]::uuid[])', pg_temp.id('season'), pg_temp.id('n'))));
select is((select count(*)::int from public.dinner_party_members where party_id = pg_temp.id('pn')), 1,
  'a leader signs up a party for someone');
select is(pg_temp.wrote('l', format('delete from public.dinner_parties where id = %L', pg_temp.id('pn'))), '1',
  'and removes it');
select is(pg_temp.wrote('g1', format(
    'insert into public.dinner_party_members (party_id, profile_id, season_id, group_id) values (%L, %L, %L, %L)',
    pg_temp.id('pg'), pg_temp.id('n'), pg_temp.id('season'), pg_temp.id('grp'))), 'DC002',
  'a party is never more than two people');

select is(pg_temp.wrote('h', format('update public.dinner_parties set can_host = true, seats = 6 where id = %L', pg_temp.id('ph'))), '1',
  'a member offers to host');
select is(pg_temp.wrote('h2', format('update public.dinner_parties set can_host = true, seats = 6 where id = %L', pg_temp.id('ph2'))), '1',
  'and another');
select is(pg_temp.wrote('u', format('update public.dinner_parties set seats = 9 where id = %L', pg_temp.id('ph'))), '0',
  'nobody edits another party');
select is(pg_temp.wrote('h', format(
    'insert into public.dinner_party_addresses (party_id, season_id, group_id, address_line1, city) values (%L, %L, %L, ''1 Host Lane'', ''Springfield'')',
    pg_temp.id('ph'), pg_temp.id('season'), pg_temp.id('grp'))), '1',
  'a host gives their address');
select is(pg_temp.wrote('h2', format(
    'insert into public.dinner_party_addresses (party_id, season_id, group_id, address_line1) values (%L, %L, %L, ''2 Other Lane'')',
    pg_temp.id('ph2'), pg_temp.id('season'), pg_temp.id('grp'))), '1',
  'so does the other host');
select is(pg_temp.wrote('g2', format(
    'insert into public.dinner_party_notes (party_id, season_id, group_id, food_notes) values (%L, %L, %L, ''No nuts'')',
    pg_temp.id('pg'), pg_temp.id('season'), pg_temp.id('grp'))), '1',
  'either half of a couple gives the party''s food needs');
select is(pg_temp.wrote('u', format(
    'insert into public.dinner_party_notes (party_id, season_id, group_id, food_notes) values (%L, %L, %L, ''Vegan'')',
    pg_temp.id('pu'), pg_temp.id('season'), pg_temp.id('grp'))), '1',
  'a guest at the other table gives theirs');

-- The sign-up window: after the close date a member's changes are refused
-- and a leader's are not.
update public.dinner_seasons set signup_closes_on = '2020-01-01' where id = pg_temp.id('season');
select is(pg_temp.wrote('g1', format('update public.dinner_parties set kids_welcome = true where id = %L', pg_temp.id('pg'))), 'DC003',
  'a member cannot change their sign-up after sign-ups close');
select is(pg_temp.wrote('g1', format(
    'update public.dinner_party_notes set food_notes = ''No nuts or shellfish'' where party_id = %L', pg_temp.id('pg'))), 'DC003',
  'nor their food needs');
select is(pg_temp.read_as('n', format(
    'select public.dinner_party_create(%L, array[%L]::uuid[])', pg_temp.id('season'), pg_temp.id('n'))), 'DC003',
  'nor sign up');
select is(pg_temp.wrote('l', format('update public.dinner_parties set kids_welcome = true where id = %L', pg_temp.id('pg'))), '1',
  'a leader still can');
update public.dinner_seasons set signup_closes_on = '2030-12-31' where id = pg_temp.id('season');

-- ── Before publish ──────────────────────────────────────────────────────────
select is(pg_temp.count_as('g1', 'dinner_party_addresses', format('party_id = %L', pg_temp.id('ph'))), '0',
  'before publish a guest reads no host''s address');
select is(pg_temp.count_as('h', 'dinner_party_notes', format('party_id = %L', pg_temp.id('pg'))), '0',
  'and a host reads no guest''s food needs');
select is(pg_temp.count_as('h', 'dinner_party_addresses', format('party_id = %L', pg_temp.id('ph'))), '1',
  'a host reads their own address');
select is(pg_temp.count_as('l', 'dinner_party_addresses', 'true'), '2',
  'a leader reads every host''s address');
select is(pg_temp.count_as('g1', 'dinner_parties', 'true'), '1',
  'a member sees only their own party before publish');

-- ── The draft and publish ───────────────────────────────────────────────────
create function pg_temp.draft(_tables jsonb) returns void language sql as $$
  insert into public.dinner_drafts (org_id, season_id, group_id, body)
  values (pg_temp.id('org_a'), pg_temp.id('season'), pg_temp.id('grp'), jsonb_build_object('version', 1, 'seed', 1, 'tables', _tables))
  on conflict (season_id) do update set body = excluded.body;
$$;

create function pg_temp.one_host_table(_key text, _table text, _host text, _parties text[]) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'key', _key,
    'tableId', _table,
    'seasonDateId', null,
    'partyIds', to_jsonb(array(select pg_temp.id(p)::text from unnest(_parties) p)),
    'hosts', jsonb_build_array(
      jsonb_build_object('seasonDateId', pg_temp.id('d1'), 'partyId', pg_temp.id(_host)),
      jsonb_build_object('seasonDateId', pg_temp.id('d2'), 'partyId', pg_temp.id(_host))));
$$;

select is(pg_temp.wrote('g1', format(
    'insert into public.dinner_drafts (season_id, group_id, body) values (%L, %L, ''{}'')', pg_temp.id('season'), pg_temp.id('grp'))), '42501',
  'a member cannot write a draft');

select pg_temp.draft(jsonb_build_array(
  pg_temp.one_host_table('a', null, 'ph', array['ph', 'pg']),
  pg_temp.one_host_table('b', null, 'ph2', array['ph2', 'pu', 'pg'])));
select is(pg_temp.read_as('l', format('select count(*) from public.dinner_tables_publish(%L)', pg_temp.id('season'))), 'DC002',
  'a draft seating a party at two tables is refused');
select pg_temp.draft(jsonb_build_array(
  pg_temp.one_host_table('a', null, 'ph2', array['ph', 'pg']),
  pg_temp.one_host_table('b', null, 'ph', array['ph2', 'pu'])));
select is(pg_temp.read_as('l', format('select count(*) from public.dinner_tables_publish(%L)', pg_temp.id('season'))), 'DC002',
  'a draft whose host is not at the table is refused');
select pg_temp.draft(jsonb_build_array(
  pg_temp.one_host_table('a', null, 'ph', array['ph', 'pg']) || jsonb_build_object('hosts', jsonb_build_array(
    jsonb_build_object('seasonDateId', pg_temp.id('d1'), 'partyId', pg_temp.id('ph')))),
  pg_temp.one_host_table('b', null, 'ph2', array['ph2', 'pu'])));
select is(pg_temp.read_as('l', format('select count(*) from public.dinner_tables_publish(%L)', pg_temp.id('season'))), 'DC002',
  'a draft with a date nobody hosts is refused');
select pg_temp.draft(jsonb_build_array(
  pg_temp.one_host_table('a', null, 'pg', array['ph', 'pg']),
  pg_temp.one_host_table('b', null, 'ph2', array['ph2', 'pu'])));
select is(pg_temp.read_as('l', format('select count(*) from public.dinner_tables_publish(%L)', pg_temp.id('season'))), 'DC002',
  'a draft whose host did not offer to host is refused');

select pg_temp.draft(jsonb_build_array(
  pg_temp.one_host_table('a', null, 'ph', array['ph', 'pg']),
  pg_temp.one_host_table('b', null, 'ph2', array['ph2', 'pu'])));
select is(pg_temp.read_as('g1', format('select count(*) from public.dinner_tables_publish(%L)', pg_temp.id('season'))), 'DC001',
  'a member cannot publish');
select is(pg_temp.count_as('g1', 'dinner_tables', 'true'), '0',
  'members see no table before publish');
select is(pg_temp.read_as('l', format('select count(*) from public.dinner_tables_publish(%L)', pg_temp.id('season'))), '5',
  'publishing names everyone seated');
select is((select status from public.dinner_seasons where id = pg_temp.id('season')), 'published', 'the season is published');
select is((select count(*)::int from public.dinner_drafts where season_id = pg_temp.id('season')), 0, 'and its draft is gone');
select is((select count(*)::int from public.dinners where season_id = pg_temp.id('season')), 4,
  'each table has a dinner on each date');
select is((select count(*)::int from public.dinners where season_id = pg_temp.id('season') and host_party_id in (pg_temp.id('ph'), pg_temp.id('ph2'))), 4,
  'and one host, the table''s, for every dinner');
select ok(not exists (select 1 from public.events e where e.group_id = pg_temp.id('grp')),
  'no dinner is an event on the group calendar');

select pg_temp.keep('t1', (select table_id::text from public.dinner_seats where party_id = pg_temp.id('ph')));
select pg_temp.keep('t2', (select table_id::text from public.dinner_seats where party_id = pg_temp.id('ph2')));
select pg_temp.keep('t1d1', (select id::text from public.dinners where table_id = pg_temp.id('t1') and season_date_id = pg_temp.id('d1')));
select pg_temp.keep('t1d2', (select id::text from public.dinners where table_id = pg_temp.id('t1') and season_date_id = pg_temp.id('d2')));
select pg_temp.keep('t2d1', (select id::text from public.dinners where table_id = pg_temp.id('t2') and season_date_id = pg_temp.id('d1')));
select pg_temp.keep('t2d2', (select id::text from public.dinners where table_id = pg_temp.id('t2') and season_date_id = pg_temp.id('d2')));

select is(pg_temp.count_as('g1', 'dinner_tables', 'true'), '1', 'a member sees only their own table');
select is(pg_temp.count_as('g1', 'dinners', 'true'), '2', 'and only its dinners');
select is(pg_temp.count_as('l', 'dinner_tables', 'true'), '2', 'a leader sees every table');
select is(pg_temp.count_as('n', 'dinner_tables', 'true'), '0', 'a member not signed up sees none');
select is(pg_temp.count_as('g1', 'dinner_party_members', 'true'), '3', 'a guest sees who is at their table');
select is(pg_temp.wrote('l', format('update public.dinner_seasons set status = ''open'' where id = %L', pg_temp.id('season'))), 'DC003',
  'a published season cannot go back to sign-ups');
select is(pg_temp.wrote('l', format('update public.dinner_seasons set table_size_max = 10 where id = %L', pg_temp.id('season'))), 'DC003',
  'nor change its table size');

-- ── The host's address ──────────────────────────────────────────────────────
select is(pg_temp.count_as(who, 'dinner_party_addresses', format('party_id = %L', pg_temp.id('ph'))), '1',
  'after publish ' || what || ' reads the host''s address')
from (values ('h', 'the host'), ('l', 'a leader'), ('g1', 'a guest at the table'), ('g2', 'their partner')) v(who, what);
select is(pg_temp.count_as(who, 'dinner_party_addresses', format('party_id = %L', pg_temp.id('ph'))), '0',
  what || ' does not read the host''s address')
from (values
  ('u', 'a member at another table'),
  ('h2', 'the host of another table'),
  ('n', 'a member of the group not signed up'),
  ('om', 'a member of another group'),
  ('admin_a', 'a church admin outside the group'),
  ('xb', 'someone in another church')) v(who, what);

-- ── Food needs ──────────────────────────────────────────────────────────────
select is(pg_temp.count_as(who, 'dinner_party_notes', format('party_id = %L', pg_temp.id('pg'))), '1',
  what || ' reads the party''s food needs')
from (values ('g1', 'the person'), ('g2', 'their partner'), ('l', 'a leader'), ('h', 'the host of their dinner')) v(who, what);
select is(pg_temp.count_as(who, 'dinner_party_notes', format('party_id = %L', pg_temp.id('pg'))), '0',
  what || ' does not read the party''s food needs')
from (values
  ('h2', 'the host of another table'),
  ('u', 'a member at another table'),
  ('n', 'a member of the group not signed up'),
  ('om', 'a member of another group'),
  ('admin_a', 'a church admin outside the group'),
  ('xb', 'someone in another church')) v(who, what);

-- ── Replies ─────────────────────────────────────────────────────────────────
select is(pg_temp.wrote('g1', format(
    'insert into public.dinner_replies (dinner_id, profile_id, status) values (%L, %L, ''going'')', pg_temp.id('t1d1'), pg_temp.id('g1'))), '1',
  'a person says they are going');
select is(pg_temp.wrote('g1', format(
    'insert into public.dinner_replies (dinner_id, profile_id, status) values (%L, %L, ''not_going'')', pg_temp.id('t1d1'), pg_temp.id('g2'))), '1',
  'and answers for their partner, who is not');
select is(pg_temp.read_as('h', format(
    'select count(*) filter (where status = ''going'') || ''/'' || count(*) filter (where status = ''not_going'') from public.dinner_replies where dinner_id = %L',
    pg_temp.id('t1d1'))), '1/1',
  'the host counts one going and one not');
select is(pg_temp.wrote('u', format(
    'insert into public.dinner_replies (dinner_id, profile_id, status) values (%L, %L, ''going'')', pg_temp.id('t1d1'), pg_temp.id('g1'))), 'DC001',
  'nobody answers for someone outside their party');
select is(pg_temp.wrote('u', format(
    'insert into public.dinner_replies (dinner_id, profile_id, status) values (%L, %L, ''going'')', pg_temp.id('t1d1'), pg_temp.id('u'))), 'DC001',
  'nor replies to another table''s dinner');
select is(pg_temp.count_as('u', 'dinner_replies', format('dinner_id = %L', pg_temp.id('t1d1'))), '0',
  'nor reads its replies');

-- ── Moving a dinner ─────────────────────────────────────────────────────────
select is(pg_temp.wrote('h', format(
    'update public.dinners set starts_at = ''2031-01-05 17:00-06'' where id = %L', pg_temp.id('t1d1'))), '1',
  'a host moves their own table''s dinner');
select is((select count(*)::int from public.dinner_replies where dinner_id = pg_temp.id('t1d1')), 0,
  'and its replies are cleared');
select is(pg_temp.wrote('h', format(
    'update public.dinners set starts_at = ''2031-01-05 17:00-06'' where id = %L', pg_temp.id('t2d1'))), '0',
  'a host cannot move another table''s dinner');
select is(pg_temp.wrote('h', format(
    'update public.dinners set starts_at = ''2031-06-05 17:00-05'' where id = %L', pg_temp.id('t1d1'))), 'DC004',
  'nor move a dinner outside the season');
select is(pg_temp.wrote('h', format(
    'update public.dinners set host_party_id = %L where id = %L', pg_temp.id('pg'), pg_temp.id('t1d1'))), '42501',
  'nor hand it to another party');
select is(pg_temp.wrote('g1', format(
    'update public.dinners set starts_at = ''2031-01-06 17:00-06'' where id = %L', pg_temp.id('t1d1'))), '0',
  'a guest cannot move a dinner');
select is(pg_temp.wrote('l', format(
    'update public.dinners set starts_at = ''2031-01-06 17:00-06'' where id = %L', pg_temp.id('t2d1'))), '1',
  'a leader moves any dinner');

-- A leader moving a season date moves each table's dinner on it, except one
-- its host already moved.
select is(pg_temp.wrote('h', format(
    'update public.dinners set starts_at = ''2031-02-02 18:00-06'' where id = %L', pg_temp.id('t1d2'))), '1',
  'a host moves the second dinner');
select is(pg_temp.wrote('l', format(
    'update public.dinner_season_dates set starts_at = ''2031-02-08 18:00-06'' where id = %L', pg_temp.id('d2'))), '1',
  'a leader moves the second date');
select is((select starts_at from public.dinners where id = pg_temp.id('t2d2')), '2031-02-08 18:00-06'::timestamptz,
  'the other table''s dinner moves with it');
select is((select starts_at from public.dinners where id = pg_temp.id('t1d2')), '2031-02-02 18:00-06'::timestamptz,
  'the dinner its host moved stays');

-- ── Changing published tables ───────────────────────────────────────────────
select pg_temp.keep('pn', pg_temp.read_as('n', format(
  'select public.dinner_party_create(%L, array[%L]::uuid[])', pg_temp.id('season'), pg_temp.id('n'))));
select is((select status from public.dinner_parties where id = pg_temp.id('pn')), 'waitlisted',
  'a sign-up after publish is waitlisted');
select pg_temp.draft(jsonb_build_array(
  pg_temp.one_host_table('a', current_setting('dc.t1'), 'ph', array['ph', 'pg']),
  pg_temp.one_host_table('b', current_setting('dc.t2'), 'ph2', array['ph2', 'pu', 'pn'])));
select is(pg_temp.read_as('l', format(
    'select string_agg(profile_id::text, '','' order by profile_id::text) from public.dinner_tables_publish(%L)', pg_temp.id('season'))),
  (select string_agg(x::text, ',' order by x::text) from unnest(array[pg_temp.id('h2'), pg_temp.id('u'), pg_temp.id('n')]) x),
  'seating a waitlisted party names only the people at its table');
select is((select status from public.dinner_parties where id = pg_temp.id('pn')), 'signed_up',
  'and the party is no longer waitlisted');
select is((select count(*)::int from public.dinners where season_id = pg_temp.id('season')), 4,
  'every dinner stays');
select is((select starts_at from public.dinners where id = pg_temp.id('t1d2')), '2031-02-02 18:00-06'::timestamptz,
  'and keeps its moved time');

-- ── The reminder ────────────────────────────────────────────────────────────
insert into public.group_settings (org_id, group_id, dinner_club_enabled) values (pg_temp.id('org_a'), pg_temp.id('grp'), true);
select is(pg_temp.wrote('g1', format(
    'insert into public.dinner_replies (dinner_id, profile_id, status) values (%L, %L, ''not_going'')', pg_temp.id('t1d1'), pg_temp.id('g2'))), '1',
  'after the move the partner says not going again');
update public.profiles set email_dinner_club = false where id = pg_temp.id('h');
select is(
  (select string_agg(profile_id::text, ',') from public.dinner_reminder_claim(pg_temp.id('org_a'), pg_temp.id('t1d1'), '2031-01-05')),
  current_setting('dc.g1'),
  'the reminder goes to the table, leaving out who said not going and who turned dinner emails off');
select is(
  (select count(*)::int from public.dinner_reminder_claim(pg_temp.id('org_a'), pg_temp.id('t1d1'), '2031-01-05')), 0,
  'a second claim sends nothing: a dinner is reminded once');
select is(
  (select count(*)::int from public.dinner_reminder_claim(pg_temp.id('org_a'), pg_temp.id('t1d1'), '2031-01-12')), 1,
  'a dinner moved to a new date is reminded on it');
select throws_ok(
  format('select * from public.dinner_reminder_claim(%L, %L, ''2031-01-05'')', pg_temp.id('org_b'), pg_temp.id('t1d1')),
  'DC010', null, 'a claim for another church''s dinner is refused');
update public.group_settings set dinner_club_enabled = false where group_id = pg_temp.id('grp');
select is(
  (select count(*)::int from public.dinner_reminder_claim(pg_temp.id('org_a'), pg_temp.id('t2d1'), '2031-01-05')), 0,
  'with the dinner club off nobody is reminded');
select is(pg_temp.count_as('u', 'dinner_party_addresses', format('party_id = %L', pg_temp.id('ph2'))), '1',
  'and turning it off keeps every row');

update public.dinners set starts_at = now() - interval '1 day' where id = pg_temp.id('t2d2');
select is(pg_temp.wrote('h2', format(
    'insert into public.dinner_replies (dinner_id, profile_id, status) values (%L, %L, ''going'')', pg_temp.id('t2d2'), pg_temp.id('h2'))), 'DC003',
  'a dinner that has passed takes no reply');

-- ── Withdrawal and leaving ──────────────────────────────────────────────────
select is(pg_temp.wrote('u', format('update public.dinner_parties set status = ''withdrawn'' where id = %L', pg_temp.id('pu'))), '1',
  'a party withdraws from a running season');
select isnt((select left_at from public.dinner_seats where party_id = pg_temp.id('pu')), null,
  'its seat is kept as left');
select is(pg_temp.count_as('u', 'dinner_party_addresses', format('party_id = %L', pg_temp.id('ph2'))), '0',
  'and it no longer reads its old host''s address');
select is(pg_temp.wrote('u', format('update public.dinner_parties set status = ''signed_up'' where id = %L', pg_temp.id('pu'))), 'DC003',
  'nor can it take its seat back');

delete from public.group_members where group_id = pg_temp.id('grp') and profile_id = pg_temp.id('g2');
select is((select count(*)::int from public.dinner_party_members where party_id = pg_temp.id('pg')), 1,
  'leaving the group takes the person out of their party and leaves their partner in it');
delete from public.group_members where group_id = pg_temp.id('grp') and profile_id = pg_temp.id('g1');
select is((select count(*)::int from public.dinner_parties where id = pg_temp.id('pg')), 0,
  'a party left with nobody is deleted');

update public.dinner_seasons set status = 'ended' where id = pg_temp.id('season');
select is(pg_temp.wrote('h', format(
    'update public.dinners set starts_at = ''2031-01-07 17:00-06'' where id = %L', pg_temp.id('t1d1'))), 'DC003',
  'an ended season''s dinners do not move');
select is(pg_temp.count_as('h', 'dinners', 'true'), '2',
  'and stay visible to the people at their table');

select * from finish();
rollback;
