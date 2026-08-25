-- org_domains suite (Phase 5 PR 2, CWA-66 / #359). Pins the RLS, GRANT, and
-- resolver boundary on the custom-domain table:
--   * restrictive isolation floor + admin-only permissive policy — an org A
--     admin sees only org A's row, a cross-org DELETE is a true 0-row no-op,
--     and a plain (non-admin) member of org A sees zero rows even in their
--     own org;
--   * the second restrictive policy — an attached row (attached_at set) or a
--     'removing' tombstone survives a direct DELETE by its own org's admin
--     (0 rows affected), so Vercel state can never be orphaned by a plain
--     delete;
--   * the grant matrix — authenticated may SELECT the whole row, INSERT
--     `domain` only, DELETE (bounded above), and UPDATE nothing (status /
--     verification_token / verified_at / attached_at / attach_claimed_at /
--     attach_claim_token / last_checked_at are server-set-only, and `domain`
--     is immutable after insert); anon holds no table privilege at all;
--   * the global (deliberately NOT per-org) partial unique on
--     verified/removing domains, the per-org (org_id, domain) unique, and
--     the domain_shape CHECK;
--   * app_org_slug_for_host(): resolves only verified domains of active
--     orgs, NULL (fail-closed) for everything else, with no normalization.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/org_domains_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Two orgs, each with a founding admin who signs up after provisioning
-- (handle_new_user() resolves them via the approved access_requests row),
-- plus a plain member of org A. Org A holds a verified AND attached row (for
-- the attach-bound DELETE pin); org B holds a plain pending claim.
do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
begin
  org_a := public.provision_organization('Org Domains Suite Org A', 'org-domains-suite-org-a', 'owner-a@orgdomains.example.test');
  org_b := public.provision_organization('Org Domains Suite Org B', 'org-domains-suite-org-b', 'owner-b@orgdomains.example.test');

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@orgdomains.example.test'),
    (owner_b, 'owner-b@orgdomains.example.test');

  insert into public.access_requests (org_id, name, email, status)
    values (org_a, 'Plain Member', 'member-a@orgdomains.example.test', 'approved');
  insert into auth.users (id, email) values (member_a, 'member-a@orgdomains.example.test');

  -- Seeded as postgres: fixture setup, not the behaviour under test.
  insert into public.org_domains (org_id, domain, status, verified_at, attached_at)
    values (org_a, 'site.org-a.example.test', 'verified', now(), now());
  insert into public.org_domains (org_id, domain, status)
    values (org_b, 'site.org-b.example.test', 'pending');

  perform set_config('od.org_a', org_a::text, true);
  perform set_config('od.org_b', org_b::text, true);
  perform set_config('od.owner_a', owner_a::text, true);
  perform set_config('od.owner_b', owner_b::text, true);
  perform set_config('od.member_a', member_a::text, true);
end $$;

select is(
  (select role from public.profiles where id = current_setting('od.owner_a')::uuid),
  'admin',
  'fixture: owner A signed up as the founding admin of org A'
);
select is(
  (select role from public.profiles where id = current_setting('od.member_a')::uuid),
  'member',
  'fixture: member A signed up as a plain member of org A'
);

-- ── Structural pins ─────────────────────────────────────────────────────────
select ok(
  (select relrowsecurity from pg_class where oid = 'public.org_domains'::regclass),
  'RLS is enabled on org_domains'
);
select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'org_domains'
      and permissive = 'RESTRICTIVE' and qual like '%app\_request\_org\_id%'),
  1,
  'exactly one restrictive isolation policy predicates on app_request_org_id()'
);
-- Two restrictive policies total — one more than the org_email_domains
-- template: the attach-bound delete policy is restrictive too, and it must
-- NOT reference org_id or schema_tenancy_lint.sql's exactly-one count breaks.
select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'org_domains'
      and permissive = 'RESTRICTIVE'),
  2,
  'org_domains carries exactly two restrictive policies (isolation floor + attach-bound delete)'
);
select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'org_domains'
      and policyname = 'Admins delete unattached org domains'
      and permissive = 'RESTRICTIVE' and cmd = 'DELETE'
      and qual not like '%org\_id%'),
  1,
  'the attach-bound delete policy is restrictive, FOR DELETE only, and does not reference org_id'
);
select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'org_domains'
      and policyname = 'Admins manage org domains'
      and permissive = 'PERMISSIVE' and cmd = 'ALL'
      and qual like '%is\_admin%' and with_check like '%is\_admin%'),
  1,
  'the permissive policy is admin-only on both USING and WITH CHECK'
);

