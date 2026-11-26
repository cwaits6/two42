-- Leaders can give parts of their job to other members of the group, so
-- leading a group is no longer all or nothing. An ability is one of a fixed
-- list; a leader holds every ability, and a member holds one when a leader
-- grants it to them directly or, for Prayer care only, through a team the
-- leader linked to it.
--
--   members        add and remove members, review requests to join, invite links, labels
--   calendar       add, edit and delete events, and their images
--   announcements  write, publish and delete announcements, and read drafts
--   lessons        add, edit and delete lessons and series
--   teams          add, edit and delete teams, their members, settings and serving
--   prayer_care    edit and delete any prayer request or comment (enforced in the app,
--                  whose prayer writes go through the service client)
--
-- Only leaders grant or remove an ability, link a team, and change who is a
-- leader: the members ability adds and removes plain members only.
--
-- A team linked to Prayer care is closed: only a leader or someone given
-- Prayer care directly adds or removes its members, so a team lead or a
-- holder of the teams ability cannot widen who holds it. team_abilities
-- accepts prayer_care alone because that closure is written for it; linking
-- another ability needs the same closure first.

-- ── Tables ─────────────────────────────────────────────────────────────────

create table public.group_member_abilities (
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  group_id uuid not null,
  profile_id uuid not null,
  ability text not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (group_id, profile_id, ability),
  constraint group_member_abilities_ability_check
    check (ability in ('members', 'calendar', 'announcements', 'lessons', 'teams', 'prayer_care')),
  constraint group_member_abilities_member_fkey
    foreign key (group_id, profile_id, org_id)
    references public.group_members (group_id, profile_id, org_id) on delete cascade
);

comment on table public.group_member_abilities is
  'An ability a leader gave one member of their group. Leaving the group removes it. Leaders hold every ability without a row here.';

create index group_member_abilities_profile_idx on public.group_member_abilities (profile_id, org_id);

create table public.team_abilities (
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  team_id uuid not null,
  ability text not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (team_id, ability),
  constraint team_abilities_ability_check check (ability = 'prayer_care'),
  constraint team_abilities_team_fkey
    foreign key (team_id, org_id) references public.teams (id, org_id) on delete cascade
);

comment on table public.team_abilities is
  'An ability a leader linked to a team: every member of the team holds it. Only prayer_care, because only it has the closed-roster rule in the team_members policies.';

alter table public.group_member_abilities enable row level security;
alter table public.team_abilities enable row level security;

revoke all on public.group_member_abilities from anon;
revoke all on public.team_abilities from anon;
revoke update, truncate on public.group_member_abilities from authenticated;
revoke update, truncate on public.team_abilities from authenticated;

-- ── Helpers ────────────────────────────────────────────────────────────────

create function public.has_group_ability(_group_id uuid, _ability text) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select public.is_group_leader(_group_id)
    or exists (
      select 1 from public.group_member_abilities a
      join public.profiles p on p.id = a.profile_id and p.org_id = a.org_id
      where a.profile_id = auth.uid()
        and a.group_id = _group_id
        and a.ability = _ability
        and a.org_id = public.app_current_org_id()
        and p.role <> 'pending'
    )
    or exists (
      select 1 from public.team_abilities ta
      join public.teams t on t.id = ta.team_id and t.org_id = ta.org_id
      join public.team_members tm on tm.team_id = t.id and tm.org_id = t.org_id
      join public.profiles p on p.id = tm.profile_id and p.org_id = tm.org_id
      where tm.profile_id = auth.uid()
        and t.group_id = _group_id
        and ta.ability = _ability
        and ta.org_id = public.app_current_org_id()
        and p.role <> 'pending'
    );
$$;

comment on function public.has_group_ability(uuid, text) is
  'True when the caller (auth.uid()) is a non-pending leader of the group, or holds the ability in it directly or through a linked team. Caller and org resolved from auth.uid() only.';

create function public.has_group_ability_directly(_group_id uuid, _ability text) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select public.is_group_leader(_group_id)
    or exists (
      select 1 from public.group_member_abilities a
      join public.profiles p on p.id = a.profile_id and p.org_id = a.org_id
      where a.profile_id = auth.uid()
        and a.group_id = _group_id
        and a.ability = _ability
        and a.org_id = public.app_current_org_id()
        and p.role <> 'pending'
    );
$$;

comment on function public.has_group_ability_directly(uuid, text) is
  'has_group_ability() without the team route: a leader, or a member a leader gave the ability to by name. Decides who changes the members of a team linked to that ability.';

