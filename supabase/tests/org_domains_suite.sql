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
--     verified/removing domains, the partial per-org (org_id, domain) unique, and
--     the domain_shape CHECK;
--   * app_org_slug_for_host(): resolves only verified domains of active
--     orgs, NULL (fail-closed) for everything else, with no normalization;
--   * the attachment worker's SQL (added with the admin UI / worker PR):
--     the single-flight lease claim (fresh / contended / expired), the
--     fenced attached_at stamp (wrong token, expired lease, wrong domain,
--     already attached), the remove route's `removing` transition (keeps
--     attached_at, clears the lease, idempotent), the detach lease and the
--     tombstone hard-delete predicate, the /platform "clear expired claim"
--     predicate, and the cross-org reclaim block until the tombstone is
--     gone — every write asserted by ROW COUNT, since a filtered write is
--     a silent success in this codebase.
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
-- The org FK must be ON DELETE RESTRICT: attached rows and 'removing'
-- tombstones are the §7.1 detach workflow's only record of a Vercel-side
-- attachment, and FK cascades bypass RLS DELETE policies entirely, so a
-- cascading org delete would orphan the Vercel project domain untracked.
select is(
  (select confdeltype::text from pg_catalog.pg_constraint
    where conrelid = 'public.org_domains'::regclass
      and contype = 'f' and conname = 'org_domains_org_id_fkey'),
  'r',
  'org_domains.org_id FK is ON DELETE RESTRICT — org deletion waits for domain release'
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

-- The per-org unique is partial (status <> 'removing'): an org's own
-- 'removing' tombstone must not block its fresh re-claim of the same name
-- (§7.1 remove-then-re-add). The re-claim inserts as 'pending'; going
-- 'verified' is what the global partial unique blocks until the tombstone
-- is hard-deleted.
do $$
begin
  insert into public.org_domains (org_id, domain, status, verified_at, attached_at)
    values (current_setting('od.org_a')::uuid, 'reclaim.example.test', 'removing', now(), now());
  insert into public.org_domains (org_id, domain, status)
    values (current_setting('od.org_a')::uuid, 'reclaim.example.test', 'pending');
end $$;
select is(
  (select count(*) from public.org_domains
    where org_id = current_setting('od.org_a')::uuid
      and domain = 'reclaim.example.test'),
  2::bigint,
  'a fresh same-org claim coexists with its own removing tombstone (partial per-org unique)'
);
select throws_ok(
  format($q$update public.org_domains set status = 'verified'
            where org_id = %L and domain = 'reclaim.example.test' and status = 'pending'$q$,
         current_setting('od.org_a')),
  '23505',
  null,
  'the re-claim cannot go verified while the removing tombstone still holds the global unique'
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

-- ── Attachment worker SQL: lease, fenced stamp, remove/detach (as postgres) ──
-- The worker runs with the service key (BYPASSRLS), so the statements below
-- run as postgres: the predicates ARE the boundary, and each one is asserted
-- by the row count it affects, never by the absence of an error. These are
-- the exact statements supabase/functions/_shared/domain-lease.ts issues
-- through PostgREST (pinned there by tests/domain_lease_test.ts); pgTAP has
-- no Deno runtime, so the SQL is run directly.
do $$
declare
  org_a uuid := current_setting('od.org_a')::uuid;
  org_b uuid := current_setting('od.org_b')::uuid;
  row_id uuid;
  n bigint;
  tok1 text;
  tok2 text;
  tok3 text;
  kept timestamptz;
begin
  insert into public.org_domains (org_id, domain, status, verified_at)
    values (org_a, 'lease.org-a.example.test', 'verified', now())
    returning id into row_id;
  perform set_config('od.lease_row', row_id::text, true);

  -- Fresh claim: free lease, verified, unattached → one row, a token back.
  with c as (
    update public.org_domains
       set attach_claimed_at = now(), attach_claim_token = gen_random_uuid()
     where id = row_id and org_id = org_a
       and status = 'verified' and attached_at is null
       and (attach_claimed_at is null or attach_claimed_at < now() - interval '10 minutes')
     returning attach_claim_token
  )
  select count(*), max(attach_claim_token::text) into n, tok1 from c;
  perform set_config('od.claim_fresh', n::text, true);
  perform set_config('od.claim_fresh_token', coalesce(tok1, '<null>'), true);

  -- Contended: the lease is live → zero rows, token unchanged.
  with c as (
    update public.org_domains
       set attach_claimed_at = now(), attach_claim_token = gen_random_uuid()
     where id = row_id and org_id = org_a
       and status = 'verified' and attached_at is null
       and (attach_claimed_at is null or attach_claimed_at < now() - interval '10 minutes')
     returning attach_claim_token
  )
  select count(*) into n from c;
  perform set_config('od.claim_contended', n::text, true);
  select attach_claim_token::text into tok2 from public.org_domains where id = row_id;
  perform set_config('od.claim_contended_same_token', (tok2 = tok1)::text, true);

  -- Cross-org: org B's id on org A's row → zero rows (the org_id predicate).
  with c as (
    update public.org_domains
       set attach_claimed_at = now() - interval '11 minutes', attach_claim_token = gen_random_uuid()
     where id = row_id and org_id = org_b
     returning id
  )
  select count(*) into n from c;
  perform set_config('od.claim_cross_org', n::text, true);

  -- Expired: age the lease past the window → a fresh claim succeeds with a NEW token.
  update public.org_domains set attach_claimed_at = now() - interval '11 minutes' where id = row_id;
  with c as (
    update public.org_domains
       set attach_claimed_at = now(), attach_claim_token = gen_random_uuid()
     where id = row_id and org_id = org_a
       and status = 'verified' and attached_at is null
       and (attach_claimed_at is null or attach_claimed_at < now() - interval '10 minutes')
     returning attach_claim_token
  )
  select count(*), max(attach_claim_token::text) into n, tok2 from c;
  perform set_config('od.claim_expired', n::text, true);
  perform set_config('od.claim_expired_new_token', (tok2 is distinct from tok1)::text, true);

  -- Fenced stamp with the SUPERSEDED token (tok1) → zero rows.
  with st as (
    update public.org_domains set attached_at = now()
     where id = row_id and org_id = org_a
       and attach_claim_token = tok1::uuid and domain = 'lease.org-a.example.test'
       and status = 'verified' and attached_at is null
       and attach_claimed_at > clock_timestamp() - interval '10 minutes'
     returning id
  )
  select count(*) into n from st;
  perform set_config('od.stamp_wrong_token', n::text, true);

  -- Right token but the lease has EXPIRED with no replacement → zero rows.
  update public.org_domains set attach_claimed_at = now() - interval '11 minutes' where id = row_id;
  with st as (
    update public.org_domains set attached_at = now()
     where id = row_id and org_id = org_a
       and attach_claim_token = tok2::uuid and domain = 'lease.org-a.example.test'
       and status = 'verified' and attached_at is null
       and attach_claimed_at > clock_timestamp() - interval '10 minutes'
     returning id
  )
  select count(*) into n from st;
  perform set_config('od.stamp_expired_lease', n::text, true);
  update public.org_domains set attach_claimed_at = now() where id = row_id;

  -- Right token, live lease, WRONG domain → zero rows.
  with st as (
    update public.org_domains set attached_at = now()
     where id = row_id and org_id = org_a
       and attach_claim_token = tok2::uuid and domain = 'other.org-a.example.test'
       and status = 'verified' and attached_at is null
       and attach_claimed_at > clock_timestamp() - interval '10 minutes'
     returning id
  )
  select count(*) into n from st;
  perform set_config('od.stamp_wrong_domain', n::text, true);
  perform set_config('od.stamp_still_unattached',
    (select (attached_at is null)::text from public.org_domains where id = row_id), true);

  -- Right token, live lease, right domain → exactly one row, attached_at set.
  with st as (
    update public.org_domains set attached_at = now()
     where id = row_id and org_id = org_a
       and attach_claim_token = tok2::uuid and domain = 'lease.org-a.example.test'
       and status = 'verified' and attached_at is null
       and attach_claimed_at > clock_timestamp() - interval '10 minutes'
     returning id
  )
  select count(*) into n from st;
  perform set_config('od.stamp_ok', n::text, true);
  perform set_config('od.stamp_ok_attached',
    (select (attached_at is not null)::text from public.org_domains where id = row_id), true);

  -- A second stamp on the now-attached row → zero rows (attached_at is null).
  with st as (
    update public.org_domains set attached_at = now()
     where id = row_id and org_id = org_a
       and attach_claim_token = tok2::uuid and domain = 'lease.org-a.example.test'
       and status = 'verified' and attached_at is null
       and attach_claimed_at > clock_timestamp() - interval '10 minutes'
     returning id
  )
  select count(*) into n from st;
  perform set_config('od.stamp_twice', n::text, true);

  -- An attach claim on an attached row → zero rows, even with an expired lease.
  update public.org_domains set attach_claimed_at = now() - interval '11 minutes' where id = row_id;
  with c as (
    update public.org_domains
       set attach_claimed_at = now(), attach_claim_token = gen_random_uuid()
     where id = row_id and org_id = org_a
       and status = 'verified' and attached_at is null
       and (attach_claimed_at is null or attach_claimed_at < now() - interval '10 minutes')
     returning attach_claim_token
  )
  select count(*) into n from c;
  perform set_config('od.claim_attached', n::text, true);

  -- ── Remove route: verified+attached → 'removing', keeping attached_at ──
  select attached_at into kept from public.org_domains where id = row_id;
  with r as (
    update public.org_domains
       set status = 'removing', attach_claimed_at = null, attach_claim_token = null
     where id = row_id and org_id = org_a
       and status = 'verified' and attached_at is not null
     returning id
  )
  select count(*) into n from r;
  perform set_config('od.remove_transition', n::text, true);
  perform set_config('od.remove_keeps_attached_at',
    (select (attached_at = kept)::text from public.org_domains where id = row_id), true);
  perform set_config('od.remove_clears_lease',
    (select (attach_claimed_at is null and attach_claim_token is null)::text
       from public.org_domains where id = row_id), true);

  -- The same transition again → zero rows (the route treats it as idempotent).
  with r as (
    update public.org_domains
       set status = 'removing', attach_claimed_at = null, attach_claim_token = null
     where id = row_id and org_id = org_a
       and status = 'verified' and attached_at is not null
     returning id
  )
  select count(*) into n from r;
  perform set_config('od.remove_twice', n::text, true);

  -- An ATTACH claim on the tombstone → zero rows (status = 'verified').
  with c as (
    update public.org_domains
       set attach_claimed_at = now(), attach_claim_token = gen_random_uuid()
     where id = row_id and org_id = org_a
       and status = 'verified' and attached_at is null
       and (attach_claimed_at is null or attach_claimed_at < now() - interval '10 minutes')
     returning attach_claim_token
  )
  select count(*) into n from c;
  perform set_config('od.attach_claim_on_removing', n::text, true);

  -- ── Detach: the same lease on status = 'removing', no attached_at gate ──
  with c as (
    update public.org_domains
       set attach_claimed_at = now(), attach_claim_token = gen_random_uuid()
     where id = row_id and org_id = org_a
       and status = 'removing'
       and (attach_claimed_at is null or attach_claimed_at < now() - interval '10 minutes')
     returning attach_claim_token
  )
  select count(*), max(attach_claim_token::text) into n, tok3 from c;
  perform set_config('od.detach_claim', n::text, true);

  -- Hard-delete with a STALE token → zero rows, the tombstone survives.
  with d as (
    delete from public.org_domains
     where id = row_id and org_id = org_a and status = 'removing'
       and attach_claim_token = tok2::uuid
     returning id
  )
  select count(*) into n from d;
  perform set_config('od.hard_delete_stale', n::text, true);

  -- Hard-delete with the right token but the WRONG org → zero rows.
  with d as (
    delete from public.org_domains
     where id = row_id and org_id = org_b and status = 'removing'
       and attach_claim_token = tok3::uuid
     returning id
  )
  select count(*) into n from d;
  perform set_config('od.hard_delete_cross_org', n::text, true);
  perform set_config('od.tombstone_survives',
    (select count(*) from public.org_domains where id = row_id)::text, true);

  -- Hard-delete with the full fenced predicate → exactly one row, gone.
  with d as (
    delete from public.org_domains
     where id = row_id and org_id = org_a and status = 'removing'
       and attach_claim_token = tok3::uuid
     returning id
  )
  select count(*) into n from d;
  perform set_config('od.hard_delete_ok', n::text, true);
  perform set_config('od.tombstone_gone',
    (select count(*) from public.org_domains where id = row_id)::text, true);
end $$;

select is(current_setting('od.claim_fresh')::bigint, 1::bigint,
  'worker: a fresh attach claim on a verified, unattached row affects exactly one row');
select isnt(current_setting('od.claim_fresh_token'), '<null>',
  'worker: the fresh claim returns a non-null claim token');
select is(current_setting('od.claim_contended')::bigint, 0::bigint,
  'worker: a second claim while the lease is live affects zero rows');
select is(current_setting('od.claim_contended_same_token'), 'true',
  'worker: the contended claim leaves the live token untouched');
select is(current_setting('od.claim_cross_org')::bigint, 0::bigint,
  'worker: a claim carrying another org''s org_id affects zero rows');
select is(current_setting('od.claim_expired')::bigint, 1::bigint,
  'worker: once the lease is older than the window a fresh claim succeeds');
select is(current_setting('od.claim_expired_new_token'), 'true',
  'worker: the re-claim mints a new token (the old one is superseded)');
select is(current_setting('od.stamp_wrong_token')::bigint, 0::bigint,
  'worker: the attached_at stamp with a superseded token affects zero rows');
select is(current_setting('od.stamp_expired_lease')::bigint, 0::bigint,
  'worker: the stamp with the right token but an expired lease affects zero rows');
select is(current_setting('od.stamp_wrong_domain')::bigint, 0::bigint,
  'worker: the stamp for a different domain than the row''s affects zero rows');
select is(current_setting('od.stamp_still_unattached'), 'true',
  'worker: after three refused stamps attached_at is still NULL');
select is(current_setting('od.stamp_ok')::bigint, 1::bigint,
  'worker: the stamp with the live token, live lease and claimed domain affects exactly one row');
select is(current_setting('od.stamp_ok_attached'), 'true',
  'worker: the accepted stamp sets attached_at');
select is(current_setting('od.stamp_twice')::bigint, 0::bigint,
  'worker: a second stamp on an attached row affects zero rows');
select is(current_setting('od.claim_attached')::bigint, 0::bigint,
  'worker: an attach claim on an already-attached row affects zero rows');
select is(current_setting('od.remove_transition')::bigint, 1::bigint,
  'remove route: verified+attached → removing affects exactly one row');
select is(current_setting('od.remove_keeps_attached_at'), 'true',
  'remove route: the removing transition keeps attached_at (the "Vercel cleanup owed" marker)');
select is(current_setting('od.remove_clears_lease'), 'true',
  'remove route: the removing transition clears both lease columns');
select is(current_setting('od.remove_twice')::bigint, 0::bigint,
  'remove route: repeating the transition on a tombstone affects zero rows (idempotent)');
select is(current_setting('od.attach_claim_on_removing')::bigint, 0::bigint,
  'worker: an attach claim on a removing tombstone affects zero rows');
select is(current_setting('od.detach_claim')::bigint, 1::bigint,
  'worker: the detach claim on a removing tombstone affects exactly one row (no attached_at gate)');
select is(current_setting('od.hard_delete_stale')::bigint, 0::bigint,
  'worker: the tombstone hard-delete with a stale token affects zero rows');
select is(current_setting('od.hard_delete_cross_org')::bigint, 0::bigint,
  'worker: the tombstone hard-delete with another org''s org_id affects zero rows');
select is(current_setting('od.tombstone_survives')::bigint, 1::bigint,
  'worker: the tombstone survives both refused deletes');
select is(current_setting('od.hard_delete_ok')::bigint, 1::bigint,
  'worker: the tombstone hard-delete with (id, org_id, removing, token) affects exactly one row');
select is(current_setting('od.tombstone_gone')::bigint, 0::bigint,
  'worker: the tombstone is gone after cleanup completes');

-- ── /platform retry: clears an EXPIRED lease only ───────────────────────────
do $$
declare
  org_a uuid := current_setting('od.org_a')::uuid;
  row_id uuid;
  n bigint;
begin
  insert into public.org_domains (org_id, domain, status, verified_at, attach_claimed_at, attach_claim_token)
    values (org_a, 'retry.org-a.example.test', 'verified', now(), now(), gen_random_uuid())
    returning id into row_id;

  -- Live lease → zero rows, lease intact (would otherwise race the worker).
  with r as (
    update public.org_domains set attach_claimed_at = null, attach_claim_token = null
     where id = row_id and org_id = org_a
       and status = 'verified' and attached_at is null
       and attach_claimed_at < now() - interval '10 minutes'
     returning id
  )
  select count(*) into n from r;
  perform set_config('od.retry_live', n::text, true);
  perform set_config('od.retry_live_intact',
    (select (attach_claim_token is not null)::text from public.org_domains where id = row_id), true);

  -- Expired lease → exactly one row, both columns cleared.
  update public.org_domains set attach_claimed_at = now() - interval '11 minutes' where id = row_id;
  with r as (
    update public.org_domains set attach_claimed_at = null, attach_claim_token = null
     where id = row_id and org_id = org_a
       and status = 'verified' and attached_at is null
       and attach_claimed_at < now() - interval '10 minutes'
     returning id
  )
  select count(*) into n from r;
  perform set_config('od.retry_expired', n::text, true);
  perform set_config('od.retry_expired_cleared',
    (select (attach_claimed_at is null and attach_claim_token is null)::text
       from public.org_domains where id = row_id), true);

  -- No lease at all → zero rows (nothing to clear; NULL < cutoff is not true).
  with r as (
    update public.org_domains set attach_claimed_at = null, attach_claim_token = null
     where id = row_id and org_id = org_a
       and status = 'verified' and attached_at is null
       and attach_claimed_at < now() - interval '10 minutes'
     returning id
  )
  select count(*) into n from r;
  perform set_config('od.retry_none', n::text, true);
end $$;

select is(current_setting('od.retry_live')::bigint, 0::bigint,
  'platform retry: a live lease is left alone (zero rows)');
select is(current_setting('od.retry_live_intact'), 'true',
  'platform retry: the live claim token survives');
select is(current_setting('od.retry_expired')::bigint, 1::bigint,
  'platform retry: an expired lease is cleared (exactly one row)');
select is(current_setting('od.retry_expired_cleared'), 'true',
  'platform retry: both lease columns are NULL afterwards');
select is(current_setting('od.retry_none')::bigint, 0::bigint,
  'platform retry: a row with no lease affects zero rows');

-- ── Cross-org reclaim block until the tombstone is hard-deleted ─────────────
-- The same-org case is pinned above; the verify route's 23505 branch depends
-- on the CROSS-org collision too: org B cannot go verified on a name whose
-- org A tombstone is still awaiting Vercel cleanup, and can the moment the
-- worker's hard-delete lands.
do $$
declare
  org_a uuid := current_setting('od.org_a')::uuid;
  org_b uuid := current_setting('od.org_b')::uuid;
  a_row uuid;
  b_row uuid;
begin
  insert into public.org_domains (org_id, domain, status, verified_at, attached_at)
    values (org_a, 'crossreclaim.example.test', 'removing', now(), now())
    returning id into a_row;
  insert into public.org_domains (org_id, domain, status)
    values (org_b, 'crossreclaim.example.test', 'pending')
    returning id into b_row;
  perform set_config('od.cross_a', a_row::text, true);
  perform set_config('od.cross_b', b_row::text, true);
end $$;

select is(
  (select count(*) from public.org_domains where domain = 'crossreclaim.example.test'),
  2::bigint,
  'reclaim: org B''s pending claim coexists with org A''s removing tombstone'
);
select throws_ok(
  format($q$update public.org_domains set status = 'verified', verified_at = now()
            where id = %L and org_id = %L$q$,
         current_setting('od.cross_b'), current_setting('od.org_b')),
  '23505',
  null,
  'reclaim: org B''s verify transition raises 23505 while org A''s tombstone holds the global unique'
);

do $$
declare
  org_a uuid := current_setting('od.org_a')::uuid;
  org_b uuid := current_setting('od.org_b')::uuid;
  a_row uuid := current_setting('od.cross_a')::uuid;
  b_row uuid := current_setting('od.cross_b')::uuid;
  tok text;
  n bigint;
begin
  -- The worker's detach: claim, then hard-delete with the fenced predicate.
  with c as (
    update public.org_domains
       set attach_claimed_at = now(), attach_claim_token = gen_random_uuid()
     where id = a_row and org_id = org_a and status = 'removing'
       and (attach_claimed_at is null or attach_claimed_at < now() - interval '10 minutes')
     returning attach_claim_token
  )
  select max(attach_claim_token::text) into tok from c;
  with d as (
    delete from public.org_domains
     where id = a_row and org_id = org_a and status = 'removing'
       and attach_claim_token = tok::uuid
     returning id
  )
  select count(*) into n from d;
  perform set_config('od.cross_tombstone_deleted', n::text, true);

  -- Now org B's verify transition goes through.
  with v as (
    update public.org_domains set status = 'verified', verified_at = now()
     where id = b_row and org_id = org_b
     returning id
  )
  select count(*) into n from v;
  perform set_config('od.cross_b_verified', n::text, true);
end $$;

select is(current_setting('od.cross_tombstone_deleted')::bigint, 1::bigint,
  'reclaim: the worker hard-deletes org A''s tombstone (exactly one row)');
select is(current_setting('od.cross_b_verified')::bigint, 1::bigint,
  'reclaim: once the tombstone is gone org B''s verify transition affects exactly one row');
select is(
  (select status::text from public.org_domains where id = current_setting('od.cross_b')::uuid),
  'verified',
  'reclaim: org B now holds the name verified'
);

select * from finish();
rollback;
