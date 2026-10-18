-- Directory visibility: group membership becomes the people boundary.
--
-- Until now every approved member could read every other approved member's
-- profile and household: the profiles directory arm was `is_member() and
-- is_unlisted = false and role in (...)` and the two household SELECT
-- policies were `is_member()` org-wide. With the group model in place a
-- member sees the people who share a group with them, unless the org admin
-- opens the directory to the whole organization. Org admins read every
-- profile in their org; everyone reads their own profile and household.
--
-- The setting is a typed column on organizations because it is read by RLS:
-- a site_settings key would be a preference, this is a security boundary.
-- The group-model backfill enrolled every approved member of a one-group
-- org into that group, so for such an org the rewritten arms reduce to the
-- old ones; the handle_new_user() addition at the end keeps that true for
-- members approved after the backfill.

-- ── 1. The column ─────────────────────────────────────────────────────────
alter table public.organizations
  add column directory_visibility text not null default 'shared_groups'
    constraint organizations_directory_visibility_check
      check (directory_visibility in ('shared_groups', 'org'));

comment on column public.organizations.directory_visibility is
  'Security boundary read by the profiles, family_units and family_members SELECT policies, not a preference. shared_groups: a member reads only people who share a group with them. org: every approved member reads the whole directory.';

-- ── 2. Grants ─────────────────────────────────────────────────────────────
-- Column privileges on organizations are fail-closed (ADD COLUMN grants
-- nothing), so the new column needs its own SELECT grant; anon never reads
-- it. Supabase's default table-level UPDATE grant still stood on this
-- table, so a permissive UPDATE policy on its own would have handed an org
-- admin name, slug, status and custom_email_domain_enabled. The table-level
-- grant goes and exactly one column comes back.
grant select (directory_visibility) on public.organizations to authenticated;
revoke update on public.organizations from anon, authenticated;
grant update (directory_visibility) on public.organizations to authenticated;

-- ── 3. The one write path: the org's own admin ────────────────────────────
-- The restrictive floor stays the only restrictive policy on the table.
create policy "Admins can set directory visibility" on public.organizations
  for update to authenticated
  using (
    id = (select public.app_request_org_id())
    and (select public.is_admin())
  )
  with check (
    id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

-- ── 4. Read helpers ───────────────────────────────────────────────────────
-- Zero-argument, so policies wrap it as (select ...) and it is an InitPlan.
-- organizations has no org_id; the row is pinned to the caller's own org.
create function public.org_directory_visible() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = public.app_current_org_id()
      and o.directory_visibility = 'org'
  );
$$;

-- Both resolve the caller from auth.uid() only; the argument names the
-- other person or household, never the principal. The org predicate keeps
-- a membership row in another org from ever counting and is what the
-- tenancy lint's SECURITY DEFINER check looks for.
create function public.shares_group_with(_profile_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs
      on theirs.group_id = mine.group_id
     and theirs.org_id = mine.org_id
    where mine.profile_id = auth.uid()
      and theirs.profile_id = _profile_id
      and mine.org_id = public.app_current_org_id()
  );
$$;

create function public.shares_group_with_household(_family_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.group_members theirs
      on theirs.profile_id = p.id
     and theirs.org_id = p.org_id
    join public.group_members mine
      on mine.group_id = theirs.group_id
     and mine.org_id = theirs.org_id
    where p.family_id = _family_id
      and p.org_id = public.app_current_org_id()
      and mine.profile_id = auth.uid()
  );
$$;

-- Policy expressions run as the invoking role, and every policy using these
-- is `to authenticated`; anon never needs them.
revoke execute on function public.org_directory_visible()             from public, anon;
revoke execute on function public.shares_group_with(uuid)             from public, anon;
revoke execute on function public.shares_group_with_household(uuid)   from public, anon;
grant  execute on function public.org_directory_visible()             to authenticated;
grant  execute on function public.shares_group_with(uuid)             to authenticated;
grant  execute on function public.shares_group_with_household(uuid)   to authenticated;

comment on function public.org_directory_visible() is
  'True when the caller''s own org has directory_visibility = org. Zero-argument so policies hoist it as an InitPlan.';
comment on function public.shares_group_with(uuid) is
  'True when the caller (auth.uid()) and the given profile are both members of at least one group in the caller''s own org. Caller resolved from auth.uid() only.';
comment on function public.shares_group_with_household(uuid) is
  'True when the caller (auth.uid()) shares a group with any profile in the given household, in the caller''s own org. Caller resolved from auth.uid() only.';

-- ── 5. The people policies ────────────────────────────────────────────────
-- ORG ::= org_id = (select public.app_request_org_id()); every policy stays
-- ORG AND (arms). The self, admin and own-household arms are unchanged; the
-- directory arm gains the visibility rule. shares_group_with() takes a
-- row-dependent argument, so like is_group_member() it cannot be
-- InitPlan-hoisted and is called bare.

