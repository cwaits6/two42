-- CI schema lint (CWA-7 / #209 Phase 0; CWA-8 / #210 Phase 1; CWA-9 / #211
-- Phase 2): structural tenancy invariants over the whole public schema.
--
-- Phase 0/1 checks: every public base table has RLS enabled and an org_id
-- column that is NOT NULL with DEFAULT app_current_org_id().
-- Phase 2 checks (§9.4): every org-owned table has exactly one AS RESTRICTIVE
-- isolation policy referencing org_id; no policy on an org-owned table has a
-- bare `true` predicate; every FK into an org-owned parent is composite on
-- org_id; every SECURITY DEFINER function reading an org-owned table
-- references org_id.
--
-- Every check ships with a negative probe (an injected violation the lint
-- must flag) so no check can silently become a no-op that always passes.
--
-- Allowlist policy (Phase 2): the Phase 0/1 table allowlist is gone. The two
-- permanent by-design exemptions — organizations (the tenant root: its own
-- row IS the org, so no org_id column) and platform_admins (Two42-operator
-- superusers, org-orthogonal by design) — are now structural exclusions
-- named inline in each check, not data anyone can append to. The only
-- remaining list is tenancy_local_strays: tables that exist on the shared
-- local dev stack but in NO migration on this branch, so CI's ephemeral
-- database (the actual gate) never contains them and never exempts them.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/schema_tenancy_lint.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- Structural, permanent exemptions — named once, joined by every check.
create temporary table tenancy_root_tables on commit drop as
  select unnest(array['organizations', 'platform_admins']) as table_name;

-- Local-stack strays: on the shared local stack only; absent from CI's
-- migrations-built database, where these entries exempt nothing.
create temporary table tenancy_local_strays (table_name text primary key) on commit drop;
insert into tenancy_local_strays (table_name) values
  -- In-flight on another branch (payment handles feature):
  ('payment_handles');

-- ── Negative-test probes ────────────────────────────────────────────────────
-- Regular (not temporary) tables/functions: temp objects live in pg_temp_*
-- schemas and would be invisible to the public-schema scans below. The
-- enclosing rollback guarantees none of them persists. Probes are excluded
-- from the "clean" assertions by their tenancy_probe_ prefix and asserted
-- present in the paired "lint DOES flag it" assertions.

-- No RLS, no org_id.
create table public.tenancy_probe_violation (
  id uuid primary key default gen_random_uuid()
);

-- org_id present but nullable with no default.
create table public.tenancy_probe_no_default (
  id uuid primary key default gen_random_uuid(),
  org_id uuid  -- deliberately nullable, no default
);
alter table public.tenancy_probe_no_default enable row level security;

-- org_id NOT NULL with a default — but the wrong one.
create table public.tenancy_probe_wrong_default (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default gen_random_uuid()  -- deliberately wrong default
);
alter table public.tenancy_probe_wrong_default enable row level security;

-- Phase 2 probe: passes every Phase 0/1 check, but has no restrictive
-- isolation policy AND carries a bare-true permissive policy.
create table public.tenancy_probe_rls_shape (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id(),
  -- Referenced by the bare-SET NULL probe FK below.
  unique (id, org_id)
);
alter table public.tenancy_probe_rls_shape enable row level security;
create policy "probe bare true" on public.tenancy_probe_rls_shape
  for select using (true);

-- Phase 2 probes: a non-composite FK into an org-owned parent, and a
-- composite FK whose ON DELETE SET NULL is the bare form (no column list —
-- a parent delete would try to null org_id too).
create table public.tenancy_probe_fk_child (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id(),
  parent_id uuid references public.tenancy_probe_rls_shape (id),
  setnull_parent_id uuid,
  foreign key (setnull_parent_id, org_id)
    references public.tenancy_probe_rls_shape (id, org_id)
    on delete set null
);
alter table public.tenancy_probe_fk_child enable row level security;

-- Phase 2 probe: a SECURITY DEFINER function reading an org-owned table
-- without referencing org_id.
create function public.tenancy_probe_secdef_leak() returns int
  language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.profiles;
$$;

-- CWA-54 probe: a settings-style table keyed by something other than
-- org_id, carrying a bare-true policy. The pre-CWA-54 sweep gated on
-- "table has an org_id column", so this table fell out of it entirely —
-- which is exactly how organizations needed a hand-written bolt-on.
create table public.tenancy_probe_keyed_settings (
  key text primary key,
  value text
);
alter table public.tenancy_probe_keyed_settings enable row level security;
create policy "probe keyed bare true" on public.tenancy_probe_keyed_settings
  for select using (true);

-- ── Phase 0/1: RLS + org_id presence/shape ──────────────────────────────────

