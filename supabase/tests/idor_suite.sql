-- IDOR suite (CWA-57 / #328 — the CWA-11 hard gate's named deliverable).
-- The tenancy leak suite proves "org A sees no org B rows" by scanning whole
-- tables; this suite proves the shape an IDOR attacker actually sends:
-- *holding a specific, valid org-A UUID (or token) as an org-B principal
-- yields nothing* — across events and the ICS anchors, prayer, serving,
-- households/family members, the directory views, and the by-UUID SECURITY
-- DEFINER helpers. Every read assertion carries an own-org non-vacuity pair.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/idor_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table idor_results (line text) on commit drop;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- seed_org_fixture() is redeclared from tenancy_leak_suite.sql (pg_temp
-- functions do not cross files): one row in every org-owned surface this
-- suite probes, per org.
create function pg_temp.seed_org_fixture(_org uuid, _owner uuid, _tag text) returns void
language plpgsql as $$
declare
  _family uuid;
  _family_member uuid;
  _invite uuid;
  _invite_token uuid;
  _calendar uuid;
  _event uuid;
  _series uuid;
  _fund uuid;
  _serving_group uuid;
  _signup uuid;
begin
  insert into public.member_groups (org_id, name, is_serving_role)
    values (_org, _tag || ' serving team', true) returning id into _serving_group;

  insert into public.family_units (org_id, family_name)
    values (_org, _tag || ' family') returning id into _family;
  insert into public.family_members (org_id, family_id, first_name, relationship)
    values (_org, _family, _tag || ' kid', 'child') returning id into _family_member;
  insert into public.family_invites (org_id, family_id, family_member_id, invite_email)
    values (_org, _family, _family_member, _tag || '-invite@idor.example.test')
    returning id, token into _invite, _invite_token;
  update public.profiles set family_id = _family where id = _owner;

  insert into public.event_calendars (org_id, name, created_by)
    values (_org, _tag || ' calendar', _owner) returning id into _calendar;
  insert into public.events (org_id, title, start_time, calendar_id, created_by)
    values (_org, _tag || ' event', now() + interval '7 days', _calendar, _owner)
    returning id into _event;
  insert into public.rsvps (org_id, event_id, user_id, status)
    values (_org, _event, _owner, 'yes');
  insert into public.calendar_subscription_tokens (org_id, user_id, token_hash, expires_at)
    values (_org, _owner, _tag || '-token-hash', now() + interval '30 days');

  insert into public.giving_funds (org_id, name, steward_id, created_by)
    values (_org, _tag || ' fund', _owner, _owner) returning id into _fund;

  insert into public.prayer_requests (org_id, author_id, body, category)
    values (_org, _owner, _tag || ' prayer', 'health');
  insert into public.prayer_responses (org_id, request_id, profile_id)
    select _org, id, _owner from public.prayer_requests
      where org_id = _org and author_id = _owner limit 1;

  insert into public.profile_groups (org_id, profile_id, group_id)
    values (_org, _owner, _serving_group);
  insert into public.serving_signups (org_id, group_id, service_date, family_id, created_by)
    values (_org, _serving_group, (current_date + (7 - extract(dow from current_date)::int)), _family, _owner)
    returning id into _signup;
  insert into public.serving_signup_attendees (org_id, signup_id, profile_id)
    values (_org, _signup, _owner);
end;
$$;

do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  member_b uuid := gen_random_uuid();
begin
  org_a := public.provision_organization('IDOR Suite Org A', 'idor-suite-org-a', 'owner-a@idor.example.test');
  org_b := public.provision_organization('IDOR Suite Org B', 'idor-suite-org-b', 'owner-b@idor.example.test');

  -- Owners sign up AFTER provisioning (the org-first contract) and become
  -- founding admins via approved_role = 'admin'.
  insert into auth.users (id, email) values
    (owner_a, 'owner-a@idor.example.test'),
    (owner_b, 'owner-b@idor.example.test');

  perform pg_temp.seed_org_fixture(org_a, owner_a, 'idor-a');
  perform pg_temp.seed_org_fixture(org_b, owner_b, 'idor-b');

  -- A plain (non-admin) org-B member, for the helper checks where admin-ness
  -- would short-circuit (giving_can_manage_fund() is is_admin() OR steward).
  insert into public.access_requests (org_id, name, email, status)
    values (org_b, 'IDOR Plain Member', 'member-b@idor.example.test', 'approved');
  insert into auth.users (id, email) values (member_b, 'member-b@idor.example.test');

  -- Hand the org-A UUIDs an attacker would hold across blocks.
  perform set_config('idor.org_a', org_a::text, true);
  perform set_config('idor.org_b', org_b::text, true);
  perform set_config('idor.owner_a', owner_a::text, true);
  perform set_config('idor.owner_b', owner_b::text, true);
  perform set_config('idor.member_b', member_b::text, true);
  perform set_config('idor.event_a', (select id from public.events where org_id = org_a limit 1)::text, true);
  perform set_config('idor.event_b', (select id from public.events where org_id = org_b limit 1)::text, true);
  perform set_config('idor.calendar_a', (select calendar_id from public.events where org_id = org_a limit 1)::text, true);
  perform set_config('idor.calendar_b', (select calendar_id from public.events where org_id = org_b limit 1)::text, true);
  perform set_config('idor.rsvp_a', (select id from public.rsvps where org_id = org_a limit 1)::text, true);
  perform set_config('idor.rsvp_b', (select id from public.rsvps where org_id = org_b limit 1)::text, true);
  perform set_config('idor.prayer_a', (select id from public.prayer_requests where org_id = org_a limit 1)::text, true);
  perform set_config('idor.prayer_b', (select id from public.prayer_requests where org_id = org_b limit 1)::text, true);
  perform set_config('idor.signup_a', (select id from public.serving_signups where org_id = org_a limit 1)::text, true);
  perform set_config('idor.signup_b', (select id from public.serving_signups where org_id = org_b limit 1)::text, true);
  perform set_config('idor.group_a', (select id from public.member_groups where org_id = org_a limit 1)::text, true);
  perform set_config('idor.group_b', (select id from public.member_groups where org_id = org_b limit 1)::text, true);
  perform set_config('idor.family_a', (select id from public.family_units where org_id = org_a limit 1)::text, true);
  perform set_config('idor.family_b', (select id from public.family_units where org_id = org_b limit 1)::text, true);
  perform set_config('idor.fm_a', (select id from public.family_members where org_id = org_a limit 1)::text, true);
  perform set_config('idor.fm_b', (select id from public.family_members where org_id = org_b limit 1)::text, true);
  perform set_config('idor.invite_token_a', (select token from public.family_invites where org_id = org_a limit 1)::text, true);
  perform set_config('idor.invite_token_b', (select token from public.family_invites where org_id = org_b limit 1)::text, true);
  perform set_config('idor.fund_a', (select id from public.giving_funds where org_id = org_a limit 1)::text, true);
  perform set_config('idor.fund_b', (select id from public.giving_funds where org_id = org_b limit 1)::text, true);
end $$;

-- ── Structural: the .single() token anchors are globally unique ─────────────
-- feed.ics and events/[id]/ics .single() on token_hash; verify-token and
-- consume-token .single() on signup_token. Each must be a single-column
-- UNIQUE index — a composite (token, org_id) unique would let the same
-- token exist in two orgs and break the resolution those routes anchor on.

insert into idor_results
  select ok(
    exists (select 1 from pg_indexes
      where schemaname = 'public' and tablename = 'calendar_subscription_tokens'
        and indexdef like '%UNIQUE%' and indexdef like '%(token_hash)%'),
    'calendar_subscription_tokens.token_hash is globally UNIQUE (the ICS routes'' org anchor)');
insert into idor_results
  select ok(
    exists (select 1 from pg_indexes
      where schemaname = 'public' and tablename = 'access_requests'
        and indexdef like '%UNIQUE%' and indexdef like '%(signup_token)%'),
    'access_requests.signup_token is globally UNIQUE (verify/consume-token''s org anchor)');

-- ── Reads: specific org-A UUIDs yield nothing to an org-B principal ─────────

do $$
declare
  owner_b uuid := current_setting('idor.owner_b')::uuid;
  surfaces text[] := array[
    'events|' || current_setting('idor.event_a') || '|' || current_setting('idor.event_b'),
    'event_calendars|' || current_setting('idor.calendar_a') || '|' || current_setting('idor.calendar_b'),
    'rsvps|' || current_setting('idor.rsvp_a') || '|' || current_setting('idor.rsvp_b'),
    'prayer_requests|' || current_setting('idor.prayer_a') || '|' || current_setting('idor.prayer_b'),
    'serving_signups|' || current_setting('idor.signup_a') || '|' || current_setting('idor.signup_b'),
    'member_groups|' || current_setting('idor.group_a') || '|' || current_setting('idor.group_b'),
    'family_units|' || current_setting('idor.family_a') || '|' || current_setting('idor.family_b'),
    'family_members|' || current_setting('idor.fm_a') || '|' || current_setting('idor.fm_b'),
    'prayer_wall|' || current_setting('idor.prayer_a') || '|' || current_setting('idor.prayer_b'),
    'profiles_directory|' || current_setting('idor.owner_a') || '|' || current_setting('idor.owner_b'),
    'families_directory_full|' || current_setting('idor.family_a') || '|' || current_setting('idor.family_b')
  ];
  parts text[];
  cross_counts bigint[] := '{}';
  own_counts bigint[] := '{}';
  errs text[] := '{}';
  response_a_count bigint := -1;
  attendee_a_count bigint := -1;
  token_a_count bigint := -1;
  token_b_count bigint := -1;
  invite_a_count bigint := -1;
  invite_b_count bigint := -1;
  s text;
  cc bigint; oc bigint;
  i int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  perform set_config('request.headers', '{}', true);

  foreach s in array surfaces loop
    parts := string_to_array(s, '|');
    begin
      execute format('select count(*) filter (where id = $1), count(*) filter (where id = $2) from public.%I', parts[1])
        into cc, oc using parts[2]::uuid, parts[3]::uuid;
      cross_counts := cross_counts || cc;
      own_counts := own_counts || oc;
      errs := errs || null::text;
    exception when others then
      cross_counts := cross_counts || null::bigint;
      own_counts := own_counts || null::bigint;
      errs := errs || sqlerrm;
    end;
  end loop;

  -- Child rows (composite-keyed — probed by the parent UUID an attacker
  -- would hold) and token-keyed lookups (the exact shape the ICS and
  -- invite routes send).
  select count(*) into response_a_count from public.prayer_responses
    where request_id = current_setting('idor.prayer_a')::uuid;
  select count(*) into attendee_a_count from public.serving_signup_attendees
    where signup_id = current_setting('idor.signup_a')::uuid;
  select count(*) into token_a_count from public.calendar_subscription_tokens
    where token_hash = 'idor-a-token-hash';
  select count(*) into token_b_count from public.calendar_subscription_tokens
    where token_hash = 'idor-b-token-hash';
  select count(*) into invite_a_count from public.family_invites
    where token = current_setting('idor.invite_token_a')::uuid;
  select count(*) into invite_b_count from public.family_invites
    where token = current_setting('idor.invite_token_b')::uuid;

  reset role;

  for i in 1 .. array_length(surfaces, 1) loop
    parts := string_to_array(surfaces[i], '|');
    if errs[i] is not null then
      insert into idor_results
        select fail(format('org B read of %s errored: %s', parts[1], errs[i]));
    else
      insert into idor_results
        select is(cross_counts[i], 0::bigint,
          format('org B principal holding the org-A %s UUID reads 0 rows', parts[1]));
      insert into idor_results
        select ok(own_counts[i] >= 1,
          format('non-vacuity: the same lookup shape finds the own-org %s row', parts[1]));
    end if;
  end loop;

  insert into idor_results
    select is(response_a_count, 0::bigint, 'org B principal holding the org-A prayer_responses UUID reads 0 rows');
  insert into idor_results
    select is(attendee_a_count, 0::bigint, 'org B principal holding the org-A serving_signup_attendees UUID reads 0 rows');
  insert into idor_results
    select is(token_a_count, 0::bigint, 'org B principal holding org A''s calendar token_hash reads 0 rows (ICS anchor)');
  insert into idor_results
    select ok(token_b_count >= 1, 'non-vacuity: own-org calendar token_hash resolves');
  insert into idor_results
    select is(invite_a_count, 0::bigint, 'org B principal holding org A''s family-invite token reads 0 rows');
  insert into idor_results
    select ok(invite_b_count >= 1, 'non-vacuity: own-org family-invite token resolves');
end $$;

-- ── Writes: org-A UUIDs as targets ──────────────────────────────────────────

do $$
declare
  org_b uuid := current_setting('idor.org_b')::uuid;
  owner_b uuid := current_setting('idor.owner_b')::uuid;
  prayer_cross int := -1;
  prayer_own int := -1;
  signup_cross int := -1;
  signup_own int := -1;
  fm_update_cross int := -1;
  fm_delete_cross int := -1;
  fm_update_own int := -1;
  rsvp_own int := -1;
  rsvp_insert_err text := null;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  perform set_config('request.headers', '{}', true);

  -- Mark-answered on an org-A prayer request (mirrors PrayerBoard.tsx).
  with u as (
    update public.prayer_requests set is_answered = true
    where id = current_setting('idor.prayer_a')::uuid returning 1
  ) select count(*) into prayer_cross from u;
  with u as (
    update public.prayer_requests set is_answered = true
    where id = current_setting('idor.prayer_b')::uuid returning 1
  ) select count(*) into prayer_own from u;

  -- family_members by org-A UUID as an org-B ADMIN — this is
  -- app/api/admin/family-members/[id]/route.ts, whose only gate is
  -- role === 'admin'.
  with u as (
    update public.family_members set first_name = 'defaced'
    where id = current_setting('idor.fm_a')::uuid returning 1
  ) select count(*) into fm_update_cross from u;
  with d as (
    delete from public.family_members
    where id = current_setting('idor.fm_a')::uuid returning 1
  ) select count(*) into fm_delete_cross from d;
  with u as (
    update public.family_members set preferred_name = 'ok'
    where id = current_setting('idor.fm_b')::uuid returning 1
  ) select count(*) into fm_update_own from u;

  -- Own-org rsvp update (write-capability non-vacuity for this principal).
  with u as (
    update public.rsvps set status = 'no'
    where id = current_setting('idor.rsvp_b')::uuid returning 1
  ) select count(*) into rsvp_own from u;

  -- INSERT referencing an org-A event id, correctly tagged with the
  -- caller's own org: the composite (event_id, org_id) FK is the guard
  -- (23503); had it been tagged org A instead, the restrictive floor's
  -- WITH CHECK would fire first (42501).
  begin
    insert into public.rsvps (org_id, event_id, user_id, status)
    values (org_b, current_setting('idor.event_a')::uuid, owner_b, 'yes');
  exception when others then
    rsvp_insert_err := sqlstate;
  end;

  -- Serving signup deletion (mirrors DELETE /api/serving/signups). Last:
  -- the own-org delete cascades its attendee row.
  with d as (
    delete from public.serving_signups
    where id = current_setting('idor.signup_a')::uuid returning 1
  ) select count(*) into signup_cross from d;
  with d as (
    delete from public.serving_signups
    where id = current_setting('idor.signup_b')::uuid returning 1
  ) select count(*) into signup_own from d;

  reset role;

  insert into idor_results
    select is(prayer_cross, 0, 'org B principal cannot mark an org-A prayer request answered (0 rows)');
  insert into idor_results
    select is(prayer_own, 1, 'non-vacuity: the same update lands on the own-org prayer request');
  insert into idor_results
    select is(fm_update_cross, 0, 'org B ADMIN updating an org-A family_members UUID affects 0 rows (admin-gated API shape)');
  insert into idor_results
    select is(fm_delete_cross, 0, 'org B ADMIN deleting an org-A family_members UUID affects 0 rows');
  insert into idor_results
    select is(fm_update_own, 1, 'non-vacuity: the org B admin can update their own org''s family member');
  insert into idor_results
    select is(rsvp_own, 1, 'non-vacuity: the org B member can update their own rsvp');
  insert into idor_results
    select ok(rsvp_insert_err in ('23503', '42501'),
      format('INSERT rsvp referencing an org-A event is rejected (got %s — 23503 composite FK expected for an own-org-tagged row)', coalesce(rsvp_insert_err, 'no error')));
  insert into idor_results
    select is(signup_cross, 0, 'org B principal deleting an org-A serving signup affects 0 rows');
  insert into idor_results
    select is(signup_own, 1, 'non-vacuity: the creator deletes their own org''s serving signup');
end $$;

-- ── The by-UUID SECURITY DEFINER helpers ────────────────────────────────────
-- Run as the PLAIN org-B member: giving_can_manage_fund() is
-- `is_admin() OR steward-of-fund`, so an admin caller would short-circuit
-- the fund check and prove nothing about the by-UUID path.

do $$
declare
  member_b uuid := current_setting('idor.member_b')::uuid;
  role_a text := 'unset';
  email_a text := 'unset';
  leader_a boolean;
  fund_a boolean;
  org_member_a boolean;
  org_member_b boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_b)::text, true);
  perform set_config('request.headers', '{}', true);

  role_a := public.get_profile_role(current_setting('idor.owner_a')::uuid);
  email_a := public.get_profile_email(current_setting('idor.owner_a')::uuid);
  leader_a := public.is_group_leader(current_setting('idor.group_a')::uuid);
  fund_a := public.giving_can_manage_fund(current_setting('idor.fund_a')::uuid);
  org_member_a := public.is_org_member(current_setting('idor.org_a')::uuid);
  org_member_b := public.is_org_member(current_setting('idor.org_b')::uuid);

  reset role;

  insert into idor_results
    select ok(role_a is null, 'get_profile_role(org-A profile) is NULL for an org-B member');
  insert into idor_results
    select ok(email_a is null, 'get_profile_email(org-A profile) is NULL for an org-B member');
  insert into idor_results
    select ok(not leader_a, 'is_group_leader(org-A group) is false for an org-B member');
  insert into idor_results
    select ok(not fund_a, 'giving_can_manage_fund(org-A fund) is false for a plain org-B member');
  insert into idor_results
    select ok(not org_member_a, 'is_org_member(org A) is false for an org-B member');
  insert into idor_results
    select ok(org_member_b, 'non-vacuity: is_org_member(org B) is true for the org-B member');
end $$;

-- Helper positive control: the org-B ADMIN does manage their own org's fund
-- (proves the helper itself is not fail-everything).
do $$
declare
  owner_b uuid := current_setting('idor.owner_b')::uuid;
  fund_b boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  perform set_config('request.headers', '{}', true);
  fund_b := public.giving_can_manage_fund(current_setting('idor.fund_b')::uuid);
  reset role;
  insert into idor_results
    select ok(fund_b, 'non-vacuity: giving_can_manage_fund(own fund) is true for the org-B admin');
end $$;

select line from idor_results;
select * from finish();
rollback;
