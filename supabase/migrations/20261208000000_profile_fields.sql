-- Gender, title and suffix on profiles, and a child's grade on family_members,
-- for every church. Additive and nullable; each read path below is its latest
-- definition with only the new column added.

alter table public.profiles
  add column gender text
    constraint profiles_gender_check check (gender in ('male', 'female')),
  add column title text
    constraint profiles_title_check
      check (title is null or (char_length(title) between 1 and 40 and title = btrim(title))),
  add column suffix text
    constraint profiles_suffix_check
      check (suffix is null or (char_length(suffix) between 1 and 20 and suffix = btrim(suffix)));

alter table public.family_members
  add column graduation_year smallint
    constraint family_members_graduation_year_check check (graduation_year between 2000 and 2100);

comment on column public.profiles.gender is
  'Male or female, or null. Filters the directory; never shown as text there, and never a condition of joining a group.';
comment on column public.profiles.title is
  'Shown only on the person''s profile page and a group''s Leadership list.';
comment on column public.profiles.suffix is
  'Part of the name everywhere a name shows.';
comment on column public.family_members.graduation_year is
  'Expected high-school graduation year; the grade shown is worked out from it on each school year''s 1 August. No rule ties it to relationship, so relabelling a graded person never fails; the app shows it for a child only.';

-- SELECT on profiles is granted per column, and ADD COLUMN grants nothing.
grant select (gender, title, suffix) on public.profiles to anon, authenticated;

-- Appended after org_id, so existing columns keep their positions and grants.
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
  p.phone_mobile,
  p.phone_home,
  p.phone_work,
  p.address_line1,
  p.address_line2,
  p.city,
  p.state,
  p.postal_code,
  p.birth_month,
  p.birth_day,
  p.birth_year,
  p.anniversary,
  p.occupation,
  p.employer,
  coalesce(
    jsonb_agg(jsonb_build_object('id', mg.id, 'name', mg.name, 'color', mg.color, 'icon', mg.icon) order by mg.display_order)
      filter (where mg.id is not null),
    '[]'::jsonb
  ) as groups,
  p.org_id,
  p.suffix,
  p.gender
from public.profiles p
left join public.team_members pg on p.id = pg.profile_id and pg.org_id = p.org_id
left join public.teams mg on pg.team_id = mg.id and mg.org_id = p.org_id
where p.is_unlisted = false
  and p.role = any (array['member'::text, 'admin'::text])
  and p.org_id = (select public.app_request_org_id())
group by p.id;

-- The household_visible() gate is what keeps a child's grade from anyone who
-- cannot see the household.
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
    'claimed_profile_id', fm.claimed_profile_id,
    'graduation_year', fm.graduation_year
  ) order by fm.relationship)
  -- A gate in WHERE that names no column of fm runs before the scan, so a
  -- household listing nobody would pay for it. Here it runs at the first row.
  -- families_directory_full calls this once per household, so the hidden test
  -- reads this household's profiles, not the church-wide unlisted_household_ids().
  filter (where (select public.household_visible(
    _family_id,
    (select public.is_admin()),
    (select public.is_member()),
    (select public.current_family_id()),
    (select public.org_directory_visible()),
    coalesce((select array[_family_id]
                from public.profiles p
               where p.family_id = _family_id
                 and p.org_id = (select public.app_current_org_id())
                 and p.role = any (array['member'::text, 'admin'::text])
              having bool_and(p.is_unlisted)), '{}'::uuid[])))), '[]'::jsonb)
  from public.family_members fm
  where fm.family_id = _family_id
    and fm.org_id = (select public.app_current_org_id());
$$;

-- A hidden household is left out for every viewer, church admins and its own
-- people included, as profiles_directory leaves out an unlisted person.
create or replace view public.families_directory_full
  with (security_invoker = true)
as
select
  f.id,
  f.family_name,
  f.photo_url,
  f.address_line1,
  f.address_line2,
  f.city,
  f.state,
  f.postal_code,
  case
    when f.phone_profile_id is not null then (
      select o.phone_mobile
        from public.profiles o
       where o.id = f.phone_profile_id
         and o.org_id = f.org_id
         and o.family_id = f.id
         and o.is_unlisted = false
         and o.role = any (array['member'::text, 'admin'::text])
    )
    else f.phone_home
  end as phone_home,
  f.anniversary,
  f.created_at,
  f.updated_at,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'preferred_name', p.preferred_name,
      'suffix', p.suffix,
      'avatar_url', p.avatar_url,
      'relationship', p.relationship,
      'is_class_member', true,
      'phone_mobile', p.phone_mobile,
      'birth_month', p.birth_month,
      'birth_day', p.birth_day,
      'birth_year', p.birth_year
    ) order by p.relationship)
    from public.profiles p
    where p.family_id = f.id
      and p.org_id = f.org_id
      and p.is_unlisted = false
      and p.role = any (array['member'::text, 'admin'::text])
  ), '[]'::jsonb) as members,
  public.family_directory_people(f.id) as family_members_list,
  f.org_id,
  f.anniversary_month,
  f.anniversary_day,
  f.anniversary_year,
  f.phone_profile_id
from public.family_units f
where f.org_id = (select public.app_request_org_id())
  and f.id <> all ((select public.unlisted_household_ids())::uuid[]);

-- Appended last, so existing columns keep their positions and grants. The
-- author is still joined only through prayer_request_visible_author().
create or replace view public.prayer_wall
  with (security_invoker = true)
as
select
  r.id,
  r.body,
  r.is_anonymous,
  r.is_answered,
  r.created_at,
  coalesce(a.author_id = (select auth.uid()), false) as mine,
  p.first_name,
  p.last_name,
  p.preferred_name,
  p.avatar_url,
  coalesce(pc.praying_count, 0) as praying_count,
  coalesce(pc.i_am_praying, false) as i_am_praying,
  r.org_id,
  r.group_id,
  r.body_ciphertext,
  r.author_hash,
  p.suffix
from public.prayer_requests r
cross join lateral (select public.prayer_request_visible_author(r.id) as author_id offset 0) a
left join public.profiles p on p.id = a.author_id and p.org_id = r.org_id
left join lateral (
  select count(*)::integer as praying_count,
         bool_or(pr.profile_id = (select auth.uid())) as i_am_praying
  from public.prayer_responses pr
  where pr.request_id = r.id and pr.org_id = r.org_id
) pc on true
where r.org_id = (select public.app_request_org_id());

-- A RETURNS TABLE function changes its row type only through drop and create,
-- which drops its grants and comment too; both are restored below.
drop function public.pending_group_join_requests(uuid);

create function public.pending_group_join_requests(_group_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  first_name text,
  last_name text,
  preferred_name text,
  email text,
  suffix text
)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.created_at, p.first_name, p.last_name, p.preferred_name,
    case when p.hide_email then null else p.email end,
    p.suffix
  from public.profiles me
  join public.group_join_requests r on r.org_id = me.org_id
  join public.profiles p on p.id = r.profile_id and p.org_id = r.org_id
  where me.id = auth.uid() and me.role <> 'pending'
    and r.group_id = _group_id
    and r.status = 'pending'
    and (public.is_admin() or public.is_group_leader(_group_id))
  order by r.created_at;
$$;

revoke execute on function public.pending_group_join_requests(uuid) from public, anon;
grant  execute on function public.pending_group_join_requests(uuid) to authenticated;

comment on function public.pending_group_join_requests(uuid) is
  'Pending requests for a group with each requester''s name and email (NULL when hide_email), for the leader''s review list. Tenant anchor: the caller''s own profiles row; rows only when the caller leads the group or is an org admin, else empty.';
