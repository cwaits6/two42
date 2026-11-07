-- A person holds one reply per date. Every reply is moved onto the key the
-- app and the reminder record share, the series and the date's calendar day
-- in the church's zone, and the unique key and the reminder claim take that
-- date. Breaks a build that saves without a date, so it lands only once
-- every deployed build saves through rsvp_set().

drop trigger rsvps_fill_occurrence_date on public.rsvps;
drop function public.rsvps_fill_occurrence_date();

alter table public.rsvps drop constraint rsvps_event_id_user_id_key;

-- ── Every reply gets its date ───────────────────────────────────────────────
-- A reply saved before replies named a date answers the date a save made now
-- would: a series' next date that has not ended, else its last date; a
-- one-time event's own day; an edited date's series day.
update public.rsvps r
   set occurrence_date = public.event_reply_day(r.event_id, pg_catalog.now())
 where r.occurrence_date is null;

-- ── Replies on a date edited on its own move onto its series ────────────────
-- Where one person holds several replies that land on the same series day,
-- the edited date's own reply wins over the series', and between two rows
-- edited on the same day the one rsvp_set() wrote to: not cancelled, then
-- the earliest made.
create temporary table rsvps_moved as
with placed as (
  select r.id,
         r.user_id,
         coalesce(e.series_id, r.event_id) as event_id,
         case when e.series_id is null then r.occurrence_date
              else (e.series_occurrence_date at time zone o.timezone)::date
         end as occurrence_date,
         e.series_id is null as on_series,
         e.is_cancelled,
         e.created_at,
         e.id as from_event
  from public.rsvps r
  join public.events e on e.id = r.event_id and e.org_id = r.org_id
  join public.organizations o on o.id = e.org_id
)
select id, event_id, occurrence_date,
       row_number() over (
         partition by event_id, user_id, occurrence_date
         order by on_series, is_cancelled, created_at, from_event
       ) as rank
from placed;

delete from public.rsvps r
using rsvps_moved m
where m.id = r.id and m.rank > 1;

update public.rsvps r
   set event_id = m.event_id, occurrence_date = m.occurrence_date
  from rsvps_moved m
 where m.id = r.id
   and (r.event_id, r.occurrence_date) is distinct from (m.event_id, m.occurrence_date);

drop table rsvps_moved;

-- ── The key ─────────────────────────────────────────────────────────────────
alter table public.rsvps alter column occurrence_date set not null;
alter table public.rsvps
  add constraint rsvps_event_id_user_id_occurrence_date_key unique (event_id, user_id, occurrence_date);

comment on column public.rsvps.occurrence_date is
  'The calendar day, in the church''s zone, of the date this reply answers; for a date edited on its own, the day it stood on in the series, on the series'' event_id. Keyed like event_reminder_passes.';

drop function public.event_reply_day(uuid, timestamptz);

-- ── Saving a reply ──────────────────────────────────────────────────────────
-- Sets or clears the signed-in person's reply to one date of an event: no
-- _status clears it. _event_id is the series for any of its dates, including
-- one edited on its own, so a date's replies sit on one row per person
-- wherever the date was moved.
--
-- SECURITY INVOKER: the rsvps policies decide every write, user_id is always
-- auth.uid(), and org_id comes from its default. An event the caller cannot
-- see raises 42501, the same as the insert policy's refusal.
create or replace function public.rsvp_set(_event_id uuid, _occurrence_date date, _status text default null)
  returns text
  language plpgsql volatile security invoker set search_path = ''
as $$
declare
  _me uuid := auth.uid();
  _series uuid;
begin
  if _me is null then
    raise exception 'a reply needs a signed-in person' using errcode = '42501';
  end if;
  if _occurrence_date is null then
    raise exception 'a reply needs a date' using errcode = '22023';
  end if;

  select e.series_id into _series from public.events e where e.id = _event_id;
  if not found then
    raise exception 'event % not found', _event_id using errcode = '42501';
  end if;
  if _series is not null then
    raise exception 'a reply names the series, not a date edited on its own' using errcode = '22023';
  end if;

  if _status is null then
    delete from public.rsvps r
    where r.user_id = _me and r.event_id = _event_id and r.occurrence_date = _occurrence_date;
    return null;
  end if;

  insert into public.rsvps (event_id, user_id, status, occurrence_date)
  values (_event_id, _me, _status, _occurrence_date)
  on conflict (event_id, user_id, occurrence_date) do update set status = excluded.status;
  return _status;
end;
$$;

revoke execute on function public.rsvp_set(uuid, date, text) from public, anon;
grant execute on function public.rsvp_set(uuid, date, text) to authenticated;

-- ── Who a date's reminder goes to ───────────────────────────────────────────
-- Called once per due date by the job on the service key, so it is SECURITY
-- INVOKER: service_role bypasses row security, and the org checks here are
-- what keep the call inside one church. The org comes from the event's own
-- row and is only compared with _org_id, so a wrong org claims nothing and
-- raises.
--
-- A date's reminder goes to the people whose reply for that date is Yes or
-- Maybe, still in the event's group, not pending, with an email and their
-- own setting on. A date edited on its own keeps its replies on the series
-- row and its series day, so _reply_event_id only has to be one of the
-- series' dates.
--
-- A claim older than the stale interval belongs to a firing that never
-- settled it, and is claimed again: the send carries an idempotency key, so
-- Resend will not send it twice.
create or replace function public.event_reminder_claim(
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
    join public.rsvps r
      on r.org_id = _org_id
     and r.event_id = _event_id
     and r.occurrence_date = _occurrence_date
     and r.user_id = p.id
     and r.status in ('yes', 'maybe')
    where p.org_id = _org_id
      and p.email is not null
      and p.role <> 'pending'
      and p.email_event_reminders
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
  'Starts the reminder pass for one date of an event when it has none, fixing its recipients (Yes or Maybe for that date), then claims every unsent reminder in the pass and returns the people to mail. Tenant anchor: the event''s own org_id, compared with _org_id; a mismatch raises ER001. service_role only.';
