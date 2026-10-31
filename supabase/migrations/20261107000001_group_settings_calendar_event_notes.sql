-- Whether calendar subscriptions carry each event's description and
-- location. Off, they carry the title and time with a link to the event
-- page. An absent group_settings row means on.
alter table public.group_settings
  add column calendar_event_notes boolean not null default true;

comment on column public.group_settings.calendar_event_notes is
  'Calendar subscriptions include each event''s description and location; false links to the event page instead.';
