-- Composite-FK tenancy suite (CWA-9 / #211, Phase 2, §3.3 / §9.3).
-- Proves the two behaviors the composite (fk, org_id) foreign keys exist
-- for, as postgres so RLS never masks a constraint result:
--
--   1. A child row in org A can never reference a parent row in org B —
--      the FK itself rejects it (23503), independent of any policy.
--   2. An ON DELETE SET NULL (col) relation nulls ONLY the FK column when
--      the parent dies: org_id survives. This is the assertion that fails
--      loudly if someone "simplifies" the column list away (the bare form
--      would try to null org_id and blow up on NOT NULL).
--
-- Coverage boundary: 20260731000013_composite_fks.sql creates 15 SET NULL
-- relations — the 7 capability/entity ones asserted below get their runtime
-- behavior proven here; the remaining 8 attribution ones
-- (announcements.author_id, feedback.profile_id, the created_by /
-- leader_id / sent_by columns) are covered structurally by
-- schema_tenancy_lint.sql's check 3b, which asserts every FK with
-- confdeltype = 'n' whose referencing columns include org_id names a
-- column list excluding org_id — all 15 plus any added later.
--
-- Exhaustive composite-ness of every FK is a structural invariant asserted
-- by schema_tenancy_lint.sql; this file proves the runtime behavior on
-- representative and capability-bearing relations.
--
-- Run locally (rollback-safe):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/tenancy_fk_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  costeward_a uuid := gen_random_uuid();
  v uuid;
begin
  org_a := public.provision_organization('FK Suite Org A', 'fk-suite-org-a', 'fk-owner-a@leak.example.test');
  org_b := public.provision_organization('FK Suite Org B', 'fk-suite-org-b', 'fk-owner-b@leak.example.test');

  insert into auth.users (id, email) values
    (owner_a, 'fk-owner-a@leak.example.test'),
    (owner_b, 'fk-owner-b@leak.example.test');

  -- a second org A member (the co-steward whose deletion we'll prove)
  insert into public.access_requests (org_id, name, email, status)
    values (org_a, 'co steward', 'fk-costeward-a@leak.example.test', 'approved');
  insert into auth.users (id, email) values
    (costeward_a, 'fk-costeward-a@leak.example.test');

  perform set_config('fk.org_a', org_a::text, true);
  perform set_config('fk.org_b', org_b::text, true);
  perform set_config('fk.owner_a', owner_a::text, true);
  perform set_config('fk.owner_b', owner_b::text, true);
  perform set_config('fk.costeward_a', costeward_a::text, true);

  -- org B entities that org A children will try (and fail) to reference
  insert into public.event_calendars (org_id, name) values (org_b, 'B calendar') returning id into v;
  perform set_config('fk.calendar_b', v::text, true);
  insert into public.events (org_id, title, start_time) values (org_b, 'B event', now()) returning id into v;
  perform set_config('fk.event_b', v::text, true);
  insert into public.lecture_series (org_id, name) values (org_b, 'B series') returning id into v;
  perform set_config('fk.series_b', v::text, true);
  insert into public.family_units (org_id, family_name) values (org_b, 'B family') returning id into v;
  perform set_config('fk.family_b', v::text, true);
  insert into public.giving_funds (org_id, name, steward_id) values (org_b, 'B fund', owner_b) returning id into v;
  perform set_config('fk.fund_b', v::text, true);
  insert into public.prayer_requests (org_id, author_id, body, category)
    values (org_b, owner_b, 'B prayer', 'health') returning id into v;
  perform set_config('fk.request_b', v::text, true);
  insert into public.groups (org_id, name) values (org_b, 'B group') returning id into v;
  perform set_config('fk.grp_b', v::text, true);
  insert into public.teams (org_id, group_id, name, is_serving_role)
    values (org_b, v, 'B serving team', true) returning id into v;
  perform set_config('fk.group_b', v::text, true);
end $$;

-- ── 1. Cross-org references are FK violations ──────────────────────────────

select throws_ok(
  $$ insert into public.rsvps (org_id, event_id, user_id, status)
     values (current_setting('fk.org_a')::uuid, current_setting('fk.event_b')::uuid,
             current_setting('fk.owner_a')::uuid, 'yes') $$,
  '23503', null,
  'rsvps in org A cannot reference an org B event');

select throws_ok(
  $$ insert into public.team_members (org_id, profile_id, team_id)
     values (current_setting('fk.org_a')::uuid, current_setting('fk.owner_a')::uuid,
             current_setting('fk.group_b')::uuid) $$,
  '23503', null,
  'team_members in org A cannot reference an org B team');

select throws_ok(
  $$ insert into public.group_members (org_id, group_id, profile_id)
     values (current_setting('fk.org_a')::uuid, current_setting('fk.grp_b')::uuid,
             current_setting('fk.owner_a')::uuid) $$,
  '23503', null,
  'group_members in org A cannot reference an org B group');

select throws_ok(
  $$ insert into public.prayer_responses (org_id, request_id, profile_id)
     values (current_setting('fk.org_a')::uuid, current_setting('fk.request_b')::uuid,
             current_setting('fk.owner_a')::uuid) $$,
  '23503', null,
  'prayer_responses in org A cannot reference an org B request');

select throws_ok(
  $$ insert into public.family_members (org_id, family_id, first_name, relationship)
     values (current_setting('fk.org_a')::uuid, current_setting('fk.family_b')::uuid,
             'intruder', 'child') $$,
  '23503', null,
  'family_members in org A cannot reference an org B household');

select throws_ok(
  $$ insert into public.giving_fund_methods (org_id, fund_id, method, custom_handle)
     values (current_setting('fk.org_a')::uuid, current_setting('fk.fund_b')::uuid,
             'zelle', 'cross-org-handle') $$,
  '23503', null,
  'giving_fund_methods in org A cannot reference an org B fund');

select throws_ok(
  $$ insert into public.serving_signups (org_id, group_id, service_date, created_by)
     values (current_setting('fk.org_a')::uuid, current_setting('fk.group_b')::uuid,
             current_date + 7, current_setting('fk.owner_a')::uuid) $$,
  '23503', null,
  'serving_signups in org A cannot reference an org B group');

select throws_ok(
  $$ insert into public.class_teachers (org_id, profile_id)
     values (current_setting('fk.org_a')::uuid, current_setting('fk.owner_b')::uuid) $$,
  '23503', null,
  'class_teachers in org A cannot reference an org B profile');

select throws_ok(
  $$ insert into public.events (org_id, title, start_time, calendar_id)
     values (current_setting('fk.org_a')::uuid, 'strayed', now(),
             current_setting('fk.calendar_b')::uuid) $$,
  '23503', null,
  'events in org A cannot be filed under an org B calendar');

select throws_ok(
  $$ insert into public.lectures (org_id, title, video_url, series_id)
     values (current_setting('fk.org_a')::uuid, 'strayed', 'https://example.test/v',
             current_setting('fk.series_b')::uuid) $$,
  '23503', null,
  'lectures in org A cannot be filed under an org B series');

select throws_ok(
  $$ update public.profiles
     set family_id = current_setting('fk.family_b')::uuid
     where id = current_setting('fk.owner_a')::uuid $$,
  '23503', null,
  'a profile in org A cannot be placed in an org B household');

select throws_ok(
  $$ insert into public.prayer_call_sessions (org_id, weekday, start_time, event_id)
     values (current_setting('fk.org_a')::uuid, 1, '07:00',
             current_setting('fk.event_b')::uuid) $$,
  '23503', null,
  'prayer_call_sessions in org A cannot bind to an org B event');

select throws_ok(
  $$ insert into public.giving_funds (org_id, name, steward_id, co_steward_id)
     values (current_setting('fk.org_a')::uuid, 'strayed fund',
             current_setting('fk.owner_a')::uuid, current_setting('fk.owner_b')::uuid) $$,
  '23503', null,
  'giving_funds in org A cannot grant co-stewardship to an org B profile');

-- ── 2. ON DELETE SET NULL (col): the FK column nulls, org_id survives ──────
-- The 7 capability/entity relations only — see the coverage boundary in the
-- file header for the 8 attribution relations this does not reach.
do $$
declare
  org_a uuid := current_setting('fk.org_a')::uuid;
  owner_a uuid := current_setting('fk.owner_a')::uuid;
  costeward_a uuid := current_setting('fk.costeward_a')::uuid;
  _family uuid; _fm uuid; _invite_token uuid; _ar uuid;
  _cal uuid; _event uuid; _series uuid; _lecture uuid; _pcs uuid;
  _signup uuid; _fund uuid; _group uuid; _grp uuid;
begin
  insert into public.groups (org_id, name) values (org_a, 'A group') returning id into _grp;
  insert into public.teams (org_id, group_id, name, is_serving_role)
    values (org_a, _grp, 'A serving team', true) returning id into _group;

  -- 1. access_requests.invite_token ← family_invites.token
  insert into public.family_units (org_id, family_name) values (org_a, 'A family') returning id into _family;
  insert into public.family_members (org_id, family_id, first_name, relationship)
    values (org_a, _family, 'A kid', 'child') returning id into _fm;
  insert into public.family_invites (org_id, family_id, family_member_id, invite_email)
    values (org_a, _family, _fm, 'setnull-1@leak.example.test') returning token into _invite_token;
  insert into public.access_requests (org_id, name, email, status, invite_token)
    values (org_a, 'setnull 1', 'setnull-1@leak.example.test', 'pending', _invite_token)
    returning id into _ar;
  delete from public.family_invites where token = _invite_token;
  perform set_config('fk.sn1', (
    select (invite_token is null and org_id = org_a)::text
    from public.access_requests where id = _ar), true);

  -- 2. events.calendar_id ← event_calendars.id
  insert into public.event_calendars (org_id, name) values (org_a, 'doomed calendar') returning id into _cal;
  insert into public.events (org_id, title, start_time, calendar_id)
    values (org_a, 'orphaned event', now(), _cal) returning id into _event;
  delete from public.event_calendars where id = _cal;
  perform set_config('fk.sn2', (
    select (calendar_id is null and org_id = org_a)::text
    from public.events where id = _event), true);

  -- 3. lectures.series_id ← lecture_series.id
  insert into public.lecture_series (org_id, name) values (org_a, 'doomed series') returning id into _series;
  insert into public.lectures (org_id, title, video_url, series_id)
    values (org_a, 'orphaned lecture', 'https://example.test/v', _series) returning id into _lecture;
  delete from public.lecture_series where id = _series;
  perform set_config('fk.sn3', (
    select (series_id is null and org_id = org_a)::text
    from public.lectures where id = _lecture), true);

  -- 4. prayer_call_sessions.event_id ← events.id (reuse _event)
  insert into public.prayer_call_sessions (org_id, weekday, start_time, event_id)
    values (org_a, 3, '07:00', _event) returning id into _pcs;
  delete from public.events where id = _event;
  perform set_config('fk.sn4', (
    select (event_id is null and org_id = org_a)::text
    from public.prayer_call_sessions where id = _pcs), true);

  -- 5 & 6. profiles.family_id and serving_signups.family_id ← family_units.id
  update public.profiles set family_id = _family where id = owner_a;
  insert into public.serving_signups (org_id, group_id, service_date, family_id, created_by)
    values (org_a, _group, current_date + 14, _family, owner_a) returning id into _signup;
  delete from public.family_units where id = _family;
  perform set_config('fk.sn5', (
    select (family_id is null and org_id = org_a)::text
    from public.profiles where id = owner_a), true);
  perform set_config('fk.sn6', (
    select (family_id is null and org_id = org_a)::text
    from public.serving_signups where id = _signup), true);

  -- 7. giving_funds.co_steward_id ← profiles.id
  insert into public.giving_funds (org_id, name, steward_id, co_steward_id)
    values (org_a, 'shared fund', owner_a, costeward_a) returning id into _fund;
  delete from public.profiles where id = costeward_a;
  perform set_config('fk.sn7', (
    select (co_steward_id is null and org_id = org_a)::text
    from public.giving_funds where id = _fund), true);
end $$;

select is(current_setting('fk.sn1'), 'true',
  'deleting a family invite nulls only access_requests.invite_token — org_id survives');
select is(current_setting('fk.sn2'), 'true',
  'deleting a calendar nulls only events.calendar_id — org_id survives');
select is(current_setting('fk.sn3'), 'true',
  'deleting a series nulls only lectures.series_id — org_id survives');
select is(current_setting('fk.sn4'), 'true',
  'deleting an event nulls only prayer_call_sessions.event_id — org_id survives');
select is(current_setting('fk.sn5'), 'true',
  'deleting a household nulls only profiles.family_id — org_id survives');
select is(current_setting('fk.sn6'), 'true',
  'deleting a household nulls only serving_signups.family_id — org_id survives');
select is(current_setting('fk.sn7'), 'true',
  'deleting a co-steward profile nulls only giving_funds.co_steward_id — org_id survives');

select * from finish();
rollback;
