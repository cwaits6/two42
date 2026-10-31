-- Whether calendar subscriptions carry an online meeting's link, ID and
-- passcode. Off, they carry a link to the event page instead, so the join
-- details stay behind sign-in. An absent group_settings row means on.
alter table public.group_settings
  add column calendar_meeting_details boolean not null default true;

comment on column public.group_settings.calendar_meeting_details is
  'Calendar subscriptions include each online meeting''s link, ID and passcode; false links to the event page instead.';
