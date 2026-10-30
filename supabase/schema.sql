


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."org_domain_status" AS ENUM (
    'pending',
    'verified',
    'failed',
    'removing'
);


ALTER TYPE "public"."org_domain_status" OWNER TO "postgres";


CREATE TYPE "public"."org_status" AS ENUM (
    'active',
    'suspended'
);


ALTER TYPE "public"."org_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_current_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select org_id from public.profiles where id = (select auth.uid());
$$;


ALTER FUNCTION "public"."app_current_org_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."app_current_org_id"() IS 'Org of the calling principal, resolved from their own profiles row only. NULL for anon/service callers — fail-closed by construction. Wrap call sites as (select public.app_current_org_id()) so the planner evaluates it once per statement (InitPlan).';



CREATE OR REPLACE FUNCTION "public"."app_request_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.app_current_org_id();
$$;


ALTER FUNCTION "public"."app_request_org_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."app_request_org_id"() IS 'Org of the calling principal (app_current_org_id()). NULL for anonymous and service callers — fail-closed. Kept as the policy-facing name; wrap call sites as (select public.app_request_org_id()).';



CREATE OR REPLACE FUNCTION "public"."current_family_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select family_id from public.profiles
  where id = auth.uid()
    and org_id = public.app_current_org_id();
$$;


ALTER FUNCTION "public"."current_family_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."discoverable_groups"() RETURNS TABLE("id" "uuid", "name" "text", "description" "text", "member_count" integer, "is_private" boolean, "join_policy" "text", "viewer_role" "text", "request_status" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    r.status
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


ALTER FUNCTION "public"."discoverable_groups"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."discoverable_groups"() IS 'The groups a member may see on Find a group and Directory › Groups: their own always; others while the org switch is on and the group is not private; private groups additionally for org admins. Tenant anchor: the caller''s own profiles row (auth.uid(), not pending); no parameter. Returns only the columns the discovery row shows.';



