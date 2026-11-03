-- One transaction for everything the database does when a person is deleted.
--
-- PostgREST has no client-side transaction, so a failure partway through a
-- series of app-side writes could leave a surviving person short of a serving
-- date or a fund while the login lived on. Here any raise rolls all of it back.
-- The auth.users delete is inside the transaction: it cascades to the profile
-- and through the profile to whatever the foreign keys cover, so a login can't
-- outlive or precede the person's data, and no Auth admin API call is needed.
--
-- SECURITY DEFINER bypasses RLS, so the org checks in this body are the tenant
-- boundary. The org comes from the target's profile row. _org_id is only
-- compared with it, so a caller holding the wrong church gets the same refusal
-- as for someone who doesn't exist.
--
-- Storage can't join the transaction. The object keys are read from
-- storage.objects and returned for the caller to remove after commit. They are
-- found from row ids rather than the stored URL columns, which their owner can
-- write, and they include keys from before org partitioning.
--
-- Error contract (SQLSTATEs lib/account/deletion.ts maps to a result):
--   AD001  no such person in this church                        -> not_found
--   AD002  the person is a platform operator                    -> refused
--   CA001  the person is the last church admin (see
--          profiles_keep_one_church_admin)                      -> refused

-- Stops the deploy rather than shipping a function that can only fail at runtime.
do $$
begin
  if not has_table_privilege(current_user, 'auth.users', 'delete') then
    raise exception 'delete_person needs its owner, %, to hold DELETE on auth.users', current_user;
  end if;
end $$;

create function public.delete_person(_person_id uuid, _org_id uuid)
  returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare
  _org uuid;
  _role text;
  _profile_email text;
  _family uuid;
  _first_name text;
  _last_name text;
  _preferred_name text;
  _login_email text;
  _today date;
  _date record;
  _opened jsonb := '[]'::jsonb;
  _addresses text[];
  _own_entries uuid[];
  _household_entries uuid[] := '{}';
  _household_goes boolean := false;
  _own_uses uuid[];
  _linked_requests uuid[];
  _accepted_tokens uuid[];
  _photo_keys text[];
