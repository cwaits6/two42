-- org_email_domains suite (Phase 5 PR 6, CWA-70 / #363). Pins the RLS and
-- GRANT boundary on the per-org sending-domain table:
--   * restrictive isolation floor + admin-only permissive policy — an org A
--     admin sees only org A's row, a cross-org DELETE is a true 0-row no-op,
--     and a plain (non-admin) member of org A sees zero rows even in their
--     own org;
--   * the grant matrix — authenticated may SELECT the whole row, INSERT
--     `domain` only, DELETE, and UPDATE nothing (status / resend_domain_id /
--     dns_records / verified_at / last_checked_at are server-set-only, and
--     `domain` is immutable after insert); anon holds no privilege at all;
--   * the unique-per-org index, the domain_shape CHECK, and the status
--     CHECK — including cleanup_pending, the one non-Resend status a row
--     whose provider-side removal failed is kept in.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/org_email_domains_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Two orgs, each with a founding admin who signs up after provisioning
-- (handle_new_user() resolves them via the approved access_requests row),
-- plus a plain member of org A (approved request with approved_role NULL).
do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
begin
  org_a := public.provision_organization('Email Domain Suite Org A', 'email-domain-suite-org-a', 'owner-a@emaildomain.example.test');
  org_b := public.provision_organization('Email Domain Suite Org B', 'email-domain-suite-org-b', 'owner-b@emaildomain.example.test');

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@emaildomain.example.test'),
    (owner_b, 'owner-b@emaildomain.example.test');

  insert into public.access_requests (org_id, name, email, status)
    values (org_a, 'Plain Member', 'member-a@emaildomain.example.test', 'approved');
  insert into auth.users (id, email) values (member_a, 'member-a@emaildomain.example.test');

  -- Seeded as postgres: fixture setup, not the behaviour under test.
  insert into public.org_email_domains (org_id, domain, resend_domain_id, status, dns_records)
    values (org_a, 'mail.org-a.example.test', 'rsd_a', 'verified', '[{"record":"DKIM"}]'::jsonb);
  insert into public.org_email_domains (org_id, domain, resend_domain_id, status, dns_records)
    values (org_b, 'mail.org-b.example.test', 'rsd_b', 'pending', '[]'::jsonb);

  perform set_config('oed.org_a', org_a::text, true);
  perform set_config('oed.org_b', org_b::text, true);
  perform set_config('oed.owner_a', owner_a::text, true);
  perform set_config('oed.owner_b', owner_b::text, true);
  perform set_config('oed.member_a', member_a::text, true);
end $$;

select is(
  (select role from public.profiles where id = current_setting('oed.owner_a')::uuid),
  'admin',
  'fixture: owner A signed up as the founding admin of org A'
);
select is(
  (select role from public.profiles where id = current_setting('oed.member_a')::uuid),
  'member',
  'fixture: member A signed up as a plain member of org A'
);

-- ── Structural pins ─────────────────────────────────────────────────────────
select ok(
  (select relrowsecurity from pg_class where oid = 'public.org_email_domains'::regclass),
  'RLS is enabled on org_email_domains'
);
select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'org_email_domains'
      and permissive = 'RESTRICTIVE' and qual like '%app\_request\_org\_id%'),
  1,
  'exactly one restrictive isolation policy predicates on app_request_org_id()'
);
select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'org_email_domains'
      and policyname = 'Admins manage org email domains'
      and permissive = 'PERMISSIVE' and cmd = 'ALL'
      and qual like '%is\_admin%' and with_check like '%is\_admin%'),
  1,
  'the permissive policy is admin-only on both USING and WITH CHECK'
);

-- ── Isolation, as org A''s admin ────────────────────────────────────────────
do $$
declare
  org_a uuid := current_setting('oed.org_a')::uuid;
  org_b uuid := current_setting('oed.org_b')::uuid;
  owner_a uuid := current_setting('oed.owner_a')::uuid;
  n bigint;
  d text;
  deleted bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);

  select count(*) into n from public.org_email_domains;
  perform set_config('oed.admin_visible', n::text, true);

  select domain into d from public.org_email_domains limit 1;
  perform set_config('oed.admin_domain', coalesce(d, '<none>'), true);

  select count(*) into n from public.org_email_domains where org_id = org_b;
  perform set_config('oed.admin_cross_visible', n::text, true);

  -- Cross-org DELETE: assert the row COUNT, not the absence of an error — a
  -- filtered write is a silent success in this codebase.
  with del as (
    delete from public.org_email_domains where org_id = org_b returning id
  )
  select count(*) into deleted from del;
  perform set_config('oed.admin_cross_deleted', deleted::text, true);

  reset role;
