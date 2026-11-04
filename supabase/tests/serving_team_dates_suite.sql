-- The set-dates rules on serving_team_settings, pinned as CHECK constraints:
-- From and To set together, To after From, at most a year, none on Rolling,
-- extra weeks 0 to 3, a send hour from 6 to 21 or none. And what an existing
-- row gets: Rolling, no set dates, no extra weeks, no chosen hour.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/serving_team_dates_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

do $$
declare
  org uuid;
  grp uuid;
  team uuid;
begin
  org := public.provision_organization('Team Dates Org', 'owner@team-dates.example.test');
  insert into public.groups (org_id, name) values (org, 'group') returning id into grp;
  insert into public.teams (org_id, group_id, name, is_serving_role)
    values (org, grp, 'Greeters', true) returning id into team;
  insert into public.serving_team_settings (org_id, team_id, enabled) values (org, team, true);
  perform set_config('tds.team', team::text, true);
end $$;

-- The SQLSTATE of an update, or 'ok'.
create function pg_temp.try(_set text) returns text language plpgsql as $$
begin
  execute format('update public.serving_team_settings set %s where team_id = %L', _set, current_setting('tds.team'));
  return 'ok';
exception when others then
  return sqlstate;
end $$;

select is(
  (select row(schedule, date_from, date_to, extra_weeks, send_hour)::text
     from public.serving_team_settings where team_id = current_setting('tds.team')::uuid),
  '(rolling,,,0,)',
  'a row that predates the change is Rolling with no set dates, no extra weeks and no chosen hour');

select is(pg_temp.try($$schedule = 'set', date_from = '2026-10-11', date_to = '2027-05-02'$$), 'ok',
  'a set block from October 11, 2026 to May 2, 2027 is allowed');
select is(pg_temp.try($$schedule = 'set', date_from = '2026-10-11', date_to = '2027-10-11'$$), 'ok',
  'a block of exactly a year is allowed');
select is(pg_temp.try($$schedule = 'set', date_from = '2026-10-11', date_to = '2027-10-12'$$), '23514',
  'a block longer than a year is refused');
select is(pg_temp.try($$schedule = 'set', date_from = '2026-10-11', date_to = '2026-10-11'$$), '23514',
  'To must be after From');
select is(pg_temp.try($$schedule = 'set', date_from = '2026-10-11', date_to = '2026-10-04'$$), '23514',
  'To before From is refused');
select is(pg_temp.try($$schedule = 'set', date_from = '2026-10-11', date_to = null$$), '23514',
  'set dates need a To');
select is(pg_temp.try($$schedule = 'set', date_from = null, date_to = '2027-05-02'$$), '23514',
  'set dates need a From');
select is(pg_temp.try($$schedule = 'set', date_from = null, date_to = null$$), '23514',
  'set dates need both dates');
select is(pg_temp.try($$schedule = 'rolling', date_from = '2026-10-11', date_to = '2027-05-02'$$), '23514',
  'Rolling carries no set dates');
select is(pg_temp.try($$schedule = 'rolling', date_from = null, date_to = null$$), 'ok',
  'back to Rolling with the dates cleared');
select is(pg_temp.try($$schedule = 'weekly'$$), '23514', 'the schedule is rolling or set');

select is(pg_temp.try($$extra_weeks = 3$$), 'ok', 'up to three more weeks can be asked for');
select is(pg_temp.try($$extra_weeks = 4$$), '23514', 'four more weeks is refused');
select is(pg_temp.try($$extra_weeks = -1$$), '23514', 'a negative number of weeks is refused');

select is(pg_temp.try($$send_hour = 6$$), 'ok', '6 AM is the earliest send hour');
select is(pg_temp.try($$send_hour = 21$$), 'ok', '9 PM is the latest send hour');
select is(pg_temp.try($$send_hour = 5$$), '23514', '5 AM is refused');
select is(pg_temp.try($$send_hour = 22$$), '23514', '10 PM is refused');
select is(pg_temp.try($$send_hour = null$$), 'ok', 'the hour can be cleared, back to not chosen');

select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'serving_team_settings' and column_name = 'send_hour'),
  null,
  'send_hour has no default, so an untouched team stays distinguishable from one that chose 9');

select * from finish();
rollback;