drop policy "Profiles are visible per access rules" on public.profiles;
create policy "Profiles are visible per access rules" on public.profiles
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select auth.uid()) = id
      or (select public.is_admin())
      or (
        family_id is not null
        and family_id = (select public.current_family_id())
        and (select auth.uid()) <> id
        and (select public.is_member())
      )
      or (
        (select public.is_member())
        and is_unlisted = false
        and role = any (array['member', 'content_editor', 'admin'])
        and (
          (select public.org_directory_visible())
          or public.shares_group_with(id)
        )
      )
    )
  );

drop policy "Members can view family units" on public.family_units;
create policy "Members can view family units" on public.family_units
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or id = (select public.current_family_id())
      or (
        (select public.is_member())
        and (
          (select public.org_directory_visible())
          or public.shares_group_with_household(id)
        )
      )
    )
  );

drop policy "Members can view family members" on public.family_members;
create policy "Members can view family members" on public.family_members
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or family_id = (select public.current_family_id())
      or (
        (select public.is_member())
        and (
          (select public.org_directory_visible())
          or public.shares_group_with_household(family_id)
        )
      )
    )
  );

-- ── 6. Signup enrolment for a one-group org ───────────────────────────────
-- Body copied verbatim from 20260802000002_access_requests_approved_role.sql
-- (the live definition); ONLY the group_members block after the
-- organization_members insert is new. Without it a member approved after
-- the group-model backfill would be in no group: an empty directory for
-- them and absent from everyone else's.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  _full_name text := new.raw_user_meta_data->>'full_name';
  _first text;
  _last text;
  _org_ids uuid[];
  _org_id uuid;
  _hint_org_id uuid;
  _role text;
begin
  -- Email matches are case-insensitive: GoTrue lowercases auth emails while
  -- access_requests / family_invites store them as typed, so an exact
  -- comparison would raise TN001 for anyone whose request was entered with
  -- capitals — locking them out of signup entirely.
  select coalesce(array_agg(distinct org_id), '{}') into _org_ids
  from (
    select org_id from public.access_requests
    where lower(email) = lower(new.email) and status = 'approved'
    union
    select org_id from public.family_invites
    where lower(invite_email) = lower(new.email) and accepted_at is null
  ) matches;

  -- Server-set disambiguator only: narrow within the resolved set, never
  -- widen it. (jsonb ->> on a missing key is NULL; a malformed value should
  -- fail the signup loudly rather than be ignored, so no exception handling
  -- around the cast.)
  _hint_org_id := nullif(new.raw_app_meta_data ->> 'org_id', '')::uuid;
  if _hint_org_id is not null and _hint_org_id = any (_org_ids) then
    _org_ids := array[_hint_org_id];
  end if;

  if coalesce(array_length(_org_ids, 1), 0) = 0 then
    raise exception 'signup rejected: no approved access request or invite for %', new.email
      using errcode = 'TN001';
  elsif array_length(_org_ids, 1) > 1 then
    raise exception 'signup ambiguous: % matches approved invitations in multiple organizations', new.email
      using errcode = 'TN002';
  end if;

  _org_id := _org_ids[1];

  -- Approval logic: an approved access request grants its
  -- approved_role, with NULL preserving the previous behavior ('member').
  -- The order by makes a non-NULL approved_role win deterministically if an
  -- org somehow holds two approved requests for the same email. _role stays
  -- NULL — hence 'pending' — when the match came only from family_invites
  -- (the family claim flow promotes it), preserving today's semantics.
  select coalesce(ar.approved_role, 'member') into _role
  from public.access_requests ar
  where lower(ar.email) = lower(new.email)
    and ar.status = 'approved'
    and ar.org_id = _org_id
  order by ar.approved_role is null, ar.created_at desc
  limit 1;
  _role := coalesce(_role, 'pending');

  if _full_name is not null and btrim(_full_name) <> '' then
    if position(' ' in btrim(_full_name)) = 0 then
      _first := btrim(_full_name);
      _last := null;
    else
      _first := btrim(substring(btrim(_full_name) from 1 for (length(btrim(_full_name)) - position(' ' in reverse(btrim(_full_name))))));
      _last := btrim(substring(btrim(_full_name) from (length(btrim(_full_name)) - position(' ' in reverse(btrim(_full_name))) + 2)));
    end if;
  end if;

  insert into public.profiles (id, first_name, last_name, email, role, relationship, org_id)
  values (new.id, _first, _last, new.email, _role, 'primary', _org_id);

  insert into public.organization_members (org_id, profile_id)
  values (_org_id, new.id)
  on conflict do nothing;

  -- One-group orgs: enrol on signup, mirroring group_model_backfill(). With
  -- zero or several groups there is no right answer, so nobody is enrolled.
  -- A family-invite signup lands as 'pending' and is promoted later by the
  -- claim route, which does not enrol.
  if _role <> 'pending'
     and (select count(*) from public.groups g where g.org_id = _org_id) = 1 then
    insert into public.group_members (org_id, group_id, profile_id, role)
    select _org_id, g.id, new.id, 'member'
    from public.groups g
    where g.org_id = _org_id
    on conflict (group_id, profile_id) do nothing;
  end if;

  return new;
end;
$$;