end $$;

select is(current_setting('oed.admin_visible')::bigint, 1::bigint,
  'org A admin sees exactly one org_email_domains row');
select is(current_setting('oed.admin_domain'), 'mail.org-a.example.test',
  'the row org A''s admin sees is org A''s own domain');
select is(current_setting('oed.admin_cross_visible')::bigint, 0::bigint,
  'an explicit where org_id = org B still returns zero rows');
select is(current_setting('oed.admin_cross_deleted')::bigint, 0::bigint,
  'a cross-org DELETE affects zero rows');
select is(
  (select count(*) from public.org_email_domains where org_id = current_setting('oed.org_b')::uuid),
  1::bigint,
  'org B''s row survives the cross-org DELETE (checked as postgres)'
);

-- ── Isolation, as org B''s admin (mirrors org A''s block: the policy is
--    symmetric, so this is completeness, not a distinct code path) ──────────
do $$
declare
  org_b uuid := current_setting('oed.org_b')::uuid;
  owner_b uuid := current_setting('oed.owner_b')::uuid;
  n bigint;
  d text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b, 'role', 'authenticated')::text, true);

  select count(*) into n from public.org_email_domains;
  perform set_config('oed.owner_b_visible', n::text, true);

  select domain into d from public.org_email_domains limit 1;
  perform set_config('oed.owner_b_domain', coalesce(d, '<none>'), true);

  reset role;
end $$;

select is(current_setting('oed.owner_b_visible')::bigint, 1::bigint,
  'org B admin sees exactly one org_email_domains row (their own)');
select is(current_setting('oed.owner_b_domain'), 'mail.org-b.example.test',
  'the row org B''s admin sees is org B''s own domain');

-- ── Non-admin isolation, as org A''s plain member ───────────────────────────
do $$
declare
  member_a uuid := current_setting('oed.member_a')::uuid;
  n bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a, 'role', 'authenticated')::text, true);
  select count(*) into n from public.org_email_domains;
  perform set_config('oed.member_visible', n::text, true);
  reset role;
end $$;

select is(current_setting('oed.member_visible')::bigint, 0::bigint,
  'a non-admin member of org A sees zero rows — the permissive policy is admin-only');

-- ── Own-org admin lifecycle: DELETE then re-claim with `domain` only ────────
do $$
declare
  owner_a uuid := current_setting('oed.owner_a')::uuid;
  deleted bigint;
  n bigint;
  st text;
  err text := 'no error';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);

  with del as (delete from public.org_email_domains returning id)
  select count(*) into deleted from del;
  perform set_config('oed.admin_own_deleted', deleted::text, true);

  -- Re-claim naming only `domain`; org_id comes from the fail-closed DEFAULT.
  insert into public.org_email_domains (domain) values ('mail2.org-a.example.test');
  select count(*), min(status) into n, st from public.org_email_domains;
  perform set_config('oed.admin_reclaimed', n::text, true);
  perform set_config('oed.admin_reclaimed_status', st, true);

  -- Naming a server-set-only column on INSERT fails on privilege, not CHECK.
  begin
    delete from public.org_email_domains;
    insert into public.org_email_domains (domain, status) values ('mail3.org-a.example.test', 'verified');
  exception when others then
    err := sqlstate;
  end;
  perform set_config('oed.admin_self_verify_err', err, true);

  -- A live UPDATE attempt, not just the catalog-privilege checks below: the
  -- grant matrix (no UPDATE grant on any column) must actually block a
  -- direct write, not just report that it should.
  err := 'no error';
  begin
    update public.org_email_domains set status = 'verified'
      where org_id = current_setting('oed.org_a')::uuid;
  exception when others then
    err := sqlstate;
  end;
  perform set_config('oed.admin_update_err', err, true);

  reset role;
end $$;

select is(current_setting('oed.admin_own_deleted')::bigint, 1::bigint,
  'org A admin can DELETE their own org''s row (exactly one)');
select is(current_setting('oed.admin_reclaimed')::bigint, 1::bigint,
  'org A admin can re-claim by inserting `domain` alone');
select is(current_setting('oed.admin_reclaimed_status'), 'not_started',
  'a re-claimed row starts at status = not_started (server-set default)');
