-- Signup + provisioning tenancy suite (CWA-9 / #211, Phase 2, §5 / §6 / §9.3).
-- Proves handle_new_user() is fail-closed (raises rather than guesses),
-- provision_organization() builds a complete org in one transaction and is
-- unreachable from PostgREST roles, the org-scoped helpers resolve per-org,
-- and the exact PostgREST upsert shape the about_page editor sends still
-- works per-org after the legacy global uniques were dropped.
--
-- Run locally (rollback-safe):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/tenancy_signup_provisioning_suite.sql

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
begin
  org_a := public.provision_organization('Signup Suite Org A', 'signup-suite-org-a', 'su-owner-a@leak.example.test');
  org_b := public.provision_organization('Signup Suite Org B', 'signup-suite-org-b', 'su-owner-b@leak.example.test');
  insert into auth.users (id, email) values
    (owner_a, 'su-owner-a@leak.example.test'),
    (owner_b, 'su-owner-b@leak.example.test');
  perform set_config('su.org_a', org_a::text, true);
  perform set_config('su.org_b', org_b::text, true);
  perform set_config('su.owner_a', owner_a::text, true);
  perform set_config('su.owner_b', owner_b::text, true);
end $$;

-- ── provision_organization() completeness (§6) ──────────────────────────────

-- Groups are org-defined (maintainer decision, plan §12 open item 1):
-- admins create them in /admin/groups and set per-group capability flags
-- (is_serving_role; grants_prayer_access existed until 20260801000001) and
-- per-membership leadership
-- (profile_groups.is_leader). A platform-seeded group would be the
-- hardwired-role model 20260716000002 already removed once, so its absence
-- is asserted, not assumed.
select is(
  (select count(*)::int from public.member_groups
    where org_id = current_setting('su.org_a')::uuid),
  0, 'provisioning seeds no groups — groups are org-defined');

select is(
  (select value from public.site_settings
    where org_id = current_setting('su.org_a')::uuid and key = 'prayer_calendar_id'),
  (select id::text from public.event_calendars
    where org_id = current_setting('su.org_a')::uuid and name = 'Prayer Calls'),
  'prayer_calendar_id points at the provisioned prayer calendar');

select is(
  (select count(*)::int from public.site_settings
    where org_id = current_setting('su.org_a')::uuid),
  10, 'provisioning seeds the full settings-key list');

select is(
  (select count(*)::int from public.site_settings
    where org_id = current_setting('su.org_a')::uuid and is_public),
  1, 'only site_name is anon-readable among provisioned settings');

select ok(
  exists (select 1 from public.about_page
    where org_id = current_setting('su.org_a')::uuid),
  'provisioning creates the org''s about_page row');

select ok(
  exists (select 1 from public.access_requests
    where org_id = current_setting('su.org_a')::uuid
      and email = 'su-owner-a@leak.example.test' and status = 'approved'),
  'provisioning creates the approved owner access request');

select is(
  (select org_id from public.profiles
    where id = current_setting('su.owner_a')::uuid),
  current_setting('su.org_a')::uuid,
  'owner signup after provisioning resolves into the provisioned org');

-- Owner adoption is org-scoped: a profile that already belongs to another
-- org is NEVER moved into the new one. su-owner-b already has a profile
-- pinned to org B, so provisioning org C with that same owner email must
-- raise TN004 rather than re-pin them (the cross-tenant write that would
-- become an account-takeover primitive once Phase 4 exposes a caller).
select throws_ok(
  $$ select public.provision_organization('Signup Suite Org C', 'signup-suite-org-c', 'su-owner-b@leak.example.test') $$,
  'TN004', null,
  'provisioning refuses an owner email that already belongs to another org');

select is(
  (select org_id from public.profiles where id = current_setting('su.owner_b')::uuid),
  current_setting('su.org_b')::uuid,
  'the rejected call left the existing owner profile in its original org');

select ok(
  not exists (select 1 from public.organizations where slug = 'signup-suite-org-c'),
  'the rejected call left no partial org behind (atomic)');

select ok(
  not exists (
    select 1 from public.organization_members om
    join public.profiles p on p.id = om.profile_id
    where p.id = current_setting('su.owner_b')::uuid
      and om.org_id is distinct from current_setting('su.org_b')::uuid),
  'the rejected call granted no membership outside the owner''s own org');

-- A profile-less owner email is still rejected when another org already
-- holds an approved access request or unclaimed family invite for it:
-- provisioning would insert a SECOND approved request, and the owner's
-- eventual signup would then be ambiguous (TN002) — neither org could
-- onboard them. The fixture email is stored with capitals to prove the
-- guard matches case-insensitively, like handle_new_user().
do $$
declare
  _family uuid;
  _fm uuid;
begin
  insert into public.access_requests (org_id, name, email, status)
    values (current_setting('su.org_a')::uuid, 'unclaimed owner',
            'Unclaimed-Owner@leak.example.test', 'approved');
  insert into public.family_units (org_id, family_name)
    values (current_setting('su.org_b')::uuid, 'pending invite family')
    returning id into _family;
  insert into public.family_members (org_id, family_id, first_name, relationship)
    values (current_setting('su.org_b')::uuid, _family, 'pending invitee', 'spouse')
    returning id into _fm;
  insert into public.family_invites (org_id, family_id, family_member_id, invite_email)
    values (current_setting('su.org_b')::uuid, _family, _fm, 'Pending-Invitee@leak.example.test');
end $$;

select throws_ok(
  $$ select public.provision_organization('Signup Suite Org E', 'signup-suite-org-e', 'unclaimed-owner@leak.example.test') $$,
  'TN005', null,
  'provisioning refuses an owner email with an approved access request in another org');

select throws_ok(
  $$ select public.provision_organization('Signup Suite Org F', 'signup-suite-org-f', 'pending-invitee@leak.example.test') $$,
  'TN005', null,
  'provisioning refuses an owner email with an unclaimed family invite in another org');

select ok(
  not exists (select 1 from public.organizations
    where slug in ('signup-suite-org-e', 'signup-suite-org-f')),
  'the TN005-rejected calls left no partial org behind (atomic)');

select is(
  (select count(*)::int from public.access_requests
    where lower(email) in ('unclaimed-owner@leak.example.test', 'pending-invitee@leak.example.test')),
  1, 'the TN005-rejected calls left no second approved access request behind');

-- Guardrails
select throws_ok(
  $$ select public.provision_organization('Dup Org', 'signup-suite-org-a', 'dup@leak.example.test') $$,
  '23505', null,
  'duplicate slug is rejected');

select ok(
  not exists (select 1 from public.organizations where name = 'Dup Org'),
  'the failed duplicate-slug call left no partial org behind (atomic)');

select throws_ok(
  $$ select public.provision_organization('Bad Slug Org', 'Bad_Slug!', 'bad@leak.example.test') $$,
  'TN003', null,
  'invalid slug is rejected');

-- Reserved subdomain labels (Phase 5 PR 1, CWA-65 / #358): TN006 fires
-- after the TN003 shape check, and the whole call rolls back.
select throws_ok(
  $$ select public.provision_organization('Reserved Slug Org', 'admin', 'reserved@leak.example.test') $$,
  'TN006', null,
  'reserved slug is rejected');

select throws_ok(
  $$ select public.provision_organization('Reserved Slug Org', 'api', 'reserved@leak.example.test') $$,
  'TN006', null,
  'a second reserved slug (api) is rejected');

select ok(
  not exists (select 1 from public.organizations where slug in ('admin', 'api')),
  'the TN006-rejected calls left no partial org behind (atomic)');

select ok(
  not exists (
    select 1 from public.access_requests
    where lower(email) = 'reserved@leak.example.test'),
  'the TN006-rejected calls left no access request behind (atomic)');

do $$
declare
  _org_id uuid;
begin
  _org_id := public.provision_organization(
    'Not Reserved Org', 'signup-suite-not-reserved', 'not-reserved@leak.example.test'
  );
  perform set_config('su.org_not_reserved', _org_id::text, true);
end $$;

select ok(
  exists (
    select 1 from public.organizations
    where id = current_setting('su.org_not_reserved')::uuid
      and slug = 'signup-suite-not-reserved'
  ),
  'a normal (non-reserved) slug still provisions');

-- Not callable from PostgREST roles: EXECUTE is revoked.
do $$
declare
  anon_err text := null;
  auth_err text := null;
begin
  set local role anon;
  begin
    perform public.provision_organization('Sneaky Org', 'sneaky-org', 'sneak@leak.example.test');
  exception when others then
    anon_err := sqlstate;
  end;
  reset role;
  set local role authenticated;
  begin
    perform public.provision_organization('Sneaky Org 2', 'sneaky-org-2', 'sneak2@leak.example.test');
  exception when others then
    auth_err := sqlstate;
  end;
  reset role;
  perform set_config('su.anon_err', coalesce(anon_err, 'no error'), true);
  perform set_config('su.auth_err', coalesce(auth_err, 'no error'), true);
end $$;

select is(current_setting('su.anon_err'), '42501',
  'anon cannot execute provision_organization()');
select is(current_setting('su.auth_err'), '42501',
  'authenticated cannot execute provision_organization()');

-- ── handle_new_user() fail-closed resolution (§5) ───────────────────────────

-- No approved request, no invite → rejected.
select throws_ok(
  $$ insert into auth.users (id, email)
     values (gen_random_uuid(), 'stranger@leak.example.test') $$,
  'TN001', null,
  'signup with no approved access request or invite is rejected');

-- Approved in two orgs → ambiguous, rejected.
do $$
begin
  insert into public.access_requests (org_id, name, email, status)
    values (current_setting('su.org_a')::uuid, 'both orgs', 'ambiguous@leak.example.test', 'approved'),
           (current_setting('su.org_b')::uuid, 'both orgs', 'ambiguous@leak.example.test', 'approved');
end $$;

select throws_ok(
  $$ insert into auth.users (id, email)
     values (gen_random_uuid(), 'ambiguous@leak.example.test') $$,
  'TN002', null,
  'signup matching approved invitations in two orgs is rejected as ambiguous');

-- Client-supplied raw_user_meta_data can NEVER pick the org.
do $$
declare
  u uuid := gen_random_uuid();
begin
  insert into public.access_requests (org_id, name, email, status)
    values (current_setting('su.org_a')::uuid, 'meta victim', 'user-meta@leak.example.test', 'approved');
  insert into auth.users (id, email, raw_user_meta_data)
    values (u, 'user-meta@leak.example.test',
            jsonb_build_object('org_id', current_setting('su.org_b'), 'full_name', 'Meta Victim'));
  perform set_config('su.user_meta_user', u::text, true);
end $$;

select is(
  (select org_id from public.profiles where id = current_setting('su.user_meta_user')::uuid),
  current_setting('su.org_a')::uuid,
  'raw_user_meta_data org_id is ignored — the approved request''s org wins');

-- Server-set raw_app_meta_data may disambiguate within the resolved set…
do $$
declare
  u uuid := gen_random_uuid();
begin
  -- ambiguous@ still has approved requests in A and B; app metadata picks B.
  insert into auth.users (id, email, raw_app_meta_data)
    values (u, 'ambiguous@leak.example.test',
            jsonb_build_object('org_id', current_setting('su.org_b')));
  perform set_config('su.app_meta_user', u::text, true);
end $$;

select is(
  (select org_id from public.profiles where id = current_setting('su.app_meta_user')::uuid),
  current_setting('su.org_b')::uuid,
  'raw_app_meta_data disambiguates between two legitimate matches');

-- …but can never WIDEN the set beyond it.
select throws_ok(
  $$ insert into auth.users (id, email, raw_app_meta_data)
     values (gen_random_uuid(), 'widen-attempt@leak.example.test',
             jsonb_build_object('org_id', current_setting('su.org_a'))) $$,
  'TN001', null,
  'raw_app_meta_data cannot conjure an org with no matching invitation');

-- Unclaimed family invite alone resolves the org, at role pending.
do $$
declare
  u uuid := gen_random_uuid();
  _family uuid;
  _fm uuid;
begin
  insert into public.family_units (org_id, family_name)
    values (current_setting('su.org_a')::uuid, 'invite family') returning id into _family;
  insert into public.family_members (org_id, family_id, first_name, relationship)
    values (current_setting('su.org_a')::uuid, _family, 'invitee', 'spouse') returning id into _fm;
  insert into public.family_invites (org_id, family_id, family_member_id, invite_email)
    values (current_setting('su.org_a')::uuid, _family, _fm, 'invitee@leak.example.test');
  insert into auth.users (id, email) values (u, 'invitee@leak.example.test');
  perform set_config('su.invitee', u::text, true);
end $$;

select is(
  (select org_id from public.profiles where id = current_setting('su.invitee')::uuid),
  current_setting('su.org_a')::uuid,
  'an unclaimed family invite resolves the signup''s org');

select is(
  (select role from public.profiles where id = current_setting('su.invitee')::uuid),
  'pending',
  'invite-only signup starts as pending (approval logic unchanged)');

-- ── Case-insensitive email resolution ───────────────────────────────────────
-- GoTrue lowercases auth emails; access requests store them as typed. An
-- exact match would raise TN001 for a request entered with capitals —
-- locking that person out of signup entirely.
do $$
declare
  u uuid := gen_random_uuid();
begin
  insert into public.access_requests (org_id, name, email, status)
    values (current_setting('su.org_a')::uuid, 'mixed case',
            'Mixed.Case@Leak.Example.Test', 'approved');
  insert into auth.users (id, email) values (u, 'mixed.case@leak.example.test');
  perform set_config('su.mixed_case_user', u::text, true);
end $$;

select is(
  (select org_id from public.profiles where id = current_setting('su.mixed_case_user')::uuid),
  current_setting('su.org_a')::uuid,
  'a lowercased auth email matches an access request stored with capitals');

select is(
  (select role from public.profiles where id = current_setting('su.mixed_case_user')::uuid),
  'member',
  'the case-insensitive match still resolves the approved role, not pending');

-- The TN004 duplicate-owner guard uses the same comparison: a case-variant
-- of an existing profile email is still the same account.
select throws_ok(
  $$ select public.provision_organization('Signup Suite Org D', 'signup-suite-org-d', 'SU-OWNER-B@leak.example.test') $$,
  'TN004', null,
  'provisioning refuses a case-variant of an owner email that already belongs to another org');

-- ── giving_stewards_can_manage(): per-org settings, no 21000 (§4.2) ────────
do $$
declare
  a_result text := 'unset';
  b_result text := 'unset';
begin
  update public.site_settings set value = 'admins'
    where org_id = current_setting('su.org_b')::uuid and key = 'giving_manage_mode';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('su.owner_a'))::text, true);
  begin
    a_result := public.giving_stewards_can_manage()::text;
  exception when others then
    a_result := 'raised ' || sqlstate;
  end;
  begin
    -- user-meta@ landed in org A, so it cannot stand in for an org B
    -- principal; query as the app-meta user, who resolved into org B.
    perform set_config('request.jwt.claims', json_build_object('sub', current_setting('su.app_meta_user'))::text, true);
    b_result := public.giving_stewards_can_manage()::text;
  exception when others then
    b_result := 'raised ' || sqlstate;
  end;
  reset role;
  perform set_config('su.giving_a', a_result, true);
  perform set_config('su.giving_b', b_result, true);
