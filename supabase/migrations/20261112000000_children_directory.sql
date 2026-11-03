-- A child appears only by what a parent entered. A family_members row with
-- relationship 'child' and no claimed account is a child without an account: its
-- birth year is not stored, it can't be invited to an account, and other members
-- read a household's people only through what the directory shows.
-- isChildWithoutAccount() in lib/household.ts states the same predicate for the app.
--
-- The triggers come before the sweep. CREATE TRIGGER waits for in-flight writers,
-- so a write committed before it is visible to the sweep and one after it meets
-- the trigger; the other order leaves a gap.

create function public.family_members_clear_child_year()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.relationship = 'child' and new.claimed_profile_id is null then
    new.birth_year := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.family_members_clear_child_year() from public, anon, authenticated;

comment on function public.family_members_clear_child_year() is
  'The one rule that keeps a birth year off a child without an account, whichever app version, route or script writes the row.';

create trigger family_members_clear_child_year
  before insert or update on public.family_members
  for each row execute function public.family_members_clear_child_year();

-- SECURITY DEFINER because the invoker can't be trusted to see the row: a primary
-- naming another household's child would find nothing under their own RLS and
-- pass. The org comes from the invite row, whose composite FK ties it to the
-- member, and a service-role insert has no request org to read instead.
create function public.family_invites_refuse_child()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.family_members fm
     where fm.id = new.family_member_id
       and fm.org_id = new.org_id
       and fm.relationship = 'child'
       and fm.claimed_profile_id is null
  ) then
    raise exception 'family_invites: a child without an account cannot be invited'
      using errcode = 'HP002';
  end if;
  return new;
end;
$$;

revoke execute on function public.family_invites_refuse_child() from public, anon, authenticated;

comment on function public.family_invites_refuse_child() is
  'Refuses an invite on a child without an account, on direct table writes and service-role writes as well as the route.';

create trigger family_invites_refuse_child
  before insert or update of family_member_id, org_id on public.family_invites
  for each row execute function public.family_invites_refuse_child();

-- An open invite lets its email sign up through handle_new_user(), so becoming a
-- child without an account has to end it. SECURITY DEFINER: a primary can relabel
-- a person but has no DELETE policy on family_invites, and access_requests has no
-- client policy at all. The access request goes first because its FK sets
-- invite_token to null when the invite is deleted.
create function public.family_members_retire_child_invites()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.relationship = 'child' and new.claimed_profile_id is null
     and not (old.relationship = 'child' and old.claimed_profile_id is null) then
    delete from public.access_requests ar
     using public.family_invites fi
     where fi.family_member_id = new.id
       and fi.org_id = new.org_id
       and fi.accepted_at is null
       and ar.invite_token = fi.token
       and ar.org_id = fi.org_id
       and ar.status = any (array['pending', 'approved']);

    delete from public.family_invites fi
     where fi.family_member_id = new.id
       and fi.org_id = new.org_id;
  end if;
  return null;
end;
$$;

revoke execute on function public.family_members_retire_child_invites() from public, anon, authenticated;

comment on function public.family_members_retire_child_invites() is
  'Ends the invites and unused access requests of a person who becomes a child without an account.';

create trigger family_members_retire_child_invites
  after update of relationship, claimed_profile_id on public.family_members
  for each row execute function public.family_members_retire_child_invites();

-- A function rather than inline SQL so pgTAP can run it against fixtures. Runs
-- across every org because a migration has no org to be in; execute is revoked
-- from every role the API can reach.
create function public.family_members_retire_child_details()
  returns jsonb
  language plpgsql
  set search_path = ''
as $$
declare
  _counts jsonb := '{}';
  _n bigint;
begin
  update public.family_members
     set birth_year = null
   where relationship = 'child'
     and claimed_profile_id is null
     and birth_year is not null;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('child_birth_year', _n);

  delete from public.access_requests ar
   using public.family_invites fi, public.family_members fm
   where fm.id = fi.family_member_id
     and fm.org_id = fi.org_id
     and fm.relationship = 'child'
     and fm.claimed_profile_id is null
     and fi.accepted_at is null
     and ar.invite_token = fi.token
     and ar.org_id = fi.org_id
     and ar.status = any (array['pending', 'approved']);
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('child_invite_requests', _n);

  -- An accepted invite goes too: the email is the stored detail.
  delete from public.family_invites fi
   using public.family_members fm
   where fm.id = fi.family_member_id
     and fm.org_id = fi.org_id
     and fm.relationship = 'child'
     and fm.claimed_profile_id is null;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('child_invites', _n);

  return _counts;
end;
$$;

revoke execute on function public.family_members_retire_child_details()
  from public, anon, authenticated, service_role;

comment on function public.family_members_retire_child_details() is
  'Clears a child''s stored birth year and removes invites on a child without an account. Idempotent.';

select public.family_members_retire_child_details();

-- SECURITY DEFINER because other members lose direct reads of family_members
-- below, and families_directory_full is security_invoker. The WHERE clause repeats
-- the arm those policies drop, so a direct call is gated the same way.
create function public.family_directory_people(_family_id uuid)
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
      when fm.relationship = 'child' and fm.claimed_profile_id is null
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
  ) order by fm.relationship), '[]'::jsonb)
  from public.family_members fm
  where fm.family_id = _family_id
    and fm.org_id = public.app_current_org_id()
    and (
      public.is_admin()
      or (public.is_member() and (
        fm.family_id = public.current_family_id()
        or public.org_directory_visible()
        or public.shares_group_with_household(_family_id)
      ))
    );
$$;

revoke execute on function public.family_directory_people(uuid) from public, anon;
grant execute on function public.family_directory_people(uuid) to authenticated, service_role;

comment on function public.family_directory_people(uuid) is
  'The people in a household as the directory shows them, for anyone who can see that household. No birth year, for anyone.';

-- Every column keeps its name, type and order for the deployed app, which never
-- read the birth_year key this list loses.
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
where f.org_id = (select public.app_request_org_id());

drop policy "Members can view family members" on public.family_members;
create policy "Members can view family members" on public.family_members
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or (family_id = (select public.current_family_id()) and (select public.is_member()))
    )
  );

drop policy "Members can view family invites" on public.family_invites;
create policy "Members can view family invites" on public.family_invites
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or (family_id = (select public.current_family_id()) and (select public.is_member()))
    )
  );
