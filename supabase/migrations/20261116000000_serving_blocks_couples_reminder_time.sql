-- A team's dates can be a block (From and To, up to a year) instead of a
-- rolling window, a team can ask people for more weeks in a row and choose
-- the hour its reminders go out, either spouse can change who is serving on
-- a date, and the serving reminder job becomes hourly with a sent record so a
-- rerun, a crash or a clock change can neither send twice nor skip a day.

-- ── Team settings ───────────────────────────────────────────────────────────
-- Every existing row stays Rolling with no set dates, no extra weeks asked,
-- and no chosen hour. send_hour has no default on purpose: NULL is "not
-- chosen", which a later church-wide default must be able to tell apart
-- from a team that picked the same hour. The hour is read in the church's
-- time zone. 6 to 21 keeps clear of the hours that do not exist, or happen
-- twice, when clocks change.
alter table public.serving_team_settings
  add column schedule text not null default 'rolling'
    constraint serving_team_settings_schedule_check check (schedule in ('rolling', 'set')),
  add column date_from date,
  add column date_to date,
  add column extra_weeks smallint not null default 0
    constraint serving_team_settings_extra_weeks_check check (extra_weeks between 0 and 3),
  add column send_hour smallint
    constraint serving_team_settings_send_hour_check check (send_hour between 6 and 21),
  add constraint serving_team_settings_dates_check check (
    (schedule = 'rolling' and date_from is null and date_to is null)
    or (
      schedule = 'set'
      and date_from is not null
      and date_to is not null
      and date_to > date_from
      and date_to <= (date_from + interval '1 year')::date
    )
  );

comment on column public.serving_team_settings.schedule is
  'rolling: the next window_weeks Sundays. set: the Sundays from date_from to date_to.';
comment on column public.serving_team_settings.date_from is 'First day of a set block; null on rolling.';
comment on column public.serving_team_settings.date_to is 'Last day of a set block, after date_from and within a year of it; null on rolling.';
comment on column public.serving_team_settings.extra_weeks is
  'How many following weeks a sign-up offers in one go, 0 to 3. 0 asks nothing.';
comment on column public.serving_team_settings.send_hour is
  'Whole hour in the church''s time zone the serving reminder goes out, 6 to 21. NULL means not chosen, and the job uses its default hour.';

-- ── Sent record ─────────────────────────────────────────────────────────────
-- One pass per team per local day it is due. The pass fixes who that day's
-- reminder goes to; a date that was open at the pass is handled too, so a
-- later sign-up that day gets no reminder. A row in serving_reminder_sends
-- is one person's reminder: claimed_at marks a send in flight, sent_at a
-- send Resend accepted. Both carry the person's id, so they follow every
-- org_id rule, go with the person through the profile foreign key, and are
-- deleted by the nightly job once they are past their retention.
-- No client policy: only the service key reads or writes these tables.
create table public.serving_reminder_passes (
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  team_id uuid not null,
  send_date date not null,
  started_at timestamptz not null default now(),
  primary key (team_id, send_date),
  constraint serving_reminder_passes_team_id_org_id_key unique (team_id, send_date, org_id),
  constraint serving_reminder_passes_team_id_fkey
    foreign key (team_id, org_id) references public.teams (id, org_id) on delete cascade
);

create table public.serving_reminder_sends (
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  team_id uuid not null,
  send_date date not null,
  profile_id uuid not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  primary key (team_id, send_date, profile_id),
  constraint serving_reminder_sends_pass_fkey
    foreign key (team_id, send_date, org_id)
    references public.serving_reminder_passes (team_id, send_date, org_id) on delete cascade,
  constraint serving_reminder_sends_profile_id_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade
);

-- The nightly cleanup deletes a church's passes older than the retention.
create index serving_reminder_passes_org_send_date_idx
  on public.serving_reminder_passes (org_id, send_date);
-- The profile cascade finds a person's sends here; the pass cascade uses the
-- primary key.
create index serving_reminder_sends_profile_id_idx
  on public.serving_reminder_sends (profile_id);

alter table public.serving_reminder_passes enable row level security;
alter table public.serving_reminder_sends enable row level security;

create policy "org isolation" on public.serving_reminder_passes
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));
create policy "org isolation" on public.serving_reminder_sends
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

revoke all on public.serving_reminder_passes from anon, authenticated;
revoke all on public.serving_reminder_sends from anon, authenticated;

