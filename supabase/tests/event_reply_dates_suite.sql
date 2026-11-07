-- Replies name the date they answer: the day event_reply_day() picks for a
-- save that names none (a clock change, a late-evening start, month ends,
-- series that have ended, cancelled and edited dates); the saves of a build
-- that sends no date, replayed as PostgREST sends them; rsvp_set(); who can
-- write and read a reply, by row count; and the reminder claim, which reads
-- replies as before until the unique key includes the date.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/event_reply_dates_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  me uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  grp uuid;
  grp_2 uuid;
  grp_b uuid;
  late uuid;
  evening uuid;
  long_evening uuid;
  month_end uuid;
  counted uuid;
  until_ended uuid;
  moved uuid;
  single uuid;
  hidden uuid;
  event_b uuid;
  claim_series uuid;
  claim_moved uuid;
begin
  org_a := public.provision_organization('Reply Dates Org A', 'owner-a@reply-dates.example.test');
  org_b := public.provision_organization('Reply Dates Org B', 'owner-b@reply-dates.example.test');
  update public.organizations set timezone = 'America/Chicago' where id = org_a;
  update public.organizations set timezone = 'Pacific/Auckland' where id = org_b;

  insert into public.access_requests (org_id, name, email, status)
  select org_a, who, who || '@reply-dates.example.test', 'approved'
  from unnest(array['me', 'other', 'outsider']) as who;
  insert into auth.users (id, email) values
    (owner_a, 'owner-a@reply-dates.example.test'),
    (owner_b, 'owner-b@reply-dates.example.test'),
    (me, 'me@reply-dates.example.test'),
    (other, 'other@reply-dates.example.test'),
    (outsider, 'outsider@reply-dates.example.test');

  insert into public.groups (org_id, name) values (org_a, 'group one') returning id into grp;
  insert into public.groups (org_id, name) values (org_a, 'group two') returning id into grp_2;
  insert into public.groups (org_id, name) values (org_b, 'group B') returning id into grp_b;
  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org_a, grp, owner_a, 'leader'),
    (org_a, grp, me, 'member'),
    (org_a, grp, other, 'member'),
    (org_a, grp_2, outsider, 'leader'),
    (org_b, grp_b, owner_b, 'leader');

  -- 23:30 on Sunday Nov 2, 2031 in Chicago, after the clocks go back; 05:30
  -- Monday in UTC. Nov 9 is cancelled and Nov 16 moved to the Friday before.
  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode)
    values (org_a, grp, 'Late Sundays', '2031-11-02 23:30-06', 'weekly', 'never') returning id into late;
  insert into public.events (org_id, group_id, title, start_time, series_id, series_occurrence_date, is_cancelled)
    values (org_a, grp, 'Late Sundays', '2031-11-09 23:30-06', late, '2031-11-09 23:30-06', true);
  insert into public.events (org_id, group_id, title, start_time, series_id, series_occurrence_date)
    values (org_a, grp, 'Late Sundays, moved', '2031-11-14 23:30-06', late, '2031-11-16 23:30-06')
    returning id into moved;
  -- 19:00 on Sunday Oct 26, 2031, through both clock changes; 22 dates, the
  -- last on Mar 21, 2032.
  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode, recurrence_count)
    values (org_a, grp, 'Evening Sundays', '2031-10-26 19:00-05', 'weekly', 'count', 22) returning id into evening;
  -- 18:00 to 21:00 on Wednesdays.
  insert into public.events (org_id, group_id, title, start_time, end_time, recurrence_frequency, recurrence_end_mode)
    values (org_a, grp, 'Long Wednesdays', '2031-10-01 18:00-05', '2031-10-01 21:00-05', 'weekly', 'never')
    returning id into long_evening;
  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode)
    values (org_a, grp, 'Month end', '2031-01-31 10:00-06', 'monthly', 'never') returning id into month_end;
  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode, recurrence_count)
    values (org_a, grp, 'Three Sundays', '2031-03-02 10:00-06', 'weekly', 'count', 3) returning id into counted;
  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode, recurrence_until)
    values (org_a, grp, 'Until the 20th', '2031-03-02 10:00-06', 'weekly', 'until', '2031-03-20 23:59-05')
    returning id into until_ended;
  insert into public.events (org_id, group_id, title, start_time)
    values (org_a, grp, 'Fourth of July', '2031-07-04 23:00-05') returning id into single;
  insert into public.events (org_id, group_id, title, start_time)
    values (org_a, grp_2, 'Group two only', '2031-07-04 10:00-05') returning id into hidden;
  insert into public.events (org_id, group_id, title, start_time)
    values (org_b, grp_b, 'Org B event', '2031-07-04 10:00-05') returning id into event_b;
  insert into public.rsvps (org_id, event_id, user_id, status, occurrence_date)
    values (org_b, event_b, owner_b, 'yes', '2031-07-05');

  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode)
    values (org_a, grp, 'Claim weekly', '2031-03-05 19:00-06', 'weekly', 'never') returning id into claim_series;
  insert into public.events (org_id, group_id, title, start_time, series_id, series_occurrence_date)
    values (org_a, grp, 'Claim weekly, moved', '2031-03-13 18:00-05', claim_series, '2031-03-12 19:00-05')
    returning id into claim_moved;
  -- me answered one date; other answered another, and No on the moved date.
  insert into public.rsvps (org_id, event_id, user_id, status, occurrence_date) values
    (org_a, claim_series, me, 'yes', '2031-03-05'),
    (org_a, claim_series, other, 'maybe', '2031-03-19'),
    (org_a, claim_moved, other, 'no', '2031-03-12');

  perform set_config('rd.org_a', org_a::text, true);
  perform set_config('rd.org_b', org_b::text, true);
  perform set_config('rd.me', me::text, true);
  perform set_config('rd.other', other::text, true);
  perform set_config('rd.late', late::text, true);
  perform set_config('rd.moved', moved::text, true);
  perform set_config('rd.evening', evening::text, true);
  perform set_config('rd.long_evening', long_evening::text, true);
  perform set_config('rd.month_end', month_end::text, true);
  perform set_config('rd.counted', counted::text, true);
  perform set_config('rd.until_ended', until_ended::text, true);
  perform set_config('rd.single', single::text, true);
  perform set_config('rd.hidden', hidden::text, true);
  perform set_config('rd.event_b', event_b::text, true);
  perform set_config('rd.claim_series', claim_series::text, true);
  perform set_config('rd.claim_moved', claim_moved::text, true);