end $$;

select is(current_setting('su.giving_a'), 'true',
  'giving_stewards_can_manage() reads org A''s own value (stewards) without raising');
select is(current_setting('su.giving_b'), 'false',
  'giving_stewards_can_manage() reads org B''s own value (admins) without raising');

-- ── Org-scoped id-taking helpers (§4.1) ─────────────────────────────────────
do $$
declare
  org_a uuid := current_setting('su.org_a')::uuid;
  org_b uuid := current_setting('su.org_b')::uuid;
  owner_a uuid := current_setting('su.owner_a')::uuid;
  group_a uuid;
  group_b uuid;
  fund_b uuid;
  lead_own text; lead_other text; manage_other text;
begin
  -- Provisioning seeds no groups, so each org's serving group is created
  -- here the way an org admin would.
  insert into public.member_groups (org_id, name, is_serving_role)
    values (org_a, 'A serving team', true) returning id into group_a;
  insert into public.member_groups (org_id, name, is_serving_role)
    values (org_b, 'B serving team', true) returning id into group_b;
  insert into public.profile_groups (org_id, profile_id, group_id, is_leader)
    values (org_a, owner_a, group_a, true);
  insert into public.giving_funds (org_id, name, steward_id)
    values (org_b, 'B fund', current_setting('su.app_meta_user')::uuid)
    returning id into fund_b;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  lead_own := public.is_group_leader(group_a)::text;
  lead_other := public.is_group_leader(group_b)::text;
  -- owner_a is org A's founding ADMIN since access_requests.approved_role
  -- (CWA-11), and giving_can_manage_fund() short-circuits true for any org
  -- admin — the restrictive org floor is what keeps that in-org. The
  -- cross-org probe therefore needs a non-admin principal: user-meta@
  -- resolved into org A as a plain member above.
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('su.user_meta_user'))::text, true);
  manage_other := public.giving_can_manage_fund(fund_b)::text;
  reset role;

  perform set_config('su.lead_own', lead_own, true);
  perform set_config('su.lead_other', lead_other, true);
  perform set_config('su.manage_other', manage_other, true);
