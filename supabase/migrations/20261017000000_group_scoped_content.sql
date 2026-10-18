-- Group-scoped content: every content table carries a required group_id,
-- readability is membership in that group, writability is leadership of it
-- (or the existing author / steward rule). This is the first within-org
-- visibility boundary in the data model: an org admin who is not in a
-- group reads none of its content. Their power is over people.
--
--   * group_id uuid not null + composite (group_id, org_id) FK into groups
--     on events, event_calendars, announcements, lectures, lecture_series,
--     about_page, class_teachers, prayer_requests, prayer_responses,
--     prayer_call_sessions, giving_funds, giving_fund_methods. No DEFAULT:
--     there is no fail-closed group resolver, so NOT NULL is the guard.
--   * one calendar per group: every calendar of an org is folded into the
--     group's single calendar (events re-pointed, extra rows deleted,
--     counts asserted), named after the group and colored Clay. The
--     calendar's color is the group's color.
--   * group_settings (video call, prayer call, serving link mode) replaces
--     the five org-level site_settings keys; prayer_calendar_id and
--     directory_app_url are retired with them.
--   * about_page becomes one row per group, keyed by group_id.
--   * the serving tables' group_id columns (team ids) are renamed team_id
--     so group_id means one thing everywhere.
--   * every content policy is rewritten as ORG AND is_group_member /
--     is_group_leader; is_admin() and is_content_editor() leave every
--     content table. teams / team_members reads flip to group membership
--     (org admins keep the people-layer arm there, and only there).
--   * rsvps and the serving tables reach the group through their parent
--     (events, teams) under the caller's own RLS.
--
-- Ordered app-first: additive statements first, drops last within each
-- section, so the seconds between the Vercel deploy and `db push` fail
-- closed in both directions.

-- ── 1. Nullable columns ───────────────────────────────────────────────────
alter table public.event_calendars     add column group_id uuid;
alter table public.events              add column group_id uuid;
alter table public.announcements       add column group_id uuid;
alter table public.lectures            add column group_id uuid;
alter table public.lecture_series      add column group_id uuid;
alter table public.about_page          add column group_id uuid;
alter table public.class_teachers      add column group_id uuid;
alter table public.prayer_requests     add column group_id uuid;
alter table public.prayer_responses    add column group_id uuid;
alter table public.prayer_call_sessions add column group_id uuid;
alter table public.giving_funds        add column group_id uuid;
alter table public.giving_fund_methods add column group_id uuid;

-- ── 2. group_settings ─────────────────────────────────────────────────────
create table public.group_settings (
  group_id uuid primary key,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  weekly_zoom_url text,
  zoom_meeting_time text,
  weekly_prayer_call_url text,
  weekly_prayer_call_time text,
  -- NULL defers to the SERVING_LINK_MODE environment default; a stored value
  -- is an explicit choice by the group's leader.
  serving_link_mode text
    check (serving_link_mode in ('signed', 'login')),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint group_settings_group_id_fkey
    foreign key (group_id, org_id) references public.groups (id, org_id) on delete cascade
);
create index group_settings_org_id_idx on public.group_settings (org_id);
alter table public.group_settings enable row level security;

comment on table public.group_settings is
  'Per-group settings: the weekly video call, the weekly prayer call and the serving email link mode. One row per group, created on first save; an absent row means the defaults.';

-- ── 3. The backfill ───────────────────────────────────────────────────────
-- Callable rather than inline so the pgTAP suite can run the calendar fold
-- against fixture groups in CI, where migrations run on an empty database.
-- Idempotent: a second call finds one calendar per group and no NULLs and
-- changes nothing. Not SECURITY DEFINER and no client grant: the migration
-- runner and the test harness both run as postgres.
--
-- Ungrouped rows go to the org's oldest group. Production has exactly one
-- group per org, so that is the only group; a local stack seeded with
-- several groups gets its pre-existing content under the first one, the
-- group the foundation backfill created.
create function public.group_content_backfill() returns void
  language plpgsql set search_path = ''
as $$
declare
  _org record;
  _grp uuid;
  _grp_name text;
  _g record;
  _survivor uuid;
  _cals int;
  _adopted_cals int;
  _events_before bigint;
  _events_after bigint;
  _bad_events bigint;
  _t text;
  _before bigint;
  _after bigint;
  _nulls bigint;
  _content_tables constant text[] := array[
    'announcements', 'lecture_series', 'giving_funds', 'prayer_requests',
    'about_page', 'class_teachers', 'lectures', 'giving_fund_methods',
    'prayer_responses', 'prayer_call_sessions'];