end $$;

create function pg_temp.id(_name text) returns uuid language sql stable as $$
  select current_setting('rd.' || _name)::uuid;
$$;

-- Runs one statement as a signed-in person (or nobody, for null) and returns
-- how many rows it wrote, or the SQLSTATE.
create function pg_temp.wrote(_who text, _sql text) returns text language plpgsql as $$
declare n bigint; out text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    case when _who is null then '' else json_build_object('sub', current_setting('rd.' || _who))::text end, true);
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
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rd.' || _who))::text, true);
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

-- The dates a person's replies to an event sit on, as postgres.
create function pg_temp.dates_of(_who text, _event text) returns text language sql stable as $$
  select coalesce(string_agg(coalesce(r.occurrence_date::text, 'none') || ':' || r.status, ','
                             order by r.occurrence_date), '')
  from public.rsvps r
  where r.user_id = pg_temp.id(_who) and r.event_id = pg_temp.id(_event);
$$;

-- ── The day a save with no date answers ─────────────────────────────────────
select is(public.event_reply_day(pg_temp.id('late'), '2031-11-01 12:00-05'), '2031-11-02'::date,
  'a date starting at 23:30 answers its own day in the church''s zone, not the UTC day');
select is(public.event_reply_day(pg_temp.id('late'), '2031-11-03 02:00-06'), '2031-11-16'::date,
  'a cancelled next date is skipped, and an edited date answers the day it stood on in the series');
