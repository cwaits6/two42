-- A household whose people with an account have all left the directory leaves
-- it too, with everyone listed in it. A household with no one with an account
-- shows as before.

-- Returns an array so each caller evaluates it once per statement as an
-- InitPlan and household_visible() stays inlinable.
create function public.unlisted_household_ids()
  returns uuid[]
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(array_agg(h.family_id), '{}')
  from (select p.family_id
          from public.profiles p
         where p.org_id = public.app_current_org_id()
           and p.family_id is not null
         group by p.family_id
        having bool_and(p.is_unlisted)) h;
$$;

revoke execute on function public.unlisted_household_ids() from public, anon;
grant execute on function public.unlisted_household_ids() to authenticated;

comment on function public.unlisted_household_ids() is
  'The caller''s church''s households whose people with an account are all unlisted. Org from app_current_org_id(). Read by the family_units policy, family_directory_people() and families_directory_full.';

-- The viewer's facts are arguments so each call site evaluates them once per
-- statement. No SECURITY DEFINER, no SET clause and no subquery in the body: any
-- of them stops Postgres inlining it, and the family_units policy would then call
-- it once per row. Every name in the body is schema-qualified for that reason.
-- The own household is checked before the hidden one, so someone who left the
-- directory still sees their own. The caller confines the household to the
-- viewer's own church.
create function public.household_visible(
  _family_id uuid,
  _is_admin boolean,
  _is_member boolean,
  _own_family_id uuid,
  _directory_open boolean,
  _hidden_family_ids uuid[])
  returns boolean
  language sql
  stable
as $$
  select _is_admin
      or (_is_member and (
            _family_id = _own_family_id
            or (_family_id <> all (_hidden_family_ids)
                and (_directory_open
                     or public.shares_group_with_household(_family_id)))));
$$;

revoke execute on function public.household_visible(uuid, boolean, boolean, uuid, boolean, uuid[]) from public, anon;
grant execute on function public.household_visible(uuid, boolean, boolean, uuid, boolean, uuid[]) to authenticated;

comment on function public.household_visible(uuid, boolean, boolean, uuid, boolean, uuid[]) is
  'Who can see a household: a church admin, or a member in it, or a member in a group with someone in it or in a church whose directory is open, unless every person with an account in it has left the directory. Read by the family_units policy and family_directory_people().';

drop policy "Members can view family units" on public.family_units;
create policy "Members can view family units" on public.family_units
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.household_visible(
      id,
      (select public.is_admin()),
      (select public.is_member()),
      (select public.current_family_id()),
      (select public.org_directory_visible()),
      (select public.unlisted_household_ids())))
  );

-- SECURITY DEFINER because other members can't read family_members. The gate is
-- the family_units policy's own rule, so this can't return the people of a
-- household the policy hides.
create or replace function public.family_directory_people(_family_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', fm.id,
    -- The card shows a preferred name, so a child's other first name would be a
    -- stored detail beyond what's shown.
    'first_name', case
      when public.is_child_without_account(fm.relationship, fm.claimed_profile_id)
        then coalesce(nullif(btrim(fm.preferred_name), ''), fm.first_name)
      else fm.first_name
    end,
    'last_name', fm.last_name,
    'preferred_name', fm.preferred_name,
    'avatar_url', fm.avatar_url,
    'relationship', fm.relationship,
    'is_class_member', fm.is_class_member,
    'birth_month', fm.birth_month,
    'birth_day', fm.birth_day,
    'claimed_profile_id', fm.claimed_profile_id
  ) order by fm.relationship)
  -- A gate in WHERE that names no column of fm runs before the scan, so a
  -- household listing nobody would pay for it. Here it runs at the first row.
  filter (where (select public.household_visible(
    _family_id,
    (select public.is_admin()),
    (select public.is_member()),
    (select public.current_family_id()),
    (select public.org_directory_visible()),
    (select public.unlisted_household_ids())))), '[]'::jsonb)
  from public.family_members fm
  where fm.family_id = _family_id
    and fm.org_id = (select public.app_current_org_id());
$$;

-- A hidden household is left out for every viewer, church admins and its own
-- people included, as profiles_directory leaves out an unlisted person. Church
-- admin reads family_units, never this view.
create or replace view public.families_directory_full
  with (security_invoker = true)
as
select
  f.id,
  f.family_name,
  f.photo_url,
  case when f.hide_address then null::text else f.address_line1 end as address_line1,
  case when f.hide_address then null::text else f.address_line2 end as address_line2,
  case when f.hide_address then null::text else f.city end as city,
  case when f.hide_address then null::text else f.state end as state,
  case when f.hide_address then null::text else f.postal_code end as postal_code,
  case
    when f.phone_profile_id is not null then (
      select case when o.hide_phone_mobile then null::text else o.phone_mobile end
        from public.profiles o
       where o.id = f.phone_profile_id
         and o.org_id = f.org_id
         and o.family_id = f.id
         and o.is_unlisted = false
         and o.role = any (array['member'::text, 'admin'::text])
    )
    when f.hide_phone_home then null::text
    else f.phone_home
  end as phone_home,
  case when public.family_anniversary_hidden(f.id) then null::date else f.anniversary end as anniversary,
  f.created_at,
  f.updated_at,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'preferred_name', p.preferred_name,
      'avatar_url', p.avatar_url,
      'relationship', p.relationship,
      'is_class_member', true,
      'phone_mobile', case when p.hide_phone_mobile then null::text else p.phone_mobile end,
      'birth_month', case when p.hide_birthday then null::smallint else p.birth_month end,
      'birth_day', case when p.hide_birthday then null::smallint else p.birth_day end,
      'birth_year', case when p.hide_birthday or p.hide_birth_year then null::smallint else p.birth_year end
    ) order by p.relationship)
    from public.profiles p
    where p.family_id = f.id
      and p.org_id = f.org_id
      and p.is_unlisted = false
      and p.role = any (array['member'::text, 'admin'::text])
  ), '[]'::jsonb) as members,
  public.family_directory_people(f.id) as family_members_list,
  f.org_id,
  case when public.family_anniversary_hidden(f.id) then null::smallint else f.anniversary_month end as anniversary_month,
  case when public.family_anniversary_hidden(f.id) then null::smallint else f.anniversary_day end as anniversary_day,
  case when public.family_anniversary_hidden(f.id) then null::smallint else f.anniversary_year end as anniversary_year,
  f.phone_profile_id
from public.family_units f
where f.org_id = (select public.app_request_org_id())
  and f.id <> all ((select public.unlisted_household_ids())::uuid[]);

drop function public.household_visible(uuid, boolean, boolean, uuid, boolean);
