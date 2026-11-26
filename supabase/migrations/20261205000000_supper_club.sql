-- Supper club: the dinner club's objects, dropped and created again under
-- the Supper club names (supper, rotation). Renaming in place would leave
-- the plpgsql bodies naming the old tables, since they hold them as text.
-- Dropping is safe only because the dinner club never held a row.
--
-- A group's suppers in members' homes, run as rotations. A leader adds a
-- rotation, members sign up as parties of one or two, the leader shuffles
-- the parties into tables and publishes them, and each table's suppers are
-- dated rows of their own, never events, so nothing reaches the group
-- calendar or its subscription.
--
-- Two things in here are private, and the database holds both lines:
--   * a host's address (supper_party_addresses): the party, the group's
--     leaders, and the parties seated at a table one of that party's
--     suppers is at. Tables exist only once published, so before publish no
--     guest reads any address.
--   * allergies and food needs (supper_party_notes): the party, the leaders,
--     and the host of a supper the party is seated at.
-- A church admin outside the group is on neither list.
--
-- Error contract (SQLSTATEs the routes map to HTTP statuses):
--   SC001  not found, or the caller may not do this          → 404/403
--   SC002  invalid input or draft                             → 400
--   SC003  the rotation is not in a state that allows this    → 409
--   SC004  a date outside the rotation, or in the past        → 400
--   SC005  a supper that has happened keeps its date or table → 409
--   SC010  reminder claim for a supper of another org         → service only

-- ── Drop the dinner club ────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-dinner-reminders-daily') then
    perform cron.unschedule('send-dinner-reminders-daily');
  end if;
end;
$$;

drop trigger profiles_own_dinner_club_email on public.profiles;
drop function public.profiles_own_dinner_club_email();

-- One statement, so the foreign keys between them resolve; no cascade, so a
-- dependent outside the dinner club stops the migration instead of vanishing.
drop table
  public.dinner_reminder_sends,
  public.dinner_reminder_passes,
  public.dinner_feed_tokens,
  public.dinner_contributions,
  public.dinner_replies,
  public.dinners,
  public.dinner_seats,
  public.dinner_tables,
  public.dinner_drafts,
  public.dinner_party_unavailable_dates,
  public.dinner_party_notes,
  public.dinner_party_addresses,
  public.dinner_party_members,
  public.dinner_parties,
  public.dinner_season_dates,
  public.dinner_seasons;

drop function public.dinner_my_party_ids();
drop function public.dinner_my_party_profile_ids();
drop function public.dinner_my_table_ids();
drop function public.dinner_tablemate_party_ids();
drop function public.dinner_address_party_ids();
drop function public.dinner_food_note_party_ids();
drop function public.dinner_signup_window_open(uuid);
drop function public.dinner_seasons_guard();
drop function public.dinner_season_dates_guard();
drop function public.dinner_season_dates_carry();
drop function public.dinner_parties_guard();
drop function public.dinner_party_withdrawn();
drop function public.dinner_party_members_guard();
drop function public.dinner_party_drop_if_empty();
drop function public.dinner_party_detail_guard();
drop function public.dinners_guard();
drop function public.dinner_moved_clear_replies();
drop function public.dinner_replies_guard();
drop function public.dinner_party_create(uuid, uuid[]);
drop function public.dinner_season_dates_replace(uuid, timestamptz[]);
drop function public.dinner_party_unavailable_dates_replace(uuid, uuid[]);
drop function public.dinner_seat_signatures(uuid, uuid);
drop function public.dinner_tables_publish(uuid);
drop function public.dinner_reminder_claim(uuid, uuid, date, timestamptz, uuid);
drop function public.dinner_reminder_passes_prune(uuid, date, integer);

-- ── Switches ────────────────────────────────────────────────────────────────
alter table public.group_settings
  add column supper_club_enabled boolean not null default false;

-- A group that turned the dinner club on keeps the Supper club on.
update public.group_settings set supper_club_enabled = true where dinner_club_enabled;
alter table public.group_settings drop column dinner_club_enabled;

comment on column public.group_settings.supper_club_enabled is
  'Shows the Supper club page in the group. Off hides it and sends no supper emails; every rotation and its rows stay.';
comment on table public.group_settings is
  'Per-group settings: the serving email link mode, what a calendar event shows, event reminders and the Supper club. One row per group, created on first save; an absent row means the defaults.';

alter table public.profiles
  add column email_supper_club boolean not null default true;

comment on column public.profiles.email_supper_club is
  'False stops every Supper club email to this person: tables, moved suppers and reminders. Only the person can change it.';

-- ADD COLUMN adds nothing to the column-level select grant on profiles.
grant select (email_supper_club) on public.profiles to anon, authenticated;

-- A person who turned the dinner club emails off keeps them off.
update public.profiles set email_supper_club = false where not email_dinner_club;
alter table public.profiles drop column email_dinner_club;

-- The profile update policy lets a church admin and a household manager
-- write another person's row, so the column needs its own rule.
create function public.profiles_own_supper_club_email() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if auth.uid() is not null and auth.uid() is distinct from old.id then
    raise exception 'only the person can change their own Supper club email setting'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_own_supper_club_email
  before update of email_supper_club on public.profiles
  for each row
  when (old.email_supper_club is distinct from new.email_supper_club)
  execute function public.profiles_own_supper_club_email();
-- ── Tables ──────────────────────────────────────────────────────────────────
-- Every child row carries rotation_id and group_id, and its (rotation_id,
-- group_id, org_id) key points at the rotation, so the group a leader policy
-- reads is always the rotation's own.
create table public.supper_rotations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  group_id uuid not null,
  title text not null
    constraint supper_rotations_title_check check (char_length(btrim(title)) between 1 and 80),
  format text not null
    constraint supper_rotations_format_check check (format in ('same_table_one_host', 'same_table_rotating', 'new_tables')),
  status text not null default 'draft'
    constraint supper_rotations_status_check check (status in ('draft', 'open', 'published', 'ended')),
  starts_on date not null,
  ends_on date not null,
  length_months smallint
    constraint supper_rotations_length_months_check check (length_months between 1 and 24),
  repeat_kind text not null
    constraint supper_rotations_repeat_kind_check check (repeat_kind in ('weeks', 'monthly_weekday')),
  repeat_weeks smallint
    constraint supper_rotations_repeat_weeks_check check (repeat_weeks between 1 and 12),
  repeat_week_of_month smallint
    constraint supper_rotations_repeat_week_of_month_check check (repeat_week_of_month between 1 and 5),
  weekday smallint not null
    constraint supper_rotations_weekday_check check (weekday between 0 and 6),
  default_start_time time not null default '18:00',
  table_size_min smallint not null default 6,
  table_size_max smallint not null default 8,
  signup_closes_on date not null,
  allow_back_to_back_hosting boolean not null default false,
  bring_list_enabled boolean not null default true,
  previous_rotation_id uuid,
  published_at timestamptz,
  ended_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supper_rotations_ends_after_start check (ends_on >= starts_on),
  constraint supper_rotations_table_size_check
    check (table_size_min >= 2 and table_size_min <= table_size_max and table_size_max <= 20),
  constraint supper_rotations_repeat_shape_check check (
    (repeat_kind = 'weeks' and repeat_weeks is not null and repeat_week_of_month is null)
    or (repeat_kind = 'monthly_weekday' and repeat_week_of_month is not null and repeat_weeks is null)
  ),
  constraint supper_rotations_id_group_org_unique unique (id, group_id, org_id),
  constraint supper_rotations_group_id_fkey
    foreign key (group_id, org_id) references public.groups (id, org_id) on delete cascade,
  constraint supper_rotations_created_by_fkey
    foreign key (created_by, org_id) references public.profiles (id, org_id) on delete set null (created_by),
  constraint supper_rotations_previous_rotation_id_fkey
    foreign key (previous_rotation_id, group_id, org_id)
    references public.supper_rotations (id, group_id, org_id) on delete set null (previous_rotation_id)
);

comment on table public.supper_rotations is
  'One run of a group''s Supper club. Status runs draft, open (sign-ups), published (tables), ended; only supper_tables_publish() sets published. Members read every rotation but a draft; only the group''s leaders write.';
comment on column public.supper_rotations.length_months is
  'Set when the leader gave the length in months; ends_on is always stored.';
comment on column public.supper_rotations.repeat_week_of_month is
  'For a monthly rotation: which weekday of the month, 1 to 4, or 5 for the last.';
comment on column public.supper_rotations.weekday is
  '0 is Sunday.';
comment on column public.supper_rotations.bring_list_enabled is
  'Whether a supper''s host gives each guest party something to bring (supper_contributions).';
comment on column public.supper_rotations.previous_rotation_id is
  'The rotation this one was started from, whose parties are invited again and whose tables the shuffle keeps apart.';

-- At most one rotation per group taking sign-ups or running.
create unique index supper_rotations_one_running
  on public.supper_rotations (group_id) where status in ('open', 'published');
create index supper_rotations_group_idx on public.supper_rotations (group_id, org_id);
create index supper_rotations_created_by_idx on public.supper_rotations (created_by);
create index supper_rotations_previous_idx on public.supper_rotations (previous_rotation_id);

create table public.supper_rotation_dates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  rotation_id uuid not null,
  group_id uuid not null,
  starts_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint supper_rotation_dates_id_rotation_org_unique unique (id, rotation_id, org_id),
  constraint supper_rotation_dates_rotation_fkey
    foreign key (rotation_id, group_id, org_id) references public.supper_rotations (id, group_id, org_id) on delete cascade
);

comment on table public.supper_rotation_dates is
  'The rotation''s supper dates. Each table''s supper takes its date''s time when published and can move on its own afterwards.';

create index supper_rotation_dates_rotation_idx on public.supper_rotation_dates (rotation_id, group_id, org_id, starts_at);

create table public.supper_parties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  rotation_id uuid not null,
  group_id uuid not null,
  status text not null default 'signed_up'
    constraint supper_parties_status_check check (status in ('signed_up', 'waitlisted', 'withdrawn')),
  can_host boolean not null default false,
  seats smallint
    constraint supper_parties_seats_check check (seats between 2 and 20),
  preferred_rotation_date_id uuid,
  kids_welcome boolean,
  access_notes text
    constraint supper_parties_access_notes_check check (char_length(access_notes) <= 500),
  pets text
    constraint supper_parties_pets_check check (char_length(pets) <= 200),
  withdrawn_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supper_parties_host_seats_check check (not can_host or seats is not null),
  constraint supper_parties_id_rotation_org_unique unique (id, rotation_id, org_id),
  constraint supper_parties_rotation_fkey
    foreign key (rotation_id, group_id, org_id) references public.supper_rotations (id, group_id, org_id) on delete cascade,
  constraint supper_parties_preferred_date_fkey
    foreign key (preferred_rotation_date_id, rotation_id, org_id)
    references public.supper_rotation_dates (id, rotation_id, org_id) on delete set null (preferred_rotation_date_id),
  constraint supper_parties_created_by_fkey
    foreign key (created_by, org_id) references public.profiles (id, org_id) on delete set null (created_by)
);

