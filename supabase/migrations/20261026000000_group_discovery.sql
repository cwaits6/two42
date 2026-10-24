-- Group discovery: an org switch, a per-group private flag, a per-group
-- join policy, and the join requests a member files to get into a group.
--
-- Until now a member only entered a group when its leader or an org admin
-- added them: the groups SELECT policy hides every group a viewer is not
-- in, so there was nothing to find and nothing to ask to join. This
-- migration adds
--
--   * organizations.group_discovery — the ceiling. Off means members see
--     only the groups they belong to and join_group() refuses every group.
--   * groups.is_private / groups.join_policy — a private group is hidden
--     from non-members whatever the org switch says (it can only hide
--     more, never less); join_policy decides whether a member who found a
--     group joins at once (open) or files a request a leader reviews
--     (approval).
--   * group_join_requests — one pending request per (group, member). No
--     client write grant at all: every write goes through the functions
--     below, so a direct INSERT or UPDATE fails with 42501 instead of
--     matching zero rows.
--   * discoverable_groups() / join_group() / pending_group_join_requests()
--     / review_group_join_request() — SECURITY DEFINER entry points, and
--     join_group_apply(), the plain plpgsql policy branch with no client
--     grant that an invite-link wrapper can reuse without the discovery
--     and privacy gate.
--
-- The groups SELECT policy is unchanged: a non-member still cannot read a
-- group row, so /g/<id> still 404s for them. Discovery is a separate read
-- through discoverable_groups(), which returns exactly the columns the
-- discovery row shows.
--
-- SECURITY DEFINER bypasses RLS, so the org checks in the function bodies
-- ARE the tenant boundary on this surface: the org comes from the caller's
-- own profiles row, never from a parameter, and every other row is looked
-- up by id AND that org. schema_tenancy_lint.sql check 4 only proves the
-- source mentions org_id; supabase/tests/group_discovery_suite.sql pins the
-- behaviour.
--
-- Error contract (SQLSTATEs the app maps to member-facing copy):
--   GJ001  the group is not open to join: unknown id, another org, private,
--          or the org switch is off — one code, so the response never says
--          whether a hidden group exists
--   GJ002  no authenticated principal, or not an approved member
--   GJ003  already a member of the group
--   GJ004  no pending request with that id that the caller may review

-- ── 1. The org switch ─────────────────────────────────────────────────────
alter table public.organizations
  add column group_discovery boolean not null default true;

comment on column public.organizations.group_discovery is
  'Ceiling for group discovery. false: members see only the groups they belong to and join_group() refuses every group. Read by discoverable_groups() and join_group(), never by a policy.';

-- Column privileges on organizations are fail-closed (ADD COLUMN grants
-- nothing); the one org-settings UPDATE policy already covers the row.
grant select (group_discovery) on public.organizations to authenticated;
grant update (group_discovery) on public.organizations to authenticated;

-- ── 2. The per-group flags ────────────────────────────────────────────────
alter table public.groups
  add column is_private boolean not null default false,
  add column join_policy text not null default 'approval'
    constraint groups_join_policy_check check (join_policy in ('open', 'approval'));

comment on column public.groups.is_private is
  'Hidden from discovery for non-members regardless of the org switch, and join_group() refuses it. Members and org admins still see the row through discoverable_groups().';
comment on column public.groups.join_policy is
  'open: join_group() enrols the caller at once. approval: join_group() files a group_join_requests row for a leader to review. Not consulted while is_private.';

-- ── 3. group_join_requests ────────────────────────────────────────────────
create table public.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  group_id uuid not null,
  profile_id uuid not null,
  status text not null default 'pending'
    constraint group_join_requests_status_check check (status in ('pending', 'approved', 'declined')),
  -- auth.users carries no org_id, so a plain FK is right here, as on
  -- groups.created_by. NULL with status approved means the requester joined
  -- under the open policy and nobody reviewed the request.
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint group_join_requests_group_id_fkey
    foreign key (group_id, org_id) references public.groups (id, org_id) on delete cascade,
  constraint group_join_requests_profile_id_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade,
  constraint group_join_requests_reviewed_consistent
    check ((status = 'pending') = (reviewed_at is null))
);
create index group_join_requests_org_id_idx on public.group_join_requests (org_id);
create index group_join_requests_org_status_idx on public.group_join_requests (org_id, status);
create index group_join_requests_group_status_idx on public.group_join_requests (group_id, status);
-- A double-click files one request, not two; a declined requester may ask again.
create unique index group_join_requests_one_pending_idx
  on public.group_join_requests (group_id, profile_id) where status = 'pending';
alter table public.group_join_requests enable row level security;

-- No client writes: join_group_apply() and review_group_join_request() are
-- the only write paths, and they run as the owner.
revoke insert, update, delete on public.group_join_requests from anon, authenticated;

comment on table public.group_join_requests is
  'A member''s request to join a group under the approval policy. Written only by join_group_apply() and review_group_join_request(); read by the requester, the group''s leaders and org admins. Declined rows are the record and are never deleted by the app.';