begin
  lock table public.groups in share mode;
  lock table public.events in share mode;
  lock table public.event_calendars in share mode;

  for _org in
    select o.id from public.organizations o order by o.created_at, o.id
  loop
    select g.id, g.name into _grp, _grp_name
    from public.groups g
    where g.org_id = _org.id
    order by g.created_at, g.id
    limit 1;

    if _grp is null then
      if exists (select 1 from public.events where org_id = _org.id)
         or exists (select 1 from public.event_calendars where org_id = _org.id)
         or exists (select 1 from public.announcements where org_id = _org.id)
         or exists (select 1 from public.lecture_series where org_id = _org.id)
         or exists (select 1 from public.lectures where org_id = _org.id)
         or exists (select 1 from public.about_page where org_id = _org.id)
         or exists (select 1 from public.class_teachers where org_id = _org.id)
         or exists (select 1 from public.prayer_requests where org_id = _org.id)
         or exists (select 1 from public.prayer_call_sessions where org_id = _org.id)
         or exists (select 1 from public.giving_funds where org_id = _org.id)
      then
        raise exception 'group content backfill for org %: content rows but no group to own them', _org.id;
      end if;
      continue;
    end if;

    select count(*) into _events_before from public.events where org_id = _org.id;

    -- Calendars: adopt the ungrouped ones, then events inherit their
    -- calendar's group; whatever is left goes to the oldest group.
    update public.event_calendars
    set group_id = _grp
    where org_id = _org.id and group_id is null;
    get diagnostics _adopted_cals = row_count;

    update public.events e
    set group_id = c.group_id
    from public.event_calendars c
    where c.id = e.calendar_id and c.org_id = e.org_id
      and e.org_id = _org.id and e.group_id is null;
    update public.events
    set group_id = _grp
    where org_id = _org.id and group_id is null;

    -- One calendar per group: the oldest survives, carries the group's
    -- name and the Clay default, and every event of the group points at it.
    for _g in
      select g.id, g.name from public.groups g where g.org_id = _org.id order by g.created_at, g.id
    loop
      select count(*) into _cals from public.event_calendars
      where org_id = _org.id and group_id = _g.id;

      if _cals = 0 then
        insert into public.event_calendars (org_id, group_id, name, color)
        values (_org.id, _g.id, _g.name, '#B85C38')
        returning id into _survivor;
      else
        select id into _survivor from public.event_calendars
        where org_id = _org.id and group_id = _g.id
        order by created_at, id
        limit 1;
        if _cals > 1 or (_g.id = _grp and _adopted_cals > 0) then
          update public.event_calendars
          set name = _g.name, color = '#B85C38'
          where id = _survivor;
        end if;
      end if;

      update public.events
      set calendar_id = _survivor
      where org_id = _org.id and group_id = _g.id
        and calendar_id is distinct from _survivor;

      delete from public.event_calendars
      where org_id = _org.id and group_id = _g.id and id <> _survivor;
    end loop;

    select count(*) into _events_after from public.events where org_id = _org.id;
    if _events_after <> _events_before then
      raise exception 'group content backfill for org %: % events after the fold, % before',
        _org.id, _events_after, _events_before;
    end if;
    select count(*) into _bad_events
    from public.events e
    left join public.event_calendars c on c.id = e.calendar_id
    where e.org_id = _org.id and (c.id is null or c.group_id <> e.group_id);
    if _bad_events > 0 then
      raise exception 'group content backfill for org %: % event(s) outside their group''s calendar',
        _org.id, _bad_events;
    end if;
    if exists (
      select 1 from public.groups g
      where g.org_id = _org.id
        and (select count(*) from public.event_calendars c where c.group_id = g.id) <> 1
    ) then
      raise exception 'group content backfill for org %: a group does not have exactly one calendar', _org.id;
    end if;

    -- The other content tables. Children inherit their parent's group
    -- first so the three-column FKs below hold; the rest go to the oldest
    -- group. Counts are asserted per table.
    foreach _t in array _content_tables loop
      execute format('select count(*) from public.%I where org_id = $1', _t)
        into _before using _org.id;

      case _t
        when 'lectures' then
          update public.lectures l set group_id = s.group_id
          from public.lecture_series s
          where s.id = l.series_id and s.org_id = l.org_id
            and l.org_id = _org.id and l.group_id is null;
        when 'giving_fund_methods' then
          update public.giving_fund_methods m set group_id = f.group_id
          from public.giving_funds f
          where f.id = m.fund_id and f.org_id = m.org_id
            and m.org_id = _org.id and m.group_id is null;
        when 'prayer_responses' then
          update public.prayer_responses pr set group_id = r.group_id
          from public.prayer_requests r
          where r.id = pr.request_id and r.org_id = pr.org_id
            and pr.org_id = _org.id and pr.group_id is null;
        when 'prayer_call_sessions' then
          update public.prayer_call_sessions s set group_id = e.group_id
          from public.events e
          where e.id = s.event_id and e.org_id = s.org_id
            and s.org_id = _org.id and s.group_id is null;
        else
          null;
      end case;

      execute format('update public.%I set group_id = $1 where org_id = $2 and group_id is null', _t)
        using _grp, _org.id;

      execute format('select count(*), count(*) filter (where group_id is null) from public.%I where org_id = $1', _t)
        into _after, _nulls using _org.id;
      if _after <> _before or _nulls > 0 then
        raise exception 'group content backfill for org %: % has % rows after (% before), % without a group',
          _org.id, _t, _after, _before, _nulls;
      end if;
    end loop;

    -- The org-level call and link-mode settings become the oldest group's.
    insert into public.group_settings (
      org_id, group_id, weekly_zoom_url, zoom_meeting_time,
      weekly_prayer_call_url, weekly_prayer_call_time, serving_link_mode)
    select
      _org.id, _grp,
      nullif(max(value) filter (where key = 'weekly_zoom_url'), ''),
      nullif(max(value) filter (where key = 'zoom_meeting_time'), ''),
      nullif(max(value) filter (where key = 'weekly_prayer_call_url'), ''),
      nullif(max(value) filter (where key = 'weekly_prayer_call_time'), ''),
      case max(value) filter (where key = 'serving_link_mode')
           when 'login' then 'login' when 'signed' then 'signed' end
    from public.site_settings
    where org_id = _org.id
      and key in ('weekly_zoom_url', 'zoom_meeting_time', 'weekly_prayer_call_url',
                  'weekly_prayer_call_time', 'serving_link_mode')
    having count(*) > 0
    on conflict (group_id) do nothing;
  end loop;
