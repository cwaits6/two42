-- The set-dates rules on serving_team_settings, pinned as CHECK constraints:
-- From and To set together, To after From, at most a year, none on Rolling,
-- extra weeks 0 to 3, a send hour from 6 to 21 or none. And what an existing
-- row gets: Rolling, no set dates, no extra weeks, no chosen hour. And the
-- team's dates as the sign-up function holds them, on both sides of each
-- bound, with no way to take a date around it.
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
  owner uuid := gen_random_uuid();
  today date := (now() at time zone 'UTC')::date;
begin
  org := public.provision_organization('Team Dates Org', 'owner@team-dates.example.test');
  update public.organizations set timezone = 'UTC' where id = org;
  insert into auth.users (id, email) values (owner, 'owner@team-dates.example.test');
  insert into public.groups (org_id, name) values (org, 'group') returning id into grp;
  insert into public.teams (org_id, group_id, name, is_serving_role)
    values (org, grp, 'Greeters', true) returning id into team;
  insert into public.group_members (org_id, group_id, profile_id, role) values (org, grp, owner, 'leader');
  insert into public.team_members (org_id, profile_id, team_id) values (org, owner, team);
  insert into public.serving_team_settings (org_id, team_id, enabled) values (org, team, true);
  perform set_config('tds.team', team::text, true);
  perform set_config('tds.owner', owner::text, true);
  -- The first Sunday on or after the church's local date.
  perform set_config('tds.first', (today + (7 - extract(dow from today)::int) % 7)::text, true);
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

-- ── The team's dates, held by the sign-up function ─────────────────────────
-- 'ok' when the date `_weeks` weeks and `_days` days from the first Sunday can
-- be taken, or the SQLSTATE. A date that was taken is opened again.
create function pg_temp.book(_weeks integer, _days integer default 0) returns text language plpgsql as $$
declare
  _date date := current_setting('tds.first')::date + _weeks * 7 + _days;
begin
  perform public.serving_signup_apply(
    current_setting('tds.team')::uuid, _date, current_setting('tds.owner')::uuid,
    array[current_setting('tds.owner')::uuid]);
  delete from public.serving_signups where team_id = current_setting('tds.team')::uuid and service_date = _date;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

create function pg_temp.block(_from_weeks integer, _to_weeks integer) returns text language sql as $$
  select pg_temp.try(format($f$schedule = 'set', date_from = %L, date_to = %L$f$,
    current_setting('tds.first')::date + _from_weeks * 7,
    current_setting('tds.first')::date + _to_weeks * 7));
$$;

select is(pg_temp.try($$schedule = 'rolling', date_from = null, date_to = null, window_weeks = 2$$), 'ok',
  'Rolling, the next 2 weeks');
select is(pg_temp.book(0), 'ok', 'Rolling: the first Sunday can be taken');
select is(pg_temp.book(1), 'ok', 'Rolling: the last week of the window can be taken');
select is(pg_temp.book(2), 'SV006', 'Rolling: the week after the window is refused');
select is(pg_temp.book(0, 1), 'SV006', 'a Monday is refused');
select is(pg_temp.book(-1), 'SV006', 'a Sunday that has passed is refused');
select is(
  (select count(*)::int from public.serving_signups where team_id = current_setting('tds.team')::uuid),
  0, 'a refused date leaves no row');

select is(pg_temp.block(1, 3), 'ok', 'a set block from next week to three weeks out');
select is(pg_temp.book(0), 'SV006', 'Set dates: the Sunday before From is refused');
select is(pg_temp.book(1), 'ok', 'Set dates: the From date can be taken');
select is(pg_temp.book(3), 'ok', 'Set dates: the To date can be taken');
select is(pg_temp.book(4), 'SV006', 'Set dates: the Sunday after To is refused, inside the rolling window or not');

select is(pg_temp.block(-2, 1), 'ok', 'a set block that began two weeks ago');
select is(pg_temp.book(-1), 'SV006', 'Set dates: a Sunday that has passed is refused inside the block too');
select is(pg_temp.book(0), 'ok', 'Set dates: what is left of the block can be taken');

select is(pg_temp.block(-4, -1), 'ok', 'a set block that has ended');
select is(pg_temp.book(0), 'SV006', 'a block that has ended has no dates left');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'serving_signups' and cmd = 'INSERT'),
  0, 'serving_signups has no INSERT policy: the function is the only way to take a date');

select * from finish();
rollback;