select is(public.event_reply_day(pg_temp.id('late'), '2031-11-15 00:00-06'), '2031-11-16'::date,
  'an edited date that has started but not ended by its own times is still answered');
select is(public.event_reply_day(pg_temp.id('late'), '2031-11-15 01:30-06'), '2031-11-23'::date,
  'an edited date two hours past its own start, with no end time, has ended and is skipped');
select is(public.event_reply_day(pg_temp.id('evening'), '2031-11-03 12:00-06'), '2031-11-09'::date,
  'the first date after the clocks go back keeps its weekday');
select is(public.event_reply_day(pg_temp.id('evening'), '2032-03-14 18:00-05'), '2032-03-14'::date,
  'the first date after the clocks go forward keeps its weekday');
select is(public.event_reply_day(pg_temp.id('evening'), '2032-03-14 19:30-05'), '2032-03-14'::date,
  'a date that has started is answered until it ends');
select is(public.event_reply_day(pg_temp.id('evening'), '2032-03-14 21:00-05'), '2032-03-21'::date,
  'a date with no end time ends two hours after it starts, and the next one is answered');
select is(public.event_reply_day(pg_temp.id('long_evening'), '2031-10-08 20:30-05'), '2031-10-08'::date,
  'a date with an end time is answered until that end, past the two-hour default');
select is(public.event_reply_day(pg_temp.id('long_evening'), '2031-10-08 21:00-05'), '2031-10-15'::date,
  'at its end time a date has ended, and the next one is answered');
select is(public.event_reply_day(pg_temp.id('evening'), '2032-06-01 00:00-05'), '2032-03-21'::date,
  'a series that has used up its count answers its last date');
select is(public.event_reply_day(pg_temp.id('until_ended'), '2031-04-01 00:00-05'), '2031-03-16'::date,
  'a series past its end date answers its last date');
select is(public.event_reply_day(pg_temp.id('counted'), '2031-04-01 00:00-05'), '2031-03-16'::date,
  'a three-date series answers its third date once all have passed');
select is(public.event_reply_day(pg_temp.id('month_end'), '2031-02-01 00:00-06'), '2031-02-28'::date,
  'a monthly date on the 31st takes the last day of a shorter month');
select is(public.event_reply_day(pg_temp.id('month_end'), '2031-04-01 00:00-05'), '2031-04-30'::date,
  'and counts each month from the first date, not from the clamped one');
select is(public.event_reply_day(pg_temp.id('single'), '2031-01-01 00:00-06'), '2031-07-04'::date,
  'a one-time event at 23:00 answers its own day');
select is(public.event_reply_day(pg_temp.id('moved'), '2031-01-01 00:00-06'), '2031-11-16'::date,
  'an edited date''s own row answers the day it stood on in the series');
select is(pg_temp.read_as('me', format('select public.event_reply_day(%L, now())', pg_temp.id('event_b'))), null,
  'another church''s event has no day for a member');
select is(pg_temp.read_as('me', format('select public.event_reply_day(%L, now())', pg_temp.id('hidden'))), null,
  'an event in a group the member is not in has no day for them');

-- ── Saves from a build that sends no date, as PostgREST sends them ──────────
create function pg_temp.legacy_upsert(_event text, _status text) returns text language sql as $$
  select format(
    'insert into public.rsvps (event_id, user_id, status) values (%L, %L, %L) '
    'on conflict (event_id, user_id) do update set event_id = excluded.event_id, '
    'user_id = excluded.user_id, status = excluded.status returning user_id',
    pg_temp.id(_event), current_setting('rd.me'), _status);
$$;

select is(pg_temp.wrote('me', pg_temp.legacy_upsert('late', 'yes')), '1',
  'a dateless upsert on a series saves one row');
select is(pg_temp.dates_of('me', 'late'), '2031-11-02:yes',
  'and the trigger dates it to the series'' next date');
select is(pg_temp.wrote('me', pg_temp.legacy_upsert('late', 'no')), '1',
  'the same upsert again saves one row');
