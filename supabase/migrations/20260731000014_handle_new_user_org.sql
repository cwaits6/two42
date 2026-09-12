-- Fail-closed handle_new_user().
-- Replaces the interim version that stamped every signup into the
-- hardcoded default org. Org resolution now comes only from server-owned
-- rows; a signup that matches no approved invitation in exactly one org is
-- rejected, never guessed.
--
-- Resolution order:
--   1. approved access_requests matching the new user's email
--   2. unclaimed family_invites matching the new user's email
--   3. exactly one distinct org across 1–2 → use it
--   4. zero → raise TN001; more than one → raise TN002 (with org-pinned
--      identity one login belongs to one org, so ambiguity is a
--      real conflict, not a case to guess at)
--
-- raw_app_meta_data ->> 'org_id' may DISAMBIGUATE (it must intersect the
-- resolved set, never widen it). raw_app_meta_data is server-set only;
-- raw_user_meta_data is client-supplied at signup and is NEVER consulted
-- for org selection. That distinction is the whole security argument.
--
-- Onboarding contract, stated here so nobody "fixes" this later: an
-- org's first owner has no access request, so self-serve signup must be
-- org-first — provision_organization() creates the org AND an approved
-- access_requests row for the owner's email, and only then is the auth user
-- created. With that ordering this trigger needs no special case. Self-serve
-- onboarding must NOT be solved by adding a fallback branch here.

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

  -- Today's approval logic: an approved access request makes the signup a
  -- member; an invite-only match starts as pending (the family claim flow
  -- promotes it).
  if exists (
    select 1 from public.access_requests
    where lower(email) = lower(new.email) and status = 'approved' and org_id = _org_id
  ) then
    _role := 'member';
  else
    _role := 'pending';
  end if;

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

  insert into public.organization_members (org_id, profile_id)
  values (_org_id, new.id)
  on conflict do nothing;

  return new;
end;
$$;
