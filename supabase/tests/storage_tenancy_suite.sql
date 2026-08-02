-- Storage tenancy suite (CWA-57 / #328 — the CWA-11 hard gate's named
-- deliverable). Proves the org-partitioned storage.objects policies of
-- 20260803000000: an org-B principal can neither read, insert, update, nor
-- delete anything under an org-A prefix — including the two headline CVEs
-- (an org-B content editor deleting an org-A event image, an org-B admin
-- deleting an org-A family photo) — while own-org positive controls keep the
-- suite non-vacuous. Structural assertions pin the policy shape itself, and
-- the ADR-3 decision that both buckets stay public.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/storage_tenancy_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table storage_tenancy_results (line text) on commit drop;

-- ── Structural assertions (what a future regression trips) ──────────────────

-- Every policy on storage.objects carries the org predicate somewhere.
insert into storage_tenancy_results
  select is(
    (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and coalesce(qual, '') not like '%app_request_org_id%'
        and coalesce(with_check, '') not like '%app_request_org_id%'),
    0::bigint,
    'every policy on storage.objects references app_request_org_id');

-- No blanket-true predicate anywhere on storage.objects.
insert into storage_tenancy_results
  select is(
    (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and (qual = 'true' or with_check = 'true')),
    0::bigint,
    'no policy on storage.objects has a bare true predicate');

-- Exactly one restrictive floor, and it is the org isolation policy.
insert into storage_tenancy_results
  select is(
    (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and permissive = 'RESTRICTIVE'),
    1::bigint,
    'exactly one restrictive policy exists on storage.objects');
insert into storage_tenancy_results
  select is(
    (select policyname from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and permissive = 'RESTRICTIVE'),
    'org isolation',
    'the restrictive storage floor is named "org isolation"');

-- ADR-3 encoded: both buckets deliberately remain public (read posture is
-- unguessable-UUID paths, unchanged by CWA-57 — see
-- docs/security/tenancy-model.md "Storage tenancy"). Flipping this flag must
-- fail CI so the documented decision gets revisited, not drifted past.
insert into storage_tenancy_results
  select is(
    (select count(*) from storage.buckets
      where id in ('avatars', 'event-images') and public),
    2::bigint,
    'ADR-3: avatars and event-images buckets are both public => true (documented decision, revisit deliberately)');

-- ── Fixtures: two orgs, one object per kind per org ─────────────────────────

do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  member_b uuid := gen_random_uuid();
  family_a uuid;
  family_b uuid;
  fm_a uuid;
  fm_b uuid;
  calendar_a uuid;
  calendar_b uuid;
  event_a uuid;
  event_b uuid;