comment on table public.supper_parties is
  'One or two members who sign up together and are always seated together. A sign-up made after the tables are published is waitlisted; a withdrawn party keeps its past seats.';
comment on column public.supper_parties.seats is
  'How many people fit at the host''s table, their own party included.';

create index supper_parties_rotation_idx on public.supper_parties (rotation_id, group_id, org_id);
create index supper_parties_preferred_date_idx on public.supper_parties (preferred_rotation_date_id);
create index supper_parties_created_by_idx on public.supper_parties (created_by);

create table public.supper_party_members (
  party_id uuid not null,
  profile_id uuid not null,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  rotation_id uuid not null,
  group_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (party_id, profile_id),
  constraint supper_party_members_one_party_per_rotation unique (rotation_id, profile_id),
  constraint supper_party_members_party_fkey
    foreign key (party_id, rotation_id, org_id) references public.supper_parties (id, rotation_id, org_id) on delete cascade,
  constraint supper_party_members_rotation_fkey
    foreign key (rotation_id, group_id, org_id) references public.supper_rotations (id, group_id, org_id) on delete cascade,
  constraint supper_party_members_group_member_fkey
    foreign key (group_id, profile_id, org_id) references public.group_members (group_id, profile_id, org_id) on delete cascade
);

comment on table public.supper_party_members is
  'The people in a party: one or two members of the group, each in one party per rotation. Leaving the group removes the person; a party left with nobody is deleted.';

create index supper_party_members_profile_idx on public.supper_party_members (profile_id);
create index supper_party_members_group_member_idx on public.supper_party_members (group_id, profile_id, org_id);
create index supper_party_members_rotation_group_idx on public.supper_party_members (rotation_id, group_id, org_id);

create table public.supper_party_addresses (
  party_id uuid primary key,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  rotation_id uuid not null,
  group_id uuid not null,
  address_line1 text not null
    constraint supper_party_addresses_line1_check check (char_length(btrim(address_line1)) between 1 and 200),
  address_line2 text
    constraint supper_party_addresses_line2_check check (char_length(address_line2) <= 200),
  city text
    constraint supper_party_addresses_city_check check (char_length(city) <= 100),
  state text
    constraint supper_party_addresses_state_check check (char_length(state) <= 100),
  postal_code text
    constraint supper_party_addresses_postal_code_check check (char_length(postal_code) <= 20),
  updated_at timestamptz not null default now(),
  constraint supper_party_addresses_party_fkey
    foreign key (party_id, rotation_id, org_id) references public.supper_parties (id, rotation_id, org_id) on delete cascade,
  constraint supper_party_addresses_rotation_fkey
    foreign key (rotation_id, group_id, org_id) references public.supper_rotations (id, group_id, org_id) on delete cascade
);

comment on table public.supper_party_addresses is
  'Where a hosting party''s suppers are. Private: readable by the party, the group''s leaders and the parties seated at a table one of its suppers is at, never before publish.';

create index supper_party_addresses_party_rotation_idx on public.supper_party_addresses (party_id, rotation_id, org_id);
create index supper_party_addresses_rotation_idx on public.supper_party_addresses (rotation_id, group_id, org_id);

create table public.supper_party_notes (
  party_id uuid primary key,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  rotation_id uuid not null,
  group_id uuid not null,
  food_notes text not null
    constraint supper_party_notes_food_notes_check check (char_length(btrim(food_notes)) between 1 and 500),
  updated_at timestamptz not null default now(),
  constraint supper_party_notes_party_fkey
    foreign key (party_id, rotation_id, org_id) references public.supper_parties (id, rotation_id, org_id) on delete cascade,
  constraint supper_party_notes_rotation_fkey
    foreign key (rotation_id, group_id, org_id) references public.supper_rotations (id, group_id, org_id) on delete cascade
);

comment on table public.supper_party_notes is
  'A party''s allergies and food needs. Private: readable by the party, the group''s leaders and the host of a supper the party is seated at.';

create index supper_party_notes_party_rotation_idx on public.supper_party_notes (party_id, rotation_id, org_id);
create index supper_party_notes_rotation_idx on public.supper_party_notes (rotation_id, group_id, org_id);

create table public.supper_party_unavailable_dates (
  party_id uuid not null,
  rotation_date_id uuid not null,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  rotation_id uuid not null,
  group_id uuid not null,
  primary key (party_id, rotation_date_id),
  constraint supper_party_unavailable_dates_party_fkey
    foreign key (party_id, rotation_id, org_id) references public.supper_parties (id, rotation_id, org_id) on delete cascade,
  constraint supper_party_unavailable_dates_date_fkey
    foreign key (rotation_date_id, rotation_id, org_id) references public.supper_rotation_dates (id, rotation_id, org_id) on delete cascade,
  constraint supper_party_unavailable_dates_rotation_fkey
    foreign key (rotation_id, group_id, org_id) references public.supper_rotations (id, group_id, org_id) on delete cascade
);

comment on table public.supper_party_unavailable_dates is
  'Dates a hosting party can''t host, for a rotation whose tables change each supper.';

create index supper_party_unavailable_dates_party_idx on public.supper_party_unavailable_dates (party_id, rotation_id, org_id);
create index supper_party_unavailable_dates_date_idx on public.supper_party_unavailable_dates (rotation_date_id, rotation_id, org_id);
create index supper_party_unavailable_dates_rotation_idx on public.supper_party_unavailable_dates (rotation_id, group_id, org_id);

create table public.supper_drafts (
  rotation_id uuid primary key,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  group_id uuid not null,
  body jsonb not null,
  updated_at timestamptz not null default now(),
  constraint supper_drafts_rotation_fkey
    foreign key (rotation_id, group_id, org_id) references public.supper_rotations (id, group_id, org_id) on delete cascade
);

comment on table public.supper_drafts is
  'The leaders'' unpublished tables for a rotation, in the shape lib/supperClub/shuffle.ts builds. supper_tables_publish() reads this row, never a payload from the caller, and deletes it.';

create index supper_drafts_rotation_group_idx on public.supper_drafts (rotation_id, group_id, org_id);

create table public.supper_tables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  rotation_id uuid not null,
  group_id uuid not null,
  rotation_date_id uuid,
  position smallint not null,
  created_at timestamptz not null default now(),
  constraint supper_tables_id_rotation_org_unique unique (id, rotation_id, org_id),
  constraint supper_tables_rotation_fkey
    foreign key (rotation_id, group_id, org_id) references public.supper_rotations (id, group_id, org_id) on delete cascade,
  constraint supper_tables_date_fkey
    foreign key (rotation_date_id, rotation_id, org_id) references public.supper_rotation_dates (id, rotation_id, org_id) on delete cascade
);

comment on table public.supper_tables is
  'A published table. rotation_date_id is set when the rotation''s tables change each supper, and null when a table keeps its parties for the whole rotation. Written only by supper_tables_publish().';

create index supper_tables_rotation_idx on public.supper_tables (rotation_id, group_id, org_id);
create index supper_tables_date_idx on public.supper_tables (rotation_date_id, rotation_id, org_id);

create table public.supper_seats (
  table_id uuid not null,
  party_id uuid not null,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  rotation_id uuid not null,
  group_id uuid not null,
  seated_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (table_id, party_id),
  constraint supper_seats_table_party_org_unique unique (table_id, party_id, org_id),
  constraint supper_seats_table_fkey
    foreign key (table_id, rotation_id, org_id) references public.supper_tables (id, rotation_id, org_id) on delete cascade,
  constraint supper_seats_party_fkey
    foreign key (party_id, rotation_id, org_id) references public.supper_parties (id, rotation_id, org_id) on delete cascade,
  constraint supper_seats_rotation_fkey
    foreign key (rotation_id, group_id, org_id) references public.supper_rotations (id, group_id, org_id) on delete cascade
);

comment on table public.supper_seats is
  'A party seated at a table. left_at is set when the party withdraws: it frees the party''s place at later suppers and keeps the record of who shared a table.';

create index supper_seats_party_idx on public.supper_seats (party_id, rotation_id, org_id);
create index supper_seats_table_rotation_idx on public.supper_seats (table_id, rotation_id, org_id);
create index supper_seats_rotation_idx on public.supper_seats (rotation_id, group_id, org_id);

create table public.suppers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  rotation_id uuid not null,
  group_id uuid not null,
  table_id uuid not null,
  rotation_date_id uuid not null,
  starts_at timestamptz not null,
  host_party_id uuid,
  host_unavailable boolean not null default false,
  follows_rotation_date boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppers_table_date_unique unique (table_id, rotation_date_id),
  constraint suppers_id_org_unique unique (id, org_id),
  constraint suppers_id_table_org_unique unique (id, table_id, org_id),
  constraint suppers_id_table_rotation_org_unique unique (id, table_id, rotation_id, group_id, org_id),
  constraint suppers_table_fkey
    foreign key (table_id, rotation_id, org_id) references public.supper_tables (id, rotation_id, org_id) on delete cascade,
  constraint suppers_date_fkey
    foreign key (rotation_date_id, rotation_id, org_id) references public.supper_rotation_dates (id, rotation_id, org_id) on delete cascade,
  constraint suppers_rotation_fkey
    foreign key (rotation_id, group_id, org_id) references public.supper_rotations (id, group_id, org_id) on delete cascade,
  -- The host is always a party seated at the table.
  constraint suppers_host_seat_fkey
    foreign key (table_id, host_party_id, org_id)
    references public.supper_seats (table_id, party_id, org_id) on delete set null (host_party_id)
);

comment on table public.suppers is
  'One table''s one date. Not an events row, so it never reaches the group calendar. The host of the supper or a leader can move it within the rotation; moving it clears its replies.';
comment on column public.suppers.host_party_id is
  'Who hosts this one supper. Set per supper, so another party at the table can host one date.';