select is(pg_temp.dates_of('me', 'late'), '2031-11-02:no',
  'it changes the status and keeps the date');

update public.rsvps set occurrence_date = null where user_id = pg_temp.id('me') and event_id = pg_temp.id('late');
select is(pg_temp.wrote('me', pg_temp.legacy_upsert('late', 'maybe')), '1',
  'a dateless upsert on a reply saved before replies named a date saves one row');
select is(pg_temp.dates_of('me', 'late'), 'none:maybe',
  'and leaves it covering every date');

select is(pg_temp.wrote('me', pg_temp.legacy_upsert('moved', 'yes')), '1',
  'a dateless upsert on an edited date saves one row');
select is(pg_temp.dates_of('me', 'moved'), '2031-11-16:yes',
  'dated with the day it stood on in the series');
select is(pg_temp.wrote('me', pg_temp.legacy_upsert('single', 'yes')), '1',
  'a dateless upsert on a one-time event saves one row');
select is(pg_temp.dates_of('me', 'single'), '2031-07-04:yes', 'dated with its own day');

select is(pg_temp.wrote('me', format(
    'delete from public.rsvps where event_id = %L and user_id = %L returning user_id',
    pg_temp.id('late'), current_setting('rd.me'))), '1',
  'a dateless delete removes the person''s one row for the event');
select is(pg_temp.wrote('me', format(
    'delete from public.rsvps where event_id in (%L, %L) and user_id = %L returning user_id',
    pg_temp.id('moved'), pg_temp.id('single'), current_setting('rd.me'))), '2',
  'and the edited date''s and one-time event''s rows');

-- ── rsvp_set ────────────────────────────────────────────────────────────────
create function pg_temp.set_sql(_event text, _date text, _status text default null) returns text language sql as $$
  select format('select public.rsvp_set(%L, %L, %L)', pg_temp.id(_event), _date::date, _status);
$$;

select is(pg_temp.wrote('me', pg_temp.set_sql('evening', '2031-11-09', 'yes')), '1', 'rsvp_set saves a reply');
select is(pg_temp.dates_of('me', 'evening'), '2031-11-09:yes', 'on the date it names');
select is(pg_temp.wrote('me', pg_temp.set_sql('evening', '2031-11-16', 'maybe')), '1',
  'rsvp_set saves a reply to a second date');
select is(pg_temp.dates_of('me', 'evening'), '2031-11-16:maybe',
  'which moves the one reply a person holds per event while the key has no date');
select is(pg_temp.wrote('me', pg_temp.set_sql('evening', '2031-11-09')), '1',
  'clearing a date the reply is not on succeeds');
select is(pg_temp.dates_of('me', 'evening'), '2031-11-16:maybe', 'and leaves the reply where it is');
select is(pg_temp.wrote('me', pg_temp.set_sql('evening', '2031-11-16')), '1', 'clearing the date it is on succeeds');
select is(pg_temp.dates_of('me', 'evening'), '', 'and removes it');

insert into public.rsvps (org_id, event_id, user_id, status) values (pg_temp.id('org_a'), pg_temp.id('late'), pg_temp.id('me'), 'yes');
update public.rsvps set occurrence_date = null where user_id = pg_temp.id('me') and event_id = pg_temp.id('late');
select is(pg_temp.wrote('me', pg_temp.set_sql('late', '2031-11-23')), '1',
  'clearing any date of a reply saved before replies named a date succeeds');
select is(pg_temp.dates_of('me', 'late'), '', 'and removes it from every date');

insert into public.rsvps (org_id, event_id, user_id, status, occurrence_date)
  values (pg_temp.id('org_a'), pg_temp.id('late'), pg_temp.id('me'), 'no', '2031-11-16');
select is(pg_temp.wrote('me', pg_temp.set_sql('late', '2031-11-16', 'yes')), '1',
  'rsvp_set saves a reply to an edited date');
