-- The contract step for the retired directory hide settings: sweep once more,
-- then drop the flags, their view gates and the functions that read them.
-- hide_email and is_unlisted stay.

-- Deletes any value hidden by a flag set true since the last sweep, through a
-- direct API write. The where clauses are in directory_retire_hidden_values().
-- The lock holds writers off until the drops commit, so a flag set between the
-- sweep and the drop cannot leave its value exposed by the ungated views. It is
-- taken inside the block because the CLI runs the file as one pipelined batch,
-- where a top-level LOCK TABLE is refused but a nested one holds to the commit.
do $$
declare
  _counts jsonb;
begin
  lock table public.profiles, public.family_units in share mode;
  _counts := public.directory_retire_hidden_values();
  raise notice 'directory_retire_hidden_values: %', _counts;
end $$;

-- Same columns, names, types and order, so the grants carry over.
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
  p.org_id
from public.profiles p
left join public.team_members pg on p.id = pg.profile_id and pg.org_id = p.org_id
left join public.teams mg on pg.team_id = mg.id and mg.org_id = p.org_id
where p.is_unlisted = false
  and p.role = any (array['member'::text, 'admin'::text])
  and p.org_id = (select public.app_request_org_id())
group by p.id;

-- The household phone reads its owner under the caller's RLS with the filters
-- `members` uses, so a number that shows always has its owner's name beside it.
create or replace view public.families_directory
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
  f.org_id
from public.family_units f
where f.org_id = (select public.app_request_org_id());

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

drop function public.family_anniversary_hidden(uuid);

alter table public.profiles
  drop column hide_phone_mobile,
  drop column hide_phone_home,
  drop column hide_phone_work,
  drop column hide_address,
  drop column hide_birthday,
  drop column hide_birth_year,
  drop column hide_anniversary,
  drop column hide_occupation;

alter table public.family_units
  drop column hide_address,
  drop column hide_phone_home;

drop function public.directory_retire_hidden_values();

comment on function public.family_units_sync_anniversary() is
  'Keeps family_units.anniversary and its parts in step while both exist: the seed writes the date and the app writes the parts. A yearless value has no date, so the old column reads null. Remove when family_units.anniversary is dropped.';