-- ── Isolation, as org A''s admin ────────────────────────────────────────────
do $$
declare
  org_b uuid := current_setting('od.org_b')::uuid;
  owner_a uuid := current_setting('od.owner_a')::uuid;
  n bigint;
  d text;
  deleted bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);

  select count(*) into n from public.org_domains;
  perform set_config('od.admin_visible', n::text, true);

  select domain into d from public.org_domains limit 1;
  perform set_config('od.admin_domain', coalesce(d, '<none>'), true);

  select count(*) into n from public.org_domains where org_id = org_b;
  perform set_config('od.admin_cross_visible', n::text, true);

  -- Cross-org DELETE: assert the row COUNT, not the absence of an error — a
  -- filtered write is a silent success in this codebase.
  with del as (
    delete from public.org_domains where org_id = org_b returning id
  )
  select count(*) into deleted from del;
  perform set_config('od.admin_cross_deleted', deleted::text, true);

  reset role;
end $$;

select is(current_setting('od.admin_visible')::bigint, 1::bigint,
  'org A admin sees exactly one org_domains row');
select is(current_setting('od.admin_domain'), 'site.org-a.example.test',
  'the row org A''s admin sees is org A''s own domain');
select is(current_setting('od.admin_cross_visible')::bigint, 0::bigint,
  'an explicit where org_id = org B still returns zero rows');
select is(current_setting('od.admin_cross_deleted')::bigint, 0::bigint,
  'a cross-org DELETE affects zero rows');
select is(
  (select count(*) from public.org_domains where org_id = current_setting('od.org_b')::uuid),
  1::bigint,
  'org B''s row survives the cross-org DELETE (checked as postgres)'
);

-- ── Isolation, as org B''s admin (mirrors org A''s block: the policy is
--    symmetric, so this is completeness, not a distinct code path) ──────────
do $$
declare
  owner_b uuid := current_setting('od.owner_b')::uuid;
  n bigint;
  d text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b, 'role', 'authenticated')::text, true);

  select count(*) into n from public.org_domains;
  perform set_config('od.owner_b_visible', n::text, true);

  select domain into d from public.org_domains limit 1;
  perform set_config('od.owner_b_domain', coalesce(d, '<none>'), true);

  reset role;
end $$;

select is(current_setting('od.owner_b_visible')::bigint, 1::bigint,
  'org B admin sees exactly one org_domains row (their own)');
select is(current_setting('od.owner_b_domain'), 'site.org-b.example.test',
  'the row org B''s admin sees is org B''s own domain');

-- ── Non-admin isolation, as org A''s plain member ───────────────────────────
do $$
declare
  member_a uuid := current_setting('od.member_a')::uuid;
  n bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a, 'role', 'authenticated')::text, true);
  select count(*) into n from public.org_domains;
  perform set_config('od.member_visible', n::text, true);
  reset role;
end $$;

select is(current_setting('od.member_visible')::bigint, 0::bigint,
  'a non-admin member of org A sees zero rows — the permissive policy is admin-only');