create function public.team_has_ability(_team_id uuid, _ability text) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.team_abilities ta
    where ta.team_id = _team_id
      and ta.ability = _ability
      and ta.org_id = public.app_current_org_id()
  );
$$;

comment on function public.team_has_ability(uuid, text) is
  'True when the team, in the caller''s own org, is linked to the ability.';

do $$
declare
  f text;
begin
  foreach f in array array[
    'has_group_ability(uuid, text)',
    'has_group_ability_directly(uuid, text)',
    'team_has_ability(uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ── Policies on the new tables ─────────────────────────────────────────────

create policy "org isolation" on public.group_member_abilities
  as restrictive to authenticated, anon
  using (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "Group members and admins can view abilities" on public.group_member_abilities
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_member(group_id)));

create policy "Leaders can grant abilities" on public.group_member_abilities
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id())
    and public.is_group_leader(group_id)
    and granted_by = (select auth.uid()));

create policy "Leaders can remove abilities" on public.group_member_abilities
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.is_group_leader(group_id));

create policy "org isolation" on public.team_abilities
  as restrictive to authenticated, anon
  using (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "Group members and admins can view team abilities" on public.team_abilities
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and ((select public.is_admin())
      or exists (
        select 1 from public.teams t
        where t.id = team_abilities.team_id and t.org_id = team_abilities.org_id
          and public.is_group_member(t.group_id))));

create policy "Leaders can link a team" on public.team_abilities
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id())
    and granted_by = (select auth.uid())
    and exists (
      select 1 from public.teams t
      where t.id = team_abilities.team_id and t.org_id = team_abilities.org_id
        and public.is_group_leader(t.group_id)));

create policy "Leaders can unlink a team" on public.team_abilities
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and exists (
      select 1 from public.teams t
      where t.id = team_abilities.team_id and t.org_id = team_abilities.org_id
        and public.is_group_leader(t.group_id)));

-- ── Members ────────────────────────────────────────────────────────────────
-- A holder of the members ability adds and removes plain members; making,
-- changing or removing a leader stays with leaders and church admins.

drop policy "Leaders and admins can insert group members" on public.group_members;
create policy "Leaders, member managers and admins can add group members" on public.group_members
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id())
    and ((select public.is_admin())
      or public.is_group_leader(group_id)
      or (role = 'member' and public.has_group_ability(group_id, 'members'))));

drop policy "Leaders and admins can delete group members" on public.group_members;
create policy "Leaders, member managers and admins can remove group members" on public.group_members
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and ((select public.is_admin())
      or public.is_group_leader(group_id)
      or (role = 'member' and public.has_group_ability(group_id, 'members'))));

drop policy "Leaders and admins can create group invites" on public.group_invites;
create policy "Member managers and admins can create group invites" on public.group_invites
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id())
    and created_by = (select auth.uid())
    and revoked_at is null
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'members')));

drop policy "Leaders and admins can revoke group invites" on public.group_invites;
create policy "Member managers and admins can revoke group invites" on public.group_invites
  for update to authenticated
  using (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'members')))
  with check (org_id = (select public.app_request_org_id())
    and revoked_at is not null
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'members')));

drop policy "Leaders and admins can view group invites" on public.group_invites;
create policy "Member managers and admins can view group invites" on public.group_invites
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'members')));

drop policy "Leaders and admins can view group invite uses" on public.group_invite_uses;
create policy "Member managers and admins can view group invite uses" on public.group_invite_uses
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'members')));

drop policy "Requesters, leaders and admins can view join requests" on public.group_join_requests;
create policy "Requesters, member managers and admins can view join requests" on public.group_join_requests
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (profile_id = (select auth.uid())
      or (select public.is_admin())
      or public.has_group_ability(group_id, 'members')));

drop policy "Leaders and admins can insert group labels" on public.group_labels;
create policy "Member managers and admins can add group labels" on public.group_labels
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'members')));

drop policy "Leaders and admins can update group labels" on public.group_labels;
create policy "Member managers and admins can update group labels" on public.group_labels
  for update to authenticated
  using (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'members')))
  with check (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'members')));

drop policy "Leaders and admins can delete group labels" on public.group_labels;
create policy "Member managers and admins can delete group labels" on public.group_labels
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'members')));

drop policy "Leaders and admins can insert group member labels" on public.group_member_labels;
create policy "Member managers and admins can label members" on public.group_member_labels
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'members')));