CREATE OR REPLACE FUNCTION "public"."email_quota_consume"("_org_id" "uuid", "_n" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  _cap integer;
  _ok boolean;
begin
  -- A non-positive _n is a caller bug, not a refusable request: raising makes
  -- the bug loud, and it closes the door on a negative _n walking sent_count
  -- backwards (the >= 0 CHECK on the table is the second lock on that door).
  if _org_id is null or _n is null or _n <= 0 then
    raise exception 'email_quota_consume: _n must be a positive batch size';
  end if;

  select l.daily_cap into _cap
  from public.org_email_limits l where l.org_id = _org_id;
  -- 500/day default (a placeholder, not a tuned number).
  -- Revisit this default against the Resend plan's actual ceiling as the
  -- tenant count grows — the per-org override in org_email_limits is the
  -- escape hatch in the meantime.
  _cap := coalesce(_cap, 500);

  -- Bounds the INSERT path: without this, the first reserve of a UTC day is
  -- unguarded (ON CONFLICT ... WHERE only constrains the UPDATE arm) and a
  -- fan-out larger than the cap would sail through on a fresh day.
  if _n > _cap then
    return false;
  end if;

  insert into public.org_email_usage as u (org_id, usage_date, sent_count)
  values (_org_id, (now() at time zone 'utc')::date, _n)
  on conflict (org_id, usage_date) do update
    set sent_count = u.sent_count + excluded.sent_count
    where u.sent_count + excluded.sent_count <= _cap
  returning true into _ok;

  return coalesce(_ok, false);
end;
$$;


ALTER FUNCTION "public"."email_quota_consume"("_org_id" "uuid", "_n" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."email_quota_consume"("_org_id" "uuid", "_n" integer) IS 'Atomic per-org daily email quota reserve. Tenant anchor: service_role-only EXECUTE — _org_id must come from an anchor the server-side caller already validated (its RLS-scoped profile, an RLS-checked group row, listActiveOrgs()), never trusted from a request. Returns false when the reservation would exceed the org''s daily cap (org_email_limits.daily_cap, default 500).';



CREATE OR REPLACE FUNCTION "public"."get_own_email"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select email from public.profiles
  where id = auth.uid()
    and org_id = public.app_current_org_id();
$$;


ALTER FUNCTION "public"."get_own_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_own_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select role from public.profiles
  where id = auth.uid()
    and org_id = public.app_current_org_id();
$$;


ALTER FUNCTION "public"."get_own_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_profile_email"("profile_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select email
  from public.profiles
  where id = profile_id
    and family_id = public.current_family_id()
    and org_id = public.app_current_org_id();
$$;


ALTER FUNCTION "public"."get_profile_email"("profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_profile_role"("profile_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select role
  from public.profiles
  where id = profile_id
    and family_id = public.current_family_id()
    and org_id = public.app_current_org_id();
$$;


ALTER FUNCTION "public"."get_profile_role"("profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."giving_can_manage_fund"("_fund_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.giving_funds f
    where f.id = _fund_id
      and f.org_id = public.app_current_org_id()
      and (
        public.is_group_leader(f.group_id)
        or (public.giving_stewards_can_manage()
            and f.steward_id = auth.uid()
            and public.is_group_member(f.group_id))
      )
  );
$$;


ALTER FUNCTION "public"."giving_can_manage_fund"("_fund_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."giving_stewards_can_manage"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(
    (select value from public.site_settings
      where key = 'giving_manage_mode'
        and org_id = public.app_current_org_id()),
    'stewards'
  ) = 'stewards';
$$;


ALTER FUNCTION "public"."giving_stewards_can_manage"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."group_content_backfill"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
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
    'prayer_responses', 'prayer_call_sessions'];
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
         or exists (select 1 from public.prayer_call_sessions where org_id = _org.id)
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
        when 'prayer_call_sessions' then
          update public.prayer_call_sessions s set group_id = e.group_id
          from public.events e
          where e.id = s.event_id and e.org_id = s.org_id
            and s.org_id = _org.id and s.group_id is null;
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

    -- The org-level call and link-mode settings become the oldest group's.
    insert into public.group_settings (
      org_id, group_id, weekly_zoom_url, zoom_meeting_time,
      weekly_prayer_call_url, weekly_prayer_call_time, serving_link_mode)
    select
      _org.id, _grp,
      nullif(max(value) filter (where key = 'weekly_zoom_url' and value ~ '^https://'), ''),
      nullif(max(value) filter (where key = 'zoom_meeting_time'), ''),
      nullif(max(value) filter (where key = 'weekly_prayer_call_url' and value ~ '^https://'), ''),
      nullif(max(value) filter (where key = 'weekly_prayer_call_time'), ''),
      case max(value) filter (where key = 'serving_link_mode')
           when 'login' then 'login' when 'signed' then 'signed' end
    from public.site_settings
    where org_id = _org.id
      and key in ('weekly_zoom_url', 'zoom_meeting_time', 'weekly_prayer_call_url',
                  'weekly_prayer_call_time', 'serving_link_mode')
    having count(*) > 0
    on conflict (group_id) do nothing;
  end loop;
end;
$_$;


ALTER FUNCTION "public"."group_content_backfill"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."group_content_backfill"() IS 'Gives every ungrouped content row to its org''s oldest group, folds each group''s calendars into one (events re-pointed, extras deleted, counts asserted), creates a calendar for a group without one, and moves the org-level call and link-mode settings onto the oldest group. Idempotent. Callable only by the migration runner and the pgTAP harness.';



CREATE OR REPLACE FUNCTION "public"."group_create"("_name" "text", "_description" "text" DEFAULT NULL::"text", "_leader_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  _actor uuid := auth.uid();
  _org uuid;
  _admin boolean;
  _policy text;
  _leader uuid;
begin
  if _actor is null then
    raise exception 'group creation rejected: no authenticated principal' using errcode = 'GC002';
  end if;
  -- Org and role from the caller's own profile, never a parameter.
  select p.org_id, p.role = 'admin' into _org, _admin
  from public.profiles p where p.id = _actor and p.role <> 'pending';
  if _org is null then
    raise exception 'group creation rejected: actor % is not an approved member', _actor using errcode = 'GC002';
  end if;
  if _name is null or btrim(_name) = '' then
    raise exception 'group creation rejected: name is required' using errcode = 'GC006';
  end if;

  _leader := coalesce(_leader_id, _actor);
  if not _admin then
    if _leader <> _actor then
      raise exception 'group creation rejected: only an org admin may name another leader' using errcode = 'GC005';
    end if;
    select o.group_creation_policy into _policy from public.organizations o where o.id = _org;
    if _policy is distinct from 'open' then
      raise exception 'group creation rejected: org policy is %', coalesce(_policy, 'unknown') using errcode = 'GC001';
    end if;
  end if;

  return public.group_create_for(_org, _name, _description, _leader, _actor);
end;
$$;


ALTER FUNCTION "public"."group_create"("_name" "text", "_description" "text", "_leader_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."group_create"("_name" "text", "_description" "text", "_leader_id" "uuid") IS 'Creates a group with its leader and calendar. Tenant anchor: the caller''s own profiles row (org and role), never a parameter. A non-admin may only lead the group themselves (GC005) and only under the open policy (GC001); an admin may name any approved member of their org (GC003 otherwise). GC002: not an approved member. GC006: blank name.';



CREATE OR REPLACE FUNCTION "public"."group_create_for"("_org" "uuid", "_name" "text", "_description" "text", "_leader" "uuid", "_created_by" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  _group uuid;
begin
  -- The leader must be an approved member of this org; a pending or
  -- foreign profile is refused before any row is written.
  if not exists (
    select 1 from public.profiles p
    where p.id = _leader and p.org_id = _org and p.role <> 'pending'
  ) then
    raise exception 'group creation rejected: leader % is not an approved member of org %', _leader, _org
      using errcode = 'GC003';
  end if;

  insert into public.groups (org_id, name, description, created_by)
  values (_org, btrim(_name), nullif(btrim(coalesce(_description, '')), ''), _created_by)
  returning id into _group;

  insert into public.group_members (org_id, group_id, profile_id, role, added_by)
  values (_org, _group, _leader, 'leader', _created_by);

  -- The group is the calendar: one row, named after the group, Clay.
  insert into public.event_calendars (org_id, group_id, name, color)
  values (_org, _group, btrim(_name), '#B85C38');

  return _group;
end;
$$;


ALTER FUNCTION "public"."group_create_for"("_org" "uuid", "_name" "text", "_description" "text", "_leader" "uuid", "_created_by" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."group_create_for"("_org" "uuid", "_name" "text", "_description" "text", "_leader" "uuid", "_created_by" "uuid") IS 'Writes a group, its leader row and its calendar in one transaction. No client grant: called only by group_create() and group_request_approve(), which resolve _org from the caller''s own profile. Raises GC003 when the leader is not an approved member of _org.';



CREATE OR REPLACE FUNCTION "public"."group_invite_join"("_token" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  _uid uuid := auth.uid();
  _org uuid;
  _email text;
  _inv public.group_invites%rowtype;
  _private boolean;
  _counted boolean;
  _result text;
begin
  if _uid is null then
    raise exception 'invite join rejected: no authenticated principal' using errcode = 'GI006';
  end if;
  -- Org from the caller's own profile; the invite must carry the same one.
  select p.org_id, p.email into _org, _email
  from public.profiles p where p.id = _uid and p.role <> 'pending';
  if _org is null then
    raise exception 'invite join rejected: caller % is not an approved member', _uid using errcode = 'GI006';
  end if;

  select gi.* into _inv from public.group_invites gi where gi.token = _token for update;
  if not found
     or _inv.org_id <> _org
     or _inv.revoked_at is not null
     or (_inv.expires_at is not null and _inv.expires_at <= now()) then
    raise exception 'invite join rejected: link is not valid' using errcode = 'GI001';
  end if;

  if exists (
    select 1 from public.group_members m
    where m.group_id = _inv.group_id and m.profile_id = _uid and m.org_id = _org) then
    return 'already_member';
  end if;

  -- The same person following the link again is one use, not two.
  _counted := exists (
    select 1 from public.group_invite_uses u
    where u.invite_id = _inv.id and u.org_id = _org and u.profile_id = _uid);
  if not _counted and _inv.max_uses is not null and (
       select count(*) from public.group_invite_uses u
       where u.invite_id = _inv.id and u.org_id = _org) >= _inv.max_uses then
    raise exception 'invite join rejected: link is not valid' using errcode = 'GI001';
  end if;

  select g.is_private into _private
  from public.groups g where g.id = _inv.group_id and g.org_id = _org;
  if _private is null then
    raise exception 'invite join rejected: link is not valid' using errcode = 'GI001';
  end if;

  if _private then
    -- A private group has no discoverable join path, so the link is the
    -- approval: the creator vouches, as added_by records.
    insert into public.group_members (org_id, group_id, profile_id, role, added_by)
    values (_org, _inv.group_id, _uid, 'member', _inv.created_by)
    on conflict (group_id, profile_id) do nothing;
    update public.group_join_requests
      set status = 'approved', reviewed_at = now()
      where group_id = _inv.group_id and profile_id = _uid
        and org_id = _org and status = 'pending';
    _result := 'joined';
  else
    _result := public.join_group_apply(_inv.group_id, _uid);
  end if;

  if not _counted then
    insert into public.group_invite_uses (org_id, invite_id, group_id, email, outcome, profile_id)
    values (_org, _inv.id, _inv.group_id, lower(_email), _result, _uid);
  end if;

  return _result;
end;
$$;


ALTER FUNCTION "public"."group_invite_join"("_token" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."group_invite_join"("_token" "uuid") IS 'A signed-in member follows a group invite. Tenant anchor: the caller''s own profiles row (GI006 when none or pending); the invite row, locked for update, must carry that org (GI001 for foreign, missing, revoked, expired or used up). Returns already_member with no use row; joined at once for a private group (added_by = the invite''s creator); otherwise join_group_apply() decides joined or requested. One use row per person per link.';



CREATE OR REPLACE FUNCTION "public"."group_invite_redeem"("_token" "uuid", "_name" "text", "_email" "text", "_signup_token" "text", "_token_expires_at" timestamp with time zone) RETURNS TABLE("org_id" "uuid", "group_id" "uuid", "group_name" "text", "access_request_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  _inv public.group_invites%rowtype;
  _org uuid;
  _group uuid;
  _gname text;
  _name_norm text := btrim(coalesce(_name, ''));
  _email_norm text := lower(btrim(coalesce(_email, '')));
  _request uuid;
  _counted boolean;
begin
  if auth.uid() is not null then
    raise exception 'invite redeem rejected: a signed-in caller takes the member path'
      using errcode = 'GI006';
  end if;
  if _name_norm = ''
     or _email_norm = '' or length(_email_norm) > 254 or position('@' in _email_norm) = 0
     or _signup_token is null or btrim(_signup_token) = ''
     or _token_expires_at is null then
    raise exception 'invite redeem rejected: name, email and a signup token are required'
      using errcode = 'GI002';
  end if;

  -- The token is the only thing that names the org: this lookup is
  -- unscoped and the row it returns anchors every read and write below.
  -- Locked so two first-time submissions on a one-use link serialise.
  select gi.* into _inv from public.group_invites gi where gi.token = _token for update;
  if not found
     or _inv.revoked_at is not null
     or (_inv.expires_at is not null and _inv.expires_at <= now()) then
    raise exception 'invite redeem rejected: link is not valid' using errcode = 'GI001';
  end if;
  _org := _inv.org_id;
  _group := _inv.group_id;
  select g.name into _gname from public.groups g where g.id = _group and g.org_id = _org;
  if _gname is null then
    raise exception 'invite redeem rejected: link is not valid' using errcode = 'GI001';
  end if;

  -- An address that already has an account anywhere cannot sign up again
  -- (auth emails are unique), and one approved or invited into another org
  -- would be ambiguous at signup (TN002): refuse now rather than mail a
  -- link that cannot work. Existence checks only; nothing is returned.
  if exists (select 1 from public.profiles p where lower(p.email) = _email_norm)
     or exists (
       select 1 from public.access_requests ar
       where lower(ar.email) = _email_norm and ar.status = 'approved' and ar.org_id <> _org)
     or exists (
       select 1 from public.family_invites fi
       where lower(fi.invite_email) = _email_norm and fi.accepted_at is null and fi.org_id <> _org) then
    raise exception 'invite redeem rejected: address cannot sign up through this link'
      using errcode = 'GI003';
  end if;

  if exists (
    select 1 from public.access_requests ar
    where ar.org_id = _org and lower(ar.email) = _email_norm and ar.status = 'denied') then
    raise exception 'invite redeem rejected: address was denied by an admin' using errcode = 'GI004';
  end if;

  -- A repeat submission by the same address refreshes the setup link and
  -- counts as the same use, so a lost email never burns a one-use link.
  _counted := exists (
    select 1 from public.group_invite_uses u
    where u.invite_id = _inv.id and u.org_id = _org and u.email = _email_norm);
  if not _counted and _inv.max_uses is not null and (
       select count(*) from public.group_invite_uses u
       where u.invite_id = _inv.id and u.org_id = _org) >= _inv.max_uses then
    raise exception 'invite redeem rejected: link is not valid' using errcode = 'GI001';
  end if;

  select ar.id into _request from public.access_requests ar
  where ar.org_id = _org and lower(ar.email) = _email_norm
  order by ar.created_at desc
  limit 1
  for update;

  if _request is not null then
    -- The latest link wins, including over a request that named another group.
    update public.access_requests ar
      set status = 'approved',
          name = _name_norm,
          reviewed_by = _inv.created_by,
          reviewed_at = now(),
          signup_token = _signup_token,
          token_expires_at = _token_expires_at,
          group_id = _group,
          group_invite_id = _inv.id
      where ar.id = _request and ar.org_id = _org;
  else
    insert into public.access_requests
      (org_id, name, email, status, reviewed_by, reviewed_at, signup_token, token_expires_at,
       group_id, group_invite_id)
    values
      (_org, _name_norm, _email_norm, 'approved', _inv.created_by, now(), _signup_token, _token_expires_at,
       _group, _inv.id)
    returning id into _request;
  end if;

  if not _counted then
    insert into public.group_invite_uses (org_id, invite_id, group_id, email, outcome, access_request_id)
    values (_org, _inv.id, _group, _email_norm, 'signup_sent', _request);
  end if;

  return query select _org, _group, _gname, _request;
end;
$$;


ALTER FUNCTION "public"."group_invite_redeem"("_token" "uuid", "_name" "text", "_email" "text", "_signup_token" "text", "_token_expires_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."group_invite_redeem"("_token" "uuid", "_name" "text", "_email" "text", "_signup_token" "text", "_token_expires_at" timestamp with time zone) IS 'New-person redemption of a group invite. Tenant anchor: the group_invites row the token selects (locked for update), never a parameter; the approved access_requests row and the use row carry its org_id. A repeat submission by the same address re-mints the setup token without a new use. service_role only. GI001 dead link, GI002 bad input, GI003 address cannot sign up, GI004 denied by an admin, GI006 signed-in caller.';



CREATE OR REPLACE FUNCTION "public"."group_member_removed_leaves_teams"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.team_members tm
  using public.teams t
  where t.id = tm.team_id
    and t.org_id = tm.org_id
    and t.group_id = old.group_id
    and tm.org_id = old.org_id
    and tm.profile_id = old.profile_id;
  return old;
end;
$$;


ALTER FUNCTION "public"."group_member_removed_leaves_teams"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."group_model_backfill"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  _org record;
  _group uuid;
  _name text;
  _approved bigint;
  _enrolled bigint;
  _admins bigint;
  _leaders bigint;
  _unassigned bigint;
begin
  -- Approval decisions cannot land between the enrolment and its count.
  lock table public.profiles in share mode;

  for _org in
    select o.id, o.name, o.branding
    from public.organizations o
    order by o.created_at, o.id
  loop
    if not exists (select 1 from public.groups g where g.org_id = _org.id) then
      _name := coalesce(nullif(btrim(_org.branding ->> 'display_name'), ''), _org.name);

      insert into public.groups (org_id, name)
      values (_org.id, _name)
      returning id into _group;

      -- Every approved member, with every org admin as a leader: group
      -- settings move here next and someone has to be able to edit them.
      insert into public.group_members (org_id, group_id, profile_id, role)
      select p.org_id, _group, p.id,
             case when p.role = 'admin' then 'leader' else 'member' end
      from public.profiles p
      where p.org_id = _org.id
        and p.role <> 'pending';

      select count(*) into _approved
      from public.profiles p
      where p.org_id = _org.id and p.role <> 'pending';
      select count(*) into _enrolled
      from public.group_members gm
      where gm.group_id = _group and gm.org_id = _org.id;
      if _enrolled <> _approved then
        raise exception 'group backfill for org %: enrolled % of % approved members',
          _org.id, _enrolled, _approved;
      end if;

      select count(*) into _admins
      from public.profiles p
      where p.org_id = _org.id and p.role = 'admin';
      select count(*) into _leaders
      from public.group_members gm
      where gm.group_id = _group and gm.org_id = _org.id and gm.role = 'leader';
      if _leaders <> _admins then
        raise exception 'group backfill for org %: % leaders for % admins',
          _org.id, _leaders, _admins;
      end if;
    end if;

    -- Teams without a group attach to the org's group when there is exactly
    -- one; with several there is no right answer and the assertion below
    -- refuses rather than guesses.
    if (select count(*) from public.groups g where g.org_id = _org.id) = 1 then
      update public.teams t
      set group_id = (select g.id from public.groups g where g.org_id = _org.id)
      where t.org_id = _org.id
        and t.group_id is null;
    end if;
  end loop;

  select count(*) into _unassigned from public.teams t where t.group_id is null;
  if _unassigned > 0 then
    raise exception 'group backfill: % team(s) still have no group', _unassigned;
  end if;
end;
$$;


ALTER FUNCTION "public"."group_model_backfill"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."group_model_backfill"() IS 'Gives every org without a group exactly one, named from branding.display_name (fallback: the org name), enrols every approved member, makes every org admin a leader, and attaches unassigned teams. Idempotent. Callable only by the migration runner and the pgTAP harness.';



CREATE OR REPLACE FUNCTION "public"."group_request_approve"("_request_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  _actor uuid := auth.uid();
  _org uuid;
  _req public.group_requests%rowtype;
  _group uuid;
begin
  if _actor is null then
    raise exception 'group approval rejected: no authenticated principal' using errcode = 'GC002';
  end if;
  select p.org_id into _org from public.profiles p where p.id = _actor and p.role = 'admin';
  if _org is null then
    raise exception 'group approval rejected: actor % is not an org admin', _actor using errcode = 'GC005';
  end if;

  -- The request must be in the admin's own org; a foreign or missing id is
  -- the same error so the response confirms nothing.
  select r.* into _req from public.group_requests r
  where r.id = _request_id and r.org_id = _org and r.status = 'pending'
  for update;
  if not found then
    raise exception 'group approval rejected: no pending request %', _request_id using errcode = 'GC004';
  end if;

  _group := public.group_create_for(_org, _req.name, _req.description, _req.requested_by, _req.requested_by);

  update public.group_requests
  set status = 'approved', group_id = _group, reviewed_by = _actor, reviewed_at = now()
  where id = _req.id and org_id = _org;

  return _group;
end;
$$;


ALTER FUNCTION "public"."group_request_approve"("_request_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."group_request_approve"("_request_id" "uuid") IS 'Turns a pending group request into a group led by its requester. Tenant anchor: the caller''s own profiles row, which must be an org admin (GC005); the request is looked up by id AND that org (GC004 for missing or foreign). GC003 when the requester is no longer an approved member.';



CREATE OR REPLACE FUNCTION "public"."handle_auth_user_email_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_auth_user_email_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

  insert into public.organization_members (org_id, profile_id)
  values (_org_id, new.id)
  on conflict do nothing;

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


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
      and org_id = public.app_current_org_id()
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_group_leader"("_group_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.group_members gm
    where gm.profile_id = auth.uid()
      and gm.group_id = _group_id
      and gm.role = 'leader'
      and gm.org_id = public.app_current_org_id()
  );
$$;


ALTER FUNCTION "public"."is_group_leader"("_group_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_group_leader"("_group_id" "uuid") IS 'True when the caller (auth.uid()) is a leader of the given group in their own org. Caller resolved from auth.uid() only.';



CREATE OR REPLACE FUNCTION "public"."is_group_member"("_group_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.group_members gm
    where gm.profile_id = auth.uid()
      and gm.group_id = _group_id
      and gm.org_id = public.app_current_org_id()
  );
$$;


ALTER FUNCTION "public"."is_group_member"("_group_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_group_member"("_group_id" "uuid") IS 'True when the caller (auth.uid()) is a member of the given group in their own org. Caller resolved from auth.uid() only.';



CREATE OR REPLACE FUNCTION "public"."is_household_manager"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and relationship in ('primary', 'spouse')
      and role in ('member', 'admin')
      and org_id = public.app_current_org_id()
  );
$$;


ALTER FUNCTION "public"."is_household_manager"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('member', 'admin')
      and org_id = public.app_current_org_id()
  );
$$;


ALTER FUNCTION "public"."is_member"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_member"("_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.organization_members
    where org_id = _org_id and profile_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_org_member"("_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_platform_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (select 1 from public.platform_admins where profile_id = (select auth.uid()));
$$;


ALTER FUNCTION "public"."is_platform_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_team_lead"("_team_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.team_members tm
    where tm.profile_id = auth.uid()
      and tm.team_id = _team_id
      and tm.is_leader = true
      and tm.org_id = public.app_current_org_id()
  );
$$;


ALTER FUNCTION "public"."is_team_lead"("_team_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_team_lead"("_team_id" "uuid") IS 'True when the caller (auth.uid()) is a lead of the given team in their own org. Formerly is_group_leader.';



CREATE OR REPLACE FUNCTION "public"."join_group"("_group_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  _actor uuid := auth.uid();
  _org uuid;
  _private boolean;
  _discovery boolean;
begin
  if _actor is null then
    raise exception 'join rejected: no authenticated principal' using errcode = 'GJ002';
  end if;
  select p.org_id into _org from public.profiles p where p.id = _actor and p.role <> 'pending';
  if _org is null then
    raise exception 'join rejected: actor % is not an approved member', _actor using errcode = 'GJ002';
  end if;

  select g.is_private into _private from public.groups g where g.id = _group_id and g.org_id = _org;
  if _private is null then
    raise exception 'join rejected: group % is not open to join', _group_id using errcode = 'GJ001';
  end if;
  select o.group_discovery into _discovery from public.organizations o where o.id = _org;
  if not coalesce(_discovery, false) or _private then
    raise exception 'join rejected: group % is not open to join', _group_id using errcode = 'GJ001';
  end if;

  return public.join_group_apply(_group_id, _actor);
end;
$$;


ALTER FUNCTION "public"."join_group"("_group_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."join_group"("_group_id" "uuid") IS 'Joins or requests to join a group a member found. Tenant anchor: the caller''s own profiles row (GJ002 when none or pending); the group is looked up by id AND that org, the org switch must be on and the group not private (GJ001 for all four, so a hidden group reads like a missing id). Then join_group_apply().';



CREATE OR REPLACE FUNCTION "public"."join_group_apply"("_group_id" "uuid", "_actor_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  _org uuid;
  _policy text;
begin
  select g.org_id, g.join_policy into _org, _policy
  from public.groups g where g.id = _group_id;
  if _org is null then
    raise exception 'join rejected: group % is not open to join', _group_id using errcode = 'GJ001';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = _actor_id and p.org_id = _org and p.role <> 'pending'
  ) then
    raise exception 'join rejected: actor % is not an approved member of org %', _actor_id, _org
      using errcode = 'GJ002';
  end if;

  if exists (
    select 1 from public.group_members m
    where m.group_id = _group_id and m.profile_id = _actor_id and m.org_id = _org
  ) then
    raise exception 'join rejected: actor % is already a member of group %', _actor_id, _group_id
      using errcode = 'GJ003';
  end if;

  if _policy = 'open' then
    insert into public.group_members (org_id, group_id, profile_id, role, added_by)
    values (_org, _group_id, _actor_id, 'member', _actor_id)
    on conflict (group_id, profile_id) do nothing;
    -- A request filed under an earlier approval policy is moot once its
    -- author has joined; reviewed_by stays null to say nobody reviewed it.
    update public.group_join_requests
      set status = 'approved', reviewed_at = now()
      where group_id = _group_id and profile_id = _actor_id
        and org_id = _org and status = 'pending';
    return 'joined';
  end if;

  insert into public.group_join_requests (org_id, group_id, profile_id)
  values (_org, _group_id, _actor_id)
  on conflict (group_id, profile_id) where status = 'pending' do nothing;
  return 'requested';
end;
$$;


ALTER FUNCTION "public"."join_group_apply"("_group_id" "uuid", "_actor_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."join_group_apply"("_group_id" "uuid", "_actor_id" "uuid") IS 'The join_policy branch: open enrols _actor_id and returns joined; approval files a pending group_join_requests row and returns requested. No discovery or privacy gate and no client grant: reached only through join_group() today, and through an invite-link wrapper later. Org from the groups row; _actor_id must be an approved member of it (GJ002). GJ001 unknown group, GJ003 already a member.';



CREATE OR REPLACE FUNCTION "public"."org_directory_visible"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.organizations o
    where o.id = public.app_current_org_id()
      and o.directory_visibility = 'org'
  );
$$;


ALTER FUNCTION "public"."org_directory_visible"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."org_directory_visible"() IS 'True when the caller''s own org has directory_visibility = org. Zero-argument so policies hoist it as an InitPlan.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."org_email_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "domain" "text" NOT NULL,
    "resend_domain_id" "text",
    "status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "dns_records" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "verified_at" timestamp with time zone,
    "last_checked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cleanup_failed_at" timestamp with time zone,
    CONSTRAINT "org_email_domains_domain_shape" CHECK ((("domain" = "lower"("domain")) AND (("length"("domain") >= 4) AND ("length"("domain") <= 253)))),
    CONSTRAINT "org_email_domains_status_check" CHECK (("status" = ANY (ARRAY['not_started'::"text", 'pending'::"text", 'verified'::"text", 'failure'::"text", 'temporary_failure'::"text", 'failed'::"text", 'partially_verified'::"text", 'partially_failed'::"text", 'cleanup_pending'::"text"])))
);


ALTER TABLE "public"."org_email_domains" OWNER TO "postgres";


COMMENT ON COLUMN "public"."org_email_domains"."cleanup_failed_at" IS 'Set when a Resend domains.remove attempt failed and the row was kept as cleanup_pending. Cleared by deleting the row once cleanup succeeds.';



CREATE OR REPLACE FUNCTION "public"."org_email_domain_claim"("_org_id" "uuid", "_domain" "text", "_cap" integer) RETURNS "public"."org_email_domains"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  _enabled boolean;
  _claimed integer;
  _row public.org_email_domains;
begin
  if _org_id is null or _domain is null or _cap is null or _cap < 0 then
    raise exception 'org_email_domain_claim: _org_id, _domain and a non-negative _cap are required';
  end if;

  -- One claim at a time, platform-wide. Transaction-scoped so it releases
  -- on commit or rollback; the key is arbitrary but stable.
  perform pg_advisory_xact_lock(hashtext('public.org_email_domains:claim'));

  select o.custom_email_domain_enabled into _enabled
  from public.organizations o where o.id = _org_id;
  if _enabled is null then
    raise exception 'org_email_domain_claim: unknown organization'
      using errcode = 'SD001';
  end if;
  if not _enabled then
    raise exception 'org_email_domain_claim: custom sending domains are not enabled for this organization'
      using errcode = 'SD002';
  end if;

  -- Rows still awaiting provider-side cleanup count too: their Resend
  -- domain still occupies a slot.
  select count(*) into _claimed from public.org_email_domains;
  if _claimed >= _cap then
    raise exception 'org_email_domain_claim: platform domain cap reached'
      using errcode = 'SD003';
  end if;

  -- A duplicate claim for the same org raises unique_violation (23505) from
  -- the unique-per-org index, exactly as a direct insert would.
  insert into public.org_email_domains (org_id, domain)
  values (_org_id, _domain)
  returning * into _row;

  return _row;
end;
$$;


ALTER FUNCTION "public"."org_email_domain_claim"("_org_id" "uuid", "_domain" "text", "_cap" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."org_email_domain_claim"("_org_id" "uuid", "_domain" "text", "_cap" integer) IS 'Atomic claim of an org''s custom sending domain under a platform-wide cap. Tenant anchor: service_role-only EXECUTE — _org_id must come from an anchor the server-side caller already validated (the admin''s RLS-scoped profile), never from a request. Raises SD001 (unknown org), SD002 (custom domains not enabled), SD003 (cap reached), or 23505 (org already holds a row).';



CREATE OR REPLACE FUNCTION "public"."org_group_creation_policy"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select o.group_creation_policy from public.organizations o
  where o.id = public.app_current_org_id();
$$;


ALTER FUNCTION "public"."org_group_creation_policy"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."org_group_creation_policy"() IS 'The caller''s own org''s group_creation_policy; NULL when the caller has no org. Zero-argument so policies hoist it as an InitPlan.';



CREATE OR REPLACE FUNCTION "public"."organizations_timezone_check"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = new.timezone
      and name not like 'posix/%'
      and name not in ('Factory', 'localtime', 'posixrules')
  ) then
    raise exception 'organizations.timezone: unknown time zone "%"', new.timezone
      using errcode = 'check_violation';
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."organizations_timezone_check"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."organizations_timezone_check"() IS 'Trigger function: refuses an organizations.timezone that is not an exact IANA name in pg_timezone_names (no posix/ duplicates; no Factory, localtime or posixrules, which Postgres lists but Intl does not know). SECURITY INVOKER; raises check_violation.';



CREATE OR REPLACE FUNCTION "public"."pending_group_join_requests"("_group_id" "uuid") RETURNS TABLE("id" "uuid", "created_at" timestamp with time zone, "first_name" "text", "last_name" "text", "preferred_name" "text", "email" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select r.id, r.created_at, p.first_name, p.last_name, p.preferred_name,
    case when p.hide_email then null else p.email end
  from public.profiles me
  join public.group_join_requests r on r.org_id = me.org_id
  join public.profiles p on p.id = r.profile_id and p.org_id = r.org_id
  where me.id = auth.uid() and me.role <> 'pending'
    and r.group_id = _group_id
    and r.status = 'pending'
    and (public.is_admin() or public.is_group_leader(_group_id))
  order by r.created_at;
$$;


ALTER FUNCTION "public"."pending_group_join_requests"("_group_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."pending_group_join_requests"("_group_id" "uuid") IS 'Pending requests for a group with each requester''s name and email (NULL when hide_email), for the leader''s review list. Tenant anchor: the caller''s own profiles row; rows only when the caller leads the group or is an org admin, else empty.';



CREATE OR REPLACE FUNCTION "public"."provision_organization"("_name" "text", "_owner_email" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."provision_organization"("_name" "text", "_owner_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."provision_organization"("_name" "text", "_owner_email" "text") IS 'Builds a complete org in one transaction: the organizations row, the two org-level giving settings and the approved owner access request (approved_role = admin). TN004 when the owner email already has a profile, TN005 when it is approved or invited in another org. service_role only.';



CREATE OR REPLACE FUNCTION "public"."review_group_join_request"("_request_id" "uuid", "_approve" boolean) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  _actor uuid := auth.uid();
  _org uuid;
  _req public.group_join_requests%rowtype;
  _next text;
  _n integer;
begin
  if _approve is null then
    raise exception 'review rejected: approve flag is required' using errcode = '22004';
  end if;
  if _actor is null then
    raise exception 'review rejected: no authenticated principal' using errcode = 'GJ002';
  end if;
  select p.org_id into _org from public.profiles p where p.id = _actor and p.role <> 'pending';
  if _org is null then
    raise exception 'review rejected: actor % is not an approved member', _actor using errcode = 'GJ002';
  end if;

  select r.* into _req from public.group_join_requests r
  where r.id = _request_id and r.org_id = _org and r.status = 'pending'
  for update;
  if not found or not (public.is_admin() or public.is_group_leader(_req.group_id)) then
    raise exception 'review rejected: no pending join request %', _request_id using errcode = 'GJ004';
  end if;

  if _approve then
    if not exists (
      select 1 from public.profiles p
      where p.id = _req.profile_id and p.org_id = _org and p.role <> 'pending'
    ) then
      raise exception 'review rejected: requester % is not an approved member of org %', _req.profile_id, _org
        using errcode = 'GJ002';
    end if;
    insert into public.group_members (org_id, group_id, profile_id, role, added_by)
    values (_org, _req.group_id, _req.profile_id, 'member', _actor)
    on conflict (group_id, profile_id) do nothing;
  end if;

  _next := case when _approve then 'approved' else 'declined' end;
  update public.group_join_requests
    set status = _next, reviewed_by = _actor, reviewed_at = now()
    where id = _req.id and org_id = _org;
  get diagnostics _n = row_count;
  if _n <> 1 then
    raise exception 'review rejected: join request % was not stamped', _req.id using errcode = 'GJ004';
  end if;
  return _next;
end;
$$;


ALTER FUNCTION "public"."review_group_join_request"("_request_id" "uuid", "_approve" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."review_group_join_request"("_request_id" "uuid", "_approve" boolean) IS 'Approves (writes the group_members row) or declines a pending join request in one transaction. Tenant anchor: the caller''s own profiles row; the request is selected by id AND that org with for update, and the caller must lead its group or be an org admin (GJ004 for missing, foreign, decided or not permitted). GJ002 when the requester is no longer an approved member. 22004 when _approve is NULL, so a missing flag never reads as a decline.';



CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."serving_signup_apply"("_group_id" "uuid", "_service_date" "date", "_actor_id" "uuid", "_attendee_ids" "uuid"[]) RETURNS TABLE("signup_id" "uuid", "signup_org_id" "uuid", "created" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  _org uuid;
  _actor_org uuid;
  _family_id uuid;
  _attendee_total bigint;
  _attendee_valid bigint;
  _enabled boolean;
  _signup_id uuid;
  _existing_by uuid;
  _created boolean;
begin
  -- The org comes from the team row, never from the caller. A cross-org
  -- _group_id resolves to a real org here, and the actor's own profile then
  -- fails the equality check below — there is no caller-supplied org to
  -- subvert.
  select t.org_id into _org
  from public.teams t
  where t.id = _group_id;

  if _org is null then
    raise exception 'serving signup rejected: unknown group %', _group_id
      using errcode = 'SV002';
  end if;

  select p.org_id, p.family_id into _actor_org, _family_id
  from public.profiles p
  where p.id = _actor_id;

  if _actor_org is distinct from _org then
    raise exception 'serving signup rejected: actor % does not carry group org', _actor_id
      using errcode = 'SV002';
  end if;

  if _attendee_ids is null
     or coalesce(array_length(_attendee_ids, 1), 0) = 0
     or not (_actor_id = any (_attendee_ids)) then
    raise exception 'serving signup rejected: attendees must be non-empty and include actor %', _actor_id
      using errcode = 'SV002';
  end if;

  -- Household rule, enforced here as well as in the routes: every attendee
  -- is the actor, or shares the actor's non-null household with relationship
  -- primary/spouse — and carries the team's org_id. count(*) over the
  -- DISTINCT subquery (not count(distinct ...)) so a NULL element still
  -- counts on the total side and fails the comparison.
  select count(*) into _attendee_total
  from (select distinct att.pid from unnest(_attendee_ids) as att(pid)) ids;

  select count(*) into _attendee_valid
  from (select distinct att.pid from unnest(_attendee_ids) as att(pid)) ids
  join public.profiles p on p.id = ids.pid
  where p.org_id = _org
    and (
      p.id = _actor_id
      or (
        _family_id is not null
        and p.family_id = _family_id
        and p.relationship in ('primary', 'spouse')
      )
    );

  if _attendee_valid <> _attendee_total then
    raise exception 'serving signup rejected: attendee outside actor %''s org or household', _actor_id
      using errcode = 'SV002';
  end if;

  select sts.enabled into _enabled
  from public.serving_team_settings sts
  where sts.team_id = _group_id
    and sts.org_id = _org;

  if not coalesce(_enabled, false) then
    raise exception 'serving signups not enabled for group %', _group_id
      using errcode = 'SV003';
  end if;

  -- unique (team_id, service_date) is the race guard. DO NOTHING (not
  -- DO UPDATE) so "who already holds this Sunday" is an explicit branch:
  -- the same member re-signing is an idempotent no-op (created = false), a
  -- different member gets SV001. FOR UPDATE serialises two concurrent
  -- re-signups on the existing row.
  insert into public.serving_signups (org_id, team_id, service_date, family_id, created_by)
  values (_org, _group_id, _service_date, _family_id, _actor_id)
  on conflict (team_id, service_date) do nothing
  returning id into _signup_id;

  if _signup_id is null then
    select s.id, s.created_by into _signup_id, _existing_by
    from public.serving_signups s
    where s.team_id = _group_id
      and s.service_date = _service_date
      and s.org_id = _org
    for update;

    if _existing_by is distinct from _actor_id then
      raise exception 'serving slot already taken for group % on %', _group_id, _service_date
        using errcode = 'SV001';
    end if;
    _created := false;
  else
    _created := true;
  end if;

  -- Additive on re-signup; the (signup_id, profile_id) PK plus DO NOTHING
  -- makes "no duplicate attendee row" structural rather than a race the app
  -- has to avoid. The conflict target is named by constraint: a column list
  -- here would be ambiguous against the signup_id OUT parameter.
  insert into public.serving_signup_attendees (org_id, signup_id, profile_id)
  select _org, _signup_id, ids.pid
  from (select distinct att.pid from unnest(_attendee_ids) as att(pid)) ids
  on conflict on constraint serving_signup_attendees_pkey do nothing;

  return query select _signup_id, _org, _created;
end;
$$;


ALTER FUNCTION "public"."serving_signup_apply"("_group_id" "uuid", "_service_date" "date", "_actor_id" "uuid", "_attendee_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."serving_signup_apply"("_group_id" "uuid", "_service_date" "date", "_actor_id" "uuid", "_attendee_ids" "uuid"[]) IS 'Atomic serving signup + attendee insert pair. Tenant anchor: org_id resolved from the teams row named by _group_id (a team id), never a caller parameter; every other row is asserted to carry it. service_role only — the HMAC signed-link route passes its validated profile id as _actor_id.';



CREATE OR REPLACE FUNCTION "public"."serving_signup_create"("_group_id" "uuid", "_service_date" "date", "_attendee_ids" "uuid"[]) RETURNS TABLE("signup_id" "uuid", "signup_org_id" "uuid", "created" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  _actor uuid;
  _org uuid;
  _grp uuid;
begin
  _actor := auth.uid();
  if _actor is null then
    raise exception 'serving signup rejected: no authenticated principal'
      using errcode = 'SV002';
  end if;

  select t.org_id, t.group_id into _org, _grp
  from public.teams t
  where t.id = _group_id;

  if _org is null or _org is distinct from public.app_request_org_id() then
    raise exception 'serving signup rejected: group % does not resolve to the request org', _group_id
      using errcode = 'SV002';
  end if;

  -- The RLS INSERT policy's arms, re-implemented because SECURITY DEFINER
  -- bypasses the policy. Bare helper calls are correct here — the
  -- (select ...) InitPlan rule applies to policy expressions only.
  if not (
    public.is_team_lead(_group_id)
    or public.is_group_leader(_grp)
    or exists (
      select 1 from public.team_members tm
      where tm.profile_id = _actor
        and tm.team_id = _group_id
        and tm.org_id = _org
    )
  ) then
    raise exception 'serving signup rejected: actor % is not on team %', _actor, _group_id
      using errcode = 'SV004';
  end if;

  return query
  select * from public.serving_signup_apply(_group_id, _service_date, _actor, _attendee_ids);
end;
$$;


ALTER FUNCTION "public"."serving_signup_create"("_group_id" "uuid", "_service_date" "date", "_attendee_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."serving_signup_create"("_group_id" "uuid", "_service_date" "date", "_attendee_ids" "uuid"[]) IS 'Authenticated serving signup entry point. Actor from auth.uid(); tenant anchor: the team''s org pinned against app_request_org_id(), fail-closed on NULL; the RLS INSERT-policy arms (team member, team lead, or a leader of the team''s group) are re-checked before delegating to serving_signup_apply().';



CREATE OR REPLACE FUNCTION "public"."shares_group_with"("_profile_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs
      on theirs.group_id = mine.group_id
     and theirs.org_id = mine.org_id
    where mine.profile_id = auth.uid()
      and theirs.profile_id = _profile_id
      and mine.org_id = public.app_current_org_id()
  );
$$;


ALTER FUNCTION "public"."shares_group_with"("_profile_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."shares_group_with"("_profile_id" "uuid") IS 'True when the caller (auth.uid()) and the given profile are both members of at least one group in the caller''s own org. Caller resolved from auth.uid() only.';



CREATE OR REPLACE FUNCTION "public"."shares_group_with_household"("_family_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.profiles p
    join public.group_members theirs
      on theirs.profile_id = p.id
     and theirs.org_id = p.org_id
    join public.group_members mine
      on mine.group_id = theirs.group_id
     and mine.org_id = theirs.org_id
    where p.family_id = _family_id
      and p.org_id = public.app_current_org_id()
      and mine.profile_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."shares_group_with_household"("_family_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."shares_group_with_household"("_family_id" "uuid") IS 'True when the caller (auth.uid()) shares a group with any profile in the given household, in the caller''s own org. Caller resolved from auth.uid() only.';



CREATE OR REPLACE FUNCTION "public"."team_member_requires_group_membership"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  _group uuid;
begin
  -- A missing team is the FK's to refuse; a team with no group predates the
  -- group model and has nothing to check against.
  select t.group_id into _group
  from public.teams t
  where t.id = new.team_id and t.org_id = new.org_id;
  if _group is null then
    return new;
  end if;
  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = _group
      and gm.org_id = new.org_id
      and gm.profile_id = new.profile_id
  ) then
    raise exception 'team_members: profile % is not a member of the group that owns team %',
      new.profile_id, new.team_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."team_member_requires_group_membership"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."team_moved_prunes_members"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.team_members tm
  where tm.team_id = new.id
    and tm.org_id = new.org_id
    and not exists (
      select 1 from public.group_members gm
      where gm.group_id = new.group_id
        and gm.org_id = new.org_id
        and gm.profile_id = tm.profile_id);
  return new;
end;
$$;


ALTER FUNCTION "public"."team_moved_prunes_members"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."about_page" (
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL
);


ALTER TABLE "public"."about_page" OWNER TO "postgres";


COMMENT ON TABLE "public"."about_page" IS 'One row per group holding the About page body (BlockNote JSON). Keyed by group_id; created on first save.';



CREATE TABLE IF NOT EXISTS "public"."access_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "message" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "signup_token" "text",
    "token_expires_at" timestamp with time zone,
    "invite_token" "uuid",
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "approved_role" "text",
    "group_id" "uuid",
    "group_invite_id" "uuid",
    CONSTRAINT "access_requests_approved_role_check" CHECK ((("approved_role" IS NULL) OR ("approved_role" = ANY (ARRAY['member'::"text", 'admin'::"text"])))),
    CONSTRAINT "access_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'denied'::"text"])))
);


ALTER TABLE "public"."access_requests" OWNER TO "postgres";


COMMENT ON COLUMN "public"."access_requests"."approved_role" IS 'Role handle_new_user() grants when this approved request resolves a signup. NULL means the pre-Phase-4 behavior (member). Set to admin only by provision_organization() for the founding owner, or by an org admin within their own org.';



COMMENT ON COLUMN "public"."access_requests"."group_id" IS 'The group an invite link admits this person into. handle_new_user() enrols them there instead of falling back to the one-group rule.';



CREATE TABLE IF NOT EXISTS "public"."announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "is_published" boolean DEFAULT false NOT NULL,
    "author_id" "uuid",
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL
);


ALTER TABLE "public"."announcements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_subscription_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL
);


ALTER TABLE "public"."calendar_subscription_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_teachers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "title" "text" DEFAULT 'Teacher'::"text" NOT NULL,
    "bio" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL
);


ALTER TABLE "public"."class_teachers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_calendars" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#B85C38'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    CONSTRAINT "event_calendars_color_hex" CHECK ((("color" IS NULL) OR ("color" ~ '^#[0-9a-fA-F]{6}$'::"text")))
);


ALTER TABLE "public"."event_calendars" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "location" "text",
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "calendar_id" "uuid",
    "is_rsvp_enabled" boolean DEFAULT true NOT NULL,
    "recurrence_frequency" "text",
    "recurrence_interval" integer DEFAULT 1 NOT NULL,
    "recurrence_end_mode" "text",
    "recurrence_count" integer,
    "recurrence_until" timestamp with time zone,
    "series_id" "uuid",
    "series_occurrence_date" timestamp with time zone,
    "meeting_url" "text",
    "meeting_id" "text",
    "meeting_passcode" "text",
    "meeting_show_on_dashboard" boolean DEFAULT true NOT NULL,
    "meeting_lead_minutes" integer DEFAULT 15 NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "is_cancelled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "events_is_cancelled_exception_only" CHECK (((NOT "is_cancelled") OR (("series_id" IS NOT NULL) AND ("series_occurrence_date" IS NOT NULL)))),
    CONSTRAINT "events_meeting_lead_minutes_check" CHECK ((("meeting_lead_minutes" >= 0) AND ("meeting_lead_minutes" <= 1440))),
    CONSTRAINT "events_recurrence_end_mode_check" CHECK (("recurrence_end_mode" = ANY (ARRAY['never'::"text", 'count'::"text", 'until'::"text"]))),
    CONSTRAINT "events_recurrence_frequency_check" CHECK (("recurrence_frequency" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'monthly'::"text", 'yearly'::"text"])))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."family_units" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "family_name" "text" NOT NULL,
    "address_line1" "text",
    "address_line2" "text",
    "city" "text",
    "state" "text",
    "postal_code" "text",
    "phone_home" "text",
    "hide_address" boolean DEFAULT false NOT NULL,
    "hide_phone_home" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "anniversary" "date",
    "photo_url" "text",
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL
);


ALTER TABLE "public"."family_units" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."families_directory" WITH ("security_invoker"='true') AS
 SELECT "id",
    "family_name",
    "photo_url",
        CASE
            WHEN "hide_address" THEN NULL::"text"
            ELSE "address_line1"
        END AS "address_line1",
        CASE
            WHEN "hide_address" THEN NULL::"text"
            ELSE "address_line2"
        END AS "address_line2",
        CASE
            WHEN "hide_address" THEN NULL::"text"
            ELSE "city"
        END AS "city",
        CASE
            WHEN "hide_address" THEN NULL::"text"
            ELSE "state"
        END AS "state",
        CASE
            WHEN "hide_address" THEN NULL::"text"
            ELSE "postal_code"
        END AS "postal_code",
        CASE
            WHEN "hide_phone_home" THEN NULL::"text"
            ELSE "phone_home"
        END AS "phone_home",
    "anniversary",
    "created_at",
    "updated_at",
    "org_id"
   FROM "public"."family_units" "f"
  WHERE ("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"));


ALTER VIEW "public"."families_directory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."family_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "family_id" "uuid" NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text",
    "preferred_name" "text",
    "birth_month" smallint,
    "birth_day" smallint,
    "birth_year" smallint,
    "relationship" "text" NOT NULL,
    "avatar_url" "text",
    "is_class_member" boolean DEFAULT false NOT NULL,
    "claimed_profile_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    CONSTRAINT "family_members_birth_day_check" CHECK ((("birth_day" >= 1) AND ("birth_day" <= 31))),
    CONSTRAINT "family_members_birth_month_check" CHECK ((("birth_month" >= 1) AND ("birth_month" <= 12))),
    CONSTRAINT "family_members_birth_year_check" CHECK ((("birth_year" >= 1900) AND ("birth_year" <= 2100))),
    CONSTRAINT "family_members_relationship_check" CHECK (("relationship" = ANY (ARRAY['primary'::"text", 'spouse'::"text", 'child'::"text", 'parent'::"text", 'sibling'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."family_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'pending'::"text" NOT NULL,
    "phone" "text",
    "bio" "text",
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "preferred_name" "text",
    "avatar_url" "text",
    "email" "text",
    "phone_mobile" "text",
    "phone_home" "text",
    "phone_work" "text",
    "address_line1" "text",
    "address_line2" "text",
    "city" "text",
    "state" "text",
    "postal_code" "text",
    "birth_month" smallint,
    "birth_day" smallint,
    "birth_year" smallint,
    "anniversary" "date",
    "occupation" "text",
    "employer" "text",
    "family_id" "uuid",
    "is_unlisted" boolean DEFAULT false NOT NULL,
    "hide_phone_mobile" boolean DEFAULT false NOT NULL,
    "hide_phone_home" boolean DEFAULT false NOT NULL,
    "hide_phone_work" boolean DEFAULT false NOT NULL,
    "hide_email" boolean DEFAULT false NOT NULL,
    "hide_address" boolean DEFAULT false NOT NULL,
    "hide_birthday" boolean DEFAULT false NOT NULL,
    "hide_anniversary" boolean DEFAULT false NOT NULL,
    "hide_occupation" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "relationship" "text" DEFAULT 'primary'::"text" NOT NULL,
    "hide_birth_year" boolean DEFAULT false NOT NULL,
    "setup_completed" boolean DEFAULT false NOT NULL,
    "email_announcements" boolean DEFAULT true NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    CONSTRAINT "profiles_birth_day_check" CHECK ((("birth_day" >= 1) AND ("birth_day" <= 31))),
    CONSTRAINT "profiles_birth_month_check" CHECK ((("birth_month" >= 1) AND ("birth_month" <= 12))),
    CONSTRAINT "profiles_birth_year_check" CHECK ((("birth_year" >= 1900) AND ("birth_year" <= 2100))),
    CONSTRAINT "profiles_relationship_check" CHECK (("relationship" = ANY (ARRAY['primary'::"text", 'spouse'::"text", 'child'::"text", 'parent'::"text", 'sibling'::"text", 'other'::"text"]))),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['pending'::"text", 'member'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."families_directory_full" WITH ("security_invoker"='true') AS
 SELECT "id",
    "family_name",
    "photo_url",
        CASE
            WHEN "hide_address" THEN NULL::"text"
            ELSE "address_line1"
        END AS "address_line1",
        CASE
            WHEN "hide_address" THEN NULL::"text"
            ELSE "address_line2"
        END AS "address_line2",
        CASE
            WHEN "hide_address" THEN NULL::"text"
            ELSE "city"
        END AS "city",
        CASE
            WHEN "hide_address" THEN NULL::"text"
            ELSE "state"
        END AS "state",
        CASE
            WHEN "hide_address" THEN NULL::"text"
            ELSE "postal_code"
        END AS "postal_code",
        CASE
            WHEN "hide_phone_home" THEN NULL::"text"
            ELSE "phone_home"
        END AS "phone_home",
    "anniversary",
    "created_at",
    "updated_at",
    COALESCE(( SELECT "jsonb_agg"("jsonb_build_object"('id', "p"."id", 'first_name', "p"."first_name", 'last_name', "p"."last_name", 'preferred_name', "p"."preferred_name", 'avatar_url', "p"."avatar_url", 'relationship', "p"."relationship", 'is_class_member', true, 'phone_mobile',
                CASE
                    WHEN "p"."hide_phone_mobile" THEN NULL::"text"
                    ELSE "p"."phone_mobile"
                END, 'birth_month',
                CASE
                    WHEN "p"."hide_birthday" THEN NULL::smallint
                    ELSE "p"."birth_month"
                END, 'birth_day',
                CASE
                    WHEN "p"."hide_birthday" THEN NULL::smallint
                    ELSE "p"."birth_day"
                END, 'birth_year',
                CASE
                    WHEN ("p"."hide_birthday" OR "p"."hide_birth_year") THEN NULL::smallint
                    ELSE "p"."birth_year"
                END) ORDER BY "p"."relationship") AS "jsonb_agg"
           FROM "public"."profiles" "p"
          WHERE (("p"."family_id" = "f"."id") AND ("p"."org_id" = "f"."org_id") AND ("p"."is_unlisted" = false) AND ("p"."role" = ANY (ARRAY['member'::"text", 'admin'::"text"])))), '[]'::"jsonb") AS "members",
    COALESCE(( SELECT "jsonb_agg"("jsonb_build_object"('id', "fm"."id", 'first_name', "fm"."first_name", 'last_name', "fm"."last_name", 'preferred_name', "fm"."preferred_name", 'avatar_url', "fm"."avatar_url", 'relationship', "fm"."relationship", 'is_class_member', "fm"."is_class_member", 'birth_month', "fm"."birth_month", 'birth_day', "fm"."birth_day", 'birth_year', "fm"."birth_year", 'claimed_profile_id', "fm"."claimed_profile_id") ORDER BY "fm"."relationship") AS "jsonb_agg"
           FROM "public"."family_members" "fm"
          WHERE (("fm"."family_id" = "f"."id") AND ("fm"."org_id" = "f"."org_id"))), '[]'::"jsonb") AS "family_members_list",
    "org_id"
   FROM "public"."family_units" "f"
  WHERE ("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"));


ALTER VIEW "public"."families_directory_full" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."family_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "family_member_id" "uuid" NOT NULL,
    "family_id" "uuid" NOT NULL,
    "invite_email" "text" NOT NULL,
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sent_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL
);


ALTER TABLE "public"."family_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid",
    "type" "text" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    CONSTRAINT "feedback_message_check" CHECK ((("char_length"("message") >= 1) AND ("char_length"("message") <= 2000))),
    CONSTRAINT "feedback_type_check" CHECK (("type" = ANY (ARRAY['idea'::"text", 'problem'::"text"])))
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."giving_fund_methods" (
    "fund_id" "uuid" NOT NULL,
    "method" "text" NOT NULL,
    "custom_handle" "text" NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    CONSTRAINT "giving_fund_methods_custom_handle_check" CHECK ((("char_length"("custom_handle") >= 1) AND ("char_length"("custom_handle") <= 120))),
    CONSTRAINT "giving_fund_methods_method_check" CHECK (("method" = ANY (ARRAY['venmo'::"text", 'paypal'::"text", 'cashapp'::"text", 'zelle'::"text", 'wallet'::"text"])))
);


ALTER TABLE "public"."giving_fund_methods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."giving_funds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "steward_id" "uuid" NOT NULL,
    "co_steward_id" "uuid",
    "steward_role" "text",
    "retire_on" "date",
    "is_active" boolean DEFAULT true NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    CONSTRAINT "giving_funds_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 80))),
    CONSTRAINT "giving_funds_steward_role_check" CHECK ((("steward_role" IS NULL) OR ("char_length"("steward_role") <= 60)))
);


ALTER TABLE "public"."giving_funds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_invite_uses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "invite_id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "used_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text",
    "outcome" "text" NOT NULL,
    "profile_id" "uuid",
    "access_request_id" "uuid",
    CONSTRAINT "group_invite_uses_outcome_check" CHECK (("outcome" = ANY (ARRAY['signup_sent'::"text", 'joined'::"text", 'requested'::"text"]))),
    CONSTRAINT "group_invite_uses_signup_has_email" CHECK ((("outcome" <> 'signup_sent'::"text") OR ("email" IS NOT NULL)))
);


ALTER TABLE "public"."group_invite_uses" OWNER TO "postgres";


COMMENT ON TABLE "public"."group_invite_uses" IS 'One row per redemption of a group invite. Written only by group_invite_redeem() and group_invite_join(); profile_id is stamped by handle_new_user() when a signup_sent row''s person signs up. The count per invite is what max_uses is compared against.';



CREATE TABLE IF NOT EXISTS "public"."group_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "max_uses" integer,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "group_invites_max_uses_positive" CHECK ((("max_uses" IS NULL) OR ("max_uses" > 0)))
);


ALTER TABLE "public"."group_invites" OWNER TO "postgres";


COMMENT ON TABLE "public"."group_invites" IS 'A link into one group. token is the plaintext the link carries; the row is read by the service client on /join/<token> and is the org anchor for everything that follows. Dead when revoked_at is set, expires_at has passed, or group_invite_uses holds max_uses rows. Never deleted by the app.';



CREATE TABLE IF NOT EXISTS "public"."group_join_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "group_join_requests_reviewed_consistent" CHECK ((("status" = 'pending'::"text") = ("reviewed_at" IS NULL))),
    CONSTRAINT "group_join_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'declined'::"text"])))
);


ALTER TABLE "public"."group_join_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."group_join_requests" IS 'A member''s request to join a group under the approval policy. Written only by join_group_apply() and review_group_join_request(); read by the requester, the group''s leaders and org admins. Declined rows are the record and are never deleted by the app.';



CREATE TABLE IF NOT EXISTS "public"."group_labels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "group_labels_color_check" CHECK ((("color" IS NULL) OR ("color" ~ '^#[0-9a-fA-F]{6}$'::"text"))),
    CONSTRAINT "group_labels_name_not_blank" CHECK (("btrim"("name") <> ''::"text"))
);


ALTER TABLE "public"."group_labels" OWNER TO "postgres";


COMMENT ON TABLE "public"."group_labels" IS 'A filter tag defined inside one group (Men, Women, Tuesday table). Attributes, not roles.';



CREATE TABLE IF NOT EXISTS "public"."group_member_labels" (
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "group_member_id" "uuid" NOT NULL,
    "label_id" "uuid" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "applied_by" "uuid"
);


ALTER TABLE "public"."group_member_labels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "added_by" "uuid",
    CONSTRAINT "group_members_role_check" CHECK (("role" = ANY (ARRAY['leader'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."group_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."group_members" IS 'Membership of a group. role = leader is the one permission role above member; display titles are free text on the about page, never permissions.';



CREATE TABLE IF NOT EXISTS "public"."group_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "group_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "group_requests_name_not_blank" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "group_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'declined'::"text"])))
);


ALTER TABLE "public"."group_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."group_requests" IS 'A member''s request for a new group under the approval policy. Approval goes through group_request_approve(), which creates the group and links it here; decline is a plain UPDATE. Declined rows are the record and are never deleted by the app.';



CREATE TABLE IF NOT EXISTS "public"."group_settings" (
    "group_id" "uuid" NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "weekly_zoom_url" "text",
    "zoom_meeting_time" "text",
    "weekly_prayer_call_url" "text",
    "weekly_prayer_call_time" "text",
    "serving_link_mode" "text",
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "group_settings_serving_link_mode_check" CHECK (("serving_link_mode" = ANY (ARRAY['signed'::"text", 'login'::"text"]))),
    CONSTRAINT "group_settings_weekly_prayer_call_url_check" CHECK ((("weekly_prayer_call_url" IS NULL) OR ("weekly_prayer_call_url" ~ '^https://'::"text"))),
    CONSTRAINT "group_settings_weekly_zoom_url_check" CHECK ((("weekly_zoom_url" IS NULL) OR ("weekly_zoom_url" ~ '^https://'::"text")))
);


ALTER TABLE "public"."group_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."group_settings" IS 'Per-group settings: the weekly video call, the weekly prayer call and the serving email link mode. One row per group, created on first save; an absent row means the defaults.';



CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_private" boolean DEFAULT false NOT NULL,
    "join_policy" "text" DEFAULT 'approval'::"text" NOT NULL,
    CONSTRAINT "groups_join_policy_check" CHECK (("join_policy" = ANY (ARRAY['open'::"text", 'approval'::"text"]))),
    CONSTRAINT "groups_name_not_blank" CHECK (("btrim"("name") <> ''::"text"))
);


ALTER TABLE "public"."groups" OWNER TO "postgres";


COMMENT ON TABLE "public"."groups" IS 'A class or small group. Holds the content layer (calendar, announcements, lectures, serving, prayer, giving, roster). One level deep: no sub-groups.';



COMMENT ON COLUMN "public"."groups"."is_private" IS 'Hidden from discovery for non-members regardless of the org switch, and join_group() refuses it. Members and org admins still see the row through discoverable_groups().';



COMMENT ON COLUMN "public"."groups"."join_policy" IS 'open: join_group() enrols the caller at once. approval: join_group() files a group_join_requests row for a leader to review. Not consulted while is_private.';



CREATE TABLE IF NOT EXISTS "public"."lecture_series" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "teacher" "text",
    "is_archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL
);


ALTER TABLE "public"."lecture_series" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lectures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "video_url" "text" NOT NULL,
    "thumbnail_url" "text",
    "lecture_date" "date",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "series_id" "uuid",
    "week_number" integer,
    "scripture_reference" "text",
    "summary" "text",
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL
);


ALTER TABLE "public"."lectures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_domain_worker_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "domain" "text" NOT NULL,
    "event" "text" NOT NULL,
    "detail" "text",
    "acknowledged_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_domain_worker_events_event_check" CHECK (("event" = ANY (ARRAY['attach_permanent_failure'::"text", 'detached'::"text"])))
);


ALTER TABLE "public"."org_domain_worker_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."org_domain_worker_events" IS 'Append-only outcome log written by the attach-org-domains worker (service role, explicit org_id on every insert) and acknowledged from /platform/domains. attach_permanent_failure: a Vercel 409/403/402 — the row is skipped until acknowledged. detached: the tombstone was hard-deleted after Vercel confirmed removal — the operator''s cue to delist the name from the auth redirect allowlist.';



CREATE TABLE IF NOT EXISTS "public"."org_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "domain" "text" NOT NULL,
    "status" "public"."org_domain_status" DEFAULT 'pending'::"public"."org_domain_status" NOT NULL,
    "verification_token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(16), 'hex'::"text") NOT NULL,
    "verified_at" timestamp with time zone,
    "attached_at" timestamp with time zone,
    "attach_claimed_at" timestamp with time zone,
    "attach_claim_token" "uuid",
    "last_checked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_domains_domain_shape" CHECK ((("domain" = "lower"("domain")) AND (("length"("domain") >= 4) AND ("length"("domain") <= 253)) AND ("domain" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'::"text")))
);


ALTER TABLE "public"."org_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_email_limits" (
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "daily_cap" integer DEFAULT 500 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_email_limits_cap_sane" CHECK ((("daily_cap" >= 0) AND ("daily_cap" <= 100000)))
);


ALTER TABLE "public"."org_email_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_email_usage" (
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "usage_date" "date" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"date" NOT NULL,
    "sent_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "org_email_usage_sent_count_check" CHECK (("sent_count" >= 0))
);


ALTER TABLE "public"."org_email_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "org_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "branding" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "public"."org_status" DEFAULT 'active'::"public"."org_status" NOT NULL,
    "custom_email_domain_enabled" boolean DEFAULT false NOT NULL,
    "directory_visibility" "text" DEFAULT 'shared_groups'::"text" NOT NULL,
    "group_creation_policy" "text" DEFAULT 'approval'::"text" NOT NULL,
    "group_discovery" boolean DEFAULT true NOT NULL,
    "timezone" "text" DEFAULT 'America/New_York'::"text" NOT NULL,
    CONSTRAINT "organizations_directory_visibility_check" CHECK (("directory_visibility" = ANY (ARRAY['shared_groups'::"text", 'org'::"text"]))),
    CONSTRAINT "organizations_group_creation_policy_check" CHECK (("group_creation_policy" = ANY (ARRAY['open'::"text", 'approval'::"text", 'admins'::"text"])))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."organizations"."custom_email_domain_enabled" IS 'Platform-operator-only gate on custom sending-domain claims. Flippable only from /platform (app/api/platform/organizations/[id]/route.ts); never exposed to the org''s own admin.';



COMMENT ON COLUMN "public"."organizations"."directory_visibility" IS 'Security boundary read by the profiles, family_units and family_members SELECT policies, not a preference. shared_groups: a member reads only people who share a group with them. org: every approved member reads the whole directory.';



COMMENT ON COLUMN "public"."organizations"."group_creation_policy" IS 'Who may create a group. open: any approved member, live at once. approval: a member files a request an org admin approves. admins: org admins only. Read by group_create() and the group_requests INSERT policy, so a security boundary, not a preference.';



COMMENT ON COLUMN "public"."organizations"."group_discovery" IS 'Ceiling for group discovery. false: members see only the groups they belong to and join_group() refuses every group. Read by discoverable_groups() and join_group(), never by a policy.';



COMMENT ON COLUMN "public"."organizations"."timezone" IS 'IANA zone every event time is entered and displayed in. organizations_timezone_check() refuses anything but an exact IANA name; the app falls back to its configured default only when no org row resolves.';



CREATE TABLE IF NOT EXISTS "public"."platform_admins" (
    "profile_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."platform_admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prayer_call_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "weekday" integer NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone,
    "leader_id" "uuid",
    "dial_in" "text",
    "pin" "text",
    "join_url" "text",
    "event_id" "uuid",
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    CONSTRAINT "prayer_call_sessions_dial_in_check" CHECK ((("dial_in" IS NULL) OR ("char_length"("dial_in") <= 40))),
    CONSTRAINT "prayer_call_sessions_join_url_check" CHECK ((("join_url" IS NULL) OR ("char_length"("join_url") <= 500))),
    CONSTRAINT "prayer_call_sessions_pin_check" CHECK ((("pin" IS NULL) OR ("char_length"("pin") <= 20))),
    CONSTRAINT "prayer_call_sessions_weekday_check" CHECK ((("weekday" >= 0) AND ("weekday" <= 6)))
);


ALTER TABLE "public"."prayer_call_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prayer_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "is_anonymous" boolean DEFAULT false NOT NULL,
    "is_answered" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    CONSTRAINT "prayer_requests_body_check" CHECK ((("char_length"("body") >= 1) AND ("char_length"("body") <= 2000)))
);


ALTER TABLE "public"."prayer_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prayer_responses" (
    "request_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL
);


ALTER TABLE "public"."prayer_responses" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."prayer_wall" WITH ("security_invoker"='true') AS
 SELECT "r"."id",
    "r"."body",
    "r"."is_anonymous",
    "r"."is_answered",
    "r"."created_at",
    ("r"."author_id" = ( SELECT "auth"."uid"() AS "uid")) AS "mine",
        CASE
            WHEN ("r"."is_anonymous" AND ("r"."author_id" <> ( SELECT "auth"."uid"() AS "uid"))) THEN NULL::"text"
            ELSE "p"."first_name"
        END AS "first_name",
        CASE
            WHEN ("r"."is_anonymous" AND ("r"."author_id" <> ( SELECT "auth"."uid"() AS "uid"))) THEN NULL::"text"
            ELSE "p"."last_name"
        END AS "last_name",
        CASE
            WHEN ("r"."is_anonymous" AND ("r"."author_id" <> ( SELECT "auth"."uid"() AS "uid"))) THEN NULL::"text"
            ELSE "p"."preferred_name"
        END AS "preferred_name",
        CASE
            WHEN ("r"."is_anonymous" AND ("r"."author_id" <> ( SELECT "auth"."uid"() AS "uid"))) THEN NULL::"text"
            ELSE "p"."avatar_url"
        END AS "avatar_url",
    COALESCE("pc"."praying_count", 0) AS "praying_count",
    COALESCE("pc"."i_am_praying", false) AS "i_am_praying",
    "r"."org_id",
    "r"."group_id"
   FROM (("public"."prayer_requests" "r"
     LEFT JOIN "public"."profiles" "p" ON ((("p"."id" = "r"."author_id") AND ("p"."org_id" = "r"."org_id"))))
     LEFT JOIN LATERAL ( SELECT ("count"(*))::integer AS "praying_count",
            "bool_or"(("pr"."profile_id" = ( SELECT "auth"."uid"() AS "uid"))) AS "i_am_praying"
           FROM "public"."prayer_responses" "pr"
          WHERE (("pr"."request_id" = "r"."id") AND ("pr"."org_id" = "r"."org_id"))) "pc" ON (true))
  WHERE ("r"."org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"));


ALTER VIEW "public"."prayer_wall" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."profiles_directory" AS
SELECT
    NULL::"uuid" AS "id",
    NULL::"text" AS "first_name",
    NULL::"text" AS "last_name",
    NULL::"text" AS "preferred_name",
    NULL::"text" AS "avatar_url",
    NULL::"text" AS "role",
    NULL::"text" AS "relationship",
    NULL::"text" AS "bio",
    NULL::"uuid" AS "family_id",
    NULL::timestamp with time zone AS "created_at",
    NULL::"text" AS "email",
    NULL::"text" AS "phone_mobile",
    NULL::"text" AS "phone_home",
    NULL::"text" AS "phone_work",
    NULL::"text" AS "address_line1",
    NULL::"text" AS "address_line2",
    NULL::"text" AS "city",
    NULL::"text" AS "state",
    NULL::"text" AS "postal_code",
    NULL::smallint AS "birth_month",
    NULL::smallint AS "birth_day",
    NULL::smallint AS "birth_year",
    NULL::"date" AS "anniversary",
    NULL::"text" AS "occupation",
    NULL::"text" AS "employer",
    NULL::"jsonb" AS "groups",
    NULL::"uuid" AS "org_id";


ALTER VIEW "public"."profiles_directory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rsvps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    CONSTRAINT "rsvps_status_check" CHECK (("status" = ANY (ARRAY['yes'::"text", 'no'::"text", 'maybe'::"text"])))
);


ALTER TABLE "public"."rsvps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."serving_broadcasts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "sent_by" "uuid",
    "subject" "text" NOT NULL,
    "open_dates" "date"[] DEFAULT '{}'::"date"[] NOT NULL,
    "recipient_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL
);


ALTER TABLE "public"."serving_broadcasts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."serving_broadcasts"."team_id" IS 'Team id (references teams).';



CREATE TABLE IF NOT EXISTS "public"."serving_signup_attendees" (
    "signup_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL
);


ALTER TABLE "public"."serving_signup_attendees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."serving_signups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "service_date" "date" NOT NULL,
    "family_id" "uuid",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL
);


ALTER TABLE "public"."serving_signups" OWNER TO "postgres";


COMMENT ON COLUMN "public"."serving_signups"."team_id" IS 'Team id (references teams).';



CREATE TABLE IF NOT EXISTS "public"."serving_team_settings" (
    "team_id" "uuid" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "reminder_days" integer[] DEFAULT '{4,5}'::integer[] NOT NULL,
    "reminder_method" "text" DEFAULT 'email'::"text" NOT NULL,
    "window_weeks" integer DEFAULT 8 NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    CONSTRAINT "serving_team_settings_reminder_days_check" CHECK (("reminder_days" <@ ARRAY[0, 1, 2, 3, 4, 5, 6])),
    CONSTRAINT "serving_team_settings_reminder_method_check" CHECK (("reminder_method" = 'email'::"text")),
    CONSTRAINT "serving_team_settings_window_weeks_check" CHECK ((("window_weeks" >= 1) AND ("window_weeks" <= 26)))
);


ALTER TABLE "public"."serving_team_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."serving_team_settings"."team_id" IS 'Team id (references teams).';



CREATE TABLE IF NOT EXISTS "public"."site_settings" (
    "key" "text" NOT NULL,
    "value" "text",
    "updated_by" "uuid",
    "updated_at" timestamp with time zone,
    "is_public" boolean DEFAULT false NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL
);


ALTER TABLE "public"."site_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "profile_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_leader" boolean DEFAULT false NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_members" IS 'Membership of a team; is_leader marks the team lead. Renamed from profile_groups (group_id → team_id).';



CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "color" "text",
    "icon" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_serving_role" boolean DEFAULT false NOT NULL,
    "org_id" "uuid" DEFAULT "public"."app_current_org_id"() NOT NULL,
    "group_id" "uuid" NOT NULL
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


COMMENT ON TABLE "public"."teams" IS 'A team inside one group (greeters, prayer team, hospitality): carries serving signups, reminders and serving_team_settings. Renamed from member_groups.';



COMMENT ON COLUMN "public"."teams"."group_id" IS 'The group this team belongs to. Required: a team never exists outside a group.';



ALTER TABLE ONLY "public"."about_page"
    ADD CONSTRAINT "about_page_pkey" PRIMARY KEY ("group_id");



ALTER TABLE ONLY "public"."access_requests"
    ADD CONSTRAINT "access_requests_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."access_requests"
    ADD CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."access_requests"
    ADD CONSTRAINT "access_requests_signup_token_key" UNIQUE ("signup_token");



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_subscription_tokens"
    ADD CONSTRAINT "calendar_subscription_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_subscription_tokens"
    ADD CONSTRAINT "calendar_subscription_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."calendar_subscription_tokens"
    ADD CONSTRAINT "calendar_subscription_tokens_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."class_teachers"
    ADD CONSTRAINT "class_teachers_group_id_profile_id_key" UNIQUE ("group_id", "profile_id");



ALTER TABLE ONLY "public"."class_teachers"
    ADD CONSTRAINT "class_teachers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_calendars"
    ADD CONSTRAINT "event_calendars_id_org_group_unique" UNIQUE ("id", "org_id", "group_id");



ALTER TABLE ONLY "public"."event_calendars"
    ADD CONSTRAINT "event_calendars_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."event_calendars"
    ADD CONSTRAINT "event_calendars_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_id_org_group_unique" UNIQUE ("id", "org_id", "group_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."family_invites"
    ADD CONSTRAINT "family_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."family_invites"
    ADD CONSTRAINT "family_invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."family_invites"
    ADD CONSTRAINT "family_invites_token_org_unique" UNIQUE ("token", "org_id");



ALTER TABLE ONLY "public"."family_members"
    ADD CONSTRAINT "family_members_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."family_members"
    ADD CONSTRAINT "family_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."family_units"
    ADD CONSTRAINT "family_units_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."family_units"
    ADD CONSTRAINT "family_units_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."giving_fund_methods"
    ADD CONSTRAINT "giving_fund_methods_pkey" PRIMARY KEY ("fund_id", "method");



ALTER TABLE ONLY "public"."giving_funds"
    ADD CONSTRAINT "giving_funds_id_org_group_unique" UNIQUE ("id", "org_id", "group_id");



ALTER TABLE ONLY "public"."giving_funds"
    ADD CONSTRAINT "giving_funds_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."giving_funds"
    ADD CONSTRAINT "giving_funds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_invite_uses"
    ADD CONSTRAINT "group_invite_uses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_invites"
    ADD CONSTRAINT "group_invites_id_group_org_unique" UNIQUE ("id", "group_id", "org_id");



ALTER TABLE ONLY "public"."group_invites"
    ADD CONSTRAINT "group_invites_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."group_invites"
    ADD CONSTRAINT "group_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_invites"
    ADD CONSTRAINT "group_invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."group_join_requests"
    ADD CONSTRAINT "group_join_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_labels"
    ADD CONSTRAINT "group_labels_group_name_key" UNIQUE ("group_id", "name");



ALTER TABLE ONLY "public"."group_labels"
    ADD CONSTRAINT "group_labels_id_group_org_unique" UNIQUE ("id", "group_id", "org_id");



ALTER TABLE ONLY "public"."group_labels"
    ADD CONSTRAINT "group_labels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_member_labels"
    ADD CONSTRAINT "group_member_labels_pkey" PRIMARY KEY ("group_member_id", "label_id");



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_profile_key" UNIQUE ("group_id", "profile_id");



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_id_group_org_unique" UNIQUE ("id", "group_id", "org_id");



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_requests"
    ADD CONSTRAINT "group_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_settings"
    ADD CONSTRAINT "group_settings_pkey" PRIMARY KEY ("group_id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lecture_series"
    ADD CONSTRAINT "lecture_series_id_org_group_unique" UNIQUE ("id", "org_id", "group_id");



ALTER TABLE ONLY "public"."lecture_series"
    ADD CONSTRAINT "lecture_series_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."lecture_series"
    ADD CONSTRAINT "lecture_series_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lectures"
    ADD CONSTRAINT "lectures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_domain_worker_events"
    ADD CONSTRAINT "org_domain_worker_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_domains"
    ADD CONSTRAINT "org_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_email_domains"
    ADD CONSTRAINT "org_email_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_email_limits"
    ADD CONSTRAINT "org_email_limits_pkey" PRIMARY KEY ("org_id");



ALTER TABLE ONLY "public"."org_email_usage"
    ADD CONSTRAINT "org_email_usage_pkey" PRIMARY KEY ("org_id", "usage_date");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("org_id", "profile_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."prayer_call_sessions"
    ADD CONSTRAINT "prayer_call_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prayer_requests"
    ADD CONSTRAINT "prayer_requests_id_org_group_unique" UNIQUE ("id", "org_id", "group_id");



ALTER TABLE ONLY "public"."prayer_requests"
    ADD CONSTRAINT "prayer_requests_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."prayer_requests"
    ADD CONSTRAINT "prayer_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prayer_responses"
    ADD CONSTRAINT "prayer_responses_pkey" PRIMARY KEY ("request_id", "profile_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rsvps"
    ADD CONSTRAINT "rsvps_event_id_user_id_key" UNIQUE ("event_id", "user_id");



ALTER TABLE ONLY "public"."rsvps"
    ADD CONSTRAINT "rsvps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."serving_broadcasts"
    ADD CONSTRAINT "serving_broadcasts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."serving_signup_attendees"
    ADD CONSTRAINT "serving_signup_attendees_pkey" PRIMARY KEY ("signup_id", "profile_id");



ALTER TABLE ONLY "public"."serving_signups"
    ADD CONSTRAINT "serving_signups_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."serving_signups"
    ADD CONSTRAINT "serving_signups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."serving_signups"
    ADD CONSTRAINT "serving_signups_team_id_service_date_key" UNIQUE ("team_id", "service_date");



ALTER TABLE ONLY "public"."serving_team_settings"
    ADD CONSTRAINT "serving_team_settings_pkey" PRIMARY KEY ("team_id");



ALTER TABLE ONLY "public"."site_settings"
    ADD CONSTRAINT "site_settings_pkey" PRIMARY KEY ("org_id", "key");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("profile_id", "team_id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_id_org_unique" UNIQUE ("id", "org_id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



CREATE INDEX "about_page_group_id_idx" ON "public"."about_page" USING "btree" ("group_id");



CREATE INDEX "access_requests_group_invite_id_idx" ON "public"."access_requests" USING "btree" ("group_invite_id");



CREATE INDEX "access_requests_invite_token_idx" ON "public"."access_requests" USING "btree" ("invite_token");



CREATE INDEX "access_requests_org_id_idx" ON "public"."access_requests" USING "btree" ("org_id");



CREATE INDEX "announcements_group_id_idx" ON "public"."announcements" USING "btree" ("group_id");



CREATE INDEX "announcements_org_id_idx" ON "public"."announcements" USING "btree" ("org_id");



CREATE INDEX "calendar_subscription_tokens_org_id_idx" ON "public"."calendar_subscription_tokens" USING "btree" ("org_id");



CREATE INDEX "class_teachers_group_id_idx" ON "public"."class_teachers" USING "btree" ("group_id");



CREATE INDEX "event_calendars_group_id_idx" ON "public"."event_calendars" USING "btree" ("group_id");



CREATE INDEX "event_calendars_org_id_idx" ON "public"."event_calendars" USING "btree" ("org_id");



CREATE INDEX "events_calendar_id_idx" ON "public"."events" USING "btree" ("calendar_id");



CREATE INDEX "events_group_id_idx" ON "public"."events" USING "btree" ("group_id");



CREATE INDEX "events_org_id_idx" ON "public"."events" USING "btree" ("org_id");



CREATE INDEX "events_series_id_idx" ON "public"."events" USING "btree" ("series_id") WHERE ("series_id" IS NOT NULL);



CREATE INDEX "events_start_time_idx" ON "public"."events" USING "btree" ("start_time");



CREATE INDEX "family_invites_family_id_idx" ON "public"."family_invites" USING "btree" ("family_id");



CREATE INDEX "family_invites_family_member_id_idx" ON "public"."family_invites" USING "btree" ("family_member_id");



CREATE INDEX "family_invites_org_id_idx" ON "public"."family_invites" USING "btree" ("org_id");



CREATE INDEX "family_members_claimed_profile_idx" ON "public"."family_members" USING "btree" ("claimed_profile_id");



CREATE INDEX "family_members_family_id_idx" ON "public"."family_members" USING "btree" ("family_id");



CREATE INDEX "family_members_org_id_idx" ON "public"."family_members" USING "btree" ("org_id");



CREATE INDEX "family_units_org_id_idx" ON "public"."family_units" USING "btree" ("org_id");



CREATE INDEX "feedback_org_id_idx" ON "public"."feedback" USING "btree" ("org_id");



CREATE INDEX "giving_fund_methods_group_id_idx" ON "public"."giving_fund_methods" USING "btree" ("group_id");



CREATE INDEX "giving_fund_methods_org_id_idx" ON "public"."giving_fund_methods" USING "btree" ("org_id");



CREATE INDEX "giving_funds_group_id_idx" ON "public"."giving_funds" USING "btree" ("group_id");



CREATE INDEX "giving_funds_org_id_idx" ON "public"."giving_funds" USING "btree" ("org_id");



CREATE INDEX "group_invite_uses_invite_id_idx" ON "public"."group_invite_uses" USING "btree" ("invite_id");



CREATE INDEX "group_invite_uses_org_id_idx" ON "public"."group_invite_uses" USING "btree" ("org_id");



CREATE INDEX "group_invites_group_org_idx" ON "public"."group_invites" USING "btree" ("group_id", "org_id");



CREATE INDEX "group_invites_org_id_idx" ON "public"."group_invites" USING "btree" ("org_id");



CREATE INDEX "group_join_requests_group_status_idx" ON "public"."group_join_requests" USING "btree" ("group_id", "status");



CREATE UNIQUE INDEX "group_join_requests_one_pending_idx" ON "public"."group_join_requests" USING "btree" ("group_id", "profile_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "group_join_requests_org_id_idx" ON "public"."group_join_requests" USING "btree" ("org_id");



CREATE INDEX "group_join_requests_org_status_idx" ON "public"."group_join_requests" USING "btree" ("org_id", "status");



CREATE INDEX "group_labels_org_id_idx" ON "public"."group_labels" USING "btree" ("org_id");



CREATE INDEX "group_member_labels_label_id_idx" ON "public"."group_member_labels" USING "btree" ("label_id");



CREATE INDEX "group_member_labels_org_id_idx" ON "public"."group_member_labels" USING "btree" ("org_id");



CREATE INDEX "group_members_org_id_idx" ON "public"."group_members" USING "btree" ("org_id");



CREATE INDEX "group_members_profile_org_idx" ON "public"."group_members" USING "btree" ("profile_id", "org_id");



CREATE UNIQUE INDEX "group_requests_one_pending_per_name" ON "public"."group_requests" USING "btree" ("org_id", "requested_by", "name") WHERE ("status" = 'pending'::"text");



CREATE INDEX "group_requests_org_id_idx" ON "public"."group_requests" USING "btree" ("org_id");



CREATE INDEX "group_requests_org_status_idx" ON "public"."group_requests" USING "btree" ("org_id", "status");



CREATE INDEX "group_settings_org_id_idx" ON "public"."group_settings" USING "btree" ("org_id");



CREATE INDEX "groups_org_id_idx" ON "public"."groups" USING "btree" ("org_id");



CREATE INDEX "lecture_series_group_id_idx" ON "public"."lecture_series" USING "btree" ("group_id");



CREATE INDEX "lecture_series_org_id_idx" ON "public"."lecture_series" USING "btree" ("org_id");



CREATE INDEX "lectures_group_id_idx" ON "public"."lectures" USING "btree" ("group_id");



CREATE INDEX "lectures_org_id_idx" ON "public"."lectures" USING "btree" ("org_id");



CREATE INDEX "lectures_series_id_idx" ON "public"."lectures" USING "btree" ("series_id");



CREATE INDEX "org_domain_worker_events_unacknowledged_idx" ON "public"."org_domain_worker_events" USING "btree" ("org_id", "domain") WHERE ("acknowledged_at" IS NULL);



CREATE INDEX "org_domains_domain_idx" ON "public"."org_domains" USING "btree" ("domain") WHERE ("status" = 'verified'::"public"."org_domain_status");



CREATE UNIQUE INDEX "org_domains_org_domain_key" ON "public"."org_domains" USING "btree" ("org_id", "domain") WHERE ("status" <> 'removing'::"public"."org_domain_status");



CREATE UNIQUE INDEX "org_domains_verified_domain_key" ON "public"."org_domains" USING "btree" ("domain") WHERE ("status" = ANY (ARRAY['verified'::"public"."org_domain_status", 'removing'::"public"."org_domain_status"]));



CREATE UNIQUE INDEX "org_email_domains_org_key" ON "public"."org_email_domains" USING "btree" ("org_id");



CREATE INDEX "organization_members_profile_id_idx" ON "public"."organization_members" USING "btree" ("profile_id");



CREATE INDEX "prayer_call_sessions_group_id_idx" ON "public"."prayer_call_sessions" USING "btree" ("group_id");



CREATE INDEX "prayer_call_sessions_org_id_idx" ON "public"."prayer_call_sessions" USING "btree" ("org_id");



CREATE INDEX "prayer_requests_author_id_idx" ON "public"."prayer_requests" USING "btree" ("author_id");



CREATE INDEX "prayer_requests_created_at_idx" ON "public"."prayer_requests" USING "btree" ("created_at" DESC);



CREATE INDEX "prayer_requests_group_id_idx" ON "public"."prayer_requests" USING "btree" ("group_id");



CREATE INDEX "prayer_requests_org_id_idx" ON "public"."prayer_requests" USING "btree" ("org_id");



CREATE INDEX "prayer_responses_group_id_idx" ON "public"."prayer_responses" USING "btree" ("group_id");



CREATE INDEX "prayer_responses_org_id_idx" ON "public"."prayer_responses" USING "btree" ("org_id");



CREATE INDEX "prayer_responses_profile_id_idx" ON "public"."prayer_responses" USING "btree" ("profile_id");



CREATE INDEX "profiles_family_id_idx" ON "public"."profiles" USING "btree" ("family_id");



CREATE INDEX "profiles_org_id_last_first_idx" ON "public"."profiles" USING "btree" ("org_id", "last_name", "first_name");



CREATE INDEX "rsvps_org_id_idx" ON "public"."rsvps" USING "btree" ("org_id");



CREATE INDEX "rsvps_user_id_idx" ON "public"."rsvps" USING "btree" ("user_id");



CREATE INDEX "serving_broadcasts_org_id_idx" ON "public"."serving_broadcasts" USING "btree" ("org_id");



CREATE INDEX "serving_signup_attendees_org_id_idx" ON "public"."serving_signup_attendees" USING "btree" ("org_id");



CREATE INDEX "serving_signup_attendees_profile_idx" ON "public"."serving_signup_attendees" USING "btree" ("profile_id");



CREATE INDEX "serving_signups_org_id_idx" ON "public"."serving_signups" USING "btree" ("org_id");



CREATE INDEX "serving_signups_service_date_idx" ON "public"."serving_signups" USING "btree" ("service_date");



CREATE INDEX "serving_team_settings_org_id_idx" ON "public"."serving_team_settings" USING "btree" ("org_id");



CREATE INDEX "team_members_org_id_idx" ON "public"."team_members" USING "btree" ("org_id");



CREATE INDEX "team_members_team_id_idx" ON "public"."team_members" USING "btree" ("team_id");



CREATE INDEX "teams_group_id_idx" ON "public"."teams" USING "btree" ("group_id");



CREATE INDEX "teams_org_id_idx" ON "public"."teams" USING "btree" ("org_id");



CREATE OR REPLACE VIEW "public"."profiles_directory" WITH ("security_invoker"='true') AS
 SELECT "p"."id",
    "p"."first_name",
    "p"."last_name",
    "p"."preferred_name",
    "p"."avatar_url",
    "p"."role",
    "p"."relationship",
    "p"."bio",
    "p"."family_id",
    "p"."created_at",
        CASE
            WHEN "p"."hide_email" THEN NULL::"text"
            ELSE "p"."email"
        END AS "email",
        CASE
            WHEN "p"."hide_phone_mobile" THEN NULL::"text"
            ELSE "p"."phone_mobile"
        END AS "phone_mobile",
        CASE
            WHEN "p"."hide_phone_home" THEN NULL::"text"
            ELSE "p"."phone_home"
        END AS "phone_home",
        CASE
            WHEN "p"."hide_phone_work" THEN NULL::"text"
            ELSE "p"."phone_work"
        END AS "phone_work",
        CASE
            WHEN "p"."hide_address" THEN NULL::"text"
            ELSE "p"."address_line1"
        END AS "address_line1",
        CASE
            WHEN "p"."hide_address" THEN NULL::"text"
            ELSE "p"."address_line2"
        END AS "address_line2",
        CASE
            WHEN "p"."hide_address" THEN NULL::"text"
            ELSE "p"."city"
        END AS "city",
        CASE
            WHEN "p"."hide_address" THEN NULL::"text"
            ELSE "p"."state"
        END AS "state",
        CASE
            WHEN "p"."hide_address" THEN NULL::"text"
            ELSE "p"."postal_code"
        END AS "postal_code",
        CASE
            WHEN "p"."hide_birthday" THEN NULL::smallint
            ELSE "p"."birth_month"
        END AS "birth_month",
        CASE
            WHEN "p"."hide_birthday" THEN NULL::smallint
            ELSE "p"."birth_day"
        END AS "birth_day",
        CASE
            WHEN ("p"."hide_birthday" OR "p"."hide_birth_year") THEN NULL::smallint
            ELSE "p"."birth_year"
        END AS "birth_year",
        CASE
            WHEN "p"."hide_anniversary" THEN NULL::"date"
            ELSE "p"."anniversary"
        END AS "anniversary",
        CASE
            WHEN "p"."hide_occupation" THEN NULL::"text"
            ELSE "p"."occupation"
        END AS "occupation",
        CASE
            WHEN "p"."hide_occupation" THEN NULL::"text"
            ELSE "p"."employer"
        END AS "employer",
    COALESCE("jsonb_agg"("jsonb_build_object"('id', "mg"."id", 'name', "mg"."name", 'color', "mg"."color", 'icon', "mg"."icon") ORDER BY "mg"."display_order") FILTER (WHERE ("mg"."id" IS NOT NULL)), '[]'::"jsonb") AS "groups",
    "p"."org_id"
   FROM (("public"."profiles" "p"
     LEFT JOIN "public"."team_members" "pg" ON ((("p"."id" = "pg"."profile_id") AND ("pg"."org_id" = "p"."org_id"))))
     LEFT JOIN "public"."teams" "mg" ON ((("pg"."team_id" = "mg"."id") AND ("mg"."org_id" = "p"."org_id"))))
  WHERE (("p"."is_unlisted" = false) AND ("p"."role" = ANY (ARRAY['member'::"text", 'admin'::"text"])) AND ("p"."org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")))
  GROUP BY "p"."id";



CREATE OR REPLACE TRIGGER "family_members_touch_updated_at" BEFORE UPDATE ON "public"."family_members" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "family_units_touch_updated_at" BEFORE UPDATE ON "public"."family_units" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "group_members_leave_teams" AFTER DELETE OR UPDATE OF "group_id", "profile_id", "org_id" ON "public"."group_members" FOR EACH ROW EXECUTE FUNCTION "public"."group_member_removed_leaves_teams"();



CREATE OR REPLACE TRIGGER "groups_touch_updated_at" BEFORE UPDATE ON "public"."groups" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "organizations_timezone_check" BEFORE INSERT OR UPDATE OF "timezone" ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."organizations_timezone_check"();



CREATE OR REPLACE TRIGGER "prayer_call_sessions_touch_updated_at" BEFORE UPDATE ON "public"."prayer_call_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "prayer_requests_touch_updated_at" BEFORE UPDATE ON "public"."prayer_requests" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_touch_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "team_members_require_group_membership" BEFORE INSERT OR UPDATE OF "team_id", "profile_id", "org_id" ON "public"."team_members" FOR EACH ROW EXECUTE FUNCTION "public"."team_member_requires_group_membership"();



CREATE OR REPLACE TRIGGER "teams_prune_members_on_move" AFTER UPDATE OF "group_id" ON "public"."teams" FOR EACH ROW WHEN (("old"."group_id" IS DISTINCT FROM "new"."group_id")) EXECUTE FUNCTION "public"."team_moved_prunes_members"();



CREATE OR REPLACE TRIGGER "teams_touch_updated_at" BEFORE UPDATE ON "public"."teams" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



ALTER TABLE ONLY "public"."about_page"
    ADD CONSTRAINT "about_page_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."about_page"
    ADD CONSTRAINT "about_page_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."about_page"
    ADD CONSTRAINT "about_page_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."access_requests"
    ADD CONSTRAINT "access_requests_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE SET NULL ("group_id");



ALTER TABLE ONLY "public"."access_requests"
    ADD CONSTRAINT "access_requests_group_invite_id_fkey" FOREIGN KEY ("group_invite_id", "org_id") REFERENCES "public"."group_invites"("id", "org_id") ON DELETE SET NULL ("group_invite_id");



ALTER TABLE ONLY "public"."access_requests"
    ADD CONSTRAINT "access_requests_invite_token_fkey" FOREIGN KEY ("invite_token", "org_id") REFERENCES "public"."family_invites"("token", "org_id") ON DELETE SET NULL ("invite_token");



ALTER TABLE ONLY "public"."access_requests"
    ADD CONSTRAINT "access_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."access_requests"
    ADD CONSTRAINT "access_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_author_id_fkey" FOREIGN KEY ("author_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE SET NULL ("author_id");



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_subscription_tokens"
    ADD CONSTRAINT "calendar_subscription_tokens_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_subscription_tokens"
    ADD CONSTRAINT "calendar_subscription_tokens_user_id_fkey" FOREIGN KEY ("user_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_teachers"
    ADD CONSTRAINT "class_teachers_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_teachers"
    ADD CONSTRAINT "class_teachers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_teachers"
    ADD CONSTRAINT "class_teachers_profile_id_fkey" FOREIGN KEY ("profile_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_calendars"
    ADD CONSTRAINT "event_calendars_created_by_fkey" FOREIGN KEY ("created_by", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE SET NULL ("created_by");



ALTER TABLE ONLY "public"."event_calendars"
    ADD CONSTRAINT "event_calendars_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_calendars"
    ADD CONSTRAINT "event_calendars_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_calendar_id_fkey" FOREIGN KEY ("calendar_id", "org_id", "group_id") REFERENCES "public"."event_calendars"("id", "org_id", "group_id") ON DELETE SET NULL ("calendar_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE SET NULL ("created_by");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_series_id_fkey" FOREIGN KEY ("series_id", "org_id", "group_id") REFERENCES "public"."events"("id", "org_id", "group_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."family_invites"
    ADD CONSTRAINT "family_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."family_invites"
    ADD CONSTRAINT "family_invites_family_id_fkey" FOREIGN KEY ("family_id", "org_id") REFERENCES "public"."family_units"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."family_invites"
    ADD CONSTRAINT "family_invites_family_member_id_fkey" FOREIGN KEY ("family_member_id", "org_id") REFERENCES "public"."family_members"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."family_invites"
    ADD CONSTRAINT "family_invites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."family_members"
    ADD CONSTRAINT "family_members_claimed_profile_id_fkey" FOREIGN KEY ("claimed_profile_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."family_members"
    ADD CONSTRAINT "family_members_family_id_fkey" FOREIGN KEY ("family_id", "org_id") REFERENCES "public"."family_units"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."family_members"
    ADD CONSTRAINT "family_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."family_units"
    ADD CONSTRAINT "family_units_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_profile_id_fkey" FOREIGN KEY ("profile_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE SET NULL ("profile_id");



ALTER TABLE ONLY "public"."giving_fund_methods"
    ADD CONSTRAINT "giving_fund_methods_fund_id_fkey" FOREIGN KEY ("fund_id", "org_id", "group_id") REFERENCES "public"."giving_funds"("id", "org_id", "group_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."giving_fund_methods"
    ADD CONSTRAINT "giving_fund_methods_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."giving_fund_methods"
    ADD CONSTRAINT "giving_fund_methods_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."giving_funds"
    ADD CONSTRAINT "giving_funds_co_steward_id_fkey" FOREIGN KEY ("co_steward_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE SET NULL ("co_steward_id");



ALTER TABLE ONLY "public"."giving_funds"
    ADD CONSTRAINT "giving_funds_created_by_fkey" FOREIGN KEY ("created_by", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE SET NULL ("created_by");



ALTER TABLE ONLY "public"."giving_funds"
    ADD CONSTRAINT "giving_funds_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."giving_funds"
    ADD CONSTRAINT "giving_funds_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."giving_funds"
    ADD CONSTRAINT "giving_funds_steward_id_fkey" FOREIGN KEY ("steward_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_invite_uses"
    ADD CONSTRAINT "group_invite_uses_access_request_id_fkey" FOREIGN KEY ("access_request_id", "org_id") REFERENCES "public"."access_requests"("id", "org_id") ON DELETE SET NULL ("access_request_id");



ALTER TABLE ONLY "public"."group_invite_uses"
    ADD CONSTRAINT "group_invite_uses_invite_id_fkey" FOREIGN KEY ("invite_id", "group_id", "org_id") REFERENCES "public"."group_invites"("id", "group_id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_invite_uses"
    ADD CONSTRAINT "group_invite_uses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_invite_uses"
    ADD CONSTRAINT "group_invite_uses_profile_id_fkey" FOREIGN KEY ("profile_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE SET NULL ("profile_id");



ALTER TABLE ONLY "public"."group_invites"
    ADD CONSTRAINT "group_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."group_invites"
    ADD CONSTRAINT "group_invites_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_invites"
    ADD CONSTRAINT "group_invites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_join_requests"
    ADD CONSTRAINT "group_join_requests_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_join_requests"
    ADD CONSTRAINT "group_join_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_join_requests"
    ADD CONSTRAINT "group_join_requests_profile_id_fkey" FOREIGN KEY ("profile_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_join_requests"
    ADD CONSTRAINT "group_join_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."group_labels"
    ADD CONSTRAINT "group_labels_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_labels"
    ADD CONSTRAINT "group_labels_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_member_labels"
    ADD CONSTRAINT "group_member_labels_applied_by_fkey" FOREIGN KEY ("applied_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."group_member_labels"
    ADD CONSTRAINT "group_member_labels_label_fkey" FOREIGN KEY ("label_id", "group_id", "org_id") REFERENCES "public"."group_labels"("id", "group_id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_member_labels"
    ADD CONSTRAINT "group_member_labels_member_fkey" FOREIGN KEY ("group_member_id", "group_id", "org_id") REFERENCES "public"."group_members"("id", "group_id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_member_labels"
    ADD CONSTRAINT "group_member_labels_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_profile_id_fkey" FOREIGN KEY ("profile_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_requests"
    ADD CONSTRAINT "group_requests_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE SET NULL ("group_id");



ALTER TABLE ONLY "public"."group_requests"
    ADD CONSTRAINT "group_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_requests"
    ADD CONSTRAINT "group_requests_requested_by_fkey" FOREIGN KEY ("requested_by", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_requests"
    ADD CONSTRAINT "group_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."group_settings"
    ADD CONSTRAINT "group_settings_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_settings"
    ADD CONSTRAINT "group_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_settings"
    ADD CONSTRAINT "group_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lecture_series"
    ADD CONSTRAINT "lecture_series_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lecture_series"
    ADD CONSTRAINT "lecture_series_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lectures"
    ADD CONSTRAINT "lectures_created_by_fkey" FOREIGN KEY ("created_by", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE SET NULL ("created_by");



ALTER TABLE ONLY "public"."lectures"
    ADD CONSTRAINT "lectures_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lectures"
    ADD CONSTRAINT "lectures_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lectures"
    ADD CONSTRAINT "lectures_series_id_fkey" FOREIGN KEY ("series_id", "org_id", "group_id") REFERENCES "public"."lecture_series"("id", "org_id", "group_id") ON DELETE SET NULL ("series_id");



ALTER TABLE ONLY "public"."org_domain_worker_events"
    ADD CONSTRAINT "org_domain_worker_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."org_domains"
    ADD CONSTRAINT "org_domains_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."org_email_domains"
    ADD CONSTRAINT "org_email_domains_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_email_limits"
    ADD CONSTRAINT "org_email_limits_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_email_usage"
    ADD CONSTRAINT "org_email_usage_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prayer_call_sessions"
    ADD CONSTRAINT "prayer_call_sessions_event_id_fkey" FOREIGN KEY ("event_id", "org_id", "group_id") REFERENCES "public"."events"("id", "org_id", "group_id") ON DELETE SET NULL ("event_id");



ALTER TABLE ONLY "public"."prayer_call_sessions"
    ADD CONSTRAINT "prayer_call_sessions_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prayer_call_sessions"
    ADD CONSTRAINT "prayer_call_sessions_leader_id_fkey" FOREIGN KEY ("leader_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE SET NULL ("leader_id");



ALTER TABLE ONLY "public"."prayer_call_sessions"
    ADD CONSTRAINT "prayer_call_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prayer_requests"
    ADD CONSTRAINT "prayer_requests_author_id_fkey" FOREIGN KEY ("author_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prayer_requests"
    ADD CONSTRAINT "prayer_requests_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prayer_requests"
    ADD CONSTRAINT "prayer_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prayer_responses"
    ADD CONSTRAINT "prayer_responses_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prayer_responses"
    ADD CONSTRAINT "prayer_responses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prayer_responses"
    ADD CONSTRAINT "prayer_responses_profile_id_fkey" FOREIGN KEY ("profile_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prayer_responses"
    ADD CONSTRAINT "prayer_responses_request_id_fkey" FOREIGN KEY ("request_id", "org_id", "group_id") REFERENCES "public"."prayer_requests"("id", "org_id", "group_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_family_id_fkey" FOREIGN KEY ("family_id", "org_id") REFERENCES "public"."family_units"("id", "org_id") ON DELETE SET NULL ("family_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rsvps"
    ADD CONSTRAINT "rsvps_event_id_fkey" FOREIGN KEY ("event_id", "org_id") REFERENCES "public"."events"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rsvps"
    ADD CONSTRAINT "rsvps_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rsvps"
    ADD CONSTRAINT "rsvps_user_id_fkey" FOREIGN KEY ("user_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serving_broadcasts"
    ADD CONSTRAINT "serving_broadcasts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serving_broadcasts"
    ADD CONSTRAINT "serving_broadcasts_sent_by_fkey" FOREIGN KEY ("sent_by", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE SET NULL ("sent_by");



ALTER TABLE ONLY "public"."serving_broadcasts"
    ADD CONSTRAINT "serving_broadcasts_team_id_fkey" FOREIGN KEY ("team_id", "org_id") REFERENCES "public"."teams"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serving_signup_attendees"
    ADD CONSTRAINT "serving_signup_attendees_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serving_signup_attendees"
    ADD CONSTRAINT "serving_signup_attendees_profile_id_fkey" FOREIGN KEY ("profile_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serving_signup_attendees"
    ADD CONSTRAINT "serving_signup_attendees_signup_id_fkey" FOREIGN KEY ("signup_id", "org_id") REFERENCES "public"."serving_signups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serving_signups"
    ADD CONSTRAINT "serving_signups_created_by_fkey" FOREIGN KEY ("created_by", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serving_signups"
    ADD CONSTRAINT "serving_signups_family_id_fkey" FOREIGN KEY ("family_id", "org_id") REFERENCES "public"."family_units"("id", "org_id") ON DELETE SET NULL ("family_id");



ALTER TABLE ONLY "public"."serving_signups"
    ADD CONSTRAINT "serving_signups_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serving_signups"
    ADD CONSTRAINT "serving_signups_team_id_fkey" FOREIGN KEY ("team_id", "org_id") REFERENCES "public"."teams"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serving_team_settings"
    ADD CONSTRAINT "serving_team_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serving_team_settings"
    ADD CONSTRAINT "serving_team_settings_team_id_fkey" FOREIGN KEY ("team_id", "org_id") REFERENCES "public"."teams"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serving_team_settings"
    ADD CONSTRAINT "serving_team_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."site_settings"
    ADD CONSTRAINT "site_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_settings"
    ADD CONSTRAINT "site_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_profile_id_fkey" FOREIGN KEY ("profile_id", "org_id") REFERENCES "public"."profiles"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id", "org_id") REFERENCES "public"."teams"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_group_id_fkey" FOREIGN KEY ("group_id", "org_id") REFERENCES "public"."groups"("id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



CREATE POLICY "Admins and household leaders can delete family members" ON "public"."family_members" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (("family_id" = ( SELECT "public"."current_family_id"() AS "current_family_id")) AND ( SELECT "public"."is_member"() AS "is_member") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "self"
  WHERE (("self"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("self"."relationship" = ANY (ARRAY['primary'::"text", 'spouse'::"text"])))))))));



CREATE POLICY "Admins and household leaders can insert family members" ON "public"."family_members" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (("family_id" = ( SELECT "public"."current_family_id"() AS "current_family_id")) AND ( SELECT "public"."is_member"() AS "is_member") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "self"
  WHERE (("self"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("self"."relationship" = ANY (ARRAY['primary'::"text", 'spouse'::"text"])))))))));



CREATE POLICY "Admins and household leaders can update family members" ON "public"."family_members" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (("family_id" = ( SELECT "public"."current_family_id"() AS "current_family_id")) AND ( SELECT "public"."is_member"() AS "is_member") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "self"
  WHERE (("self"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("self"."relationship" = ANY (ARRAY['primary'::"text", 'spouse'::"text"]))))))))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (("family_id" = ( SELECT "public"."current_family_id"() AS "current_family_id")) AND ( SELECT "public"."is_member"() AS "is_member") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "self"
  WHERE (("self"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("self"."relationship" = ANY (ARRAY['primary'::"text", 'spouse'::"text"])))))))));



CREATE POLICY "Admins and household primary can insert family invites" ON "public"."family_invites" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "self"
  WHERE (("self"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("self"."family_id" = "family_invites"."family_id") AND ("self"."family_id" IS NOT NULL) AND ("self"."relationship" = 'primary'::"text")))))));



CREATE POLICY "Admins and household primary can update family invites" ON "public"."family_invites" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "self"
  WHERE (("self"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("self"."family_id" = "family_invites"."family_id") AND ("self"."family_id" IS NOT NULL) AND ("self"."relationship" = 'primary'::"text"))))))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "self"
  WHERE (("self"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("self"."family_id" = "family_invites"."family_id") AND ("self"."family_id" IS NOT NULL) AND ("self"."relationship" = 'primary'::"text")))))));



CREATE POLICY "Admins and members can update family units" ON "public"."family_units" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (("id" = ( SELECT "public"."current_family_id"() AS "current_family_id")) AND ( SELECT "public"."is_member"() AS "is_member"))))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (("id" = ( SELECT "public"."current_family_id"() AS "current_family_id")) AND ( SELECT "public"."is_member"() AS "is_member")))));



CREATE POLICY "Admins can delete family units" ON "public"."family_units" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admins can delete groups" ON "public"."groups" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admins can insert family units" ON "public"."family_units" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admins can insert groups" ON "public"."groups" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admins can read feedback" ON "public"."feedback" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admins can review group requests" ON "public"."group_requests" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin") AND ("status" = 'pending'::"text"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin") AND ("group_id" IS NULL) AND ((("status" = 'pending'::"text") AND ("reviewed_by" IS NULL) AND ("reviewed_at" IS NULL)) OR (("status" = 'declined'::"text") AND ("reviewed_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("reviewed_at" IS NOT NULL)))));



CREATE POLICY "Admins can set org settings" ON "public"."organizations" FOR UPDATE TO "authenticated" USING ((("id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin"))) WITH CHECK ((("id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admins can update access requests" ON "public"."access_requests" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admins can update settings" ON "public"."site_settings" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admins can view access requests" ON "public"."access_requests" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admins delete unattached org domains" ON "public"."org_domains" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((("attached_at" IS NULL) AND ("status" <> 'removing'::"public"."org_domain_status")));



CREATE POLICY "Admins manage org domains" ON "public"."org_domains" TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Admins manage org email domains" ON "public"."org_email_domains" TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Anon can read public settings" ON "public"."site_settings" FOR SELECT TO "authenticated", "anon" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "is_public"));



CREATE POLICY "Fund managers can add methods" ON "public"."giving_fund_methods" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."giving_can_manage_fund"("fund_id")));



CREATE POLICY "Fund managers can remove methods" ON "public"."giving_fund_methods" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."giving_can_manage_fund"("fund_id")));



CREATE POLICY "Fund managers can update methods" ON "public"."giving_fund_methods" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."giving_can_manage_fund"("fund_id"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."giving_can_manage_fund"("fund_id")));



CREATE POLICY "Group leaders and self-stewards can create funds" ON "public"."giving_funds" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("public"."is_group_leader"("group_id") OR (( SELECT "public"."giving_stewards_can_manage"() AS "giving_stewards_can_manage") AND "public"."is_group_member"("group_id") AND ("steward_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Group leaders and stewards can delete funds" ON "public"."giving_funds" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("public"."is_group_leader"("group_id") OR (( SELECT "public"."giving_stewards_can_manage"() AS "giving_stewards_can_manage") AND ("steward_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."is_group_member"("group_id")))));



CREATE POLICY "Group leaders and stewards can update funds" ON "public"."giving_funds" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("public"."is_group_leader"("group_id") OR (( SELECT "public"."giving_stewards_can_manage"() AS "giving_stewards_can_manage") AND ("steward_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."is_group_member"("group_id"))))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id") AND ("public"."is_group_leader"("group_id") OR (( SELECT "public"."giving_stewards_can_manage"() AS "giving_stewards_can_manage") AND ("steward_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Group leaders can delete announcements" ON "public"."announcements" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can delete class teachers" ON "public"."class_teachers" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can delete events" ON "public"."events" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can delete lectures" ON "public"."lectures" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can delete prayer call sessions" ON "public"."prayer_call_sessions" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can delete series" ON "public"."lecture_series" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can delete serving settings" ON "public"."serving_team_settings" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "serving_team_settings"."team_id") AND ("t"."org_id" = "serving_team_settings"."org_id") AND "public"."is_group_leader"("t"."group_id"))))));



CREATE POLICY "Group leaders can insert about page" ON "public"."about_page" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can insert announcements" ON "public"."announcements" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can insert class teachers" ON "public"."class_teachers" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can insert event calendars" ON "public"."event_calendars" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can insert events" ON "public"."events" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can insert group settings" ON "public"."group_settings" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can insert lectures" ON "public"."lectures" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can insert prayer call sessions" ON "public"."prayer_call_sessions" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can insert series" ON "public"."lecture_series" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can update about page" ON "public"."about_page" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can update announcements" ON "public"."announcements" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can update class teachers" ON "public"."class_teachers" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can update event calendars" ON "public"."event_calendars" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can update events" ON "public"."events" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can update group settings" ON "public"."group_settings" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can update lectures" ON "public"."lectures" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can update prayer call sessions" ON "public"."prayer_call_sessions" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group leaders can update series" ON "public"."lecture_series" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_leader"("group_id")));



CREATE POLICY "Group members and admins can view team members" ON "public"."team_members" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "team_members"."team_id") AND ("t"."org_id" = "team_members"."org_id") AND "public"."is_group_member"("t"."group_id")))))));



CREATE POLICY "Group members and admins can view teams" ON "public"."teams" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_member"("group_id"))));



CREATE POLICY "Group members can post own prayer requests" ON "public"."prayer_requests" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id") AND ("author_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Group members can pray for visible requests" ON "public"."prayer_responses" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id") AND ("profile_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."prayer_requests" "r"
  WHERE ("r"."id" = "prayer_responses"."request_id")))));



CREATE POLICY "Group members can read about page" ON "public"."about_page" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id")));



CREATE POLICY "Group members can read class teachers" ON "public"."class_teachers" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id")));



CREATE POLICY "Group members can read group settings" ON "public"."group_settings" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id")));



CREATE POLICY "Group members can view event calendars" ON "public"."event_calendars" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id")));



CREATE POLICY "Group members can view events" ON "public"."events" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id")));



CREATE POLICY "Group members can view fund methods" ON "public"."giving_fund_methods" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id")));



CREATE POLICY "Group members can view giving funds" ON "public"."giving_funds" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id")));



CREATE POLICY "Group members can view lectures" ON "public"."lectures" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id")));



CREATE POLICY "Group members can view prayer call sessions" ON "public"."prayer_call_sessions" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id")));



CREATE POLICY "Group members can view prayer requests" ON "public"."prayer_requests" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id")));



CREATE POLICY "Group members can view prayer responses" ON "public"."prayer_responses" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id") AND (EXISTS ( SELECT 1
   FROM "public"."prayer_requests" "r"
  WHERE ("r"."id" = "prayer_responses"."request_id")))));



