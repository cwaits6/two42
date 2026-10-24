-- Self-serve group creation under a per-org policy.
--
-- Until now only an org admin could create a group: the groups INSERT
-- policy is is_admin() and the group_members INSERT policy admits an admin
-- or a leader of the group, so a plain member had no way to start a group
-- or become its first leader. This migration adds
--
--   * organizations.group_creation_policy — open (any approved member, live
--     at once), approval (a member files a request an org admin approves)
--     or admins (org admins only). RLS and the RPC below read it, so it is a
--     security boundary and a typed column, like directory_visibility.
--   * group_requests — a pending request is its own row, not a status on
--     groups. Every consumer of groups (the one-group signup enrolment, the
--     content backfill, the directory helpers, the one-calendar-per-group
--     invariant) assumes a groups row is a live group; a 'pending' status
--     would need a predicate on each of them and a lint to keep it there.
--   * group_create() / group_request_approve() — SECURITY DEFINER entry
--     points over a shared plpgsql core, so a group, its leader row and its
--     calendar are written in one transaction. The browser cannot do that
--     across three PostgREST statements, and a failure between them would
--     leave a leaderless group nobody can reach.
--
-- SECURITY DEFINER bypasses RLS, so the org checks in the function bodies
-- ARE the tenant boundary on this surface: the org comes from the caller's
-- own profiles row, never from a parameter, and every other row is asserted
-- to carry it before anything is written. schema_tenancy_lint.sql check 4
-- only proves the source mentions org_id; supabase/tests/group_creation_suite.sql
-- pins the behaviour.
--
-- Error contract (SQLSTATEs the app maps to member-facing copy):
--   GC001  the org's policy does not let this caller create a group
--   GC002  no authenticated principal, or not an approved member
--   GC003  the named leader is not an approved member of the caller's org
--   GC004  no pending request with that id in the caller's org
--   GC005  only an org admin may do this (name another leader; approve)
--   GC006  the group name is blank

-- ── 1. The org column and its grants ──────────────────────────────────────
alter table public.organizations
  add column group_creation_policy text not null default 'approval'
    constraint organizations_group_creation_policy_check
      check (group_creation_policy in ('open', 'approval', 'admins'));

comment on column public.organizations.group_creation_policy is
  'Who may create a group. open: any approved member, live at once. approval: a member files a request an org admin approves. admins: org admins only. Read by group_create() and the group_requests INSERT policy, so a security boundary, not a preference.';

-- Column privileges on organizations are fail-closed (ADD COLUMN grants
-- nothing); anon never reads or writes this one.
grant select (group_creation_policy) on public.organizations to authenticated;
grant update (group_creation_policy) on public.organizations to authenticated;

-- The one permissive write policy is whole-row (own org and is_admin());
-- the column grants are what confine an admin to the settings columns. It
-- now carries two of them, so it stops naming one.
alter policy "Admins can set directory visibility" on public.organizations
  rename to "Admins can set org settings";

-- ── 2. The zero-argument reader ───────────────────────────────────────────
-- NULL for anon or a principal with no profile, which fails every
-- comparison closed. Zero arguments so policies hoist it as an InitPlan.
create function public.org_group_creation_policy() returns text
  language sql stable security definer set search_path = ''
as $$
  select o.group_creation_policy from public.organizations o
  where o.id = public.app_current_org_id();
$$;
revoke execute on function public.org_group_creation_policy() from public, anon;
grant  execute on function public.org_group_creation_policy() to authenticated;

comment on function public.org_group_creation_policy() is
  'The caller''s own org''s group_creation_policy; NULL when the caller has no org. Zero-argument so policies hoist it as an InitPlan.';