drop policy "Leaders and admins can delete group member labels" on public.group_member_labels;
create policy "Member managers and admins can unlabel members" on public.group_member_labels
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'members')));

-- create or replace keeps each function's owner and grants.
create or replace function public.pending_group_join_requests(_group_id uuid)
  returns table (id uuid, created_at timestamptz, first_name text, last_name text,
                 preferred_name text, email text, suffix text)
  language sql stable security definer
  set search_path = ''
as $$
  select r.id, r.created_at, p.first_name, p.last_name, p.preferred_name,
    case when p.hide_email then null else p.email end,
    p.suffix
  from public.profiles me
  join public.group_join_requests r on r.org_id = me.org_id
  join public.profiles p on p.id = r.profile_id and p.org_id = r.org_id
  where me.id = auth.uid() and me.role <> 'pending'
    and r.group_id = _group_id
    and r.status = 'pending'
    and (public.is_admin() or public.has_group_ability(_group_id, 'members'))
  order by r.created_at;
$$;

comment on function public.pending_group_join_requests(uuid) is
  'Pending requests for a group with each requester''s name and email (NULL when hide_email), for the review list. Tenant anchor: the caller''s own profiles row; rows only when the caller holds the members ability in the group (every leader does) or is an org admin, else empty.';

create or replace function public.review_group_join_request(_request_id uuid, _approve boolean) returns text
  language plpgsql security definer
  set search_path = ''
as $$
declare
  _actor uuid := auth.uid();
  _org uuid;
  _req public.group_join_requests%rowtype;
  _next text;
  _n integer;
begin
  if _approve is null then
    raise exception 'review rejected: approve flag is required' using errcode = '22004';
  end if;
  if _actor is null then
    raise exception 'review rejected: no authenticated principal' using errcode = 'GJ002';
  end if;
  select p.org_id into _org from public.profiles p where p.id = _actor and p.role <> 'pending';
  if _org is null then
    raise exception 'review rejected: actor % is not an approved member', _actor using errcode = 'GJ002';
  end if;

  select r.* into _req from public.group_join_requests r
  where r.id = _request_id and r.org_id = _org and r.status = 'pending'
  for update;
  if not found or not (public.is_admin() or public.has_group_ability(_req.group_id, 'members')) then
    raise exception 'review rejected: no pending join request %', _request_id using errcode = 'GJ004';
  end if;

  if _approve then
    if not exists (
      select 1 from public.profiles p
      where p.id = _req.profile_id and p.org_id = _org and p.role <> 'pending'
    ) then
      raise exception 'review rejected: requester % is not an approved member of org %', _req.profile_id, _org
        using errcode = 'GJ002';
    end if;
    insert into public.group_members (org_id, group_id, profile_id, role, added_by)
    values (_org, _req.group_id, _req.profile_id, 'member', _actor)
    on conflict (group_id, profile_id) do nothing;
  end if;

  _next := case when _approve then 'approved' else 'declined' end;
  update public.group_join_requests
    set status = _next, reviewed_by = _actor, reviewed_at = now()
    where id = _req.id and org_id = _org;
  get diagnostics _n = row_count;
  if _n <> 1 then
    raise exception 'review rejected: join request % was not stamped', _req.id using errcode = 'GJ004';
  end if;
  return _next;
end;
$$;

comment on function public.review_group_join_request(uuid, boolean) is
  'Approves (writes the group_members row) or declines a pending join request in one transaction. Tenant anchor: the caller''s own profiles row; the request is selected by id AND that org with for update, and the caller must hold the members ability in its group (every leader does) or be an org admin (GJ004 for missing, foreign, decided or not permitted). GJ002 when the requester is no longer an approved member. 22004 when _approve is NULL, so a missing flag never reads as a decline.';

-- ── Calendar ───────────────────────────────────────────────────────────────

drop policy "Group leaders can insert events" on public.events;
create policy "Calendar managers can add events" on public.events
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'calendar'));

drop policy "Group leaders can update events" on public.events;
create policy "Calendar managers can update events" on public.events
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'calendar'))
  with check (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'calendar'));

drop policy "Group leaders can delete events" on public.events;
create policy "Calendar managers can delete events" on public.events
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'calendar'));

drop policy "Group leaders can insert event calendars" on public.event_calendars;
create policy "Calendar managers can add event calendars" on public.event_calendars
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'calendar'));