CREATE POLICY "Group members can view published announcements" ON "public"."announcements" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id") AND ("is_published" OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Group members can view series" ON "public"."lecture_series" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id")));



CREATE POLICY "Group members can view serving settings" ON "public"."serving_team_settings" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "serving_team_settings"."team_id") AND ("t"."org_id" = "serving_team_settings"."org_id") AND "public"."is_group_member"("t"."group_id"))))));



CREATE POLICY "Group members can view serving signups" ON "public"."serving_signups" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "serving_signups"."team_id") AND ("t"."org_id" = "serving_signups"."org_id") AND "public"."is_group_member"("t"."group_id"))))));



CREATE POLICY "Leaders and admins can create group invites" ON "public"."group_invites" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("revoked_at" IS NULL) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can delete group labels" ON "public"."group_labels" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can delete group member labels" ON "public"."group_member_labels" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can delete group members" ON "public"."group_members" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can delete team members" ON "public"."team_members" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "team_members"."team_id") AND ("t"."org_id" = "team_members"."org_id") AND "public"."is_group_leader"("t"."group_id")))))));



CREATE POLICY "Leaders and admins can delete teams" ON "public"."teams" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can insert group labels" ON "public"."group_labels" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can insert group member labels" ON "public"."group_member_labels" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can insert group members" ON "public"."group_members" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can insert team members" ON "public"."team_members" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "team_members"."team_id") AND ("t"."org_id" = "team_members"."org_id") AND "public"."is_group_leader"("t"."group_id")))))));