comment on column public.suppers.host_unavailable is
  'The host said they can''t host this supper.';
comment on column public.suppers.follows_rotation_date is
  'False once the supper is moved on its own; moving its rotation date then leaves it where it is.';

create index suppers_rotation_starts_idx on public.suppers (rotation_id, starts_at);
create index suppers_rotation_group_idx on public.suppers (rotation_id, group_id, org_id);
create index suppers_table_rotation_idx on public.suppers (table_id, rotation_id, org_id);
create index suppers_date_idx on public.suppers (rotation_date_id, rotation_id, org_id);
create index suppers_host_idx on public.suppers (table_id, host_party_id, org_id);
create index suppers_org_starts_idx on public.suppers (org_id, starts_at);

create table public.supper_replies (
  supper_id uuid not null,
  profile_id uuid not null,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  status text not null
    constraint supper_replies_status_check check (status in ('going', 'not_going')),
  replied_by uuid,
  updated_at timestamptz not null default now(),
  primary key (supper_id, profile_id),
  constraint supper_replies_supper_fkey
    foreign key (supper_id, org_id) references public.suppers (id, org_id) on delete cascade,
  constraint supper_replies_profile_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade,
  constraint supper_replies_replied_by_fkey
    foreign key (replied_by, org_id) references public.profiles (id, org_id) on delete set null (replied_by)
);

comment on table public.supper_replies is
  'Each person''s Going or Not going for one supper, given by them or their partner, until the supper starts.';

create index supper_replies_supper_org_idx on public.supper_replies (supper_id, org_id);
create index supper_replies_profile_idx on public.supper_replies (profile_id, org_id);
create index supper_replies_replied_by_idx on public.supper_replies (replied_by, org_id);

create table public.supper_contributions (
  supper_id uuid not null,
  party_id uuid not null,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  rotation_id uuid not null,
  group_id uuid not null,
  table_id uuid not null,
  item text not null
    constraint supper_contributions_item_check check (char_length(btrim(item)) between 1 and 60),
  updated_at timestamptz not null default now(),
  primary key (supper_id, party_id),
  -- Ties rotation_id and group_id to the supper's own, which the leader policy trusts.
  constraint supper_contributions_supper_fkey
    foreign key (supper_id, table_id, rotation_id, group_id, org_id)
    references public.suppers (id, table_id, rotation_id, group_id, org_id) on delete cascade,
  constraint supper_contributions_seat_fkey
    foreign key (table_id, party_id, org_id) references public.supper_seats (table_id, party_id, org_id) on delete cascade,
  constraint supper_contributions_rotation_fkey
    foreign key (rotation_id, group_id, org_id) references public.supper_rotations (id, group_id, org_id) on delete cascade
);

comment on table public.supper_contributions is
  'What a guest party brings to one supper, set by its host or a leader. The party is always seated at the supper''s table.';

create index supper_contributions_supper_idx on public.supper_contributions (supper_id, table_id, rotation_id, group_id, org_id);
create index supper_contributions_seat_idx on public.supper_contributions (table_id, party_id, org_id);
create index supper_contributions_rotation_idx on public.supper_contributions (rotation_id, group_id, org_id);

create table public.supper_feed_tokens (
  profile_id uuid primary key,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint supper_feed_tokens_profile_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade
);

comment on table public.supper_feed_tokens is
  'A person''s private Supper club calendar link: the SHA-256 of its token. Minting again replaces the hash, which ends the old link.';

create index supper_feed_tokens_profile_org_idx on public.supper_feed_tokens (profile_id, org_id);
create index supper_feed_tokens_org_idx on public.supper_feed_tokens (org_id);

-- The reminder's sent record, as for event reminders: a pass is one supper
-- on one local date, and its sends are fixed when the pass starts. A moved
-- supper lands on a new date and so gets a new pass.
create table public.supper_reminder_passes (
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  supper_id uuid not null,
  supper_date date not null,
  started_at timestamptz not null default now(),
  primary key (supper_id, supper_date),
  unique (supper_id, supper_date, org_id),
  constraint supper_reminder_passes_supper_fkey
    foreign key (supper_id, org_id) references public.suppers (id, org_id) on delete cascade
);

create table public.supper_reminder_sends (
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  supper_id uuid not null,
  supper_date date not null,
  profile_id uuid not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  primary key (supper_id, supper_date, profile_id),
  constraint supper_reminder_sends_pass_fkey
    foreign key (supper_id, supper_date, org_id)
    references public.supper_reminder_passes (supper_id, supper_date, org_id) on delete cascade,
  constraint supper_reminder_sends_profile_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade
);

comment on table public.supper_reminder_passes is
  'One supper reminder pass per supper and local date. Its existence means that reminder is handled. Read and written by the service key only.';
comment on table public.supper_reminder_sends is
  'One person''s supper reminder in a pass: claimed_at while a send is in flight, sent_at once Resend accepted it. Read and written by the service key only.';

create index supper_reminder_passes_supper_org_idx on public.supper_reminder_passes (supper_id, org_id);
create index supper_reminder_passes_org_date_idx on public.supper_reminder_passes (org_id, supper_date);
create index supper_reminder_sends_profile_idx on public.supper_reminder_sends (profile_id, org_id);

-- ── Row security ────────────────────────────────────────────────────────────
alter table public.supper_rotations enable row level security;
alter table public.supper_rotation_dates enable row level security;
alter table public.supper_parties enable row level security;
alter table public.supper_party_members enable row level security;
alter table public.supper_party_addresses enable row level security;
alter table public.supper_party_notes enable row level security;
alter table public.supper_party_unavailable_dates enable row level security;
alter table public.supper_drafts enable row level security;
alter table public.supper_tables enable row level security;
alter table public.supper_seats enable row level security;
alter table public.suppers enable row level security;
alter table public.supper_replies enable row level security;
alter table public.supper_contributions enable row level security;
alter table public.supper_feed_tokens enable row level security;
alter table public.supper_reminder_passes enable row level security;
alter table public.supper_reminder_sends enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'supper_rotations', 'supper_rotation_dates', 'supper_parties', 'supper_party_members',
    'supper_party_addresses', 'supper_party_notes', 'supper_party_unavailable_dates',
    'supper_drafts', 'supper_tables', 'supper_seats', 'suppers', 'supper_replies',
    'supper_contributions', 'supper_feed_tokens', 'supper_reminder_passes', 'supper_reminder_sends'
  ] loop
    execute format($p$
      create policy "org isolation" on public.%I
        as restrictive for all to anon, authenticated
        using      (org_id = (select public.app_request_org_id()))
        with check (org_id = (select public.app_request_org_id()))
    $p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- The caller's seats, resolved without row security so the policies below
-- never read each other. Each takes no argument and is called as
-- (select public.helper()), so it runs once per statement.
create function public.supper_my_party_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(pm.party_id), '{}')
  from public.supper_party_members pm
  join public.profiles p on p.id = pm.profile_id and p.org_id = pm.org_id
  where pm.profile_id = auth.uid()
    and pm.org_id = public.app_current_org_id()
    and p.role <> 'pending';
$$;

create function public.supper_my_party_profile_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(distinct pm.profile_id), '{}')
  from public.supper_party_members pm
  where pm.org_id = public.app_current_org_id()
    and pm.party_id = any (public.supper_my_party_ids());
$$;

create function public.supper_my_table_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(distinct s.table_id), '{}')
  from public.supper_seats s
  where s.org_id = public.app_current_org_id()
    and s.left_at is null
    and s.party_id = any (public.supper_my_party_ids());
$$;

create function public.supper_tablemate_party_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(distinct s.party_id), '{}')
  from public.supper_seats s
  where s.org_id = public.app_current_org_id()
    and s.left_at is null
    and s.table_id = any (public.supper_my_table_ids());
$$;

create function public.supper_address_party_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(distinct d.host_party_id), '{}')
  from public.suppers d
  join public.supper_seats hs on hs.table_id = d.table_id and hs.party_id = d.host_party_id
   and hs.org_id = d.org_id and hs.left_at is null
  where d.org_id = public.app_current_org_id()
    and d.table_id = any (public.supper_my_table_ids());
$$;

create function public.supper_food_note_party_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(distinct s.party_id), '{}')
  from public.suppers d
  -- Seated in time for this supper: a party seated later never ate at it.
  join public.supper_seats s on s.table_id = d.table_id and s.org_id = d.org_id and s.left_at is null
   and s.seated_at <= d.starts_at
  join public.supper_seats hs on hs.table_id = d.table_id and hs.party_id = d.host_party_id
   and hs.org_id = d.org_id and hs.left_at is null
  where d.org_id = public.app_current_org_id()
    and d.host_party_id = any (public.supper_my_party_ids());
$$;

comment on function public.supper_my_party_ids() is
  'The parties the caller is in, in their own org; none while pending. Policy helper.';
comment on function public.supper_my_party_profile_ids() is
  'The caller and their partners: everyone in the caller''s parties. Policy helper.';
comment on function public.supper_my_table_ids() is
  'The tables the caller''s parties are seated at and have not left. Policy helper.';
comment on function public.supper_tablemate_party_ids() is
  'The parties seated at the caller''s tables. Policy helper.';
comment on function public.supper_address_party_ids() is
  'The parties hosting a supper at one of the caller''s tables and still seated there: the addresses the caller may read. Policy helper.';
comment on function public.supper_food_note_party_ids() is
  'The parties seated, in time for it, at a supper the caller''s party hosts: the food notes the caller may read. Policy helper.';

do $$
declare f text;
begin
  foreach f in array array[
    'supper_my_party_ids', 'supper_my_party_profile_ids', 'supper_my_table_ids',
    'supper_tablemate_party_ids', 'supper_address_party_ids', 'supper_food_note_party_ids'
  ] loop
    execute format('revoke execute on function public.%I() from public, anon', f);
    execute format('grant execute on function public.%I() to authenticated', f);
  end loop;
end $$;

-- Rotations: members read all but a draft; leaders write, and delete a draft.
create policy "Members read rotations" on public.supper_rotations
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id) or (status <> 'draft' and public.is_group_member(group_id))));
create policy "Leaders add rotations" on public.supper_rotations
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Leaders edit rotations" on public.supper_rotations
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Leaders delete draft rotations" on public.supper_rotations
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id) and status = 'draft');

create policy "Members read rotation dates" on public.supper_rotation_dates
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id)
      or (public.is_group_member(group_id)
        and exists (select 1 from public.supper_rotations s where s.id = rotation_id and s.status <> 'draft'))));
