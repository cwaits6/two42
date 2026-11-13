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
  _group uuid;
  _group_member uuid;
  _label uuid;
  _invite_link uuid;
begin
  -- provisioning already seeded: organizations, site_settings,
  -- access_requests (owner), and the owner's profiles row via signup.
  -- Groups and teams are org-defined (provisioning seeds none), so the
  -- fixture creates its own group, with the owner as its
  -- leader, a label attached to that membership, a serving team under it,
  -- and every group-owned content row — the rows the fixture-completeness
  -- gate counts.
  insert into public.groups (org_id, name)
    values (_org, _tag || ' group') returning id into _group;
  insert into public.group_members (org_id, group_id, profile_id, role)
    values (_org, _group, _owner, 'leader') returning id into _group_member;
  insert into public.group_labels (org_id, group_id, name)
    values (_org, _group, _tag || ' label') returning id into _label;
  insert into public.group_member_labels (org_id, group_id, group_member_id, label_id)
    values (_org, _group, _group_member, _label);
  insert into public.group_requests (org_id, requested_by, name)
    values (_org, _owner, _tag || ' group request');
  insert into public.group_join_requests (org_id, group_id, profile_id)
    values (_org, _group, _owner);
  insert into public.group_invites (org_id, group_id, created_by)
    values (_org, _group, _owner) returning id into _invite_link;
  insert into public.group_invite_uses (org_id, invite_id, group_id, email, outcome, profile_id)
    values (_org, _invite_link, _group, _tag || '-use@leak.example.test', 'joined', _owner);
  insert into public.teams (org_id, group_id, name, is_serving_role)
    values (_org, _group, _tag || ' serving team', true) returning id into _serving_group;

  insert into public.family_units (org_id, family_name)
    values (_org, _tag || ' family') returning id into _family;
  insert into public.family_members (org_id, family_id, first_name, relationship)
    values (_org, _family, _tag || ' kid', 'other') returning id into _family_member;
  insert into public.family_invites (org_id, family_id, family_member_id, invite_email)
    values (_org, _family, _family_member, _tag || '-invite@leak.example.test')
    returning id, token into _invite, _invite_token;
  update public.profiles set family_id = _family where id = _owner;

  -- second access request carrying the invite token (exercises the
  -- composite (invite_token, org_id) FK)
  insert into public.access_requests (org_id, name, email, status, invite_token)
    values (_org, _tag || ' requester', _tag || '-req@leak.example.test', 'pending', _invite_token);

  insert into public.announcements (org_id, group_id, title, content, is_published, author_id)
    values (_org, _group, _tag || ' announcement', 'body', true, _owner);
  insert into public.about_page (org_id, group_id, body)
    values (_org, _group, _tag || ' about');
  insert into public.group_settings (org_id, group_id, serving_link_mode)
    values (_org, _group, 'login');

  insert into public.event_calendars (org_id, group_id, name, created_by)
    values (_org, _group, _tag || ' calendar', _owner) returning id into _calendar;
  insert into public.events (org_id, group_id, title, start_time, calendar_id, created_by)
    values (_org, _group, _tag || ' event', now() + interval '7 days', _calendar, _owner)
    returning id into _event;
  insert into public.rsvps (org_id, event_id, user_id, status, occurrence_date)
    values (_org, _event, _owner, 'yes', current_date + 7);
  insert into public.calendar_subscription_tokens (org_id, user_id, token_hash, expires_at)
    values (_org, _owner, _tag || '-token-hash', now() + interval '30 days');

  insert into public.class_teachers (org_id, group_id, profile_id, title)
    values (_org, _group, _owner, 'Teacher');
  insert into public.feedback (org_id, profile_id, type, message)
    values (_org, _owner, 'idea', _tag || ' feedback');

  insert into public.giving_funds (org_id, group_id, name, steward_id, created_by)
    values (_org, _group, _tag || ' fund', _owner, _owner) returning id into _fund;
  -- custom_handle is NOT NULL (20260707000000_giving.sql) — omitting it
  -- aborts the whole suite with 23502 in CI, where the schema is built from
  -- the migrations rather than from the drifted shared local stack.
  insert into public.giving_fund_methods (org_id, group_id, fund_id, method, custom_handle)
    values (_org, _group, _fund, 'zelle', _tag || '-zelle');

  insert into public.lecture_series (org_id, group_id, name)
    values (_org, _group, _tag || ' series') returning id into _series;
  insert into public.lectures (org_id, group_id, title, video_url, series_id, created_by)
    values (_org, _group, _tag || ' lecture', 'https://example.test/v', _series, _owner);

  insert into public.prayer_requests (org_id, group_id, author_id, body)
    values (_org, _group, _owner, _tag || ' prayer');
  insert into public.prayer_responses (org_id, group_id, request_id, profile_id)
    select _org, _group, id, _owner from public.prayer_requests
      where org_id = _org and author_id = _owner limit 1;

  insert into public.team_members (org_id, profile_id, team_id)
    values (_org, _owner, _serving_group);
  insert into public.serving_team_settings (org_id, team_id, enabled)
    values (_org, _serving_group, true);
  insert into public.serving_signups (org_id, team_id, service_date, family_id, created_by)
    values (_org, _serving_group, (current_date + (7 - extract(dow from current_date)::int)), _family, _owner)
    returning id into _signup;
  insert into public.serving_signup_attendees (org_id, signup_id, profile_id)
    values (_org, _signup, _owner);
  insert into public.serving_broadcasts (org_id, team_id, sent_by, subject)
    values (_org, _serving_group, _owner, _tag || ' broadcast');
  insert into public.org_email_domains (org_id, domain, resend_domain_id, status, dns_records)
    values (_org, _tag || '.mail.example.test', _tag || '-resend-id', 'pending', '[]'::jsonb);
  -- org_domains and org_domain_worker_events are retired but still present
  -- until the cleanup migration drops them; the suite discovers every
  -- org-owned table dynamically, so each still needs a fixture row here.
  insert into public.org_domains (org_id, domain, status)
    values (_org, _tag || '.domains.example.test', 'pending');
  -- Send-cap tables. Direct inserts as postgres —
  -- both tables are service-role-only (restrictive policy, no permissive
  -- arm), so the fixture writes them the same way the RPC/cap editor do.
  insert into public.org_email_usage (org_id, usage_date, sent_count)
    values (_org, (now() at time zone 'utc')::date, 3);
  insert into public.org_email_limits (org_id, daily_cap)
    values (_org, 250);
  -- Service-role-only the same way; the retired worker's outcome log.
  insert into public.org_domain_worker_events (org_id, domain, event)
    values (_org, _tag || '.domains.example.test', 'detached');
  -- The reminder sent record is service-role-only the same way.
  insert into public.serving_reminder_passes (org_id, team_id, send_date)
    values (_org, _serving_group, current_date);
  insert into public.serving_reminder_sends (org_id, team_id, send_date, profile_id)
    values (_org, _serving_group, current_date, _owner);
  insert into public.event_reminder_passes (org_id, event_id, occurrence_date)
    values (_org, _event, current_date);
  insert into public.event_reminder_sends (org_id, event_id, occurrence_date, profile_id)
    values (_org, _event, current_date, _owner);
  insert into public.usage_counts (org_id, usage_date, kind, pattern, total)
    values (_org, current_date, 'view', '/dashboard', 1);
