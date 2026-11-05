-- Event reminders can be chosen: each event says how many days before it
-- its reminder goes out, a group sets the default for new events or turns
-- reminders off, and a person can stop getting them. The job sends before
-- every date of a repeating event and keeps a sent record per date and
-- person, so a rerun or a retry sends nothing twice.

-- ── The three choices ───────────────────────────────────────────────────────
-- Every existing row takes the default, which is what the job did for it
-- before: one reminder, a day ahead, to everyone.
alter table public.events
  add column reminder_days_before smallint not null default 1
    constraint events_reminder_days_before_check check (reminder_days_before in (0, 1, 2, 7));

comment on column public.events.reminder_days_before is
  'Days before the start that the reminder goes out: 1, 2 or 7, or 0 for none. On a repeating event it applies to every date; a date edited on its own follows its series and this column on its row is not read.';

alter table public.group_settings
  add column event_reminders_enabled boolean not null default true,
  add column event_reminder_default_days smallint not null default 1
    constraint group_settings_event_reminder_default_days_check check (event_reminder_default_days in (1, 2, 7));

comment on column public.group_settings.event_reminders_enabled is
  'False sends no event reminders for the group, whatever each event chose; the events keep their choice.';
comment on column public.group_settings.event_reminder_default_days is
  'What Add event starts on for reminder_days_before. Changing it changes no existing event.';

alter table public.profiles
  add column email_event_reminders boolean not null default true;

comment on column public.profiles.email_event_reminders is
  'False stops event reminder emails to this person. Separate from email_announcements; only the person can change it.';

-- The profile update policy lets a church admin and a household manager
-- write another person's row, so the column needs its own rule. The service
-- key carries no user and is not restricted.
create function public.profiles_own_event_reminders() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if auth.uid() is not null and auth.uid() is distinct from old.id then
    raise exception 'only the person can change their own event reminders setting'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_own_event_reminders
  before update of email_event_reminders on public.profiles
  for each row
  when (old.email_event_reminders is distinct from new.email_event_reminders)
  execute function public.profiles_own_event_reminders();

-- ── The sent record ─────────────────────────────────────────────────────────
-- A pass is one date of an event whose reminder is handled; its sends are
-- the people that reminder goes to, fixed when the pass starts. event_id is
-- the series for any of its dates, including one edited on its own, and
-- occurrence_date is the date's calendar day in the church's zone (the day
-- it stood on in the series, for an edited date). So a time change, or an
-- edit to one date, after the reminder went out lands on the same pass and
-- sends nothing.
--
-- Read and written only by the job on the service key, which bypasses row
-- security. The restrictive policy is the tenancy floor every org-owned
-- table carries; with no permissive policy and no grant, no client reaches
-- either table.
create table public.event_reminder_passes (
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  event_id uuid not null,
  occurrence_date date not null,
  started_at timestamptz not null default now(),
  primary key (event_id, occurrence_date),
  unique (event_id, occurrence_date, org_id),
  constraint event_reminder_passes_event_id_fkey
    foreign key (event_id, org_id) references public.events (id, org_id) on delete cascade
);

create table public.event_reminder_sends (
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  event_id uuid not null,
  occurrence_date date not null,
  profile_id uuid not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  primary key (event_id, occurrence_date, profile_id),
  constraint event_reminder_sends_pass_fkey
    foreign key (event_id, occurrence_date, org_id)
    references public.event_reminder_passes (event_id, occurrence_date, org_id) on delete cascade,
  constraint event_reminder_sends_profile_id_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade
);

-- The nightly cleanup deletes a church's passes older than the retention.
create index event_reminder_passes_org_occurrence_date_idx
  on public.event_reminder_passes (org_id, occurrence_date);
-- The profile cascade finds a person's sends here; the pass cascade uses the
-- primary key.
create index event_reminder_sends_profile_id_idx
  on public.event_reminder_sends (profile_id);

alter table public.event_reminder_passes enable row level security;
alter table public.event_reminder_sends enable row level security;

