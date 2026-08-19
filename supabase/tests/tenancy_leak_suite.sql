-- Cross-tenant leak suite (CWA-9 / #211, Phase 2 — upgraded from the Phase 0
-- skeleton). Two orgs are provisioned for real via provision_organization(),
-- every org-owned table is seeded for BOTH orgs by seed_org_fixture(), and a
-- fixture-completeness gate fails the suite by name for any enumerated table
-- org B holds no rows in — a green run can never again be green-but-vacuous.
-- Then, as a member of org A, every table and every view must show zero
-- org B rows, headers must never widen scope, and cross-org writes must be
-- rejected.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/tenancy_leak_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table tenancy_leak_results (line text) on commit drop;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- seed_org_fixture(): one row in EVERY org-owned table for the given org.
-- Created inside this transaction (rolls back with everything else). If a
-- future table gains org_id without being added here, the completeness gate
-- below fails for it — that is the point.
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
  _request uuid;
begin
  -- provisioning already seeded: organizations, event_calendars (prayer
  -- calendar), site_settings, about_page, access_requests (owner), and the
  -- owner's profiles + organization_members rows via signup. Groups are
  -- org-defined (provisioning seeds none), so the fixture creates its own
  -- serving group here — which is also the member_groups row the
  -- fixture-completeness gate counts.
  insert into public.member_groups (org_id, name, is_serving_role)
    values (_org, _tag || ' serving team', true) returning id into _serving_group;

  insert into public.family_units (org_id, family_name)
    values (_org, _tag || ' family') returning id into _family;
  insert into public.family_members (org_id, family_id, first_name, relationship)
    values (_org, _family, _tag || ' kid', 'child') returning id into _family_member;
  insert into public.family_invites (org_id, family_id, family_member_id, invite_email)
    values (_org, _family, _family_member, _tag || '-invite@leak.example.test')
    returning id, token into _invite, _invite_token;
  update public.profiles set family_id = _family where id = _owner;

  -- second access request carrying the invite token (exercises the
  -- composite (invite_token, org_id) FK)
  insert into public.access_requests (org_id, name, email, status, invite_token)
    values (_org, _tag || ' requester', _tag || '-req@leak.example.test', 'pending', _invite_token);

  insert into public.announcements (org_id, title, content, is_published, author_id)
    values (_org, _tag || ' announcement', 'body', true, _owner);

  insert into public.event_calendars (org_id, name, created_by)
    values (_org, _tag || ' calendar', _owner) returning id into _calendar;
  insert into public.events (org_id, title, start_time, calendar_id, created_by)
    values (_org, _tag || ' event', now() + interval '7 days', _calendar, _owner)
    returning id into _event;
  insert into public.rsvps (org_id, event_id, user_id, status)
    values (_org, _event, _owner, 'yes');
  insert into public.calendar_subscription_tokens (org_id, user_id, token_hash, expires_at)
    values (_org, _owner, _tag || '-token-hash', now() + interval '30 days');

  insert into public.class_teachers (org_id, profile_id, title)
    values (_org, _owner, 'Teacher');
  insert into public.feedback (org_id, profile_id, type, message)
    values (_org, _owner, 'idea', _tag || ' feedback');

  insert into public.giving_funds (org_id, name, steward_id, created_by)
    values (_org, _tag || ' fund', _owner, _owner) returning id into _fund;
  -- custom_handle is NOT NULL (20260707000000_giving.sql) — omitting it
  -- aborts the whole suite with 23502 in CI, where the schema is built from
  -- the migrations rather than from the drifted shared local stack.
  insert into public.giving_fund_methods (org_id, fund_id, method, custom_handle)
    values (_org, _fund, 'zelle', _tag || '-zelle');

  insert into public.lecture_series (org_id, name)
    values (_org, _tag || ' series') returning id into _series;
  insert into public.lectures (org_id, title, video_url, series_id, created_by)
    values (_org, _tag || ' lecture', 'https://example.test/v', _series, _owner);

  -- same slug in both orgs — also proves the legacy global unique is gone
  insert into public.page_content (org_id, slug, title, body)
    values (_org, 'leak-suite-page', _tag || ' page', 'body');

  insert into public.prayer_call_sessions (org_id, weekday, start_time, leader_id, event_id)
    values (_org, 2, '07:00', _owner, _event);
  insert into public.prayer_requests (org_id, author_id, body, category)
    values (_org, _owner, _tag || ' prayer', 'health');
  insert into public.prayer_responses (org_id, request_id, profile_id)
    select _org, id, _owner from public.prayer_requests
      where org_id = _org and author_id = _owner limit 1;

  insert into public.profile_groups (org_id, profile_id, group_id)
    values (_org, _owner, _serving_group);
  insert into public.serving_team_settings (org_id, group_id, enabled)
    values (_org, _serving_group, true);
  insert into public.serving_signups (org_id, group_id, service_date, family_id, created_by)
    values (_org, _serving_group, (current_date + (7 - extract(dow from current_date)::int)), _family, _owner)
    returning id into _signup;
  insert into public.serving_signup_attendees (org_id, signup_id, profile_id)
    values (_org, _signup, _owner);
  insert into public.serving_broadcasts (org_id, group_id, sent_by, subject)
    values (_org, _serving_group, _owner, _tag || ' broadcast');
  insert into public.org_email_domains (org_id, domain, resend_domain_id, status, dns_records)
    values (_org, _tag || '.mail.example.test', _tag || '-resend-id', 'pending', '[]'::jsonb);