create temporary table lint_scope_tables on commit drop as
  select t.table_name
  from information_schema.tables t
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
    and t.table_name not in (select table_name from tenancy_root_tables)
    and t.table_name not in (select table_name from tenancy_local_strays);

create temporary table rls_missing on commit drop as
  select t.table_name from lint_scope_tables t
  where not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = t.table_name and c.relrowsecurity
  )
  -- organizations/platform_admins DO have RLS and are covered here too:
  union all
  select r.table_name from tenancy_root_tables r
  where not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = r.table_name and c.relrowsecurity
  );

create temporary table org_id_missing on commit drop as
  select t.table_name from lint_scope_tables t
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t.table_name
      and c.column_name = 'org_id'
  );

select is(
  (select count(*)::int from rls_missing where table_name not like 'tenancy\_probe\_%'),
  0,
  'every public table (incl. the tenant root tables) has RLS enabled'
);

select isnt(
  (select count(*)::int from rls_missing),
  0,
  'lint DOES flag the injected no-RLS probe table when not excluded'
);

select is(
  (select count(*)::int from org_id_missing where table_name not like 'tenancy\_probe\_%'),
  0,
  'every org-scoped public table has an org_id column'
);

select isnt(
  (select count(*)::int from org_id_missing),
  0,
  'lint DOES flag the injected no-org_id probe table when not excluded'
);

create temporary table org_id_nullable on commit drop as
  select t.table_name from lint_scope_tables t
  where exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t.table_name
      and c.column_name = 'org_id' and c.is_nullable = 'YES'
  );

create temporary table org_id_no_default on commit drop as
  select t.table_name from lint_scope_tables t
  -- organization_members is a membership join table: org_id is half its
  -- natural key and must always be named explicitly by the caller
  -- (provision_organization, handle_new_user) — a fail-closed DEFAULT
  -- makes no sense there. It stays covered by every other check.
  where t.table_name <> 'organization_members'
    and exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = t.table_name
        and c.column_name = 'org_id' and c.column_default is null
    );

select is(
  (select count(*)::int from org_id_nullable where table_name not like 'tenancy\_probe\_%'),
  0,
  'every org-scoped table''s org_id column is NOT NULL'
);

select isnt(
  (select count(*)::int from org_id_nullable),
  0,
  'lint DOES flag the injected nullable-org_id probe table when not excluded'
);

select is(
  (select count(*)::int from org_id_no_default where table_name not like 'tenancy\_probe\_%'),
  0,
  'every org-scoped table''s org_id column has a DEFAULT'
);

select isnt(
  (select count(*)::int from org_id_no_default),
  0,
  'lint DOES flag the injected no-default probe table when not excluded'
);

create temporary table org_id_wrong_default on commit drop as
  select t.table_name from lint_scope_tables t
  where t.table_name <> 'organization_members'
    and exists (
      select 1
      from pg_catalog.pg_attrdef d
      join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      join pg_catalog.pg_class c on c.oid = d.adrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.table_name
        and a.attname = 'org_id'
        -- pg_get_expr renders the call schema-qualified or not depending on
        -- the session search_path; both spellings are the same function and
        -- ONLY these two exact renderings are valid.
        and pg_get_expr(d.adbin, d.adrelid) not in
          ('app_current_org_id()', 'public.app_current_org_id()')
    );

select is(
  (select count(*)::int from org_id_wrong_default where table_name not like 'tenancy\_probe\_%'),
  0,
  'every org-scoped table''s org_id DEFAULT is app_current_org_id() specifically'
);

select isnt(
  (select count(*)::int from org_id_wrong_default),
  0,
  'lint DOES flag the injected wrong-default probe table when not excluded'
);

-- ── Phase 2 check 1 (§9.4): exactly one restrictive isolation policy ───────

create temporary table restrictive_missing on commit drop as
  select t.table_name from lint_scope_tables t
  where exists (  -- org-owned tables only
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = t.table_name
        and c.column_name = 'org_id')
    and 1 <> (
      select count(*) from pg_catalog.pg_policies p
      where p.schemaname = 'public' and p.tablename = t.table_name
        and p.permissive = 'RESTRICTIVE'
        and p.qual like '%org\_id%'
    );

select is(
  (select count(*)::int from restrictive_missing where table_name not like 'tenancy\_probe\_%'),
  0,
  'every org-owned table has exactly one AS RESTRICTIVE isolation policy referencing org_id'
);

select isnt(
  (select count(*)::int from restrictive_missing),
  0,
  'lint DOES flag the injected no-restrictive-policy probe table when not excluded'
);

-- organizations has no org_id, so the loop above can never cover it; assert
-- its isolation floor (pinned by primary key) directly.
select is(
  (select count(*)::int from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'organizations'
      and p.permissive = 'RESTRICTIVE'
      and p.qual like '%app\_request\_org\_id%'),
  1,
  'organizations carries its own restrictive floor pinned by primary key'
);