create policy "Leaders add rotation dates" on public.supper_rotation_dates
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Leaders edit rotation dates" on public.supper_rotation_dates
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Leaders delete rotation dates" on public.supper_rotation_dates
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- Parties: read by the party, the leaders and the parties at the same table.
create policy "Parties read by party, tablemates and leaders" on public.supper_parties
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (id = any ((select public.supper_my_party_ids())::uuid[])
      or public.is_group_leader(group_id)
      or id = any ((select public.supper_tablemate_party_ids())::uuid[])));
create policy "Party or leaders edit a party" on public.supper_parties
  for update to authenticated
  using (org_id = (select public.app_request_org_id())
    and (id = any ((select public.supper_my_party_ids())::uuid[]) or public.is_group_leader(group_id)))
  with check (org_id = (select public.app_request_org_id())
    and (id = any ((select public.supper_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));
create policy "Party or leaders delete a party" on public.supper_parties
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and (id = any ((select public.supper_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));

create policy "Party members read by party, tablemates and leaders" on public.supper_party_members
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.supper_my_party_ids())::uuid[])
      or public.is_group_leader(group_id)
      or party_id = any ((select public.supper_tablemate_party_ids())::uuid[])));
create policy "Party or leaders add a party member" on public.supper_party_members
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.supper_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));
create policy "Party or leaders remove a party member" on public.supper_party_members
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.supper_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));

-- The two private tables.
create policy "Addresses read by party, its guests and leaders" on public.supper_party_addresses
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.supper_my_party_ids())::uuid[])
      or public.is_group_leader(group_id)
      or party_id = any ((select public.supper_address_party_ids())::uuid[])));
create policy "Party or leaders write an address" on public.supper_party_addresses
  for all to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.supper_my_party_ids())::uuid[]) or public.is_group_leader(group_id)))
  with check (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.supper_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));

create policy "Food notes read by party, its hosts and leaders" on public.supper_party_notes
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.supper_my_party_ids())::uuid[])
      or public.is_group_leader(group_id)
      or party_id = any ((select public.supper_food_note_party_ids())::uuid[])));
create policy "Party or leaders write food notes" on public.supper_party_notes
  for all to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.supper_my_party_ids())::uuid[]) or public.is_group_leader(group_id)))
  with check (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.supper_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));

create policy "Unavailable dates read by party, tablemates and leaders" on public.supper_party_unavailable_dates
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.supper_my_party_ids())::uuid[])
      or public.is_group_leader(group_id)
      or party_id = any ((select public.supper_tablemate_party_ids())::uuid[])));
create policy "Party or leaders write unavailable dates" on public.supper_party_unavailable_dates
  for all to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.supper_my_party_ids())::uuid[]) or public.is_group_leader(group_id)))
  with check (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.supper_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));

create policy "Leaders keep drafts" on public.supper_drafts
  for all to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- Published tables: read by the parties at them and the leaders. Written
-- only by supper_tables_publish().
create policy "Tables read by their parties and leaders" on public.supper_tables
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id) or id = any ((select public.supper_my_table_ids())::uuid[])));
create policy "Seats read by their tables and leaders" on public.supper_seats
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id) or table_id = any ((select public.supper_my_table_ids())::uuid[])));

create policy "Suppers read by their tables and leaders" on public.suppers
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id) or table_id = any ((select public.supper_my_table_ids())::uuid[])));
create policy "Host or leaders change a supper" on public.suppers
  for update to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id) or host_party_id = any ((select public.supper_my_party_ids())::uuid[])))
  with check (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id) or host_party_id = any ((select public.supper_my_party_ids())::uuid[])));

create policy "Replies read with their supper" on public.supper_replies
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and exists (select 1 from public.suppers d where d.id = supper_id));
create policy "A person or their partner replies" on public.supper_replies
  for all to authenticated
  using (org_id = (select public.app_request_org_id())
    and profile_id = any ((select public.supper_my_party_profile_ids())::uuid[]))
  with check (org_id = (select public.app_request_org_id())
    and profile_id = any ((select public.supper_my_party_profile_ids())::uuid[]));

create policy "Contributions read with their supper" on public.supper_contributions
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and exists (select 1 from public.suppers d where d.id = supper_id));
create policy "Host or leaders set contributions" on public.supper_contributions
  for all to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id)
      or exists (select 1 from public.suppers d
        where d.id = supper_id and d.host_party_id = any ((select public.supper_my_party_ids())::uuid[]))))
  with check (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id)
      or exists (select 1 from public.suppers d
        where d.id = supper_id and d.host_party_id = any ((select public.supper_my_party_ids())::uuid[]))));

create policy "A person keeps their own feed link" on public.supper_feed_tokens
  for all to authenticated
  using (org_id = (select public.app_request_org_id()) and profile_id = (select auth.uid()))
  with check (org_id = (select public.app_request_org_id()) and profile_id = (select auth.uid()));

-- What clients may write at all. Party rows are created by
-- supper_party_create(), tables and seats only by supper_tables_publish(),
-- and suppers are moved, never added or deleted, by a client.
revoke insert, update on public.supper_parties from authenticated;
grant update (can_host, seats, preferred_rotation_date_id, kids_welcome, access_notes, pets, status)
  on public.supper_parties to authenticated;
revoke update on public.supper_party_members from authenticated;
revoke insert, update, delete on public.supper_tables from authenticated;
revoke insert, update, delete on public.supper_seats from authenticated;
revoke insert, update, delete on public.suppers from authenticated;
grant update (starts_at, host_party_id, host_unavailable) on public.suppers to authenticated;
revoke all on public.supper_reminder_passes from authenticated;
revoke all on public.supper_reminder_sends from authenticated;

-- ── Rules on writes ─────────────────────────────────────────────────────────
-- The guards below run as the caller. current_user is 'authenticated' for a
-- signed-in client and the function owner inside supper_tables_publish(),
-- supper_party_create() and a cascade, which do their own checks.

-- Whether a non-leader may still change their sign-up: the rotation takes
-- sign-ups and the church's today is on or before the close date.
create function public.supper_signup_window_open(_rotation_id uuid) returns boolean
  language sql stable
  set search_path = ''
as $$
  select exists (
    select 1
    from public.supper_rotations s
    join public.organizations o on o.id = s.org_id
    where s.id = _rotation_id
      and s.status = 'open'
      and (pg_catalog.now() at time zone o.timezone)::date <= s.signup_closes_on
  );
$$;

revoke execute on function public.supper_signup_window_open(uuid) from public, anon;
grant execute on function public.supper_signup_window_open(uuid) to authenticated;

create function public.supper_rotations_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' and new.status <> 'draft' then
      raise exception 'a rotation starts as a draft' using errcode = 'SC003';
    end if;
    return new;
  end if;

  if new.group_id is distinct from old.group_id or new.org_id is distinct from old.org_id then
    raise exception 'a rotation stays in its group' using errcode = 'SC002';
  end if;

  if new.status is distinct from old.status then
    if current_user = 'authenticated'
      and not ((old.status = 'draft' and new.status = 'open') or (old.status = 'published' and new.status = 'ended')) then
      raise exception 'a rotation cannot go from % to %', old.status, new.status using errcode = 'SC003';
    end if;
    if new.status = 'ended' then
      new.ended_at := pg_catalog.now();
    end if;
  end if;

  if old.status in ('published', 'ended') and (
    new.format is distinct from old.format
    or new.starts_on is distinct from old.starts_on
    or new.ends_on is distinct from old.ends_on
    or new.length_months is distinct from old.length_months
    or new.repeat_kind is distinct from old.repeat_kind
    or new.repeat_weeks is distinct from old.repeat_weeks
    or new.repeat_week_of_month is distinct from old.repeat_week_of_month
    or new.weekday is distinct from old.weekday
    or new.table_size_min is distinct from old.table_size_min
    or new.table_size_max is distinct from old.table_size_max
  ) then
    raise exception 'a published rotation keeps its format, dates and table size' using errcode = 'SC003';
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger supper_rotations_guard
  before insert or update on public.supper_rotations
  for each row execute function public.supper_rotations_guard();

create function public.supper_rotation_dates_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  _rotation uuid := coalesce(new.rotation_id, old.rotation_id);
  _status text;
  _starts date;
  _ends date;
  _zone text;
begin
  select s.status, s.starts_on, s.ends_on, o.timezone into _status, _starts, _ends, _zone
  from public.supper_rotations s
  join public.organizations o on o.id = s.org_id
  where s.id = _rotation;

  if _status = 'ended' then
    raise exception 'an ended rotation keeps its dates' using errcode = 'SC003';
  end if;
  if tg_op = 'DELETE' then
    -- Deleting the date deletes its suppers and their replies. A rotation being
    -- deleted is already gone here, so its dates still go with it.
    if _status is not null and exists (
      select 1 from public.suppers d
      where d.rotation_date_id = old.id and d.org_id = old.org_id and d.starts_at <= pg_catalog.now()
    ) then
      raise exception 'a date whose suppers have happened stays' using errcode = 'SC005';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.rotation_id is distinct from old.rotation_id then
    raise exception 'a date stays in its rotation' using errcode = 'SC002';
  end if;
  if (new.starts_at at time zone _zone)::date not between _starts and _ends then
    raise exception 'the date is outside the rotation' using errcode = 'SC004';
  end if;
  return new;
end;
$$;

create trigger supper_rotation_dates_guard
  before insert or update or delete on public.supper_rotation_dates
  for each row execute function public.supper_rotation_dates_guard();

-- Moving a rotation date moves each table's supper on it, except one already
-- moved on its own. Runs as the leader, through the suppers rules.
create function public.supper_rotation_dates_carry() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  update public.suppers d
     set starts_at = new.starts_at
   where d.rotation_date_id = new.id
     and d.org_id = new.org_id
     and d.follows_rotation_date;
  return null;
end;
$$;

create trigger supper_rotation_dates_carry
  after update of starts_at on public.supper_rotation_dates
  for each row
  when (old.starts_at is distinct from new.starts_at)
  execute function public.supper_rotation_dates_carry();

create function public.supper_parties_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  _row public.supper_parties := coalesce(new, old);
  _status text;