CREATE POLICY "Leaders and admins can insert teams" ON "public"."teams" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can revoke group invites" ON "public"."group_invites" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id")))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("revoked_at" IS NOT NULL) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can update group labels" ON "public"."group_labels" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id")))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can update group members" ON "public"."group_members" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id")))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can update groups" ON "public"."groups" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("id")))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("id"))));



CREATE POLICY "Leaders and admins can update team members" ON "public"."team_members" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "team_members"."team_id") AND ("t"."org_id" = "team_members"."org_id") AND "public"."is_group_leader"("t"."group_id"))))))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "team_members"."team_id") AND ("t"."org_id" = "team_members"."org_id") AND "public"."is_group_leader"("t"."group_id")))))));



CREATE POLICY "Leaders and admins can update teams" ON "public"."teams" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id")))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can view group invite uses" ON "public"."group_invite_uses" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Leaders and admins can view group invites" ON "public"."group_invites" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Members and admins can view group labels" ON "public"."group_labels" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_member"("group_id"))));



CREATE POLICY "Members and admins can view group member labels" ON "public"."group_member_labels" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_member"("group_id"))));



CREATE POLICY "Members and admins can view group members" ON "public"."group_members" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (("profile_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_group_member"("group_id") OR ( SELECT "public"."is_admin"() AS "is_admin"))));



