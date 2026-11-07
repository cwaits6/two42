-- A reply names the date it answers. This is the expand step: the column is
-- nullable and the unique key stays (event_id, user_id), because the build
-- live while this lands upserts on exactly that key and sends no date. A
-- trigger dates its saves; the app writes through rsvp_set(), whose
-- signature the contract step keeps when it swaps the key.

-- ── The date ────────────────────────────────────────────────────────────────
alter table public.rsvps add column occurrence_date date;

comment on column public.rsvps.occurrence_date is
  'The calendar day, in the church''s zone, of the date this reply answers; for a date edited on its own, the day it stood on in the series. Keyed like event_reminder_passes. NULL on a reply saved before replies named a date: it covers every date of its event.';

-- The day a reply to _event_id made at _at answers: a one-time event's own
-- day, an edited date's series day, or a series' first date that is not
-- cancelled and ends after _at. A series with no such date answers its last
-- date. A date ends at its end time, or two hours after it starts when it has
-- none, as meetingEndMs() in lib/meetings.ts has it: the app takes replies
-- until that moment. Dates step in the church's wall clock from the first one,
-- as addRecurrenceInterval() in lib/recurrence.ts does, so a clock change or
-- a late-evening start never moves a day, and a month too short for the
-- first date's day takes its last day.
--
-- SECURITY INVOKER: it reads the event under the caller's row security, so
-- an event the caller cannot see is NULL. The zone is the event's own org's.
create function public.event_reply_day(_event_id uuid, _at timestamptz)
  returns date
  language plpgsql stable security invoker set search_path = ''
as $$
declare
  _e public.events%rowtype;
  _tz text;
  _first timestamp;
  _step interval;
  _longest interval;
  _length interval;
  _bound timestamptz;
  _n integer;
  _walked integer := 0;
  _local timestamp;
  _day date;
  _starts timestamptz;
  _edited_cancelled boolean;
  _edited_ends timestamptz;
  _last date;
begin
  select * into _e from public.events e where e.id = _event_id;
  if not found then
    return null;
  end if;
  select o.timezone into _tz from public.organizations o where o.id = _e.org_id;
  if _tz is null then
    return null;
  end if;

  if _e.series_id is not null or _e.recurrence_frequency is null or _e.recurrence_interval < 1 then
    return (coalesce(_e.series_occurrence_date, _e.start_time) at time zone _tz)::date;
  end if;

  _first := _e.start_time at time zone _tz;
  _step := case _e.recurrence_frequency
    when 'daily' then interval '1 day'
    when 'weekly' then interval '7 days'
    when 'monthly' then interval '1 month'
    else interval '1 year'
  end * _e.recurrence_interval;
  _longest := case _e.recurrence_frequency
    when 'daily' then interval '1 day'
    when 'weekly' then interval '7 days'
    when 'monthly' then interval '31 days'
    else interval '366 days'
  end * _e.recurrence_interval;
  _length := coalesce(_e.end_time - _e.start_time, interval '2 hours');
  _bound := case when _e.recurrence_end_mode = 'until' then least(_at, _e.recurrence_until) else _at end;

  -- No step is longer than _longest, so this index is at or before the first
  -- date that ends after _at, and at or before the series' last date.
  _n := greatest(0, floor(extract(epoch from (_bound - _length - _e.start_time)) / extract(epoch from _longest))::integer - 1);
  if _e.recurrence_end_mode = 'count' then
    _n := least(_n, greatest(coalesce(_e.recurrence_count, 1) - 1, 0));
  end if;

  loop
    exit when _e.recurrence_end_mode = 'count' and _n >= coalesce(_e.recurrence_count, 1);
    _local := _first + _step * _n;
    _starts := _local at time zone _tz;
    exit when _e.recurrence_end_mode = 'until' and _starts > _e.recurrence_until;
    _day := _local::date;

    select x.is_cancelled, coalesce(x.end_time, x.start_time + interval '2 hours')
      into _edited_cancelled, _edited_ends
    from public.events x
    where x.series_id = _e.id
      and (x.series_occurrence_date at time zone _tz)::date = _day
    limit 1;

    if found then
      if not _edited_cancelled then
        if _edited_ends > _at then
          return _day;
        end if;
        _last := _day;
      end if;
    else
      if _starts + _length > _at then
        return _day;
      end if;
      _last := _day;
    end if;

    _n := _n + 1;
    _walked := _walked + 1;
    exit when _walked >= 10000;
  end loop;

  return coalesce(_last, (_e.start_time at time zone _tz)::date);
