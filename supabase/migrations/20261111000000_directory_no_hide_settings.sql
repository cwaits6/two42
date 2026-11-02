-- What's stored is what's shown: hide settings other than the email setting and
-- the directory listing are retired. This is the expand step: values that were
-- hidden are deleted, the household gains its anniversary parts and its phone
-- choice, and every retired column, flag and view gate stays for the app still
-- deployed. Dropping them is a later release, which re-runs the sweep first.

alter table public.family_units
  add column anniversary_month smallint,
  add column anniversary_day smallint,
  add column anniversary_year smallint,
  add column phone_profile_id uuid,
  add constraint family_units_anniversary_month_check
    check (anniversary_month between 1 and 12),
  -- A yearless date can fall on Feb 29, so the day is checked against a leap year.
  add constraint family_units_anniversary_day_check
    check (anniversary_day between 1 and (array[31,29,31,30,31,30,31,31,30,31,30,31])[anniversary_month]),
  add constraint family_units_anniversary_year_check
    check (anniversary_year between 1900 and 2100),
  add constraint family_units_anniversary_parts_check
    check ((anniversary_month is null) = (anniversary_day is null)
           and (anniversary_year is null or anniversary_month is not null)),
  add constraint family_units_phone_profile_id_fkey
    foreign key (phone_profile_id, org_id) references public.profiles (id, org_id)
    on delete set null (phone_profile_id);

comment on column public.family_units.phone_profile_id is
  'The household phone is this spouse''s mobile number, read live through the household views. phone_home is null while this is set.';

-- SECURITY DEFINER because the household views are security_invoker: an unlisted
-- spouse's row is invisible to other members, so an EXISTS inside the view would
-- find no hider and show the anniversary they hid.
create function public.family_anniversary_hidden(_family_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.family_id = _family_id
       and p.org_id = public.app_current_org_id()
       and p.relationship = any (array['primary', 'spouse'])
       and p.hide_anniversary
  );
$$;

revoke execute on function public.family_anniversary_hidden(uuid) from public, anon;
grant execute on function public.family_anniversary_hidden(uuid) to authenticated, service_role;

comment on function public.family_anniversary_hidden(uuid) is
  'Whether either spouse in the caller''s org marked this household''s anniversary hidden. Remove with profiles.hide_anniversary.';

-- A function rather than inline SQL so pgTAP can run it against fixtures. Flags
-- reset with the values they guarded: a value re-entered later is meant to show.
-- Runs across every org because a migration has no org to be in; execute is
-- revoked from every role the API can reach.
create function public.directory_retire_hidden_values()
  returns jsonb
  language plpgsql
  set search_path = ''
as $$
declare
  _counts jsonb := '{}';
  _n bigint;
begin
  -- Before the per-flag updates below reset the flags this reads. Either
  -- spouse hiding clears both copies, or the other spouse's would still show.
  update public.family_units f
     set anniversary = null,
         anniversary_month = null,
         anniversary_day = null,
         anniversary_year = null
   where (f.anniversary is not null or f.anniversary_month is not null)
     and exists (
       select 1 from public.profiles h
        where h.family_id = f.id
          and h.org_id = f.org_id
          and h.relationship = any (array['primary', 'spouse'])
          and h.hide_anniversary
     );
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('household_anniversary', _n);

  update public.profiles p
     set anniversary = null
   where p.anniversary is not null
     and p.family_id is not null
     and p.relationship = any (array['primary', 'spouse'])
     and exists (
       select 1 from public.profiles h
        where h.family_id = p.family_id
          and h.org_id = p.org_id
          and h.relationship = any (array['primary', 'spouse'])
          and h.hide_anniversary
     );

  -- families_directory_full returns a claimed row's birthday with no gate, and
  -- it is the same person's birthday.
  update public.family_members fm
     set birth_month = case when p.hide_birthday then null else fm.birth_month end,
         birth_day = case when p.hide_birthday then null else fm.birth_day end,
         birth_year = null
    from public.profiles p
   where fm.claimed_profile_id = p.id
     and fm.org_id = p.org_id
     and (p.hide_birthday or p.hide_birth_year)
     and (fm.birth_month is not null or fm.birth_day is not null or fm.birth_year is not null);
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('claimed_birthday', _n);

  -- profiles.phone predates phone_mobile: nothing reads it, but raw profiles
  -- rows are readable by other members, so a copy of the number can't stay.
  update public.profiles
     set phone_mobile = null, phone = null, hide_phone_mobile = false
   where hide_phone_mobile;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('hide_phone_mobile', _n);

  update public.profiles
     set phone_home = null, hide_phone_home = false
   where hide_phone_home;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('hide_phone_home', _n);

  update public.profiles
     set phone_work = null, hide_phone_work = false
   where hide_phone_work;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('hide_phone_work', _n);

  update public.profiles
     set address_line1 = null, address_line2 = null, city = null, state = null,
         postal_code = null, hide_address = false
   where hide_address;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('hide_address', _n);

  update public.profiles
     set birth_year = null, hide_birth_year = false
   where hide_birth_year;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('hide_birth_year', _n);

  update public.profiles
     set birth_month = null, birth_day = null, birth_year = null, hide_birthday = false
   where hide_birthday;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('hide_birthday', _n);

  update public.profiles
     set anniversary = null, hide_anniversary = false
   where hide_anniversary;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('hide_anniversary', _n);

  update public.profiles
     set occupation = null, employer = null, hide_occupation = false
   where hide_occupation;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('hide_occupation', _n);

  update public.family_units
     set address_line1 = null, address_line2 = null, city = null, state = null,
         postal_code = null, hide_address = false
   where hide_address;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('household_hide_address', _n);

  update public.family_units
     set phone_home = null, hide_phone_home = false
   where hide_phone_home;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('household_hide_phone_home', _n);

  -- What wasn't hidden moves to the household, which keeps its own value if it
  -- has one; a primary's copy goes before a spouse's.
  update public.family_units f
     set anniversary = m.anniversary
    from (
      select distinct on (p.family_id, p.org_id) p.family_id, p.org_id, p.anniversary
        from public.profiles p
       where p.anniversary is not null
         and p.family_id is not null
         and p.relationship = any (array['primary', 'spouse'])
       order by p.family_id, p.org_id, (p.relationship = 'primary') desc, p.id
    ) m
   where f.id = m.family_id
     and f.org_id = m.org_id
     and f.anniversary is null
     and f.anniversary_month is null;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('anniversary_moved', _n);

  -- The household is the one place, and "either spouse clears it" can't reach a
  -- stale copy. A copy with no household or outside the couple has nowhere to go
  -- and stays, unread, until the column is dropped.
  update public.profiles
     set anniversary = null
   where anniversary is not null
     and family_id is not null
     and relationship = any (array['primary', 'spouse']);

  -- The year check is 1900-2100 and only a typo falls outside it; losing that
  -- year beats a check violation that blocks the deploy.
  update public.family_units
     set anniversary_month = extract(month from anniversary)::smallint,
         anniversary_day = extract(day from anniversary)::smallint,
         anniversary_year = case
           when extract(year from anniversary) between 1900 and 2100
             then extract(year from anniversary)::smallint
         end
   where anniversary is not null
     and anniversary_month is null;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('anniversary_split', _n);

  return _counts;
