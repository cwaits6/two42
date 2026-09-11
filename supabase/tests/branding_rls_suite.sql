-- Branding read-path regression guard (CWA-10 Phase 3, #212).
--
-- Before 20260801000002_org_branding_backfill.sql, public.organizations was
-- readable by nobody in the seeded org over PostgREST: the only permissive
-- select policy ("org members can view their orgs") is gated on
-- organization_members, which handle_new_user() has populated only since
-- 20260731000014 and which was never backfilled — so anon callers and every
-- profile predating that migration (i.e. all of org #1) saw 0 rows while the
-- app silently fell back to env-var branding defaults. This suite pins the
-- new permissive SELECT policy by name, the anon read behavior, and the
-- canonical branding shape for both the seeded org and newly provisioned
-- ones.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/branding_rls_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Shape contract: the backfilled org carries all four canonical keys.
select ok(
  (
    select branding ?& array['display_name', 'logo_url', 'accent', 'reply_to']
    from public.organizations
    where id = '00000000-0000-0000-0000-000000000001'
  ),
  'org #1 branding carries display_name, logo_url, accent, reply_to'
);

-- accent must survive resolveBranding()'s strict hex guard, or the app
-- silently falls back to the default and the backfill is dead weight.
select matches(
  (
    select branding ->> 'accent'
    from public.organizations
    where id = '00000000-0000-0000-0000-000000000001'
  ),
  '^#[0-9a-fA-F]{6}$',
  'org #1 branding.accent is a six-digit hex color'
);

-- The other producer of branding rows: provision_organization() emits the
-- same four keys for every future org. Without this, a future edit that drops
-- reply_to (the body is copied verbatim between migrations — this migration
-- does exactly that) fails SILENTLY: resolveBranding() coerces the missing
-- key to null and every new org quietly loses its Reply-To.
-- Key existence only, deliberately not the hex shape: a freshly provisioned
-- org has accent = JSON null until an admin sets it.
do $$
declare
  _org_id uuid;
begin
  _org_id := public.provision_organization(
    'Branding Suite Org', 'branding-suite-org', 'owner@branding-suite.example.test'
  );
  perform set_config('branding_suite.org_id', _org_id::text, true);
end $$;

select ok(
  (
    select branding ?& array['display_name', 'logo_url', 'accent', 'reply_to']
    from public.organizations
    where id = current_setting('branding_suite.org_id')::uuid
  ),
  'provision_organization() emits display_name, logo_url, accent, reply_to'
);

-- Pin the new permissive policy by name. The behavioral assertions below
-- cannot do this: the restrictive floor enforces the same predicate, so
-- replacing this policy's predicate with bare `true` leaves every row count
-- unchanged (verified by mutation).
select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'organizations'
      and policyname = 'Org readable within request org'
      and permissive = 'PERMISSIVE' and cmd = 'SELECT'
      and qual like '%app\_request\_org\_id%'),
  1,
  'the permissive SELECT policy exists and predicates on app_request_org_id()'
);

-- Column privileges are the column-level half of the read boundary: the
-- policy above decides which ROWS come back, these decide which COLUMNS of
-- them. Asserted here rather than left to review because the failure mode is
-- silent — a plain `grant select on public.organizations to anon` anywhere
-- later re-exposes status and every column a future phase adds, with no row
-- count changing and none of the assertions below noticing.
select ok(
  has_column_privilege('anon', 'public.organizations', 'branding', 'select'),
  'anon may read organizations.branding (the app shell reads it unauthenticated)'
);
select ok(
  not has_column_privilege('anon', 'public.organizations', 'status', 'select'),
  'anon may not read organizations.status'
);
select ok(
  not has_column_privilege('authenticated', 'public.organizations', 'status', 'select'),
  'authenticated may not read organizations.status'
);
-- The custom-sending-domain gate is platform-operator-only: an org's own
-- admin learns its effect through the claim route's 403, never by reading
-- (or flipping) the column from their own client.
select ok(
  not has_column_privilege('anon', 'public.organizations', 'custom_email_domain_enabled', 'select'),
  'anon may not read organizations.custom_email_domain_enabled'
);
select ok(
  not has_column_privilege('authenticated', 'public.organizations', 'custom_email_domain_enabled', 'select'),
  'authenticated may not read organizations.custom_email_domain_enabled'
);
-- The write side is enforced by RLS, not grants: Supabase's default
-- table-level UPDATE grant on organizations still stands, but no permissive
-- write policy exists, so the only write path is the service-role platform
-- route. Pin that absence — a future permissive UPDATE arm would hand the
-- flag to the org's own admin.
select is(
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'organizations'
       and permissive = 'PERMISSIVE' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0::bigint,
  'no permissive write policy on organizations: custom_email_domain_enabled is writable only via the service-role platform route'
);
select col_not_null('public', 'organizations', 'custom_email_domain_enabled',
  'organizations.custom_email_domain_enabled is NOT NULL');
select col_default_is('public', 'organizations', 'custom_email_domain_enabled', 'false',
  'organizations.custom_email_domain_enabled defaults to false (no org gets custom domains until an operator flips it)');

-- anon resolving the org via the x-two42-org header reads exactly 1 row.
set local role anon;
reset request.jwt.claims;
select set_config('request.headers', json_build_object('x-two42-org', 'default')::text, true);
select is(
  (select count(*) from public.organizations),
  1::bigint,
  'anon with x-two42-org header reads exactly the request org row'
);

-- anon with no org header reads nothing (fail-closed).
select set_config('request.headers', '{}', true);
select is(
  (select count(*) from public.organizations),
  0::bigint,
  'anon with no org header reads no organizations (fail-closed)'
);

-- An authenticated member reads exactly their own org row. NOTE which policy
-- actually carries this differs by environment, so it is NOT a guard on the
-- new one: in CI the database is ephemeral, seed.sql's auth.users insert
-- fires handle_new_user() → an organization_members row → the LEGACY
-- membership policy alone grants this SELECT, and the assertion passes with
-- the new policy reverted. On the shared local stack the seed profile
-- predates 20260731000014, so the new policy carries it. The anon assertions
-- above and the policy_cmd assertion at the top are the real guards.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
select is(
  (select count(*) from public.organizations),
  1::bigint,
  'authenticated member reads exactly their own org row'
);

reset role;
select * from finish();
rollback;
