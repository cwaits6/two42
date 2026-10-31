-- Location gets its own group default, apart from notes, so a group can
-- share where it meets without sharing what an event's notes say.
alter table public.group_settings
  add column calendar_event_location boolean not null default true;

comment on column public.group_settings.calendar_event_notes is
  'Calendar subscriptions include each event''s description; false links to the event page instead.';
comment on column public.group_settings.calendar_event_location is
  'Calendar subscriptions include each event''s location; false links to the event page instead.';

-- Per-event overrides of the group defaults above. NULL follows the group.
-- A series keeps them on its anchor row; its moved dates follow the series,
-- as they do for the meeting fields.
alter table public.events
  add column calendar_meeting_details boolean,
  add column calendar_event_notes boolean,
  add column calendar_event_location boolean;

comment on column public.events.calendar_meeting_details is
  'Overrides group_settings.calendar_meeting_details for this event or series; null follows the group.';
comment on column public.events.calendar_event_notes is
  'Overrides group_settings.calendar_event_notes for this event or series; null follows the group.';
comment on column public.events.calendar_event_location is
  'Overrides group_settings.calendar_event_location for this event or series; null follows the group.';