-- ── 3. group_requests ─────────────────────────────────────────────────────
create table public.group_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  requested_by uuid not null,
  name text not null,
  description text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined')),
  -- auth.users carries no org_id, so a plain FK is right here, as on
  -- groups.created_by.
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  group_id uuid,
  created_at timestamptz not null default now(),
  constraint group_requests_name_not_blank check (btrim(name) <> ''),
  constraint group_requests_requested_by_fkey
    foreign key (requested_by, org_id) references public.profiles (id, org_id) on delete cascade,
  constraint group_requests_group_id_fkey
    foreign key (group_id, org_id) references public.groups (id, org_id)
    on delete set null (group_id)
);
create index group_requests_org_id_idx on public.group_requests (org_id);
create index group_requests_org_status_idx on public.group_requests (org_id, status);
-- A double-click files one request, not two.
create unique index group_requests_one_pending_per_name
  on public.group_requests (org_id, requested_by, name) where status = 'pending';
alter table public.group_requests enable row level security;

-- Admins decide a request by status only; the filed fields stay as the member wrote them.
revoke update on public.group_requests from anon, authenticated;
grant update (status, reviewed_by, reviewed_at) on public.group_requests to authenticated;

comment on table public.group_requests is
  'A member''s request for a new group under the approval policy. Approval goes through group_request_approve(), which creates the group and links it here; decline is a plain UPDATE. Declined rows are the record and are never deleted by the app.';

-- ORG ::= org_id = (select public.app_request_org_id()); every permissive
-- policy is ORG AND (arms).
create policy "org isolation" on public.group_requests
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "Requesters and admins can view group requests" on public.group_requests
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (requested_by = (select auth.uid()) or (select public.is_admin()))
  );

-- The policy, not the UI, is what keeps a request out of an org that is
-- open or admins-only.
create policy "Members can request a group under approval mode" on public.group_requests
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and requested_by = (select auth.uid())
    and (select public.is_member())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and group_id is null
    and (select public.org_group_creation_policy()) = 'approval'
  );

-- Only a pending request is reviewable: once decided it is the record, so
-- a stale decline cannot overwrite an approval. 'approved' is reachable only
-- through group_request_approve(), so an approved request always names the
-- group it created.
create policy "Admins can review group requests" on public.group_requests
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
    and status = 'pending'
  )
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
    and group_id is null
    and (
      (status = 'pending' and reviewed_by is null and reviewed_at is null)
      or (status = 'declined' and reviewed_by = (select auth.uid()) and reviewed_at is not null)
    )
  );

-- ── 4. The shared core ────────────────────────────────────────────────────
-- Plain plpgsql with no client grant: reachable only through the two
-- definer entry points below, which have already resolved and checked _org.
create function public.group_create_for(
  _org uuid, _name text, _description text, _leader uuid, _created_by uuid
) returns uuid
  language plpgsql set search_path = ''
as $$
declare
  _group uuid;
begin
  -- The leader must be an approved member of this org; a pending or
  -- foreign profile is refused before any row is written.
  if not exists (
    select 1 from public.profiles p
    where p.id = _leader and p.org_id = _org and p.role <> 'pending'
  ) then
    raise exception 'group creation rejected: leader % is not an approved member of org %', _leader, _org
      using errcode = 'GC003';
  end if;

  insert into public.groups (org_id, name, description, created_by)
  values (_org, btrim(_name), nullif(btrim(coalesce(_description, '')), ''), _created_by)
  returning id into _group;

  insert into public.group_members (org_id, group_id, profile_id, role, added_by)
  values (_org, _group, _leader, 'leader', _created_by);

  -- The group is the calendar: one row, named after the group, Clay.
  insert into public.event_calendars (org_id, group_id, name, color)
  values (_org, _group, btrim(_name), '#B85C38');

  return _group;