end;
$$;

revoke execute on function public.event_reply_day(uuid, timestamptz) from public, anon;
grant execute on function public.event_reply_day(uuid, timestamptz) to authenticated, service_role;

comment on function public.event_reply_day(uuid, timestamptz) is
  'The calendar day, in the church''s zone, that a reply to the event made at _at answers: a series'' first date that is not cancelled and has not ended, else its last date. SECURITY INVOKER: reads the event under the caller''s row security, so an event the caller cannot see is NULL; the zone is the event''s own org''s.';

-- ── Dating a save that names no date ────────────────────────────────────────
-- Drop this trigger and its function with the contract step's NOT NULL, once
-- no deployed build saves a reply without a date. An event the caller cannot
-- see leaves the date NULL, and the insert policy refuses the row as before.
create function public.rsvps_fill_occurrence_date() returns trigger
  language plpgsql security invoker set search_path = ''
as $$
begin
  new.occurrence_date := public.event_reply_day(new.event_id, pg_catalog.now());
  return new;
end;
$$;

create trigger rsvps_fill_occurrence_date
  before insert on public.rsvps
  for each row
  when (new.occurrence_date is null)
  execute function public.rsvps_fill_occurrence_date();

-- ── Saving a reply ──────────────────────────────────────────────────────────
-- Sets or clears the signed-in person's reply to one date of an event: no
-- _status clears it. _event_id is the series for any of its dates.
-- While the unique key is (event_id, user_id) a person holds one reply per
-- event, so answering a second date moves it; and a date edited on its own
-- is saved on its own row, which is where the reminder claim reads it.
--
-- SECURITY INVOKER: the rsvps policies decide every write, user_id is always
-- auth.uid(), and org_id comes from its default. An event the caller cannot
-- see raises 42501, the same as the insert policy's refusal.
create function public.rsvp_set(_event_id uuid, _occurrence_date date, _status text default null)
  returns text
  language plpgsql volatile security invoker set search_path = ''
as $$
declare
  _me uuid := auth.uid();
  _series uuid;
  _org uuid;
  _tz text;
  _target uuid;
begin
  if _me is null then
    raise exception 'a reply needs a signed-in person' using errcode = '42501';
  end if;
  if _occurrence_date is null then
    raise exception 'a reply needs a date' using errcode = '22023';
  end if;
  if _status is not null and _status not in ('yes', 'no', 'maybe') then
    raise exception 'a reply is yes, no or maybe' using errcode = '22023';
  end if;

  select e.series_id, e.org_id into _series, _org from public.events e where e.id = _event_id;
  if not found then
    raise exception 'event % not found', _event_id using errcode = '42501';
  end if;
  if _series is not null then
    raise exception 'a reply names the series, not a date edited on its own' using errcode = '22023';
  end if;
  select o.timezone into _tz from public.organizations o where o.id = _org;

  select x.id into _target
  from public.events x
  where x.series_id = _event_id
    and not x.is_cancelled
    and (x.series_occurrence_date at time zone _tz)::date = _occurrence_date
  limit 1;
  _target := coalesce(_target, _event_id);

  if _status is null then
    delete from public.rsvps r
    where r.user_id = _me
      and ((_target <> _event_id and r.event_id = _target)
        or (r.event_id = _event_id and (r.occurrence_date = _occurrence_date or r.occurrence_date is null)));
    return null;
  end if;

  if _target <> _event_id then
    delete from public.rsvps r
    where r.user_id = _me and r.event_id = _event_id and r.occurrence_date = _occurrence_date;
  end if;

  insert into public.rsvps (event_id, user_id, status, occurrence_date)
  values (_target, _me, _status, _occurrence_date)
  on conflict (event_id, user_id) do update
    set status = excluded.status, occurrence_date = excluded.occurrence_date;
  return _status;
end;
$$;

revoke execute on function public.rsvp_set(uuid, date, text) from public, anon;
grant execute on function public.rsvp_set(uuid, date, text) to authenticated;

comment on function public.rsvp_set(uuid, date, text) is
  'Sets the signed-in person''s reply to one date of an event, or clears it when _status is null or left out. SECURITY INVOKER: tenant anchor is auth.uid() under the rsvps policies and their restrictive org isolation; an event the caller cannot see raises 42501.';
