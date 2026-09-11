-- access_requests.approved_role: founding-admin handoff.
--
-- The epic's onboarding contract (stated in 20260731000014) is org-first:
-- provision_organization() creates the org AND an approved access_requests
-- row for the owner, and the owner's later signup flows through
-- handle_new_user() with no special case. But handle_new_user() hardcodes
-- 'member' for an approved request, so a founding admin provisioned today
-- signs up as a plain member and the new org ships with zero admins.
--
-- This migration adds the one column that closes the gap: approved_role
-- names the role handle_new_user() grants on signup. NULL preserves today's
-- behavior ('member'); provision_organization() stamps 'admin' on the owner
-- row. No new signup route, no new token type, no new email — the existing
-- access_requests → signup_token → /setup-account pipeline carries it.

-- 1. The column. Nullable: every existing row and every ordinary approval
-- keeps today's semantics.
alter table public.access_requests
  add column approved_role text,
  add constraint access_requests_approved_role_check
    check (approved_role is null or approved_role in ('member', 'admin'));

comment on column public.access_requests.approved_role is
  'Role handle_new_user() grants when this approved request resolves a signup. NULL means the pre-Phase-4 behavior (member). Set to admin only by provision_organization() for the founding owner, or by an org admin within their own org.';

-- 2. Close the escalation hole BEFORE the column is reachable. The
-- anon-reachable INSERT policy (20260731000010_rls_settings_access.sql:46-55)
-- is an enumerated with-check allowlist, so it says nothing about a column
-- that did not exist when it was written — without the new arm, any
-- anonymous visitor could submit approved_role = 'admin' and become an admin
-- of the request org the moment their request is approved. All six existing
-- arms are carried forward verbatim; only `approved_role is null` is new.
drop policy "Anyone can submit access request" on public.access_requests;
create policy "Anyone can submit access request" on public.access_requests
  for insert to anon, authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and signup_token is null
    and token_expires_at is null
    and approved_role is null
  );

-- Note: the "Admins can update access requests" UPDATE policy has no
-- explicit WITH CHECK, so it defaults to its USING clause — an org admin can
-- set approved_role within their own org. That stays inside the existing org
-- trust boundary (org admins already manage profiles.role), so it is left
-- unchanged on purpose.

-- 3. handle_new_user(): body copied verbatim from
-- 20260731000014_handle_new_user_org.sql (confirmed identical to the live
-- pg_proc.prosrc); ONLY the role branch changes — the hardcoded 'member'
-- for an approved request becomes coalesce(approved_role, 'member').
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

  insert into public.organization_members (org_id, profile_id)
  values (_org_id, new.id)
  on conflict do nothing;

  return new;
end;
$$;

