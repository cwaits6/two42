-- Dinner club: a group's dinners in members' homes, run as seasons. A
-- leader adds a season, members sign up as parties of one or two, the
-- leader shuffles the parties into tables and publishes them, and each
-- table's dinners are dated rows of their own, never events, so nothing
-- reaches the group calendar or its subscription.
--
-- Two things in here are private, and the database holds both lines:
--   * a host's address (dinner_party_addresses): the party, the group's
--     leaders, and the parties seated at a table one of that party's
--     dinners is at. Tables exist only once published, so before publish no
--     guest reads any address.
--   * allergies and food needs (dinner_party_notes): the party, the leaders,
--     and the host of a dinner the party is seated at.
-- A church admin outside the group is on neither list.
--
-- Error contract (SQLSTATEs the routes map to HTTP statuses):
--   DC001  not found, or the caller may not do this          → 404/403
--   DC002  invalid input or draft                             → 400
--   DC003  the season is not in a state that allows this      → 409
--   DC004  a date outside the season, or in the past          → 400
--   DC010  reminder claim for a dinner of another org         → service only

-- ── Switches ────────────────────────────────────────────────────────────────
alter table public.group_settings
  add column dinner_club_enabled boolean not null default false;

comment on column public.group_settings.dinner_club_enabled is
  'Shows the Dinner club page in the group. Off hides it and sends no dinner emails; every season and its rows stay.';
comment on table public.group_settings is
  'Per-group settings: the serving email link mode, what a calendar event shows, event reminders and the dinner club. One row per group, created on first save; an absent row means the defaults.';

alter table public.profiles
  add column email_dinner_club boolean not null default true;

comment on column public.profiles.email_dinner_club is
  'False stops every dinner club email to this person: tables, moved dinners and reminders. Only the person can change it.';

-- ADD COLUMN adds nothing to the column-level select grant on profiles.
grant select (email_dinner_club) on public.profiles to anon, authenticated;

-- The profile update policy lets a church admin and a household manager
-- write another person's row, so the column needs its own rule.
create function public.profiles_own_dinner_club_email() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if auth.uid() is not null and auth.uid() is distinct from old.id then
    raise exception 'only the person can change their own dinner club email setting'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_own_dinner_club_email
  before update of email_dinner_club on public.profiles
  for each row
  when (old.email_dinner_club is distinct from new.email_dinner_club)
  execute function public.profiles_own_dinner_club_email();

-- The parent key for a party member: leaving the group, or being deleted,
-- takes the person out of their party.
alter table public.group_members
  add constraint group_members_group_profile_org_unique unique (group_id, profile_id, org_id);

-- ── Tables ──────────────────────────────────────────────────────────────────
-- Every child row carries season_id and group_id, and its (season_id,
-- group_id, org_id) key points at the season, so the group a leader policy
-- reads is always the season's own.
create table public.dinner_seasons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  group_id uuid not null,
  title text not null
    constraint dinner_seasons_title_check check (char_length(btrim(title)) between 1 and 80),
  format text not null
    constraint dinner_seasons_format_check check (format in ('same_table_one_host', 'same_table_rotating', 'new_tables')),
  status text not null default 'draft'
    constraint dinner_seasons_status_check check (status in ('draft', 'open', 'published', 'ended')),
  starts_on date not null,
  ends_on date not null,
  length_months smallint
    constraint dinner_seasons_length_months_check check (length_months between 1 and 24),
  repeat_kind text not null
    constraint dinner_seasons_repeat_kind_check check (repeat_kind in ('weeks', 'monthly_weekday')),
  repeat_weeks smallint
    constraint dinner_seasons_repeat_weeks_check check (repeat_weeks between 1 and 12),
  repeat_week_of_month smallint
    constraint dinner_seasons_repeat_week_of_month_check check (repeat_week_of_month between 1 and 5),
  weekday smallint not null
    constraint dinner_seasons_weekday_check check (weekday between 0 and 6),
  default_start_time time not null default '18:00',
  table_size_min smallint not null default 6,
  table_size_max smallint not null default 8,
  signup_closes_on date not null,
  allow_back_to_back_hosting boolean not null default false,
  bring_list_enabled boolean not null default true,
  previous_season_id uuid,
  published_at timestamptz,
  ended_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dinner_seasons_ends_after_start check (ends_on >= starts_on),
  constraint dinner_seasons_table_size_check
    check (table_size_min >= 2 and table_size_min <= table_size_max and table_size_max <= 20),
  constraint dinner_seasons_repeat_shape_check check (
    (repeat_kind = 'weeks' and repeat_weeks is not null and repeat_week_of_month is null)
    or (repeat_kind = 'monthly_weekday' and repeat_week_of_month is not null and repeat_weeks is null)
  ),
  constraint dinner_seasons_id_group_org_unique unique (id, group_id, org_id),
  constraint dinner_seasons_group_id_fkey
    foreign key (group_id, org_id) references public.groups (id, org_id) on delete cascade,
  constraint dinner_seasons_created_by_fkey
    foreign key (created_by, org_id) references public.profiles (id, org_id) on delete set null (created_by),
  constraint dinner_seasons_previous_season_id_fkey
    foreign key (previous_season_id, group_id, org_id)
    references public.dinner_seasons (id, group_id, org_id) on delete set null (previous_season_id)
);

comment on table public.dinner_seasons is
  'One run of a group''s dinner club. Status runs draft, open (sign-ups), published (tables), ended; only dinner_tables_publish() sets published. Members read every season but a draft; only the group''s leaders write.';
comment on column public.dinner_seasons.length_months is
  'Set when the leader gave the length in months; ends_on is always stored.';
comment on column public.dinner_seasons.repeat_week_of_month is
  'For a monthly season: which weekday of the month, 1 to 4, or 5 for the last.';
comment on column public.dinner_seasons.weekday is
  '0 is Sunday.';
comment on column public.dinner_seasons.bring_list_enabled is
  'Whether a dinner''s host gives each guest party something to bring (dinner_contributions).';
comment on column public.dinner_seasons.previous_season_id is
  'The season this one was started from, whose parties are invited again and whose tables the shuffle keeps apart.';

-- At most one season per group taking sign-ups or running.
create unique index dinner_seasons_one_running
  on public.dinner_seasons (group_id) where status in ('open', 'published');
create index dinner_seasons_group_idx on public.dinner_seasons (group_id, org_id);
create index dinner_seasons_created_by_idx on public.dinner_seasons (created_by);
create index dinner_seasons_previous_idx on public.dinner_seasons (previous_season_id);

create table public.dinner_season_dates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  season_id uuid not null,
  group_id uuid not null,
  starts_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint dinner_season_dates_id_season_org_unique unique (id, season_id, org_id),
  constraint dinner_season_dates_season_fkey
    foreign key (season_id, group_id, org_id) references public.dinner_seasons (id, group_id, org_id) on delete cascade
);

comment on table public.dinner_season_dates is
  'The season''s dinner dates. Each table''s dinner takes its date''s time when published and can move on its own afterwards.';

create index dinner_season_dates_season_idx on public.dinner_season_dates (season_id, group_id, org_id, starts_at);

create table public.dinner_parties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  season_id uuid not null,
  group_id uuid not null,
  status text not null default 'signed_up'
    constraint dinner_parties_status_check check (status in ('signed_up', 'waitlisted', 'withdrawn')),
  can_host boolean not null default false,
  seats smallint
    constraint dinner_parties_seats_check check (seats between 2 and 20),
  preferred_season_date_id uuid,
  kids_welcome boolean,
  access_notes text
    constraint dinner_parties_access_notes_check check (char_length(access_notes) <= 500),
  pets text
    constraint dinner_parties_pets_check check (char_length(pets) <= 200),
  withdrawn_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dinner_parties_host_seats_check check (not can_host or seats is not null),
  constraint dinner_parties_id_season_org_unique unique (id, season_id, org_id),
  constraint dinner_parties_season_fkey
    foreign key (season_id, group_id, org_id) references public.dinner_seasons (id, group_id, org_id) on delete cascade,
  constraint dinner_parties_preferred_date_fkey
    foreign key (preferred_season_date_id, season_id, org_id)
    references public.dinner_season_dates (id, season_id, org_id) on delete set null (preferred_season_date_id),
  constraint dinner_parties_created_by_fkey
    foreign key (created_by, org_id) references public.profiles (id, org_id) on delete set null (created_by)
);

comment on table public.dinner_parties is
  'One or two members who sign up together and are always seated together. A sign-up made after the tables are published is waitlisted; a withdrawn party keeps its past seats.';
comment on column public.dinner_parties.seats is
  'How many people fit at the host''s table, their own party included.';

create index dinner_parties_season_idx on public.dinner_parties (season_id, group_id, org_id);
create index dinner_parties_preferred_date_idx on public.dinner_parties (preferred_season_date_id);
create index dinner_parties_created_by_idx on public.dinner_parties (created_by);