CREATE POLICY "Members and admins can view groups" ON "public"."groups" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_member"("id"))));



CREATE POLICY "Members can create own subscription token" ON "public"."calendar_subscription_tokens" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "auth"."uid"() AS "uid") = "user_id")));



CREATE POLICY "Members can delete own rsvps" ON "public"."rsvps" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can insert own rsvps on visible events" ON "public"."rsvps" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "rsvps"."event_id") AND ("e"."org_id" = "rsvps"."org_id"))))));



CREATE POLICY "Members can read settings" ON "public"."site_settings" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_member"() AS "is_member")));



CREATE POLICY "Members can request a group under approval mode" ON "public"."group_requests" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("requested_by" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "public"."is_member"() AS "is_member") AND ("status" = 'pending'::"text") AND ("reviewed_by" IS NULL) AND ("reviewed_at" IS NULL) AND ("group_id" IS NULL) AND (( SELECT "public"."org_group_creation_policy"() AS "org_group_creation_policy") = 'approval'::"text")));



CREATE POLICY "Members can submit their own feedback" ON "public"."feedback" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "auth"."uid"() AS "uid") = "profile_id") AND ( SELECT "public"."is_member"() AS "is_member")));



CREATE POLICY "Members can update own rsvps on visible events" ON "public"."rsvps" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "rsvps"."event_id") AND ("e"."org_id" = "rsvps"."org_id")))))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "rsvps"."event_id") AND ("e"."org_id" = "rsvps"."org_id"))))));



