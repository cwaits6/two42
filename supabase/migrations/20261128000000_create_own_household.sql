-- A member with no household adds one during profile setup.
--
-- family_units has an admin-only INSERT policy, and household_visible() hides a
-- household from a member until their profile points at it, so the browser can
-- neither insert the row nor read its id back. This function does both writes
-- in one transaction: the household is created with the caller already in it,
-- so it is never empty while they belong to it.
--
-- SECURITY DEFINER bypasses RLS, so the checks below are the tenant boundary:
-- the org comes from auth.uid()'s own profile row, never from a parameter, and
-- the only caller-supplied value is the household's name.
--
-- Error contract:
--   42501  no signed-in principal, or the caller is not a member or church admin
--   22023  the name is blank
--   HH001  the caller already belongs to a household
create function public.create_own_household(_family_name text)
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _org uuid;
  _role text;
  _current_family uuid;
  _name text := btrim(_family_name);
  _family_id uuid;
begin
  if _uid is null then
    raise exception 'create_own_household: no signed-in principal'
      using errcode = '42501';
  end if;

  -- FOR UPDATE: two concurrent calls from one person serialise here, and the
  -- second sees the household the first set.
  select p.org_id, p.role, p.family_id
    into _org, _role, _current_family
    from public.profiles p
   where p.id = _uid
     for update;

  if _org is null or _role is null or _role not in ('member', 'admin') then
    raise exception 'create_own_household: caller is not a member'
      using errcode = '42501';
  end if;

  if _current_family is not null then
    raise exception 'create_own_household: caller already belongs to a household'
      using errcode = 'HH001';
  end if;

  if _name is null or _name = '' then
    raise exception 'create_own_household: household name is blank'
      using errcode = '22023';
  end if;

  insert into public.family_units (org_id, family_name)
  values (_org, _name)
  returning id into _family_id;

  update public.profiles
     set family_id = _family_id
   where id = _uid
     and org_id = _org;

  return _family_id;
end;
$$;

revoke execute on function public.create_own_household(text) from public, anon;
grant execute on function public.create_own_household(text) to authenticated;

comment on function public.create_own_household(text) is
  'Creates a household for the signed-in member and puts their profile in it, returning its id. Tenant anchor: org from auth.uid()''s own profile. Refuses anyone who is not a member or church admin, and anyone already in a household.';
