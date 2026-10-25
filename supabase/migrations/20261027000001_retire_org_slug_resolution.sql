-- Retire organizations.slug as a resolver. The slug join page is gone and
-- every anonymous entry point is a token row read on the service client, so
-- nothing resolves an org from a header any more, and provisioning no
-- longer needs a slug. The column itself stays until every deployed reader
-- has stopped selecting it; a later migration drops it.

-- ── 1. Anonymous requests resolve no org ──────────────────────────────────
-- Keeps the policy-facing name: every isolation policy wraps it as
-- (select public.app_request_org_id()).
create or replace function public.app_request_org_id() returns uuid
  language sql stable security definer set search_path = ''
as $$
  select public.app_current_org_id();
$$;

comment on function public.app_request_org_id() is
  'Org of the calling principal (app_current_org_id()). NULL for anonymous and service callers — fail-closed. Kept as the policy-facing name; wrap call sites as (select public.app_request_org_id()).';

-- ── 2. No public write path into access_requests ──────────────────────────
-- The slug join form was its only caller; a household invite now files its
-- request through a token-anchored route on the service client.
drop policy "Anyone can submit access request" on public.access_requests;

-- ── 3. provision_organization(_name, _owner_email) ────────────────────────
alter table public.organizations alter column slug drop not null;

drop function public.provision_organization(text, text, text);

create function public.provision_organization(_name text, _owner_email text)
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

revoke execute on function public.provision_organization(text, text)
  from public, anon, authenticated;
grant execute on function public.provision_organization(text, text)
  to service_role;

comment on function public.provision_organization(text, text) is
  'Builds a complete org in one transaction: the organizations row, the two org-level giving settings and the approved owner access request (approved_role = admin). TN004 when the owner email already has a profile, TN005 when it is approved or invited in another org. service_role only.';
