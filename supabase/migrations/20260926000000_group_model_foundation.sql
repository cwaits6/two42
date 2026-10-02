-- Group model foundation: org → group → team, plus per-group labels.
--
-- The org exists to hold people; everything members do together belongs
-- to a group. member_groups conflated two of the new layers — a team
-- (serving signups, serving_team_settings, reminders) and a label (the
-- directory filter chip flag). This migration:
--
--   * renames member_groups → teams and profile_groups → team_members in
--     place (ids, serving FKs, the isolation policies, the updated_at
--     trigger and the profiles_directory view all follow the rename);
--   * adds groups and group_members, re-parents teams under a required
--     (group_id, org_id) composite FK, and adds group_labels and
--     group_member_labels;
--   * replaces the team-lead helper is_group_leader(uuid) with
--     is_team_lead(uuid) and re-points the serving policies and the signup
--     RPC, then defines is_group_member / is_group_leader for groups;
--   * gives every existing org one group named from branding.display_name,
--     enrols every approved member, makes every org admin a leader, and
--     attaches every team to it — with row counts asserted.
--
-- serving_signups.group_id, serving_broadcasts.group_id and
-- serving_team_settings.group_id keep their names and still reference
-- teams(id); they are team ids. Reads on teams/team_members stay
-- org-member-wide here — signups are not enrolled into a group yet, so
-- membership-gated reads would hide /serving from a member approved after
-- this lands. The group-scoped-content migration owns that flip.

-- ── Before/after counts for the carry-over assertions ────────────────────
create temporary table group_model_counts as
select
  (select count(*) from public.member_groups)  as teams_before,
  (select count(*) from public.profile_groups) as team_members_before;

-- ── 1. Rename in place ────────────────────────────────────────────────────
alter table public.member_groups rename to teams;
alter table public.profile_groups rename to team_members;
alter table public.team_members rename column group_id to team_id;

alter table public.teams rename constraint member_groups_pkey to teams_pkey;
alter table public.teams rename constraint member_groups_org_id_fkey to teams_org_id_fkey;
alter table public.teams rename constraint member_groups_created_by_fkey to teams_created_by_fkey;
alter table public.teams rename constraint member_groups_id_org_unique to teams_id_org_unique;
alter index public.member_groups_org_id_idx rename to teams_org_id_idx;
alter trigger member_groups_touch_updated_at on public.teams rename to teams_touch_updated_at;

alter table public.team_members rename constraint profile_groups_pkey to team_members_pkey;
alter table public.team_members rename constraint profile_groups_org_id_fkey to team_members_org_id_fkey;
alter table public.team_members rename constraint profile_groups_group_id_fkey to team_members_team_id_fkey;
alter table public.team_members rename constraint profile_groups_profile_id_fkey to team_members_profile_id_fkey;
alter table public.team_members rename constraint profile_groups_assigned_by_fkey to team_members_assigned_by_fkey;
alter index public.profile_groups_org_id_idx rename to team_members_org_id_idx;
alter index public.profile_groups_group_id_idx rename to team_members_team_id_idx;

comment on table public.teams is
  'A team inside one group (greeters, prayer team, hospitality): carries serving signups, reminders and serving_team_settings. Renamed from member_groups.';
comment on table public.team_members is
  'Membership of a team; is_leader marks the team lead. Renamed from profile_groups (group_id → team_id).';

-- ── 2. groups ─────────────────────────────────────────────────────────────
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  name text not null,
  description text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_name_not_blank check (btrim(name) <> ''),
  -- Parent key for every composite FK into groups.
  constraint groups_id_org_unique unique (id, org_id)
);
create index groups_org_id_idx on public.groups (org_id);
alter table public.groups enable row level security;

create trigger groups_touch_updated_at
  before update on public.groups
  for each row execute function public.touch_updated_at();

comment on table public.groups is
  'A class or small group. Holds the content layer (calendar, announcements, lectures, serving, prayer, giving, roster). One level deep: no sub-groups.';

