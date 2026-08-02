-- Transactional serving signup RPC (CWA-47 / #313).
--
-- Serving signup wrote its two rows — serving_signups, then
-- serving_signup_attendees — as two separate PostgREST statements from the
-- app layer, with a compensating delete on failure. The compensating delete
-- can itself fail, and serving_signups is unique (group_id, service_date),
-- so an orphaned signup row wedges that Sunday at 409 for everyone until a
-- manual DB delete. PostgREST has no client-side transaction, so a database
-- function is the only transaction boundary available: both inserts now
-- commit together or not at all.
--
-- SECURITY DEFINER bypasses RLS, so the org checks in these bodies ARE the
-- tenant boundary on this surface. schema_tenancy_lint.sql (check 4) can
-- only assert the source mentions org_id — the resolution order below (org
-- resolved from the member_groups row, never a caller parameter; every
-- other row asserted to carry that same org_id) is review-enforced, not
-- lint-enforced. See docs/security/tenancy-model.md.
--
-- Error contract (SQLSTATEs the routes map to HTTP statuses):
--   SV001  Sunday already claimed by a DIFFERENT member            → 409
--   SV002  unknown group, cross-org actor/attendee, NULL org, or
--          attendee outside the actor's household                  → 400
--   SV003  serving signups not enabled for the team                → 404/400
--   SV004  actor is not a member/leader/admin of the team          → 403

-- Core: the atomic insert pair. service_role only — the HMAC signed-link
-- route (app/api/serving/link-action/route.ts) has no session, so it passes
-- the HMAC-validated profile id as _actor_id explicitly. The authenticated
-- wrapper below reaches it too: under SECURITY DEFINER the inner EXECUTE is
-- checked against the wrapper's owner, not the session role.
create or replace function public.serving_signup_apply(
  _group_id     uuid,
  _service_date date,
  _actor_id     uuid,
  _attendee_ids uuid[]
) returns table (signup_id uuid, signup_org_id uuid, created boolean)
  language plpgsql security definer set search_path = ''
as $$
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
  -- The org comes from the group row, never from the caller. A cross-org
  -- _group_id resolves to a real org here, and the actor's own profile then
  -- fails the equality check below — there is no caller-supplied org to
  -- subvert.
  select g.org_id into _org
  from public.member_groups g
  where g.id = _group_id;

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

  -- Household rule, enforced here rather than only in the routes (deliberate
  -- defence in depth — the route copy at signups/route.ts:97-109 stays for the
  -- specific 400 message and to fail before a round trip): every attendee is
  -- the actor, or shares the actor's non-null household with relationship
  -- primary/spouse — and carries the group's org_id. NOTE this constrains the
  -- RPC path only: the "Signup owners can add attendees" INSERT policy
  -- (20260731000008_rls_serving.sql:59-74) still lets a signup owner attach any
  -- same-org profile via direct PostgREST, with no household predicate.
  -- Narrowing that policy is follow-up work, not closed here.
  -- count(*) over the DISTINCT subquery (not count(distinct ...)) so a NULL
  -- element still counts on the total side and fails the comparison.
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
  where sts.group_id = _group_id
    and sts.org_id = _org;

  if not coalesce(_enabled, false) then
    raise exception 'serving signups not enabled for group %', _group_id
      using errcode = 'SV003';
  end if;

  -- unique (group_id, service_date) is the race guard. DO NOTHING (not
  -- DO UPDATE) so "who already holds this Sunday" is an explicit branch:
  -- the same member re-signing is an idempotent no-op (created = false), a
  -- different member gets SV001. FOR UPDATE serialises two concurrent
  -- re-signups on the existing row.
  insert into public.serving_signups (org_id, group_id, service_date, family_id, created_by)
  values (_org, _group_id, _service_date, _family_id, _actor_id)
  on conflict (group_id, service_date) do nothing
  returning id into _signup_id;

  if _signup_id is null then
    select s.id, s.created_by into _signup_id, _existing_by
    from public.serving_signups s
    where s.group_id = _group_id
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

-- Authenticated entry point for app/api/serving/signups/route.ts. Derives
-- the actor from auth.uid(), pins the group's org against
-- app_request_org_id() — the same anchor the RLS WITH CHECK evaluates,
-- fail-closed on NULL via IS DISTINCT FROM — then re-checks the arms of the
-- "Members can create serving signups" INSERT policy
-- (20260731000008_rls_serving.sql:21-36) before delegating to the core.
create or replace function public.serving_signup_create(
  _group_id     uuid,
  _service_date date,
  _attendee_ids uuid[]
) returns table (signup_id uuid, signup_org_id uuid, created boolean)
  language plpgsql security definer set search_path = ''
as $$
declare
  _actor uuid;
  _org uuid;
begin
  _actor := auth.uid();
  if _actor is null then
    raise exception 'serving signup rejected: no authenticated principal'
      using errcode = 'SV002';
  end if;

  select g.org_id into _org
  from public.member_groups g
  where g.id = _group_id;

  if _org is null or _org is distinct from public.app_request_org_id() then
    raise exception 'serving signup rejected: group % does not resolve to the request org', _group_id
      using errcode = 'SV002';
  end if;

  -- The RLS INSERT policy's arms, re-implemented because SECURITY DEFINER
  -- bypasses the policy. Bare helper calls are correct here — the
  -- (select ...) InitPlan rule applies to policy expressions only.
  if not (
    public.is_admin()
    or public.is_group_leader(_group_id)
    or exists (
      select 1 from public.profile_groups pg
      where pg.profile_id = _actor
        and pg.group_id = _group_id
        and pg.org_id = _org
    )
  ) then
    raise exception 'serving signup rejected: actor % is not on team %', _actor, _group_id
      using errcode = 'SV004';
  end if;

  return query
  select * from public.serving_signup_apply(_group_id, _service_date, _actor, _attendee_ids);
end;
$$;

-- Grants: the discrimination between the two callers is by grant, auditable
-- in pg_proc.proacl and asserted in supabase/tests/serving_signup_rpc_suite.sql.
-- No anon grant on either — both signed-link routes run server-side on the
-- service-role client, so the browser never reaches Postgres for these
-- actions. Stated explicitly, mirroring provision_organization
-- (20260802000002).
revoke execute on function public.serving_signup_apply(uuid, date, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.serving_signup_apply(uuid, date, uuid, uuid[])
  to service_role;

revoke execute on function public.serving_signup_create(uuid, date, uuid[])
  from public, anon;
grant execute on function public.serving_signup_create(uuid, date, uuid[])
  to authenticated, service_role;

comment on function public.serving_signup_apply(uuid, date, uuid, uuid[]) is
  'Atomic serving signup + attendee insert pair (CWA-47 / #313). Tenant anchor: org_id resolved from the member_groups row named by _group_id, never a caller parameter; every other row is asserted to carry it. service_role only — the HMAC signed-link route passes its validated profile id as _actor_id.';

comment on function public.serving_signup_create(uuid, date, uuid[]) is
  'Authenticated serving signup entry point (CWA-47 / #313). Actor from auth.uid(); tenant anchor: the group''s org pinned against app_request_org_id(), fail-closed on NULL; the RLS INSERT-policy arms are re-checked before delegating to serving_signup_apply().';