-- ── Attach-bound DELETE: an attached row survives its own admin ─────────────
-- The §7.1 "domain release" pin, scoped to what PR 2 alone can test: no
-- worker or remove route exists yet, so pin the policy boundary directly.
do $$
declare
  owner_a uuid := current_setting('od.owner_a')::uuid;
  deleted bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);

  with del as (
    delete from public.org_domains where domain = 'site.org-a.example.test' returning id
  )
  select count(*) into deleted from del;
  perform set_config('od.attached_deleted', deleted::text, true);

  reset role;
end $$;

select is(current_setting('od.attached_deleted')::bigint, 0::bigint,
  'a direct DELETE of an attached row by its own org''s admin affects zero rows');
select is(
  (select count(*) from public.org_domains where domain = 'site.org-a.example.test'),
  1::bigint,
  'the attached row survives (checked as postgres)'
);

-- Detach as postgres (simulating a never-attached verified row) and repeat:
-- unattached rows delete fine through the same grant.
update public.org_domains set attached_at = null
  where domain = 'site.org-a.example.test';

do $$
declare
  owner_a uuid := current_setting('od.owner_a')::uuid;
  deleted bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);

  with del as (
    delete from public.org_domains where domain = 'site.org-a.example.test' returning id
  )
  select count(*) into deleted from del;
  perform set_config('od.unattached_deleted', deleted::text, true);

  reset role;
end $$;

select is(current_setting('od.unattached_deleted')::bigint, 1::bigint,
  'once attached_at is NULL the same admin DELETE removes exactly one row');

-- ── Own-org admin lifecycle: re-claim with `domain` only ────────────────────
do $$
declare
  n bigint;
  st text;
  err text := 'no error';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('od.owner_a')::uuid, 'role', 'authenticated')::text, true);

  -- Re-claim naming only `domain`; org_id comes from the fail-closed DEFAULT.
  insert into public.org_domains (domain) values ('site2.org-a.example.test');
  select count(*), min(status::text) into n, st from public.org_domains;
  perform set_config('od.admin_reclaimed', n::text, true);
  perform set_config('od.admin_reclaimed_status', st, true);

  -- Naming a server-set-only column on INSERT fails on privilege, not CHECK.
  begin
    insert into public.org_domains (domain, status) values ('site3.org-a.example.test', 'verified');
  exception when others then
    err := sqlstate;
  end;
  perform set_config('od.admin_self_verify_err', err, true);

  -- A live UPDATE attempt, not just the catalog-privilege checks below: the
  -- grant matrix (no UPDATE grant on any column) must actually block a
  -- direct write, not just report that it should.
  err := 'no error';
  begin
    update public.org_domains set status = 'verified'
      where org_id = current_setting('od.org_a')::uuid;
  exception when others then
    err := sqlstate;
  end;
  perform set_config('od.admin_update_err', err, true);

  reset role;
end $$;

select is(current_setting('od.admin_reclaimed')::bigint, 1::bigint,
  'org A admin can claim by inserting `domain` alone');
select is(current_setting('od.admin_reclaimed_status'), 'pending',
  'a fresh claim starts at status = pending (server-set default)');
select is(current_setting('od.admin_self_verify_err'), '42501',
  'an admin INSERT naming `status` is rejected with insufficient_privilege (no self-verify at claim time)');
select is(current_setting('od.admin_update_err'), '42501',
  'a live UPDATE of `status` by the row''s own org admin is rejected with insufficient_privilege, not just catalog-denied');
select ok(
  (select verification_token ~ '^[0-9a-f]{32}$'
     from public.org_domains where domain = 'site2.org-a.example.test'),
  'a fresh claim gets a server-generated 32-hex verification_token (checked as postgres)'
);

-- ── Grant matrix ────────────────────────────────────────────────────────────
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'status', 'update'),
  'authenticated may not UPDATE org_domains.status');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'verification_token', 'update'),
  'authenticated may not UPDATE org_domains.verification_token');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'verified_at', 'update'),
  'authenticated may not UPDATE org_domains.verified_at');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'attached_at', 'update'),
  'authenticated may not UPDATE org_domains.attached_at');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'attach_claimed_at', 'update'),
  'authenticated may not UPDATE org_domains.attach_claimed_at');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'attach_claim_token', 'update'),
  'authenticated may not UPDATE org_domains.attach_claim_token');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'last_checked_at', 'update'),
  'authenticated may not UPDATE org_domains.last_checked_at');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'domain', 'update'),
  'authenticated may not UPDATE org_domains.domain (immutable after insert)');