create table public.dinner_party_members (
  party_id uuid not null,
  profile_id uuid not null,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  season_id uuid not null,
  group_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (party_id, profile_id),
  constraint dinner_party_members_one_party_per_season unique (season_id, profile_id),
  constraint dinner_party_members_party_fkey
    foreign key (party_id, season_id, org_id) references public.dinner_parties (id, season_id, org_id) on delete cascade,
  constraint dinner_party_members_season_fkey
    foreign key (season_id, group_id, org_id) references public.dinner_seasons (id, group_id, org_id) on delete cascade,
  constraint dinner_party_members_group_member_fkey
    foreign key (group_id, profile_id, org_id) references public.group_members (group_id, profile_id, org_id) on delete cascade
);

comment on table public.dinner_party_members is
  'The people in a party: one or two members of the group, each in one party per season. Leaving the group removes the person; a party left with nobody is deleted.';

create index dinner_party_members_profile_idx on public.dinner_party_members (profile_id);
create index dinner_party_members_group_member_idx on public.dinner_party_members (group_id, profile_id, org_id);
create index dinner_party_members_season_group_idx on public.dinner_party_members (season_id, group_id, org_id);

create table public.dinner_party_addresses (
  party_id uuid primary key,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  season_id uuid not null,
  group_id uuid not null,
  address_line1 text not null
    constraint dinner_party_addresses_line1_check check (char_length(btrim(address_line1)) between 1 and 200),
  address_line2 text
    constraint dinner_party_addresses_line2_check check (char_length(address_line2) <= 200),
  city text
    constraint dinner_party_addresses_city_check check (char_length(city) <= 100),
  state text
    constraint dinner_party_addresses_state_check check (char_length(state) <= 100),
  postal_code text
    constraint dinner_party_addresses_postal_code_check check (char_length(postal_code) <= 20),
  updated_at timestamptz not null default now(),
  constraint dinner_party_addresses_party_fkey
    foreign key (party_id, season_id, org_id) references public.dinner_parties (id, season_id, org_id) on delete cascade,
  constraint dinner_party_addresses_season_fkey
    foreign key (season_id, group_id, org_id) references public.dinner_seasons (id, group_id, org_id) on delete cascade
);

comment on table public.dinner_party_addresses is
  'Where a hosting party''s dinners are. Private: readable by the party, the group''s leaders and the parties seated at a table one of its dinners is at, never before publish.';

create index dinner_party_addresses_party_season_idx on public.dinner_party_addresses (party_id, season_id, org_id);
create index dinner_party_addresses_season_idx on public.dinner_party_addresses (season_id, group_id, org_id);

create table public.dinner_party_notes (
  party_id uuid primary key,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  season_id uuid not null,
  group_id uuid not null,
  food_notes text not null
    constraint dinner_party_notes_food_notes_check check (char_length(btrim(food_notes)) between 1 and 500),
  updated_at timestamptz not null default now(),
  constraint dinner_party_notes_party_fkey
    foreign key (party_id, season_id, org_id) references public.dinner_parties (id, season_id, org_id) on delete cascade,
  constraint dinner_party_notes_season_fkey
    foreign key (season_id, group_id, org_id) references public.dinner_seasons (id, group_id, org_id) on delete cascade
);

comment on table public.dinner_party_notes is
  'A party''s allergies and food needs. Private: readable by the party, the group''s leaders and the host of a dinner the party is seated at.';

create index dinner_party_notes_party_season_idx on public.dinner_party_notes (party_id, season_id, org_id);
create index dinner_party_notes_season_idx on public.dinner_party_notes (season_id, group_id, org_id);

create table public.dinner_party_unavailable_dates (
  party_id uuid not null,
  season_date_id uuid not null,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  season_id uuid not null,
  group_id uuid not null,
  primary key (party_id, season_date_id),
  constraint dinner_party_unavailable_dates_party_fkey
    foreign key (party_id, season_id, org_id) references public.dinner_parties (id, season_id, org_id) on delete cascade,
  constraint dinner_party_unavailable_dates_date_fkey
    foreign key (season_date_id, season_id, org_id) references public.dinner_season_dates (id, season_id, org_id) on delete cascade,
  constraint dinner_party_unavailable_dates_season_fkey
    foreign key (season_id, group_id, org_id) references public.dinner_seasons (id, group_id, org_id) on delete cascade
);

comment on table public.dinner_party_unavailable_dates is
  'Dates a hosting party can''t host, for a season whose tables change each dinner.';

create index dinner_party_unavailable_dates_party_idx on public.dinner_party_unavailable_dates (party_id, season_id, org_id);
create index dinner_party_unavailable_dates_date_idx on public.dinner_party_unavailable_dates (season_date_id, season_id, org_id);
create index dinner_party_unavailable_dates_season_idx on public.dinner_party_unavailable_dates (season_id, group_id, org_id);

create table public.dinner_drafts (
  season_id uuid primary key,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  group_id uuid not null,
  body jsonb not null,
  updated_at timestamptz not null default now(),
  constraint dinner_drafts_season_fkey
    foreign key (season_id, group_id, org_id) references public.dinner_seasons (id, group_id, org_id) on delete cascade
);

comment on table public.dinner_drafts is
  'The leaders'' unpublished tables for a season, in the shape lib/dinnerClub/shuffle.ts builds. dinner_tables_publish() reads this row, never a payload from the caller, and deletes it.';

create index dinner_drafts_season_group_idx on public.dinner_drafts (season_id, group_id, org_id);

create table public.dinner_tables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  season_id uuid not null,
  group_id uuid not null,
  season_date_id uuid,
  position smallint not null,
  created_at timestamptz not null default now(),
  constraint dinner_tables_id_season_org_unique unique (id, season_id, org_id),
  constraint dinner_tables_season_fkey
    foreign key (season_id, group_id, org_id) references public.dinner_seasons (id, group_id, org_id) on delete cascade,
  constraint dinner_tables_date_fkey
    foreign key (season_date_id, season_id, org_id) references public.dinner_season_dates (id, season_id, org_id) on delete cascade
);

comment on table public.dinner_tables is
  'A published table. season_date_id is set when the season''s tables change each dinner, and null when a table keeps its parties all season. Written only by dinner_tables_publish().';

create index dinner_tables_season_idx on public.dinner_tables (season_id, group_id, org_id);
create index dinner_tables_date_idx on public.dinner_tables (season_date_id, season_id, org_id);

create table public.dinner_seats (
  table_id uuid not null,
  party_id uuid not null,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  season_id uuid not null,
  group_id uuid not null,
  seated_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (table_id, party_id),
  constraint dinner_seats_table_party_org_unique unique (table_id, party_id, org_id),
  constraint dinner_seats_table_fkey
    foreign key (table_id, season_id, org_id) references public.dinner_tables (id, season_id, org_id) on delete cascade,
  constraint dinner_seats_party_fkey
    foreign key (party_id, season_id, org_id) references public.dinner_parties (id, season_id, org_id) on delete cascade,
  constraint dinner_seats_season_fkey
    foreign key (season_id, group_id, org_id) references public.dinner_seasons (id, group_id, org_id) on delete cascade
);

comment on table public.dinner_seats is
  'A party seated at a table. left_at is set when the party withdraws: it frees the party''s place at later dinners and keeps the record of who shared a table.';

create index dinner_seats_party_idx on public.dinner_seats (party_id, season_id, org_id);
create index dinner_seats_table_season_idx on public.dinner_seats (table_id, season_id, org_id);
create index dinner_seats_season_idx on public.dinner_seats (season_id, group_id, org_id);

create table public.dinners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  season_id uuid not null,
  group_id uuid not null,
  table_id uuid not null,
  season_date_id uuid not null,
  starts_at timestamptz not null,
  host_party_id uuid,
  host_unavailable boolean not null default false,
  follows_season_date boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dinners_table_date_unique unique (table_id, season_date_id),
  constraint dinners_id_org_unique unique (id, org_id),
  constraint dinners_id_table_org_unique unique (id, table_id, org_id),
  constraint dinners_id_table_season_org_unique unique (id, table_id, season_id, group_id, org_id),
  constraint dinners_table_fkey
    foreign key (table_id, season_id, org_id) references public.dinner_tables (id, season_id, org_id) on delete cascade,
  constraint dinners_date_fkey
    foreign key (season_date_id, season_id, org_id) references public.dinner_season_dates (id, season_id, org_id) on delete cascade,
  constraint dinners_season_fkey
    foreign key (season_id, group_id, org_id) references public.dinner_seasons (id, group_id, org_id) on delete cascade,
  -- The host is always a party seated at the table.
  constraint dinners_host_seat_fkey
    foreign key (table_id, host_party_id, org_id)
    references public.dinner_seats (table_id, party_id, org_id) on delete set null (host_party_id)
);

comment on table public.dinners is
  'One table''s one date. Not an events row, so it never reaches the group calendar. The host of the dinner or a leader can move it within the season; moving it clears its replies.';
comment on column public.dinners.host_party_id is
  'Who hosts this one dinner. Set per dinner, so another party at the table can host one date.';
comment on column public.dinners.host_unavailable is
  'The host said they can''t host this dinner.';
comment on column public.dinners.follows_season_date is
  'False once the dinner is moved on its own; moving its season date then leaves it where it is.';

