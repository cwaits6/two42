-- Stop writing and reading organization_members. profiles.org_id is the
-- only membership anchor any helper uses; the table is dropped by the next
-- migration once nothing here writes or reads it.

-- ── 1. handle_new_user(): no organization_members insert ─────────────────
-- Body copied verbatim from 20261027000000_group_invites.sql minus that
-- insert. CREATE OR REPLACE keeps the existing owner and grants.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  _full_name text := new.raw_user_meta_data->>'full_name';
  _first text;
  _last text;
  _org_ids uuid[];
  _org_id uuid;
  _hint_org_id uuid;
  _role text;
  _request_id uuid;
  _invite_group_id uuid;
  _invite_id uuid;
  _voucher uuid;
begin
  -- Email matches are case-insensitive: GoTrue lowercases auth emails while
  -- access_requests / family_invites store them as typed, so an exact
  -- comparison would raise TN001 for anyone whose request was entered with
  -- capitals — locking them out of signup entirely.
  select coalesce(array_agg(distinct org_id), '{}') into _org_ids
  from (
    select org_id from public.access_requests
    where lower(email) = lower(new.email) and status = 'approved'
    union
    select org_id from public.family_invites
    where lower(invite_email) = lower(new.email) and accepted_at is null
  ) matches;

  -- Server-set disambiguator only: narrow within the resolved set, never
  -- widen it. (jsonb ->> on a missing key is NULL; a malformed value should
  -- fail the signup loudly rather than be ignored, so no exception handling
  -- around the cast.)
  _hint_org_id := nullif(new.raw_app_meta_data ->> 'org_id', '')::uuid;
  if _hint_org_id is not null and _hint_org_id = any (_org_ids) then
    _org_ids := array[_hint_org_id];
  end if;

  if coalesce(array_length(_org_ids, 1), 0) = 0 then
    raise exception 'signup rejected: no approved access request or invite for %', new.email
      using errcode = 'TN001';
  elsif array_length(_org_ids, 1) > 1 then
    raise exception 'signup ambiguous: % matches approved invitations in multiple organizations', new.email
      using errcode = 'TN002';
  end if;

  _org_id := _org_ids[1];

  -- Approval logic: an approved access request grants its
  -- approved_role, with NULL preserving the previous behavior ('member').
  -- The order by makes a non-NULL approved_role win deterministically if an
  -- org somehow holds two approved requests for the same email. _role stays
  -- NULL — hence 'pending' — when the match came only from family_invites
  -- (the family claim flow promotes it), preserving today's semantics.
  select coalesce(ar.approved_role, 'member') into _role
  from public.access_requests ar
  where lower(ar.email) = lower(new.email)
    and ar.status = 'approved'
    and ar.org_id = _org_id
  order by ar.approved_role is null, ar.created_at desc
  limit 1;
  _role := coalesce(_role, 'pending');

  if _full_name is not null and btrim(_full_name) <> '' then
    if position(' ' in btrim(_full_name)) = 0 then
      _first := btrim(_full_name);
      _last := null;
    else
      _first := btrim(substring(btrim(_full_name) from 1 for (length(btrim(_full_name)) - position(' ' in reverse(btrim(_full_name))))));
      _last := btrim(substring(btrim(_full_name) from (length(btrim(_full_name)) - position(' ' in reverse(btrim(_full_name))) + 2)));
    end if;
  end if;

  insert into public.profiles (id, first_name, last_name, email, role, relationship, org_id)
  values (new.id, _first, _last, new.email, _role, 'primary', _org_id);

  -- The approved request that admits this person may name a group — an
  -- invite link. Its composite FK pins that group to _org_id.
  select ar.id, ar.group_id, ar.group_invite_id
    into _request_id, _invite_group_id, _invite_id
  from public.access_requests ar
  where lower(ar.email) = lower(new.email)
    and ar.status = 'approved'
    and ar.org_id = _org_id
  order by ar.group_id is null, ar.created_at desc
  limit 1;

  if _role <> 'pending' and _invite_group_id is not null then
    select gi.created_by into _voucher
    from public.group_invites gi
    where gi.id = _invite_id and gi.org_id = _org_id;
    insert into public.group_members (org_id, group_id, profile_id, role, added_by)
    values (_org_id, _invite_group_id, new.id, 'member', _voucher)
    on conflict (group_id, profile_id) do nothing;
    update public.group_invite_uses
      set profile_id = new.id
      where access_request_id = _request_id and org_id = _org_id;
  -- One-group orgs: enrol on signup, mirroring group_model_backfill(). With
  -- zero or several groups there is no right answer, so nobody is enrolled.
  -- A family-invite signup lands as 'pending' and is promoted later by the
  -- claim route, which does not enrol.
  elsif _role <> 'pending'
     and (select count(*) from public.groups g where g.org_id = _org_id) = 1 then
    insert into public.group_members (org_id, group_id, profile_id, role)
    select _org_id, g.id, new.id, 'member'
    from public.groups g
    where g.org_id = _org_id
    on conflict (group_id, profile_id) do nothing;
  end if;

  return new;
end;
$$;

-- ── 2. The organizations policy and its helper ────────────────────────────
-- "Org readable within request org" already grants every member their own
-- church's row, under the same restrictive isolation floor.
drop policy "org members can view their orgs" on public.organizations;

drop function public.is_org_member(uuid);