select is(pg_temp.dates_of('me', 'moved'), '2031-11-16:yes', 'on the edited date''s own row');
select is(pg_temp.dates_of('me', 'late'), '',
  'and removes a reply the series held for that date before it was edited');
select is(pg_temp.wrote('me', pg_temp.set_sql('late', '2031-11-16')), '1', 'clearing the edited date succeeds');
select is(pg_temp.dates_of('me', 'moved'), '', 'and removes its row');

select is(pg_temp.wrote('me', pg_temp.set_sql('moved', '2031-11-16', 'yes')), '22023',
  'an edited date''s own id is refused: a reply names the series');
select is(pg_temp.wrote('me', format('select public.rsvp_set(%L, null, %L)', pg_temp.id('single'), 'yes')), '22023',
  'a reply with no date is refused');
select is(pg_temp.wrote('me', pg_temp.set_sql('single', '2031-07-04', 'perhaps')), '23514',
  'a status other than yes, no or maybe is refused');
select is(pg_temp.wrote(null, pg_temp.set_sql('single', '2031-07-04', 'yes')), '42501',
  'a caller with no signed-in person is refused');

-- ── Who can write and read a reply ──────────────────────────────────────────
select is(pg_temp.wrote('me', format(
    'insert into public.rsvps (event_id, user_id, status, occurrence_date) values (%L, %L, ''yes'', ''2031-07-04'')',
    pg_temp.id('single'), current_setting('rd.other'))), '42501',
  'a member cannot save a reply for another person');
select is((select count(*)::int from public.rsvps where user_id = pg_temp.id('other') and event_id = pg_temp.id('single')), 0,
  'and the other person has no reply');
select is(pg_temp.wrote('me', pg_temp.set_sql('hidden', '2031-07-04', 'yes')), '42501',
  'rsvp_set refuses an event in a group the member is not in');
select is((select count(*)::int from public.rsvps where event_id = pg_temp.id('hidden')), 0,
  'and nothing is saved on it');
select is(pg_temp.wrote('me', pg_temp.set_sql('event_b', '2031-07-05', 'yes')), '42501',
  'rsvp_set refuses another church''s event');
select is((select count(*)::int from public.rsvps where org_id = pg_temp.id('org_b')), 1,
  'and another church''s replies are unchanged');
select is(pg_temp.read_as('me', 'select count(*)::text from public.rsvps where org_id = ' || quote_literal(current_setting('rd.org_b'))), '0',
  'a member reads none of another church''s dated replies');
select is(pg_temp.read_as('me', format('select count(*)::text from public.rsvps where event_id = %L', pg_temp.id('claim_series'))), '2',
  'and reads every reply on their own group''s event');
select ok(not has_function_privilege('anon', 'public.rsvp_set(uuid, date, text)', 'execute'),
  'anon cannot run rsvp_set');
select ok(not has_function_privilege('anon', 'public.event_reply_day(uuid, timestamptz)', 'execute'),
  'anon cannot run event_reply_day');
select ok(has_function_privilege('authenticated', 'public.rsvp_set(uuid, date, text)', 'execute'),
  'a signed-in person can run rsvp_set');

-- ── The reminder claim reads replies per event until the key has a date ─────
create function pg_temp.claimed(_date date, _reply text default null) returns text language plpgsql as $$
declare out text;
begin
  set local role service_role;
  select string_agg(split_part(c.email, '@', 1), ',' order by c.email) into out
  from public.event_reminder_claim(pg_temp.id('org_a'), pg_temp.id('claim_series'), _date,
                                   case when _reply is null then null else pg_temp.id(_reply) end) c
  where c.email like '%@reply-dates.example.test';
  reset role;
  return coalesce(out, '');
end $$;

select is(pg_temp.claimed('2031-03-26'), 'me,other',
  'a dated reply to a series still reaches every date''s reminder');
select is(pg_temp.claimed('2031-03-12', 'claim_moved'), 'me',
  'and an edited date''s own No still overrides the series reply');

select * from finish();
rollback;
