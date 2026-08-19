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
--   * the unique-per-org index and the domain_shape CHECK.
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

select ok(has_column_privilege('authenticated', 'public.org_email_domains', 'status', 'select'),
  'authenticated may SELECT org_email_domains.status');
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

select * from finish();
rollback;