end;
$$;

do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
begin
  org_a := public.provision_organization('Leak Suite Org A', 'leak-suite-org-a', 'owner-a@leak.example.test');
  org_b := public.provision_organization('Leak Suite Org B', 'leak-suite-org-b', 'owner-b@leak.example.test');

  -- Owners sign up AFTER provisioning (the §5/§6 org-first contract):
  -- handle_new_user() resolves each into their org via the approved
  -- access_requests row provisioning created.
  insert into auth.users (id, email) values
    (owner_a, 'owner-a@leak.example.test'),
    (owner_b, 'owner-b@leak.example.test');

  perform pg_temp.seed_org_fixture(org_a, owner_a, 'org-a');
  perform pg_temp.seed_org_fixture(org_b, owner_b, 'org-b');

  perform set_config('leak_suite.org_a', org_a::text, true);
  perform set_config('leak_suite.org_b', org_b::text, true);
  perform set_config('leak_suite.owner_a', owner_a::text, true);
  perform set_config('leak_suite.owner_b', owner_b::text, true);
end $$;

-- Owner signups resolved into the right orgs (fail-closed signup worked).
insert into tenancy_leak_results
  select is(
    (select org_id from public.profiles where id = current_setting('leak_suite.owner_a')::uuid),
    current_setting('leak_suite.org_a')::uuid,
    'owner A''s signup resolved into org A via the provisioning access request'
  );
insert into tenancy_leak_results
  select is(
    (select role from public.profiles where id = current_setting('leak_suite.owner_a')::uuid),
    'admin',
    'owner A''s provisioning access request (approved_role = admin, CWA-11) made them the founding admin'
  );

-- ── Fixture-completeness gate (§9.1) ────────────────────────────────────────
-- Checked as postgres (RLS bypassed): org B must hold ≥ 1 row in every
-- org_id-bearing base table, or the isolation assertions below prove
-- nothing. Fails by table name.
do $$
declare
  org_b uuid := current_setting('leak_suite.org_b')::uuid;
  t text;
  n bigint;
begin
  for t in
    select c.table_name::text
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'org_id'
      and tb.table_type = 'BASE TABLE'
      -- Local-stack stray (mirrors schema_tenancy_lint.sql's
      -- tenancy_local_strays): exists on the shared local dev stack only,
      -- in no migration on this branch, so CI's migrations-built database
      -- (the actual gate) never contains it. Excluded here so the
      -- completeness gate stays meaningful on local runs too.
      and c.table_name <> 'payment_handles'
    order by 1
  loop
    execute format('select count(*) from public.%I where org_id = $1', t)
      into n using org_b;
    insert into tenancy_leak_results
      select ok(n >= 1, format('fixture completeness: org B holds %s row(s) in %s (suite is non-vacuous)', n, t));
  end loop;
end $$;