create index dinners_season_starts_idx on public.dinners (season_id, starts_at);
create index dinners_season_group_idx on public.dinners (season_id, group_id, org_id);
create index dinners_table_season_idx on public.dinners (table_id, season_id, org_id);
create index dinners_date_idx on public.dinners (season_date_id, season_id, org_id);
create index dinners_host_idx on public.dinners (table_id, host_party_id, org_id);
create index dinners_org_starts_idx on public.dinners (org_id, starts_at);

create table public.dinner_replies (
  dinner_id uuid not null,
  profile_id uuid not null,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  status text not null
    constraint dinner_replies_status_check check (status in ('going', 'not_going')),
  replied_by uuid,
  updated_at timestamptz not null default now(),
  primary key (dinner_id, profile_id),
  constraint dinner_replies_dinner_fkey
    foreign key (dinner_id, org_id) references public.dinners (id, org_id) on delete cascade,
  constraint dinner_replies_profile_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade,
  constraint dinner_replies_replied_by_fkey
    foreign key (replied_by, org_id) references public.profiles (id, org_id) on delete set null (replied_by)
);

comment on table public.dinner_replies is
  'Each person''s Going or Not going for one dinner, given by them or their partner, until the dinner starts.';

create index dinner_replies_dinner_org_idx on public.dinner_replies (dinner_id, org_id);
create index dinner_replies_profile_idx on public.dinner_replies (profile_id, org_id);
create index dinner_replies_replied_by_idx on public.dinner_replies (replied_by, org_id);

create table public.dinner_contributions (
  dinner_id uuid not null,
  party_id uuid not null,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  season_id uuid not null,
  group_id uuid not null,
  table_id uuid not null,
  item text not null
    constraint dinner_contributions_item_check check (char_length(btrim(item)) between 1 and 60),
  updated_at timestamptz not null default now(),
  primary key (dinner_id, party_id),
  -- Ties season_id and group_id to the dinner's own, which the leader policy trusts.
  constraint dinner_contributions_dinner_fkey
    foreign key (dinner_id, table_id, season_id, group_id, org_id)
    references public.dinners (id, table_id, season_id, group_id, org_id) on delete cascade,
  constraint dinner_contributions_seat_fkey
    foreign key (table_id, party_id, org_id) references public.dinner_seats (table_id, party_id, org_id) on delete cascade,
  constraint dinner_contributions_season_fkey
    foreign key (season_id, group_id, org_id) references public.dinner_seasons (id, group_id, org_id) on delete cascade
);

comment on table public.dinner_contributions is
  'What a guest party brings to one dinner, set by its host or a leader. The party is always seated at the dinner''s table.';

create index dinner_contributions_dinner_idx on public.dinner_contributions (dinner_id, table_id, season_id, group_id, org_id);
create index dinner_contributions_seat_idx on public.dinner_contributions (table_id, party_id, org_id);
create index dinner_contributions_season_idx on public.dinner_contributions (season_id, group_id, org_id);

create table public.dinner_feed_tokens (
  profile_id uuid primary key,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint dinner_feed_tokens_profile_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade
);

comment on table public.dinner_feed_tokens is
  'A person''s private dinner club calendar link: the SHA-256 of its token. Minting again replaces the hash, which ends the old link.';

create index dinner_feed_tokens_profile_org_idx on public.dinner_feed_tokens (profile_id, org_id);
create index dinner_feed_tokens_org_idx on public.dinner_feed_tokens (org_id);

-- The reminder's sent record, as for event reminders: a pass is one dinner
-- on one local date, and its sends are fixed when the pass starts. A moved
-- dinner lands on a new date and so gets a new pass.
create table public.dinner_reminder_passes (
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  dinner_id uuid not null,
  dinner_date date not null,
  started_at timestamptz not null default now(),
  primary key (dinner_id, dinner_date),
  unique (dinner_id, dinner_date, org_id),
  constraint dinner_reminder_passes_dinner_fkey
    foreign key (dinner_id, org_id) references public.dinners (id, org_id) on delete cascade
);

create table public.dinner_reminder_sends (
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  dinner_id uuid not null,
  dinner_date date not null,
  profile_id uuid not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  primary key (dinner_id, dinner_date, profile_id),
  constraint dinner_reminder_sends_pass_fkey
    foreign key (dinner_id, dinner_date, org_id)
    references public.dinner_reminder_passes (dinner_id, dinner_date, org_id) on delete cascade,
  constraint dinner_reminder_sends_profile_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade
);

comment on table public.dinner_reminder_passes is
  'One dinner reminder pass per dinner and local date. Its existence means that reminder is handled. Read and written by the service key only.';
comment on table public.dinner_reminder_sends is
  'One person''s dinner reminder in a pass: claimed_at while a send is in flight, sent_at once Resend accepted it. Read and written by the service key only.';

create index dinner_reminder_passes_dinner_org_idx on public.dinner_reminder_passes (dinner_id, org_id);
create index dinner_reminder_passes_org_date_idx on public.dinner_reminder_passes (org_id, dinner_date);
create index dinner_reminder_sends_profile_idx on public.dinner_reminder_sends (profile_id, org_id);

-- ── Row security ────────────────────────────────────────────────────────────
alter table public.dinner_seasons enable row level security;
alter table public.dinner_season_dates enable row level security;
alter table public.dinner_parties enable row level security;
alter table public.dinner_party_members enable row level security;
alter table public.dinner_party_addresses enable row level security;
alter table public.dinner_party_notes enable row level security;
alter table public.dinner_party_unavailable_dates enable row level security;
alter table public.dinner_drafts enable row level security;
alter table public.dinner_tables enable row level security;
alter table public.dinner_seats enable row level security;
alter table public.dinners enable row level security;
alter table public.dinner_replies enable row level security;
alter table public.dinner_contributions enable row level security;
alter table public.dinner_feed_tokens enable row level security;
alter table public.dinner_reminder_passes enable row level security;
alter table public.dinner_reminder_sends enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'dinner_seasons', 'dinner_season_dates', 'dinner_parties', 'dinner_party_members',
    'dinner_party_addresses', 'dinner_party_notes', 'dinner_party_unavailable_dates',
    'dinner_drafts', 'dinner_tables', 'dinner_seats', 'dinners', 'dinner_replies',
    'dinner_contributions', 'dinner_feed_tokens', 'dinner_reminder_passes', 'dinner_reminder_sends'
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
create function public.dinner_my_party_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(pm.party_id), '{}')
  from public.dinner_party_members pm
  join public.profiles p on p.id = pm.profile_id and p.org_id = pm.org_id
  where pm.profile_id = auth.uid()
    and pm.org_id = public.app_current_org_id()
    and p.role <> 'pending';
$$;

create function public.dinner_my_party_profile_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(distinct pm.profile_id), '{}')
  from public.dinner_party_members pm
  where pm.org_id = public.app_current_org_id()
    and pm.party_id = any (public.dinner_my_party_ids());
$$;

create function public.dinner_my_table_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(distinct s.table_id), '{}')
  from public.dinner_seats s
  where s.org_id = public.app_current_org_id()
    and s.left_at is null
    and s.party_id = any (public.dinner_my_party_ids());
$$;

create function public.dinner_tablemate_party_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(distinct s.party_id), '{}')
  from public.dinner_seats s
  where s.org_id = public.app_current_org_id()
    and s.left_at is null
    and s.table_id = any (public.dinner_my_table_ids());
$$;

create function public.dinner_address_party_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(distinct d.host_party_id), '{}')
  from public.dinners d
  join public.dinner_seats hs on hs.table_id = d.table_id and hs.party_id = d.host_party_id
   and hs.org_id = d.org_id and hs.left_at is null
  where d.org_id = public.app_current_org_id()
    and d.table_id = any (public.dinner_my_table_ids());
$$;

create function public.dinner_food_note_party_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(distinct s.party_id), '{}')
  from public.dinners d
  join public.dinner_seats s on s.table_id = d.table_id and s.org_id = d.org_id and s.left_at is null
  join public.dinner_seats hs on hs.table_id = d.table_id and hs.party_id = d.host_party_id
   and hs.org_id = d.org_id and hs.left_at is null
  where d.org_id = public.app_current_org_id()
    and d.host_party_id = any (public.dinner_my_party_ids());
$$;

comment on function public.dinner_my_party_ids() is
  'The parties the caller is in, in their own org; none while pending. Policy helper.';
comment on function public.dinner_my_party_profile_ids() is
  'The caller and their partners: everyone in the caller''s parties. Policy helper.';
comment on function public.dinner_my_table_ids() is
  'The tables the caller''s parties are seated at and have not left. Policy helper.';
comment on function public.dinner_tablemate_party_ids() is
  'The parties seated at the caller''s tables. Policy helper.';
comment on function public.dinner_address_party_ids() is
  'The parties hosting a dinner at one of the caller''s tables and still seated there: the addresses the caller may read. Policy helper.';
comment on function public.dinner_food_note_party_ids() is
  'The parties seated at a table where the caller''s party hosts a dinner: the food notes the caller may read. Policy helper.';

do $$
declare f text;
begin
  foreach f in array array[
    'dinner_my_party_ids', 'dinner_my_party_profile_ids', 'dinner_my_table_ids',
    'dinner_tablemate_party_ids', 'dinner_address_party_ids', 'dinner_food_note_party_ids'
  ] loop
    execute format('revoke execute on function public.%I() from public, anon', f);
    execute format('grant execute on function public.%I() to authenticated', f);
  end loop;
