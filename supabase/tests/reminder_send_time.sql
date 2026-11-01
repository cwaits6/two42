-- Pins the default send time: a job left on an earlier hour would remind
-- churches in the west on the wrong day.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/reminder_send_time.sql
begin;

select plan(4);

select is(
  (select schedule from cron.job where jobname = 'send-event-reminders-daily'),
  '0 15 * * *',
  'event reminders send at 15:00 UTC'
);

select is(
  (select schedule from cron.job where jobname = 'send-serving-reminders-daily'),
  '0 15 * * *',
  'serving reminders send at 15:00 UTC'
);

select is(
  (select schedule from cron.job where jobname = 'send-serving-monthly-broadcast'),
  '0 15 1 * *',
  'the monthly broadcast sends at 15:00 UTC on the 1st'
);

select is(
  (select count(*)::int from cron.job
    where jobname in (
      'send-event-reminders-daily',
      'send-serving-reminders-daily',
      'send-serving-monthly-broadcast'
    )),
  3,
  'each job exists exactly once'
);

select * from finish();

rollback;