-- ── Read isolation: org A member sees zero org B rows, everywhere ───────────
do $$
declare
  org_a uuid := current_setting('leak_suite.org_a')::uuid;
  org_b uuid := current_setting('leak_suite.org_b')::uuid;
  owner_a uuid := current_setting('leak_suite.owner_a')::uuid;
  tables text[] := '{}';
  own_counts bigint[] := '{}';
  cross_counts bigint[] := '{}';
  errors text[] := '{}';
  views text[] := array['profiles_directory', 'families_directory', 'families_directory_full', 'prayer_wall'];
  view_cross bigint[] := '{}';
  view_errors text[] := '{}';
  org_b_visible_count bigint;
  is_member_own boolean;
  is_member_other boolean;
  profiles_recursion_error text := null;
  own_c bigint; cross_c bigint;
  t text;
  i int;
begin
  select coalesce(array_agg(c.table_name::text order by c.table_name), '{}')
    into tables
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'org_id'
      and tb.table_type = 'BASE TABLE';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);

  foreach t in array tables loop
    begin
      execute format('select count(*) filter (where org_id = $1), count(*) filter (where org_id = $2) from public.%I', t)
        into own_c, cross_c using org_a, org_b;
      own_counts := own_counts || own_c;
      cross_counts := cross_counts || cross_c;
      errors := errors || null::text;
    exception when others then
      own_counts := own_counts || null::bigint;
      cross_counts := cross_counts || null::bigint;
      errors := errors || sqlerrm;
    end;
  end loop;

  foreach t in array views loop
    begin
      execute format('select count(*) from public.%I where org_id = $1', t)
        into cross_c using org_b;
      view_cross := view_cross || cross_c;
      view_errors := view_errors || null::text;
    exception when others then
      view_cross := view_cross || null::bigint;
      view_errors := view_errors || sqlerrm;
    end;
  end loop;

  -- organizations has no org_id column; check it directly.
  select count(*) into org_b_visible_count
    from public.organizations where id = org_b;

  is_member_own := public.is_org_member(org_a);
  is_member_other := public.is_org_member(org_b);

  -- Regression guard for 20260715000000_fix_profiles_update_recursion:
  -- app_current_org_id() reads profiles inside profiles RLS. SECURITY
  -- DEFINER must keep that from recursing.
  begin
    perform count(*) from public.profiles;
  exception when others then
    profiles_recursion_error := sqlerrm;
  end;

  reset role;

  for i in 1 .. array_length(tables, 1) loop
    if errors[i] is not null then
      insert into tenancy_leak_results
        select fail(format('org A member check errored on %s: %s', tables[i], errors[i]));
    else
      insert into tenancy_leak_results
        select ok(cross_counts[i] = 0, format('org A member cannot read org B rows from %s', tables[i]));
    end if;
  end loop;

  -- Non-vacuous on the member side too: the org A member must still see
  -- their own org's rows on the core member surfaces (a rewrite that
  -- blanked everything would pass every zero-count check above).
  insert into tenancy_leak_results
    select ok(own_counts[array_position(tables, 'profiles')] >= 1, 'org A member still sees own-org profiles');
  insert into tenancy_leak_results
    select ok(own_counts[array_position(tables, 'events')] >= 1, 'org A member still sees own-org events');
  insert into tenancy_leak_results
    select ok(own_counts[array_position(tables, 'site_settings')] >= 1, 'org A member still sees own-org site_settings');
  insert into tenancy_leak_results
    select ok(own_counts[array_position(tables, 'prayer_requests')] >= 1, 'org A member still sees own-org prayer_requests');

  for i in 1 .. array_length(views, 1) loop
    if view_errors[i] is not null then
      insert into tenancy_leak_results
        select fail(format('org A member view check errored on %s: %s', views[i], view_errors[i]));
    else
      insert into tenancy_leak_results
        select ok(view_cross[i] = 0, format('org A member cannot read org B rows through view %s', views[i]));
    end if;
  end loop;

  insert into tenancy_leak_results
    select ok(org_b_visible_count = 0, 'org A member cannot read org B''s organizations row');
  insert into tenancy_leak_results
    select ok(is_member_own, 'is_org_member() is true for org A member''s own org');
  insert into tenancy_leak_results
    select ok(not is_member_other, 'is_org_member() is false for org A member checking org B');
  insert into tenancy_leak_results
    select ok(profiles_recursion_error is null,
      coalesce('profiles SELECT does not recurse — got: ' || profiles_recursion_error,
               'profiles SELECT does not recurse through app_current_org_id()'));