end;
$$;

do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
begin
  org_a := public.provision_organization('Leak Suite Org A', 'owner-a@leak.example.test');
  org_b := public.provision_organization('Leak Suite Org B', 'owner-b@leak.example.test');

  -- Owners sign up AFTER provisioning (the §5/§6 org-first contract):
  -- handle_new_user() resolves each into their org via the approved
  -- access_requests row provisioning created.
  insert into auth.users (id, email) values
    (owner_a, 'owner-a@leak.example.test'),
    (owner_b, 'owner-b@leak.example.test');

  perform pg_temp.seed_org_fixture(org_a, owner_a, 'org-a');
  perform pg_temp.seed_org_fixture(org_b, owner_b, 'org-b');

  -- Provisioning seeds no anon-readable setting any more, so the
  -- public-settings leak checks below need one per org to be meaningful.
  insert into public.site_settings (org_id, key, value, is_public) values
    (org_a, 'leak_suite_public', 'org-a', true),
    (org_b, 'leak_suite_public', 'org-b', true);

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
  error_states text[] := '{}';
  views text[] := array['profiles_directory', 'families_directory', 'families_directory_full', 'prayer_wall'];
  view_cross bigint[] := '{}';
  view_errors text[] := '{}';
  org_b_visible_count bigint;
  profiles_recursion_error text := null;
  owner_b uuid := current_setting('leak_suite.owner_b')::uuid;
  team_a uuid;
  team_b uuid;
  admin_email_ids uuid[];
  admin_emails_own bigint;
  admin_emails_cross bigint;
  directory_email_own text;
  directory_email_cross text;
  team_count_own integer;
  team_count_cross integer;
  email_fn_error text := null;
  own_c bigint; cross_c bigint;
  t text;
  i int;
