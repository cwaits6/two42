-- 15:00 UTC falls on the same calendar date in every US time zone, at an hour
-- people can read an email (5am in Hawaii at the earliest). The serving jobs
-- pick the day from the church's time zone, so an hour that lands on the
-- previous evening in the west would remind on the wrong day.
--
-- cron.schedule() upserts by job name, so this replaces the earlier schedules.

select private.schedule_edge_reminder(
  'send-event-reminders-daily',
  '0 15 * * *',
  '/functions/v1/send-event-reminders',
  '{}'::jsonb
);

select private.schedule_edge_reminder(
  'send-serving-reminders-daily',
  '0 15 * * *',
  '/functions/v1/send-serving-reminders',
  '{"mode":"daily"}'::jsonb
);

select private.schedule_edge_reminder(
  'send-serving-monthly-broadcast',
  '0 15 1 * *',
  '/functions/v1/send-serving-reminders',
  '{"mode":"monthly"}'::jsonb
);