begin
  select p.org_id, p.role, p.email, p.family_id, p.first_name, p.last_name, p.preferred_name
    into _org, _role, _profile_email, _family, _first_name, _last_name, _preferred_name
  from public.profiles p
  where p.id = _person_id;

  if _org is null or _org is distinct from _org_id then
    raise exception 'delete_person: no such person in this church' using errcode = 'AD001';
  end if;

  if exists (select 1 from public.platform_admins a where a.profile_id = _person_id) then
    raise exception 'delete_person: a platform operator can''t be deleted here' using errcode = 'AD002';
  end if;

  -- The same lock profiles_keep_one_church_admin takes, held from here so this
  -- refusal comes before any write. The trigger still decides at the delete, for
  -- a person made an admin since the read above.
  if _role = 'admin' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('public.profiles:church_admin'), pg_catalog.hashtext(_org::text));
    if not exists (
      select 1 from public.profiles p
      where p.org_id = _org and p.role = 'admin' and p.id <> _person_id
    ) then
      raise exception 'delete_person: a church needs at least one church admin' using errcode = 'CA001';
    end if;
  end if;

  -- After the lock, so a second delete of the same person waits here and then
  -- finds no row, rather than reaching the writes below.
  select u.email into _login_email from auth.users u where u.id = _person_id for update;
  if not found then
    raise exception 'delete_person: no such person in this church' using errcode = 'AD001';
  end if;

  select (pg_catalog.now() at time zone o.timezone)::date into _today
  from public.organizations o where o.id = _org;

  -- serving_signups.created_by cascades, so a date this person booked and shares
  -- has to move first. A future date left with nobody on it opens up, and the
  -- caller tells the team's leaders. A past one is history: it stays unless the
  -- created_by cascade takes it, because they booked it themself.
  for _date in
    select s.id, s.created_by, s.service_date, s.team_id, t.group_id, t.name as team_name,
           (select a.profile_id from public.serving_signup_attendees a
             where a.signup_id = s.id and a.org_id = _org and a.profile_id <> _person_id
             order by a.profile_id limit 1) as remaining
    from public.serving_signups s
    join public.teams t on t.id = s.team_id and t.org_id = s.org_id
    where s.org_id = _org
      and (s.created_by = _person_id
           or exists (select 1 from public.serving_signup_attendees a
                       where a.signup_id = s.id and a.org_id = _org and a.profile_id = _person_id))
    for update of s
  loop
    if _date.remaining is not null then
      if _date.created_by = _person_id then
        update public.serving_signups set created_by = _date.remaining
        where id = _date.id and org_id = _org;
      end if;
    elsif _date.service_date >= _today then
      delete from public.serving_signups where id = _date.id and org_id = _org;
      _opened := _opened || jsonb_build_object(
        'team_id', _date.team_id,
        'group_id', _date.group_id,
        'team_name', _date.team_name,
        'service_date', _date.service_date);
    end if;
  end loop;

  -- A fund's payment handles are free text and may still pay the person leaving,
  -- so the second person gets it retired, for a leader to check and reopen. A fund
  -- with nobody to take it goes through the steward_id cascade.
  update public.giving_funds f
     set steward_id = f.co_steward_id,
         co_steward_id = null,
         steward_role = null,
         is_active = false
   where f.org_id = _org
     and f.steward_id = _person_id
     and f.co_steward_id <> _person_id
     and exists (select 1 from public.group_members m
                  where m.group_id = f.group_id and m.org_id = _org and m.profile_id = f.co_steward_id);

  select coalesce(array_agg(distinct a), '{}') into _addresses
  from unnest(array[pg_catalog.lower(_profile_email), pg_catalog.lower(_login_email)]) as a
  where a is not null;

  select coalesce(array_agg(m.id), '{}') into _own_entries
  from public.family_members m
  where m.org_id = _org and m.claimed_profile_id = _person_id;

  -- Everything at an address they still hold is theirs, since group_invite_redeem()
  -- refuses an address with a profile. An address they have left may be shared and
  -- nothing records whose a row there is, so only a request linked to them through
  -- an invite goes, and not one with a setup link waiting: theirs was spent when
  -- they signed up, so that link is for someone else, who reused the row.
  select coalesce(array_agg(u.id), '{}'),
         coalesce(array_agg(u.access_request_id) filter (where u.access_request_id is not null), '{}')
    into _own_uses, _linked_requests
  from public.group_invite_uses u
  where u.org_id = _org and u.profile_id = _person_id;

  select coalesce(array_agg(i.token), '{}') into _accepted_tokens
  from public.family_invites i
  where i.org_id = _org and i.family_member_id = any (_own_entries) and i.accepted_at is not null;

  delete from public.family_invites i
  where i.org_id = _org and i.accepted_at is null and pg_catalog.lower(i.invite_email) = any (_addresses);

  delete from public.group_invite_uses u
  where u.org_id = _org
    and (u.id = any (_own_uses)
         or (u.profile_id is null and pg_catalog.lower(u.email) = any (_addresses)));

  delete from public.access_requests r
  where r.org_id = _org
    and (pg_catalog.lower(r.email) = any (_addresses)
         or (r.signup_token is null
             and (r.id = any (_linked_requests) or r.invite_token = any (_accepted_tokens))));

  -- A household belongs to everyone in it, so it goes only when no other profile
  -- points at it and no entry is claimed by someone else.
  if _family is not null then
    _household_goes := not exists (
        select 1 from public.profiles p
        where p.org_id = _org and p.family_id = _family and p.id <> _person_id
      ) and not exists (
        select 1 from public.family_members m
        where m.org_id = _org and m.family_id = _family
          and m.claimed_profile_id is not null and m.claimed_profile_id <> _person_id
      );
    if _household_goes then
      select coalesce(array_agg(m.id), '{}') into _household_entries
      from public.family_members m
      where m.org_id = _org and m.family_id = _family;
    end if;
  end if;

  select coalesce(array_agg(o.name), '{}') into _photo_keys
  from storage.objects o
  where o.bucket_id = 'avatars'
    and (o.name like _org || '/profiles/' || _person_id || '/%'
         or o.name like _person_id || '/%'
         or exists (select 1 from unnest(_own_entries || _household_entries) as e(id)
                     where o.name like _org || '/family-members/' || e.id || '/%'
                        or o.name like 'family-members/' || e.id || '/%')
         or (_household_goes and (o.name like _org || '/families/' || _family || '/%'
                                  or o.name like 'families/' || _family || '/%')));

  -- The foreign key would only unclaim it, leaving them listed in the household.
  delete from public.family_members m where m.org_id = _org and m.id = any (_own_entries);

  if _household_goes then
    delete from public.family_units f where f.org_id = _org and f.id = _family;
  end if;

  delete from auth.users u where u.id = _person_id;
  if not found then
    raise exception 'delete_person: the login was gone before it could be deleted' using errcode = 'AD001';
  end if;

  return jsonb_build_object(
    'first_name', _first_name,
    'last_name', _last_name,
    'preferred_name', _preferred_name,
    'opened_dates', _opened,
    'photo_keys', to_jsonb(_photo_keys));
end;
$$;

revoke execute on function public.delete_person(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_person(uuid, uuid) to service_role;

comment on function public.delete_person(uuid, uuid) is
  'Deletes one person and their login in a single transaction, and returns the storage keys and opened serving dates for the caller to act on after commit. Tenant anchor: org_id from the target''s profile row; _org_id is only compared with it. service_role only. Raises AD001, AD002 or CA001.';
