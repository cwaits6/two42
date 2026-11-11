-- Removes fields the app no longer reads or writes, stops provisioning two
-- unused church settings, and returns a group's color from
-- discoverable_groups().
--
-- The build deployed while this runs names none of the dropped objects: it
-- selects named lectures and group_settings columns without the dropped ones,
-- never reads prayer_call_sessions or giving_dashboard_tile, and ignores the
-- extra discoverable_groups() column. The retired directory hide flags are
-- not dropped here: that build still writes them on every profile save.

-- ── 1. Lesson thumbnail link ──────────────────────────────────────────────
alter table public.lectures drop column thumbnail_url;

-- ── 2. Retired call fields ────────────────────────────────────────────────
-- group_content_backfill() names the table and the columns below, so it is
-- replaced first without them. The body is otherwise copied from
-- 20261017000000_group_scoped_content.sql; create or replace keeps its
-- owner and its revoked grants.
create or replace function public.group_content_backfill() returns void
  language plpgsql set search_path = ''
as $$
declare
  _org record;
  _grp uuid;
  _grp_name text;
  _g record;
  _survivor uuid;
  _cals int;
  _adopted_cals int;
  _events_before bigint;
  _events_after bigint;
  _bad_events bigint;
  _t text;
  _before bigint;
  _after bigint;
  _nulls bigint;
  _content_tables constant text[] := array[
    'announcements', 'lecture_series', 'giving_funds', 'prayer_requests',
    'about_page', 'class_teachers', 'lectures', 'giving_fund_methods',
    'prayer_responses'];