-- ORG ::= org_id = (select public.app_request_org_id()); every permissive
-- policy is ORG AND (arms).
create policy "org isolation" on public.group_join_requests
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

-- is_group_leader() takes a row-dependent argument, so it is called bare.
create policy "Requesters, leaders and admins can view join requests" on public.group_join_requests
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      profile_id = (select auth.uid())
      or (select public.is_admin())
      or public.is_group_leader(group_id)
    )
  );

-- ── 4. The list ───────────────────────────────────────────────────────────
-- Own groups always; other groups when the org switch is on and the group
-- is not private; private groups additionally for org admins, who get them
-- tagged and never a join action. Everything derives from auth.uid(): an
-- anonymous or pending caller matches no profile and gets no rows.
create function public.discoverable_groups()
returns table (
  id uuid,
  name text,
  description text,
  member_count integer,
  is_private boolean,
  join_policy text,
  viewer_role text,
  request_status text
)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select p.org_id, (p.role = 'admin') as is_admin
    from public.profiles p
    where p.id = auth.uid() and p.role <> 'pending'
  ),
  org as (
    select o.group_discovery from public.organizations o join me on o.id = me.org_id
  )
  select
    g.id,
    g.name,
    g.description,
    (select count(*)::int from public.group_members c
      where c.group_id = g.id and c.org_id = g.org_id),
    g.is_private,
    g.join_policy,
    gm.role,
    r.status
  from public.groups g
  cross join me
  cross join org
  left join public.group_members gm
    on gm.group_id = g.id and gm.org_id = g.org_id and gm.profile_id = auth.uid()
  left join public.group_join_requests r
    on r.group_id = g.id and r.org_id = g.org_id
   and r.profile_id = auth.uid() and r.status = 'pending'
  where g.org_id = me.org_id
    and (gm.id is not null or (org.group_discovery and (not g.is_private or me.is_admin)))
  order by (gm.id is null), g.name;
$$;

-- ── 5. Joining ────────────────────────────────────────────────────────────
-- The policy branch, with no discovery or privacy gate: join_group() applies
-- that gate for members who found the group; an invite-link wrapper later
-- validates its token instead. Plain plpgsql with no client grant, so it
-- inherits whichever caller's bypass reaches it. The org comes from the
-- groups row and the actor's own profile must carry the same one.
create function public.join_group_apply(_group_id uuid, _actor_id uuid) returns text
  language plpgsql set search_path = ''
as $$
declare
  _org uuid;
  _policy text;
begin
  select g.org_id, g.join_policy into _org, _policy
  from public.groups g where g.id = _group_id;
  if _org is null then
    raise exception 'join rejected: group % is not open to join', _group_id using errcode = 'GJ001';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = _actor_id and p.org_id = _org and p.role <> 'pending'
  ) then
    raise exception 'join rejected: actor % is not an approved member of org %', _actor_id, _org
      using errcode = 'GJ002';
  end if;

  if exists (
    select 1 from public.group_members m
    where m.group_id = _group_id and m.profile_id = _actor_id and m.org_id = _org
  ) then
    raise exception 'join rejected: actor % is already a member of group %', _actor_id, _group_id
      using errcode = 'GJ003';
  end if;

  if _policy = 'open' then
    insert into public.group_members (org_id, group_id, profile_id, role, added_by)
    values (_org, _group_id, _actor_id, 'member', _actor_id)
    on conflict (group_id, profile_id) do nothing;
    -- A request filed under an earlier approval policy is moot once its
    -- author has joined; reviewed_by stays null to say nobody reviewed it.
    update public.group_join_requests
      set status = 'approved', reviewed_at = now()
      where group_id = _group_id and profile_id = _actor_id
        and org_id = _org and status = 'pending';
    return 'joined';
  end if;

  insert into public.group_join_requests (org_id, group_id, profile_id)
  values (_org, _group_id, _actor_id)
  on conflict (group_id, profile_id) where status = 'pending' do nothing;
  return 'requested';
end;
$$;
revoke execute on function public.join_group_apply(uuid, uuid)
  from public, anon, authenticated, service_role;

-- The member-facing entry point. Org from the caller's own profile; the
-- group is looked up by id AND that org; the org switch must be on and the
-- group not private. One code for all of those, so the response never says
-- whether a hidden group exists.
create function public.join_group(_group_id uuid) returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  _actor uuid := auth.uid();
  _org uuid;
  _private boolean;
  _discovery boolean;
begin
  if _actor is null then
    raise exception 'join rejected: no authenticated principal' using errcode = 'GJ002';
  end if;
  select p.org_id into _org from public.profiles p where p.id = _actor and p.role <> 'pending';
  if _org is null then
    raise exception 'join rejected: actor % is not an approved member', _actor using errcode = 'GJ002';
  end if;

  select g.is_private into _private from public.groups g where g.id = _group_id and g.org_id = _org;
  if _private is null then
    raise exception 'join rejected: group % is not open to join', _group_id using errcode = 'GJ001';
  end if;
  select o.group_discovery into _discovery from public.organizations o where o.id = _org;
  if not coalesce(_discovery, false) or _private then
    raise exception 'join rejected: group % is not open to join', _group_id using errcode = 'GJ001';
  end if;

  return public.join_group_apply(_group_id, _actor);