drop policy "Group leaders can update event calendars" on public.event_calendars;
create policy "Calendar managers can update event calendars" on public.event_calendars
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'calendar'))
  with check (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'calendar'));

drop policy "Group leaders can upload event images" on storage.objects;
create policy "Calendar managers can upload event images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (storage.foldername(name))[2] = 'events'
    and exists (
      select 1 from public.events e
      where e.id::text = (storage.foldername(name))[3]
        and public.has_group_ability(e.group_id, 'calendar')
    )
  );

drop policy "Group leaders can update event images" on storage.objects;
create policy "Calendar managers can update event images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (storage.foldername(name))[2] = 'events'
    and exists (
      select 1 from public.events e
      where e.id::text = (storage.foldername(name))[3]
        and public.has_group_ability(e.group_id, 'calendar')
    )
  );

drop policy "Group leaders can delete event images" on storage.objects;
create policy "Calendar managers can delete event images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (storage.foldername(name))[2] = 'events'
    and exists (
      select 1 from public.events e
      where e.id::text = (storage.foldername(name))[3]
        and public.has_group_ability(e.group_id, 'calendar')
    )
  );

-- ── Announcements ──────────────────────────────────────────────────────────

drop policy "Group members can view published announcements" on public.announcements;
create policy "Group members can view published announcements" on public.announcements
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and public.is_group_member(group_id)
    and (is_published or public.has_group_ability(group_id, 'announcements')));

drop policy "Group leaders can insert announcements" on public.announcements;
create policy "Announcement writers can add announcements" on public.announcements
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'announcements'));

drop policy "Group leaders can update announcements" on public.announcements;
create policy "Announcement writers can update announcements" on public.announcements
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'announcements'))
  with check (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'announcements'));

drop policy "Group leaders can delete announcements" on public.announcements;
create policy "Announcement writers can delete announcements" on public.announcements
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'announcements'));

-- ── Lessons ────────────────────────────────────────────────────────────────

drop policy "Group leaders can insert lectures" on public.lectures;
create policy "Lesson managers can add lessons" on public.lectures
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'lessons'));

drop policy "Group leaders can update lectures" on public.lectures;
create policy "Lesson managers can update lessons" on public.lectures
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'lessons'))
  with check (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'lessons'));

drop policy "Group leaders can delete lectures" on public.lectures;
create policy "Lesson managers can delete lessons" on public.lectures
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'lessons'));

drop policy "Group leaders can insert series" on public.lecture_series;
create policy "Lesson managers can add series" on public.lecture_series
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'lessons'));

drop policy "Group leaders can update series" on public.lecture_series;
create policy "Lesson managers can update series" on public.lecture_series
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'lessons'))
  with check (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'lessons'));

drop policy "Group leaders can delete series" on public.lecture_series;
create policy "Lesson managers can delete series" on public.lecture_series
  for delete to authenticated
  using (org_id = (select public.app_request_org_id()) and public.has_group_ability(group_id, 'lessons'));

-- ── Teams and serving ──────────────────────────────────────────────────────

drop policy "Leaders and admins can insert teams" on public.teams;
create policy "Team managers and admins can add teams" on public.teams
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'teams')));

drop policy "Leaders and admins can update teams" on public.teams;
create policy "Team managers and admins can update teams" on public.teams
  for update to authenticated
  using (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'teams')))
  with check (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'teams')));

drop policy "Leaders and admins can delete teams" on public.teams;
create policy "Team managers and admins can delete teams" on public.teams
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.has_group_ability(group_id, 'teams')));

-- Who changes a team's members. An open team: a church admin, a holder of
-- the teams ability, or the team's lead for anyone who is not a lead. A team
-- linked to Prayer care: a church admin, a leader, or a member given Prayer
-- care directly, and nobody else.
create function public.can_change_team_members(_team_id uuid, _row_is_lead boolean) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.teams t
    where t.id = _team_id
      and t.org_id = public.app_current_org_id()
      and (
        public.is_admin()
        or case
          when public.team_has_ability(t.id, 'prayer_care')
            then public.has_group_ability_directly(t.group_id, 'prayer_care')
          else public.has_group_ability(t.group_id, 'teams')
            or (public.is_team_lead(t.id) and not _row_is_lead)
        end
      )
  );
$$;

comment on function public.can_change_team_members(uuid, boolean) is
  'Whether the caller may add, change or remove a team_members row whose is_leader is _row_is_lead. A team linked to Prayer care takes only a church admin, a leader, or someone given Prayer care directly. Tenant anchor: the teams row, read under the caller''s own org.';