end $$;

-- Seasons: members read all but a draft; leaders write, and delete a draft.
create policy "Members read seasons" on public.dinner_seasons
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id) or (status <> 'draft' and public.is_group_member(group_id))));
create policy "Leaders add seasons" on public.dinner_seasons
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Leaders edit seasons" on public.dinner_seasons
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Leaders delete draft seasons" on public.dinner_seasons
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id) and status = 'draft');

create policy "Members read season dates" on public.dinner_season_dates
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id)
      or (public.is_group_member(group_id)
        and exists (select 1 from public.dinner_seasons s where s.id = season_id and s.status <> 'draft'))));
create policy "Leaders add season dates" on public.dinner_season_dates
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Leaders edit season dates" on public.dinner_season_dates
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Leaders delete season dates" on public.dinner_season_dates
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- Parties: read by the party, the leaders and the parties at the same table.
create policy "Parties read by party, tablemates and leaders" on public.dinner_parties
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (id = any ((select public.dinner_my_party_ids())::uuid[])
      or public.is_group_leader(group_id)
      or id = any ((select public.dinner_tablemate_party_ids())::uuid[])));
create policy "Party or leaders edit a party" on public.dinner_parties
  for update to authenticated
  using (org_id = (select public.app_request_org_id())
    and (id = any ((select public.dinner_my_party_ids())::uuid[]) or public.is_group_leader(group_id)))
  with check (org_id = (select public.app_request_org_id())
    and (id = any ((select public.dinner_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));
create policy "Party or leaders delete a party" on public.dinner_parties
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and (id = any ((select public.dinner_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));

create policy "Party members read by party, tablemates and leaders" on public.dinner_party_members
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.dinner_my_party_ids())::uuid[])
      or public.is_group_leader(group_id)
      or party_id = any ((select public.dinner_tablemate_party_ids())::uuid[])));
create policy "Party or leaders add a party member" on public.dinner_party_members
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.dinner_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));
create policy "Party or leaders remove a party member" on public.dinner_party_members
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.dinner_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));

-- The two private tables.
create policy "Addresses read by party, its guests and leaders" on public.dinner_party_addresses
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.dinner_my_party_ids())::uuid[])
      or public.is_group_leader(group_id)
      or party_id = any ((select public.dinner_address_party_ids())::uuid[])));
create policy "Party or leaders write an address" on public.dinner_party_addresses
  for all to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.dinner_my_party_ids())::uuid[]) or public.is_group_leader(group_id)))
  with check (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.dinner_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));

create policy "Food notes read by party, its hosts and leaders" on public.dinner_party_notes
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.dinner_my_party_ids())::uuid[])
      or public.is_group_leader(group_id)
      or party_id = any ((select public.dinner_food_note_party_ids())::uuid[])));
create policy "Party or leaders write food notes" on public.dinner_party_notes
  for all to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.dinner_my_party_ids())::uuid[]) or public.is_group_leader(group_id)))
  with check (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.dinner_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));

create policy "Unavailable dates read by party, tablemates and leaders" on public.dinner_party_unavailable_dates
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.dinner_my_party_ids())::uuid[])
      or public.is_group_leader(group_id)
      or party_id = any ((select public.dinner_tablemate_party_ids())::uuid[])));
create policy "Party or leaders write unavailable dates" on public.dinner_party_unavailable_dates
  for all to authenticated
  using (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.dinner_my_party_ids())::uuid[]) or public.is_group_leader(group_id)))
  with check (org_id = (select public.app_request_org_id())
    and (party_id = any ((select public.dinner_my_party_ids())::uuid[]) or public.is_group_leader(group_id)));

create policy "Leaders keep drafts" on public.dinner_drafts
  for all to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- Published tables: read by the parties at them and the leaders. Written
-- only by dinner_tables_publish().
create policy "Tables read by their parties and leaders" on public.dinner_tables
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id) or id = any ((select public.dinner_my_table_ids())::uuid[])));
create policy "Seats read by their tables and leaders" on public.dinner_seats
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id) or table_id = any ((select public.dinner_my_table_ids())::uuid[])));

create policy "Dinners read by their tables and leaders" on public.dinners
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id) or table_id = any ((select public.dinner_my_table_ids())::uuid[])));
create policy "Host or leaders change a dinner" on public.dinners
  for update to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id) or host_party_id = any ((select public.dinner_my_party_ids())::uuid[])))
  with check (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id) or host_party_id = any ((select public.dinner_my_party_ids())::uuid[])));

create policy "Replies read with their dinner" on public.dinner_replies
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and exists (select 1 from public.dinners d where d.id = dinner_id));
create policy "A person or their partner replies" on public.dinner_replies
  for all to authenticated
  using (org_id = (select public.app_request_org_id())
    and profile_id = any ((select public.dinner_my_party_profile_ids())::uuid[]))
  with check (org_id = (select public.app_request_org_id())
    and profile_id = any ((select public.dinner_my_party_profile_ids())::uuid[]));

create policy "Contributions read with their dinner" on public.dinner_contributions
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and exists (select 1 from public.dinners d where d.id = dinner_id));
create policy "Host or leaders set contributions" on public.dinner_contributions
  for all to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id)
      or exists (select 1 from public.dinners d
        where d.id = dinner_id and d.host_party_id = any ((select public.dinner_my_party_ids())::uuid[]))))
  with check (org_id = (select public.app_request_org_id())
    and (public.is_group_leader(group_id)
      or exists (select 1 from public.dinners d
        where d.id = dinner_id and d.host_party_id = any ((select public.dinner_my_party_ids())::uuid[]))));

create policy "A person keeps their own feed link" on public.dinner_feed_tokens
  for all to authenticated
  using (org_id = (select public.app_request_org_id()) and profile_id = (select auth.uid()))
  with check (org_id = (select public.app_request_org_id()) and profile_id = (select auth.uid()));

-- What clients may write at all. Party rows are created by
-- dinner_party_create(), tables and seats only by dinner_tables_publish(),
-- and dinners are moved, never added or deleted, by a client.
revoke insert, update on public.dinner_parties from authenticated;
grant update (can_host, seats, preferred_season_date_id, kids_welcome, access_notes, pets, status)
  on public.dinner_parties to authenticated;
revoke update on public.dinner_party_members from authenticated;
revoke insert, update, delete on public.dinner_tables from authenticated;
revoke insert, update, delete on public.dinner_seats from authenticated;
revoke insert, update, delete on public.dinners from authenticated;
grant update (starts_at, host_party_id, host_unavailable) on public.dinners to authenticated;
revoke all on public.dinner_reminder_passes from authenticated;
revoke all on public.dinner_reminder_sends from authenticated;

-- ── Rules on writes ─────────────────────────────────────────────────────────
-- The guards below run as the caller. current_user is 'authenticated' for a
-- signed-in client and the function owner inside dinner_tables_publish(),
-- dinner_party_create() and a cascade, which do their own checks.

-- Whether a non-leader may still change their sign-up: the season takes
-- sign-ups and the church's today is on or before the close date.
create function public.dinner_signup_window_open(_season_id uuid) returns boolean
  language sql stable
  set search_path = ''
as $$
  select exists (
    select 1
    from public.dinner_seasons s
    join public.organizations o on o.id = s.org_id
    where s.id = _season_id
      and s.status = 'open'
      and (pg_catalog.now() at time zone o.timezone)::date <= s.signup_closes_on
  );
$$;

revoke execute on function public.dinner_signup_window_open(uuid) from public, anon;
grant execute on function public.dinner_signup_window_open(uuid) to authenticated;

create function public.dinner_seasons_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' and new.status <> 'draft' then
      raise exception 'a season starts as a draft' using errcode = 'DC003';
    end if;
    return new;
  end if;

  if new.group_id is distinct from old.group_id or new.org_id is distinct from old.org_id then
    raise exception 'a season stays in its group' using errcode = 'DC002';
  end if;

  if new.status is distinct from old.status then
    if current_user = 'authenticated'
      and not ((old.status = 'draft' and new.status = 'open') or (old.status = 'published' and new.status = 'ended')) then
      raise exception 'a season cannot go from % to %', old.status, new.status using errcode = 'DC003';
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
    raise exception 'a published season keeps its format, dates and table size' using errcode = 'DC003';
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger dinner_seasons_guard
  before insert or update on public.dinner_seasons
  for each row execute function public.dinner_seasons_guard();

create function public.dinner_season_dates_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  _season uuid := coalesce(new.season_id, old.season_id);
  _status text;
  _starts date;
  _ends date;
  _zone text;
begin
  select s.status, s.starts_on, s.ends_on, o.timezone into _status, _starts, _ends, _zone
  from public.dinner_seasons s
  join public.organizations o on o.id = s.org_id
  where s.id = _season;

  if _status = 'ended' then
    raise exception 'an ended season keeps its dates' using errcode = 'DC003';
  end if;
  if tg_op = 'DELETE' then
    -- Deleting the date deletes its dinners and their replies. A season being
    -- deleted is already gone here, so its dates still go with it.
    if _status is not null and exists (
      select 1 from public.dinners d
      where d.season_date_id = old.id and d.org_id = old.org_id and d.starts_at <= pg_catalog.now()
    ) then
      raise exception 'a date whose dinners have happened stays' using errcode = 'DC005';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.season_id is distinct from old.season_id then
    raise exception 'a date stays in its season' using errcode = 'DC002';
  end if;
  if (new.starts_at at time zone _zone)::date not between _starts and _ends then
    raise exception 'the date is outside the season' using errcode = 'DC004';
  end if;
  return new;
