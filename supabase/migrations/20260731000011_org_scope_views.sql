-- Org-scope the four views.
--
-- All four are security_invoker (restated explicitly below), so the base
-- tables' RLS — including the restrictive org floor — already applies to
-- every read through them. The explicit org predicate added here is defense
-- in depth (the view stays correct even if its own definition is later
-- reused somewhere RLS doesn't reach), and each view now exposes org_id as
-- its last column so the cross-tenant leak suite can enumerate views the
-- same way it enumerates base tables.
--
-- Column order: existing columns keep their positions (CREATE OR REPLACE
-- VIEW requires it); org_id is appended at the end.

create or replace view public.families_directory
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
  org_id
from public.family_units f
where org_id = (select public.app_request_org_id());

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
      and p.role = any (array['member'::text, 'content_editor'::text, 'admin'::text])
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
  r.author_id = (select auth.uid()) as mine,
  case when r.is_anonymous and r.author_id <> (select auth.uid()) then null::text else p.first_name end as first_name,
  case when r.is_anonymous and r.author_id <> (select auth.uid()) then null::text else p.last_name end as last_name,
  case when r.is_anonymous and r.author_id <> (select auth.uid()) then null::text else p.preferred_name end as preferred_name,
  case when r.is_anonymous and r.author_id <> (select auth.uid()) then null::text else p.avatar_url end as avatar_url,
  coalesce(pc.praying_count, 0) as praying_count,
  coalesce(pc.i_am_praying, false) as i_am_praying,
  r.org_id
from public.prayer_requests r
left join public.profiles p on p.id = r.author_id and p.org_id = r.org_id
left join lateral (
  select
    count(*)::integer as praying_count,
    bool_or(pr.profile_id = (select auth.uid())) as i_am_praying
  from public.prayer_responses pr
  where pr.request_id = r.id
    and pr.org_id = r.org_id
) pc on true
where r.org_id = (select public.app_request_org_id());

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
left join public.profile_groups pg on p.id = pg.profile_id and pg.org_id = p.org_id
left join public.member_groups mg on pg.group_id = mg.id and mg.org_id = p.org_id
where p.is_unlisted = false
  and p.role = any (array['member'::text, 'content_editor'::text, 'admin'::text])
  and p.org_id = (select public.app_request_org_id())
group by p.id;