-- ── 3. group_members ──────────────────────────────────────────────────────
create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  group_id uuid not null,
  profile_id uuid not null,
  role text not null default 'member' check (role in ('leader', 'member')),
  joined_at timestamptz not null default now(),
  added_by uuid references auth.users (id) on delete set null,
  -- The only FK from group_members to groups, so the PostgREST embed
  -- groups(...) is unambiguous.
  constraint group_members_group_id_fkey
    foreign key (group_id, org_id) references public.groups (id, org_id) on delete cascade,
  constraint group_members_profile_id_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade,
  constraint group_members_group_profile_key unique (group_id, profile_id),
  -- Parent key for group_member_labels' same-group FK.
  constraint group_members_id_group_org_unique unique (id, group_id, org_id)
);
create index group_members_org_id_idx on public.group_members (org_id);
-- The per-request "which groups am I in" lookup.
create index group_members_profile_org_idx on public.group_members (profile_id, org_id);
alter table public.group_members enable row level security;

comment on table public.group_members is
  'Membership of a group. role = leader is the one permission role above member; display titles are free text on the about page, never permissions.';

-- ── 4. Re-parent teams under groups (nullable until the backfill) ─────────
alter table public.teams add column group_id uuid;
alter table public.teams
  add constraint teams_group_id_fkey
    foreign key (group_id, org_id) references public.groups (id, org_id) on delete cascade;
create index teams_group_id_idx on public.teams (group_id);

-- ── 5. group_labels ───────────────────────────────────────────────────────
create table public.group_labels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  group_id uuid not null,
  name text not null,
  -- Reaches CSS: same six-digit hex boundary as HEX in lib/contrast.ts.
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  constraint group_labels_name_not_blank check (btrim(name) <> ''),
  constraint group_labels_group_id_fkey
    foreign key (group_id, org_id) references public.groups (id, org_id) on delete cascade,
  constraint group_labels_group_name_key unique (group_id, name),
  -- Parent key for group_member_labels' same-group FK.
  constraint group_labels_id_group_org_unique unique (id, group_id, org_id)
);
create index group_labels_org_id_idx on public.group_labels (org_id);
alter table public.group_labels enable row level security;

comment on table public.group_labels is
  'A filter tag defined inside one group (Men, Women, Tuesday table). Attributes, not roles.';

-- ── 6. group_member_labels ────────────────────────────────────────────────
-- Both FKs carry group_id, so a label can only ever be attached to a
-- membership of the group that defines it — structurally, before RLS.
create table public.group_member_labels (
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  group_id uuid not null,
  group_member_id uuid not null,
  label_id uuid not null,
  applied_at timestamptz not null default now(),
  applied_by uuid references auth.users (id) on delete set null,
  primary key (group_member_id, label_id),
  constraint group_member_labels_member_fkey
    foreign key (group_member_id, group_id, org_id)
    references public.group_members (id, group_id, org_id) on delete cascade,
  constraint group_member_labels_label_fkey
    foreign key (label_id, group_id, org_id)
    references public.group_labels (id, group_id, org_id) on delete cascade
);
create index group_member_labels_org_id_idx on public.group_member_labels (org_id);
create index group_member_labels_label_id_idx on public.group_member_labels (label_id);
alter table public.group_member_labels enable row level security;

-- ── 7. Helpers ────────────────────────────────────────────────────────────
-- The seven serving policies below depend on is_group_leader(uuid) by OID,
-- so they go first; they are re-created under is_team_lead in step 9.
drop policy "Members can create serving signups" on public.serving_signups;
drop policy "Members can delete own serving signups" on public.serving_signups;
drop policy "Signup owners can remove attendees" on public.serving_signup_attendees;
drop policy "Leaders and admins can view serving broadcasts" on public.serving_broadcasts;
drop policy "Leaders and admins can log serving broadcasts" on public.serving_broadcasts;
drop policy "Leaders and admins can insert serving settings" on public.serving_team_settings;
drop policy "Leaders and admins can update serving settings" on public.serving_team_settings;

drop function public.is_group_leader(uuid);

-- Team lead: the former is_group_leader, over the renamed tables.
create function public.is_team_lead(_team_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.profile_id = auth.uid()
      and tm.team_id = _team_id
      and tm.is_leader = true
      and tm.org_id = public.app_current_org_id()
  );
$$;

-- Group membership, resolved from auth.uid() only. The org predicate keeps
-- a membership row in another org from ever counting, and is what the
-- tenancy lint's SECURITY DEFINER check looks for.
create function public.is_group_member(_group_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.profile_id = auth.uid()
      and gm.group_id = _group_id
      and gm.org_id = public.app_current_org_id()
  );
$$;

create function public.is_group_leader(_group_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.profile_id = auth.uid()
      and gm.group_id = _group_id
      and gm.role = 'leader'
      and gm.org_id = public.app_current_org_id()
  );
