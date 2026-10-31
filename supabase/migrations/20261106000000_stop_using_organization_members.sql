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

-- ── 2. provision_organization(): comment only ─────────────────────────────
-- Body copied verbatim from 20261027000001_retire_org_slug_resolution.sql;
-- only the step-4 comment changes. Grants and the function comment are kept.
create or replace function public.provision_organization(_name text, _owner_email text)
  returns uuid
  language plpgsql security definer set search_path = ''
as $_$
declare
  _org_id uuid;
begin
  -- 1. The org itself. branding carries only the tenant-overridable keys
  -- from docs/design/DESIGN.md: display_name, logo_url, accent,
  -- reply_to.
  insert into public.organizations (name, branding, status)
  values (
    _name,
    jsonb_build_object('display_name', _name, 'logo_url', null, 'accent', null, 'reply_to', null),
    'active'
  )
  returning id into _org_id;

  -- 2. Settings defaults — the org-level keys in one auditable place. No
  -- seeded setting is anon-readable: the org's public name lives in
  -- organizations.branding.display_name.
  insert into public.site_settings (org_id, key, value, is_public)
  values
    (_org_id, 'giving_manage_mode',      'stewards',    false),
    (_org_id, 'giving_dashboard_tile',   'on',          false);

  -- 3. Approved access request for the owner, so their signup resolves
  -- under handle_new_user()'s fail-closed rules. approved_role = 'admin'
  -- is what makes the owner the founding admin: handle_new_user()
  -- reads it at signup time, so the org never exists without an admin path.
  insert into public.access_requests (org_id, name, email, status, reviewed_at, approved_role)
  values (_org_id, _name || ' owner', _owner_email, 'approved', now(), 'admin');

  -- 4. The owner email must not already have a profile. The org created
  -- above holds no profiles yet, so ANY existing profile with this email
  -- necessarily belongs to another org — and a profile is never moved
  -- between orgs. An unscoped `update profiles set org_id = _org_id where
  -- email = ...` would be a cross-tenant write: once self-serve signup exposes a
  -- caller, passing a competing org's admin email would re-pin that admin
  -- into the caller's org — an account-takeover primitive that a "who may
  -- provision" guard does not address. Raise instead, matching
  -- handle_new_user()'s TN001/TN002: an email that already belongs
  -- elsewhere is a conflict for a human to resolve, not something to
  -- silently resolve by moving the account. The owner's profile is
  -- created by handle_new_user() when they sign up AFTER provisioning,
  -- through the approved access request above.
  if exists (
    -- Case-insensitive to match handle_new_user(): profile emails come from
    -- GoTrue lowercased, while _owner_email arrives as typed.
    select 1 from public.profiles where lower(email) = lower(_owner_email)
  ) then
    raise exception 'owner email % already belongs to another organization', _owner_email
      using errcode = 'TN004';
  end if;

  -- 5. Nor may the owner email hold an approved access request or unclaimed
  -- family invite in another org (a profile-less owner: invited or approved
  -- elsewhere but not yet signed up). The step-3 insert would then be a
  -- SECOND match for handle_new_user(), which rejects the owner's eventual
  -- signup as ambiguous (TN002) — a broken state this transaction would
  -- otherwise commit. The org_id filter excludes the request created in
  -- step 3; checked after step 4 so an email that also has a profile keeps
  -- raising TN004.
  if exists (
    select 1 from public.access_requests
    where lower(email) = lower(_owner_email)
      and status = 'approved'
      and org_id <> _org_id
  ) or exists (
    select 1 from public.family_invites
    where lower(invite_email) = lower(_owner_email)
      and accepted_at is null
      and org_id <> _org_id
  ) then
    raise exception 'owner email % already has an approved access request or unclaimed invite in another organization', _owner_email
      using errcode = 'TN005';
  end if;

  return _org_id;
end;
$_$;

-- ── 3. The organizations policy and its helper ────────────────────────────
-- "Org readable within request org" already grants every member their own
-- church's row, under the same restrictive isolation floor.
drop policy "org members can view their orgs" on public.organizations;

drop function public.is_org_member(uuid);