end $$;

-- ── Header resolution (§9.2) ────────────────────────────────────────────────
do $$
declare
  org_a uuid := current_setting('leak_suite.org_a')::uuid;
  org_b uuid := current_setting('leak_suite.org_b')::uuid;
  owner_a uuid := current_setting('leak_suite.owner_a')::uuid;
  anon_a_settings bigint;
  anon_a_wrong_org bigint;
  anon_a_pages bigint;
  anon_none bigint;
  member_spoof bigint;
  member_spoof_own bigint;
begin
  -- anon + org A header: sees only org A's public rows. jwt claims are
  -- cleared explicitly — set_config(..., true) persists for the whole
  -- transaction, so the previous block's principal would otherwise leak
  -- into these "anonymous" checks.
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', json_build_object('x-two42-org', 'leak-suite-org-a')::text, true);
  select count(*) into anon_a_settings from public.site_settings where org_id = org_a;
  select count(*) into anon_a_wrong_org from public.site_settings where org_id = org_b;
  select count(*) into anon_a_pages from public.page_content where org_id = org_b;
  reset role;

  -- anon with no header: sees nothing
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '{}', true);
  select count(*) into anon_none from public.site_settings;
  reset role;

  -- authenticated member of A sending org B's header: still resolves to A
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  perform set_config('request.headers', json_build_object('x-two42-org', 'leak-suite-org-b')::text, true);
  select count(*) into member_spoof from public.site_settings where org_id = org_b;
  select count(*) into member_spoof_own from public.site_settings where org_id = org_a;
  reset role;

  insert into tenancy_leak_results
    select ok(anon_a_settings >= 1, 'anon with org A header reads org A public settings (site_name)');
  insert into tenancy_leak_results
    select ok(anon_a_wrong_org = 0, 'anon with org A header reads zero org B settings');
  insert into tenancy_leak_results
    select ok(anon_a_pages = 0, 'anon with org A header reads zero org B page_content');
  insert into tenancy_leak_results
    select ok(anon_none = 0, 'anon with no header reads nothing (fail-closed)');
  insert into tenancy_leak_results
    select ok(member_spoof = 0, 'org A member sending x-two42-org: org-b still reads zero org B rows (principal wins over header)');
  insert into tenancy_leak_results
    select ok(member_spoof_own >= 1, 'org A member sending org B header still reads their own org');
end $$;

-- ── app_request_org_id() never raises on a malformed GUC (§9.2) ─────────────
-- Regression guard for the nullif() in 20260731000001_org_helpers.sql:47.
-- `current_setting('request.headers', true)` returns '' (not NULL) once the
-- GUC has been set and cleared in the session, and ''::json raises 22P02.
-- Every other test here sets request.headers to valid JSON, so without this
-- block deleting the inner nullif() leaves the whole suite green.
--
-- This matters more than a leak would: the helper is called from the USING
-- and WITH CHECK of all 30 restrictive policies, so if it raises, every
-- query against every org-owned table errors for that connection — a total
-- outage, not a leak.
do $$
declare
  empty_result text;
  unset_result text;
  garbage_result text;
  anon_rows text;
begin
  -- empty-string GUC → NULL, not 22P02
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  begin
    empty_result := coalesce((select public.app_request_org_id())::text, 'null');
  exception when others then
    empty_result := 'raised ' || sqlstate;
  end;

  -- valid JSON with no x-two42-org key → NULL
  perform set_config('request.headers', '{}', true);
  begin
    unset_result := coalesce((select public.app_request_org_id())::text, 'null');
  exception when others then
    unset_result := 'raised ' || sqlstate;
  end;

  -- non-JSON garbage: behaviour is pinned here so it is a deliberate choice,
  -- not an accident. What must never happen is it resolving AN ORG.
  perform set_config('request.headers', 'not json at all', true);
  begin
    garbage_result := coalesce((select public.app_request_org_id())::text, 'null');
  exception when others then
    garbage_result := 'raised ' || sqlstate;
  end;

  -- and the end-to-end consequence: an anon read under an empty GUC returns
  -- zero rows rather than erroring the statement.
  perform set_config('request.headers', '', true);
  set local role anon;
  begin
    anon_rows := (select count(*) from public.site_settings)::text;
  exception when others then
    anon_rows := 'raised ' || sqlstate;
  end;
  reset role;

  perform set_config('leak_suite.guc_empty', empty_result, true);
  perform set_config('leak_suite.guc_unset', unset_result, true);
  perform set_config('leak_suite.guc_garbage', garbage_result, true);
  perform set_config('leak_suite.guc_anon_rows', anon_rows, true);