begin
  if current_user <> 'authenticated' then
    if tg_op = 'UPDATE' then
      new.updated_at := pg_catalog.now();
      return new;
    end if;
    return old;
  end if;

  select s.status into _status from public.supper_rotations s where s.id = _row.rotation_id;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if new.status <> 'withdrawn' or _status not in ('open', 'published') then
        raise exception 'a party can only withdraw' using errcode = 'SC003';
      end if;
      new.withdrawn_at := pg_catalog.now();
    elsif public.is_group_leader(old.group_id) then
      if _status = 'ended' then
        raise exception 'an ended rotation keeps its parties' using errcode = 'SC003';
      end if;
    elsif not public.supper_signup_window_open(old.rotation_id) then
      raise exception 'sign-ups are closed' using errcode = 'SC003';
    end if;
    new.updated_at := pg_catalog.now();
    return new;
  end if;

  if public.is_group_leader(old.group_id) then
    if _status not in ('draft', 'open') then
      raise exception 'a party at a published table withdraws instead' using errcode = 'SC003';
    end if;
  elsif not public.supper_signup_window_open(old.rotation_id) then
    raise exception 'sign-ups are closed' using errcode = 'SC003';
  end if;
  return old;
end;
$$;

create trigger supper_parties_guard
  before update or delete on public.supper_parties
  for each row execute function public.supper_parties_guard();

-- A withdrawn party leaves its tables from now on: its seats are marked
-- left, which frees them at later suppers and keeps them for earlier ones,
-- and its replies to suppers not yet held go.
create function public.supper_party_withdrawn() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  update public.supper_seats
     set left_at = pg_catalog.now()
   where party_id = new.id
     and org_id = new.org_id
     and left_at is null;

  delete from public.supper_replies r
  using public.suppers d
  where r.supper_id = d.id
    and r.org_id = new.org_id
    and d.org_id = new.org_id
    and d.rotation_id = new.rotation_id
    and d.starts_at > pg_catalog.now()
    and r.profile_id in (
      select pm.profile_id from public.supper_party_members pm
      where pm.party_id = new.id and pm.org_id = new.org_id
    );
  return null;
end;
$$;

create trigger supper_party_withdrawn
  after update of status on public.supper_parties
  for each row
  when (new.status = 'withdrawn' and old.status is distinct from 'withdrawn')
  execute function public.supper_party_withdrawn();

create function public.supper_party_members_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  _row public.supper_party_members := coalesce(new, old);
  _party_status text;
  _count integer;
begin
  if current_user <> 'authenticated' then
    return _row;
  end if;

  if not public.is_group_leader(_row.group_id) and not public.supper_signup_window_open(_row.rotation_id) then
    raise exception 'sign-ups are closed' using errcode = 'SC003';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  select p.status into _party_status
  from public.supper_parties p
  where p.id = new.party_id
  for update;

  if _party_status is distinct from 'signed_up' and _party_status is distinct from 'waitlisted' then
    raise exception 'the party has withdrawn' using errcode = 'SC003';
  end if;

  select count(*) into _count from public.supper_party_members m where m.party_id = new.party_id;
  if _count >= 2 then
    raise exception 'a party is one or two people' using errcode = 'SC002';
  end if;

  if exists (select 1 from public.profiles p where p.id = new.profile_id and p.role = 'pending') then
    raise exception 'the person is not approved yet' using errcode = 'SC002';
  end if;
  return new;
end;
$$;

create trigger supper_party_members_guard
  before insert or delete on public.supper_party_members
  for each row execute function public.supper_party_members_guard();

-- A person who leaves a party takes their replies to its suppers still to
-- come with them, and a party with nobody left in it goes, whoever removed
-- the last person: their partner, a leader, leaving the group or deleting
-- the account.
create function public.supper_party_drop_if_empty() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  delete from public.supper_replies r
  using public.suppers d, public.supper_seats st
  where r.supper_id = d.id
    and r.org_id = old.org_id
    and r.profile_id = old.profile_id
    and d.org_id = old.org_id
    and d.starts_at > pg_catalog.now()
    and st.table_id = d.table_id
    and st.party_id = old.party_id
    and st.org_id = old.org_id;

  -- Two partners leaving at once would each still see the other's row; the
  -- lock makes the second wait and see the party empty.
  perform 1 from public.supper_parties p
   where p.id = old.party_id and p.org_id = old.org_id
   for update;

  delete from public.supper_parties p
  where p.id = old.party_id
    and p.org_id = old.org_id
    and not exists (
      select 1 from public.supper_party_members m
      where m.party_id = old.party_id and m.org_id = old.org_id
    );
  return null;
end;
$$;

create trigger supper_party_drop_if_empty
  after delete on public.supper_party_members
  for each row execute function public.supper_party_drop_if_empty();

-- A party's address, food notes and dates it can't host follow the sign-up
-- window for its members; leaders may change them until the rotation ends.
create function public.supper_party_detail_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  _rotation uuid := coalesce(new.rotation_id, old.rotation_id);
  _group uuid := coalesce(new.group_id, old.group_id);
begin
  if current_user = 'authenticated' then
    if public.is_group_leader(_group) then
      if exists (select 1 from public.supper_rotations s where s.id = _rotation and s.status = 'ended') then
        raise exception 'an ended rotation keeps its parties' using errcode = 'SC003';
      end if;
    elsif not public.supper_signup_window_open(_rotation) then
      raise exception 'sign-ups are closed' using errcode = 'SC003';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.party_id is distinct from old.party_id or new.rotation_id is distinct from old.rotation_id) then
    raise exception 'a detail stays with its party' using errcode = 'SC002';
  end if;
  return new;
end;
$$;

create trigger supper_party_addresses_guard
  before insert or update or delete on public.supper_party_addresses
  for each row execute function public.supper_party_detail_guard();
create trigger supper_party_notes_guard
  before insert or update or delete on public.supper_party_notes
  for each row execute function public.supper_party_detail_guard();
create trigger supper_party_unavailable_dates_guard
  before insert or update or delete on public.supper_party_unavailable_dates
  for each row execute function public.supper_party_detail_guard();

create trigger supper_party_addresses_touch_updated_at
  before update on public.supper_party_addresses
  for each row execute function public.touch_updated_at();
create trigger supper_party_notes_touch_updated_at
  before update on public.supper_party_notes
  for each row execute function public.touch_updated_at();
create trigger supper_drafts_touch_updated_at
  before update on public.supper_drafts
  for each row execute function public.touch_updated_at();
create trigger supper_contributions_touch_updated_at
  before update on public.supper_contributions
  for each row execute function public.touch_updated_at();

create function public.suppers_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  _status text;
  _starts date;
  _ends date;
  _zone text;
begin
  if new.table_id is distinct from old.table_id
    or new.rotation_date_id is distinct from old.rotation_date_id
    or new.rotation_id is distinct from old.rotation_id
    or new.group_id is distinct from old.group_id then
    raise exception 'a supper stays at its table and date' using errcode = 'SC002';
  end if;
  new.updated_at := pg_catalog.now();
  -- Depth 1 is a move of this supper itself; the rotation-date carry runs nested.
  if new.starts_at is distinct from old.starts_at and pg_catalog.pg_trigger_depth() = 1 then
    new.follows_rotation_date := false;
  end if;

  if current_user <> 'authenticated' then
    return new;
  end if;

  select s.status, s.starts_on, s.ends_on, o.timezone into _status, _starts, _ends, _zone
  from public.supper_rotations s
  join public.organizations o on o.id = s.org_id
  where s.id = new.rotation_id;

  if _status is distinct from 'published' then
    raise exception 'only a running rotation''s suppers change' using errcode = 'SC003';
  end if;

  if new.starts_at is distinct from old.starts_at
    and (old.starts_at <= pg_catalog.now()
      or new.starts_at <= pg_catalog.now()
      or (new.starts_at at time zone _zone)::date not between _starts and _ends) then
    raise exception 'the new date is outside the rotation or has passed' using errcode = 'SC004';
  end if;
  return new;
end;
$$;

create trigger suppers_guard
  before update on public.suppers
  for each row execute function public.suppers_guard();

-- A moved supper asks everyone again. Definer: a host clears replies that
-- are not theirs to write.
create function public.supper_moved_clear_replies() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  delete from public.supper_replies r
  where r.supper_id = new.id
    and r.org_id = new.org_id;
  return null;
end;
$$;

create trigger supper_moved_clear_replies
  after update of starts_at on public.suppers
  for each row
  when (old.starts_at is distinct from new.starts_at)
  execute function public.supper_moved_clear_replies();

-- A reply is for a person seated at the supper's table, in a party that has
-- not withdrawn, given by them or by the other person in that same party,
-- while the rotation runs and before the supper starts. The policy alone would
-- let someone who shared a party with them in another rotation reply.
create function public.supper_replies_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  _supper uuid := coalesce(new.supper_id, old.supper_id);
  _profile uuid := coalesce(new.profile_id, old.profile_id);
begin
  if tg_op = 'UPDATE' and (new.supper_id is distinct from old.supper_id or new.profile_id is distinct from old.profile_id) then
    raise exception 'a reply stays with its supper and person' using errcode = 'SC002';
  end if;
  if tg_op <> 'DELETE' then
    new.replied_by := auth.uid();
    new.updated_at := pg_catalog.now();
  end if;

  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1
    from public.suppers d
    join public.supper_seats st on st.table_id = d.table_id and st.left_at is null
    join public.supper_parties p on p.id = st.party_id and p.status <> 'withdrawn'
    join public.supper_party_members pm on pm.party_id = st.party_id
    join public.supper_party_members me on me.party_id = st.party_id
    where d.id = _supper
      and pm.profile_id = _profile
      and me.profile_id = auth.uid()
  ) then
    raise exception 'the person is not at this table' using errcode = 'SC001';
  end if;

  if not exists (
    select 1
    from public.suppers d
    join public.supper_rotations s on s.id = d.rotation_id
    where d.id = _supper
      and s.status = 'published'
      and d.starts_at > pg_catalog.now()
  ) then
    raise exception 'the supper is not taking replies' using errcode = 'SC003';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger supper_replies_guard
  before insert or update or delete on public.supper_replies
  for each row execute function public.supper_replies_guard();

do $$
declare f text;
begin
  foreach f in array array[
    'supper_party_withdrawn', 'supper_party_drop_if_empty', 'supper_moved_clear_replies'
  ] loop
    execute format('revoke execute on function public.%I() from public, anon, authenticated', f);
  end loop;
end $$;