end;
$$;

-- ── 6. Reviewing ──────────────────────────────────────────────────────────
-- The leader's list: name and email of each pending requester, empty for
-- anyone who neither leads the group nor administers the org. This is the
-- one place a leader reads a profile they may not share a group with, so
-- it carries only what the decision needs and respects hide_email.
create function public.pending_group_join_requests(_group_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  first_name text,
  last_name text,
  preferred_name text,
  email text
)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.created_at, p.first_name, p.last_name, p.preferred_name,
    case when p.hide_email then null else p.email end
  from public.profiles me
  join public.group_join_requests r on r.org_id = me.org_id
  join public.profiles p on p.id = r.profile_id and p.org_id = r.org_id
  where me.id = auth.uid() and me.role <> 'pending'
    and r.group_id = _group_id
    and r.status = 'pending'
    and (public.is_admin() or public.is_group_leader(_group_id))
  order by r.created_at;
$$;

-- Approve inserts the membership and marks the row in one transaction. A
-- row the caller may not review is reported exactly like a missing one.
create function public.review_group_join_request(_request_id uuid, _approve boolean) returns text
  language plpgsql security definer set search_path = ''
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
  if not found or not (public.is_admin() or public.is_group_leader(_req.group_id)) then
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

-- ── 7. Grants ─────────────────────────────────────────────────────────────
revoke execute on function public.discoverable_groups()                    from public, anon;
revoke execute on function public.join_group(uuid)                         from public, anon;
revoke execute on function public.pending_group_join_requests(uuid)        from public, anon;
revoke execute on function public.review_group_join_request(uuid, boolean) from public, anon;
grant  execute on function public.discoverable_groups()                    to authenticated;
grant  execute on function public.join_group(uuid)                         to authenticated;
grant  execute on function public.pending_group_join_requests(uuid)        to authenticated;
grant  execute on function public.review_group_join_request(uuid, boolean) to authenticated;

comment on function public.discoverable_groups() is
  'The groups a member may see on Find a group and Directory › Groups: their own always; others while the org switch is on and the group is not private; private groups additionally for org admins. Tenant anchor: the caller''s own profiles row (auth.uid(), not pending); no parameter. Returns only the columns the discovery row shows.';
comment on function public.join_group_apply(uuid, uuid) is
  'The join_policy branch: open enrols _actor_id and returns joined; approval files a pending group_join_requests row and returns requested. No discovery or privacy gate and no client grant: reached only through join_group() today, and through an invite-link wrapper later. Org from the groups row; _actor_id must be an approved member of it (GJ002). GJ001 unknown group, GJ003 already a member.';
comment on function public.join_group(uuid) is
  'Joins or requests to join a group a member found. Tenant anchor: the caller''s own profiles row (GJ002 when none or pending); the group is looked up by id AND that org, the org switch must be on and the group not private (GJ001 for all four, so a hidden group reads like a missing id). Then join_group_apply().';
comment on function public.pending_group_join_requests(uuid) is
  'Pending requests for a group with each requester''s name and email (NULL when hide_email), for the leader''s review list. Tenant anchor: the caller''s own profiles row; rows only when the caller leads the group or is an org admin, else empty.';
comment on function public.review_group_join_request(uuid, boolean) is
  'Approves (writes the group_members row) or declines a pending join request in one transaction. Tenant anchor: the caller''s own profiles row; the request is selected by id AND that org with for update, and the caller must lead its group or be an org admin (GJ004 for missing, foreign, decided or not permitted). GJ002 when the requester is no longer an approved member. 22004 when _approve is NULL, so a missing flag never reads as a decline.';

-- ── 8. Self-check ─────────────────────────────────────────────────────────
-- Fails the migration, not CI, if the new table's policy or grant shape
-- drifts.
do $$
declare
  _restrictive int;
  _bare int;
begin
  select count(*) into _restrictive from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'group_join_requests'
    and permissive = 'RESTRICTIVE' and qual like '%org\_id%';
  if _restrictive <> 1 then
    raise exception 'group_join_requests: expected exactly one restrictive isolation policy, found %', _restrictive;
  end if;

  select count(*) into _bare from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'group_join_requests'
    and (qual = 'true' or with_check = 'true');
  if _bare <> 0 then
    raise exception 'group_join_requests: % policy(ies) carry a bare true predicate', _bare;
  end if;

  if has_table_privilege('authenticated', 'public.group_join_requests', 'insert')
     or has_table_privilege('authenticated', 'public.group_join_requests', 'update')
     or has_table_privilege('authenticated', 'public.group_join_requests', 'delete') then
    raise exception 'group_join_requests: authenticated must hold no table-level write privilege';
  end if;
end $$;