select is(current_setting('oed.admin_self_verify_err'), '42501',
  'an admin INSERT naming `status` is rejected with insufficient_privilege (no self-verify at claim time)');
select is(current_setting('oed.admin_update_err'), '42501',
  'a live UPDATE of `status` by the row''s own org admin is rejected with insufficient_privilege, not just catalog-denied');

-- ── Grant matrix ────────────────────────────────────────────────────────────
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'status', 'update'),
  'authenticated may not UPDATE org_email_domains.status');
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'resend_domain_id', 'update'),
  'authenticated may not UPDATE org_email_domains.resend_domain_id');
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'dns_records', 'update'),
  'authenticated may not UPDATE org_email_domains.dns_records');
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'verified_at', 'update'),
  'authenticated may not UPDATE org_email_domains.verified_at');
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'last_checked_at', 'update'),
  'authenticated may not UPDATE org_email_domains.last_checked_at');
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'cleanup_failed_at', 'update'),
  'authenticated may not UPDATE org_email_domains.cleanup_failed_at');
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'domain', 'update'),
  'authenticated may not UPDATE org_email_domains.domain (immutable after insert)');
select ok(not has_table_privilege('authenticated', 'public.org_email_domains', 'update'),
  'authenticated holds no table-level UPDATE on org_email_domains');

select ok(has_column_privilege('authenticated', 'public.org_email_domains', 'domain', 'insert'),
  'authenticated may INSERT org_email_domains.domain');
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'status', 'insert'),
  'authenticated may not INSERT org_email_domains.status');
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'resend_domain_id', 'insert'),
  'authenticated may not INSERT org_email_domains.resend_domain_id');
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'dns_records', 'insert'),
  'authenticated may not INSERT org_email_domains.dns_records');
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'verified_at', 'insert'),
  'authenticated may not INSERT org_email_domains.verified_at');
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'last_checked_at', 'insert'),
  'authenticated may not INSERT org_email_domains.last_checked_at');
select ok(not has_column_privilege('authenticated', 'public.org_email_domains', 'cleanup_failed_at', 'insert'),
  'authenticated may not INSERT org_email_domains.cleanup_failed_at');

select ok(has_column_privilege('authenticated', 'public.org_email_domains', 'status', 'select'),
  'authenticated may SELECT org_email_domains.status');
select ok(has_column_privilege('authenticated', 'public.org_email_domains', 'cleanup_failed_at', 'select'),
  'authenticated may SELECT org_email_domains.cleanup_failed_at (the settings page shows the stuck state)');
select ok(has_table_privilege('authenticated', 'public.org_email_domains', 'select'),
  'authenticated may SELECT the whole org_email_domains row');
select ok(has_table_privilege('authenticated', 'public.org_email_domains', 'delete'),
  'authenticated may DELETE from org_email_domains (RLS narrows to own-org admins)');

select ok(not has_column_privilege('anon', 'public.org_email_domains', 'domain', 'select'),
  'anon may not SELECT org_email_domains.domain');
select ok(not has_table_privilege('anon', 'public.org_email_domains', 'select'),
  'anon holds no SELECT on org_email_domains');
select ok(not has_table_privilege('anon', 'public.org_email_domains', 'insert'),
  'anon holds no INSERT on org_email_domains');
select ok(not has_table_privilege('anon', 'public.org_email_domains', 'delete'),
  'anon holds no DELETE on org_email_domains');

-- ── Constraints (as postgres) ───────────────────────────────────────────────
select throws_ok(
  format($q$insert into public.org_email_domains (org_id, domain) values (%L, 'second.org-b.example.test')$q$,
         current_setting('oed.org_b')),
  '23505',
  null,
  'a second sending domain for the same org violates org_email_domains_org_key'
);
select throws_ok(
  format($q$insert into public.org_email_domains (org_id, domain) values (%L, 'Mail.Org-A.Example.Test')$q$,
         current_setting('oed.org_a')),
  '23514',
  null,
  'an uppercase domain violates org_email_domains_domain_shape'
);
select throws_ok(
  format($q$insert into public.org_email_domains (org_id, domain) values (%L, 'a.b')$q$,
         current_setting('oed.org_a')),
  '23514',
  null,
  'a too-short domain violates org_email_domains_domain_shape'
);
select throws_ok(
  format($q$insert into public.org_email_domains (org_id, domain, status) values (%L, 'x.org-a.example.test', 'made_up')$q$,
         current_setting('oed.org_a')),
  '23514',
  null,
  'a status outside Resend''s vocabulary violates the status CHECK'
);
-- cleanup_pending is the one status outside Resend's vocabulary: a row whose
-- provider-side removal failed keeps its resend_domain_id in this state
-- instead of being deleted, so it must pass the CHECK.
select lives_ok(
  format($q$update public.org_email_domains set status = 'cleanup_pending', cleanup_failed_at = now() where org_id = %L$q$,
         current_setting('oed.org_a')),
  'cleanup_pending is a valid status value'
);
select is(
  (select status from public.org_email_domains where org_id = current_setting('oed.org_a')::uuid),
  'cleanup_pending',
  'the cleanup_pending status persisted on org A''s row'
);