-- ── Phase 2 check 2 (§9.4): no bare-true predicate on an org-owned table ───

-- CWA-54: swept over EVERY public base table, not just those carrying an
-- org_id column. The old org_id-column gate silently excused any table
-- keyed differently — organizations needed a hand-written assertion
-- below as a result, and the next such table would not have gotten one.
create temporary table bare_true_policies on commit drop as
  select p.tablename || '.' || p.policyname as violation
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename not in (select table_name from tenancy_local_strays)
    and (p.qual = 'true' or p.with_check = 'true');

select is(
  (select count(*)::int from bare_true_policies where violation not like 'tenancy\_probe\_%'),
  0,
  'no policy on an org-owned table has a bare true USING / WITH CHECK'
);

select isnt(
  (select count(*)::int from bare_true_policies),
  0,
  'lint DOES flag the injected bare-true probe policy when not excluded'
);

-- The isnt() above would pass on the old org_id-gated sweep too (its probe
-- table carries org_id), so it does not prove the CWA-54 generalization.
-- This one does: the keyed-settings probe has NO org_id column and can only
-- be flagged by a sweep that dropped the gate.
select is(
  (select count(*)::int from bare_true_policies
    where violation like 'tenancy\_probe\_keyed\_settings.%'),
  1,
  'bare-true sweep reaches key-column tables that carry no org_id column'
);

-- Kept although the CWA-54 sweep above now also covers organizations: this
-- assertion is pinned by table name and was mutation-verified in #307 —
-- defence in depth costs one assertion.
select is(
  (select count(*)::int from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'organizations'
      and (p.qual = 'true' or p.with_check = 'true')),
  0,
  'no policy on organizations has a bare true USING / WITH CHECK'
);

-- ── Phase 2 check 3 (§9.4): FKs into org-owned parents are composite ───────

create temporary table noncomposite_fks on commit drop as
  select con.conname::text as violation
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class parent on parent.oid = con.confrelid
  join pg_catalog.pg_namespace pn on pn.oid = parent.relnamespace
  join pg_catalog.pg_class child on child.oid = con.conrelid
  where con.contype = 'f'
    and con.connamespace = 'public'::regnamespace
    and pn.nspname = 'public'
    -- parent carries org_id → the FK must carry it too
    and exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = parent.oid and a.attname = 'org_id' and not a.attisdropped)
    and not (
      exists (
        select 1 from pg_catalog.pg_attribute a
        where a.attrelid = child.oid and a.attname = 'org_id'
          and a.attnum = any (con.conkey))
      and exists (
        select 1 from pg_catalog.pg_attribute a
        where a.attrelid = parent.oid and a.attname = 'org_id'
          and a.attnum = any (con.confkey))
    )
    -- Named exceptions, each with a reason:
    and con.conname not in (
      -- organization_members.profile_id → profiles: the membership org is
      -- deliberately independent of the profile's pinned org — that
      -- independence is the platform-admin / multi-org seam Phase 4 builds
      -- on.
      'organization_members_profile_id_fkey',
      -- payment_handles is a local-stack stray (see tenancy_local_strays);
      -- its FK does not exist in CI's migrations-built database.
      'payment_handles_profile_id_fkey'
    );

select is(
  (select count(*)::int from noncomposite_fks where violation not like 'tenancy\_probe\_%'),
  0,
  'every FK whose parent carries org_id is composite on org_id'
);

select isnt(
  (select count(*)::int from noncomposite_fks),
  0,
  'lint DOES flag the injected non-composite probe FK when not excluded'
);

-- ── Phase 2 check 3b (§9.4): SET NULL actions must spare org_id ────────────
-- A composite FK's bare `on delete set null` nulls EVERY referencing column,
-- org_id included — which NOT NULL turns into a runtime error on the first
-- parent delete. The PG15 column-list form `set null (<col>)` is required
-- (see 20260731000013_composite_fks.sql). The FK suite proves the runtime
-- behavior for representative relations; this check covers all 15 SET NULL
-- relations structurally, plus any added later: every FK whose referencing
-- columns include org_id and whose delete action is SET NULL must carry a
-- column list, and that list must not name org_id.
create temporary table setnull_hits_org_id on commit drop as
  select con.conname::text as violation
  from pg_catalog.pg_constraint con
  where con.contype = 'f'
    and con.connamespace = 'public'::regnamespace
    and con.confdeltype = 'n'
    and exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = con.conrelid and a.attname = 'org_id'
        and a.attnum = any (con.conkey))
    and (
      coalesce(cardinality(con.confdelsetcols), 0) = 0
      or exists (
        select 1 from pg_catalog.pg_attribute a
        where a.attrelid = con.conrelid and a.attname = 'org_id'
          and a.attnum = any (con.confdelsetcols))
    );