-- 4. provision_organization(): body copied verbatim from
-- 20260801000002_org_branding_backfill.sql:71-179 (confirmed identical to
-- the live pg_proc.prosrc); ONLY the step-5 insert changes — the owner's
-- approved access request now carries approved_role = 'admin'.
create or replace function public.provision_organization(
  _name        text,
  _slug        text,
  _owner_email text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  _org_id uuid;
  _cal_id uuid;
begin
  if _slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'invalid organization slug: %', _slug using errcode = 'TN003';
  end if;

  -- 1. The org itself. branding carries only the tenant-overridable keys
  -- from docs/design/DESIGN.md: display_name, logo_url, accent,
  -- reply_to.
  insert into public.organizations (name, slug, branding, status)
  values (
    _name,
    _slug,
    jsonb_build_object('display_name', _name, 'logo_url', null, 'accent', null, 'reply_to', null),
    'active'
  )
  returning id into _org_id;

  -- 2. Prayer calendar, wired into settings: lib/prayerCalls.ts and
  -- app/prayer read prayer_calendar_id, and a missing value degrades the
  -- prayer surface — which is why the calendar is provisioning, not
  -- onboarding.
  insert into public.event_calendars (org_id, name, color)
  values (_org_id, 'Prayer Calls', '#7c9885')
  returning id into _cal_id;

  -- 3. Settings defaults — the full key list in one auditable place.
  -- serving_link_mode's deploy default is applied at read time by
  -- getServingLinkMode() (SERVING_LINK_MODE env); the seed row here matches
  -- the migration-seeded default. Only site_name is anon-readable.
  insert into public.site_settings (org_id, key, value, is_public)
  values
    (_org_id, 'site_name',               '',            true),
    (_org_id, 'directory_app_url',       '',            false),
    (_org_id, 'weekly_zoom_url',         '',            false),
    (_org_id, 'zoom_meeting_time',       '',            false),
    (_org_id, 'weekly_prayer_call_url',  '',            false),
    (_org_id, 'weekly_prayer_call_time', '',            false),
    (_org_id, 'serving_link_mode',       'signed',      false),
    (_org_id, 'giving_manage_mode',      'stewards',    false),
    (_org_id, 'giving_dashboard_tile',   'on',          false),
    (_org_id, 'prayer_calendar_id',      _cal_id::text, false);

  -- 4. Empty about page (per-org singleton: PK is (org_id, id), id CHECKed
  -- true).
  insert into public.about_page (org_id, id, body) values (_org_id, true, '');

  -- 5. Approved access request for the owner, so their signup resolves
  -- under handle_new_user()'s fail-closed rules. approved_role = 'admin'
  -- is what makes the owner the founding admin: handle_new_user()
  -- reads it at signup time, so the org never exists without an admin path.
  insert into public.access_requests (org_id, name, email, status, reviewed_at, approved_role)
  values (_org_id, _name || ' owner', _owner_email, 'approved', now(), 'admin');

  -- 6. The owner email must not already have a profile. The org created
  -- above holds no profiles yet, so ANY existing profile with this email
  -- necessarily belongs to another org — and a profile is never moved
  -- between orgs. An unscoped `update profiles set org_id = _org_id where
  -- email = ...` would be a cross-tenant write: once self-serve signup exposes a
  -- caller, passing a competing org's admin email would re-pin that admin
  -- into the caller's org — an account-takeover primitive that a "who may
  -- provision" guard does not address. Raise instead, matching
  -- handle_new_user()'s TN001/TN002: an email that already belongs
  -- elsewhere is a conflict for a human to resolve, not something to
  -- silently resolve by moving the account. The owner's profiles and
  -- organization_members rows are created by handle_new_user() when they
  -- sign up AFTER provisioning, through the approved access request above.
  if exists (
    -- Case-insensitive to match handle_new_user(): profile emails come from
    -- GoTrue lowercased, while _owner_email arrives as typed.
    select 1 from public.profiles where lower(email) = lower(_owner_email)
  ) then
    raise exception 'owner email % already belongs to another organization', _owner_email
      using errcode = 'TN004';
  end if;

  -- 7. Nor may the owner email hold an approved access request or unclaimed
  -- family invite in another org (a profile-less owner: invited or approved
  -- elsewhere but not yet signed up). The step-5 insert would then be a
  -- SECOND match for handle_new_user(), which rejects the owner's eventual
  -- signup as ambiguous (TN002) — a broken state this transaction would
  -- otherwise commit. The org_id filter excludes the request created in
  -- step 5; checked after step 6 so an email that also has a profile keeps
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
$$;

-- Restated from 20260801000002:181-189, unchanged: create or replace keeps
-- existing ACLs, but stating them keeps the function's reachability auditable
-- at its latest definition site.
revoke execute on function public.provision_organization(text, text, text)
  from public, anon, authenticated;

-- service_role keeps EXECUTE. Supabase's default privileges already grant it;
-- stating it explicitly means the server-side caller does not depend
-- on those defaults. service_role is never reachable from clients, so this
-- does not re-open PostgREST RPC.
grant execute on function public.provision_organization(text, text, text)
  to service_role;
