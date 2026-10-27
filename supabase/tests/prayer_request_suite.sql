-- Prayer request suite: a request is the request, shared by name or
-- anonymously.
--
-- Proves that the category and restricted-tier columns are gone from the
-- table and the prayer_wall view, that the read policy is org isolation plus
-- group membership and nothing else, and that a member of the group reads
-- both a by-name and an anonymous request (with the author nulled on the
-- anonymous one) while a member of another org reads neither.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/prayer_request_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Structure ───────────────────────────────────────────────────────────────
select hasnt_column('public', 'prayer_requests', 'category',
  'prayer_requests has no category column');
select hasnt_column('public', 'prayer_requests', 'visible_to_warriors',
  'prayer_requests has no visible_to_warriors column');
select hasnt_column('public', 'prayer_wall', 'category',
  'prayer_wall has no category column');
select hasnt_column('public', 'prayer_wall', 'visible_to_warriors',
  'prayer_wall has no visible_to_warriors column');
select has_column('public', 'prayer_wall', 'is_anonymous',
  'prayer_wall still exposes is_anonymous');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'prayer_requests'
      and coalesce(qual, '') || coalesce(with_check, '') like '%visible_to_warriors%'),
  0, 'no prayer_requests policy mentions visible_to_warriors');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'prayer_requests'
      and permissive = 'RESTRICTIVE' and policyname = 'org isolation'),
  1, 'the restrictive org isolation policy stays on prayer_requests');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'prayer_requests' and cmd = 'SELECT'
      and qual like '%app_request_org_id()%' and qual like '%is_group_member(group_id)%'),
  1, 'the prayer_requests read policy is org isolation plus group membership');

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Org A: author leads group A, reader is a plain member of it. Org B: its
-- owner leads group B. One by-name and one anonymous request in group A,
-- one request in group B as the positive control.
do $$
declare
  org_a uuid; org_b uuid;
  author uuid := gen_random_uuid();
  reader uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  grp_a uuid; grp_b uuid;
  named uuid; anon uuid;
begin
  org_a := public.provision_organization('Prayer Org A', 'author@prayer-a.example.test');
  org_b := public.provision_organization('Prayer Org B', 'owner@prayer-b.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Reader A', 'reader@prayer-a.example.test', 'approved');
  insert into auth.users (id, email) values
    (author, 'author@prayer-a.example.test'),
    (reader, 'reader@prayer-a.example.test'),
    (owner_b, 'owner@prayer-b.example.test');
  update public.profiles set first_name = 'Ada', last_name = 'Author' where id = author;

  insert into public.groups (org_id, name) values (org_a, 'Group A') returning id into grp_a;
  insert into public.groups (org_id, name) values (org_b, 'Group B') returning id into grp_b;
  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org_a, grp_a, author, 'leader'),
    (org_a, grp_a, reader, 'member'),
    (org_b, grp_b, owner_b, 'leader');

  insert into public.prayer_requests (org_id, group_id, author_id, body, is_anonymous)
    values (org_a, grp_a, author, 'by name', false) returning id into named;
  insert into public.prayer_requests (org_id, group_id, author_id, body, is_anonymous)
    values (org_a, grp_a, author, 'anonymous', true) returning id into anon;
  insert into public.prayer_requests (org_id, group_id, author_id, body, is_anonymous)
    values (org_b, grp_b, owner_b, 'B prayer', false);

  perform set_config('pr.org_a', org_a::text, true);
  perform set_config('pr.author', author::text, true);
  perform set_config('pr.reader', reader::text, true);
  perform set_config('pr.owner_b', owner_b::text, true);
  perform set_config('pr.named', named::text, true);
  perform set_config('pr.anon', anon::text, true);
end $$;

-- ── A member of the group reads both requests ───────────────────────────────
do $$
declare
  reader uuid := current_setting('pr.reader')::uuid;
  named uuid := current_setting('pr.named')::uuid;
  anon uuid := current_setting('pr.anon')::uuid;
  n_total int; named_first text; anon_first text; anon_mine boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', reader)::text, true);
  perform set_config('request.headers', '{}', true);
  select count(*) into n_total from public.prayer_wall;
  select first_name into named_first from public.prayer_wall where id = named;
  select first_name, mine into anon_first, anon_mine from public.prayer_wall where id = anon;
  reset role;
  perform set_config('pr.reader_total', n_total::text, true);
  perform set_config('pr.named_first', coalesce(named_first, '<null>'), true);
  perform set_config('pr.anon_first', coalesce(anon_first, '<null>'), true);
  perform set_config('pr.anon_mine', anon_mine::text, true);
end $$;
select is(current_setting('pr.reader_total')::int, 2,
  'a member of the group reads the by-name and the anonymous request');
select is(current_setting('pr.named_first'), 'Ada',
  'the by-name request carries its author''s name');
select is(current_setting('pr.anon_first'), '<null>',
  'the anonymous request carries no author name for another member');
select is(current_setting('pr.anon_mine'), 'false',
  'the anonymous request is not marked as the reader''s own');

-- ── The author still finds their own anonymous request ──────────────────────
do $$
declare
  author uuid := current_setting('pr.author')::uuid;
  anon uuid := current_setting('pr.anon')::uuid;
  own_first text; own_mine boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', author)::text, true);
  perform set_config('request.headers', '{}', true);
  select first_name, mine into own_first, own_mine from public.prayer_wall where id = anon;
  reset role;
  perform set_config('pr.own_first', coalesce(own_first, '<null>'), true);
  perform set_config('pr.own_mine', own_mine::text, true);
end $$;
select is(current_setting('pr.own_mine'), 'true',
  'the poster''s own anonymous request is marked mine');
select is(current_setting('pr.own_first'), 'Ada',
  'the poster sees their own name on their anonymous request');

-- ── A member of another org reads neither ───────────────────────────────────
do $$
declare
  owner_b uuid := current_setting('pr.owner_b')::uuid;
  org_a uuid := current_setting('pr.org_a')::uuid;
  wall_a int; base_a int; wall_own int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  perform set_config('request.headers', '{}', true);
  select count(*) filter (where org_id = org_a), count(*) filter (where org_id <> org_a)
    into wall_a, wall_own from public.prayer_wall;
  select count(*) into base_a from public.prayer_requests where org_id = org_a;
  reset role;
  perform set_config('pr.wall_a', wall_a::text, true);
  perform set_config('pr.base_a', base_a::text, true);
  perform set_config('pr.wall_own', wall_own::text, true);
end $$;
select is(current_setting('pr.wall_a')::int, 0,
  'a member of another org reads neither request through prayer_wall');
select is(current_setting('pr.base_a')::int, 0,
  'a member of another org reads neither request from prayer_requests');
select is(current_setting('pr.wall_own')::int, 1,
  'non-vacuity: the same principal reads their own org''s request');

select * from finish();
rollback;