CREATE POLICY "Members can update own subscription token" ON "public"."calendar_subscription_tokens" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "auth"."uid"() AS "uid") = "user_id"))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "auth"."uid"() AS "uid") = "user_id")));



CREATE POLICY "Members can view attendees of visible signups" ON "public"."serving_signup_attendees" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (EXISTS ( SELECT 1
   FROM "public"."serving_signups" "s"
  WHERE (("s"."id" = "serving_signup_attendees"."signup_id") AND ("s"."org_id" = "serving_signup_attendees"."org_id"))))));



CREATE POLICY "Members can view family invites" ON "public"."family_invites" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ( SELECT "public"."is_member"() AS "is_member")));



CREATE POLICY "Members can view family members" ON "public"."family_members" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (("family_id" = ( SELECT "public"."current_family_id"() AS "current_family_id")) AND ( SELECT "public"."is_member"() AS "is_member")) OR (( SELECT "public"."is_member"() AS "is_member") AND (( SELECT "public"."org_directory_visible"() AS "org_directory_visible") OR "public"."shares_group_with_household"("family_id"))))));



CREATE POLICY "Members can view family units" ON "public"."family_units" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "public"."is_admin"() AS "is_admin") OR (("id" = ( SELECT "public"."current_family_id"() AS "current_family_id")) AND ( SELECT "public"."is_member"() AS "is_member")) OR (( SELECT "public"."is_member"() AS "is_member") AND (( SELECT "public"."org_directory_visible"() AS "org_directory_visible") OR "public"."shares_group_with_household"("id"))))));