begin
  org_a := public.provision_organization('Storage Suite Org A', 'storage-suite-org-a', 'owner-a@storage.example.test');
  org_b := public.provision_organization('Storage Suite Org B', 'storage-suite-org-b', 'owner-b@storage.example.test');

  -- Owners sign up AFTER provisioning (the org-first contract):
  -- handle_new_user() resolves each into their org via the approved
  -- access_requests row provisioning created (approved_role = 'admin', so
  -- both owners satisfy is_admin(), is_content_editor() and is_member()).
  insert into auth.users (id, email) values
    (owner_a, 'owner-a@storage.example.test'),
    (owner_b, 'owner-b@storage.example.test');

  -- A plain (non-admin, household-less) org-B member. The founding owners
  -- satisfy is_admin()/is_content_editor()/is_member() all at once, so they
  -- can never make a role predicate fail — an intra-org denial needs a
  -- principal the permissive arms actually reject.
  insert into public.access_requests (org_id, name, email, status)
    values (org_b, 'Storage Plain Member', 'member-b@storage.example.test', 'approved');
  insert into auth.users (id, email) values (member_b, 'member-b@storage.example.test');

  insert into public.family_units (org_id, family_name)
    values (org_a, 'Storage A family') returning id into family_a;
  insert into public.family_units (org_id, family_name)
    values (org_b, 'Storage B family') returning id into family_b;
  insert into public.family_members (org_id, family_id, first_name, relationship)
    values (org_a, family_a, 'A kid', 'child') returning id into fm_a;
  insert into public.family_members (org_id, family_id, first_name, relationship)
    values (org_b, family_b, 'B kid', 'child') returning id into fm_b;
  update public.profiles set family_id = family_a where id = owner_a;
  update public.profiles set family_id = family_b where id = owner_b;

  insert into public.event_calendars (org_id, name, created_by)
    values (org_a, 'A calendar', owner_a) returning id into calendar_a;
  insert into public.event_calendars (org_id, name, created_by)
    values (org_b, 'B calendar', owner_b) returning id into calendar_b;
  insert into public.events (org_id, title, start_time, calendar_id, created_by)
    values (org_a, 'A event', now() + interval '7 days', calendar_a, owner_a)
    returning id into event_a;
  insert into public.events (org_id, title, start_time, calendar_id, created_by)
    values (org_b, 'B event', now() + interval '7 days', calendar_b, owner_b)
    returning id into event_b;

  -- Seed storage.objects as postgres (BYPASSRLS — before any role switch).
  -- One object per kind per org at the org-partitioned key, plus one legacy
  -- un-prefixed key to pin the deferral behavior: invisible to every
  -- anon/authenticated write path until scripts/rekey-storage-objects.mjs
  -- moves it.
  insert into storage.objects (bucket_id, name, owner, owner_id) values
    ('avatars',      org_a || '/profiles/' || owner_a || '/avatar.jpg',       owner_a, owner_a),
    ('avatars',      org_a || '/family-members/' || fm_a || '/avatar.jpg',    owner_a, owner_a),
    ('avatars',      org_a || '/families/' || family_a || '/photo.jpg',       owner_a, owner_a),
    ('event-images', org_a || '/events/' || event_a || '/cover.jpg',          owner_a, owner_a),
    ('avatars',      org_b || '/profiles/' || owner_b || '/avatar.jpg',       owner_b, owner_b),
    ('avatars',      org_b || '/family-members/' || fm_b || '/avatar.jpg',    owner_b, owner_b),
    ('avatars',      org_b || '/families/' || family_b || '/photo.jpg',       owner_b, owner_b),
    ('event-images', org_b || '/events/' || event_b || '/cover.jpg',          owner_b, owner_b),
    ('avatars',      'families/' || family_a || '/photo.jpg',                 owner_a, owner_a);

  -- storage.protect_delete() is a STATEMENT-level guard trigger the storage
  -- schema installs against accidental direct SQL deletes (it raises 42501
  -- for any DELETE unless this GUC is set — the Storage API sets it before
  -- its own deletes). Setting it here disables only that trigger, never RLS,
  -- so the delete assertions below exercise exactly the policy path the API
  -- exercises. Transaction-scoped: it dies with the rollback.
  perform set_config('storage.allow_delete_query', 'true', true);

  perform set_config('storage_suite.org_a', org_a::text, true);
  perform set_config('storage_suite.org_b', org_b::text, true);
  perform set_config('storage_suite.owner_a', owner_a::text, true);
  perform set_config('storage_suite.owner_b', owner_b::text, true);
  perform set_config('storage_suite.member_b', member_b::text, true);
  perform set_config('storage_suite.family_a', family_a::text, true);
  perform set_config('storage_suite.family_b', family_b::text, true);
  perform set_config('storage_suite.event_a', event_a::text, true);
  perform set_config('storage_suite.event_b', event_b::text, true);
end $$;

