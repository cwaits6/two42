-- Org branding backfill + read unblock.
-- organizations.branding has existed since 20260730010000_org_spine.sql, but
-- org #1 was seeded '{}' while provision_organization() gives new orgs the
-- canonical shape — the seeded org could never be branded. Worse, the seeded
-- org's members could not READ the table at all: the only permissive select
-- policy ("org members can view their orgs") is gated on
-- organization_members, which handle_new_user() has populated only since
-- 20260731000014 and which was never backfilled — so every profile predating
-- that migration (i.e. all of org #1) resolved 0 rows, as did every anon
-- caller. Backfill the seeded org, add a permissive SELECT policy that does
-- not depend on membership (the restrictive "org isolation" floor still pins
-- rows to the request org), and add reply_to to the canonical branding shape.

-- Preflight: the seeded org must exist, or the backfill would silently
-- touch zero rows and the app would keep serving env-var defaults.
do $$
begin
  if not exists (
    select 1 from public.organizations
    where id = '00000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'seeded organization 00000000-0000-0000-0000-000000000001 is missing; refusing a zero-row branding backfill';
  end if;
end $$;

-- Backfill org #1 to the canonical shape. Defaults on the LEFT of || so any
-- hand-edited key already present in branding wins; values match the
-- lib/config.ts / DESIGN.md Clay defaults, so rendered output is unchanged.
update public.organizations
set branding = jsonb_build_object(
      'display_name', 'two42',
      'logo_url',     null,
      'accent',       '#B85C38',
      'reply_to',     null
    ) || branding
where id = '00000000-0000-0000-0000-000000000001';

-- The unblocking change: a permissive SELECT policy. Postgres RLS needs at
-- least one permissive policy to grant anything; the restrictive isolation
-- floor already limits rows to the request org, and this policy repeats the
-- same predicate rather than using bare `true` (CLAUDE.md forbids it).
create policy "Org readable within request org"
  on public.organizations for select
  to anon, authenticated
  using (id = (select public.app_request_org_id()));

-- RLS picks rows; it cannot pick columns. The policy above is the first thing
-- to return an organizations row to a caller at all, so it is also the first
-- thing to hand anon the whole row — including `status` (an org's
-- active/suspended lifecycle state) and any column a later phase adds, which
-- Supabase's default table-level grant would expose the moment it exists.
-- Column privileges are the column-level half of the same boundary, and they
-- are fail-closed by construction: ADD COLUMN grants nothing, so a new column
-- is unreadable until someone lists it here on purpose.
--
-- KNOWN GAP: branding is a single jsonb column, so `reply_to` rides along with
-- the three keys the app shell needs. Column privileges cannot reach inside a
-- jsonb value; excluding it needs a SECURITY DEFINER projection and a
-- privileged re-read for the email senders (lib/email/identity.ts resolves
-- Reply-To through this same request-scoped path). Deliberately deferred: the
-- value is an address the org already publishes on every outbound email, and
-- it is only reachable by a caller who has already named this org via
-- x-two42-org.
revoke select on public.organizations from anon, authenticated;
grant select (id, name, slug, branding)
  on public.organizations to anon, authenticated;

-- provision_organization(): add reply_to so newly provisioned orgs share one
-- branding shape with org #1. Body copied verbatim from 20260731000016;
-- ONLY the jsonb_build_object line changes.
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
  -- under handle_new_user()'s fail-closed rules.
  insert into public.access_requests (org_id, name, email, status, reviewed_at)
  values (_org_id, _name || ' owner', _owner_email, 'approved', now());

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

revoke execute on function public.provision_organization(text, text, text)
  from public, anon, authenticated;

-- service_role keeps EXECUTE. Supabase's default privileges already grant it;
-- stating it explicitly means the server-side caller does not depend
-- on those defaults. service_role is never reachable from clients, so this
-- does not re-open PostgREST RPC.
grant execute on function public.provision_organization(text, text, text)
  to service_role;
