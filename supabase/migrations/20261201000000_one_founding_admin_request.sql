-- An email founds at most one church. provision_organization()'s TN005 check
-- cannot see a concurrent call's uncommitted founding request, so two Add
-- organization requests for the same first admin could both commit and both
-- send an invite; a unique index makes the second wait, then fail.

-- ── 1. Existing duplicates ────────────────────────────────────────────────
-- Two approved founding requests for one email already fail that admin's
-- signup as ambiguous (TN002), so neither church can onboard them. Denying
-- all but the newest lets the newest church do so, and is the state Send
-- invite already refuses to re-approve.
with ranked as (
  select id,
         row_number() over (
           partition by lower(email) order by created_at desc, id desc
         ) as rn
  from public.access_requests
  where approved_role = 'admin' and status = 'approved'
)
update public.access_requests ar
set status = 'denied', signup_token = null, token_expires_at = null
from ranked
where ar.id = ranked.id and ranked.rn > 1;

-- ── 2. One approved founding request per email ────────────────────────────
-- status = 'approved' matches the TN005 check: a founding request a church
-- admin denied does not stop that email founding another church.
create unique index access_requests_one_founding_admin
  on public.access_requests (lower(email))
  where approved_role = 'admin' and status = 'approved';

comment on index public.access_requests_one_founding_admin is
  'One approved founding (first admin) request per email across churches, so a concurrent second Add organization fails with TN005. Retry and resend update the same row.';

-- ── 3. provision_organization() ───────────────────────────────────────────
-- Body from 20261123000000_database_tidy_up.sql with the profile check moved
-- ahead of the founding request, and that insert mapping the index's
-- violation to TN005.
create or replace function public.provision_organization(_name text, _owner_email text)
  returns uuid
  language plpgsql security definer set search_path = ''
as $_$
declare
  _org_id uuid;
  _constraint text;
begin
  -- 1. The org itself. branding carries only the tenant-overridable keys
  -- from docs/design/DESIGN.md: display_name, accent, reply_to.
  insert into public.organizations (name, branding, status)
  values (
    _name,
    jsonb_build_object('display_name', _name, 'accent', null, 'reply_to', null),
    'active'
  )
  returning id into _org_id;

  -- 2. Settings defaults — the org-level keys in one auditable place. No
  -- seeded setting is anon-readable: the org's public name lives in
  -- organizations.branding.display_name.
  insert into public.site_settings (org_id, key, value, is_public)
  values
    (_org_id, 'giving_manage_mode',      'stewards',    false);

  -- 3. The owner email must not already have a profile. The org created
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
  -- through the approved access request below. Checked before that
  -- request is inserted so an email that also has a profile elsewhere
  -- keeps raising TN004.
  if exists (
    -- Case-insensitive to match handle_new_user(): profile emails come from
    -- GoTrue lowercased, while _owner_email arrives as typed.
    select 1 from public.profiles where lower(email) = lower(_owner_email)
  ) then
    raise exception 'owner email % already belongs to another organization', _owner_email
      using errcode = 'TN004';
  end if;

  -- 4. Approved access request for the owner, so their signup resolves
  -- under handle_new_user()'s fail-closed rules. approved_role = 'admin'
  -- is what makes the owner the founding admin: handle_new_user()
  -- reads it at signup time, so the org never exists without an admin path.
  -- access_requests_one_founding_admin makes a concurrent call for the same
  -- email wait here for the other to commit, then fail.
  begin
    insert into public.access_requests (org_id, name, email, status, reviewed_at, approved_role)
    values (_org_id, _name || ' owner', _owner_email, 'approved', now(), 'admin');
  exception when unique_violation then
    get stacked diagnostics _constraint = constraint_name;
    if _constraint = 'access_requests_one_founding_admin' then
      raise exception 'owner email % already has an approved access request or unclaimed invite in another organization', _owner_email
        using errcode = 'TN005';
    end if;
    raise;
  end;

  -- 5. Nor may the owner email hold an approved access request or unclaimed
  -- family invite in another org (a profile-less owner: invited or approved
  -- elsewhere but not yet signed up). The step-4 insert would then be a
  -- SECOND match for handle_new_user(), which rejects the owner's eventual
  -- signup as ambiguous (TN002) — a broken state this transaction would
  -- otherwise commit. The org_id filter excludes the request created in
  -- step 4.
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
  'Builds a complete org in one transaction: the organizations row, the org-level giving setting and the approved owner access request (approved_role = admin). TN004 when the owner email already has a profile, TN005 when it is approved or invited in another org, including by a concurrent call that commits first. service_role only.';