revoke execute on function public.can_change_team_members(uuid, boolean) from public, anon;
grant execute on function public.can_change_team_members(uuid, boolean) to authenticated, service_role;

drop policy "Leaders, team leads and admins can insert team members" on public.team_members;
create policy "Team managers, team leads and admins can add team members" on public.team_members
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id())
    and public.can_change_team_members(team_id, is_leader));

drop policy "Leaders and admins can update team members" on public.team_members;
create policy "Team managers and admins can update team members" on public.team_members
  for update to authenticated
  using (org_id = (select public.app_request_org_id())
    and public.can_change_team_members(team_id, true))
  with check (org_id = (select public.app_request_org_id())
    and public.can_change_team_members(team_id, true));

drop policy "Leaders, team leads and admins can delete team members" on public.team_members;
create policy "Team managers, team leads and admins can remove team members" on public.team_members
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and public.can_change_team_members(team_id, is_leader));

drop policy "Team leads and group leaders can insert serving settings" on public.serving_team_settings;
create policy "Team leads and team managers can add serving settings" on public.serving_team_settings
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id())
    and (public.is_team_lead(team_id) or exists (
      select 1 from public.teams t
      where t.id = serving_team_settings.team_id and t.org_id = serving_team_settings.org_id
        and public.has_group_ability(t.group_id, 'teams'))));

drop policy "Team leads and group leaders can update serving settings" on public.serving_team_settings;
create policy "Team leads and team managers can update serving settings" on public.serving_team_settings
  for update to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_team_lead(team_id) or exists (
      select 1 from public.teams t
      where t.id = serving_team_settings.team_id and t.org_id = serving_team_settings.org_id
        and public.has_group_ability(t.group_id, 'teams'))))
  with check (org_id = (select public.app_request_org_id())
    and (public.is_team_lead(team_id) or exists (
      select 1 from public.teams t
      where t.id = serving_team_settings.team_id and t.org_id = serving_team_settings.org_id
        and public.has_group_ability(t.group_id, 'teams'))));

drop policy "Group leaders can delete serving settings" on public.serving_team_settings;
create policy "Team managers can delete serving settings" on public.serving_team_settings
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and exists (
      select 1 from public.teams t
      where t.id = serving_team_settings.team_id and t.org_id = serving_team_settings.org_id
        and public.has_group_ability(t.group_id, 'teams')));

drop policy "Team leads and group leaders can log serving broadcasts" on public.serving_broadcasts;
create policy "Team leads and team managers can log serving broadcasts" on public.serving_broadcasts
  for insert to authenticated
  with check (org_id = (select public.app_request_org_id())
    and sent_by = (select auth.uid())
    and (public.is_team_lead(team_id) or exists (
      select 1 from public.teams t
      where t.id = serving_broadcasts.team_id and t.org_id = serving_broadcasts.org_id
        and public.has_group_ability(t.group_id, 'teams'))));

drop policy "Team leads and group leaders can view serving broadcasts" on public.serving_broadcasts;
create policy "Team leads and team managers can view serving broadcasts" on public.serving_broadcasts
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and (public.is_team_lead(team_id) or exists (
      select 1 from public.teams t
      where t.id = serving_broadcasts.team_id and t.org_id = serving_broadcasts.org_id
        and public.has_group_ability(t.group_id, 'teams'))));

drop policy "Owners, attendees, team leads and group leaders can delete serv" on public.serving_signups;
create policy "Owners, attendees, team leads and team managers can delete" on public.serving_signups
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and (created_by = (select auth.uid())
      or public.is_serving_signup_attendee(id)
      or public.is_team_lead(team_id)
      or exists (
        select 1 from public.teams t
        where t.id = serving_signups.team_id and t.org_id = serving_signups.org_id
          and public.has_group_ability(t.group_id, 'teams'))));

drop policy "Signup owners can remove attendees" on public.serving_signup_attendees;
create policy "Signup owners can remove attendees" on public.serving_signup_attendees
  for delete to authenticated
  using (org_id = (select public.app_request_org_id())
    and exists (
      select 1 from public.serving_signups s
      where s.id = serving_signup_attendees.signup_id and s.org_id = serving_signup_attendees.org_id
        and (s.created_by = (select auth.uid())
          or public.is_team_lead(s.team_id)
          or exists (
            select 1 from public.teams t
            where t.id = s.team_id and t.org_id = s.org_id
              and public.has_group_ability(t.group_id, 'teams')))));