select is(
  (select count(*)::int from setnull_hits_org_id where violation not like 'tenancy\_probe\_%'),
  0,
  'every ON DELETE SET NULL on an org_id-carrying FK names a column list excluding org_id'
);

select isnt(
  (select count(*)::int from setnull_hits_org_id),
  0,
  'lint DOES flag the injected bare-SET NULL probe FK when not excluded'
);

-- ── Phase 2 check 4 (§9.4): SECURITY DEFINER functions reference org_id ────

create temporary table secdef_org_blind on commit drop as
  select p.proname::text as violation
  from pg_catalog.pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prosecdef
    and p.prosrc !~ 'org_id'
    and exists (
      -- reads (word-boundary match) some org-owned table
      select 1
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'org_id'
        and t.table_type = 'BASE TABLE'
        and p.prosrc ~ ('\m' || c.table_name || '\M'))
    -- Named exceptions, each with a reason:
    and p.proname not in (
      -- keyed on auth.users' PK: user ids are globally unique and each is
      -- already pinned to exactly one org through profiles.id.
      'handle_auth_user_email_change'
    );

select is(
  (select count(*)::int from secdef_org_blind where violation not like 'tenancy\_probe\_%'),
  0,
  'every SECURITY DEFINER function reading an org-owned table references org_id'
);

select isnt(
  (select count(*)::int from secdef_org_blind),
  0,
  'lint DOES flag the injected org-blind SECURITY DEFINER probe function when not excluded'
);

-- ── Fail-closed runtime checks (Phase 1, unchanged) ────────────────────────

select throws_ok(
  $$ insert into public.event_calendars (name) values ('tenancy-lint-probe') $$,
  '23502',
  null,
  'service-role insert into a plain org_id-rollout table is rejected without explicit org_id'
);

-- ── PK re-scoping (Phase 1) + legacy-unique DROPS (Phase 2, §3.5) ──────────
-- Phase 1 asserted the legacy single-column uniques were retained; Phase 2
-- drops them (Task 9), so the assertions flip: the composite PKs must
-- remain and the legacy uniques must be GONE — a revert that resurrects a
-- global unique would break second-org provisioning.

select col_is_pk('public', 'site_settings', array['org_id', 'key'], 'site_settings PK is (org_id, key)');
select ok(
  not exists (
    select 1 from pg_constraint
    where conrelid = 'public.site_settings'::regclass
      and conname = 'site_settings_key_legacy_key'
  ),
  'site_settings'' key-only legacy unique is dropped (keys are per-org now)'
);

select col_is_pk('public', 'about_page', array['org_id', 'id'], 'about_page PK is (org_id, id)');
select ok(
  not exists (
    select 1 from pg_constraint
    where conrelid = 'public.about_page'::regclass
      and conname = 'about_page_id_legacy_key'
  ),
  'about_page''s global singleton unique is dropped (one about page per org now)'
);

select col_is_pk('public', 'class_teachers', array['id'], 'class_teachers PK stays plain id');
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.class_teachers'::regclass
      and conname = 'class_teachers_org_id_profile_id_key' and contype = 'u'
  ),
  'class_teachers has (org_id, profile_id) unique'
);
select ok(
  not exists (
    select 1 from pg_constraint
    where conrelid = 'public.class_teachers'::regclass
      and conname = 'class_teachers_profile_id_legacy_key'
  ),
  'class_teachers'' profile_id-only legacy unique is dropped'
);

-- ── Backfill correctness (Phase 1, data level) ─────────────────────────────
-- Every row on every org_id-bearing table must belong to a real org. (The
-- Phase 1 form asserted the single default-org constant; with Phase 2
-- provisioning able to create further orgs, membership in organizations is
-- the invariant, enforced structurally by the org_id FKs — this check
-- guards against rows whose org vanished mid-migration, dynamic because it
-- inspects row data per table.)
create temporary table org_id_bad_backfill (table_name text) on commit drop;
do $$
declare
  t text;
  bad_count bigint;
begin
  for t in
    select ts.table_name from lint_scope_tables ts
    where exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = ts.table_name
        and c.column_name = 'org_id'
    ) and ts.table_name not like 'tenancy_probe_%'
  loop
    execute format(
      'select count(*) from public.%I x where not exists (select 1 from public.organizations o where o.id = x.org_id)', t
    ) into bad_count;
    if bad_count > 0 then
      insert into org_id_bad_backfill values (t);
    end if;
  end loop;
end $$;

select is(
  (select count(*)::int from org_id_bad_backfill),
  0,
  'every org_id-bearing table''s rows belong to an existing organization'
);

select * from finish();
rollback;