-- ── Sign up ─────────────────────────────────────────────────────────────────
-- A party and its people in one transaction. A member signs up a party they
-- are in; a leader signs up anyone in the group. After the tables are
-- published a sign-up is waitlisted. Tenant anchor: the rotation row's org,
-- pinned against app_request_org_id().
create function public.supper_party_create(_rotation_id uuid, _profile_ids uuid[]) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  _org uuid := public.app_request_org_id();
  _rotation public.supper_rotations;
  _ids uuid[];
  _leader boolean;
  _status text;
  _valid integer;
  _party uuid;
begin
  if _org is null then
    raise exception 'no rotation' using errcode = 'SC001';
  end if;

  -- Conflicts with publish's FOR UPDATE, so the status read is the one that commits.
  select * into _rotation from public.supper_rotations s where s.id = _rotation_id for share;
  if _rotation.id is null or _rotation.org_id is distinct from _org then
    raise exception 'no rotation' using errcode = 'SC001';
  end if;

  _leader := public.is_group_leader(_rotation.group_id);
  if not _leader and not public.is_group_member(_rotation.group_id) then
    raise exception 'no rotation' using errcode = 'SC001';
  end if;

  _ids := array(select distinct x from unnest(_profile_ids) as x where x is not null);
  if cardinality(_ids) not between 1 and 2 or cardinality(_ids) <> cardinality(_profile_ids) then
    raise exception 'a party is one or two people' using errcode = 'SC002';
  end if;
  if not _leader and not (auth.uid() = any (_ids)) then
    raise exception 'sign up a party you are in' using errcode = 'SC001';
  end if;

  if _rotation.status = 'open' then
    if not _leader and not public.supper_signup_window_open(_rotation.id) then
      raise exception 'sign-ups are closed' using errcode = 'SC003';
    end if;
    _status := 'signed_up';
  elsif _rotation.status = 'published' then
    _status := 'waitlisted';
  else
    raise exception 'the rotation is not taking sign-ups' using errcode = 'SC003';
  end if;

  select count(*) into _valid
  from public.group_members gm
  join public.profiles p on p.id = gm.profile_id and p.org_id = gm.org_id
  where gm.org_id = _org
    and gm.group_id = _rotation.group_id
    and gm.profile_id = any (_ids)
    and p.role <> 'pending';
  if _valid <> cardinality(_ids) then
    raise exception 'everyone in a party is in the group' using errcode = 'SC002';
  end if;

  insert into public.supper_parties (org_id, rotation_id, group_id, status, created_by)
  values (_org, _rotation.id, _rotation.group_id, _status, auth.uid())
  returning id into _party;

  insert into public.supper_party_members (org_id, party_id, rotation_id, group_id, profile_id)
  select _org, _party, _rotation.id, _rotation.group_id, x
  from unnest(_ids) as x;

  return _party;
end;
$$;

revoke execute on function public.supper_party_create(uuid, uuid[]) from public, anon;
grant execute on function public.supper_party_create(uuid, uuid[]) to authenticated;

comment on function public.supper_party_create(uuid, uuid[]) is
  'Signs up a party of one or two people for a rotation. Actor from auth.uid(); tenant anchor: the rotation row''s org, pinned against app_request_org_id(). A member must be in the party; a leader may sign up any member of the group. Raises SC001, SC002, SC003, or 23505 when someone is already in a party this rotation.';

-- Replacing a list is one transaction, so a failed insert keeps the old rows.
-- A date kept in the list keeps its id, and with it the preferences and
-- can't-host dates that point at it. The rotation row lock serializes two
-- leaders replacing at once. Invoker: the table rules and guards apply.
create function public.supper_rotation_dates_replace(_rotation_id uuid, _starts_at timestamptz[])
  returns integer
  language plpgsql security invoker
  set search_path = ''
as $$
declare
  _group uuid;
  _status text;
  _list timestamptz[] := coalesce(_starts_at, '{}');
  _n integer;
begin
  select s.group_id, s.status into _group, _status
  from public.supper_rotations s where s.id = _rotation_id
  for update;
  if _group is null then
    raise exception 'no rotation' using errcode = 'SC001';
  end if;
  if _status not in ('draft', 'open') then
    raise exception 'a published rotation changes one date at a time' using errcode = 'SC003';
  end if;
  delete from public.supper_rotation_dates sd
  where sd.rotation_id = _rotation_id and not (sd.starts_at = any (_list));
  insert into public.supper_rotation_dates (rotation_id, group_id, starts_at)
  select _rotation_id, _group, x
  from (select distinct x from unnest(_list) as x) as l
  where not exists (
    select 1 from public.supper_rotation_dates sd where sd.rotation_id = _rotation_id and sd.starts_at = l.x
  );
  select count(*)::integer into _n
  from public.supper_rotation_dates sd
  where sd.rotation_id = _rotation_id and sd.starts_at = any (_list);
  return _n;
end;
$$;

create function public.supper_party_unavailable_dates_replace(_party_id uuid, _rotation_date_ids uuid[])
  returns integer
  language plpgsql security invoker
  set search_path = ''
as $$
declare
  _rotation uuid;
  _group uuid;
  _n integer;
begin
  -- The lock makes a second save wait and then replace this one's list.
  select p.rotation_id, p.group_id into _rotation, _group from public.supper_parties p where p.id = _party_id
  for update;
  if _rotation is null then
    raise exception 'no party' using errcode = 'SC001';
  end if;
  delete from public.supper_party_unavailable_dates u where u.party_id = _party_id;
  insert into public.supper_party_unavailable_dates (party_id, rotation_date_id, rotation_id, group_id)
  select _party_id, x, _rotation, _group from unnest(coalesce(_rotation_date_ids, '{}')) as x;
  get diagnostics _n = row_count;
  return _n;
end;
$$;

revoke execute on function public.supper_rotation_dates_replace(uuid, timestamptz[]) from public, anon;
grant execute on function public.supper_rotation_dates_replace(uuid, timestamptz[]) to authenticated;
revoke execute on function public.supper_party_unavailable_dates_replace(uuid, uuid[]) from public, anon;
grant execute on function public.supper_party_unavailable_dates_replace(uuid, uuid[]) to authenticated;

comment on function public.supper_rotation_dates_replace(uuid, timestamptz[]) is
  'Replaces a draft or open rotation''s dates in one transaction, keeping the id of each date still listed, and returns how many dates the rotation now has from the list. Raises SC003 once the rotation is published. Security invoker: the rotation dates rules decide who may.';
comment on function public.supper_party_unavailable_dates_replace(uuid, uuid[]) is
  'Replaces the dates a party can''t host in one transaction and returns how many it added. Security invoker: the unavailable dates rules decide who may.';

-- ── Publish ─────────────────────────────────────────────────────────────────
-- For each person seated this rotation, what their suppers look like: each
-- date's host and who else is at the table. Publish compares it before and
-- after to name the people whose tables changed.
create function public.supper_seat_signatures(_rotation_id uuid, _org_id uuid) returns jsonb
  language sql stable
  set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.profile_id, x.sig), '{}'::jsonb)
  from (
    select pm.profile_id,
           string_agg(
             d.rotation_date_id::text || ':' || coalesce(d.host_party_id::text, '-') || ':' || (
               select string_agg(st2.party_id::text, ',' order by st2.party_id)
               from public.supper_seats st2
               where st2.table_id = d.table_id and st2.org_id = _org_id and st2.left_at is null
             ),
             ';' order by d.rotation_date_id
           ) as sig
    from public.supper_party_members pm
    join public.supper_seats st on st.party_id = pm.party_id and st.org_id = _org_id and st.left_at is null
    join public.suppers d on d.table_id = st.table_id and d.org_id = _org_id
    where pm.rotation_id = _rotation_id
      and pm.org_id = _org_id
    group by pm.profile_id
  ) x;
$$;

revoke execute on function public.supper_seat_signatures(uuid, uuid) from public, anon, authenticated;

create function public.supper_tables_publish(_rotation_id uuid) returns table (profile_id uuid)
  language plpgsql security definer
  set search_path = ''
as $$
declare
  _org uuid := public.app_request_org_id();
  _rotation public.supper_rotations;
  _body jsonb;
  _entry jsonb;
  _ord bigint;
  _table uuid;
  _party_ids uuid[];
  _host_dates uuid[];
  _kept uuid[] := '{}';
  _before jsonb;
  _after jsonb;
  _n integer;