-- ── Behavioural: org-B principal vs. org-A objects ──────────────────────────
-- Every block: set local role authenticated + explicit jwt claims + cleared
-- headers (set_config(..., true) is transaction-scoped, so a previous
-- block's principal would otherwise leak in), capture counts/SQLSTATEs,
-- reset role, THEN assert.

do $$
declare
  org_a uuid := current_setting('storage_suite.org_a')::uuid;
  org_b uuid := current_setting('storage_suite.org_b')::uuid;
  owner_b uuid := current_setting('storage_suite.owner_b')::uuid;
  cross_read bigint := -1;
  own_read bigint := -1;
  legacy_read bigint := -1;
  insert_err text := null;
  positive_insert_err text := null;
  update_count int := -1;
  delete_count int := -1;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  perform set_config('request.headers', '{}', true);

  -- Cross-org read: zero org-A objects visible, in any bucket.
  select count(*) into cross_read from storage.objects
    where name like org_a || '/%';
  -- Non-vacuity: own-org objects are visible.
  select count(*) into own_read from storage.objects
    where name like org_b || '/%';
  -- Legacy un-prefixed keys are invisible too (foldername[1] is no org).
  select count(*) into legacy_read from storage.objects
    where name like 'families/%';

  -- INSERT under org A's prefix → RLS 42501 (the restrictive floor).
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('avatars', org_a || '/profiles/' || owner_b || '/avatar.jpg', owner_b, owner_b);
  exception when others then
    insert_err := sqlstate;
  end;

  -- UPDATE / DELETE sweeping org A's prefix → 0 rows affected.
  begin
    with u as (
      update storage.objects set name = name || '.defaced'
      where name like org_a || '/%' returning 1
    ) select count(*) into update_count from u;
  exception when others then
    update_count := -2; -- an error here is a failure, distinct from -1
  end;
  begin
    with d as (
      delete from storage.objects
      where name like org_a || '/%' returning 1
    ) select count(*) into delete_count from d;
  exception when others then
    delete_count := -2;
  end;

  -- Positive control: the same principal CAN write under their own org
  -- prefix (a suite that only proves denial could pass by denying all).
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('avatars', org_b || '/profiles/' || owner_b || '/positive.jpg', owner_b, owner_b);
  exception when others then
    positive_insert_err := sqlstate;
  end;

  reset role;

  insert into storage_tenancy_results
    select is(cross_read, 0::bigint, 'org B principal reads zero objects under org A''s prefix');
  insert into storage_tenancy_results
    select ok(own_read >= 1, format('org B principal still reads own-org objects (%s rows — non-vacuous)', own_read));
  insert into storage_tenancy_results
    select is(legacy_read, 0::bigint, 'legacy un-prefixed keys are invisible to authenticated principals (re-key deferral, ADR-4)');
  insert into storage_tenancy_results
    select is(insert_err, '42501', 'INSERT under org A''s prefix is rejected (RLS 42501)');
  insert into storage_tenancy_results
    select is(update_count, 0, 'UPDATE sweeping org A''s prefix affects 0 rows');
  insert into storage_tenancy_results
    select is(delete_count, 0, 'DELETE sweeping org A''s prefix affects 0 rows');
  insert into storage_tenancy_results
    select is(coalesce(positive_insert_err, 'ok'), 'ok', 'positive control: org B principal inserts under own org prefix');
end $$;

-- ── The two headline CVEs, asserted by name ─────────────────────────────────
-- owner_b is a founding admin (approved_role = 'admin'), so is_admin() and
-- is_content_editor() are both true for them — exactly the principal the
-- legacy policies wrongly trusted platform-wide.

do $$
declare
  org_a uuid := current_setting('storage_suite.org_a')::uuid;
  org_b uuid := current_setting('storage_suite.org_b')::uuid;
  owner_b uuid := current_setting('storage_suite.owner_b')::uuid;
  family_a uuid := current_setting('storage_suite.family_a')::uuid;
  family_b uuid := current_setting('storage_suite.family_b')::uuid;
  event_a uuid := current_setting('storage_suite.event_a')::uuid;
  event_b uuid := current_setting('storage_suite.event_b')::uuid;
  cve_event_delete int := -1;
  cve_family_delete int := -1;
  legacy_delete int := -1;
  own_event_delete int := -1;
  own_family_delete int := -1;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  perform set_config('request.headers', '{}', true);

  -- CVE 1: an org-B content editor deleting an org-A event image.
  with d as (
    delete from storage.objects
    where bucket_id = 'event-images'
      and name = org_a || '/events/' || event_a || '/cover.jpg'
    returning 1
  ) select count(*) into cve_event_delete from d;

  -- CVE 2: an org-B admin deleting an org-A family photo.
  with d as (
    delete from storage.objects
    where bucket_id = 'avatars'
      and name = org_a || '/families/' || family_a || '/photo.jpg'
    returning 1
  ) select count(*) into cve_family_delete from d;

  -- The pre-re-key legacy key is equally out of reach (Task 8's documented
  -- silent no-op — the delete "succeeds" touching nothing).
  with d as (
    delete from storage.objects
    where bucket_id = 'avatars'
      and name = 'families/' || family_a || '/photo.jpg'
    returning 1
  ) select count(*) into legacy_delete from d;

  -- Positive controls: the same admin/editor CAN delete their OWN org's
  -- event image and family photo through the rewritten arms.
  with d as (
    delete from storage.objects
    where bucket_id = 'event-images'
      and name = org_b || '/events/' || event_b || '/cover.jpg'
    returning 1
  ) select count(*) into own_event_delete from d;
  with d as (
    delete from storage.objects
    where bucket_id = 'avatars'
      and name = org_b || '/families/' || family_b || '/photo.jpg'
    returning 1
  ) select count(*) into own_family_delete from d;

  reset role;

  insert into storage_tenancy_results
    select is(cve_event_delete, 0, 'org B content editor cannot delete an org A event image (the CWA-57 CVE)');
  insert into storage_tenancy_results
    select is(cve_family_delete, 0, 'org B admin cannot delete an org A family photo (the CWA-57 CVE)');
  insert into storage_tenancy_results
    select is(legacy_delete, 0, 'a legacy un-prefixed family photo is untouchable pre-re-key (documented no-op)');
  insert into storage_tenancy_results
    select is(own_event_delete, 1, 'positive control: org B editor deletes their own org''s event image');
  insert into storage_tenancy_results
    select is(own_family_delete, 1, 'positive control: org B admin deletes their own org''s family photo');
end $$;

-- ── The WITH CHECK half, via UPDATE ─────────────────────────────────────────
-- WITH CHECK is otherwise only exercised by INSERT, which leaves the
-- rename-out-of-org escape untested: a principal updating an object they
-- legitimately own INTO another org's prefix is the same cross-tenant write,
-- reached through UPDATE.
--
-- Two layers reject the new name and either alone suffices, so no UPDATE can
-- isolate one: the restrictive floor's WITH CHECK, and the permissive arm's
-- USING (Postgres reuses USING as WITH CHECK when a policy declares no WITH
-- CHECK, and every arm carries the org predicate). Verified by mutation —
-- neutering the floor's WITH CHECK alone leaves this assertion green. That is
-- the `ORG AND (arms)` factoring working as designed; the assertion pins the
-- escape being closed, not which layer closes it.
--
-- The own-org rename is the non-vacuity pair — without it every `for update`
-- policy could be dropped from the migration and this suite would stay green,
-- while every avatar re-upload (upsert: true) broke in production.

do $$
declare
  org_a uuid := current_setting('storage_suite.org_a')::uuid;
  org_b uuid := current_setting('storage_suite.org_b')::uuid;
  owner_b uuid := current_setting('storage_suite.owner_b')::uuid;
  family_a uuid := current_setting('storage_suite.family_a')::uuid;
  rename_out_err text := null;
  own_rename_count int := -1;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  perform set_config('request.headers', '{}', true);

  -- Rename an object org B genuinely owns into org A's prefix. USING passes
  -- (the old row is org B's); WITH CHECK must reject the new name.
  begin
    update storage.objects
      set name = org_a || '/families/' || family_a || '/photo.jpg'
      where bucket_id = 'avatars'
        and name = org_b || '/profiles/' || owner_b || '/avatar.jpg';
  exception when others then
    rename_out_err := sqlstate;
  end;

  -- Non-vacuity: the same principal CAN rename it within their own org.
  begin
    with u as (
      update storage.objects
        set name = org_b || '/profiles/' || owner_b || '/avatar-renamed.jpg'
        where bucket_id = 'avatars'
          and name = org_b || '/profiles/' || owner_b || '/avatar.jpg'
      returning 1
    ) select count(*) into own_rename_count from u;
  exception when others then
    own_rename_count := -2;
  end;

  reset role;

  insert into storage_tenancy_results
    select is(rename_out_err, '42501',
      'UPDATE renaming an own-org object INTO org A''s prefix is rejected on the WITH CHECK path (42501)');
  insert into storage_tenancy_results
    select is(own_rename_count, 1,
      'positive control: the same principal renames their own avatar within their own org');
end $$;

-- ── Intra-org: the permissive arms are the deciding predicate ───────────────
-- Every assertion above targets a CROSS-org key, which the restrictive floor
-- alone denies — so the arms' role, kind, and per-entity EXISTS predicates
-- are never what decides. Everything below stays inside org B, so the floor
-- passes and only a permissive arm can deny. Without this block the migration
-- could be simplified back to `bucket_id AND org AND kind` and the suite would
-- still pass, silently reintroducing intra-org IDOR.

do $$
declare
  org_b uuid := current_setting('storage_suite.org_b')::uuid;
  owner_b uuid := current_setting('storage_suite.owner_b')::uuid;
  member_b uuid := current_setting('storage_suite.member_b')::uuid;
  family_b uuid := current_setting('storage_suite.family_b')::uuid;
  event_b uuid := current_setting('storage_suite.event_b')::uuid;
  ghost uuid := gen_random_uuid();
  wrong_role_err text := null;
  other_profile_err text := null;
  own_profile_err text := null;
  wrong_kind_err text := null;
  ghost_family_err text := null;
  ghost_event_err text := null;
  own_event_err text := null;
begin
  -- (a) A plain member, inside their own org.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_b)::text, true);
  perform set_config('request.headers', '{}', true);

  -- Wrong role: family portraits need is_admin(), which a plain member fails.
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('avatars', org_b || '/families/' || family_b || '/photo.jpg', member_b, member_b);
  exception when others then
    wrong_role_err := sqlstate;
  end;

  -- Another member's avatar in the same org: [3] must equal auth.uid(), and
  -- the household-leader arm does not apply (no shared family_id).
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('avatars', org_b || '/profiles/' || owner_b || '/avatar.jpg', member_b, member_b);
  exception when others then
    other_profile_err := sqlstate;
  end;

  -- Non-vacuity: the same plain member CAN write their own avatar.
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('avatars', org_b || '/profiles/' || member_b || '/avatar.jpg', member_b, member_b);
  exception when others then
    own_profile_err := sqlstate;
  end;

  -- (b) The org-B founding admin / content editor, inside their own org.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);

  -- Unknown <kind> segment: no arm claims it, so nothing grants the write.
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('avatars', org_b || '/bogus/' || family_b || '/photo.jpg', owner_b, owner_b);
  exception when others then
    wrong_kind_err := sqlstate;
  end;

  -- Nonexistent entity ids: the per-entity EXISTS clauses are the only thing
  -- standing between an admin and an arbitrary key under their own org.
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('avatars', org_b || '/families/' || ghost || '/photo.jpg', owner_b, owner_b);
  exception when others then
    ghost_family_err := sqlstate;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('event-images', org_b || '/events/' || ghost || '/cover.jpg', owner_b, owner_b);
  exception when others then
    ghost_event_err := sqlstate;
  end;

  -- Non-vacuity for the EXISTS arms: a real own-org event id is accepted.
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('event-images', org_b || '/events/' || event_b || '/cover2.jpg', owner_b, owner_b);
  exception when others then
    own_event_err := sqlstate;
  end;

  reset role;

  insert into storage_tenancy_results
    select is(wrong_role_err, '42501',
      'intra-org: a plain member cannot write a family photo (is_admin arm decides, not the floor)');
  insert into storage_tenancy_results
    select is(other_profile_err, '42501',
      'intra-org: a member cannot write another member''s avatar ([3] = auth.uid() decides)');
  insert into storage_tenancy_results
    select is(coalesce(own_profile_err, 'ok'), 'ok',
      'positive control: the plain member writes their OWN avatar in their own org');
  insert into storage_tenancy_results
    select is(wrong_kind_err, '42501',
      'intra-org: an unknown <kind> segment is denied even for an admin (the [2] predicates decide)');
  insert into storage_tenancy_results
    select is(ghost_family_err, '42501',
      'intra-org: an admin cannot write a family photo for a nonexistent family (per-entity EXISTS decides)');
  insert into storage_tenancy_results
    select is(ghost_event_err, '42501',
      'intra-org: a content editor cannot write an image for a nonexistent event (per-entity EXISTS decides)');
  insert into storage_tenancy_results
    select is(coalesce(own_event_err, 'ok'), 'ok',
      'positive control: the content editor writes an image for a REAL own-org event');
end $$;

-- ── Fail-closed with no principal and no header ─────────────────────────────
-- app_request_org_id() resolves NULL → the floor denies everything: reads
-- return zero rows, writes raise 42501.

do $$
declare
  org_a uuid := current_setting('storage_suite.org_a')::uuid;
  anon_read bigint := -1;
  anon_insert_err text := null;
begin
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '{}', true);

  select count(*) into anon_read from storage.objects;
  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', org_a || '/profiles/deadbeef/avatar.jpg');
  exception when others then
    anon_insert_err := sqlstate;
  end;

  reset role;

  insert into storage_tenancy_results
    select is(anon_read, 0::bigint, 'anon with no header reads zero storage objects (fail-closed floor)');
  insert into storage_tenancy_results
    select is(anon_insert_err, '42501', 'anon with no header cannot insert a storage object (RLS 42501)');
end $$;

select line from storage_tenancy_results;
select * from finish();
rollback;