$$;

-- Policy expressions run as the invoking role, and every policy using these
-- is `to authenticated`; anon never needs them.
revoke execute on function public.is_team_lead(uuid)     from public, anon;
revoke execute on function public.is_group_member(uuid)  from public, anon;
revoke execute on function public.is_group_leader(uuid)  from public, anon;
grant  execute on function public.is_team_lead(uuid)     to authenticated;
grant  execute on function public.is_group_member(uuid)  to authenticated;
grant  execute on function public.is_group_leader(uuid)  to authenticated;

comment on function public.is_team_lead(uuid) is
  'True when the caller (auth.uid()) is a lead of the given team in their own org. Formerly is_group_leader.';
comment on function public.is_group_member(uuid) is
  'True when the caller (auth.uid()) is a member of the given group in their own org. Caller resolved from auth.uid() only.';
comment on function public.is_group_leader(uuid) is
  'True when the caller (auth.uid()) is a leader of the given group in their own org. Caller resolved from auth.uid() only.';

-- ── 8. RLS on the new tables ──────────────────────────────────────────────
-- ORG ::= org_id = (select public.app_request_org_id()); every permissive
-- policy is ORG AND (arms). The membership helpers take a row-dependent
-- argument, so they cannot be InitPlan-hoisted like the zero-argument ones
-- and are called bare, as the serving policies already do.

create policy "org isolation" on public.groups
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "Members and admins can view groups" on public.groups
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_member(id))
  );

create policy "Admins can insert groups" on public.groups
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

create policy "Leaders and admins can update groups" on public.groups
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(id))
  )
  with check (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(id))
  );

create policy "Admins can delete groups" on public.groups
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

create policy "org isolation" on public.group_members
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

-- The own-rows arm lets a member resolve their own memberships before any
-- group context exists (the active-group resolver's first query).
create policy "Members and admins can view group members" on public.group_members
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      profile_id = (select auth.uid())
      or public.is_group_member(group_id)
      or (select public.is_admin())
    )
  );

create policy "Leaders and admins can insert group members" on public.group_members
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

create policy "Leaders and admins can update group members" on public.group_members
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  )
  with check (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

create policy "Leaders and admins can delete group members" on public.group_members
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

create policy "org isolation" on public.group_labels
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "Members and admins can view group labels" on public.group_labels
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_member(group_id))
  );

create policy "Leaders and admins can insert group labels" on public.group_labels
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

create policy "Leaders and admins can update group labels" on public.group_labels
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  )
  with check (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

create policy "Leaders and admins can delete group labels" on public.group_labels
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

create policy "org isolation" on public.group_member_labels
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "Members and admins can view group member labels" on public.group_member_labels
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_member(group_id))
  );

create policy "Leaders and admins can insert group member labels" on public.group_member_labels
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

create policy "Leaders and admins can delete group member labels" on public.group_member_labels
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

-- ── 9. RLS on the renamed tables ──────────────────────────────────────────
-- The restrictive "org isolation" policies followed the rename untouched.
-- The permissive ones are re-created under their new names: reads stay
-- org-member-wide (see the header), writes widen from org admins to
-- "org admin or a leader of the team's group".

drop policy "Members can view member groups"   on public.teams;
drop policy "Admins can insert member groups"  on public.teams;
drop policy "Admins can update member groups"  on public.teams;
drop policy "Admins can delete member groups"  on public.teams;

create policy "Members can view teams" on public.teams
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

create policy "Leaders and admins can insert teams" on public.teams
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

create policy "Leaders and admins can update teams" on public.teams
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  )
  with check (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

create policy "Leaders and admins can delete teams" on public.teams
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

drop policy "Members can view profile groups"  on public.team_members;
drop policy "Admins can insert profile groups" on public.team_members;
drop policy "Admins can update profile groups" on public.team_members;
drop policy "Admins can delete profile groups" on public.team_members;

create policy "Members can view team members" on public.team_members
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

-- A team's group is one hop away; the exists() resolves it per row and
-- pins the team to the same org as the membership row.
create policy "Leaders and admins can insert team members" on public.team_members
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.teams t
        where t.id = team_members.team_id
          and t.org_id = team_members.org_id
          and public.is_group_leader(t.group_id)
      )
    )
  );

