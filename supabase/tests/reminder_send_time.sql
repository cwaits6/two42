-- Pins the send times: the event reminders send at 15:00 UTC, which falls on
-- the same calendar date in every US time zone, with two more firings to
-- finish a run that failed or was cut off, and the serving reminders fire
-- every hour so each team's chosen hour in its church's zone is met.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/reminder_send_time.sql
begin;

select plan(6);

select is(
  (select schedule from cron.job where jobname = 'send-event-reminders-daily'),
  '0 15-17 * * *',
  'event reminders send at 15:00 UTC, and fire again at 16:00 and 17:00'
);

select ok(
  (select command like '%"mode": "dates"%' and command like '%timeout_milliseconds := 120000%'
    from cron.job where jobname = 'send-event-reminders-daily'),
  'the event job posts the mode that keeps the sent record and waits long enough for the run'
);

select is(
  (select schedule from cron.job where jobname = 'send-serving-reminders-hourly'),
  '0 * * * *',
  'serving reminders fire every hour'
);

select is(
  (select schedule from cron.job where jobname = 'send-serving-monthly-broadcast'),
  '0 15 1 * *',
  'the monthly broadcast sends at 15:00 UTC on the 1st'
);

select is(
  (select count(*)::int from cron.job where jobname = 'send-serving-reminders-daily'),
  0,
  'the daily serving job no longer fires beside the hourly one'
);

select is(
  (select count(*)::int from cron.job
    where jobname in (
      'send-event-reminders-daily',
      'send-serving-reminders-hourly',
      'send-serving-monthly-broadcast'
    )),
  3,
  'each job exists exactly once'
);

select * from finish();

rollback;