end;
$$;

revoke execute on function public.directory_retire_hidden_values()
  from public, anon, authenticated, service_role;

comment on function public.directory_retire_hidden_values() is
  'Deletes values hidden with the retired flags and moves anniversaries to the household parts. Idempotent. The release that drops the retired columns re-runs it, to sweep anything hidden through the old app in between, then drops it.';

select public.directory_retire_hidden_values();

-- Created after the sweep, which writes both shapes itself.
create function public.family_units_sync_anniversary()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.anniversary is not null)
     or (tg_op = 'UPDATE'
         and new.anniversary is distinct from old.anniversary
         and (new.anniversary_month, new.anniversary_day, new.anniversary_year)
             is not distinct from (old.anniversary_month, old.anniversary_day, old.anniversary_year)) then
    new.anniversary_month := extract(month from new.anniversary)::smallint;
    new.anniversary_day := extract(day from new.anniversary)::smallint;
    new.anniversary_year := case
      when extract(year from new.anniversary) between 1900 and 2100
        then extract(year from new.anniversary)::smallint
    end;
  elsif tg_op = 'INSERT'
     or (new.anniversary_month, new.anniversary_day, new.anniversary_year)
        is distinct from (old.anniversary_month, old.anniversary_day, old.anniversary_year) then
    new.anniversary := case
      when new.anniversary_year is not null
        then make_date(new.anniversary_year, new.anniversary_month, new.anniversary_day)
    end;
  end if;
  return new;
end;
$$;

revoke execute on function public.family_units_sync_anniversary() from public, anon, authenticated;

comment on function public.family_units_sync_anniversary() is
  'Keeps family_units.anniversary and its parts in step while both exist: the deployed app may write either. A yearless value has no date, so the old column reads null. Remove when family_units.anniversary is dropped.';

create trigger family_units_sync_anniversary
  before insert or update on public.family_units
  for each row execute function public.family_units_sync_anniversary();

-- WITH CHECK can't compare old and new values, so the rule lives in a trigger.
-- SECURITY INVOKER: the caller's own profile row is always readable to them.
create function public.family_units_phone_owner_guard()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.phone_profile_id is null then
    return new;
  end if;

  -- A stale shared number can't resurface when the choice is cleared.
  new.phone_home := null;

  if tg_op = 'INSERT' or new.phone_profile_id is distinct from old.phone_profile_id then
    if new.phone_profile_id is distinct from auth.uid()
       or not exists (
         select 1 from public.profiles p
          where p.id = new.phone_profile_id
            and p.org_id = new.org_id
            and p.family_id = new.id
            and p.relationship = any (array['primary', 'spouse'])
       ) then
      raise exception 'family_units: only that spouse can choose their own number'
        using errcode = 'HP001';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.family_units_phone_owner_guard() from public, anon, authenticated;

comment on function public.family_units_phone_owner_guard() is
  'Only a spouse in the household can point the household phone at their own number; clearing it stays open to anyone the update policy allows.';

create trigger family_units_phone_owner_guard
  before insert or update on public.family_units
  for each row execute function public.family_units_phone_owner_guard();

-- Both views keep every column, name, type and order for the deployed app. They
-- read the pointer's owner under the caller's RLS with the filters `members`
-- uses, so a number that shows always has its owner's name beside it.
create or replace view public.families_directory
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
  f.org_id
from public.family_units f
where f.org_id = (select public.app_request_org_id());

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
  f.org_id,
  case when public.family_anniversary_hidden(f.id) then null::smallint else f.anniversary_month end as anniversary_month,
  case when public.family_anniversary_hidden(f.id) then null::smallint else f.anniversary_day end as anniversary_day,
  case when public.family_anniversary_hidden(f.id) then null::smallint else f.anniversary_year end as anniversary_year,
  f.phone_profile_id
from public.family_units f
where f.org_id = (select public.app_request_org_id());