create policy "Leaders and admins can update team members" on public.team_members
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.teams t
        where t.id = team_members.team_id
          and t.org_id = team_members.org_id
          and public.is_group_leader(t.group_id)
      )
    )
  )
  with check (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.teams t
        where t.id = team_members.team_id
          and t.org_id = team_members.org_id
          and public.is_group_leader(t.group_id)
      )
    )
  );

create policy "Leaders and admins can delete team members" on public.team_members
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.teams t
        where t.id = team_members.team_id
          and t.org_id = team_members.org_id
          and public.is_group_leader(t.group_id)
      )
    )
  );

-- The seven serving policies, body-for-body as before with
-- is_group_leader(group_id) → is_team_lead(group_id) and the membership arm
-- over team_members. serving_*.group_id is a team id.
create policy "Members can create serving signups" on public.serving_signups
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and created_by = (select auth.uid())
    and (
      (select public.is_admin())
      or public.is_team_lead(group_id)
      or exists (
        select 1 from public.team_members tm
        where tm.profile_id = (select auth.uid())
          and tm.team_id = serving_signups.group_id
      )
    )
  );

create policy "Members can delete own serving signups" on public.serving_signups
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      created_by = (select auth.uid())
      or (select public.is_admin())
      or public.is_team_lead(group_id)
    )
  );

create policy "Signup owners can remove attendees" on public.serving_signup_attendees
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and exists (
      select 1 from public.serving_signups s
      where s.id = serving_signup_attendees.signup_id
        and (
          s.created_by = (select auth.uid())
          or (select public.is_admin())
          or public.is_team_lead(s.group_id)
        )
    )
  );

create policy "Leaders and admins can view serving broadcasts" on public.serving_broadcasts
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_team_lead(group_id))
  );

create policy "Leaders and admins can log serving broadcasts" on public.serving_broadcasts
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and sent_by = (select auth.uid())
    and ((select public.is_admin()) or public.is_team_lead(group_id))
  );

create policy "Leaders and admins can insert serving settings" on public.serving_team_settings
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_team_lead(group_id))
  );

create policy "Leaders and admins can update serving settings" on public.serving_team_settings
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_team_lead(group_id))
  );

-- ── 10. Serving signup RPC over the renamed tables ────────────────────────
-- plpgsql bodies resolve relation names at call time, so both functions are
-- re-created with the same bodies and only member_groups → teams,
-- profile_groups → team_members (group_id → team_id) and
-- is_group_leader → is_team_lead changed. Grants are unchanged and restated.
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
  where sts.group_id = _group_id
    and sts.org_id = _org;

  if not coalesce(_enabled, false) then
    raise exception 'serving signups not enabled for group %', _group_id
      using errcode = 'SV003';
  end if;

  -- unique (group_id, service_date) is the race guard. DO NOTHING (not
  -- DO UPDATE) so "who already holds this Sunday" is an explicit branch:
  -- the same member re-signing is an idempotent no-op (created = false), a
  -- different member gets SV001. FOR UPDATE serialises two concurrent
  -- re-signups on the existing row.
  insert into public.serving_signups (org_id, group_id, service_date, family_id, created_by)
  values (_org, _group_id, _service_date, _family_id, _actor_id)
  on conflict (group_id, service_date) do nothing
  returning id into _signup_id;

  if _signup_id is null then
    select s.id, s.created_by into _signup_id, _existing_by
    from public.serving_signups s
    where s.group_id = _group_id
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
begin
  _actor := auth.uid();
  if _actor is null then
    raise exception 'serving signup rejected: no authenticated principal'
      using errcode = 'SV002';
  end if;

  select t.org_id into _org
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
    public.is_admin()
    or public.is_team_lead(_group_id)
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
  'Atomic serving signup + attendee insert pair. Tenant anchor: org_id resolved from the teams row named by _group_id, never a caller parameter; every other row is asserted to carry it. service_role only — the HMAC signed-link route passes its validated profile id as _actor_id.';
comment on function public.serving_signup_create(uuid, date, uuid[]) is
  'Authenticated serving signup entry point. Actor from auth.uid(); tenant anchor: the team''s org pinned against app_request_org_id(), fail-closed on NULL; the RLS INSERT-policy arms are re-checked before delegating to serving_signup_apply().';

-- ── 11. One group per org ─────────────────────────────────────────────────
-- Callable rather than inline so the pgTAP suite can run the same logic
-- against fixture orgs: CI applies migrations to an empty database, where
-- this block has nothing to do. Idempotent — an org that already has a
-- group is left alone. Not SECURITY DEFINER: the migration runner and the
-- test harness both run as postgres, and no client role may execute it.
create function public.group_model_backfill() returns void
  language plpgsql set search_path = ''
