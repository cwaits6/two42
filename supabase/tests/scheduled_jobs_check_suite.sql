-- private.scheduled_jobs_check(): the rules scripts/check-scheduled-jobs.sql
-- runs against the hosted database, run here against made-up firings on a
-- day no local job ever fired.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/scheduled_jobs_check_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp sequence run_ids start 900000000000;
create function pg_temp.ran(_job text, _at timestamptz, _status text default 'succeeded') returns void language sql as $$
  insert into cron.job_run_details (jobid, runid, database, username, command, status, start_time, end_time)
  select jobid, nextval('run_ids'), 'postgres', current_user, 'select 1', _status,
         _at + interval '5 seconds', _at + interval '6 seconds'
  from cron.job where jobname = _job;
$$;

create temp sequence response_ids start 900000000000;
create function pg_temp.answered(_at timestamptz, _status int, _timed_out boolean default false) returns void language sql as $$
  insert into net._http_response (id, status_code, timed_out, created)
  values (nextval('response_ids'), _status, _timed_out, _at + interval '40 seconds');
$$;

create function pg_temp.problems(_now timestamptz) returns text language sql stable as $$
  select (private.scheduled_jobs_check(_now) -> 'problems')::text;
$$;

-- A whole clean window: every hourly firing from 04:00 to 09:00, the nightly
-- cleanup at 09:00, each run succeeded and each answered 200.
do $$
declare h int;
begin
  for h in 4..9 loop
    perform pg_temp.ran('send-serving-reminders-hourly', make_timestamptz(2031, 3, 5, h, 0, 0, 'UTC'));
    perform pg_temp.answered(make_timestamptz(2031, 3, 5, h, 0, 0, 'UTC'), 200);
  end loop;
  perform pg_temp.ran('clean-up-expired-data-nightly', '2031-03-05T09:00:00Z');
  perform pg_temp.answered('2031-03-05T09:00:00Z', 200);
end $$;

select is(pg_temp.problems('2031-03-05T09:30:00Z'), '[]', 'a clean six hours reports no problem');
select is(
  (select count(*)::int from jsonb_object_keys(private.scheduled_jobs_check('2031-03-05T09:30:00Z') -> 'jobs')),
  7, 'six hourly firings and the nightly cleanup are each checked');
select is(
  private.scheduled_jobs_check('2031-03-05T09:30:00Z') -> 'responses' -> '09:00',
  '{"200": 2}'::jsonb, 'the 09:00 firing''s two responses are counted');
select is(
  private.scheduled_jobs_check('2031-03-05T09:30:00Z') -> 'window',
  '{"from": "2031-03-05T04:00:00+00:00", "to": "2031-03-05T09:00:00+00:00"}'::jsonb,
  'the window is the six firings before the check');
select ok(private.scheduled_jobs_check('2031-03-05T09:30:00Z')::text not like '%return_message%'
  and private.scheduled_jobs_check('2031-03-05T09:30:00Z')::text not like '%content%',
  'the result names no return message or response body');

-- A later window: the hourly job at 10:00 never ran, at 11:00 got a 500,
-- at 12:00 answered nothing, and at 13:00 got a 401.
do $$
begin
  perform pg_temp.answered('2031-03-05T10:00:00Z', 200);
  perform pg_temp.ran('send-serving-reminders-hourly', '2031-03-05T11:00:00Z');
  perform pg_temp.answered('2031-03-05T11:00:00Z', 500);
  perform pg_temp.ran('send-serving-reminders-hourly', '2031-03-05T12:00:00Z');
  perform pg_temp.ran('send-serving-reminders-hourly', '2031-03-05T13:00:00Z');
  perform pg_temp.answered('2031-03-05T13:00:00Z', 401);
  perform pg_temp.ran('send-serving-reminders-hourly', '2031-03-05T14:00:00Z');
  perform pg_temp.answered('2031-03-05T14:00:00Z', 200);
  perform pg_temp.ran('send-serving-reminders-hourly', '2031-03-05T15:00:00Z', 'failed');
  perform pg_temp.ran('send-event-reminders-daily', '2031-03-05T15:00:00Z');
  perform pg_temp.answered('2031-03-05T15:00:00Z', 200);
  perform pg_temp.answered('2031-03-05T15:00:00Z', null, true);
end $$;

select is(
  (select jsonb_agg(p order by p) from jsonb_array_elements_text(private.scheduled_jobs_check('2031-03-05T15:30:00Z') -> 'problems') p),
  jsonb_build_array(
    '1 response(s) at 11:00 were not 200',
    '1 response(s) at 13:00 were not 200',
    '1 response(s) at 15:00 were not 200',
    'a job at 13:00 got a 401, so the vault key may match none of the function''s keys',
    'expected 1 response(s) at 12:00, found 0',
    'send-serving-reminders-hourly at 10:00: job run is missing',
    'send-serving-reminders-hourly at 15:00: job run is failed'
  ),
  'a missing run, a 500, a missing response, a 401, a failed run and a timeout are each named with their hour');
select is(
  private.scheduled_jobs_check('2031-03-05T15:30:00Z') -> 'responses' -> '15:00',
  '{"200": 1, "timed out": 1}'::jsonb, 'a timed-out response is counted as such');