begin
  if _org is null then
    raise exception 'no rotation' using errcode = 'SC001';
  end if;

  select * into _rotation from public.supper_rotations s where s.id = _rotation_id for update;
  if _rotation.id is null or _rotation.org_id is distinct from _org or not public.is_group_leader(_rotation.group_id) then
    raise exception 'no rotation' using errcode = 'SC001';
  end if;
  if _rotation.status not in ('open', 'published') then
    raise exception 'the rotation is not ready for tables' using errcode = 'SC003';
  end if;

  -- A withdrawal updates its party row, so it either lands before the checks
  -- below or waits for publish and then closes the seats it wrote.
  perform 1 from public.supper_parties p
   where p.rotation_id = _rotation.id and p.org_id = _org
   order by p.id
   for share;

  select d.body into _body from public.supper_drafts d
   where d.rotation_id = _rotation.id and d.org_id = _org
   for update;
  if _body is null or jsonb_typeof(_body -> 'tables') is distinct from 'array' then
    raise exception 'there is no draft to publish' using errcode = 'SC002';
  end if;
  if jsonb_array_length(_body -> 'tables') = 0 then
    raise exception 'there is no draft to publish' using errcode = 'SC002';
  end if;

  -- Postgres may evaluate OR arms in any order, so the lists are known to be
  -- arrays before any array-only function reads them.
  if exists (
    select 1 from jsonb_array_elements(_body -> 'tables') t
    where jsonb_typeof(t -> 'partyIds') is distinct from 'array'
      or jsonb_typeof(t -> 'hosts') is distinct from 'array'
  ) then
    raise exception 'a table has a malformed party or host list' using errcode = 'SC002';
  end if;

  -- Every table lists parties of this rotation that have not withdrawn. Ids
  -- are checked before anything below casts them.
  if exists (
    select 1
    from jsonb_array_elements(_body -> 'tables') t
    where jsonb_typeof(t -> 'partyIds') is distinct from 'array'
      or jsonb_array_length(t -> 'partyIds') = 0
      or jsonb_typeof(t -> 'hosts') is distinct from 'array'
      or coalesce(t ->> 'tableId', '') !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
      or coalesce(t ->> 'rotationDateId', '') !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
      or exists (
        select 1 from jsonb_array_elements(t -> 'partyIds') pid
        where jsonb_typeof(pid) is distinct from 'string'
          or (pid #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
      or exists (
        select 1 from jsonb_array_elements(t -> 'hosts') h
        where coalesce(h ->> 'rotationDateId', '') !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
          or coalesce(h ->> 'partyId', '') !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
      )
  ) then
    raise exception 'a table lists a party not signed up this rotation' using errcode = 'SC002';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(_body -> 'tables') t,
         jsonb_array_elements_text(t -> 'partyIds') pid
    where not exists (
      select 1 from public.supper_parties p
      where p.id = pid::uuid and p.rotation_id = _rotation.id and p.org_id = _org
        and p.status in ('signed_up', 'waitlisted')
    )
  ) then
    raise exception 'a table lists a party not signed up this rotation' using errcode = 'SC002';
  end if;

  -- A table already published keeps its date.
  if exists (
    select 1
    from jsonb_array_elements(_body -> 'tables') t
    where nullif(t ->> 'tableId', '') is not null
      and not exists (
        select 1 from public.supper_tables dt
        where dt.id = (t ->> 'tableId')::uuid and dt.rotation_id = _rotation.id and dt.org_id = _org
          and dt.rotation_date_id is not distinct from nullif(t ->> 'rotationDateId', '')::uuid
      )
  ) then
    raise exception 'a table is not one of this rotation''s' using errcode = 'SC002';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(_body -> 'tables') t
    where nullif(t ->> 'tableId', '') is not null
    group by (t ->> 'tableId')::uuid
    having count(*) > 1
  ) then
    raise exception 'a table is listed twice' using errcode = 'SC002';
  end if;

  if _rotation.format = 'new_tables' then
    if exists (
      select 1 from jsonb_array_elements(_body -> 'tables') t
      where not exists (
        select 1 from public.supper_rotation_dates sd
        where sd.id = nullif(t ->> 'rotationDateId', '')::uuid and sd.rotation_id = _rotation.id and sd.org_id = _org
      )
    ) or exists (
      select 1
      from jsonb_array_elements(_body -> 'tables') t,
           jsonb_array_elements_text(t -> 'partyIds') pid
      group by nullif(t ->> 'rotationDateId', '')::uuid, pid::uuid
      having count(*) > 1
    ) or exists (
      select 1 from public.supper_rotation_dates sd
      where sd.rotation_id = _rotation.id and sd.org_id = _org
        and not exists (
          select 1 from jsonb_array_elements(_body -> 'tables') t
          where nullif(t ->> 'rotationDateId', '')::uuid = sd.id
        )
    ) then
      raise exception 'every date has tables, and each date''s tables seat each party once' using errcode = 'SC002';
    end if;
  else
    if exists (
      select 1 from jsonb_array_elements(_body -> 'tables') t
      where nullif(t ->> 'rotationDateId', '') is not null
    ) or exists (
      select 1
      from jsonb_array_elements(_body -> 'tables') t,
           jsonb_array_elements_text(t -> 'partyIds') pid
      group by pid::uuid
      having count(*) > 1
    ) then
      raise exception 'each party sits at one table for the whole rotation' using errcode = 'SC002';
    end if;
  end if;

  if not exists (select 1 from public.supper_rotation_dates sd where sd.rotation_id = _rotation.id and sd.org_id = _org) then
    raise exception 'the rotation has no dates' using errcode = 'SC002';
  end if;

  -- Each table has exactly one host for each of its dates: every rotation date
  -- for a table kept for the whole rotation, its own date otherwise. The host is a party
  -- at the table that offered to host. A supper already held keeps the host
  -- it had, who may since have withdrawn, so the draft's entry for it is
  -- neither required nor checked.
  if exists (
    select 1
    from jsonb_array_elements(_body -> 'tables') t
    join public.supper_rotation_dates sd
      on sd.rotation_id = _rotation.id and sd.org_id = _org
     and (_rotation.format <> 'new_tables' or sd.id = nullif(t ->> 'rotationDateId', '')::uuid)
    where (
      select count(*) from jsonb_array_elements(t -> 'hosts') h
      where nullif(h ->> 'rotationDateId', '')::uuid = sd.id and nullif(h ->> 'partyId', '') is not null
    ) <> 1
      and not exists (
        select 1 from public.suppers d
        where d.table_id = nullif(t ->> 'tableId', '')::uuid and d.rotation_date_id = sd.id
          and d.org_id = _org and d.starts_at <= pg_catalog.now()
      )
  ) or exists (
    select 1
    from jsonb_array_elements(_body -> 'tables') t,
         jsonb_array_elements(t -> 'hosts') h
    where nullif(h ->> 'partyId', '') is not null
      and not exists (
        select 1 from public.suppers d
        where d.table_id = nullif(t ->> 'tableId', '')::uuid
          and d.rotation_date_id = nullif(h ->> 'rotationDateId', '')::uuid
          and d.org_id = _org and d.starts_at <= pg_catalog.now()
      )
      and (
        not ((t -> 'partyIds') ? (h ->> 'partyId'))
        or not exists (
          select 1 from public.supper_parties p
          where p.id = (h ->> 'partyId')::uuid and p.rotation_id = _rotation.id and p.org_id = _org and p.can_host
        )
        or not exists (
          select 1 from public.supper_rotation_dates sd
          where sd.id = nullif(h ->> 'rotationDateId', '')::uuid and sd.rotation_id = _rotation.id and sd.org_id = _org
            and (_rotation.format <> 'new_tables' or sd.id = nullif(t ->> 'rotationDateId', '')::uuid)
        )
      )
  ) then
    raise exception 'each supper needs one host from its table' using errcode = 'SC002';
  end if;

  -- A supper that has happened keeps its table: dropping the table would
  -- delete the supper and its replies. Its host is left as it was below.
  if exists (
    select 1 from public.suppers d
    where d.rotation_id = _rotation.id and d.org_id = _org and d.starts_at <= pg_catalog.now()
      and not exists (
        select 1 from jsonb_array_elements(_body -> 'tables') t
        where nullif(t ->> 'tableId', '')::uuid = d.table_id
      )
  ) then
    raise exception 'a supper that has happened keeps its table' using errcode = 'SC005';
  end if;

  _before := public.supper_seat_signatures(_rotation.id, _org);

  update public.supper_rotations
     set status = 'published', published_at = coalesce(published_at, pg_catalog.now())
   where id = _rotation.id and org_id = _org;
  get diagnostics _n = row_count;
  if _n <> 1 then
    raise exception 'the rotation could not be published' using errcode = 'SC003';
  end if;

  for _entry, _ord in
    select t, o from jsonb_array_elements(_body -> 'tables') with ordinality as x(t, o)
  loop
    _table := nullif(_entry ->> 'tableId', '')::uuid;
    if _table is null then
      insert into public.supper_tables (org_id, rotation_id, group_id, rotation_date_id, position)
      values (_org, _rotation.id, _rotation.group_id, nullif(_entry ->> 'rotationDateId', '')::uuid, _ord)
      returning id into _table;
    else
      update public.supper_tables set position = _ord
       where id = _table and rotation_id = _rotation.id and org_id = _org;
      get diagnostics _n = row_count;
      if _n <> 1 then
        raise exception 'a table is not one of this rotation''s' using errcode = 'SC002';
      end if;
    end if;
    _kept := _kept || _table;

    _party_ids := array(select x::uuid from jsonb_array_elements_text(_entry -> 'partyIds') as x);
    -- The host of a supper already held leaves rather than losing the seat,
    -- which would clear that supper's host.
    update public.supper_seats st
       set left_at = pg_catalog.now()
     where st.table_id = _table and st.org_id = _org and st.left_at is null
       and not (st.party_id = any (_party_ids))
       and exists (
         select 1 from public.suppers d
         where d.table_id = _table and d.org_id = _org and d.host_party_id = st.party_id
           and d.starts_at <= pg_catalog.now()
       );
    delete from public.supper_seats st
     where st.table_id = _table and st.org_id = _org and st.left_at is null
       and not (st.party_id = any (_party_ids));
    insert into public.supper_seats as ds (org_id, table_id, party_id, rotation_id, group_id)
    select _org, _table, x, _rotation.id, _rotation.group_id from unnest(_party_ids) as x
    on conflict (table_id, party_id) do update
      set left_at = null, seated_at = pg_catalog.now()
      where ds.left_at is not null;

    _host_dates := array(
      select (h ->> 'rotationDateId')::uuid from jsonb_array_elements(_entry -> 'hosts') h
      where nullif(h ->> 'partyId', '') is not null
    );
    insert into public.suppers as dn (org_id, rotation_id, group_id, table_id, rotation_date_id, starts_at, host_party_id)
    select _org, _rotation.id, _rotation.group_id, _table, sd.id, sd.starts_at, (h ->> 'partyId')::uuid
    from jsonb_array_elements(_entry -> 'hosts') h
    join public.supper_rotation_dates sd
      on sd.id = (h ->> 'rotationDateId')::uuid and sd.rotation_id = _rotation.id and sd.org_id = _org
    where nullif(h ->> 'partyId', '') is not null
    on conflict (table_id, rotation_date_id) do update
      set host_party_id = excluded.host_party_id, host_unavailable = false
      where dn.host_party_id is distinct from excluded.host_party_id
        and dn.starts_at > pg_catalog.now();
    delete from public.suppers d
     where d.table_id = _table and d.org_id = _org
       and d.starts_at > pg_catalog.now()
       and not (d.rotation_date_id = any (_host_dates));
  end loop;

  delete from public.supper_tables dt
   where dt.rotation_id = _rotation.id and dt.org_id = _org
     and not (dt.id = any (_kept));

  -- Someone no longer at a supper's table has no reply to it. A supper that
  -- has happened keeps its replies, as it does on withdrawal.
  delete from public.supper_replies r
  using public.suppers d
  where r.supper_id = d.id
    and r.org_id = _org
    and d.org_id = _org
    and d.rotation_id = _rotation.id
    and d.starts_at > pg_catalog.now()
    and not exists (
      select 1
      from public.supper_seats st
      join public.supper_party_members pm on pm.party_id = st.party_id and pm.org_id = _org
      where st.table_id = d.table_id and st.org_id = _org and st.left_at is null
        and pm.profile_id = r.profile_id
    );

  update public.supper_parties p
     set status = 'signed_up'
   where p.rotation_id = _rotation.id and p.org_id = _org and p.status = 'waitlisted'
     and exists (
       select 1 from public.supper_seats st
       where st.party_id = p.id and st.org_id = _org and st.left_at is null
     );

  delete from public.supper_drafts d where d.rotation_id = _rotation.id and d.org_id = _org;

  _after := public.supper_seat_signatures(_rotation.id, _org);

  return query
  select k.key::uuid
  from (
    select jsonb_object_keys(_before) as key
    union
    select jsonb_object_keys(_after)
  ) k
  where (_before ->> k.key) is distinct from (_after ->> k.key);