end;
$$;

revoke execute on function public.group_content_backfill()
  from public, anon, authenticated, service_role;

comment on function public.group_content_backfill() is
  'Gives every ungrouped content row to its org''s oldest group, folds each group''s calendars into one (events re-pointed, extras deleted, counts asserted), creates a calendar for a group without one, and moves the org-level call and link-mode settings onto the oldest group. Idempotent. Callable only by the migration runner and the pgTAP harness.';

select public.group_content_backfill();

delete from public.site_settings
where key in ('weekly_zoom_url', 'zoom_meeting_time', 'weekly_prayer_call_url',
              'weekly_prayer_call_time', 'serving_link_mode', 'prayer_calendar_id',
              'directory_app_url');

-- ── 4. NOT NULL, composite FKs, indexes ───────────────────────────────────
do $$
declare
  _t text;
begin
  foreach _t in array array[
    'event_calendars', 'events', 'announcements', 'lectures', 'lecture_series',
    'about_page', 'class_teachers', 'prayer_requests', 'prayer_responses',
    'prayer_call_sessions', 'giving_funds', 'giving_fund_methods']
  loop
    execute format('alter table public.%I alter column group_id set not null', _t);
    execute format(
      'alter table public.%I add constraint %I foreign key (group_id, org_id) '
      'references public.groups (id, org_id) on delete cascade',
      _t, _t || '_group_id_fkey');
    execute format('create index %I on public.%I (group_id)', _t || '_group_id_idx', _t);
  end loop;
end $$;

-- The calendar's color is the group's color and reaches CSS: the same
-- six-digit hex boundary as group_labels.color and HEX in lib/contrast.ts.
alter table public.event_calendars alter column color set default '#B85C38';
alter table public.event_calendars
  add constraint event_calendars_color_hex check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

-- ── 5. Parent uniques and three-column child FKs ──────────────────────────
-- Both sides carry group_id, so the FK pins the child to the parent's
-- group as well as its org: a member of two groups cannot file a fund
-- method under group B for a group A fund. Same names as before, so the
-- PostgREST embed hints keep working.
alter table public.events          add constraint events_id_org_group_unique          unique (id, org_id, group_id);
alter table public.event_calendars add constraint event_calendars_id_org_group_unique unique (id, org_id, group_id);
alter table public.lecture_series  add constraint lecture_series_id_org_group_unique  unique (id, org_id, group_id);
alter table public.giving_funds    add constraint giving_funds_id_org_group_unique    unique (id, org_id, group_id);
alter table public.prayer_requests add constraint prayer_requests_id_org_group_unique unique (id, org_id, group_id);

alter table public.events drop constraint events_calendar_id_fkey;
alter table public.events add constraint events_calendar_id_fkey
  foreign key (calendar_id, org_id, group_id)
  references public.event_calendars (id, org_id, group_id) on delete set null (calendar_id);

alter table public.events drop constraint events_series_id_fkey;
alter table public.events add constraint events_series_id_fkey
  foreign key (series_id, org_id, group_id)
  references public.events (id, org_id, group_id) on delete cascade;

alter table public.lectures drop constraint lectures_series_id_fkey;
alter table public.lectures add constraint lectures_series_id_fkey
  foreign key (series_id, org_id, group_id)
  references public.lecture_series (id, org_id, group_id) on delete set null (series_id);

alter table public.prayer_call_sessions drop constraint prayer_call_sessions_event_id_fkey;
alter table public.prayer_call_sessions add constraint prayer_call_sessions_event_id_fkey
  foreign key (event_id, org_id, group_id)
  references public.events (id, org_id, group_id) on delete set null (event_id);

alter table public.prayer_responses drop constraint prayer_responses_request_id_fkey;
alter table public.prayer_responses add constraint prayer_responses_request_id_fkey
  foreign key (request_id, org_id, group_id)
  references public.prayer_requests (id, org_id, group_id) on delete cascade;

alter table public.giving_fund_methods drop constraint giving_fund_methods_fund_id_fkey;
alter table public.giving_fund_methods add constraint giving_fund_methods_fund_id_fkey
  foreign key (fund_id, org_id, group_id)
  references public.giving_funds (id, org_id, group_id) on delete cascade;

-- ── 6. about_page is one row per group; a person may lead in two groups ───
alter table public.about_page drop constraint about_page_pkey;
alter table public.about_page add constraint about_page_pkey primary key (group_id);
alter table public.about_page drop column id;

comment on table public.about_page is
  'One row per group holding the About page body (BlockNote JSON). Keyed by group_id; created on first save.';

alter table public.class_teachers drop constraint class_teachers_org_id_profile_id_key;
alter table public.class_teachers add constraint class_teachers_group_id_profile_id_key unique (group_id, profile_id);

-- ── 7. Serving tables: the team column is named for what it holds ─────────
alter table public.serving_signups       rename column group_id to team_id;
alter table public.serving_broadcasts    rename column group_id to team_id;
alter table public.serving_team_settings rename column group_id to team_id;

alter table public.serving_signups rename constraint serving_signups_group_id_fkey to serving_signups_team_id_fkey;
alter table public.serving_signups rename constraint serving_signups_group_id_service_date_key to serving_signups_team_id_service_date_key;
alter table public.serving_broadcasts rename constraint serving_broadcasts_group_id_fkey to serving_broadcasts_team_id_fkey;
alter table public.serving_team_settings rename constraint serving_team_settings_group_id_fkey to serving_team_settings_team_id_fkey;

