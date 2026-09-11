-- Parent-side unique keys for the
-- composite foreign keys. A child row referencing its parent by bare
-- UUID has nothing forcing both into the same tenant; the composite FKs in
-- the next migration make that structural, and they need a (id, org_id)
-- unique on every referenced parent to point at.
--
-- Trivial at current volume; if this pattern ever recurs at scale, use
-- NOT VALID + VALIDATE CONSTRAINT.

alter table public.profiles        add constraint profiles_id_org_unique        unique (id, org_id);
alter table public.family_units    add constraint family_units_id_org_unique    unique (id, org_id);
alter table public.family_members  add constraint family_members_id_org_unique  unique (id, org_id);
alter table public.events          add constraint events_id_org_unique          unique (id, org_id);
alter table public.event_calendars add constraint event_calendars_id_org_unique unique (id, org_id);
alter table public.lecture_series  add constraint lecture_series_id_org_unique  unique (id, org_id);
alter table public.member_groups   add constraint member_groups_id_org_unique   unique (id, org_id);
alter table public.giving_funds    add constraint giving_funds_id_org_unique    unique (id, org_id);
alter table public.serving_signups add constraint serving_signups_id_org_unique unique (id, org_id);
alter table public.prayer_requests add constraint prayer_requests_id_org_unique unique (id, org_id);

-- access_requests.invite_token references family_invites by token, not id,
-- so the composite parent key here is (token, org_id).
alter table public.family_invites  add constraint family_invites_token_org_unique unique (token, org_id);