select ok(not has_table_privilege('authenticated', 'public.org_domains', 'update'),
  'authenticated holds no table-level UPDATE on org_domains');

select ok(has_column_privilege('authenticated', 'public.org_domains', 'domain', 'insert'),
  'authenticated may INSERT org_domains.domain');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'status', 'insert'),
  'authenticated may not INSERT org_domains.status');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'verification_token', 'insert'),
  'authenticated may not INSERT org_domains.verification_token');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'verified_at', 'insert'),
  'authenticated may not INSERT org_domains.verified_at');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'attached_at', 'insert'),
  'authenticated may not INSERT org_domains.attached_at');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'attach_claimed_at', 'insert'),
  'authenticated may not INSERT org_domains.attach_claimed_at');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'attach_claim_token', 'insert'),
  'authenticated may not INSERT org_domains.attach_claim_token');
select ok(not has_column_privilege('authenticated', 'public.org_domains', 'last_checked_at', 'insert'),
  'authenticated may not INSERT org_domains.last_checked_at');

select ok(has_column_privilege('authenticated', 'public.org_domains', 'status', 'select'),
  'authenticated may SELECT org_domains.status');
select ok(has_table_privilege('authenticated', 'public.org_domains', 'select'),
  'authenticated may SELECT the whole org_domains row');
select ok(has_table_privilege('authenticated', 'public.org_domains', 'delete'),
  'authenticated may DELETE from org_domains (RLS narrows to own-org admins and unattached rows)');

select ok(not has_column_privilege('anon', 'public.org_domains', 'domain', 'select'),
  'anon may not SELECT org_domains.domain');
select ok(not has_table_privilege('anon', 'public.org_domains', 'select'),
  'anon holds no SELECT on org_domains');
select ok(not has_table_privilege('anon', 'public.org_domains', 'insert'),
  'anon holds no INSERT on org_domains');
select ok(not has_table_privilege('anon', 'public.org_domains', 'delete'),
  'anon holds no DELETE on org_domains');

-- ── Constraints (as postgres) ───────────────────────────────────────────────
select throws_ok(
  format($q$insert into public.org_domains (org_id, domain) values (%L, 'Site.Org-A.Example.Test')$q$,
         current_setting('od.org_a')),
  '23514',
  null,
  'an uppercase domain violates org_domains_domain_shape'
);
select throws_ok(
  format($q$insert into public.org_domains (org_id, domain) values (%L, 'a.b')$q$,
         current_setting('od.org_a')),
  '23514',
  null,
  'a too-short domain violates org_domains_domain_shape'
);
-- status is an ENUM (org_domain_status), not text+CHECK like the
-- org_email_domains sibling: a bad literal fails the cast (22P02,
-- invalid_text_representation), it never reaches a CHECK (23514).
select throws_ok(
  format($q$insert into public.org_domains (org_id, domain, status) values (%L, 'x.org-a.example.test', 'made_up')$q$,
         current_setting('od.org_a')),
  '22P02',
  null,
  'a status outside the enum fails the cast (22P02), not a CHECK'
);
select throws_ok(
  format($q$insert into public.org_domains (org_id, domain) values (%L, 'site.org-b.example.test')$q$,
         current_setting('od.org_b')),
  '23505',
  null,
  'a repeat claim of the same domain within one org violates org_domains_org_domain_key'
);