comment on column public.serving_signups.team_id is 'Team id (references teams).';
comment on column public.serving_broadcasts.team_id is 'Team id (references teams).';
comment on column public.serving_team_settings.team_id is 'Team id (references teams).';

-- ── 8. Policies ───────────────────────────────────────────────────────────
-- ORG ::= org_id = (select public.app_request_org_id()); every permissive
-- policy is ORG AND (arms), to authenticated. The membership helpers take
-- a row-dependent argument and are called bare (they cannot be InitPlan-
-- hoisted); the zero-argument helpers keep their (select …) wrapper. The
-- anonymous read arms on lectures, lecture_series, event_calendars and
-- published announcements are gone: is_group_member() is false for anon
-- by construction and the middleware already sends those paths to login.

-- events
drop policy "Members can view all events" on public.events;
drop policy "Admins can insert events" on public.events;
drop policy "Admins can update events" on public.events;
drop policy "Admins can delete events" on public.events;

create policy "Group members can view events" on public.events
  for select to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_member(group_id));
create policy "Group leaders can insert events" on public.events
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can update events" on public.events
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can delete events" on public.events
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- event_calendars
drop policy "Anyone can read event calendars" on public.event_calendars;
drop policy "Admins can insert event calendars" on public.event_calendars;
drop policy "Admins can update event calendars" on public.event_calendars;
drop policy "Admins can delete event calendars" on public.event_calendars;

create policy "Group members can view event calendars" on public.event_calendars
  for select to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_member(group_id));
create policy "Group leaders can insert event calendars" on public.event_calendars
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can update event calendars" on public.event_calendars
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can delete event calendars" on public.event_calendars
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- announcements
drop policy "Members and published announcements are visible" on public.announcements;
drop policy "Admins can insert announcements" on public.announcements;
drop policy "Admins can update announcements" on public.announcements;
drop policy "Admins can delete announcements" on public.announcements;

create policy "Group members can view published announcements" on public.announcements
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and public.is_group_member(group_id)
    and (is_published or public.is_group_leader(group_id))
  );
create policy "Group leaders can insert announcements" on public.announcements
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can update announcements" on public.announcements
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can delete announcements" on public.announcements
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- lectures
drop policy "Lectures visible to all" on public.lectures;
drop policy "Admins can insert lectures" on public.lectures;
drop policy "Admins can update lectures" on public.lectures;
drop policy "Admins can delete lectures" on public.lectures;

create policy "Group members can view lectures" on public.lectures
  for select to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_member(group_id));
create policy "Group leaders can insert lectures" on public.lectures
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can update lectures" on public.lectures
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can delete lectures" on public.lectures
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- lecture_series
drop policy "Series visible to all" on public.lecture_series;
drop policy "Admins can insert series" on public.lecture_series;
drop policy "Admins can update series" on public.lecture_series;
drop policy "Admins can delete series" on public.lecture_series;

create policy "Group members can view series" on public.lecture_series
  for select to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_member(group_id));
create policy "Group leaders can insert series" on public.lecture_series
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can update series" on public.lecture_series
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can delete series" on public.lecture_series
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- about_page
drop policy "Members can read about page" on public.about_page;
drop policy "Editors can insert about page" on public.about_page;
drop policy "Editors can update about page" on public.about_page;

create policy "Group members can read about page" on public.about_page
  for select to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_member(group_id));
create policy "Group leaders can insert about page" on public.about_page
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can update about page" on public.about_page
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- class_teachers
drop policy "Members can read class teachers" on public.class_teachers;
drop policy "Editors can insert class teachers" on public.class_teachers;
drop policy "Editors can update class teachers" on public.class_teachers;
drop policy "Editors can delete class teachers" on public.class_teachers;

create policy "Group members can read class teachers" on public.class_teachers
  for select to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_member(group_id));
create policy "Group leaders can insert class teachers" on public.class_teachers
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can update class teachers" on public.class_teachers
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can delete class teachers" on public.class_teachers
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- prayer_requests
drop policy "Members can view visible prayer requests" on public.prayer_requests;
drop policy "Members can post own prayer requests" on public.prayer_requests;
drop policy "Posters and admins can update prayer requests" on public.prayer_requests;
drop policy "Posters and admins can delete prayer requests" on public.prayer_requests;

create policy "Group members can view visible prayer requests" on public.prayer_requests
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and public.is_group_member(group_id)
    and (author_id = (select auth.uid()) or not visible_to_warriors)
  );
create policy "Group members can post own prayer requests" on public.prayer_requests
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and public.is_group_member(group_id)
    and author_id = (select auth.uid())
  );
-- WITH CHECK pins the target row to a group the writer belongs to: the
-- author arm alone would let a poster move a request into any group.
create policy "Posters and group leaders can update prayer requests" on public.prayer_requests
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (author_id = (select auth.uid()) or public.is_group_leader(group_id))
  )
  with check (
    org_id = (select public.app_request_org_id())
    and public.is_group_member(group_id)
    and (author_id = (select auth.uid()) or public.is_group_leader(group_id))
  );
create policy "Posters and group leaders can delete prayer requests" on public.prayer_requests
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (author_id = (select auth.uid()) or public.is_group_leader(group_id))
  );

-- prayer_responses: the EXISTS runs under the caller's prayer_requests
-- policy, so a member prays only for requests they can see.
drop policy "Members can view prayer responses" on public.prayer_responses;
drop policy "Members can pray for visible requests" on public.prayer_responses;
drop policy "Members can withdraw own prayer responses" on public.prayer_responses;

create policy "Group members can view prayer responses" on public.prayer_responses
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and public.is_group_member(group_id)
    and exists (select 1 from public.prayer_requests r where r.id = prayer_responses.request_id)
  );