CREATE POLICY "Members can view own subscription token" ON "public"."calendar_subscription_tokens" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (( SELECT "auth"."uid"() AS "uid") = "user_id")));



CREATE POLICY "Members can view rsvps on visible events" ON "public"."rsvps" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "rsvps"."event_id") AND ("e"."org_id" = "rsvps"."org_id"))))));



CREATE POLICY "Members can withdraw own prayer responses" ON "public"."prayer_responses" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("profile_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Org readable within request org" ON "public"."organizations" FOR SELECT TO "authenticated", "anon" USING (("id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "Owners, team leads and group leaders can delete serving signups" ON "public"."serving_signups" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_team_lead"("team_id") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "serving_signups"."team_id") AND ("t"."org_id" = "serving_signups"."org_id") AND "public"."is_group_leader"("t"."group_id")))))));



CREATE POLICY "Posters and group leaders can delete prayer requests" ON "public"."prayer_requests" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (("author_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Posters and group leaders can update prayer requests" ON "public"."prayer_requests" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (("author_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_group_leader"("group_id")))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND "public"."is_group_member"("group_id") AND (("author_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Profiles are updatable per access rules" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ((( SELECT "auth"."uid"() AS "uid") = "id") OR ( SELECT "public"."is_admin"() AS "is_admin") OR ((( SELECT "auth"."uid"() AS "uid") <> "id") AND ("family_id" IS NOT NULL) AND ("family_id" = ( SELECT "public"."current_family_id"() AS "current_family_id")) AND ( SELECT "public"."is_household_manager"() AS "is_household_manager"))))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (((( SELECT "auth"."uid"() AS "uid") = "id") AND ("role" = ( SELECT "public"."get_own_role"() AS "get_own_role")) AND (NOT ("email" IS DISTINCT FROM ( SELECT "public"."get_own_email"() AS "get_own_email")))) OR ( SELECT "public"."is_admin"() AS "is_admin") OR (("family_id" = ( SELECT "public"."current_family_id"() AS "current_family_id")) AND ("role" = "public"."get_profile_role"("id")) AND (NOT ("email" IS DISTINCT FROM "public"."get_profile_email"("id")))))));



CREATE POLICY "Profiles are visible per access rules" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ((( SELECT "auth"."uid"() AS "uid") = "id") OR ( SELECT "public"."is_admin"() AS "is_admin") OR (("family_id" IS NOT NULL) AND ("family_id" = ( SELECT "public"."current_family_id"() AS "current_family_id")) AND (( SELECT "auth"."uid"() AS "uid") <> "id") AND ( SELECT "public"."is_member"() AS "is_member")) OR (( SELECT "public"."is_member"() AS "is_member") AND ("is_unlisted" = false) AND ("role" = ANY (ARRAY['member'::"text", 'admin'::"text"])) AND (( SELECT "public"."org_directory_visible"() AS "org_directory_visible") OR "public"."shares_group_with"("id"))))));