end;
$$;

revoke execute on function public.supper_tables_publish(uuid) from public, anon;
grant execute on function public.supper_tables_publish(uuid) to authenticated;

comment on function public.supper_tables_publish(uuid) is
  'Publishes the rotation''s stored draft (supper_drafts) as its tables, seats and suppers in one transaction, and returns the people whose tables or hosts changed. Actor from auth.uid(), who must lead the group; tenant anchor: the rotation row''s org, pinned against app_request_org_id(). Raises SC001, SC002, SC003, or SC005 when the draft drops the table of a supper that has happened; a held supper keeps its host whatever the draft says.';

-- ── Reminder ────────────────────────────────────────────────────────────────
-- Starts the reminder pass for a supper's local date when it has none,
-- fixing its recipients, then claims every unsent reminder in it. Runs on
-- the service key only. The caller passes the start and host it read; a
-- supper moved or rehosted since claims nothing, and the next firing reads
-- it again.
create function public.supper_reminder_claim(
  _org_id uuid, _supper_id uuid, _supper_date date, _starts_at timestamptz, _host_party_id uuid
)
  returns table (profile_id uuid, email text, first_name text, preferred_name text)
  language plpgsql
  set search_path = ''
as $$
declare
  _supper public.suppers;
begin
  -- Held to commit, so a move or rehost waits for the claim rather than racing it.
  select * into _supper from public.suppers d where d.id = _supper_id for share;
  if _supper.id is null or _supper.org_id is distinct from _org_id then
    raise exception 'supper reminder claim rejected: supper % is not in org %', _supper_id, _org_id
      using errcode = 'SC010';
  end if;
  if _supper.starts_at is distinct from _starts_at or _supper.host_party_id is distinct from _host_party_id then
    return;
  end if;

  insert into public.supper_reminder_passes (org_id, supper_id, supper_date)
  values (_org_id, _supper_id, _supper_date)
  on conflict do nothing;

  if found then
    insert into public.supper_reminder_sends (org_id, supper_id, supper_date, profile_id)
    select _org_id, _supper_id, _supper_date, p.id
    from public.supper_seats st
    join public.supper_parties pa on pa.id = st.party_id and pa.org_id = _org_id and pa.status <> 'withdrawn'
    join public.supper_party_members pm on pm.party_id = st.party_id and pm.org_id = _org_id
    join public.profiles p on p.id = pm.profile_id and p.org_id = _org_id
    where st.table_id = _supper.table_id
      and st.org_id = _org_id
      and st.left_at is null
      and p.email is not null
      and p.role <> 'pending'
      and p.email_supper_club
      and exists (
        select 1 from public.supper_rotations s
        where s.id = _supper.rotation_id and s.org_id = _org_id and s.status = 'published'
      )
      and exists (
        select 1 from public.group_settings gs
        where gs.group_id = _supper.group_id and gs.org_id = _org_id and gs.supper_club_enabled
      )
      and not exists (
        select 1 from public.supper_replies r
        where r.org_id = _org_id and r.supper_id = _supper_id and r.profile_id = p.id and r.status = 'not_going'
      );
  end if;

  return query
  with claimed as (
    update public.supper_reminder_sends x
       set claimed_at = pg_catalog.now()
     where x.org_id = _org_id
       and x.supper_id = _supper_id
       and x.supper_date = _supper_date
       and x.sent_at is null
       and (x.claimed_at is null or x.claimed_at < pg_catalog.now() - interval '10 minutes')
    returning x.profile_id
  )
  select c.profile_id, p.email, p.first_name, p.preferred_name
  from claimed c
  join public.profiles p on p.id = c.profile_id and p.org_id = _org_id
  where p.email is not null
    and p.role <> 'pending'
    and p.email_supper_club
    and exists (
      select 1
      from public.supper_seats st
      join public.supper_parties pa on pa.id = st.party_id and pa.org_id = _org_id and pa.status <> 'withdrawn'
      join public.supper_party_members pm on pm.party_id = st.party_id and pm.org_id = _org_id
      where st.table_id = _supper.table_id and st.org_id = _org_id and st.left_at is null
        and pm.profile_id = p.id
    )
    and exists (
      select 1 from public.supper_rotations s
      where s.id = _supper.rotation_id and s.org_id = _org_id and s.status = 'published'
    )
    and exists (
      select 1 from public.group_settings gs
      where gs.group_id = _supper.group_id and gs.org_id = _org_id and gs.supper_club_enabled
    )
    and not exists (
      select 1 from public.supper_replies r
      where r.org_id = _org_id and r.supper_id = _supper_id and r.profile_id = p.id and r.status = 'not_going'
    );
end;
$$;

revoke execute on function public.supper_reminder_claim(uuid, uuid, date, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.supper_reminder_claim(uuid, uuid, date, timestamptz, uuid) to service_role;

comment on function public.supper_reminder_claim(uuid, uuid, date, timestamptz, uuid) is
  'Starts the reminder pass for one supper on one local date when it has none, unless its start or host differs from the caller''s _starts_at and _host_party_id, fixing its recipients (the people seated at its table who have not said Not going and get Supper club email), then claims every unsent reminder in it and returns the people to mail who are still seated there. Tenant anchor: the supper''s own org_id, compared with _org_id; a mismatch raises SC010. service_role only.';

-- The nightly cleanup deletes a church's passes past their retention through
-- this, a bounded set per call: the database API cannot limit a delete.
-- supper_reminder_sends goes with each pass through its foreign key.
create function public.supper_reminder_passes_prune(_org_id uuid, _before date, _limit integer)
  returns integer
  language sql security invoker set search_path = ''
as $$
  with doomed as (
    select p.supper_id, p.supper_date
    from public.supper_reminder_passes p
    where p.org_id = _org_id and p.supper_date < _before
    order by p.supper_date
    limit _limit
  ),
  gone as (
    delete from public.supper_reminder_passes p
    using doomed d
    where p.org_id = _org_id and p.supper_id = d.supper_id and p.supper_date = d.supper_date
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.supper_reminder_passes_prune(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.supper_reminder_passes_prune(uuid, date, integer) to service_role;

comment on function public.supper_reminder_passes_prune(uuid, date, integer) is
  'Deletes at most _limit of one church''s supper reminder passes with a supper_date before _before, oldest first, and returns how many went. Tenant anchor: the _org_id predicate on every row it reads and deletes. service_role only.';

-- ── Usage patterns ──────────────────────────────────────────────────────────
create or replace function public.usage_page_patterns() returns text[]
  language sql
  immutable
  set search_path = ''
as $$
  select array[
    '/',
    '/admin',
    '/admin/families',
    '/admin/groups',
    '/admin/groups/[id]',
    '/admin/invite',
    '/admin/members',
    '/admin/members/[id]',
    '/admin/members/invite',
    '/admin/requests',
    '/admin/settings',
    '/admin/settings/church-records',
    '/admin/settings/email',
    '/admin/usage',
    '/calendar',
    '/dashboard',
    '/directory',
    '/directory/anniversaries',
    '/directory/birthdays',
    '/directory/families',
    '/directory/groups',
    '/find-a-group',
    '/forgot-password',
    '/g/[groupId]/about',
    '/g/[groupId]/about/edit',
    '/g/[groupId]/announcements',
    '/g/[groupId]/announcements/[id]/edit',
    '/g/[groupId]/announcements/new',
    '/g/[groupId]/calendar',
    '/g/[groupId]/calendar/[id]',
    '/g/[groupId]/calendar/[id]/edit',
    '/g/[groupId]/calendar/new',
    '/g/[groupId]/dashboard',
    '/g/[groupId]/directory',
    '/g/[groupId]/directory/anniversaries',
    '/g/[groupId]/directory/birthdays',
    '/g/[groupId]/directory/families',
    '/g/[groupId]/directory/groups',
    '/g/[groupId]/give',
    '/g/[groupId]/give/[fundId]/edit',
    '/g/[groupId]/give/new',
    '/g/[groupId]/lectures',
    '/g/[groupId]/lectures/[id]',
    '/g/[groupId]/lectures/[id]/edit',
    '/g/[groupId]/lectures/new',
    '/g/[groupId]/lectures/series',
    '/g/[groupId]/lectures/series/[id]',
    '/g/[groupId]/lectures/series/[id]/edit',
    '/g/[groupId]/lectures/series/new',
    '/g/[groupId]/prayer',
    '/g/[groupId]/serving',
    '/g/[groupId]/serving/[teamId]',
    '/g/[groupId]/settings',
    '/g/[groupId]/settings/details',
    '/g/[groupId]/settings/invites',
    '/g/[groupId]/settings/labels',
    '/g/[groupId]/settings/privacy',
    '/g/[groupId]/settings/requests',
    '/g/[groupId]/settings/serving',
    '/g/[groupId]/settings/teams',
    '/g/[groupId]/supper-club',
    '/g/[groupId]/supper-club/rotations/[rotationId]',
    '/g/[groupId]/supper-club/rotations/[rotationId]/edit',
    '/g/[groupId]/supper-club/rotations/[rotationId]/tables',
    '/g/[groupId]/supper-club/rotations/new',
    '/household',
    '/join/[token]',
    '/join/family/[token]',
    '/login',
    '/platform',
    '/platform/organizations',
    '/platform/organizations/[id]',
    '/platform/usage',
    '/privacy',
    '/profile',
    '/profile/setup',
    '/serving/go',
    '/settings',
    '/setup-account',
    '/terms',
    '/update-password'
  ]::text[];
$$;

-- ── The job ─────────────────────────────────────────────────────────────────
-- Fires at the same three hours as the event reminder: 15:00 UTC sends, 16:00
-- and 17:00 finish what a failed or cut-off firing left, and the sent record
-- keeps the later two from mailing anyone again.
select private.schedule_edge_reminder(
  'send-supper-reminders-daily',
  '0 15-17 * * *',
  '/functions/v1/send-supper-reminders',
  '{}'::jsonb,
  120000
);

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
      ('send-supper-reminders-daily', 15, false),
      ('send-supper-reminders-daily', 16, false),
      ('send-supper-reminders-daily', 17, false),
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