-- The global partial unique (deliberately NOT per-org — DNS names are
-- globally unique): both orgs may claim the same name, only one may hold it
-- verified. The second org's claim inserts fine as 'pending' and fails at
-- the moment it would go 'verified'.
do $$
begin
  insert into public.org_domains (org_id, domain, status)
    values (current_setting('od.org_a')::uuid, 'shared.example.test', 'verified');
  insert into public.org_domains (org_id, domain, status)
    values (current_setting('od.org_b')::uuid, 'shared.example.test', 'pending');
end $$;

select is(
  (select count(*) from public.org_domains where domain = 'shared.example.test'),
  2::bigint,
  'two orgs may both hold a claim on the same domain while only one is verified'
);
select throws_ok(
  format($q$update public.org_domains set status = 'verified' where org_id = %L and domain = 'shared.example.test'$q$,
         current_setting('od.org_b')),
  '23505',
  null,
  'a second org verifying an already-verified domain violates org_domains_verified_domain_key'
);

-- ── Resolver: app_org_slug_for_host() ───────────────────────────────────────
-- SECURITY DEFINER, so the invoking role is irrelevant to the rows it sees;
-- the execute-grant matrix below pins who may call it.
do $$
declare
  org_a uuid := current_setting('od.org_a')::uuid;
  org_b uuid := current_setting('od.org_b')::uuid;
begin
  insert into public.org_domains (org_id, domain, status)
    values (org_a, 'resolve.org-a.example.test', 'verified');
  insert into public.org_domains (org_id, domain, status)
    values (org_b, 'failed.org-b.example.test', 'failed');
  insert into public.org_domains (org_id, domain, status)
    values (org_b, 'removing.org-b.example.test', 'removing');
  insert into public.org_domains (org_id, domain, status)
    values (org_b, 'suspended.org-b.example.test', 'verified');
end $$;

select is(public.app_org_slug_for_host('resolve.org-a.example.test'),
  'org-domains-suite-org-a',
  'a verified domain of an active org resolves to the org slug');
select is(public.app_org_slug_for_host('nope.example.test'), null::text,
  'an unknown host resolves NULL');
select is(public.app_org_slug_for_host('site.org-b.example.test'), null::text,
  'a pending claim resolves NULL');
select is(public.app_org_slug_for_host('failed.org-b.example.test'), null::text,
  'a failed claim resolves NULL');
select is(public.app_org_slug_for_host('removing.org-b.example.test'), null::text,
  'a removing tombstone resolves NULL');
select is(public.app_org_slug_for_host(''), null::text,
  'an empty-string host resolves NULL, not an error');
-- The §5.1 no-normalization contract: rows are stored canonical and the
-- caller canonicalizes once, so non-canonical input matches nothing.
select is(public.app_org_slug_for_host('resolve.org-a.example.test.'), null::text,
  'a trailing-dot host does not match its canonical stored form (no normalization in the resolver)');
select is(public.app_org_slug_for_host('Resolve.Org-A.Example.Test'), null::text,
  'a mixed-case host does not match its lowercase stored form (no normalization in the resolver)');

-- D4: a suspended org's verified domain goes dark rather than routing.
select is(public.app_org_slug_for_host('suspended.org-b.example.test'),
  'org-domains-suite-org-b',
  'org B''s verified domain resolves while org B is active');
update public.organizations set status = 'suspended'
  where id = current_setting('od.org_b')::uuid;
select is(public.app_org_slug_for_host('suspended.org-b.example.test'), null::text,
  'a verified domain of a suspended org resolves NULL (D4: go dark)');

select ok(has_function_privilege('anon', 'public.app_org_slug_for_host(text)', 'execute'),
  'anon may execute app_org_slug_for_host()');
select ok(has_function_privilege('authenticated', 'public.app_org_slug_for_host(text)', 'execute'),
  'authenticated may execute app_org_slug_for_host()');
select ok(has_function_privilege('service_role', 'public.app_org_slug_for_host(text)', 'execute'),
  'service_role may execute app_org_slug_for_host()');

select * from finish();
rollback;