create or replace function public.serving_signup_create(_group_id uuid, _service_date date, _attendee_ids uuid[])
  returns table (signup_id uuid, signup_org_id uuid, created boolean)
  language plpgsql security definer
  set search_path = ''
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
    or public.has_group_ability(_grp, 'teams')
    or exists (
      select 1 from public.team_members tm
      join public.profiles p on p.id = tm.profile_id and p.org_id = tm.org_id
      where tm.profile_id = _actor
        and tm.team_id = _group_id
        and tm.org_id = _org
        and p.role <> 'pending'
    )
  ) then
    raise exception 'serving signup rejected: actor % is not on team %', _actor, _group_id
      using errcode = 'SV004';
  end if;

  return query
  select * from public.serving_signup_apply(_group_id, _service_date, _actor, _attendee_ids);
end;
$$;

comment on function public.serving_signup_create(uuid, date, uuid[]) is
  'Authenticated serving signup entry point. Actor from auth.uid(); tenant anchor: the team''s org pinned against app_request_org_id(), fail-closed on NULL; the RLS INSERT-policy arms (non-pending team member, team lead, or a holder of the teams ability in the team''s group) are re-checked before delegating to serving_signup_apply().';

create or replace function public.serving_team_email_count(_team_id uuid) returns integer
  language sql stable security definer
  set search_path = ''
as $$
  select (
    select count(*)::integer
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id and p.org_id = tm.org_id
    where tm.team_id = t.id
      and tm.org_id = t.org_id
      and p.email <> ''
      and p.role <> 'pending'
      and p.email_announcements
  )
  from public.teams t
  where t.id = _team_id
    and t.org_id = public.app_request_org_id()
    and (public.is_team_lead(t.id) or public.has_group_ability(t.group_id, 'teams'));
$$;

comment on function public.serving_team_email_count(uuid) is
  'How many people on a team have an address on file, are not pending and take announcements. Null unless the caller leads the team or holds the teams ability in its group. Tenant anchor: the teams row, read under the caller''s own org.';

-- ── Prayer requests for the prayer team only ───────────────────────────────
-- A request can go to the whole group or to the group's prayer team only. A
-- prayer-team request is read by its author, the group's leaders and whoever
-- holds Prayer care (the linked team's members, or someone given it by
-- name). It always carries its author's name: an anonymous author is known
-- only by a keyed hash the database cannot check, so RLS could not let them
-- read their own request back.

alter table public.prayer_requests
  add column audience text not null default 'group',
  add constraint prayer_requests_audience_check check (audience in ('group', 'prayer_team')),
  add constraint prayer_requests_prayer_team_named check (audience = 'group' or author_id is not null);

-- Client roles read prayer_requests column by column; author_id stays out.
grant select (audience) on public.prayer_requests to anon, authenticated;

comment on column public.prayer_requests.audience is
  'group: every member of the group reads it. prayer_team: only its author, the group''s leaders and holders of Prayer care.';

drop policy "Group members can view prayer requests" on public.prayer_requests;
create policy "Group members can view prayer requests" on public.prayer_requests
  for select to authenticated
  using (org_id = (select public.app_request_org_id())
    and public.is_group_member(group_id)
    and (audience = 'group'
      or author_id = (select auth.uid())
      or public.has_group_ability(group_id, 'prayer_care')));

-- Appended last, so existing columns keep their positions and grants.
create or replace view public.prayer_wall
  with (security_invoker = true)
as
select
  r.id,
  r.body,
  r.is_anonymous,
  r.is_answered,
  r.created_at,
  coalesce(a.author_id = (select auth.uid()), false) as mine,
  p.first_name,
  p.last_name,
  p.preferred_name,
  p.avatar_url,
  coalesce(pc.praying_count, 0) as praying_count,
  coalesce(pc.i_am_praying, false) as i_am_praying,
  r.org_id,
  r.group_id,
  r.body_ciphertext,
  r.author_hash,
  p.suffix,
  r.audience
from public.prayer_requests r
cross join lateral (select public.prayer_request_visible_author(r.id) as author_id offset 0) a
left join public.profiles p on p.id = a.author_id and p.org_id = r.org_id
left join lateral (
  select count(*)::integer as praying_count,
         bool_or(pr.profile_id = (select auth.uid())) as i_am_praying
  from public.prayer_responses pr
  where pr.request_id = r.id and pr.org_id = r.org_id
) pc on true
where r.org_id = (select public.app_request_org_id());