end;
$$;

create trigger dinner_season_dates_guard
  before insert or update or delete on public.dinner_season_dates
  for each row execute function public.dinner_season_dates_guard();

-- Moving a season date moves each table's dinner on it, except one already
-- moved on its own. Runs as the leader, through the dinners rules.
create function public.dinner_season_dates_carry() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  update public.dinners d
     set starts_at = new.starts_at
   where d.season_date_id = new.id
     and d.org_id = new.org_id
     and d.follows_season_date;
  return null;
end;
$$;

create trigger dinner_season_dates_carry
  after update of starts_at on public.dinner_season_dates
  for each row
  when (old.starts_at is distinct from new.starts_at)
  execute function public.dinner_season_dates_carry();

create function public.dinner_parties_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  _row public.dinner_parties := coalesce(new, old);
  _status text;
begin
  if current_user <> 'authenticated' then
    if tg_op = 'UPDATE' then
      new.updated_at := pg_catalog.now();
      return new;
    end if;
    return old;
  end if;

  select s.status into _status from public.dinner_seasons s where s.id = _row.season_id;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if new.status <> 'withdrawn' or _status not in ('open', 'published') then
        raise exception 'a party can only withdraw' using errcode = 'DC003';
      end if;
      new.withdrawn_at := pg_catalog.now();
    elsif public.is_group_leader(old.group_id) then
      if _status = 'ended' then
        raise exception 'an ended season keeps its parties' using errcode = 'DC003';
      end if;
    elsif not public.dinner_signup_window_open(old.season_id) then
      raise exception 'sign-ups are closed' using errcode = 'DC003';
    end if;
    new.updated_at := pg_catalog.now();
    return new;
  end if;

  if public.is_group_leader(old.group_id) then
    if _status not in ('draft', 'open') then
      raise exception 'a party at a published table withdraws instead' using errcode = 'DC003';
    end if;
  elsif not public.dinner_signup_window_open(old.season_id) then
    raise exception 'sign-ups are closed' using errcode = 'DC003';
  end if;
  return old;
end;
$$;

create trigger dinner_parties_guard
  before update or delete on public.dinner_parties
  for each row execute function public.dinner_parties_guard();

-- A withdrawn party leaves its tables from now on: its seats are marked
-- left, which frees them at later dinners and keeps them for earlier ones,
-- and its replies to dinners not yet held go.
create function public.dinner_party_withdrawn() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  update public.dinner_seats
     set left_at = pg_catalog.now()
   where party_id = new.id
     and org_id = new.org_id
     and left_at is null;

  delete from public.dinner_replies r
  using public.dinners d
  where r.dinner_id = d.id
    and r.org_id = new.org_id
    and d.org_id = new.org_id
    and d.season_id = new.season_id
    and d.starts_at > pg_catalog.now()
    and r.profile_id in (
      select pm.profile_id from public.dinner_party_members pm
      where pm.party_id = new.id and pm.org_id = new.org_id
    );
  return null;
end;
$$;

create trigger dinner_party_withdrawn
  after update of status on public.dinner_parties
  for each row
  when (new.status = 'withdrawn' and old.status is distinct from 'withdrawn')
  execute function public.dinner_party_withdrawn();

create function public.dinner_party_members_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  _row public.dinner_party_members := coalesce(new, old);
  _party_status text;
  _count integer;
begin
  if current_user <> 'authenticated' then
    return _row;
  end if;

  if not public.is_group_leader(_row.group_id) and not public.dinner_signup_window_open(_row.season_id) then
    raise exception 'sign-ups are closed' using errcode = 'DC003';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  select p.status into _party_status
  from public.dinner_parties p
  where p.id = new.party_id
  for update;

  if _party_status is distinct from 'signed_up' and _party_status is distinct from 'waitlisted' then
    raise exception 'the party has withdrawn' using errcode = 'DC003';
  end if;

  select count(*) into _count from public.dinner_party_members m where m.party_id = new.party_id;
  if _count >= 2 then
    raise exception 'a party is one or two people' using errcode = 'DC002';
  end if;

  if exists (select 1 from public.profiles p where p.id = new.profile_id and p.role = 'pending') then
    raise exception 'the person is not approved yet' using errcode = 'DC002';
  end if;
  return new;
end;
$$;

create trigger dinner_party_members_guard
  before insert or delete on public.dinner_party_members
  for each row execute function public.dinner_party_members_guard();

-- A party with nobody left in it goes, whoever removed the last person:
-- their partner, a leader, leaving the group or deleting the account.
create function public.dinner_party_drop_if_empty() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  delete from public.dinner_parties p
  where p.id = old.party_id
    and p.org_id = old.org_id
    and not exists (
      select 1 from public.dinner_party_members m
      where m.party_id = old.party_id and m.org_id = old.org_id
    );
  return null;
end;
$$;

create trigger dinner_party_drop_if_empty
  after delete on public.dinner_party_members
  for each row execute function public.dinner_party_drop_if_empty();

-- A party's address, food notes and dates it can't host follow the sign-up
-- window for its members; leaders may change them until the season ends.
create function public.dinner_party_detail_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  _season uuid := coalesce(new.season_id, old.season_id);
  _group uuid := coalesce(new.group_id, old.group_id);
begin
  if current_user = 'authenticated' then
    if public.is_group_leader(_group) then
      if exists (select 1 from public.dinner_seasons s where s.id = _season and s.status = 'ended') then
        raise exception 'an ended season keeps its parties' using errcode = 'DC003';
      end if;
    elsif not public.dinner_signup_window_open(_season) then
      raise exception 'sign-ups are closed' using errcode = 'DC003';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.party_id is distinct from old.party_id or new.season_id is distinct from old.season_id) then
    raise exception 'a detail stays with its party' using errcode = 'DC002';
  end if;
  return new;
end;
$$;

create trigger dinner_party_addresses_guard
  before insert or update or delete on public.dinner_party_addresses
  for each row execute function public.dinner_party_detail_guard();
create trigger dinner_party_notes_guard
  before insert or update or delete on public.dinner_party_notes
  for each row execute function public.dinner_party_detail_guard();
create trigger dinner_party_unavailable_dates_guard
  before insert or update or delete on public.dinner_party_unavailable_dates
  for each row execute function public.dinner_party_detail_guard();

create trigger dinner_party_addresses_touch_updated_at
  before update on public.dinner_party_addresses
  for each row execute function public.touch_updated_at();
create trigger dinner_party_notes_touch_updated_at
  before update on public.dinner_party_notes
  for each row execute function public.touch_updated_at();
create trigger dinner_drafts_touch_updated_at
  before update on public.dinner_drafts
  for each row execute function public.touch_updated_at();
create trigger dinner_contributions_touch_updated_at
  before update on public.dinner_contributions
  for each row execute function public.touch_updated_at();

create function public.dinners_guard() returns trigger
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
    or new.season_date_id is distinct from old.season_date_id
    or new.season_id is distinct from old.season_id
    or new.group_id is distinct from old.group_id then
    raise exception 'a dinner stays at its table and date' using errcode = 'DC002';
  end if;
  new.updated_at := pg_catalog.now();
  -- Depth 1 is a move of this dinner itself; the season-date carry runs nested.
  if new.starts_at is distinct from old.starts_at and pg_catalog.pg_trigger_depth() = 1 then
    new.follows_season_date := false;
  end if;

  if current_user <> 'authenticated' then
    return new;
  end if;

  select s.status, s.starts_on, s.ends_on, o.timezone into _status, _starts, _ends, _zone
  from public.dinner_seasons s
  join public.organizations o on o.id = s.org_id
  where s.id = new.season_id;

  if _status is distinct from 'published' then
    raise exception 'only a running season''s dinners change' using errcode = 'DC003';
  end if;

  if new.starts_at is distinct from old.starts_at
    and (old.starts_at <= pg_catalog.now()
      or new.starts_at <= pg_catalog.now()
      or (new.starts_at at time zone _zone)::date not between _starts and _ends) then
    raise exception 'the new date is outside the season or has passed' using errcode = 'DC004';
  end if;
  return new;
end;
$$;

create trigger dinners_guard
  before update on public.dinners
  for each row execute function public.dinners_guard();

-- A moved dinner asks everyone again. Definer: a host clears replies that
-- are not theirs to write.
create function public.dinner_moved_clear_replies() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  delete from public.dinner_replies r
  where r.dinner_id = new.id
    and r.org_id = new.org_id;
  return null;
end;
$$;

create trigger dinner_moved_clear_replies
  after update of starts_at on public.dinners
  for each row
  when (old.starts_at is distinct from new.starts_at)
  execute function public.dinner_moved_clear_replies();