end $$;

select is(current_setting('su.lead_own'), 'true',
  'is_group_leader() is true for the caller''s own-org group');
select is(current_setting('su.lead_other'), 'false',
  'is_group_leader() is false for another org''s group id');
select is(current_setting('su.manage_other'), 'false',
  'giving_can_manage_fund() is false for another org''s fund id');

-- ── PostgREST about_page upsert shape after the legacy-unique drop (§3.5) ──
-- This is the exact statement PostgREST generates for the AboutEditor's
-- .upsert() (no on_conflict param → the PK (org_id, id) is the arbiter;
-- org_id fills from its fail-closed DEFAULT).
do $$
declare
  owner_a uuid := current_setting('su.owner_a')::uuid;
  upsert_err text := null;
begin
  update public.profiles set role = 'admin' where id = owner_a;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  begin
    insert into public.about_page (id, body, updated_by, updated_at)
    values (true, 'edited by org A', owner_a, now())
    on conflict (org_id, id) do update
      set body = excluded.body, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  exception when others then
    upsert_err := sqlstate || ': ' || sqlerrm;
  end;
  reset role;
  perform set_config('su.upsert_err', coalesce(upsert_err, 'ok'), true);
end $$;

select is(current_setting('su.upsert_err'), 'ok',
  'the PostgREST-shaped about_page upsert (PK arbiter, defaulted org_id) succeeds');

select is(
  (select body from public.about_page where org_id = current_setting('su.org_a')::uuid),
  'edited by org A',
  'the upsert updated org A''s about_page row');

select is(
  (select body from public.about_page where org_id = current_setting('su.org_b')::uuid),
  '',
  'org B''s about_page row is untouched by org A''s upsert');

select * from finish();
rollback;