begin
  select id into team_a from public.teams where org_id = org_a;
  select id into team_b from public.teams where org_id = org_b;

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
      error_states := error_states || null::text;
    exception when others then
      own_counts := own_counts || null::bigint;
      cross_counts := cross_counts || null::bigint;
      errors := errors || sqlerrm;
      error_states := error_states || sqlstate;
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

  -- Regression guard for 20260715000000_fix_profiles_update_recursion:
  -- app_current_org_id() reads profiles inside profiles RLS. SECURITY
  -- DEFINER must keep that from recursing.
  begin
    perform count(*) from public.profiles;
  exception when others then
    profiles_recursion_error := sqlerrm;
  end;

  -- The address helpers are security definer, so no row policy stands
  -- between them and org B: the org check in each body is the boundary.
  begin
    select array_agg(e.profile_id) into admin_email_ids from public.admin_member_emails() e;
    directory_email_own := public.profile_directory_email(owner_a);
    directory_email_cross := public.profile_directory_email(owner_b);
    team_count_own := public.serving_team_email_count(team_a);
    team_count_cross := public.serving_team_email_count(team_b);
  exception when others then
    email_fn_error := sqlerrm;
  end;

  reset role;

  -- Counted as postgres: under RLS org B's profiles would be invisible and
  -- the cross count vacuously zero.
  select count(*) filter (where p.org_id = org_a), count(*) filter (where p.org_id <> org_a)
    into admin_emails_own, admin_emails_cross
    from public.profiles p where p.id = any (admin_email_ids);

  for i in 1 .. array_length(tables, 1) loop
    if error_states[i] = '42501'
       and tables[i] in ('org_email_usage', 'org_email_limits', 'org_domain_worker_events',
                         'serving_reminder_passes', 'serving_reminder_sends',
                         'event_reminder_passes', 'event_reminder_sends') then
      -- Service-role-only tables (restrictive policy, ALL privileges
      -- revoked — org_email_usage / org_email_limits /
      -- org_domain_worker_events / serving_reminder_passes /
      -- serving_reminder_sends / event_reminder_passes /
      -- event_reminder_sends): a privilege denial is the intended,
      -- stronger-than-row-filtering isolation outcome, not a broken check.
      -- Scoped to exactly those tables so a normal tenant table losing
      -- authenticated read access still fails.
      insert into tenancy_leak_results
        select ok(true, format('org A member cannot read %s at all (42501 — service-role-only table)', tables[i]));
    elsif errors[i] is not null then
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

  if email_fn_error is not null then
    insert into tenancy_leak_results
      select fail('org A church admin address helper check errored: ' || email_fn_error);
  else
    insert into tenancy_leak_results
      select ok(admin_emails_own >= 1, 'org A church admin reads own-org addresses from admin_member_emails()');
    insert into tenancy_leak_results
      select ok(admin_emails_cross = 0, 'org A church admin reads no org B address from admin_member_emails()');
    insert into tenancy_leak_results
      select ok(directory_email_own is not null, 'org A church admin reads an own-org address from profile_directory_email()');
    insert into tenancy_leak_results
      select ok(directory_email_cross is null, 'org A church admin reads no org B address from profile_directory_email()');
    insert into tenancy_leak_results
      select ok(team_count_own >= 1, 'org A group leader gets a count from serving_team_email_count() for an own-org team');
    insert into tenancy_leak_results
      select ok(team_count_cross is null, 'org A group leader gets no count from serving_team_email_count() for an org B team');
  end if;

  insert into tenancy_leak_results
    select ok(profiles_recursion_error is null,
      coalesce('profiles SELECT does not recurse — got: ' || profiles_recursion_error,
               'profiles SELECT does not recurse through app_current_org_id()'));
end $$;

-- ── Anonymous resolution ────────────────────────────────────────────────────
-- No header names an org any more: an anonymous caller resolves NULL and
-- reads nothing, and a member sending another org's header still reads
-- only their own org.
do $$
declare
  org_a uuid := current_setting('leak_suite.org_a')::uuid;
  org_b uuid := current_setting('leak_suite.org_b')::uuid;
  owner_a uuid := current_setting('leak_suite.owner_a')::uuid;
  anon_with_header bigint;
  anon_none bigint;
  member_spoof bigint;
  member_spoof_own bigint;
