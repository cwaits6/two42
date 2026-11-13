-- Three rules that were written out more than once, each stated once:
--   is_child_without_account()   a child without an account
--   household_visible()          who can see a household
--   person_deletion_outcomes()   what deleting a person does to their funds and household

-- No SET clause, so callers inline it. The app states the same rule in
-- isChildWithoutAccount(); lib/household.test.ts and household_rules_suite.sql
-- check both against one case table.
create function public.is_child_without_account(_relationship text, _claimed_profile_id uuid)
  returns boolean
  language sql
  immutable
  parallel safe
as $$
  select _relationship is not distinct from 'child' and _claimed_profile_id is null;
$$;

revoke execute on function public.is_child_without_account(text, uuid) from public, anon;
grant execute on function public.is_child_without_account(text, uuid) to authenticated, service_role;

comment on function public.is_child_without_account(text, uuid) is
  'A person listed as a child with no account of their own. A child with an account is an adult child.';

-- The viewer's facts are arguments so each call site evaluates them once per
-- statement. No SECURITY DEFINER, no SET clause and no subquery in the body: any
-- of them stops Postgres inlining it, and the family_units policy would then call
-- it once per row. Every name in the body is schema-qualified for that reason.
-- The caller confines the household to the viewer's own church.
create function public.household_visible(
  _family_id uuid,
  _is_admin boolean,
  _is_member boolean,
  _own_family_id uuid,
  _directory_open boolean)
  returns boolean
  language sql
  stable
as $$
  select _is_admin
      or (_is_member and (
            _family_id = _own_family_id
            or _directory_open
            or public.shares_group_with_household(_family_id)));
$$;

revoke execute on function public.household_visible(uuid, boolean, boolean, uuid, boolean) from public, anon;
grant execute on function public.household_visible(uuid, boolean, boolean, uuid, boolean) to authenticated;

comment on function public.household_visible(uuid, boolean, boolean, uuid, boolean) is
  'Who can see a household: a church admin, or a member in it, in a group with someone in it, or in a church whose directory is open. Read by the family_units policy and family_directory_people().';

create or replace function public.family_members_clear_child_year()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if public.is_child_without_account(new.relationship, new.claimed_profile_id) then
    new.birth_year := null;
  end if;
  return new;
end;
$$;

create or replace function public.family_invites_refuse_child()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _family_id uuid;
  _relationship text;
  _claimed_profile_id uuid;
begin
  -- FOR SHARE: of an invite and a relabel the later one waits, so one always sees the other.
  -- Unfiltered, because a filter on relationship would leave an adult unlocked.
  select fm.family_id, fm.relationship, fm.claimed_profile_id
    into _family_id, _relationship, _claimed_profile_id
    from public.family_members fm
   where fm.id = new.family_member_id
     and fm.org_id = new.org_id
     for share of fm;

  -- The policies and FK check only the invite's family_id, and a claim links its accepter to this person.
  -- Checked first, so the refusal says nothing about someone in another household.
  if _family_id <> new.family_id then
    raise exception 'family_invites: the person named is not in this household'
      using errcode = 'HP003';
  end if;

  if public.is_child_without_account(_relationship, _claimed_profile_id) then
    raise exception 'family_invites: a child without an account cannot be invited'
      using errcode = 'HP002';
  end if;
  return new;
end;
$$;

create or replace function public.family_members_retire_child_invites()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if public.is_child_without_account(new.relationship, new.claimed_profile_id)
     and not public.is_child_without_account(old.relationship, old.claimed_profile_id) then
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

create or replace function public.family_members_retire_child_details()
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
   where public.is_child_without_account(relationship, claimed_profile_id)
     and birth_year is not null;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('child_birth_year', _n);

  delete from public.access_requests ar
   using public.family_invites fi, public.family_members fm
   where fm.id = fi.family_member_id
     and fm.org_id = fi.org_id
     and public.is_child_without_account(fm.relationship, fm.claimed_profile_id)
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
     and public.is_child_without_account(fm.relationship, fm.claimed_profile_id);
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('child_invites', _n);

  delete from public.access_requests ar
   using public.family_invites fi, public.family_members fm
   where fm.id = fi.family_member_id
     and fm.org_id = fi.org_id
     and fm.family_id <> fi.family_id
     and fi.accepted_at is null
     and ar.invite_token = fi.token
     and ar.org_id = fi.org_id
     and ar.status = any (array['pending', 'approved']);
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('cross_household_invite_requests', _n);

  delete from public.family_invites fi
   using public.family_members fm
   where fm.id = fi.family_member_id
     and fm.org_id = fi.org_id
     and fm.family_id <> fi.family_id
     and fi.accepted_at is null;
  get diagnostics _n = row_count;
  _counts := _counts || jsonb_build_object('cross_household_invites', _n);

  -- Counted and left in place: undoing a claim isn't safe to do blind.
  select count(*) into _n
    from public.family_invites fi
    join public.family_members fm
      on fm.id = fi.family_member_id
     and fm.org_id = fi.org_id
   where fm.family_id <> fi.family_id
     and fi.accepted_at is not null;
  _counts := _counts || jsonb_build_object('cross_household_invites_accepted', _n);

  return _counts;
end;
$$;

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
    (select public.org_directory_visible())))), '[]'::jsonb)
  from public.family_members fm
  where fm.family_id = _family_id
    and fm.org_id = (select public.app_current_org_id());
$$;

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
      (select public.org_directory_visible())))
  );