create policy "Group members can pray for visible requests" on public.prayer_responses
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and public.is_group_member(group_id)
    and profile_id = (select auth.uid())
    and exists (select 1 from public.prayer_requests r where r.id = prayer_responses.request_id)
  );
create policy "Members can withdraw own prayer responses" on public.prayer_responses
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and profile_id = (select auth.uid()));

-- prayer_call_sessions
drop policy "Members can view prayer call sessions" on public.prayer_call_sessions;
drop policy "Admins can insert prayer call sessions" on public.prayer_call_sessions;
drop policy "Admins can update prayer call sessions" on public.prayer_call_sessions;
drop policy "Admins can delete prayer call sessions" on public.prayer_call_sessions;

create policy "Group members can view prayer call sessions" on public.prayer_call_sessions
  for select to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_member(group_id));
create policy "Group leaders can insert prayer call sessions" on public.prayer_call_sessions
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can update prayer call sessions" on public.prayer_call_sessions
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can delete prayer call sessions" on public.prayer_call_sessions
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- giving_funds
drop policy "Members can view giving funds" on public.giving_funds;
drop policy "Admins and self-stewards can create funds" on public.giving_funds;
drop policy "Admins and stewards can update funds" on public.giving_funds;
drop policy "Admins and stewards can delete funds" on public.giving_funds;

create policy "Group members can view giving funds" on public.giving_funds
  for select to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_member(group_id));
create policy "Group leaders and self-stewards can create funds" on public.giving_funds
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and created_by = (select auth.uid())
    and (
      public.is_group_leader(group_id)
      or (
        (select public.giving_stewards_can_manage())
        and public.is_group_member(group_id)
        and steward_id = (select auth.uid())
      )
    )
  );
create policy "Group leaders and stewards can update funds" on public.giving_funds
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      public.is_group_leader(group_id)
      or ((select public.giving_stewards_can_manage()) and steward_id = (select auth.uid()))
    )
  )
  with check (
    org_id = (select public.app_request_org_id())
    and public.is_group_member(group_id)
    and (
      public.is_group_leader(group_id)
      or ((select public.giving_stewards_can_manage()) and steward_id = (select auth.uid()))
    )
  );
create policy "Group leaders and stewards can delete funds" on public.giving_funds
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      public.is_group_leader(group_id)
      or ((select public.giving_stewards_can_manage()) and steward_id = (select auth.uid()))
    )
  );

-- giving_fund_methods (the helper is rewritten in section 9)
drop policy "Members can view fund methods" on public.giving_fund_methods;
drop policy "Fund managers can add methods" on public.giving_fund_methods;
drop policy "Fund managers can update methods" on public.giving_fund_methods;
drop policy "Fund managers can remove methods" on public.giving_fund_methods;

create policy "Group members can view fund methods" on public.giving_fund_methods
  for select to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_member(group_id));
create policy "Fund managers can add methods" on public.giving_fund_methods
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.giving_can_manage_fund(fund_id));
create policy "Fund managers can update methods" on public.giving_fund_methods
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.giving_can_manage_fund(fund_id))
  with check (org_id = (select public.app_request_org_id()) and public.giving_can_manage_fund(fund_id));
create policy "Fund managers can remove methods" on public.giving_fund_methods
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.giving_can_manage_fund(fund_id));

-- rsvps reach the group through events: the EXISTS runs under the caller's
-- events policy, so a member sees and makes RSVPs on exactly the events
-- they can see.
drop policy "Members and admins can view rsvps" on public.rsvps;
drop policy "Members and admins can insert rsvps" on public.rsvps;
drop policy "Members and admins can update rsvps" on public.rsvps;
drop policy "Members and admins can delete rsvps" on public.rsvps;

create policy "Members can view rsvps on visible events" on public.rsvps
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and exists (select 1 from public.events e where e.id = rsvps.event_id and e.org_id = rsvps.org_id)
  );
create policy "Members can insert own rsvps on visible events" on public.rsvps
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and user_id = (select auth.uid())
    and exists (select 1 from public.events e where e.id = rsvps.event_id and e.org_id = rsvps.org_id)
  );
create policy "Members can update own rsvps on visible events" on public.rsvps
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and user_id = (select auth.uid())
    and exists (select 1 from public.events e where e.id = rsvps.event_id and e.org_id = rsvps.org_id)
  )
  with check (
    org_id = (select public.app_request_org_id())
    and user_id = (select auth.uid())
    and exists (select 1 from public.events e where e.id = rsvps.event_id and e.org_id = rsvps.org_id)
  );
create policy "Members can delete own rsvps" on public.rsvps
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and user_id = (select auth.uid()));

-- teams / team_members: the people layer. Org admins manage teams from
-- Admin, so the admin arm stays here, and only here.
drop policy "Members can view teams" on public.teams;
create policy "Group members and admins can view teams" on public.teams
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_member(group_id))
  );

drop policy "Members can view team members" on public.team_members;
create policy "Group members and admins can view team members" on public.team_members
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.teams t
        where t.id = team_members.team_id
          and t.org_id = team_members.org_id
          and public.is_group_member(t.group_id)
      )
    )
  );

-- Serving content reaches the group through the team row (one FK hop); an
-- org admin outside the group sees no signups. Team-lead arms stay.
drop policy "Members can view serving signups" on public.serving_signups;
drop policy "Members can create serving signups" on public.serving_signups;
drop policy "Members can delete own serving signups" on public.serving_signups;