create policy "org isolation" on public.event_reminder_passes
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));
create policy "org isolation" on public.event_reminder_sends
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

revoke all on public.event_reminder_passes from anon, authenticated;
revoke all on public.event_reminder_sends from anon, authenticated;

comment on table public.event_reminder_passes is
  'One event reminder pass per event date. Its existence means that date''s reminder is handled. Read and written by the service key only; deleted with the event, and by the nightly job after its retention.';
comment on table public.event_reminder_sends is
  'One person''s reminder in a pass: claimed_at while a send is in flight, sent_at once Resend accepted it. Read and written by the service key only; goes with its pass and with the person.';

-- Claims every reminder still unsent for one date of an event, starting the
-- pass first when the date has none. Called once per due date by the job on
-- the service key, so it is SECURITY INVOKER: service_role bypasses row
-- security, and the org checks here are what keep the call inside one
-- church. The org comes from the event's own row and is only compared with
-- _org_id, so a wrong org claims nothing and raises.
--
-- Who a date's reminder goes to: a reply to a repeating event covers every
-- date, and a reply on a date edited on its own (_reply_event_id) overrides
-- it for that person and date. Yes or Maybe, still in the event's group,
-- not pending, with an email and their own setting on.
--
-- A claim older than the stale interval belongs to a firing that never
-- settled it, and is claimed again: the send carries an idempotency key, so
-- Resend will not send it twice.
create function public.event_reminder_claim(
  _org_id uuid,
  _event_id uuid,
  _occurrence_date date,
  _reply_event_id uuid
) returns table (profile_id uuid, email text, first_name text, preferred_name text)
  language plpgsql security invoker set search_path = ''
as $$
declare
  _event_org uuid;
  _group uuid;
begin
  select e.org_id, e.group_id into _event_org, _group
  from public.events e
  where e.id = _event_id;

  if _event_org is null or _event_org is distinct from _org_id then
    raise exception 'event reminder claim rejected: event % is not in org %', _event_id, _org_id
      using errcode = 'ER001';
  end if;

  if _reply_event_id is not null and not exists (
    select 1 from public.events e
    where e.id = _reply_event_id and e.org_id = _org_id and e.series_id = _event_id
  ) then
    raise exception 'event reminder claim rejected: % is not a date of event %', _reply_event_id, _event_id
      using errcode = 'ER001';
  end if;

  insert into public.event_reminder_passes (org_id, event_id, occurrence_date)
  values (_org_id, _event_id, _occurrence_date)
  on conflict do nothing;

  if found then
    insert into public.event_reminder_sends (org_id, event_id, occurrence_date, profile_id)
    select _org_id, _event_id, _occurrence_date, p.id
    from public.profiles p
    left join public.rsvps own
      on own.org_id = _org_id and own.event_id = _reply_event_id and own.user_id = p.id
    left join public.rsvps series
      on series.org_id = _org_id and series.event_id = _event_id and series.user_id = p.id
    where p.org_id = _org_id
      and p.email is not null
      and p.role <> 'pending'
      and p.email_event_reminders
      and coalesce(own.status, series.status) in ('yes', 'maybe')
      and exists (
        select 1 from public.group_members gm
        where gm.org_id = _org_id and gm.group_id = _group and gm.profile_id = p.id
      );
  end if;

  return query
  with claimed as (
    update public.event_reminder_sends x
       set claimed_at = pg_catalog.now()
     where x.org_id = _org_id
       and x.event_id = _event_id
       and x.occurrence_date = _occurrence_date
       and x.sent_at is null
       and (x.claimed_at is null or x.claimed_at < pg_catalog.now() - interval '10 minutes')
    returning x.profile_id
  )
  select c.profile_id, p.email, p.first_name, p.preferred_name
  from claimed c
  join public.profiles p on p.id = c.profile_id and p.org_id = _org_id
  where p.email is not null
    and p.email_event_reminders;
end;
$$;

