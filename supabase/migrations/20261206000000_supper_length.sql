-- How long each supper lasts, set by its host or a leader. Each person's
-- calendar link ends the supper at its start plus this length.
alter table public.suppers
  add column length_minutes smallint not null default 180
    constraint suppers_length_minutes_allowed check (length_minutes in (90, 120, 150, 180, 210, 240));

comment on column public.suppers.length_minutes is
  'How long the supper lasts, in minutes: 1½ to 4 hours in half hours. Changing it alone keeps replies and sends no email; it stays when the supper or its rotation date moves.';

grant update (length_minutes) on public.suppers to authenticated;