as $$
declare
  _org record;
  _group uuid;
  _name text;
  _approved bigint;
  _enrolled bigint;
  _admins bigint;
  _leaders bigint;
  _unassigned bigint;
begin
  -- Approval decisions cannot land between the enrolment and its count.
  lock table public.profiles in share mode;

  for _org in
    select o.id, o.name, o.branding
    from public.organizations o
    order by o.created_at, o.id
  loop
    if not exists (select 1 from public.groups g where g.org_id = _org.id) then
      _name := coalesce(nullif(btrim(_org.branding ->> 'display_name'), ''), _org.name);

      insert into public.groups (org_id, name)
      values (_org.id, _name)
      returning id into _group;

      -- Every approved member, with every org admin as a leader: group
      -- settings move here next and someone has to be able to edit them.
      insert into public.group_members (org_id, group_id, profile_id, role)
      select p.org_id, _group, p.id,
             case when p.role = 'admin' then 'leader' else 'member' end
      from public.profiles p
      where p.org_id = _org.id
        and p.role <> 'pending';

      select count(*) into _approved
      from public.profiles p
      where p.org_id = _org.id and p.role <> 'pending';
      select count(*) into _enrolled
      from public.group_members gm
      where gm.group_id = _group and gm.org_id = _org.id;
      if _enrolled <> _approved then
        raise exception 'group backfill for org %: enrolled % of % approved members',
          _org.id, _enrolled, _approved;
      end if;

      select count(*) into _admins
      from public.profiles p
      where p.org_id = _org.id and p.role = 'admin';
      select count(*) into _leaders
      from public.group_members gm
      where gm.group_id = _group and gm.org_id = _org.id and gm.role = 'leader';
      if _leaders <> _admins then
        raise exception 'group backfill for org %: % leaders for % admins',
          _org.id, _leaders, _admins;
      end if;
    end if;

    -- Teams without a group attach to the org's group when there is exactly
    -- one; with several there is no right answer and the assertion below
    -- refuses rather than guesses.
    if (select count(*) from public.groups g where g.org_id = _org.id) = 1 then
      update public.teams t
      set group_id = (select g.id from public.groups g where g.org_id = _org.id)
      where t.org_id = _org.id
        and t.group_id is null;
    end if;
  end loop;

  select count(*) into _unassigned from public.teams t where t.group_id is null;
  if _unassigned > 0 then
    raise exception 'group backfill: % team(s) still have no group', _unassigned;
  end if;
end;
$$;

revoke execute on function public.group_model_backfill()
  from public, anon, authenticated, service_role;

comment on function public.group_model_backfill() is
  'Gives every org without a group exactly one, named from branding.display_name (fallback: the org name), enrols every approved member, makes every org admin a leader, and attaches unassigned teams. Idempotent. Callable only by the migration runner and the pgTAP harness.';

select public.group_model_backfill();

-- ── 12. Carry-over assertions and the NOT NULL ────────────────────────────
do $$
declare
  _c record;
  _teams_after bigint;
  _team_members_after bigint;
  _orgs bigint;
  _groups bigint;
  _group_orgs bigint;
begin
  select * into _c from group_model_counts;
  select count(*) into _teams_after from public.teams;
  select count(*) into _team_members_after from public.team_members;
  if _teams_after <> _c.teams_before then
    raise exception 'group model: % teams after rename, % member_groups before', _teams_after, _c.teams_before;
  end if;
  if _team_members_after <> _c.team_members_before then
    raise exception 'group model: % team_members after rename, % profile_groups before', _team_members_after, _c.team_members_before;
  end if;

  select count(*) into _orgs from public.organizations;
  select count(*), count(distinct org_id) into _groups, _group_orgs from public.groups;
  if _groups <> _orgs or _group_orgs <> _orgs then
    raise exception 'group model: % group(s) across % org(s) for % organization(s)', _groups, _group_orgs, _orgs;
  end if;
end $$;

drop table group_model_counts;

alter table public.teams alter column group_id set not null;

comment on column public.teams.group_id is
  'The group this team belongs to. Required: a team never exists outside a group.';
comment on column public.serving_signups.group_id is 'Team id (references teams).';
comment on column public.serving_broadcasts.group_id is 'Team id (references teams).';
comment on column public.serving_team_settings.group_id is 'Team id (references teams).';