CREATE POLICY "Requesters and admins can view group requests" ON "public"."group_requests" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (("requested_by" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin"))));



CREATE POLICY "Requesters, leaders and admins can view join requests" ON "public"."group_join_requests" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (("profile_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin") OR "public"."is_group_leader"("group_id"))));



CREATE POLICY "Signup owners can remove attendees" ON "public"."serving_signup_attendees" FOR DELETE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND (EXISTS ( SELECT 1
   FROM "public"."serving_signups" "s"
  WHERE (("s"."id" = "serving_signup_attendees"."signup_id") AND ("s"."org_id" = "serving_signup_attendees"."org_id") AND (("s"."created_by" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_team_lead"("s"."team_id") OR (EXISTS ( SELECT 1
           FROM "public"."teams" "t"
          WHERE (("t"."id" = "s"."team_id") AND ("t"."org_id" = "s"."org_id") AND "public"."is_group_leader"("t"."group_id"))))))))));



CREATE POLICY "Team leads and group leaders can insert serving settings" ON "public"."serving_team_settings" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("public"."is_team_lead"("team_id") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "serving_team_settings"."team_id") AND ("t"."org_id" = "serving_team_settings"."org_id") AND "public"."is_group_leader"("t"."group_id")))))));



CREATE POLICY "Team leads and group leaders can log serving broadcasts" ON "public"."serving_broadcasts" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("sent_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("public"."is_team_lead"("team_id") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "serving_broadcasts"."team_id") AND ("t"."org_id" = "serving_broadcasts"."org_id") AND "public"."is_group_leader"("t"."group_id")))))));



CREATE POLICY "Team leads and group leaders can update serving settings" ON "public"."serving_team_settings" FOR UPDATE TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("public"."is_team_lead"("team_id") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "serving_team_settings"."team_id") AND ("t"."org_id" = "serving_team_settings"."org_id") AND "public"."is_group_leader"("t"."group_id"))))))) WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("public"."is_team_lead"("team_id") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "serving_team_settings"."team_id") AND ("t"."org_id" = "serving_team_settings"."org_id") AND "public"."is_group_leader"("t"."group_id")))))));



CREATE POLICY "Team leads and group leaders can view serving broadcasts" ON "public"."serving_broadcasts" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("public"."is_team_lead"("team_id") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "serving_broadcasts"."team_id") AND ("t"."org_id" = "serving_broadcasts"."org_id") AND "public"."is_group_leader"("t"."group_id")))))));



CREATE POLICY "Team members and group leaders can create serving signups" ON "public"."serving_signups" FOR INSERT TO "authenticated" WITH CHECK ((("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("public"."is_team_lead"("team_id") OR (EXISTS ( SELECT 1
   FROM "public"."team_members" "tm"
  WHERE (("tm"."profile_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("tm"."team_id" = "serving_signups"."team_id")))) OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "serving_signups"."team_id") AND ("t"."org_id" = "serving_signups"."org_id") AND "public"."is_group_leader"("t"."group_id")))))));



ALTER TABLE "public"."about_page" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."access_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."announcements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calendar_subscription_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."class_teachers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_calendars" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."family_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."family_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."family_units" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."giving_fund_methods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."giving_funds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_invite_uses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_join_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_labels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_member_labels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lecture_series" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lectures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "members can view their own org memberships" ON "public"."organization_members" FOR SELECT USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "org isolation" ON "public"."about_page" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."access_requests" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."announcements" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."calendar_subscription_tokens" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."class_teachers" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."event_calendars" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."events" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."family_invites" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."family_members" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."family_units" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."feedback" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."giving_fund_methods" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."giving_funds" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."group_invite_uses" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."group_invites" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."group_join_requests" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."group_labels" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."group_member_labels" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."group_members" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."group_requests" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."group_settings" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."groups" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."lecture_series" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."lectures" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."org_domain_worker_events" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."org_domains" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."org_email_domains" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."org_email_limits" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."org_email_usage" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."organization_members" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."organizations" AS RESTRICTIVE TO "authenticated", "anon" USING (("id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."prayer_call_sessions" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."prayer_requests" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."prayer_responses" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."profiles" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."rsvps" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."serving_broadcasts" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."serving_signup_attendees" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."serving_signups" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."serving_team_settings" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."site_settings" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."team_members" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org isolation" ON "public"."teams" AS RESTRICTIVE TO "authenticated", "anon" USING (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id"))) WITH CHECK (("org_id" = ( SELECT "public"."app_request_org_id"() AS "app_request_org_id")));



CREATE POLICY "org members can view their orgs" ON "public"."organizations" FOR SELECT USING ("public"."is_org_member"("id"));



ALTER TABLE "public"."org_domain_worker_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_domains" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_email_domains" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_email_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_email_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platform admins can view platform admins" ON "public"."platform_admins" FOR SELECT USING (( SELECT "public"."is_platform_admin"() AS "is_platform_admin"));



ALTER TABLE "public"."platform_admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prayer_call_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prayer_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prayer_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rsvps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."serving_broadcasts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."serving_signup_attendees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."serving_signups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."serving_team_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."app_current_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."app_current_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_current_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."app_request_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."app_request_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_request_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_family_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_family_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_family_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."discoverable_groups"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."discoverable_groups"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."discoverable_groups"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."email_quota_consume"("_org_id" "uuid", "_n" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."email_quota_consume"("_org_id" "uuid", "_n" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_own_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_own_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_own_email"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_own_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_own_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_own_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_profile_email"("profile_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_profile_email"("profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_profile_email"("profile_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_profile_role"("profile_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_profile_role"("profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_profile_role"("profile_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."giving_can_manage_fund"("_fund_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."giving_can_manage_fund"("_fund_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."giving_can_manage_fund"("_fund_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."giving_stewards_can_manage"() TO "anon";
GRANT ALL ON FUNCTION "public"."giving_stewards_can_manage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."giving_stewards_can_manage"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."group_content_backfill"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."group_create"("_name" "text", "_description" "text", "_leader_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."group_create"("_name" "text", "_description" "text", "_leader_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."group_create"("_name" "text", "_description" "text", "_leader_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."group_create_for"("_org" "uuid", "_name" "text", "_description" "text", "_leader" "uuid", "_created_by" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."group_invite_join"("_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."group_invite_join"("_token" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."group_invite_redeem"("_token" "uuid", "_name" "text", "_email" "text", "_signup_token" "text", "_token_expires_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."group_invite_redeem"("_token" "uuid", "_name" "text", "_email" "text", "_signup_token" "text", "_token_expires_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."group_member_removed_leaves_teams"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."group_member_removed_leaves_teams"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."group_model_backfill"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."group_request_approve"("_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."group_request_approve"("_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."group_request_approve"("_request_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_auth_user_email_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_auth_user_email_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_auth_user_email_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_group_leader"("_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_group_leader"("_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_group_leader"("_group_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_group_member"("_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_group_member"("_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_group_member"("_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_household_manager"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_household_manager"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_household_manager"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_member"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_org_member"("_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_org_member"("_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_member"("_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_platform_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_platform_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_platform_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_team_lead"("_team_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_team_lead"("_team_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_team_lead"("_team_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_group"("_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_group"("_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_group"("_group_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_group_apply"("_group_id" "uuid", "_actor_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."org_directory_visible"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."org_directory_visible"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."org_directory_visible"() TO "service_role";



GRANT ALL ON TABLE "public"."org_email_domains" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."org_email_domains" TO "authenticated";



GRANT INSERT("domain") ON TABLE "public"."org_email_domains" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."org_email_domain_claim"("_org_id" "uuid", "_domain" "text", "_cap" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."org_email_domain_claim"("_org_id" "uuid", "_domain" "text", "_cap" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."org_group_creation_policy"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."org_group_creation_policy"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."org_group_creation_policy"() TO "service_role";



GRANT ALL ON FUNCTION "public"."organizations_timezone_check"() TO "anon";
GRANT ALL ON FUNCTION "public"."organizations_timezone_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."organizations_timezone_check"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."pending_group_join_requests"("_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pending_group_join_requests"("_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pending_group_join_requests"("_group_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."provision_organization"("_name" "text", "_owner_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."provision_organization"("_name" "text", "_owner_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_group_join_request"("_request_id" "uuid", "_approve" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_group_join_request"("_request_id" "uuid", "_approve" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."review_group_join_request"("_request_id" "uuid", "_approve" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."serving_signup_apply"("_group_id" "uuid", "_service_date" "date", "_actor_id" "uuid", "_attendee_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."serving_signup_apply"("_group_id" "uuid", "_service_date" "date", "_actor_id" "uuid", "_attendee_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."serving_signup_create"("_group_id" "uuid", "_service_date" "date", "_attendee_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."serving_signup_create"("_group_id" "uuid", "_service_date" "date", "_attendee_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."serving_signup_create"("_group_id" "uuid", "_service_date" "date", "_attendee_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."shares_group_with"("_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."shares_group_with"("_profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."shares_group_with"("_profile_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."shares_group_with_household"("_family_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."shares_group_with_household"("_family_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."shares_group_with_household"("_family_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."team_member_requires_group_membership"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."team_member_requires_group_membership"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."team_moved_prunes_members"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."team_moved_prunes_members"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."about_page" TO "anon";
GRANT ALL ON TABLE "public"."about_page" TO "authenticated";
GRANT ALL ON TABLE "public"."about_page" TO "service_role";



GRANT ALL ON TABLE "public"."access_requests" TO "anon";
GRANT ALL ON TABLE "public"."access_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."access_requests" TO "service_role";



GRANT ALL ON TABLE "public"."announcements" TO "anon";
GRANT ALL ON TABLE "public"."announcements" TO "authenticated";
GRANT ALL ON TABLE "public"."announcements" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_subscription_tokens" TO "anon";
GRANT ALL ON TABLE "public"."calendar_subscription_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_subscription_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."class_teachers" TO "anon";
GRANT ALL ON TABLE "public"."class_teachers" TO "authenticated";
GRANT ALL ON TABLE "public"."class_teachers" TO "service_role";



GRANT ALL ON TABLE "public"."event_calendars" TO "anon";
GRANT ALL ON TABLE "public"."event_calendars" TO "authenticated";
GRANT ALL ON TABLE "public"."event_calendars" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."family_units" TO "anon";
GRANT ALL ON TABLE "public"."family_units" TO "authenticated";
GRANT ALL ON TABLE "public"."family_units" TO "service_role";



GRANT ALL ON TABLE "public"."families_directory" TO "anon";
GRANT ALL ON TABLE "public"."families_directory" TO "authenticated";
GRANT ALL ON TABLE "public"."families_directory" TO "service_role";



GRANT ALL ON TABLE "public"."family_members" TO "anon";
GRANT ALL ON TABLE "public"."family_members" TO "authenticated";
GRANT ALL ON TABLE "public"."family_members" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."families_directory_full" TO "anon";
GRANT ALL ON TABLE "public"."families_directory_full" TO "authenticated";
GRANT ALL ON TABLE "public"."families_directory_full" TO "service_role";



GRANT ALL ON TABLE "public"."family_invites" TO "anon";
GRANT ALL ON TABLE "public"."family_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."family_invites" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."giving_fund_methods" TO "anon";
GRANT ALL ON TABLE "public"."giving_fund_methods" TO "authenticated";
GRANT ALL ON TABLE "public"."giving_fund_methods" TO "service_role";



GRANT ALL ON TABLE "public"."giving_funds" TO "anon";
GRANT ALL ON TABLE "public"."giving_funds" TO "authenticated";
GRANT ALL ON TABLE "public"."giving_funds" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."group_invite_uses" TO "authenticated";
GRANT ALL ON TABLE "public"."group_invite_uses" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."group_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."group_invites" TO "service_role";



GRANT UPDATE("revoked_at") ON TABLE "public"."group_invites" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."group_join_requests" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."group_join_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."group_join_requests" TO "service_role";



GRANT ALL ON TABLE "public"."group_labels" TO "anon";
GRANT ALL ON TABLE "public"."group_labels" TO "authenticated";
GRANT ALL ON TABLE "public"."group_labels" TO "service_role";



GRANT ALL ON TABLE "public"."group_member_labels" TO "anon";
GRANT ALL ON TABLE "public"."group_member_labels" TO "authenticated";
GRANT ALL ON TABLE "public"."group_member_labels" TO "service_role";



GRANT ALL ON TABLE "public"."group_members" TO "anon";
GRANT ALL ON TABLE "public"."group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."group_members" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."group_requests" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."group_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."group_requests" TO "service_role";



GRANT UPDATE("status") ON TABLE "public"."group_requests" TO "authenticated";



GRANT UPDATE("reviewed_by") ON TABLE "public"."group_requests" TO "authenticated";



GRANT UPDATE("reviewed_at") ON TABLE "public"."group_requests" TO "authenticated";



GRANT ALL ON TABLE "public"."group_settings" TO "anon";
GRANT ALL ON TABLE "public"."group_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."group_settings" TO "service_role";



GRANT ALL ON TABLE "public"."groups" TO "anon";
GRANT ALL ON TABLE "public"."groups" TO "authenticated";
GRANT ALL ON TABLE "public"."groups" TO "service_role";



GRANT ALL ON TABLE "public"."lecture_series" TO "anon";
GRANT ALL ON TABLE "public"."lecture_series" TO "authenticated";
GRANT ALL ON TABLE "public"."lecture_series" TO "service_role";



GRANT ALL ON TABLE "public"."lectures" TO "anon";
GRANT ALL ON TABLE "public"."lectures" TO "authenticated";
GRANT ALL ON TABLE "public"."lectures" TO "service_role";



GRANT ALL ON TABLE "public"."org_domain_worker_events" TO "service_role";



GRANT ALL ON TABLE "public"."org_domains" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."org_domains" TO "authenticated";



GRANT INSERT("domain") ON TABLE "public"."org_domains" TO "authenticated";



GRANT ALL ON TABLE "public"."org_email_limits" TO "service_role";



GRANT ALL ON TABLE "public"."org_email_usage" TO "service_role";



GRANT ALL ON TABLE "public"."organization_members" TO "anon";
GRANT ALL ON TABLE "public"."organization_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_members" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organizations" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."organizations" TO "authenticated";
GRANT SELECT("id") ON TABLE "public"."organizations" TO "anon";



GRANT SELECT("name") ON TABLE "public"."organizations" TO "authenticated";



GRANT SELECT("branding") ON TABLE "public"."organizations" TO "authenticated";
GRANT SELECT("branding") ON TABLE "public"."organizations" TO "anon";



GRANT SELECT("directory_visibility"),UPDATE("directory_visibility") ON TABLE "public"."organizations" TO "authenticated";



GRANT SELECT("group_creation_policy"),UPDATE("group_creation_policy") ON TABLE "public"."organizations" TO "authenticated";



GRANT SELECT("group_discovery"),UPDATE("group_discovery") ON TABLE "public"."organizations" TO "authenticated";



GRANT SELECT("timezone"),UPDATE("timezone") ON TABLE "public"."organizations" TO "authenticated";



GRANT ALL ON TABLE "public"."platform_admins" TO "anon";
GRANT ALL ON TABLE "public"."platform_admins" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_admins" TO "service_role";



GRANT ALL ON TABLE "public"."prayer_call_sessions" TO "anon";
GRANT ALL ON TABLE "public"."prayer_call_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."prayer_call_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."prayer_requests" TO "anon";
GRANT ALL ON TABLE "public"."prayer_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."prayer_requests" TO "service_role";



GRANT ALL ON TABLE "public"."prayer_responses" TO "anon";
GRANT ALL ON TABLE "public"."prayer_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."prayer_responses" TO "service_role";



GRANT ALL ON TABLE "public"."prayer_wall" TO "anon";
GRANT ALL ON TABLE "public"."prayer_wall" TO "authenticated";
GRANT ALL ON TABLE "public"."prayer_wall" TO "service_role";



GRANT ALL ON TABLE "public"."profiles_directory" TO "anon";
GRANT ALL ON TABLE "public"."profiles_directory" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles_directory" TO "service_role";



GRANT ALL ON TABLE "public"."rsvps" TO "anon";
GRANT ALL ON TABLE "public"."rsvps" TO "authenticated";
GRANT ALL ON TABLE "public"."rsvps" TO "service_role";



GRANT ALL ON TABLE "public"."serving_broadcasts" TO "anon";
GRANT ALL ON TABLE "public"."serving_broadcasts" TO "authenticated";
GRANT ALL ON TABLE "public"."serving_broadcasts" TO "service_role";



GRANT ALL ON TABLE "public"."serving_signup_attendees" TO "anon";
GRANT ALL ON TABLE "public"."serving_signup_attendees" TO "authenticated";
GRANT ALL ON TABLE "public"."serving_signup_attendees" TO "service_role";



GRANT ALL ON TABLE "public"."serving_signups" TO "anon";
GRANT ALL ON TABLE "public"."serving_signups" TO "authenticated";
GRANT ALL ON TABLE "public"."serving_signups" TO "service_role";



GRANT ALL ON TABLE "public"."serving_team_settings" TO "anon";
GRANT ALL ON TABLE "public"."serving_team_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."serving_team_settings" TO "service_role";



GRANT ALL ON TABLE "public"."site_settings" TO "anon";
GRANT ALL ON TABLE "public"."site_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."site_settings" TO "service_role";



GRANT ALL ON TABLE "public"."team_members" TO "anon";
GRANT ALL ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";



GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







