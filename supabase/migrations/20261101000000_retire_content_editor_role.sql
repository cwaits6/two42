-- The content_editor role is retired: the app already reads it as member,
-- offers it nowhere and admits only admin to /admin, so this is safe to
-- deploy before or after the app. Move the remaining rows, then drop the
-- value from the role check and from every helper, policy and view that
-- still lists it.

update public.profiles set role = 'member' where role = 'content_editor';

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['pending'::text, 'member'::text, 'admin'::text]));

-- create or replace keeps each function's owner and execute grants.
create or replace function public.is_member() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('member', 'admin')
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
      and role in ('member', 'admin')
      and org_id = public.app_current_org_id()
  );
$$;

drop function public.is_content_editor();

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
        and role = any (array['member', 'admin'])
        and (
          (select public.org_directory_visible())
          or public.shares_group_with(id)
        )
      )
    )
  );

create or replace view public.families_directory_full
  with (security_invoker = true)
as
select
  id,
  family_name,
  photo_url,
  case when hide_address then null::text else address_line1 end as address_line1,
  case when hide_address then null::text else address_line2 end as address_line2,
  case when hide_address then null::text else city end as city,
  case when hide_address then null::text else state end as state,
  case when hide_address then null::text else postal_code end as postal_code,
  case when hide_phone_home then null::text else phone_home end as phone_home,
  anniversary,
  created_at,
  updated_at,
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
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', fm.id,
      'first_name', fm.first_name,
      'last_name', fm.last_name,
      'preferred_name', fm.preferred_name,
      'avatar_url', fm.avatar_url,
      'relationship', fm.relationship,
      'is_class_member', fm.is_class_member,
      'birth_month', fm.birth_month,
      'birth_day', fm.birth_day,
      'birth_year', fm.birth_year,
      'claimed_profile_id', fm.claimed_profile_id
    ) order by fm.relationship)
    from public.family_members fm
    where fm.family_id = f.id
      and fm.org_id = f.org_id
  ), '[]'::jsonb) as family_members_list,
  org_id
from public.family_units f
where org_id = (select public.app_request_org_id());

create or replace view public.profiles_directory
  with (security_invoker = true)
as
select
  p.id,
  p.first_name,
  p.last_name,
  p.preferred_name,
  p.avatar_url,
  p.role,
  p.relationship,
  p.bio,
  p.family_id,
  p.created_at,
  case when p.hide_email then null::text else p.email end as email,
  case when p.hide_phone_mobile then null::text else p.phone_mobile end as phone_mobile,
  case when p.hide_phone_home then null::text else p.phone_home end as phone_home,
  case when p.hide_phone_work then null::text else p.phone_work end as phone_work,
  case when p.hide_address then null::text else p.address_line1 end as address_line1,
  case when p.hide_address then null::text else p.address_line2 end as address_line2,
  case when p.hide_address then null::text else p.city end as city,
  case when p.hide_address then null::text else p.state end as state,
  case when p.hide_address then null::text else p.postal_code end as postal_code,
  case when p.hide_birthday then null::smallint else p.birth_month end as birth_month,
  case when p.hide_birthday then null::smallint else p.birth_day end as birth_day,
  case when p.hide_birthday or p.hide_birth_year then null::smallint else p.birth_year end as birth_year,
  case when p.hide_anniversary then null::date else p.anniversary end as anniversary,
  case when p.hide_occupation then null::text else p.occupation end as occupation,
  case when p.hide_occupation then null::text else p.employer end as employer,
  coalesce(
    jsonb_agg(jsonb_build_object('id', mg.id, 'name', mg.name, 'color', mg.color, 'icon', mg.icon) order by mg.display_order)
      filter (where mg.id is not null),
    '[]'::jsonb
  ) as groups,
  p.org_id
from public.profiles p
left join public.team_members pg on p.id = pg.profile_id and pg.org_id = p.org_id
left join public.teams mg on pg.team_id = mg.id and mg.org_id = p.org_id
where p.is_unlisted = false
  and p.role = any (array['member'::text, 'admin'::text])
  and p.org_id = (select public.app_request_org_id())
group by p.id;