comment on table public.serving_reminder_passes is
  'One serving reminder pass per team per local day. Its existence means that day''s reminder is handled for the team. Read and written by the service key only; deleted by the nightly job after its retention.';
comment on table public.serving_reminder_sends is
  'One person''s reminder in a pass: claimed_at while a send is in flight, sent_at once Resend accepted it. Read and written by the service key only; goes with its pass and with the person.';

-- Claims every reminder still unsent in the given teams' passes for the day,
-- starting the pass first where none exists. Called once per church per
-- firing by the hourly job on the service key, so it is SECURITY INVOKER:
-- service_role bypasses row security, and the org checks here are what keep
-- the call inside one church. The org comes from each team's own row and is
-- only compared with _org_id, so a wrong org claims nothing and raises.
--
-- A claim older than the stale interval belongs to a firing that never
-- settled it, and is claimed again: the send carries an idempotency key, so
-- Resend will not send it twice.
create function public.serving_reminder_claim(
  _org_id uuid,
  _send_date date,
  _service_date date,
  _team_ids uuid[]
) returns table (team_id uuid, profile_id uuid, email text, first_name text, preferred_name text)
  language plpgsql security invoker set search_path = ''
as $$
declare
  _team uuid;
  _team_org uuid;
begin
  foreach _team in array coalesce(_team_ids, '{}') loop
    select t.org_id into _team_org from public.teams t where t.id = _team;
    if _team_org is null or _team_org is distinct from _org_id then
      raise exception 'serving reminder claim rejected: team % is not in org %', _team, _org_id
        using errcode = 'SR001';
    end if;

    insert into public.serving_reminder_passes (org_id, team_id, send_date)
    values (_org_id, _team, _send_date)
    on conflict do nothing;

    if found then
      insert into public.serving_reminder_sends (org_id, team_id, send_date, profile_id)
      select _org_id, _team, _send_date, p.id
      from public.serving_signups s
      join public.serving_signup_attendees a on a.signup_id = s.id and a.org_id = s.org_id
      join public.profiles p on p.id = a.profile_id and p.org_id = a.org_id
      where s.org_id = _org_id
        and s.team_id = _team
        and s.service_date = _service_date
        and p.email is not null
        and p.role <> 'pending';
    end if;
  end loop;

  return query
  with claimed as (
    update public.serving_reminder_sends x
       set claimed_at = pg_catalog.now()
     where x.org_id = _org_id
       and x.send_date = _send_date
       and x.team_id = any (coalesce(_team_ids, '{}'))
       and x.sent_at is null
       and (x.claimed_at is null or x.claimed_at < pg_catalog.now() - interval '10 minutes')
    returning x.team_id, x.profile_id
  )
  select c.team_id, c.profile_id, p.email, p.first_name, p.preferred_name
  from claimed c
  join public.profiles p on p.id = c.profile_id and p.org_id = _org_id
  where p.email is not null;
end;
$$;

revoke execute on function public.serving_reminder_claim(uuid, date, date, uuid[]) from public, anon, authenticated;
grant execute on function public.serving_reminder_claim(uuid, date, date, uuid[]) to service_role;

comment on function public.serving_reminder_claim(uuid, date, date, uuid[]) is
  'Starts the day''s reminder pass for each team that has none, fixing its recipients, then claims every unsent reminder in those passes and returns the people to mail. Tenant anchor: each team''s own org_id, compared with _org_id; a mismatch raises SR001. service_role only.';

-- ── Who can be on a date ────────────────────────────────────────────────────
-- Being on the team stays the one rule for who can sign up. The household
-- rule alone let a spouse who is in the group but not on the team be put on
-- a date; serving_signup_apply now also requires every attendee other than
-- the actor (whose own standing the caller checks) to hold a team_members
-- row for the team. Same body as before otherwise.
create or replace function public.serving_signup_apply(
  _group_id     uuid,
  _service_date date,
  _actor_id     uuid,
  _attendee_ids uuid[]
) returns table (signup_id uuid, signup_org_id uuid, created boolean)
  language plpgsql security definer set search_path = ''
as $$
declare
  _org uuid;
  _actor_org uuid;
  _family_id uuid;
  _attendee_total bigint;
  _attendee_valid bigint;
  _off_team bigint;
  _enabled boolean;
  _signup_id uuid;
  _existing_by uuid;
  _created boolean;