end $$;

insert into tenancy_leak_results
  select is(current_setting('leak_suite.guc_empty'), 'null',
    'app_request_org_id() returns NULL (not 22P02) for an empty request.headers GUC');
insert into tenancy_leak_results
  select is(current_setting('leak_suite.guc_unset'), 'null',
    'app_request_org_id() returns NULL when request.headers carries no x-two42-org');
insert into tenancy_leak_results
  select is(current_setting('leak_suite.guc_garbage'), 'raised 22P02',
    'app_request_org_id() on non-JSON request.headers raises 22P02 rather than resolving an org');
insert into tenancy_leak_results
  select is(current_setting('leak_suite.guc_anon_rows'), '0',
    'an anon read under an empty request.headers GUC returns 0 rows rather than erroring');

-- ── Write isolation (§9.3) ──────────────────────────────────────────────────
do $$
declare
  org_a uuid := current_setting('leak_suite.org_a')::uuid;
  org_b uuid := current_setting('leak_suite.org_b')::uuid;
  owner_a uuid := current_setting('leak_suite.owner_a')::uuid;
  insert_err text := null;
  retag_err text := null;
  update_b_count int := -1;
  delete_b_count int := -1;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  perform set_config('request.headers', '{}', true);

  -- INSERT tagged into org B → rejected by the restrictive WITH CHECK
  begin
    insert into public.prayer_requests (org_id, author_id, body, category)
    values (org_b, owner_a, 'cross-org write', 'health');
  exception when others then
    insert_err := sqlstate;
  end;

  -- Re-tagging an own row's org_id A → B → rejected
  begin
    update public.prayer_requests set org_id = org_b
    where author_id = owner_a and org_id = org_a;
  exception when others then
    retag_err := sqlstate;
  end;

  -- UPDATE / DELETE targeting a B row by id → 0 rows affected
  with u as (
    update public.prayer_requests set body = 'defaced'
    where org_id = org_b returning 1
  ) select count(*) into update_b_count from u;
  with d as (
    delete from public.prayer_requests
    where org_id = org_b returning 1
  ) select count(*) into delete_b_count from d;

  reset role;

  insert into tenancy_leak_results
    select is(insert_err, '42501', 'INSERT into own table tagged org B is rejected (RLS 42501)');
  insert into tenancy_leak_results
    select is(retag_err, '42501', 'UPDATE re-tagging own row''s org_id to org B is rejected (RLS 42501)');
  insert into tenancy_leak_results
    select is(update_b_count, 0, 'UPDATE targeting org B rows affects 0 rows');
  insert into tenancy_leak_results
    select is(delete_b_count, 0, 'DELETE targeting org B rows affects 0 rows');
end $$;

-- ── Anon write isolation: the /join form's only public write path (§9.3) ────
-- access_requests is the one table anon may INSERT into, and the header is
-- its only org gate. Every other anon assertion in this suite is a read, so
-- without this block the product's single public write path is untested.
do $$
declare
  match_err text := null;
  other_err text := null;
  approved_err text := null;
  none_err text := null;
  landed_org text;
