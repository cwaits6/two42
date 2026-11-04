-- Did the most recent scheduled edge function calls start and get a 200?
-- Read-only. Prints statuses and counts, never response bodies, because the
-- workflow that runs it logs to a public repo.
--
-- pg_net keeps responses for 6 hours and doesn't record which job made a
-- request, so responses are matched to a firing by time and this has to run
-- soon after it. The hours and job names copy the cron schedules: a change to
-- those needs a change here, or this reports the jobs as missing.
with clock as (
  select coalesce(nullif(current_setting('scheduled_check.now', true), ''), now()::text)::timestamptz as now
),
firing as (
  select max(t) as at, (select now from clock) as now
  from clock,
    lateral (values
      (date_trunc('day', now at time zone 'utc') + interval '9 hours'),
      (date_trunc('day', now at time zone 'utc') + interval '15 hours'),
      (date_trunc('day', now at time zone 'utc') - interval '9 hours')
    ) as candidates(local_t),
    lateral (select local_t at time zone 'utc' as t) as converted
  where t <= now
),
expected as (
  select jobname
  from firing,
    lateral (values
      ('clean-up-expired-data-nightly', 9, false),
      ('send-event-reminders-daily', 15, false),
      ('send-serving-reminders-daily', 15, false),
      ('send-serving-monthly-broadcast', 15, true)
    ) as jobs(jobname, hour, first_of_month_only)
  where hour = extract(hour from at at time zone 'utc')
    and (not first_of_month_only or extract(day from at at time zone 'utc') = 1)
),
runs as (
  select e.jobname, (
    select d.status
    from cron.job j
    join cron.job_run_details d using (jobid)
    where j.jobname = e.jobname
      and d.start_time >= f.at and d.start_time < f.at + interval '15 minutes'
    order by d.start_time desc
    limit 1
  ) as status
  from expected e cross join firing f
),
responses as (
  select coalesce(r.status_code::text, case when r.timed_out then 'timed out' else 'no status' end) as result
  from net._http_response r cross join firing f
  where r.created >= f.at and r.created < f.at + interval '15 minutes'
),
tallies as (
  select coalesce(jsonb_object_agg(result, n), '{}'::jsonb) as by_result, coalesce(sum(n), 0)::int as total
  from (select result, count(*)::int as n from responses group by result) grouped
),
problems as (
  select format('%s: job run is %s', jobname, coalesce(status, 'missing')) as problem
  from runs where status is distinct from 'succeeded'
  union all
  select 'a job got a 401, so the vault key may match none of the function''s keys'
  from tallies where by_result ? '401'
  union all
  select format('%s response(s) were not 200', total - coalesce((by_result ->> '200')::int, 0))
  from tallies where total <> coalesce((by_result ->> '200')::int, 0)
  union all
  select format('expected %s response(s), found %s', (select count(*) from expected), total)
  from tallies, firing
  where total <> (select count(*) from expected) and now - at < interval '6 hours'
  union all
  select 'checked more than 6 hours after the firing, so its responses are gone'
  from firing where now - at >= interval '6 hours'
)
select jsonb_build_object(
  'firing', (select at from firing),
  'jobs', (select jsonb_object_agg(jobname, coalesce(status, 'missing')) from runs),
  'responses', (select by_result from tallies),
  'problems', (select coalesce(jsonb_agg(problem), '[]'::jsonb) from problems)
) as result;
