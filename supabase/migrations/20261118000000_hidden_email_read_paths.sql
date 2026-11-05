-- Read paths for a person's address that do not need SELECT on
-- profiles.email, so that grant can be taken from client roles once the app
-- no longer reads the column. A person reads their own through
-- get_own_email(), a church admin reads their church's through
-- admin_member_emails(), and everyone else reads the directory view, which
-- carries an address only when its owner shows it.

-- The directory's address for one person: null when they hide it. The view
-- runs with the caller's rights, so this is what lets it answer without the
-- column grant. The visibility arms mirror the profiles read policy, because
-- a definer function is not subject to it and this one takes any id.
create function public.profile_directory_email(_profile_id uuid)
  returns text
  language sql stable security definer set search_path = ''
as $$
  select p.email
  from public.profiles p
  where p.id = _profile_id
    and p.org_id = public.app_request_org_id()
    and not p.hide_email
    and (
      p.id = auth.uid()
      or public.is_admin()
      or (p.family_id is not null and p.family_id = public.current_family_id() and public.is_member())
      or (
        public.is_member()
        and not p.is_unlisted
        and p.role in ('member', 'admin')
        and (public.org_directory_visible() or public.shares_group_with(p.id))
      )
    );
$$;
revoke execute on function public.profile_directory_email(uuid) from public, anon, service_role;
grant execute on function public.profile_directory_email(uuid) to authenticated;
comment on function public.profile_directory_email(uuid) is
  'A person''s address as the directory shows it: null when hide_email, and null wherever the profiles read policy hides the person from the caller. Tenant anchor: the caller''s own org, never a parameter. Mirrors the profiles read policy and must change with it.';

-- Every address in the caller's church, hidden or not, for a church admin.
-- Anyone else gets no rows.
create function public.admin_member_emails()
  returns table (profile_id uuid, email text)
  language sql stable security definer set search_path = ''
as $$
  select p.id, p.email
  from public.profiles p
  where p.org_id = public.app_request_org_id()
    and public.is_admin();
$$;
revoke execute on function public.admin_member_emails() from public, anon, service_role;
grant execute on function public.admin_member_emails() to authenticated;
comment on function public.admin_member_emails() is
  'Every profile id and address in the caller''s church, hidden or not. Rows only for a church admin. Tenant anchor: the caller''s own org; takes no parameter.';

-- How many people an email to a team reaches, for the people who may send
-- one: the team's lead or a leader of its group. Counts by the send's own
-- rule, so the number shown before a send is the number sent. Null for
-- anyone else.
create function public.serving_team_email_count(_team_id uuid)
  returns integer
  language sql stable security definer set search_path = ''
as $$
  select (
    select count(*)::integer
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id and p.org_id = tm.org_id
    where tm.team_id = t.id
      and tm.org_id = t.org_id
      and p.email is not null
      and p.role <> 'pending'
      and p.email_announcements
  )
  from public.teams t
  where t.id = _team_id
    and t.org_id = public.app_request_org_id()
    and (public.is_team_lead(t.id) or public.is_group_leader(t.group_id));
$$;
revoke execute on function public.serving_team_email_count(uuid) from public, anon, service_role;
grant execute on function public.serving_team_email_count(uuid) to authenticated;
comment on function public.serving_team_email_count(uuid) is
  'How many people on a team have an address on file, are not pending and take announcements. Null unless the caller leads the team or its group. Tenant anchor: the teams row, read under the caller''s own org.';

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
  public.profile_directory_email(p.id) as email,
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