begin
  -- The org comes from the team row, never from the caller. A cross-org
  -- _group_id resolves to a real org here, and the actor's own profile then
  -- fails the equality check below — there is no caller-supplied org to
  -- subvert.
  select t.org_id into _org
  from public.teams t
  where t.id = _group_id;

  if _org is null then
    raise exception 'serving signup rejected: unknown group %', _group_id
      using errcode = 'SV002';
  end if;

  select p.org_id, p.family_id into _actor_org, _family_id
  from public.profiles p
  where p.id = _actor_id;

  if _actor_org is distinct from _org then
    raise exception 'serving signup rejected: actor % does not carry group org', _actor_id
      using errcode = 'SV002';
  end if;

  if _attendee_ids is null
     or coalesce(array_length(_attendee_ids, 1), 0) = 0
     or not (_actor_id = any (_attendee_ids)) then
    raise exception 'serving signup rejected: attendees must be non-empty and include actor %', _actor_id
      using errcode = 'SV002';
  end if;

  -- Household rule, enforced here as well as in the routes: every attendee
  -- is the actor, or shares the actor's non-null household with relationship
  -- primary/spouse — and carries the team's org_id. count(*) over the
  -- DISTINCT subquery (not count(distinct ...)) so a NULL element still
  -- counts on the total side and fails the comparison.
  select count(*) into _attendee_total
  from (select distinct att.pid from unnest(_attendee_ids) as att(pid)) ids;

  select count(*) into _attendee_valid
  from (select distinct att.pid from unnest(_attendee_ids) as att(pid)) ids
  join public.profiles p on p.id = ids.pid
  where p.org_id = _org
    and (
      p.id = _actor_id
      or (
        _family_id is not null
        and p.family_id = _family_id
        and p.relationship in ('primary', 'spouse')
      )
    );

  if _attendee_valid <> _attendee_total then
    raise exception 'serving signup rejected: attendee outside actor %''s org or household', _actor_id
      using errcode = 'SV002';
  end if;

  -- Being on the team is the one rule for who can serve: the caller has
  -- already checked the actor's own standing, and everyone else on the
  -- date (the spouse) has to hold a team_members row for this team.
  select count(*) into _off_team
  from (select distinct att.pid from unnest(_attendee_ids) as att(pid)) ids
  where ids.pid is distinct from _actor_id
    and not exists (
      select 1 from public.team_members tm
      where tm.team_id = _group_id and tm.org_id = _org and tm.profile_id = ids.pid
    );

  if _off_team > 0 then
    raise exception 'serving signup rejected: an attendee is not on team %', _group_id
      using errcode = 'SV004';
  end if;

  select sts.enabled into _enabled
  from public.serving_team_settings sts
  where sts.team_id = _group_id
    and sts.org_id = _org;

  if not coalesce(_enabled, false) then
    raise exception 'serving signups not enabled for group %', _group_id
      using errcode = 'SV003';
  end if;

  -- unique (team_id, service_date) is the race guard. DO NOTHING (not
  -- DO UPDATE) so "who already holds this Sunday" is an explicit branch:
  -- the same member re-signing is an idempotent no-op (created = false), a
  -- different member gets SV001. FOR UPDATE serialises two concurrent
  -- re-signups on the existing row.
  insert into public.serving_signups (org_id, team_id, service_date, family_id, created_by)
  values (_org, _group_id, _service_date, _family_id, _actor_id)
  on conflict (team_id, service_date) do nothing
  returning id into _signup_id;

  if _signup_id is null then
    select s.id, s.created_by into _signup_id, _existing_by
    from public.serving_signups s
    where s.team_id = _group_id
      and s.service_date = _service_date
      and s.org_id = _org
    for update;

    if _existing_by is distinct from _actor_id then
      raise exception 'serving slot already taken for group % on %', _group_id, _service_date
        using errcode = 'SV001';
    end if;
    _created := false;
  else
    _created := true;
  end if;

  -- Additive on re-signup; the (signup_id, profile_id) PK plus DO NOTHING
  -- makes "no duplicate attendee row" structural rather than a race the app
  -- has to avoid. The conflict target is named by constraint: a column list
  -- here would be ambiguous against the signup_id OUT parameter.
  insert into public.serving_signup_attendees (org_id, signup_id, profile_id)
  select _org, _signup_id, ids.pid
  from (select distinct att.pid from unnest(_attendee_ids) as att(pid)) ids
  on conflict on constraint serving_signup_attendees_pkey do nothing;

  return query select _signup_id, _org, _created;
end;
$$;