revoke execute on function public.event_reminder_claim(uuid, uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.event_reminder_claim(uuid, uuid, date, uuid) to service_role;

comment on function public.event_reminder_claim(uuid, uuid, date, uuid) is
  'Starts the reminder pass for one date of an event when it has none, fixing its recipients, then claims every unsent reminder in the pass and returns the people to mail. Tenant anchor: the event''s own org_id, compared with _org_id; a mismatch raises ER001. service_role only.';

-- The nightly cleanup deletes a church's passes past their retention through
-- this, a bounded set per call: the database API cannot limit a delete.
-- event_reminder_sends goes with each pass through its foreign key.
-- SECURITY INVOKER on the service key, like the claim.
create function public.event_reminder_passes_prune(_org_id uuid, _before date, _limit integer)
  returns integer
  language sql security invoker set search_path = ''
as $$
  with doomed as (
    select p.event_id, p.occurrence_date
    from public.event_reminder_passes p
    where p.org_id = _org_id and p.occurrence_date < _before
    order by p.occurrence_date
    limit _limit
  ),
  gone as (
    delete from public.event_reminder_passes p
    using doomed d
    where p.org_id = _org_id and p.event_id = d.event_id and p.occurrence_date = d.occurrence_date
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.event_reminder_passes_prune(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.event_reminder_passes_prune(uuid, date, integer) to service_role;

comment on function public.event_reminder_passes_prune(uuid, date, integer) is
  'Deletes at most _limit of one church''s event reminder passes with an occurrence_date before _before, oldest first, and returns how many went. Tenant anchor: the _org_id predicate on every row it reads and deletes. service_role only.';

-- ── The job ─────────────────────────────────────────────────────────────────
-- Same job, three firings: 15:00 UTC sends, and 16:00 and 17:00 finish what
-- a failed or cut-off firing left. All three see the same dates as due (the
-- day runs from one 15:00 UTC to the next) and the sent record keeps the
-- later two from mailing anyone again. The mode in the body is what turns
-- the sent record on in the function, which deploys before this migration.
-- cron.schedule() upserts by job name.
select private.schedule_edge_reminder(
  'send-event-reminders-daily',
  '0 15-17 * * *',
  '/functions/v1/send-event-reminders',
  '{"mode":"dates"}'::jsonb,
  120000
);

-- Cut-over. The job sent at 15:00 UTC with no record, to every event row
-- starting in the 24 hours after it. When this migration lands between that
-- firing and 17:00 UTC, the later firings would find no pass for those dates
-- and mail everyone again. So every row the most recent 15:00 UTC firing
-- covered gets a pass with nothing to send. Kept as a function so the test
-- can run it on both sides of 15:00 UTC; drop it together with the mode of
-- send-event-reminders that keeps no record, once a release has run on the
-- dates mode.
create function private.event_reminder_cutover(_at timestamptz) returns integer
  language plpgsql
  set search_path = ''
as $$
declare
  _firing timestamptz := (date_trunc('day', _at at time zone 'UTC') + interval '15 hours') at time zone 'UTC';
  _n integer;
begin
  if _at < _firing then
    _firing := _firing - interval '1 day';
  end if;

  insert into public.event_reminder_passes (org_id, event_id, occurrence_date)
  select e.org_id,
         coalesce(e.series_id, e.id),
         (coalesce(e.series_occurrence_date, e.start_time) at time zone o.timezone)::date
  from public.events e
  join public.organizations o on o.id = e.org_id
  where not e.is_cancelled
    and e.start_time >= _firing
    and e.start_time <= _firing + interval '24 hours'
  on conflict do nothing;
  get diagnostics _n = row_count;
  return _n;
end;
$$;

revoke all on function private.event_reminder_cutover(timestamptz) from public;

select private.event_reminder_cutover(now());

-- ── Monitoring ──────────────────────────────────────────────────────────────
-- The event job's 16:00 and 17:00 firings join the expected set. A firing
-- hour a job gained later is expected from the first time it ran at that
-- hour, so the check after this migration does not report hours that passed
-- before the schedule changed. A job with no run at all is still expected.
create or replace function private.scheduled_jobs_check(_now timestamptz) returns jsonb
  language sql
  stable
  set search_path = ''
as $$
  with firing as (
    select t as at
    from generate_series(
      date_trunc('hour', _now - interval '6 hours') + interval '1 hour',
      date_trunc('hour', _now),
      interval '1 hour'
    ) as t
  ),
  expected as (
    select f.at, j.jobname
    from firing f
    cross join lateral (values
      ('send-serving-reminders-hourly', null::int, false),
      ('clean-up-expired-data-nightly', 9, false),
      ('send-event-reminders-daily', 15, false),
      ('send-event-reminders-daily', 16, false),
      ('send-event-reminders-daily', 17, false),
      ('send-serving-monthly-broadcast', 15, true)
    ) as j(jobname, hour, first_of_month_only)
    where (j.hour is null or j.hour = extract(hour from f.at at time zone 'UTC'))
      and (not j.first_of_month_only or extract(day from f.at at time zone 'UTC') = 1)
      and f.at >= coalesce(
        (
          select date_trunc('hour', min(d.start_time))
          from cron.job cj
          join cron.job_run_details d using (jobid)
          where cj.jobname = j.jobname
            and (j.hour is null or j.hour = extract(hour from d.start_time at time zone 'UTC'))
        ),
        (
          select 'infinity'::timestamptz
          where exists (
            select 1
            from cron.job cj
            join cron.job_run_details d using (jobid)
            where cj.jobname = j.jobname
          )
        ),
        f.at
      )
  ),
  runs as (
    select e.at, e.jobname, (
      select d.status
      from cron.job j
      join cron.job_run_details d using (jobid)
      where j.jobname = e.jobname
        and d.start_time >= e.at and d.start_time < e.at + interval '15 minutes'
      order by d.start_time desc
      limit 1
    ) as status
    from expected e
  ),
  responses as (
    select f.at,
      coalesce(r.status_code::text, case when r.timed_out then 'timed out' else 'no status' end) as result
    from firing f
    join net._http_response r on r.created >= f.at and r.created < f.at + interval '15 minutes'
  ),
  tallies as (
    select f.at,
      coalesce((select jsonb_object_agg(result, n) from (
        select result, count(*)::int as n from responses r where r.at = f.at group by result
      ) grouped), '{}'::jsonb) as by_result,
      (select count(*)::int from responses r where r.at = f.at) as total,
      (select count(*)::int from expected e where e.at = f.at) as expected
    from firing f
  ),
  problems as (
    select format('%s at %s: job run is %s', jobname, to_char(at at time zone 'UTC', 'HH24:MI'), coalesce(status, 'missing')) as problem
    from runs where status is distinct from 'succeeded'
    union all
    select format('a job at %s got a 401, so the vault key may match none of the function''s keys', to_char(at at time zone 'UTC', 'HH24:MI'))
    from tallies where by_result ? '401'
    union all
    select format('%s response(s) at %s were not 200', total - coalesce((by_result ->> '200')::int, 0), to_char(at at time zone 'UTC', 'HH24:MI'))
    from tallies where total <> coalesce((by_result ->> '200')::int, 0)
    union all
    select format('expected %s response(s) at %s, found %s', expected, to_char(at at time zone 'UTC', 'HH24:MI'), total)
    from tallies where total <> expected
  )
  select jsonb_build_object(
    'window', jsonb_build_object('from', (select min(at) from firing), 'to', (select max(at) from firing)),
    'jobs', (select coalesce(jsonb_object_agg(to_char(at at time zone 'UTC', 'HH24:MI') || ' ' || jobname, coalesce(status, 'missing')), '{}'::jsonb) from runs),
    'responses', (select coalesce(jsonb_object_agg(to_char(at at time zone 'UTC', 'HH24:MI'), by_result), '{}'::jsonb) from tallies),
    'problems', (select coalesce(jsonb_agg(problem), '[]'::jsonb) from problems)
  );
$$;

revoke all on function private.scheduled_jobs_check(timestamptz) from public;