create policy "Group members can view serving signups" on public.serving_signups
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and exists (
      select 1 from public.teams t
      where t.id = serving_signups.team_id
        and t.org_id = serving_signups.org_id
        and public.is_group_member(t.group_id)
    )
  );
create policy "Team members and group leaders can create serving signups" on public.serving_signups
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and created_by = (select auth.uid())
    and (
      public.is_team_lead(team_id)
      or exists (
        select 1 from public.team_members tm
        where tm.profile_id = (select auth.uid())
          and tm.team_id = serving_signups.team_id
      )
      or exists (
        select 1 from public.teams t
        where t.id = serving_signups.team_id
          and t.org_id = serving_signups.org_id
          and public.is_group_leader(t.group_id)
      )
    )
  );
create policy "Owners, team leads and group leaders can delete serving signups" on public.serving_signups
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      created_by = (select auth.uid())
      or public.is_team_lead(team_id)
      or exists (
        select 1 from public.teams t
        where t.id = serving_signups.team_id
          and t.org_id = serving_signups.org_id
          and public.is_group_leader(t.group_id)
      )
    )
  );

drop policy "Members can view serving attendees" on public.serving_signup_attendees;
drop policy "Signup owners can remove attendees" on public.serving_signup_attendees;

create policy "Members can view attendees of visible signups" on public.serving_signup_attendees
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and exists (
      select 1 from public.serving_signups s
      where s.id = serving_signup_attendees.signup_id and s.org_id = serving_signup_attendees.org_id
    )
  );
create policy "Signup owners can remove attendees" on public.serving_signup_attendees
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and exists (
      select 1 from public.serving_signups s
      where s.id = serving_signup_attendees.signup_id
        and s.org_id = serving_signup_attendees.org_id
        and (
          s.created_by = (select auth.uid())
          or public.is_team_lead(s.team_id)
          or exists (
            select 1 from public.teams t
            where t.id = s.team_id and t.org_id = s.org_id and public.is_group_leader(t.group_id)
          )
        )
    )
  );

drop policy "Leaders and admins can view serving broadcasts" on public.serving_broadcasts;
drop policy "Leaders and admins can log serving broadcasts" on public.serving_broadcasts;

create policy "Team leads and group leaders can view serving broadcasts" on public.serving_broadcasts
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      public.is_team_lead(team_id)
      or exists (
        select 1 from public.teams t
        where t.id = serving_broadcasts.team_id
          and t.org_id = serving_broadcasts.org_id
          and public.is_group_leader(t.group_id)
      )
    )
  );
create policy "Team leads and group leaders can log serving broadcasts" on public.serving_broadcasts
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and sent_by = (select auth.uid())
    and (
      public.is_team_lead(team_id)
      or exists (
        select 1 from public.teams t
        where t.id = serving_broadcasts.team_id
          and t.org_id = serving_broadcasts.org_id
          and public.is_group_leader(t.group_id)
      )
    )
  );

drop policy "Members can view serving settings" on public.serving_team_settings;
drop policy "Leaders and admins can insert serving settings" on public.serving_team_settings;
drop policy "Leaders and admins can update serving settings" on public.serving_team_settings;
drop policy "Admins can delete serving settings" on public.serving_team_settings;

create policy "Group members can view serving settings" on public.serving_team_settings
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and exists (
      select 1 from public.teams t
      where t.id = serving_team_settings.team_id
        and t.org_id = serving_team_settings.org_id
        and public.is_group_member(t.group_id)
    )
  );
create policy "Team leads and group leaders can insert serving settings" on public.serving_team_settings
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (
      public.is_team_lead(team_id)
      or exists (
        select 1 from public.teams t
        where t.id = serving_team_settings.team_id
          and t.org_id = serving_team_settings.org_id
          and public.is_group_leader(t.group_id)
      )
    )
  );
create policy "Team leads and group leaders can update serving settings" on public.serving_team_settings
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      public.is_team_lead(team_id)
      or exists (
        select 1 from public.teams t
        where t.id = serving_team_settings.team_id
          and t.org_id = serving_team_settings.org_id
          and public.is_group_leader(t.group_id)
      )
    )
  )
  with check (
    org_id = (select public.app_request_org_id())
    and (
      public.is_team_lead(team_id)
      or exists (
        select 1 from public.teams t
        where t.id = serving_team_settings.team_id
          and t.org_id = serving_team_settings.org_id
          and public.is_group_leader(t.group_id)
      )
    )
  );
create policy "Group leaders can delete serving settings" on public.serving_team_settings
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and exists (
      select 1 from public.teams t
      where t.id = serving_team_settings.team_id
        and t.org_id = serving_team_settings.org_id
        and public.is_group_leader(t.group_id)
    )
  );

-- group_settings
create policy "org isolation" on public.group_settings
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));
create policy "Group members can read group settings" on public.group_settings
  for select to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_member(group_id));