-- Read by both the delete confirmation and delete_person(), so the two can't
-- describe different outcomes. Read-only: the fund outcome is the one
-- giving_fund_recipients_guard() applies when the profile delete sets steward_id
-- null, and the household rule is the one delete_person() acts on.
-- The org comes from the person's own profile row; _org_id is only compared with
-- it, so a caller holding one church's id learns nothing about another's people.
create function public.person_deletion_outcomes(_person_id uuid, _org_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  _org uuid;
  _family uuid;
  _funds jsonb;
  _household jsonb;
begin
  select p.org_id, p.family_id into _org, _family
  from public.profiles p
  where p.id = _person_id;

  if _org is null or _org is distinct from _org_id then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id,
           'name', f.name,
           'group_id', f.group_id,
           'group_name', g.name,
           'outcome', case when r.id is null then 'needs_recipient' else 'passed_on' end,
           'recipient_id', r.id,
           'recipient', case when r.id is not null then jsonb_build_object(
             'first_name', r.first_name,
             'last_name', r.last_name,
             'preferred_name', r.preferred_name) end
         ) order by f.name, f.id), '[]'::jsonb)
    into _funds
  from public.giving_funds f
  left join public.groups g on g.id = f.group_id and g.org_id = f.org_id
  left join lateral (
    select p.id, p.first_name, p.last_name, p.preferred_name
    from public.group_members gm
    join public.profiles p on p.id = gm.profile_id and p.org_id = gm.org_id
    where gm.group_id = f.group_id
      and gm.org_id = f.org_id
      and gm.profile_id = f.co_steward_id
      and f.co_steward_id is distinct from _person_id
      and p.role <> 'pending'
  ) r on true
  where f.org_id = _org and f.steward_id = _person_id;

  -- A household belongs to everyone in it, so it goes only when no other profile
  -- points at it and no entry is claimed by someone else.
  select jsonb_build_object(
           'id', h.id,
           'name', h.family_name,
           'goes', not exists (
               select 1 from public.profiles p
               where p.org_id = _org and p.family_id = h.id and p.id <> _person_id
             ) and not exists (
               select 1 from public.family_members m
               where m.org_id = _org and m.family_id = h.id
                 and m.claimed_profile_id is not null and m.claimed_profile_id <> _person_id
             ),
           'entries', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', m.id,
                      'first_name', m.first_name,
                      'last_name', m.last_name,
                      'preferred_name', m.preferred_name) order by m.first_name, m.id)
             from public.family_members m
             where m.org_id = _org and m.family_id = h.id
               and m.claimed_profile_id is distinct from _person_id), '[]'::jsonb))
    into _household
  from public.family_units h
  where h.org_id = _org and h.id = _family;

  return jsonb_build_object('funds', _funds, 'household', _household);
end;
$$;

revoke execute on function public.person_deletion_outcomes(uuid, uuid) from public, anon, authenticated;
grant execute on function public.person_deletion_outcomes(uuid, uuid) to service_role;

comment on function public.person_deletion_outcomes(uuid, uuid) is
  'What deleting a person does to each fund they receive gifts for and to their household. Null when they are not in that church. Read by the delete confirmation and by delete_person().';

-- The household and fund outcomes come from person_deletion_outcomes(). The
-- profile delete applies the fund rules through the foreign keys and triggers;
-- AD003 means a fund didn't end as the outcome said, and nothing is deleted. Either
-- those rules and person_deletion_outcomes() disagree, or a fund or the second
-- person's membership changed during the delete, which a retry resolves.
create or replace function public.delete_person(_person_id uuid, _org_id uuid)
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
  _outcomes jsonb;
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

  -- The rows stay, because max_uses counts them: without them a used-up link
  -- would admit someone again. The profile link clears through its foreign key.
  -- group_invite_uses_signup_has_email requires an email on signup_sent, and the
  -- placeholder can't equal an address, since group_invite_redeem() requires an @.
  update public.group_invite_uses u
     set email = case when u.outcome = 'signup_sent' then 'deleted' end,
         access_request_id = null
   where u.org_id = _org
     and (u.id = any (_own_uses)
          or (u.profile_id is null and pg_catalog.lower(u.email) = any (_addresses)));

  delete from public.access_requests r
  where r.org_id = _org
    and (pg_catalog.lower(r.email) = any (_addresses)
         or (r.signup_token is null
             and (r.id = any (_linked_requests) or r.invite_token = any (_accepted_tokens))));

  _outcomes := public.person_deletion_outcomes(_person_id, _org);
  _household_goes := coalesce((_outcomes #>> '{household,goes}')::boolean, false);
  if _household_goes then
    select coalesce(array_agg((e ->> 'id')::uuid), '{}') into _household_entries
    from jsonb_array_elements(_outcomes #> '{household,entries}') as e;
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

  if exists (
    select 1
    from jsonb_to_recordset(_outcomes -> 'funds') as o (id uuid, recipient_id uuid)
    where not exists (
      select 1 from public.giving_funds f
      where f.org_id = _org
        and f.id = o.id
        and f.steward_id is not distinct from o.recipient_id
        and f.needs_review)
  ) then
    raise exception 'delete_person: a fund didn''t end as its outcome said' using errcode = 'AD003';
  end if;

  return jsonb_build_object(
    'first_name', _first_name,
    'last_name', _last_name,
    'preferred_name', _preferred_name,
    'email', _profile_email,
    'opened_dates', _opened,
    'photo_keys', to_jsonb(_photo_keys));
end;
$$;