-- ── Atomic claim RPC ────────────────────────────────────────────────────────
-- org_email_domain_claim() is the only path that inserts under the
-- platform-wide cap. Pin its grant matrix (service_role only) and its
-- behaviour: the enablement flag, the cap, the unique-per-org index, and
-- that a refused claim inserts nothing.
select has_function('public', 'org_email_domain_claim', array['uuid', 'text', 'integer'],
  'org_email_domain_claim(uuid, text, integer) exists');
select is(
  (select prosecdef from pg_proc where oid = 'public.org_email_domain_claim(uuid, text, integer)'::regprocedure),
  true,
  'org_email_domain_claim is SECURITY DEFINER');
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc
    where oid = 'public.org_email_domain_claim(uuid, text, integer)'::regprocedure),
  'org_email_domain_claim pins an empty search_path');
select ok(
  not has_function_privilege('anon', 'public.org_email_domain_claim(uuid, text, integer)', 'execute'),
  'anon cannot execute org_email_domain_claim');
select ok(
  not has_function_privilege('authenticated', 'public.org_email_domain_claim(uuid, text, integer)', 'execute'),
  'authenticated cannot execute org_email_domain_claim');
select ok(
  has_function_privilege('service_role', 'public.org_email_domain_claim(uuid, text, integer)', 'execute'),
  'service_role can execute org_email_domain_claim');

-- A third org, enabled and holding no row. Two rows exist at this point
-- (org A, org B), so a cap of 2 is "full" and a cap of 3 has one free slot.
do $$
declare
  org_c uuid;
begin
  org_c := public.provision_organization('Email Domain Suite Org C', 'email-domain-suite-org-c', 'owner-c@emaildomain.example.test');
  update public.organizations set custom_email_domain_enabled = true where id = org_c;
  perform set_config('oed.org_c', org_c::text, true);
end $$;

select is((select count(*)::int from public.org_email_domains), 2,
  'fixture: two rows exist before the claim assertions');

select throws_ok(
  $q$select public.org_email_domain_claim(gen_random_uuid(), 'mail.nobody.example.test', 10)$q$,
  'ED001', null,
  'claim raises ED001 for an unknown organization');
select throws_ok(
  format($q$select public.org_email_domain_claim(%L, 'mail.org-a2.example.test', 10)$q$,
         current_setting('oed.org_a')),
  'ED002', null,
  'claim raises ED002 when custom domains are not enabled for the org');
select throws_ok(
  format($q$select public.org_email_domain_claim(%L, 'mail.org-c.example.test', 2)$q$,
         current_setting('oed.org_c')),
  'ED003', null,
  'claim raises ED003 when the platform-wide count is at the cap');
select is((select count(*)::int from public.org_email_domains), 2,
  'a refused claim inserts nothing');

select is(
  (select org_id from public.org_email_domain_claim(current_setting('oed.org_c')::uuid, 'mail.org-c.example.test', 3)),
  current_setting('oed.org_c')::uuid,
  'claim below the cap inserts and returns the row for the caller''s org');
select is(
  (select status from public.org_email_domains where org_id = current_setting('oed.org_c')::uuid),
  'not_started',
  'the claimed row starts in the default status');
select is((select count(*)::int from public.org_email_domains), 3,
  'the accepted claim inserted exactly one row');

select throws_ok(
  format($q$select public.org_email_domain_claim(%L, 'mail.org-c2.example.test', 10)$q$,
         current_setting('oed.org_c')),
  '23505', null,
  'a second claim for the same org raises unique_violation from the unique-per-org index');
select is((select count(*)::int from public.org_email_domains), 3,
  'the duplicate claim inserted nothing');

select * from finish();
rollback;