create policy "Group leaders can insert group settings" on public.group_settings
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));
create policy "Group leaders can update group settings" on public.group_settings
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id))
  with check (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

-- ── 9. Helpers, the RPC pair, the view, provisioning ──────────────────────
create or replace function public.giving_can_manage_fund(_fund_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.giving_funds f
    where f.id = _fund_id
      and f.org_id = public.app_current_org_id()
      and (
        public.is_group_leader(f.group_id)
        or (public.giving_stewards_can_manage() and f.steward_id = auth.uid())
      )
  );
$$;

-- Same bodies as before over the renamed column; serving_signup_create()
-- gains the group-leader arm its INSERT policy now has.
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

create or replace function public.serving_signup_create(
  _group_id     uuid,
  _service_date date,
  _attendee_ids uuid[]
) returns table (signup_id uuid, signup_org_id uuid, created boolean)
  language plpgsql security definer set search_path = ''
as $$
declare
  _actor uuid;
  _org uuid;
  _grp uuid;
begin
  _actor := auth.uid();
  if _actor is null then
    raise exception 'serving signup rejected: no authenticated principal'
      using errcode = 'SV002';
  end if;

  select t.org_id, t.group_id into _org, _grp
  from public.teams t
  where t.id = _group_id;

  if _org is null or _org is distinct from public.app_request_org_id() then
    raise exception 'serving signup rejected: group % does not resolve to the request org', _group_id
      using errcode = 'SV002';
  end if;

  -- The RLS INSERT policy's arms, re-implemented because SECURITY DEFINER
  -- bypasses the policy. Bare helper calls are correct here — the
  -- (select ...) InitPlan rule applies to policy expressions only.
  if not (
    public.is_team_lead(_group_id)
    or public.is_group_leader(_grp)
    or exists (
      select 1 from public.team_members tm
      where tm.profile_id = _actor
        and tm.team_id = _group_id
        and tm.org_id = _org
    )
  ) then
    raise exception 'serving signup rejected: actor % is not on team %', _actor, _group_id
      using errcode = 'SV004';
  end if;

  return query
  select * from public.serving_signup_apply(_group_id, _service_date, _actor, _attendee_ids);
end;
$$;

revoke execute on function public.serving_signup_apply(uuid, date, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.serving_signup_apply(uuid, date, uuid, uuid[])
  to service_role;
revoke execute on function public.serving_signup_create(uuid, date, uuid[])
  from public, anon;
grant execute on function public.serving_signup_create(uuid, date, uuid[])
  to authenticated, service_role;

comment on function public.serving_signup_apply(uuid, date, uuid, uuid[]) is
  'Atomic serving signup + attendee insert pair. Tenant anchor: org_id resolved from the teams row named by _group_id (a team id), never a caller parameter; every other row is asserted to carry it. service_role only — the HMAC signed-link route passes its validated profile id as _actor_id.';
comment on function public.serving_signup_create(uuid, date, uuid[]) is
  'Authenticated serving signup entry point. Actor from auth.uid(); tenant anchor: the team''s org pinned against app_request_org_id(), fail-closed on NULL; the RLS INSERT-policy arms (team member, team lead, or a leader of the team''s group) are re-checked before delegating to serving_signup_apply().';

-- prayer_wall: group_id appended as the last column (append only).
create or replace view public.prayer_wall
  with (security_invoker = true)
as
select
  r.id,
  r.body,
  r.category,
  r.is_anonymous,
  r.visible_to_warriors,
  r.is_answered,
  r.created_at,
  (r.author_id = (select auth.uid())) as mine,
  case when r.is_anonymous and r.author_id <> (select auth.uid()) then null else p.first_name end as first_name,
  case when r.is_anonymous and r.author_id <> (select auth.uid()) then null else p.last_name end as last_name,
  case when r.is_anonymous and r.author_id <> (select auth.uid()) then null else p.preferred_name end as preferred_name,
  case when r.is_anonymous and r.author_id <> (select auth.uid()) then null else p.avatar_url end as avatar_url,
  coalesce(pc.praying_count, 0) as praying_count,
  coalesce(pc.i_am_praying, false) as i_am_praying,
  r.org_id,
  r.group_id
from public.prayer_requests r
left join public.profiles p on p.id = r.author_id and p.org_id = r.org_id
left join lateral (
  select count(*)::integer as praying_count,
         bool_or(pr.profile_id = (select auth.uid())) as i_am_praying
  from public.prayer_responses pr
  where pr.request_id = r.id and pr.org_id = r.org_id
) pc on true
where r.org_id = (select public.app_request_org_id());

-- Provisioning seeds no group-owned rows any more: with no group at
-- provisioning time there is nothing to own a calendar or an about page,
-- and the call and link-mode settings now live on group_settings.
create or replace function public.provision_organization(_name text, _slug text, _owner_email text)
  returns uuid
  language plpgsql security definer set search_path = ''
as $_$
declare
  _org_id uuid;
begin
  if _slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'invalid organization slug: %', _slug using errcode = 'TN003';
  end if;

  -- Reserved subdomain labels: slugs become host
  -- labels once wildcard/custom-domain routing ships, so any of these would
  -- shadow a platform host. 'default' is deliberately absent — it is the
  -- slug of the one org that exists today (20260730010000_org_spine.sql);
  -- add it once that org is renamed or retired. Mirrored in lib/org.ts's
  -- RESERVED_ORG_SLUGS — keep both lists in sync. _slug is already
  -- lowercase-only here (the TN003 regex has no case-insensitive flag), so a
  -- plain equality match is correct.
  if _slug = any(array[
    'www', 'app', 'api', 'admin', 'platform', 'auth', 'mail', 'email',
    'static', 'assets', 'cdn', 'status', 'docs', 'blog', 'help', 'support',
    'dev', 'staging', 'preview', 'test'
  ]) then
    raise exception 'organization slug % is reserved', _slug using errcode = 'TN006';
  end if;

  -- 1. The org itself. branding carries only the tenant-overridable keys
  -- from docs/design/DESIGN.md: display_name, logo_url, accent,
  -- reply_to.
  insert into public.organizations (name, slug, branding, status)
  values (
    _name,
    _slug,
    jsonb_build_object('display_name', _name, 'logo_url', null, 'accent', null, 'reply_to', null),
    'active'
  )
  returning id into _org_id;

  -- 2. Settings defaults — the org-level keys in one auditable place. No
  -- seeded setting is anon-readable: the org's public name lives in
  -- organizations.branding.display_name.
  insert into public.site_settings (org_id, key, value, is_public)
  values
    (_org_id, 'giving_manage_mode',      'stewards',    false),
    (_org_id, 'giving_dashboard_tile',   'on',          false);

  -- 3. Approved access request for the owner, so their signup resolves
  -- under handle_new_user()'s fail-closed rules. approved_role = 'admin'
  -- is what makes the owner the founding admin: handle_new_user()
  -- reads it at signup time, so the org never exists without an admin path.
  insert into public.access_requests (org_id, name, email, status, reviewed_at, approved_role)
  values (_org_id, _name || ' owner', _owner_email, 'approved', now(), 'admin');

  -- 4. The owner email must not already have a profile. The org created
  -- above holds no profiles yet, so ANY existing profile with this email
  -- necessarily belongs to another org — and a profile is never moved
  -- between orgs. An unscoped `update profiles set org_id = _org_id where
  -- email = ...` would be a cross-tenant write: once self-serve signup exposes a
  -- caller, passing a competing org's admin email would re-pin that admin
  -- into the caller's org — an account-takeover primitive that a "who may
  -- provision" guard does not address. Raise instead, matching
  -- handle_new_user()'s TN001/TN002: an email that already belongs
  -- elsewhere is a conflict for a human to resolve, not something to
  -- silently resolve by moving the account. The owner's profiles and
  -- organization_members rows are created by handle_new_user() when they
  -- sign up AFTER provisioning, through the approved access request above.
  if exists (
    -- Case-insensitive to match handle_new_user(): profile emails come from
    -- GoTrue lowercased, while _owner_email arrives as typed.
    select 1 from public.profiles where lower(email) = lower(_owner_email)
  ) then
    raise exception 'owner email % already belongs to another organization', _owner_email
      using errcode = 'TN004';
  end if;

  -- 5. Nor may the owner email hold an approved access request or unclaimed
  -- family invite in another org (a profile-less owner: invited or approved
  -- elsewhere but not yet signed up). The step-3 insert would then be a
  -- SECOND match for handle_new_user(), which rejects the owner's eventual
  -- signup as ambiguous (TN002) — a broken state this transaction would
  -- otherwise commit. The org_id filter excludes the request created in
  -- step 3; checked after step 4 so an email that also has a profile keeps
  -- raising TN004.
  if exists (
    select 1 from public.access_requests
    where lower(email) = lower(_owner_email)
      and status = 'approved'
      and org_id <> _org_id
  ) or exists (
    select 1 from public.family_invites
    where lower(invite_email) = lower(_owner_email)
      and accepted_at is null
      and org_id <> _org_id
  ) then
    raise exception 'owner email % already has an approved access request or unclaimed invite in another organization', _owner_email
      using errcode = 'TN005';
  end if;

  return _org_id;
end;
$_$;

revoke execute on function public.provision_organization(text, text, text)
  from public, anon, authenticated;
grant execute on function public.provision_organization(text, text, text)
  to service_role;

-- ── 10. Storage: event images are written by the event's group leaders ────
drop policy "Editors can upload event images" on storage.objects;
drop policy "Editors can update event images" on storage.objects;
drop policy "Editors can delete event images" on storage.objects;

create policy "Group leaders can upload event images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (storage.foldername(name))[2] = 'events'
    and exists (
      select 1 from public.events e
      where e.id::text = (storage.foldername(name))[3]
        and public.is_group_leader(e.group_id)
    )
  );

create policy "Group leaders can update event images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (storage.foldername(name))[2] = 'events'
    and exists (
      select 1 from public.events e
      where e.id::text = (storage.foldername(name))[3]
        and public.is_group_leader(e.group_id)
    )
  );