end;
$$;
revoke execute on function public.group_create_for(uuid, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function public.group_create_for(uuid, text, text, uuid, uuid) is
  'Writes a group, its leader row and its calendar in one transaction. No client grant: called only by group_create() and group_request_approve(), which resolve _org from the caller''s own profile. Raises GC003 when the leader is not an approved member of _org.';

-- ── 5. The authenticated entry points ─────────────────────────────────────
create function public.group_create(
  _name text, _description text default null, _leader_id uuid default null
) returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  _actor uuid := auth.uid();
  _org uuid;
  _admin boolean;
  _policy text;
  _leader uuid;
begin
  if _actor is null then
    raise exception 'group creation rejected: no authenticated principal' using errcode = 'GC002';
  end if;
  -- Org and role from the caller's own profile, never a parameter.
  select p.org_id, p.role = 'admin' into _org, _admin
  from public.profiles p where p.id = _actor and p.role <> 'pending';
  if _org is null then
    raise exception 'group creation rejected: actor % is not an approved member', _actor using errcode = 'GC002';
  end if;
  if _name is null or btrim(_name) = '' then
    raise exception 'group creation rejected: name is required' using errcode = 'GC006';
  end if;

  _leader := coalesce(_leader_id, _actor);
  if not _admin then
    if _leader <> _actor then
      raise exception 'group creation rejected: only an org admin may name another leader' using errcode = 'GC005';
    end if;
    select o.group_creation_policy into _policy from public.organizations o where o.id = _org;
    if _policy is distinct from 'open' then
      raise exception 'group creation rejected: org policy is %', coalesce(_policy, 'unknown') using errcode = 'GC001';
    end if;
  end if;

  return public.group_create_for(_org, _name, _description, _leader, _actor);
end;
$$;

create function public.group_request_approve(_request_id uuid) returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  _actor uuid := auth.uid();
  _org uuid;
  _req public.group_requests%rowtype;
  _group uuid;
begin
  if _actor is null then
    raise exception 'group approval rejected: no authenticated principal' using errcode = 'GC002';
  end if;
  select p.org_id into _org from public.profiles p where p.id = _actor and p.role = 'admin';
  if _org is null then
    raise exception 'group approval rejected: actor % is not an org admin', _actor using errcode = 'GC005';
  end if;

  -- The request must be in the admin's own org; a foreign or missing id is
  -- the same error so the response confirms nothing.
  select r.* into _req from public.group_requests r
  where r.id = _request_id and r.org_id = _org and r.status = 'pending'
  for update;
  if not found then
    raise exception 'group approval rejected: no pending request %', _request_id using errcode = 'GC004';
  end if;

  _group := public.group_create_for(_org, _req.name, _req.description, _req.requested_by, _req.requested_by);

  update public.group_requests
  set status = 'approved', group_id = _group, reviewed_by = _actor, reviewed_at = now()
  where id = _req.id and org_id = _org;

  return _group;
end;
$$;

revoke execute on function public.group_create(text, text, uuid) from public, anon;
grant  execute on function public.group_create(text, text, uuid) to authenticated;
revoke execute on function public.group_request_approve(uuid) from public, anon;
grant  execute on function public.group_request_approve(uuid) to authenticated;

comment on function public.group_create(text, text, uuid) is
  'Creates a group with its leader and calendar. Tenant anchor: the caller''s own profiles row (org and role), never a parameter. A non-admin may only lead the group themselves (GC005) and only under the open policy (GC001); an admin may name any approved member of their org (GC003 otherwise). GC002: not an approved member. GC006: blank name.';

comment on function public.group_request_approve(uuid) is
  'Turns a pending group request into a group led by its requester. Tenant anchor: the caller''s own profiles row, which must be an org admin (GC005); the request is looked up by id AND that org (GC004 for missing or foreign). GC003 when the requester is no longer an approved member.';

-- ── 6. Self-check ─────────────────────────────────────────────────────────
-- Fails the migration, not CI, if the new table's policy shape drifts.
do $$
declare
  _restrictive int;
  _bare int;
begin
  select count(*) into _restrictive from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'group_requests'
    and permissive = 'RESTRICTIVE' and qual like '%org\_id%';
  if _restrictive <> 1 then
    raise exception 'group_requests: expected exactly one restrictive isolation policy, found %', _restrictive;
  end if;

  select count(*) into _bare from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'group_requests'
    and (qual = 'true' or with_check = 'true');
  if _bare <> 0 then
    raise exception 'group_requests: % policy(ies) carry a bare true predicate', _bare;
  end if;
end $$;