begin
  -- jwt claims are cleared explicitly — set_config(..., true) persists for
  -- the whole transaction, so the previous block's principal would
  -- otherwise leak into these "anonymous" checks.
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', json_build_object('x-two42-org', 'leak-suite-org-a')::text, true);
  select count(*) into anon_with_header from public.site_settings;
  reset role;

  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '{}', true);
  select count(*) into anon_none from public.site_settings;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  perform set_config('request.headers', json_build_object('x-two42-org', 'leak-suite-org-b')::text, true);
  select count(*) into member_spoof from public.site_settings where org_id = org_b;
  select count(*) into member_spoof_own from public.site_settings where org_id = org_a;
  reset role;

  insert into tenancy_leak_results
    select ok(anon_with_header = 0, 'anon with an x-two42-org header still reads nothing (no header path remains)');
  insert into tenancy_leak_results
    select ok(anon_none = 0, 'anon with no header reads nothing (fail-closed)');
  insert into tenancy_leak_results
    select ok(member_spoof = 0, 'org A member sending x-two42-org: org-b still reads zero org B rows');
  insert into tenancy_leak_results
    select ok(member_spoof_own >= 1, 'org A member sending org B header still reads their own org');
end $$;

-- ── app_request_org_id() never raises on any GUC state ──────────────────────
-- The helper is called from the USING and WITH CHECK of every restrictive
-- policy, so if it raised, every query against every org-owned table would
-- error for that connection — a total outage, not a leak. It no longer
-- reads request.headers at all; this pins that no GUC value can make it
-- raise or resolve an org.
do $$
declare
  empty_result text;
  unset_result text;
  garbage_result text;
  anon_rows text;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  begin
    empty_result := coalesce((select public.app_request_org_id())::text, 'null');
  exception when others then
    empty_result := 'raised ' || sqlstate;
  end;

  perform set_config('request.headers', '{}', true);
  begin
    unset_result := coalesce((select public.app_request_org_id())::text, 'null');
  exception when others then
    unset_result := 'raised ' || sqlstate;
  end;

  perform set_config('request.headers', 'not json at all', true);
  begin
    garbage_result := coalesce((select public.app_request_org_id())::text, 'null');
  exception when others then
    garbage_result := 'raised ' || sqlstate;
  end;

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
    'app_request_org_id() returns NULL for an empty request.headers GUC');
insert into tenancy_leak_results
  select is(current_setting('leak_suite.guc_unset'), 'null',
    'app_request_org_id() returns NULL when request.headers carries no x-two42-org');
insert into tenancy_leak_results
  select is(current_setting('leak_suite.guc_garbage'), 'null',
    'app_request_org_id() returns NULL on non-JSON request.headers (it never reads the header)');
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
    insert into public.prayer_requests (org_id, group_id, author_id, body)
    values (org_b, (select id from public.groups where org_id = org_b limit 1), owner_a, 'cross-org write');
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

-- ── Replies by date: rsvp_set() ─────────────────────────────────────────────
-- SECURITY INVOKER, so another church's event is invisible to it: a save or
-- a clear on it changes none of that church's replies.
do $$
declare
  org_b uuid := current_setting('leak_suite.org_b')::uuid;
  owner_a uuid := current_setting('leak_suite.owner_a')::uuid;
  event_b uuid;
  day_b date;
  before_b int;
  set_err text := null;
  clear_err text := null;
begin
  select e.id, (e.start_time at time zone o.timezone)::date into event_b, day_b
  from public.events e join public.organizations o on o.id = e.org_id
  where e.org_id = org_b limit 1;
  select count(*) into before_b from public.rsvps where org_id = org_b;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  perform set_config('request.headers', '{}', true);
  begin
    perform public.rsvp_set(event_b, day_b, 'yes');
  exception when others then
    set_err := sqlstate;
  end;
  begin
    perform public.rsvp_set(event_b, day_b);
  exception when others then
    clear_err := sqlstate;
  end;
  reset role;

  insert into tenancy_leak_results
    select is(set_err, '42501', 'rsvp_set on an org B event is rejected (42501)');
  insert into tenancy_leak_results
    select is(clear_err, '42501', 'and so is a clear of it (42501)');
  insert into tenancy_leak_results
    select is((select count(*)::int from public.rsvps where org_id = org_b), before_b,
      'and org B''s replies are unchanged');
  insert into tenancy_leak_results
    select ok(not has_function_privilege('anon', 'public.rsvp_set(uuid, date, text)', 'execute'),
      'anon cannot run rsvp_set');