create policy "Group leaders can delete event images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (storage.foldername(name))[2] = 'events'
    and exists (
      select 1 from public.events e
      where e.id::text = (storage.foldername(name))[3]
        and public.is_group_leader(e.group_id)
    )
  );

-- ── 11. Self-check ────────────────────────────────────────────────────────
-- A missed table would be a silently admin-writable one; make it a failed
-- migration instead.
do $$
declare
  _n int;
begin
  select count(*) into _n
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'events', 'event_calendars', 'announcements', 'lectures', 'lecture_series',
      'about_page', 'class_teachers', 'prayer_requests', 'prayer_responses',
      'prayer_call_sessions', 'giving_funds', 'giving_fund_methods', 'group_settings',
      'rsvps', 'serving_signups', 'serving_signup_attendees', 'serving_broadcasts',
      'serving_team_settings')
    and (coalesce(qual, '') ~ 'is_(admin|content_editor)\('
         or coalesce(with_check, '') ~ 'is_(admin|content_editor)\(');
  if _n > 0 then
    raise exception 'group scoped content: % content policy(ies) still gate on is_admin() or is_content_editor()', _n;
  end if;

  select count(*) into _n
  from information_schema.columns
  where table_schema = 'public' and column_name = 'group_id' and is_nullable = 'YES'
    and table_name in (
      'events', 'event_calendars', 'announcements', 'lectures', 'lecture_series',
      'about_page', 'class_teachers', 'prayer_requests', 'prayer_responses',
      'prayer_call_sessions', 'giving_funds', 'giving_fund_methods', 'group_settings');
  if _n > 0 then
    raise exception 'group scoped content: % content table(s) still allow a NULL group_id', _n;
  end if;
end $$;