-- A reply is for a person seated at the dinner's table, in a party that has
-- not withdrawn, given by them or by the other person in that same party,
-- while the season runs and before the dinner starts. The policy alone would
-- let someone who shared a party with them in another season reply.
create function public.dinner_replies_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  _dinner uuid := coalesce(new.dinner_id, old.dinner_id);
  _profile uuid := coalesce(new.profile_id, old.profile_id);
begin
  if tg_op = 'UPDATE' and (new.dinner_id is distinct from old.dinner_id or new.profile_id is distinct from old.profile_id) then
    raise exception 'a reply stays with its dinner and person' using errcode = 'DC002';
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
    from public.dinners d
    join public.dinner_seats st on st.table_id = d.table_id and st.left_at is null
    join public.dinner_parties p on p.id = st.party_id and p.status <> 'withdrawn'
    join public.dinner_party_members pm on pm.party_id = st.party_id
    join public.dinner_party_members me on me.party_id = st.party_id
    where d.id = _dinner
      and pm.profile_id = _profile
      and me.profile_id = auth.uid()
  ) then
    raise exception 'the person is not at this table' using errcode = 'DC001';
  end if;

  if not exists (
    select 1
    from public.dinners d
    join public.dinner_seasons s on s.id = d.season_id
    where d.id = _dinner
      and s.status = 'published'
      and d.starts_at > pg_catalog.now()
  ) then
    raise exception 'the dinner is not taking replies' using errcode = 'DC003';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger dinner_replies_guard
  before insert or update or delete on public.dinner_replies
  for each row execute function public.dinner_replies_guard();

do $$
declare f text;
begin
  foreach f in array array[
    'dinner_party_withdrawn', 'dinner_party_drop_if_empty', 'dinner_moved_clear_replies'
  ] loop
    execute format('revoke execute on function public.%I() from public, anon, authenticated', f);
  end loop;
end $$;

-- ── Sign up ─────────────────────────────────────────────────────────────────
-- A party and its people in one transaction. A member signs up a party they
-- are in; a leader signs up anyone in the group. After the tables are
-- published a sign-up is waitlisted. Tenant anchor: the season row's org,
-- pinned against app_request_org_id().
create function public.dinner_party_create(_season_id uuid, _profile_ids uuid[]) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  _org uuid := public.app_request_org_id();
  _season public.dinner_seasons;
  _ids uuid[];
  _leader boolean;
  _status text;
  _valid integer;
  _party uuid;
begin
  if _org is null then
    raise exception 'no season' using errcode = 'DC001';
  end if;

  -- Conflicts with publish's FOR UPDATE, so the status read is the one that commits.
  select * into _season from public.dinner_seasons s where s.id = _season_id for share;
  if _season.id is null or _season.org_id is distinct from _org then
    raise exception 'no season' using errcode = 'DC001';
  end if;

  _leader := public.is_group_leader(_season.group_id);
  if not _leader and not public.is_group_member(_season.group_id) then
    raise exception 'no season' using errcode = 'DC001';
  end if;

  _ids := array(select distinct x from unnest(_profile_ids) as x where x is not null);
  if cardinality(_ids) not between 1 and 2 or cardinality(_ids) <> cardinality(_profile_ids) then
    raise exception 'a party is one or two people' using errcode = 'DC002';
  end if;
  if not _leader and not (auth.uid() = any (_ids)) then
    raise exception 'sign up a party you are in' using errcode = 'DC001';
  end if;

  if _season.status = 'open' then
    if not _leader and not public.dinner_signup_window_open(_season.id) then
      raise exception 'sign-ups are closed' using errcode = 'DC003';
    end if;
    _status := 'signed_up';
  elsif _season.status = 'published' then
    _status := 'waitlisted';
  else
    raise exception 'the season is not taking sign-ups' using errcode = 'DC003';
  end if;

  select count(*) into _valid
  from public.group_members gm
  join public.profiles p on p.id = gm.profile_id and p.org_id = gm.org_id
  where gm.org_id = _org
    and gm.group_id = _season.group_id
    and gm.profile_id = any (_ids)
    and p.role <> 'pending';
  if _valid <> cardinality(_ids) then
    raise exception 'everyone in a party is in the group' using errcode = 'DC002';
  end if;

  insert into public.dinner_parties (org_id, season_id, group_id, status, created_by)
  values (_org, _season.id, _season.group_id, _status, auth.uid())
  returning id into _party;

  insert into public.dinner_party_members (org_id, party_id, season_id, group_id, profile_id)
  select _org, _party, _season.id, _season.group_id, x
  from unnest(_ids) as x;

  return _party;
end;
$$;

revoke execute on function public.dinner_party_create(uuid, uuid[]) from public, anon;
grant execute on function public.dinner_party_create(uuid, uuid[]) to authenticated;

comment on function public.dinner_party_create(uuid, uuid[]) is
  'Signs up a party of one or two people for a season. Actor from auth.uid(); tenant anchor: the season row''s org, pinned against app_request_org_id(). A member must be in the party; a leader may sign up any member of the group. Raises DC001, DC002, DC003, or 23505 when someone is already in a party this season.';

-- Replacing a list is one transaction, so a failed insert keeps the old rows.
-- A date kept in the list keeps its id, and with it the preferences and
-- can't-host dates that point at it. The season row lock serializes two
-- leaders replacing at once. Invoker: the table rules and guards apply.
create function public.dinner_season_dates_replace(_season_id uuid, _starts_at timestamptz[])
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
  from public.dinner_seasons s where s.id = _season_id
  for update;
  if _group is null then
    raise exception 'no season' using errcode = 'DC001';
  end if;
  if _status not in ('draft', 'open') then
    raise exception 'a published season changes one date at a time' using errcode = 'DC003';
  end if;
  delete from public.dinner_season_dates sd
  where sd.season_id = _season_id and not (sd.starts_at = any (_list));
  insert into public.dinner_season_dates (season_id, group_id, starts_at)
  select _season_id, _group, x
  from (select distinct x from unnest(_list) as x) as l
  where not exists (
    select 1 from public.dinner_season_dates sd where sd.season_id = _season_id and sd.starts_at = l.x
  );
  select count(*)::integer into _n
  from public.dinner_season_dates sd
  where sd.season_id = _season_id and sd.starts_at = any (_list);
  return _n;
end;
$$;

create function public.dinner_party_unavailable_dates_replace(_party_id uuid, _season_date_ids uuid[])
  returns integer
  language plpgsql security invoker
  set search_path = ''
as $$
declare
  _season uuid;
  _group uuid;
  _n integer;
begin
  -- The lock makes a second save wait and then replace this one's list.
  select p.season_id, p.group_id into _season, _group from public.dinner_parties p where p.id = _party_id
  for update;
  if _season is null then
    raise exception 'no party' using errcode = 'DC001';
  end if;
  delete from public.dinner_party_unavailable_dates u where u.party_id = _party_id;
  insert into public.dinner_party_unavailable_dates (party_id, season_date_id, season_id, group_id)
  select _party_id, x, _season, _group from unnest(coalesce(_season_date_ids, '{}')) as x;
  get diagnostics _n = row_count;
  return _n;
end;
$$;

revoke execute on function public.dinner_season_dates_replace(uuid, timestamptz[]) from public, anon;
grant execute on function public.dinner_season_dates_replace(uuid, timestamptz[]) to authenticated;
revoke execute on function public.dinner_party_unavailable_dates_replace(uuid, uuid[]) from public, anon;
grant execute on function public.dinner_party_unavailable_dates_replace(uuid, uuid[]) to authenticated;

comment on function public.dinner_season_dates_replace(uuid, timestamptz[]) is
  'Replaces a draft or open season''s dates in one transaction, keeping the id of each date still listed, and returns how many dates the season now has from the list. Raises DC003 once the season is published. Security invoker: the season dates rules decide who may.';
comment on function public.dinner_party_unavailable_dates_replace(uuid, uuid[]) is
  'Replaces the dates a party can''t host in one transaction and returns how many it added. Security invoker: the unavailable dates rules decide who may.';

-- ── Publish ─────────────────────────────────────────────────────────────────
-- For each person seated this season, what their dinners look like: each
-- date's host and who else is at the table. Publish compares it before and
-- after to name the people whose tables changed.
create function public.dinner_seat_signatures(_season_id uuid, _org_id uuid) returns jsonb
  language sql stable
  set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.profile_id, x.sig), '{}'::jsonb)
  from (
    select pm.profile_id,
           string_agg(
             d.season_date_id::text || ':' || coalesce(d.host_party_id::text, '-') || ':' || (
               select string_agg(st2.party_id::text, ',' order by st2.party_id)
               from public.dinner_seats st2
               where st2.table_id = d.table_id and st2.org_id = _org_id and st2.left_at is null
             ),
             ';' order by d.season_date_id
           ) as sig
    from public.dinner_party_members pm
    join public.dinner_seats st on st.party_id = pm.party_id and st.org_id = _org_id and st.left_at is null
    join public.dinners d on d.table_id = st.table_id and d.org_id = _org_id
    where pm.season_id = _season_id
      and pm.org_id = _org_id
    group by pm.profile_id
  ) x;
$$;

revoke execute on function public.dinner_seat_signatures(uuid, uuid) from public, anon, authenticated;