begin
  -- anon with org A's header inserting a row tagged org A → accepted
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', json_build_object('x-two42-org', 'leak-suite-org-a')::text, true);
  begin
    insert into public.access_requests (org_id, name, email, status)
    values (current_setting('leak_suite.org_a')::uuid, 'anon joiner',
            'anon-join@leak.example.test', 'pending');
  exception when others then
    match_err := sqlstate;
  end;

  -- …tagged org B while sending org A's header → rejected
  begin
    insert into public.access_requests (org_id, name, email, status)
    values (current_setting('leak_suite.org_b')::uuid, 'anon intruder',
            'anon-intruder@leak.example.test', 'pending');
  exception when others then
    other_err := sqlstate;
  end;

  -- …correctly tagged but pre-approved → rejected. status = 'approved' is
  -- the signup trust anchor (handle_new_user() mints a member profile from
  -- it), so a public insert must never be able to arrive already reviewed.
  begin
    insert into public.access_requests (org_id, name, email, status)
    values (current_setting('leak_suite.org_a')::uuid, 'anon self-approver',
            'anon-self-approve@leak.example.test', 'approved');
  exception when others then
    approved_err := sqlstate;
  end;

  -- …with no header at all → rejected (app_request_org_id() is NULL)
  perform set_config('request.headers', '{}', true);
  begin
    insert into public.access_requests (org_id, name, email, status)
    values (current_setting('leak_suite.org_a')::uuid, 'anon headerless',
            'anon-headerless@leak.example.test', 'pending');
  exception when others then
    none_err := sqlstate;
  end;
  reset role;

  select org_id::text into landed_org from public.access_requests
    where email = 'anon-join@leak.example.test';

  perform set_config('leak_suite.anon_match', coalesce(match_err, 'ok'), true);
  perform set_config('leak_suite.anon_other', coalesce(other_err, 'ok'), true);
  perform set_config('leak_suite.anon_approved', coalesce(approved_err, 'ok'), true);
  perform set_config('leak_suite.anon_none', coalesce(none_err, 'ok'), true);
  perform set_config('leak_suite.anon_landed', coalesce(landed_org, 'none'), true);
end $$;

insert into tenancy_leak_results
  select is(current_setting('leak_suite.anon_match'), 'ok',
    'anon INSERT into access_requests succeeds when org_id matches the x-two42-org header');
insert into tenancy_leak_results
  select is(current_setting('leak_suite.anon_landed'), current_setting('leak_suite.org_a'),
    'the accepted anon access request landed in the header''s org');
insert into tenancy_leak_results
  select is(current_setting('leak_suite.anon_other'), '42501',
    'anon INSERT tagged another org than the header is rejected (RLS 42501)');
insert into tenancy_leak_results
  select is(current_setting('leak_suite.anon_none'), '42501',
    'anon INSERT with no x-two42-org header is rejected (RLS 42501)');
insert into tenancy_leak_results
  select is(current_setting('leak_suite.anon_approved'), '42501',
    'anon INSERT arriving pre-approved is rejected — no self-approved signup trust anchor (RLS 42501)');

-- The join flow (Phase 3, CWA-10) resolves its org through the same
-- app_request_org_id() the policy above evaluates — but the slug
-- resolveOrgSlug() defaults to ('default', lib/org.ts) must still be
-- reachable. If a migration renames the seeded org's slug,
-- app_request_org_id() returns NULL for anon and the join page fails closed
-- to "Join requests unavailable" (with an operator log line as of CWA-10's
-- review pass) rather than ever reaching a 42501 — pin it here so that
-- drift shows up as a test failure instead of only at that page.
--
-- This assertion is a seed-integrity check, not proof that no UUID↔slug
-- coupling exists: it keys on the hardcoded seed UUID below, which still has
-- to agree with whatever resolveOrgSlug() resolves to. A differently-idded
-- org seeded with slug 'default' would pass this assertion while breaking
-- the join flow it is meant to guard.
insert into tenancy_leak_results
  select is(
    (select slug from public.organizations
      where id = '00000000-0000-0000-0000-000000000001'::uuid),
    'default',
    'the seeded org (00000000-0000-0000-0000-000000000001) still carries the slug resolveOrgSlug() defaults to (''default'')');

-- ── platform_admins (org-orthogonal, unchanged by the org floor) ────────────
do $$
declare
  admin_user uuid := current_setting('leak_suite.owner_a')::uuid;
  plain_user uuid := current_setting('leak_suite.owner_b')::uuid;
  admin_visible_count int;
  plain_visible_count int;
begin
  insert into public.platform_admins (profile_id) values (admin_user);

  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user)::text, true);
  select count(*) into admin_visible_count from public.platform_admins;

  perform set_config('request.jwt.claims', json_build_object('sub', plain_user)::text, true);
  select count(*) into plain_visible_count from public.platform_admins;

  reset role;

  insert into tenancy_leak_results
    select ok(admin_visible_count = 1, 'a platform admin can see platform_admins rows');
  insert into tenancy_leak_results
    select ok(plain_visible_count = 0, 'a non-admin cannot see platform_admins rows');
end $$;

select line from tenancy_leak_results;
select * from finish();
rollback;
