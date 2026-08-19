-- Reserved org slug labels (Phase 5 PR 1, CWA-65 / #358).
--
-- Slugs become host labels (`<slug>.<platform-apex>`) once Phase 5's
-- wildcard/custom-domain routing ships (docs/plans/phase-5-domains-email.md
-- §4, §12 step 1). Any org minted today with slug `app`, `api`, `www`,
-- `admin`, ... would shadow a platform host then, and a slug cannot be
-- reclaimed from a live org without a support incident. So the denylist
-- lands now, before any slug-as-host routing exists. No routing change here.
--
-- provision_organization(): body copied verbatim from
-- 20260802000002_access_requests_approved_role.sql:140-263 (the live
-- definition); ONLY the reserved-label check after the TN003 shape check is
-- new (raises TN006). Mirrored in lib/org.ts as RESERVED_ORG_SLUGS /
-- isReservedOrgSlug() — keep both lists in sync.
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

  -- Reserved subdomain labels (Phase 5 §4, CWA-65 / #358): slugs become host
  -- labels once wildcard/custom-domain routing ships, so any of these would
  -- shadow a platform host. 'default' is deliberately absent — it is the
  -- slug of the one org that exists today (20260730010000_org_spine.sql);
  -- add it once that org is renamed or retired. Mirrored in lib/org.ts's
  -- RESERVED_ORG_SLUGS — keep both lists in sync. _slug is already
  -- lowercase-only here (the TN003 regex has no case-insensitive flag), so a
  -- plain equality match is correct.
  if _slug = any(array[
    'www', 'app', 'api', 'admin', 'platform', 'auth', 'mail', 'email',
    'static', 'assets', 'cdn', 'status', 'docs', 'blog', 'help', 'support',
    'dev', 'staging', 'preview', 'test'
  ]) then
    raise exception 'organization slug % is reserved', _slug using errcode = 'TN006';
  end if;

  -- 1. The org itself. branding carries only the tenant-overridable keys
  -- from #221 / docs/design/DESIGN.md: display_name, logo_url, accent,
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
  -- the migration-seeded default. Only site_name is anon-readable (#215).
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
  -- is what makes the owner the founding admin (CWA-11): handle_new_user()
  -- reads it at signup time, so the org never exists without an admin path.
  insert into public.access_requests (org_id, name, email, status, reviewed_at, approved_role)
  values (_org_id, _name || ' owner', _owner_email, 'approved', now(), 'admin');

  -- 6. The owner email must not already have a profile. The org created
  -- above holds no profiles yet, so ANY existing profile with this email
  -- necessarily belongs to another org — and a profile is never moved
  -- between orgs. An unscoped `update profiles set org_id = _org_id where
  -- email = ...` would be a cross-tenant write: once Phase 4 exposes a
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

-- Restated from 20260802000002:251-263, unchanged: create or replace keeps
-- existing ACLs, but stating them keeps the function's reachability auditable
-- at its latest definition site.
revoke execute on function public.provision_organization(text, text, text)
  from public, anon, authenticated;

-- service_role keeps EXECUTE. Supabase's default privileges already grant it;
-- stating it explicitly means the Phase 4 server-side caller does not depend
-- on those defaults. service_role is never reachable from clients, so this
-- does not re-open PostgREST RPC.
grant execute on function public.provision_organization(text, text, text)
  to service_role;