create function public.dinner_tables_publish(_season_id uuid) returns table (profile_id uuid)
  language plpgsql security definer
  set search_path = ''
as $$
declare
  _org uuid := public.app_request_org_id();
  _season public.dinner_seasons;
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
    raise exception 'no season' using errcode = 'DC001';
  end if;

  select * into _season from public.dinner_seasons s where s.id = _season_id for update;
  if _season.id is null or _season.org_id is distinct from _org or not public.is_group_leader(_season.group_id) then
    raise exception 'no season' using errcode = 'DC001';
  end if;
  if _season.status not in ('open', 'published') then
    raise exception 'the season is not ready for tables' using errcode = 'DC003';
  end if;

  -- A withdrawal updates its party row, so it either lands before the checks
  -- below or waits for publish and then closes the seats it wrote.
  perform 1 from public.dinner_parties p
   where p.season_id = _season.id and p.org_id = _org
   order by p.id
   for share;

  select d.body into _body from public.dinner_drafts d
   where d.season_id = _season.id and d.org_id = _org
   for update;
  if _body is null or jsonb_typeof(_body -> 'tables') is distinct from 'array'
    or jsonb_array_length(_body -> 'tables') = 0 then
    raise exception 'there is no draft to publish' using errcode = 'DC002';
  end if;

  -- Every table lists parties of this season that have not withdrawn. Ids
  -- are checked before anything below casts them.
  if exists (
    select 1
    from jsonb_array_elements(_body -> 'tables') t
    where jsonb_typeof(t -> 'partyIds') is distinct from 'array'
      or jsonb_array_length(t -> 'partyIds') = 0
      or jsonb_typeof(t -> 'hosts') is distinct from 'array'
      or coalesce(t ->> 'tableId', '') !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
      or coalesce(t ->> 'seasonDateId', '') !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
      or exists (
        select 1 from jsonb_array_elements(t -> 'partyIds') pid
        where jsonb_typeof(pid) is distinct from 'string'
          or (pid #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
      or exists (
        select 1 from jsonb_array_elements(t -> 'hosts') h
        where coalesce(h ->> 'seasonDateId', '') !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
          or coalesce(h ->> 'partyId', '') !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
      )
  ) or exists (
    select 1
    from jsonb_array_elements(_body -> 'tables') t,
         jsonb_array_elements_text(t -> 'partyIds') pid
    where not exists (
      select 1 from public.dinner_parties p
      where p.id = pid::uuid and p.season_id = _season.id and p.org_id = _org
        and p.status in ('signed_up', 'waitlisted')
    )
  ) then
    raise exception 'a table lists a party not signed up this season' using errcode = 'DC002';
  end if;

  -- A table already published keeps its date.
  if exists (
    select 1
    from jsonb_array_elements(_body -> 'tables') t
    where nullif(t ->> 'tableId', '') is not null
      and not exists (
        select 1 from public.dinner_tables dt
        where dt.id = (t ->> 'tableId')::uuid and dt.season_id = _season.id and dt.org_id = _org
          and dt.season_date_id is not distinct from nullif(t ->> 'seasonDateId', '')::uuid
      )
  ) then
    raise exception 'a table is not one of this season''s' using errcode = 'DC002';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(_body -> 'tables') t
    where nullif(t ->> 'tableId', '') is not null
    group by (t ->> 'tableId')::uuid
    having count(*) > 1
  ) then
    raise exception 'a table is listed twice' using errcode = 'DC002';
  end if;

  if _season.format = 'new_tables' then
    if exists (
      select 1 from jsonb_array_elements(_body -> 'tables') t
      where not exists (
        select 1 from public.dinner_season_dates sd
        where sd.id = nullif(t ->> 'seasonDateId', '')::uuid and sd.season_id = _season.id and sd.org_id = _org
      )
    ) or exists (
      select 1
      from jsonb_array_elements(_body -> 'tables') t,
           jsonb_array_elements_text(t -> 'partyIds') pid
      group by nullif(t ->> 'seasonDateId', '')::uuid, pid::uuid
      having count(*) > 1
    ) or exists (
      select 1 from public.dinner_season_dates sd
      where sd.season_id = _season.id and sd.org_id = _org
        and not exists (
          select 1 from jsonb_array_elements(_body -> 'tables') t
          where nullif(t ->> 'seasonDateId', '')::uuid = sd.id
        )
    ) then
      raise exception 'every date has tables, and each date''s tables seat each party once' using errcode = 'DC002';
    end if;
  else
    if exists (
      select 1 from jsonb_array_elements(_body -> 'tables') t
      where nullif(t ->> 'seasonDateId', '') is not null
    ) or exists (
      select 1
      from jsonb_array_elements(_body -> 'tables') t,
           jsonb_array_elements_text(t -> 'partyIds') pid
      group by pid::uuid
      having count(*) > 1
    ) then
      raise exception 'each party sits at one table all season' using errcode = 'DC002';
    end if;
  end if;

  if not exists (select 1 from public.dinner_season_dates sd where sd.season_id = _season.id and sd.org_id = _org) then
    raise exception 'the season has no dates' using errcode = 'DC002';
  end if;

  -- Each table has exactly one host for each of its dates: every season date
  -- for a table kept all season, its own date otherwise. The host is a party
  -- at the table that offered to host.
  if exists (
    select 1
    from jsonb_array_elements(_body -> 'tables') t
    join public.dinner_season_dates sd
      on sd.season_id = _season.id and sd.org_id = _org
     and (_season.format <> 'new_tables' or sd.id = nullif(t ->> 'seasonDateId', '')::uuid)
    where (
      select count(*) from jsonb_array_elements(t -> 'hosts') h
      where nullif(h ->> 'seasonDateId', '')::uuid = sd.id and nullif(h ->> 'partyId', '') is not null
    ) <> 1
  ) or exists (
    select 1
    from jsonb_array_elements(_body -> 'tables') t,
         jsonb_array_elements(t -> 'hosts') h
    where nullif(h ->> 'partyId', '') is not null
      and (
        not ((t -> 'partyIds') ? (h ->> 'partyId'))
        or not exists (
          select 1 from public.dinner_parties p
          where p.id = (h ->> 'partyId')::uuid and p.season_id = _season.id and p.org_id = _org and p.can_host
        )
        or not exists (
          select 1 from public.dinner_season_dates sd
          where sd.id = nullif(h ->> 'seasonDateId', '')::uuid and sd.season_id = _season.id and sd.org_id = _org
            and (_season.format <> 'new_tables' or sd.id = nullif(t ->> 'seasonDateId', '')::uuid)
        )
      )
  ) then
    raise exception 'each dinner needs one host from its table' using errcode = 'DC002';
  end if;

  -- A dinner that has happened keeps its table and host: dropping the table
  -- would delete the dinner and its replies.
  if exists (
    select 1 from public.dinners d
    where d.season_id = _season.id and d.org_id = _org and d.starts_at <= pg_catalog.now()
      and not exists (
        select 1
        from jsonb_array_elements(_body -> 'tables') t,
             jsonb_array_elements(t -> 'hosts') h
        where nullif(t ->> 'tableId', '')::uuid = d.table_id
          and nullif(h ->> 'seasonDateId', '')::uuid = d.season_date_id
          and nullif(h ->> 'partyId', '')::uuid is not distinct from d.host_party_id
      )
  ) then
    raise exception 'a dinner that has happened keeps its table and host' using errcode = 'DC005';
  end if;

  _before := public.dinner_seat_signatures(_season.id, _org);

  update public.dinner_seasons
     set status = 'published', published_at = coalesce(published_at, pg_catalog.now())
   where id = _season.id and org_id = _org;
  get diagnostics _n = row_count;
  if _n <> 1 then
    raise exception 'the season could not be published' using errcode = 'DC003';
  end if;

  for _entry, _ord in
    select t, o from jsonb_array_elements(_body -> 'tables') with ordinality as x(t, o)
  loop
    _table := nullif(_entry ->> 'tableId', '')::uuid;
    if _table is null then
      insert into public.dinner_tables (org_id, season_id, group_id, season_date_id, position)
      values (_org, _season.id, _season.group_id, nullif(_entry ->> 'seasonDateId', '')::uuid, _ord)
      returning id into _table;
    else
      update public.dinner_tables set position = _ord
       where id = _table and season_id = _season.id and org_id = _org;
      get diagnostics _n = row_count;
      if _n <> 1 then
        raise exception 'a table is not one of this season''s' using errcode = 'DC002';
      end if;
    end if;
    _kept := _kept || _table;

    _party_ids := array(select x::uuid from jsonb_array_elements_text(_entry -> 'partyIds') as x);
    delete from public.dinner_seats st
     where st.table_id = _table and st.org_id = _org and st.left_at is null
       and not (st.party_id = any (_party_ids));
    insert into public.dinner_seats (org_id, table_id, party_id, season_id, group_id)
    select _org, _table, x, _season.id, _season.group_id from unnest(_party_ids) as x
    on conflict (table_id, party_id) do nothing;

    _host_dates := array(
      select (h ->> 'seasonDateId')::uuid from jsonb_array_elements(_entry -> 'hosts') h
      where nullif(h ->> 'partyId', '') is not null
    );
    insert into public.dinners as dn (org_id, season_id, group_id, table_id, season_date_id, starts_at, host_party_id)
    select _org, _season.id, _season.group_id, _table, sd.id, sd.starts_at, (h ->> 'partyId')::uuid
    from jsonb_array_elements(_entry -> 'hosts') h
    join public.dinner_season_dates sd
      on sd.id = (h ->> 'seasonDateId')::uuid and sd.season_id = _season.id and sd.org_id = _org
    where nullif(h ->> 'partyId', '') is not null
    on conflict (table_id, season_date_id) do update
      set host_party_id = excluded.host_party_id, host_unavailable = false
      where dn.host_party_id is distinct from excluded.host_party_id;
    delete from public.dinners d
     where d.table_id = _table and d.org_id = _org
       and not (d.season_date_id = any (_host_dates));
  end loop;

  delete from public.dinner_tables dt
   where dt.season_id = _season.id and dt.org_id = _org
     and not (dt.id = any (_kept));

  -- Someone no longer at a dinner's table has no reply to it. A dinner that
  -- has happened keeps its replies, as it does on withdrawal.
  delete from public.dinner_replies r
  using public.dinners d
  where r.dinner_id = d.id
    and r.org_id = _org
    and d.org_id = _org
    and d.season_id = _season.id
    and d.starts_at > pg_catalog.now()
    and not exists (
      select 1
      from public.dinner_seats st
      join public.dinner_party_members pm on pm.party_id = st.party_id and pm.org_id = _org
      where st.table_id = d.table_id and st.org_id = _org and st.left_at is null
        and pm.profile_id = r.profile_id
    );

  update public.dinner_parties p
     set status = 'signed_up'
   where p.season_id = _season.id and p.org_id = _org and p.status = 'waitlisted'
     and exists (
       select 1 from public.dinner_seats st
       where st.party_id = p.id and st.org_id = _org and st.left_at is null
     );

  delete from public.dinner_drafts d where d.season_id = _season.id and d.org_id = _org;

  _after := public.dinner_seat_signatures(_season.id, _org);

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

revoke execute on function public.dinner_tables_publish(uuid) from public, anon;
grant execute on function public.dinner_tables_publish(uuid) to authenticated;

comment on function public.dinner_tables_publish(uuid) is
  'Publishes the season''s stored draft (dinner_drafts) as its tables, seats and dinners in one transaction, and returns the people whose tables or hosts changed. Actor from auth.uid(), who must lead the group; tenant anchor: the season row''s org, pinned against app_request_org_id(). Raises DC001, DC002, DC003, or DC005 when the draft drops or rehosts a dinner that has happened.';

-- ── Reminder ────────────────────────────────────────────────────────────────
-- Starts the reminder pass for a dinner's local date when it has none,
-- fixing its recipients, then claims every unsent reminder in it. Runs on
-- the service key only. The caller passes the start and host it read; a
-- dinner moved or rehosted since claims nothing, and the next firing reads
-- it again.
create function public.dinner_reminder_claim(
  _org_id uuid, _dinner_id uuid, _dinner_date date, _starts_at timestamptz, _host_party_id uuid
)
  returns table (profile_id uuid, email text, first_name text, preferred_name text)
  language plpgsql
  set search_path = ''
as $$
declare
  _dinner public.dinners;
begin
  -- Held to commit, so a move or rehost waits for the claim rather than racing it.
  select * into _dinner from public.dinners d where d.id = _dinner_id for share;
  if _dinner.id is null or _dinner.org_id is distinct from _org_id then
    raise exception 'dinner reminder claim rejected: dinner % is not in org %', _dinner_id, _org_id
      using errcode = 'DC010';
  end if;
  if _dinner.starts_at is distinct from _starts_at or _dinner.host_party_id is distinct from _host_party_id then
    return;
  end if;

  insert into public.dinner_reminder_passes (org_id, dinner_id, dinner_date)
  values (_org_id, _dinner_id, _dinner_date)
  on conflict do nothing;

  if found then
    insert into public.dinner_reminder_sends (org_id, dinner_id, dinner_date, profile_id)
    select _org_id, _dinner_id, _dinner_date, p.id
    from public.dinner_seats st
    join public.dinner_parties pa on pa.id = st.party_id and pa.org_id = _org_id and pa.status <> 'withdrawn'
    join public.dinner_party_members pm on pm.party_id = st.party_id and pm.org_id = _org_id
    join public.profiles p on p.id = pm.profile_id and p.org_id = _org_id
    where st.table_id = _dinner.table_id
      and st.org_id = _org_id
      and st.left_at is null
      and p.email is not null
      and p.role <> 'pending'
      and p.email_dinner_club
      and exists (
        select 1 from public.dinner_seasons s
        where s.id = _dinner.season_id and s.org_id = _org_id and s.status = 'published'
      )
      and exists (
        select 1 from public.group_settings gs
        where gs.group_id = _dinner.group_id and gs.org_id = _org_id and gs.dinner_club_enabled
      )
      and not exists (
        select 1 from public.dinner_replies r
        where r.org_id = _org_id and r.dinner_id = _dinner_id and r.profile_id = p.id and r.status = 'not_going'
      );
  end if;

  return query
  with claimed as (
    update public.dinner_reminder_sends x
       set claimed_at = pg_catalog.now()
     where x.org_id = _org_id
       and x.dinner_id = _dinner_id
       and x.dinner_date = _dinner_date
       and x.sent_at is null
       and (x.claimed_at is null or x.claimed_at < pg_catalog.now() - interval '10 minutes')
    returning x.profile_id
  )
  select c.profile_id, p.email, p.first_name, p.preferred_name
  from claimed c
  join public.profiles p on p.id = c.profile_id and p.org_id = _org_id
  where p.email is not null
    and p.role <> 'pending'
    and p.email_dinner_club
    and exists (
      select 1
      from public.dinner_seats st
      join public.dinner_parties pa on pa.id = st.party_id and pa.org_id = _org_id and pa.status <> 'withdrawn'
      join public.dinner_party_members pm on pm.party_id = st.party_id and pm.org_id = _org_id
      where st.table_id = _dinner.table_id and st.org_id = _org_id and st.left_at is null
        and pm.profile_id = p.id
    )
    and exists (
      select 1 from public.dinner_seasons s
      where s.id = _dinner.season_id and s.org_id = _org_id and s.status = 'published'
    )
    and exists (
      select 1 from public.group_settings gs
      where gs.group_id = _dinner.group_id and gs.org_id = _org_id and gs.dinner_club_enabled
    )
    and not exists (
      select 1 from public.dinner_replies r
      where r.org_id = _org_id and r.dinner_id = _dinner_id and r.profile_id = p.id and r.status = 'not_going'
    );
end;
$$;

revoke execute on function public.dinner_reminder_claim(uuid, uuid, date, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.dinner_reminder_claim(uuid, uuid, date, timestamptz, uuid) to service_role;

comment on function public.dinner_reminder_claim(uuid, uuid, date, timestamptz, uuid) is
  'Starts the reminder pass for one dinner on one local date when it has none, unless its start or host differs from the caller''s _starts_at and _host_party_id, fixing its recipients (the people seated at its table who have not said Not going and get dinner club email), then claims every unsent reminder in it and returns the people to mail who are still seated there. Tenant anchor: the dinner''s own org_id, compared with _org_id; a mismatch raises DC010. service_role only.';

-- The nightly cleanup deletes a church's passes past their retention through
-- this, a bounded set per call: the database API cannot limit a delete.
-- dinner_reminder_sends goes with each pass through its foreign key.
create function public.dinner_reminder_passes_prune(_org_id uuid, _before date, _limit integer)
  returns integer
  language sql security invoker set search_path = ''
as $$
  with doomed as (
    select p.dinner_id, p.dinner_date
    from public.dinner_reminder_passes p
    where p.org_id = _org_id and p.dinner_date < _before
    order by p.dinner_date
    limit _limit
  ),
  gone as (
    delete from public.dinner_reminder_passes p
    using doomed d
    where p.org_id = _org_id and p.dinner_id = d.dinner_id and p.dinner_date = d.dinner_date
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.dinner_reminder_passes_prune(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.dinner_reminder_passes_prune(uuid, date, integer) to service_role;

comment on function public.dinner_reminder_passes_prune(uuid, date, integer) is
  'Deletes at most _limit of one church''s dinner reminder passes with a dinner_date before _before, oldest first, and returns how many went. Tenant anchor: the _org_id predicate on every row it reads and deletes. service_role only.';

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
    '/g/[groupId]/dinner-club',
    '/g/[groupId]/dinner-club/seasons/[seasonId]',
    '/g/[groupId]/dinner-club/seasons/[seasonId]/edit',
    '/g/[groupId]/dinner-club/seasons/[seasonId]/tables',
    '/g/[groupId]/dinner-club/seasons/new',
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
  'send-dinner-reminders-daily',
  '0 15-17 * * *',
  '/functions/v1/send-dinner-reminders',
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
      ('send-dinner-reminders-daily', 15, false),
      ('send-dinner-reminders-daily', 16, false),
      ('send-dinner-reminders-daily', 17, false),
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