-- The 1st of the month at 15:00 expects the monthly broadcast too.
do $$
begin
  perform pg_temp.ran('send-serving-reminders-hourly', '2031-04-01T15:00:00Z');
  perform pg_temp.ran('send-event-reminders-daily', '2031-04-01T15:00:00Z');
  perform pg_temp.ran('send-serving-monthly-broadcast', '2031-04-01T15:00:00Z');
  perform pg_temp.answered('2031-04-01T15:00:00Z', 200);
  perform pg_temp.answered('2031-04-01T15:00:00Z', 200);
end $$;

select is(
  (select jsonb_agg(p order by p) from jsonb_array_elements_text(private.scheduled_jobs_check('2031-04-01T15:20:00Z') -> 'problems') p),
  jsonb_build_array(
    'expected 1 response(s) at 10:00, found 0',
    'expected 1 response(s) at 11:00, found 0',
    'expected 1 response(s) at 12:00, found 0',
    'expected 1 response(s) at 13:00, found 0',
    'expected 1 response(s) at 14:00, found 0',
    'expected 3 response(s) at 15:00, found 2',
    'send-serving-reminders-hourly at 10:00: job run is missing',
    'send-serving-reminders-hourly at 11:00: job run is missing',
    'send-serving-reminders-hourly at 12:00: job run is missing',
    'send-serving-reminders-hourly at 13:00: job run is missing',
    'send-serving-reminders-hourly at 14:00: job run is missing'
  ),
  'on the 1st, three responses are expected at 15:00, and every hour with nothing is named');

-- A job scheduled partway through a window: the hours before its first run
-- are not expected, on a day earlier than any other run.
do $$
begin
  perform pg_temp.ran('send-serving-reminders-hourly', '2025-03-05T12:00:00Z');
  perform pg_temp.answered('2025-03-05T12:00:00Z', 200);
end $$;

select is(pg_temp.problems('2025-03-05T12:30:00Z'), '[]',
  'the hours before a job first ran are not reported as missing');
select is(
  private.scheduled_jobs_check('2025-03-05T12:30:00Z') -> 'jobs',
  '{"12:00 send-serving-reminders-hourly": "succeeded"}'::jsonb,
  'only the firing since the job''s first run is checked');
select is(
  (select jsonb_agg(p order by p) from jsonb_array_elements_text(private.scheduled_jobs_check('2025-03-05T14:30:00Z') -> 'problems') p),
  jsonb_build_array(
    'expected 1 response(s) at 13:00, found 0',
    'expected 1 response(s) at 14:00, found 0',
    'send-serving-reminders-hourly at 13:00: job run is missing',
    'send-serving-reminders-hourly at 14:00: job run is missing'
  ),
  'a firing missed after the first run is still reported');

-- The event job fires at 15:00, 16:00 and 17:00. The two later hours were
-- added to a job that already ran, so each is expected only from the first
-- time the job ran at that hour.
do $$
begin
  perform pg_temp.ran('send-event-reminders-daily', '2025-03-04T15:00:00Z');
  perform pg_temp.answered('2025-03-04T15:00:00Z', 200);
end $$;

select is(pg_temp.problems('2025-03-04T17:30:00Z'), '[]',
  'an hour a job has never run at is not reported as missing');
select is(
  private.scheduled_jobs_check('2025-03-04T17:30:00Z') -> 'jobs',
  '{"15:00 send-event-reminders-daily": "succeeded"}'::jsonb,
  'only the hour it has run at is checked');

do $$
declare h int;
begin
  for h in 12..17 loop
    perform pg_temp.ran('send-serving-reminders-hourly', make_timestamptz(2025, 3, 6, h, 0, 0, 'UTC'));
    perform pg_temp.answered(make_timestamptz(2025, 3, 6, h, 0, 0, 'UTC'), 200);
    perform pg_temp.ran('send-serving-reminders-hourly', make_timestamptz(2025, 3, 7, h, 0, 0, 'UTC'));
    perform pg_temp.answered(make_timestamptz(2025, 3, 7, h, 0, 0, 'UTC'), 200);
  end loop;
  for h in 15..17 loop
    perform pg_temp.ran('send-event-reminders-daily', make_timestamptz(2025, 3, 6, h, 0, 0, 'UTC'));
    perform pg_temp.answered(make_timestamptz(2025, 3, 6, h, 0, 0, 'UTC'), 200);
  end loop;
  -- The next day its 16:00 firing never ran.
  perform pg_temp.ran('send-event-reminders-daily', '2025-03-07T15:00:00Z');
  perform pg_temp.answered('2025-03-07T15:00:00Z', 200);
  perform pg_temp.ran('send-event-reminders-daily', '2025-03-07T17:00:00Z');
  perform pg_temp.answered('2025-03-07T17:00:00Z', 200);
end $$;

select is(pg_temp.problems('2025-03-06T17:30:00Z'), '[]',
  'the event job''s three firings, each answered 200, report no problem');
select is(
  private.scheduled_jobs_check('2025-03-06T17:30:00Z') -> 'responses' -> '16:00',
  '{"200": 2}'::jsonb, 'the 16:00 firing expects the event job''s response beside the hourly one');
select is(
  (select jsonb_agg(p order by p) from jsonb_array_elements_text(private.scheduled_jobs_check('2025-03-07T17:30:00Z') -> 'problems') p),
  jsonb_build_array(
    'expected 2 response(s) at 16:00, found 1',
    'send-event-reminders-daily at 16:00: job run is missing'
  ),
  'a 16:00 firing missed after the job first ran at that hour is reported');

select * from finish();
rollback;
