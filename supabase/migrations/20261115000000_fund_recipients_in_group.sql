-- A fund's people stay inside its group, and a fund that loses its recipient
-- never goes away or keeps taking gifts on its own.
--
-- Payment handles are free text saved on the fund, so they may still pay the
-- person who left. Either way of losing a recipient therefore sets needs_review,
-- and only a leader of the group clears it. The flag is separate from is_active
-- because Reopen sets is_active, and a retired fund stays retired once confirmed.

alter table public.giving_funds
  alter column steward_id drop not null,
  add column needs_review boolean not null default false;

comment on column public.giving_funds.needs_review is
  'Set when the fund loses its recipient. Off Give until a leader of the group clears it. Only ever cleared by that leader; see giving_fund_recipients_guard().';

alter table public.giving_funds
  drop constraint giving_funds_steward_id_fkey,
  add constraint giving_funds_steward_id_fkey
    foreign key (steward_id, org_id) references public.profiles (id, org_id)
    on delete set null (steward_id);

-- Makes "confirmed with no recipient" unrepresentable, whoever writes it.
alter table public.giving_funds
  add constraint giving_funds_no_recipient_needs_review
    check (steward_id is not null or needs_review);

-- Every way a recipient is lost reaches this as steward_id going null: the
-- membership trigger below, the foreign key when a profile is deleted, and the
-- backfill. Which of the first two runs first for one profile delete depends on
-- trigger order, and neither order changes the result, because the rule lives
-- here. RLS WITH CHECK runs after this, so a person can't use promotion to hand
-- away a fund they may not reassign.
--
-- A person qualifies by a group_members row and not being pending, the test
-- is_group_member() makes. FOR KEY SHARE closes the race with their removal: the
-- removal waits for this write, so its trigger sees this fund, or this read waits
-- for the removal and finds no row.
create function public.giving_fund_recipients_guard() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  -- OLD reads as all nulls on INSERT, so a new fund checks both people.
  _moved boolean := new.group_id is distinct from old.group_id or new.org_id is distinct from old.org_id;
begin
  if tg_op = 'UPDATE' then
    if old.steward_id is not null and new.steward_id is null then
      new.needs_review := true;
      new.steward_role := null;
      if new.co_steward_id is distinct from old.steward_id and exists (
        select 1 from public.group_members gm
        join public.profiles p on p.id = gm.profile_id and p.org_id = gm.org_id
        where gm.group_id = new.group_id
          and gm.org_id = new.org_id
          and gm.profile_id = new.co_steward_id
          and p.role <> 'pending'
        for key share of gm
      ) then
        new.steward_id := new.co_steward_id;
      end if;
      new.co_steward_id := null;
    end if;

    -- The group the fund was flagged in, or leading any other group and moving
    -- the fund there in the same write would clear it.
    if old.needs_review and not new.needs_review
       and not public.is_group_leader(old.group_id) then
      raise exception 'giving_funds: only a leader of the group can confirm fund %', old.id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Only a person this write names: someone moved back out of the group between
  -- writes is the triggers' to handle, not a reason to refuse an unrelated edit.
  if exists (
    select 1
    from unnest(array[
      case when _moved or new.steward_id is distinct from old.steward_id then new.steward_id end,
      case when _moved or new.co_steward_id is distinct from old.co_steward_id then new.co_steward_id end
    ]) as named (person)
    where named.person is not null
      and not exists (
        select 1 from public.group_members gm
        join public.profiles p on p.id = gm.profile_id and p.org_id = gm.org_id
        where gm.group_id = new.group_id
          and gm.org_id = new.org_id
          and gm.profile_id = named.person
          and p.role <> 'pending'
        for key share of gm)
  ) then
    raise exception 'giving_funds: a fund''s people must be members of its group'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
revoke execute on function public.giving_fund_recipients_guard() from public, anon, authenticated;

create trigger giving_funds_keep_recipients_in_group
  before insert or update of steward_id, co_steward_id, group_id, org_id, needs_review
  on public.giving_funds
  for each row execute function public.giving_fund_recipients_guard();

-- The recipient goes first, so a second person who left in the same statement
-- isn't promoted: AFTER ROW triggers see every row that statement deleted.
create function public.group_member_removed_leaves_funds() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.group_members gm
    where gm.group_id = old.group_id
      and gm.org_id = old.org_id
      and gm.profile_id = old.profile_id
  ) then
    return null;
  end if;

  update public.giving_funds f
     set steward_id = null
   where f.group_id = old.group_id
     and f.org_id = old.org_id
     and f.steward_id = old.profile_id;

  update public.giving_funds f
     set co_steward_id = null
   where f.group_id = old.group_id
     and f.org_id = old.org_id
     and f.co_steward_id = old.profile_id;

  return null;
end;
$$;
revoke execute on function public.group_member_removed_leaves_funds() from public, anon, authenticated;

create trigger group_members_leave_funds
  after delete or update of group_id, profile_id, org_id on public.group_members
  for each row execute function public.group_member_removed_leaves_funds();

-- Safe to run against any state: only a person outside the fund's group matches,
-- and after one pass nobody does. Each row's own org_id scopes its membership
-- check. Kept so pgTAP can prove what the deploy did.
create function public.giving_funds_apply_recipient_rules(
  out promoted bigint, out no_recipient bigint, out second_person_removed bigint)
  language plpgsql set search_path = ''
as $$
begin
  with lost as (
    update public.giving_funds f
       set steward_id = null
     where f.steward_id is not null
       and not exists (
         select 1 from public.group_members gm
         where gm.group_id = f.group_id and gm.org_id = f.org_id and gm.profile_id = f.steward_id)
    returning f.steward_id
  )
  select count(*) filter (where steward_id is not null), count(*) filter (where steward_id is null)
    into promoted, no_recipient
  from lost;

  update public.giving_funds f
     set co_steward_id = null
   where f.co_steward_id is not null
     and not exists (
       select 1 from public.group_members gm
       where gm.group_id = f.group_id and gm.org_id = f.org_id and gm.profile_id = f.co_steward_id);
  get diagnostics second_person_removed = row_count;
end;
$$;
revoke execute on function public.giving_funds_apply_recipient_rules() from public, anon, authenticated, service_role;

do $$
declare
  _result record;
begin
  select * into _result from public.giving_funds_apply_recipient_rules();
  raise notice 'giving_funds: % promoted to needs review, % with no recipient, % second person removed',
    _result.promoted, _result.no_recipient, _result.second_person_removed;
end $$;

-- A member's direct read has to be closed too: the Give page filter alone would
-- leave a paused fund's handles readable. Its recipient keeps read access so they
-- can correct the payment methods.
drop policy "Group members can view giving funds" on public.giving_funds;
create policy "Group members can view giving funds"
  on public.giving_funds for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and public.is_group_member(group_id)
    and (
      (steward_id is not null and not needs_review)
      or public.is_group_leader(group_id)
      or steward_id = (select auth.uid())
    )
  );

-- The subquery runs under the policy above, so the two can't disagree.
drop policy "Group members can view fund methods" on public.giving_fund_methods;
create policy "Group members can view fund methods"
  on public.giving_fund_methods for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and public.is_group_member(group_id)
    and exists (
      select 1 from public.giving_funds f
      where f.id = giving_fund_methods.fund_id
        and f.org_id = giving_fund_methods.org_id
    )
  );

-- The profile delete at the end of delete_person() applies the fund rules through
-- the foreign keys and the triggers above, so this body leaves funds to them.
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
    'email', _profile_email,
    'opened_dates', _opened,
    'photo_keys', to_jsonb(_photo_keys));
end;
$$;
