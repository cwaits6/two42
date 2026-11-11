-- Removes fields the app no longer reads or writes, stops provisioning two
-- unused church settings, and returns a group's color from
-- discoverable_groups().
--
-- The build deployed while this runs names none of the dropped objects: it
-- selects named lectures and group_settings columns without the dropped ones,
-- never reads prayer_call_sessions or giving_dashboard_tile, and ignores the
-- extra discoverable_groups() column. The retired directory hide flags are
-- not dropped here: profile saves still reset them, which keeps a newly
-- entered value from being deleted by the sweep that precedes their drop.

-- ── 1. Lesson thumbnail link ──────────────────────────────────────────────
alter table public.lectures drop column thumbnail_url;

-- ── 2. Retired call fields ────────────────────────────────────────────────
-- group_content_backfill() names the table and the columns below. It was a
-- one-shot backfill run by 20261017000000_group_scoped_content.sql right after
-- its creation, with no client grant, so it is dropped rather than rewritten.
drop function public.group_content_backfill();

alter table public.group_settings
  drop column weekly_zoom_url,
  drop column zoom_meeting_time,
  drop column weekly_prayer_call_url,
  drop column weekly_prayer_call_time;

comment on table public.group_settings is
  'Per-group settings: the serving email link mode, what a calendar event shows, and event reminders. One row per group, created on first save; an absent row means the defaults.';

-- A session's only link to events is its own event_id FK, which goes with the
-- table; no FK points into prayer_call_sessions, so the drop deletes no event.
-- A plain drop (no cascade) fails instead if anything still depends on it.
drop table public.prayer_call_sessions;

-- ── 3. What a new church is set up with ───────────────────────────────────
-- Body copied from 20261106000000_stop_using_organization_members.sql
-- without the logo_url branding key and the giving_dashboard_tile setting.
-- create or replace keeps SECURITY DEFINER, the search_path, the owner and
-- the service_role-only grant.
create or replace function public.provision_organization(_name text, _owner_email text)
  returns uuid
  language plpgsql security definer set search_path = ''
as $_$
declare
  _org_id uuid;
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

comment on function public.provision_organization(text, text) is
  'Builds a complete org in one transaction: the organizations row, the org-level giving setting and the approved owner access request (approved_role = admin). TN004 when the owner email already has a profile, TN005 when it is approved or invited in another org. service_role only.';

-- Churches set up earlier: the same two removals. Nothing reads either.
delete from public.site_settings where key = 'giving_dashboard_tile';
update public.organizations set branding = branding - 'logo_url' where branding ? 'logo_url';

-- ── 4. A group's own color in Find a group ────────────────────────────────
-- The return type gains a column, which create or replace cannot do. The
-- body, the church filter, SECURITY DEFINER, the search_path, the grants and
-- the comment are otherwise those of 20261026000000_group_discovery.sql.
-- color is the group's first calendar's, as loadGroupMemberships() reads it
-- for the viewer's own groups; NULL when the group has none.
drop function public.discoverable_groups();

create function public.discoverable_groups()
returns table (
  id uuid,
  name text,
  description text,
  member_count integer,
  is_private boolean,
  join_policy text,
  viewer_role text,
  request_status text,
  color text
)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select p.org_id, (p.role = 'admin') as is_admin
    from public.profiles p
    where p.id = auth.uid() and p.role <> 'pending'
  ),
  org as (
    select o.group_discovery from public.organizations o join me on o.id = me.org_id
  )
  select
    g.id,
    g.name,
    g.description,
    (select count(*)::int from public.group_members c
      where c.group_id = g.id and c.org_id = g.org_id),
    g.is_private,
    g.join_policy,
    gm.role,
    r.status,
    (select cal.color from public.event_calendars cal
      where cal.group_id = g.id and cal.org_id = g.org_id
      order by cal.created_at, cal.id
      limit 1)
  from public.groups g
  cross join me
  cross join org
  left join public.group_members gm
    on gm.group_id = g.id and gm.org_id = g.org_id and gm.profile_id = auth.uid()
  left join public.group_join_requests r
    on r.group_id = g.id and r.org_id = g.org_id
   and r.profile_id = auth.uid() and r.status = 'pending'
  where g.org_id = me.org_id
    and (gm.id is not null or (org.group_discovery and (not g.is_private or me.is_admin)))
  order by (gm.id is null), g.name;
$$;

revoke execute on function public.discoverable_groups() from public, anon;
grant  execute on function public.discoverable_groups() to authenticated;

comment on function public.discoverable_groups() is
  'The groups a member may see on Find a group and Directory › Groups: their own always; others while the org switch is on and the group is not private; private groups additionally for org admins. Tenant anchor: the caller''s own profiles row (auth.uid(), not pending); no parameter. Returns only the columns the discovery row shows, including the group''s calendar color.';
