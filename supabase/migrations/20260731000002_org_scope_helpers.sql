-- Org-scope every SECURITY DEFINER
-- helper. SECURITY DEFINER reads bypass RLS, so an id-taking helper
-- trusting its argument would resolve rows from another org; each one now
-- carries its own org check instead of trusting the caller. The self-scoped
-- helpers (they read only the caller's own profiles row, which defines the
-- org) get the same predicate anyway so the pattern is uniform and
-- greppable — the schema lint asserts every SECURITY DEFINER function that
-- reads an org-owned table references org_id.
--
-- Also fixes the one DB-layer bare-key settings read:
-- giving_stewards_can_manage() filtered site_settings on key alone, which
-- at two orgs matches two rows and raises SQLSTATE 21000 in every giving
-- policy that calls it.

-- Self-scoped role helpers ---------------------------------------------------

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
      and org_id = public.app_current_org_id()
  );
$$;

create or replace function public.is_member() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('member', 'content_editor', 'admin')
      and org_id = public.app_current_org_id()
  );
$$;

create or replace function public.is_content_editor() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('content_editor', 'admin')
      and org_id = public.app_current_org_id()
  );
$$;

create or replace function public.is_household_manager() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and relationship in ('primary', 'spouse')
      and role in ('member', 'content_editor', 'admin')
      and org_id = public.app_current_org_id()
  );
$$;

create or replace function public.is_prayer_warrior() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_prayer_warrior
      and org_id = public.app_current_org_id()
  );
$$;

create or replace function public.current_family_id() returns uuid
  language sql stable security definer set search_path = ''
as $$
  select family_id from public.profiles
  where id = auth.uid()
    and org_id = public.app_current_org_id();
$$;

create or replace function public.get_own_role() returns text
  language sql stable security definer set search_path = ''
as $$
  select role from public.profiles
  where id = auth.uid()
    and org_id = public.app_current_org_id();
$$;

create or replace function public.get_own_email() returns text
  language sql stable security definer set search_path = ''
as $$
  select email from public.profiles
  where id = auth.uid()
    and org_id = public.app_current_org_id();
$$;

-- Argument-taking helpers: the org check is load-bearing here — the id
-- argument is caller-supplied and could name another org's row -------------

create or replace function public.get_profile_role(profile_id uuid) returns text
  language sql stable security definer set search_path = ''
as $$
  select role
  from public.profiles
  where id = profile_id
    and family_id = public.current_family_id()
    and org_id = public.app_current_org_id();
$$;

create or replace function public.get_profile_email(profile_id uuid) returns text
  language sql stable security definer set search_path = ''
as $$
  select email
  from public.profiles
  where id = profile_id
    and family_id = public.current_family_id()
    and org_id = public.app_current_org_id();
$$;

create or replace function public.is_group_leader(_group_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profile_groups pg
    join public.member_groups g on g.id = pg.group_id
    where pg.profile_id = auth.uid()
      and pg.group_id = _group_id
      and pg.is_leader = true
      and g.org_id = public.app_current_org_id()
  );
$$;

create or replace function public.giving_can_manage_fund(_fund_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or (
    public.giving_stewards_can_manage() and exists (
      select 1 from public.giving_funds f
      where f.id = _fund_id and f.steward_id = auth.uid()
        and f.org_id = public.app_current_org_id()
    )
  );
$$;

-- Bare-key settings read: scalar subquery over site_settings filtered
-- only on key raises 21000 the moment two orgs both hold the row. The org
-- filter also makes each org's own giving_manage_mode value authoritative.
create or replace function public.giving_stewards_can_manage() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select value from public.site_settings
      where key = 'giving_manage_mode'
        and org_id = public.app_current_org_id()),
    'stewards'
  ) = 'stewards';
$$;

-- Prayer-access sync triggers: org equality on the profile_groups →
-- member_groups join so a cross-org group row can never flip a profile's
-- prayer-access flag. (These run on trigger, not per-request, so the org
-- comes from the joined rows themselves, not the caller.) ------------------

create or replace function public.sync_prayer_access_for_group() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  -- Same locking discipline as the per-profile sync, and in deterministic
  -- (id) order so two concurrent group-wide recomputes can't deadlock.
  perform 1
  from public.profiles
  where id in (
    select profile_id from public.profile_groups where group_id = new.id
  )
  order by id
  for update;

  update public.profiles p
  set is_prayer_warrior = exists (
    select 1
    from public.profile_groups pg
    join public.member_groups g on g.id = pg.group_id
      and g.org_id = pg.org_id
    where pg.profile_id = p.id
      and g.grants_prayer_access
  )
  where p.id in (
    select profile_id from public.profile_groups where group_id = new.id
  );
  return null;
end;
$$;

create or replace function public.sync_prayer_access_for_profile() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  _profile_id uuid := coalesce(new.profile_id, old.profile_id);
begin
  -- Lock the profile row before recomputing so concurrent membership changes
  -- for the same profile serialize here: under read committed, the statement
  -- after the lock is granted runs with a fresh snapshot that includes the
  -- other transaction's committed writes, so the last recompute can't clobber
  -- the flag with a stale membership view.
  perform 1 from public.profiles where id = _profile_id for update;

  update public.profiles
  set is_prayer_warrior = exists (
    select 1
    from public.profile_groups pg
    join public.member_groups g on g.id = pg.group_id
      and g.org_id = pg.org_id
    where pg.profile_id = _profile_id
      and g.grants_prayer_access
  )
  where id = _profile_id;
  return null;
end;
$$;

-- is_org_member(_org_id) and is_platform_admin() are unchanged: the former
-- takes its org explicitly by design (that IS its argument), the latter
-- reads platform_admins, which is org-orthogonal by design.
