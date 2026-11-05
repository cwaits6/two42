-- Did every scheduled edge function call since the last check start and get
-- a 200? Read-only. Prints statuses and counts, never return messages or
-- response bodies, because the workflow that runs it logs to a public repo.
--
-- The rules live in private.scheduled_jobs_check() (a migration), so pgTAP
-- can run them against made-up firings. It covers every hourly firing in the
-- last six hours, which is how long pg_net keeps responses, so this has to
-- run at least that often. Set scheduled_check.now to check an earlier
-- window by hand.
select private.scheduled_jobs_check(
  coalesce(nullif(current_setting('scheduled_check.now', true), ''), now()::text)::timestamptz
) as result;