-- ── Changing who is serving ─────────────────────────────────────────────────
-- Either spouse on a date, or whoever tapped Sign up, can switch it between
-- both of them, one, or the other. SECURITY DEFINER, so the checks in the
-- body replace the attendee policies: the org comes from the signup row and
-- is pinned to the request org, the actor from auth.uid() only, and every
-- new attendee must be the actor or the actor's spouse in the same org, on
-- the team.
create function public.serving_signup_change(_signup_id uuid, _attendee_ids uuid[])
  returns table (added integer, removed integer)
  language plpgsql security definer set search_path = ''
as $$
declare
  _actor uuid;
  _org uuid;
  _team uuid;
  _family uuid;
  _actor_family uuid;
  _actor_relationship text;
  _created_by uuid;
  _involved boolean;
  _total bigint;
  _valid bigint;
  _off_team bigint;
  _added integer;
  _removed integer;
begin
  _actor := auth.uid();
  if _actor is null then
    raise exception 'serving change rejected: no authenticated principal' using errcode = 'SV002';
  end if;

  select s.org_id, s.team_id, s.family_id, s.created_by into _org, _team, _family, _created_by
  from public.serving_signups s
  where s.id = _signup_id;

  if _org is null or _org is distinct from public.app_request_org_id() then
    raise exception 'serving change rejected: signup % does not resolve to the request org', _signup_id
      using errcode = 'SV002';
  end if;

  select p.family_id, p.relationship into _actor_family, _actor_relationship
  from public.profiles p
  where p.id = _actor and p.org_id = _org;

  _involved := _created_by = _actor or exists (
    select 1 from public.serving_signup_attendees a
    where a.signup_id = _signup_id and a.org_id = _org and a.profile_id = _actor
  );
  if not _involved then
    raise exception 'serving change rejected: actor % is not on signup %', _actor, _signup_id
      using errcode = 'SV005';
  end if;

  if _attendee_ids is null or coalesce(array_length(_attendee_ids, 1), 0) = 0 then
    raise exception 'serving change rejected: attendees must be non-empty' using errcode = 'SV002';
  end if;

  -- The household rule from the actor's side: the actor, or the actor's
  -- spouse when the actor is the primary or spouse of a household. count(*) over the DISTINCT subquery so a NULL element
  -- still counts on the total side and fails the comparison.
  select count(*) into _total
  from (select distinct att.pid from unnest(_attendee_ids) as att(pid)) ids;

  select count(*) into _valid
  from (select distinct att.pid from unnest(_attendee_ids) as att(pid)) ids
  join public.profiles p on p.id = ids.pid
  where p.org_id = _org
    and (
      p.id = _actor
      or (
        _actor_family is not null
        and _actor_relationship in ('primary', 'spouse')
        and p.family_id = _actor_family
        and p.relationship in ('primary', 'spouse')
      )
    );

  if _valid <> _total then
    raise exception 'serving change rejected: attendee outside actor %''s household', _actor
      using errcode = 'SV002';
  end if;

  -- Being on the team is the one rule for who can serve: the actor's own
  -- standing was checked when the date was taken, and anyone else put on
  -- it has to hold a team_members row for the signup's team.
  select count(*) into _off_team
  from (select distinct att.pid from unnest(_attendee_ids) as att(pid)) ids
  where ids.pid is distinct from _actor
    and not exists (
      select 1 from public.team_members tm
      where tm.team_id = _team and tm.org_id = _org and tm.profile_id = ids.pid
    );

  if _off_team > 0 then
    raise exception 'serving change rejected: an attendee is not on team %', _team
      using errcode = 'SV004';
  end if;

  with gone as (
    delete from public.serving_signup_attendees a
    where a.signup_id = _signup_id
      and a.org_id = _org
      and a.profile_id <> all (_attendee_ids)
    returning 1
  )
  select count(*) into _removed from gone;

  with came as (
    insert into public.serving_signup_attendees (org_id, signup_id, profile_id)
    select _org, _signup_id, ids.pid
    from (select distinct att.pid from unnest(_attendee_ids) as att(pid)) ids
    on conflict on constraint serving_signup_attendees_pkey do nothing
    returning 1
  )
  select count(*) into _added from came;

  -- The household label on the schedule follows the people now on the date.
  update public.serving_signups s
     set family_id = case when _total > 1 then _actor_family else null end
   where s.id = _signup_id and s.org_id = _org;

  return query select _added, _removed;
end;
$$;