begin
  lock table public.groups in share mode;
  lock table public.events in share mode;
  lock table public.event_calendars in share mode;

  for _org in
    select o.id from public.organizations o order by o.created_at, o.id
  loop
    select g.id, g.name into _grp, _grp_name
    from public.groups g
    where g.org_id = _org.id
    order by g.created_at, g.id
    limit 1;

    if _grp is null then
      if exists (select 1 from public.events where org_id = _org.id)
         or exists (select 1 from public.event_calendars where org_id = _org.id)
         or exists (select 1 from public.announcements where org_id = _org.id)
         or exists (select 1 from public.lecture_series where org_id = _org.id)
         or exists (select 1 from public.lectures where org_id = _org.id)
         or exists (select 1 from public.about_page where org_id = _org.id)
         or exists (select 1 from public.class_teachers where org_id = _org.id)
         or exists (select 1 from public.prayer_requests where org_id = _org.id)
         or exists (select 1 from public.giving_funds where org_id = _org.id)
      then
        raise exception 'group content backfill for org %: content rows but no group to own them', _org.id;
      end if;
      continue;
    end if;

    select count(*) into _events_before from public.events where org_id = _org.id;

    -- Calendars: adopt the ungrouped ones, then events inherit their
    -- calendar's group; whatever is left goes to the oldest group.
    update public.event_calendars
    set group_id = _grp
    where org_id = _org.id and group_id is null;
    get diagnostics _adopted_cals = row_count;

    update public.events e
    set group_id = c.group_id
    from public.event_calendars c
    where c.id = e.calendar_id and c.org_id = e.org_id
      and e.org_id = _org.id and e.group_id is null;
    update public.events
    set group_id = _grp
    where org_id = _org.id and group_id is null;

    -- One calendar per group: the oldest survives, carries the group's
    -- name and the Clay default, and every event of the group points at it.
    for _g in
      select g.id, g.name from public.groups g where g.org_id = _org.id order by g.created_at, g.id
    loop
      select count(*) into _cals from public.event_calendars
      where org_id = _org.id and group_id = _g.id;

      if _cals = 0 then
        insert into public.event_calendars (org_id, group_id, name, color)
        values (_org.id, _g.id, _g.name, '#B85C38')
        returning id into _survivor;
      else
        select id into _survivor from public.event_calendars
        where org_id = _org.id and group_id = _g.id
        order by created_at, id
        limit 1;
        if _cals > 1 or (_g.id = _grp and _adopted_cals > 0) then
          update public.event_calendars
          set name = _g.name, color = '#B85C38'
          where id = _survivor;
        end if;
      end if;

      update public.events
      set calendar_id = _survivor
      where org_id = _org.id and group_id = _g.id
        and calendar_id is distinct from _survivor;

      delete from public.event_calendars
      where org_id = _org.id and group_id = _g.id and id <> _survivor;
    end loop;

    select count(*) into _events_after from public.events where org_id = _org.id;
    if _events_after <> _events_before then
      raise exception 'group content backfill for org %: % events after the fold, % before',
        _org.id, _events_after, _events_before;
    end if;
    select count(*) into _bad_events
    from public.events e
    left join public.event_calendars c on c.id = e.calendar_id
    where e.org_id = _org.id and (c.id is null or c.group_id <> e.group_id);
    if _bad_events > 0 then
      raise exception 'group content backfill for org %: % event(s) outside their group''s calendar',
        _org.id, _bad_events;
    end if;
    if exists (
      select 1 from public.groups g
      where g.org_id = _org.id
        and (select count(*) from public.event_calendars c where c.group_id = g.id) <> 1
    ) then
      raise exception 'group content backfill for org %: a group does not have exactly one calendar', _org.id;
    end if;

    -- The other content tables. Children inherit their parent's group
    -- first so the three-column FKs below hold; the rest go to the oldest
    -- group. Counts are asserted per table.
    foreach _t in array _content_tables loop
      execute format('select count(*) from public.%I where org_id = $1', _t)
        into _before using _org.id;

      case _t
        when 'lectures' then
          update public.lectures l set group_id = s.group_id
          from public.lecture_series s
          where s.id = l.series_id and s.org_id = l.org_id
            and l.org_id = _org.id and l.group_id is null;
        when 'giving_fund_methods' then
          update public.giving_fund_methods m set group_id = f.group_id
          from public.giving_funds f
          where f.id = m.fund_id and f.org_id = m.org_id
            and m.org_id = _org.id and m.group_id is null;
        when 'prayer_responses' then
          update public.prayer_responses pr set group_id = r.group_id
          from public.prayer_requests r
          where r.id = pr.request_id and r.org_id = pr.org_id
            and pr.org_id = _org.id and pr.group_id is null;
        else
          null;
      end case;

      execute format('update public.%I set group_id = $1 where org_id = $2 and group_id is null', _t)
        using _grp, _org.id;

      execute format('select count(*), count(*) filter (where group_id is null) from public.%I where org_id = $1', _t)
        into _after, _nulls using _org.id;
      if _after <> _before or _nulls > 0 then
        raise exception 'group content backfill for org %: % has % rows after (% before), % without a group',
          _org.id, _t, _after, _before, _nulls;
      end if;
    end loop;

    -- The org-level link-mode setting becomes the oldest group's.
    insert into public.group_settings (org_id, group_id, serving_link_mode)
    select
      _org.id, _grp,
      case max(value) filter (where key = 'serving_link_mode')
           when 'login' then 'login' when 'signed' then 'signed' end
    from public.site_settings
    where org_id = _org.id
      and key = 'serving_link_mode'
    having count(*) > 0
    on conflict (group_id) do nothing;
  end loop;
end;
$$;

comment on function public.group_content_backfill() is
  'Gives every ungrouped content row to its org''s oldest group, folds each group''s calendars into one (events re-pointed, extras deleted, counts asserted), creates a calendar for a group without one, and moves the org-level link-mode setting onto the oldest group. Idempotent. Callable only by the migration runner and the pgTAP harness.';

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
do $$
declare
  _events_before bigint;
  _events_after bigint;
begin
  if exists (
    select 1 from pg_constraint
    where confrelid = 'public.prayer_call_sessions'::regclass and contype = 'f'
  ) then
    raise exception 'prayer_call_sessions is referenced by a foreign key';
  end if;

  select count(*) into _events_before from public.events;
  drop table public.prayer_call_sessions;
  select count(*) into _events_after from public.events;
  if _events_after <> _events_before then
    raise exception 'dropping prayer_call_sessions changed events: % before, % after',
      _events_before, _events_after;
  end if;
end $$;

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
do $$
declare
  _n bigint;
begin
  delete from public.site_settings where key = 'giving_dashboard_tile';
  update public.organizations set branding = branding - 'logo_url' where branding ? 'logo_url';

  select count(*) into _n from public.site_settings where key = 'giving_dashboard_tile';
  if _n <> 0 then
    raise exception '% giving_dashboard_tile row(s) left after the delete', _n;
  end if;
  select count(*) into _n from public.organizations where branding ? 'logo_url';
  if _n <> 0 then
    raise exception '% church(es) still carry a logo_url branding key', _n;
  end if;
end $$;

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