end $$;

-- ── Anon write isolation: no public write path remains ──────────────────────
-- access_requests used to be the one table anon could INSERT into, through
-- the slug join form. That policy is gone: a household invite files its
-- request through a token-anchored route on the service client, and an
-- anonymous insert fails whatever org it names and whatever header it sends.
do $$
declare
  match_err text := null;
  other_err text := null;
  approved_err text := null;
  none_err text := null;
begin
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

  begin
    insert into public.access_requests (org_id, name, email, status)
    values (current_setting('leak_suite.org_b')::uuid, 'anon intruder',
            'anon-intruder@leak.example.test', 'pending');
  exception when others then
    other_err := sqlstate;
  end;

  -- status = 'approved' is the signup trust anchor (handle_new_user() mints
  -- a member profile from it), so this one matters most.
  begin
    insert into public.access_requests (org_id, name, email, status)
    values (current_setting('leak_suite.org_a')::uuid, 'anon self-approver',
            'anon-self-approve@leak.example.test', 'approved');
  exception when others then
    approved_err := sqlstate;
  end;

  perform set_config('request.headers', '{}', true);
  begin
    insert into public.access_requests (org_id, name, email, status)
    values (current_setting('leak_suite.org_a')::uuid, 'anon headerless',
            'anon-headerless@leak.example.test', 'pending');
  exception when others then
    none_err := sqlstate;
  end;
  reset role;

  perform set_config('leak_suite.anon_match', coalesce(match_err, 'ok'), true);
  perform set_config('leak_suite.anon_other', coalesce(other_err, 'ok'), true);
  perform set_config('leak_suite.anon_approved', coalesce(approved_err, 'ok'), true);
  perform set_config('leak_suite.anon_none', coalesce(none_err, 'ok'), true);
end $$;

insert into tenancy_leak_results
  select is(current_setting('leak_suite.anon_match'), '42501',
    'anon INSERT into access_requests is rejected even when org_id matches the x-two42-org header (RLS 42501)');
insert into tenancy_leak_results
  select is(current_setting('leak_suite.anon_other'), '42501',
    'anon INSERT tagged another org than the header is rejected (RLS 42501)');
insert into tenancy_leak_results
  select is(current_setting('leak_suite.anon_none'), '42501',
    'anon INSERT with no x-two42-org header is rejected (RLS 42501)');
insert into tenancy_leak_results
  select is(current_setting('leak_suite.anon_approved'), '42501',
    'anon INSERT arriving pre-approved is rejected — no self-approved signup trust anchor (RLS 42501)');
insert into tenancy_leak_results
  select is(
    (select count(*)::int from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'access_requests' and cmd = 'INSERT'),
    0,
    'access_requests has no INSERT policy left for any client role');

-- ── platform_admins (org-orthogonal, unchanged by the org floor) ────────────
do $$
declare
  admin_user uuid := current_setting('leak_suite.owner_a')::uuid;
  plain_user uuid := current_setting('leak_suite.owner_b')::uuid;
  admin_visible_count int;
  plain_visible_count int;
  other_admin uuid := gen_random_uuid();
  total_count int;
begin
  -- A second, org-less admin, so an own-row-only policy cannot pass the
  -- equality below on a table that would otherwise hold one row.
  set local session_replication_role = replica;
  insert into auth.users (id, email) values (other_admin, 'other-admin@leak.example.test');
  set local session_replication_role = origin;

  insert into public.platform_admins (profile_id) values (admin_user), (other_admin);
  select count(*) into total_count from public.platform_admins;

  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user)::text, true);
  select count(*) into admin_visible_count from public.platform_admins;

  perform set_config('request.jwt.claims', json_build_object('sub', plain_user)::text, true);
  select count(*) into plain_visible_count from public.platform_admins;

  reset role;

  insert into tenancy_leak_results
    select ok(total_count >= 2 and admin_visible_count = total_count,
      'a platform admin can see every platform_admins row, not only their own');
  insert into tenancy_leak_results
    select ok(plain_visible_count = 0, 'a non-admin cannot see platform_admins rows');
end $$;

select line from tenancy_leak_results;
select * from finish();
rollback;