revoke execute on function public.serving_signup_change(uuid, uuid[]) from public, anon;
grant execute on function public.serving_signup_change(uuid, uuid[]) to authenticated, service_role;

comment on function public.serving_signup_change(uuid, uuid[]) is
  'Replaces who is serving on one date. Actor from auth.uid(); tenant anchor: the signup row''s org pinned against app_request_org_id(), fail-closed on NULL. The actor must have tapped Sign up or be listed on the date, and every new attendee must be the actor or the actor''s spouse, on the team. Raises SV002, SV004 or SV005.';

-- ── The hourly job ──────────────────────────────────────────────────────────
-- The hourly run can send for many teams, so pg_net's 5 second default would
-- give up on it and record a timeout while the function kept working. The
-- edge runtime answers within its own budget, well inside this.
drop function private.schedule_edge_reminder(text, text, text, jsonb);

create function private.schedule_edge_reminder(
  job_name text,
  schedule text,
  function_path text,
  body jsonb,
  timeout_ms integer default 5000
) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform cron.schedule(
    job_name,
    schedule,
    format(
      $sql$
      with secrets as (
        select name, decrypted_secret
        from vault.decrypted_secrets
        where name in ('cron_project_url', 'cron_service_role_key')
      )
      select net.http_post(
        url := (select decrypted_secret from secrets where name = 'cron_project_url') || %L,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from secrets where name = 'cron_service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := %L::jsonb,
        timeout_milliseconds := %s
      );
      $sql$,
      function_path,
      body::text,
      timeout_ms
    )
  );
end;
$$;

revoke all on function private.schedule_edge_reminder(text, text, text, jsonb, integer) from public;

-- cron.schedule() upserts by job name, so the renamed job would leave the
-- daily one firing beside it.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-serving-reminders-daily') then
    perform cron.unschedule('send-serving-reminders-daily');
  end if;
end $$;

select private.schedule_edge_reminder(
  'send-serving-reminders-hourly',
  '0 * * * *',
  '/functions/v1/send-serving-reminders',
  '{"mode":"hourly"}'::jsonb,
  120000
);

-- Cut-over. The daily job sent at 15:00 UTC, with no record. If this
-- migration lands after that firing, the hourly job would find no pass for
-- today, see the team's hour has passed, and send everyone again. So when
-- the daily firing is already behind us, every enabled team gets a pass for
-- the church's local date that firing acted on, and nothing is sent twice;
-- before it, no pass is written and the hourly job sends today's reminders
-- itself. Kept as a function so the test can run it on both sides of 15:00
-- UTC; drop it together with the daily mode of send-serving-reminders once
-- a release has run on the hourly job.
create function private.serving_reminder_cutover(_at timestamptz) returns integer
  language plpgsql
  set search_path = ''
as $$
declare
  _daily_firing timestamptz := (date_trunc('day', _at at time zone 'UTC') + interval '15 hours') at time zone 'UTC';
  _n integer;
begin
  if _at < _daily_firing then
    return 0;
  end if;

  insert into public.serving_reminder_passes (org_id, team_id, send_date)
  select sts.org_id, sts.team_id, (_daily_firing at time zone o.timezone)::date
  from public.serving_team_settings sts
  join public.organizations o on o.id = sts.org_id
  where sts.enabled
  on conflict do nothing;
  get diagnostics _n = row_count;
  return _n;
end;
$$;

revoke all on function private.serving_reminder_cutover(timestamptz) from public;

select private.serving_reminder_cutover(now());

-- ── Monitoring ──────────────────────────────────────────────────────────────
-- Did every scheduled edge function call in the window start and get a 200?
-- Read by scripts/check-scheduled-jobs.sql against the hosted database every
-- six hours, which is how long pg_net keeps responses. Reports statuses and
-- counts only: the workflow that runs it logs to a public repository, and a
-- return_message or response body could carry request headers.
--
-- pg_net does not record which job made a request, so responses are matched
-- to a firing by time. The hours and job names copy the cron schedules: a
-- schedule change needs a change here, or a job is reported missing.
create function private.scheduled_jobs_check(_now timestamptz) returns jsonb
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
      ('send-serving-monthly-broadcast', 15, true)
    ) as j(jobname, hour, first_of_month_only)
    where (j.hour is null or j.hour = extract(hour from f.at at time zone 'UTC'))
      and (not j.first_of_month_only or extract(day from f.at at time zone 'UTC') = 1)
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
