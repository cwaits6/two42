-- Group creation suite: the per-org group_creation_policy, the
-- group_requests table and the group_create() / group_request_approve()
-- definer pair, exercised from the authenticated role.
--
-- SECURITY DEFINER bypasses RLS, so the org checks inside the two RPCs are
-- the tenant boundary on this surface and no lint sees them; this suite is
-- what pins them. It covers the shape and grants, every mode (approval,
-- open, admins), the approve path and what it writes, the zero-row writes
-- a non-admin's decline, a stale decline and a setting change produce, and
-- the cross-org floor. Every "cannot" has a paired positive control so the
-- suite cannot go green by rejecting everything.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/group_creation_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Org A: owner_a is the founding admin; member_a1 and member_a2 are plain
-- approved members; pending_a signed up and was demoted to pending. Org B:
-- its owner only. Each org has the one backfilled group.
do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  member_a1 uuid := gen_random_uuid();
  member_a2 uuid := gen_random_uuid();
  pending_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
begin
  org_a := public.provision_organization('Group Creation Org A', 'group-creation-org-a', 'owner-a@group-creation.example.test');
  org_b := public.provision_organization('Group Creation Org B', 'group-creation-org-b', 'owner-b@group-creation.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Member A1', 'member-a1@group-creation.example.test', 'approved'),
    (org_a, 'Member A2', 'member-a2@group-creation.example.test', 'approved'),
    (org_a, 'Pending A', 'pending-a@group-creation.example.test', 'approved');

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@group-creation.example.test'),
    (member_a1, 'member-a1@group-creation.example.test'),
    (member_a2, 'member-a2@group-creation.example.test'),
    (pending_a, 'pending-a@group-creation.example.test'),
    (owner_b, 'owner-b@group-creation.example.test');

  update public.profiles set role = 'pending' where id = pending_a;

  perform public.group_model_backfill();

  perform set_config('gc.org_a', org_a::text, true);
  perform set_config('gc.org_b', org_b::text, true);
  perform set_config('gc.owner_a', owner_a::text, true);
  perform set_config('gc.member_a1', member_a1::text, true);
  perform set_config('gc.member_a2', member_a2::text, true);
  perform set_config('gc.pending_a', pending_a::text, true);
  perform set_config('gc.owner_b', owner_b::text, true);
end $$;

select is(
  (select role from public.profiles where id = current_setting('gc.owner_a')::uuid),
  'admin', 'owner_a is the org A admin');
select is(
  (select role from public.profiles where id = current_setting('gc.member_a1')::uuid),
  'member', 'member_a1 is a plain org member, so every member-path result below passed through the member arms');
select is(
  (select role from public.profiles where id = current_setting('gc.pending_a')::uuid),
  'pending', 'pending_a is a pending account');

-- ── 1. Shape and grants ─────────────────────────────────────────────────────
select col_not_null('public', 'organizations', 'group_creation_policy',
  'organizations.group_creation_policy is NOT NULL');
select col_default_is('public', 'organizations', 'group_creation_policy', 'approval',
  'organizations.group_creation_policy defaults to approval');
select throws_ok(
  format($q$ update public.organizations set group_creation_policy = 'anyone' where id = %L $q$,
    current_setting('gc.org_a')),
  '23514', null,
  'group_creation_policy refuses a value outside open / approval / admins');
select ok(
  has_column_privilege('authenticated', 'public.organizations', 'group_creation_policy', 'select'),
  'authenticated may read organizations.group_creation_policy');
select ok(
  has_column_privilege('authenticated', 'public.organizations', 'group_creation_policy', 'update'),
  'authenticated may update organizations.group_creation_policy (the policy narrows it to the org admin)');
select ok(
  not has_column_privilege('anon', 'public.organizations', 'group_creation_policy', 'select'),
  'anon may not read organizations.group_creation_policy');

select ok(
  (select pg_get_expr(d.adbin, d.adrelid) in ('app_current_org_id()', 'public.app_current_org_id()')
     from pg_catalog.pg_attrdef d
     join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
     where d.adrelid = 'public.group_requests'::regclass and a.attname = 'org_id'),
  'group_requests.org_id defaults to app_current_org_id()');
select is(
  (select count(*)::int from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'group_requests' and permissive = 'RESTRICTIVE'),
  1, 'group_requests carries exactly one restrictive isolation policy');
select is(
  (select confdeltype::text from pg_constraint where conname = 'group_requests_group_id_fkey'),
  'n', 'group_requests.group_id FK is ON DELETE SET NULL');
select is(
  (select array_agg(a.attname::text)
     from pg_constraint c
     join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.confdelsetcols)
     where c.conname = 'group_requests_group_id_fkey'),
  array['group_id'], 'the SET NULL names group_id only, sparing org_id');

select has_function('public', 'group_create', array['text', 'text', 'uuid'], 'group_create(text, text, uuid) exists');
select has_function('public', 'group_request_approve', array['uuid'], 'group_request_approve(uuid) exists');
select has_function('public', 'group_create_for', array['uuid', 'text', 'text', 'uuid', 'uuid'], 'group_create_for() exists');
select has_function('public', 'org_group_creation_policy', array[]::text[], 'org_group_creation_policy() exists');
select is_definer('public', 'group_create', array['text', 'text', 'uuid'], 'group_create() is SECURITY DEFINER');
select is_definer('public', 'group_request_approve', array['uuid'], 'group_request_approve() is SECURITY DEFINER');
select isnt_definer('public', 'group_create_for', array['uuid', 'text', 'text', 'uuid', 'uuid'],
  'group_create_for() is a plain function reached only through the definer entry points');

select ok(not has_function_privilege('anon', 'public.group_create(text, text, uuid)', 'execute'),
  'anon cannot execute group_create()');
select ok(not has_function_privilege('anon', 'public.group_request_approve(uuid)', 'execute'),
  'anon cannot execute group_request_approve()');
select ok(not has_function_privilege('anon', 'public.org_group_creation_policy()', 'execute'),
  'anon cannot execute org_group_creation_policy()');
select ok(has_function_privilege('authenticated', 'public.group_create(text, text, uuid)', 'execute'),
  'authenticated can execute group_create()');
select ok(has_function_privilege('authenticated', 'public.group_request_approve(uuid)', 'execute'),
  'authenticated can execute group_request_approve()');
select ok(has_function_privilege('authenticated', 'public.org_group_creation_policy()', 'execute'),
  'authenticated can execute org_group_creation_policy()');
select ok(not has_function_privilege('anon', 'public.group_create_for(uuid, text, text, uuid, uuid)', 'execute'),
  'anon cannot execute group_create_for()');
select ok(not has_function_privilege('authenticated', 'public.group_create_for(uuid, text, text, uuid, uuid)', 'execute'),
  'authenticated cannot execute group_create_for()');
select ok(not has_function_privilege('service_role', 'public.group_create_for(uuid, text, text, uuid, uuid)', 'execute'),
  'service_role cannot execute group_create_for()');

-- ── 2. Default mode (approval): members request, nobody but an admin reads ──
do $$
declare
  org_a uuid := current_setting('gc.org_a')::uuid;
  member_a1 uuid := current_setting('gc.member_a1')::uuid;
  member_a2 uuid := current_setting('gc.member_a2')::uuid;
  pending_a uuid := current_setting('gc.pending_a')::uuid;
  owner_a uuid := current_setting('gc.owner_a')::uuid;
  owner_b uuid := current_setting('gc.owner_b')::uuid;
  g uuid;
  req uuid;
  create_err text := 'none'; filed bigint := 0;
  approved_err text := 'none'; other_err text := 'none'; dup_err text := 'none';
  pending_err text := 'none';
  a2_sees bigint; owner_sees bigint; b_sees bigint; b_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  perform set_config('request.headers', '{}', true);

  begin
    g := public.group_create('Men''s Breakfast');
  exception when others then
    create_err := sqlstate;
  end;

  insert into public.group_requests (org_id, requested_by, name, description)
    values (org_a, member_a1, 'Men''s Breakfast', 'Saturdays, 8:00 am')
    returning id into req;
  get diagnostics filed = row_count;

  begin
    insert into public.group_requests (org_id, requested_by, name, status)
      values (org_a, member_a1, 'Pre-approved', 'approved');
  exception when others then
    approved_err := sqlstate;
  end;
  begin
    insert into public.group_requests (org_id, requested_by, name)
      values (org_a, member_a2, 'On behalf');
  exception when others then
    other_err := sqlstate;
  end;
  begin
    insert into public.group_requests (org_id, requested_by, name)
      values (org_a, member_a1, 'Men''s Breakfast');
  exception when others then
    dup_err := sqlstate;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', pending_a)::text, true);
  begin
    insert into public.group_requests (org_id, requested_by, name)
      values (org_a, pending_a, 'Pending ask');
  exception when others then
    pending_err := sqlstate;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a2)::text, true);
  select count(*) into a2_sees from public.group_requests;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  select count(*) into owner_sees from public.group_requests;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  select count(*) into b_sees from public.group_requests where org_id = org_a;
  begin
    insert into public.group_requests (org_id, requested_by, name)
      values (org_a, member_a1, 'Smuggled');
  exception when others then
    b_err := sqlstate;
  end;

  reset role;
  perform set_config('gc.req1', req::text, true);
  perform set_config('gc.s2_create_err', create_err, true);
  perform set_config('gc.s2_filed', filed::text, true);
  perform set_config('gc.s2_approved_err', approved_err, true);
  perform set_config('gc.s2_other_err', other_err, true);
  perform set_config('gc.s2_dup_err', dup_err, true);
  perform set_config('gc.s2_pending_err', pending_err, true);
  perform set_config('gc.s2_a2_sees', a2_sees::text, true);
  perform set_config('gc.s2_owner_sees', owner_sees::text, true);
  perform set_config('gc.s2_b_sees', b_sees::text, true);
  perform set_config('gc.s2_b_err', b_err, true);
end $$;

select is(current_setting('gc.s2_create_err'), 'GC001',
  'under approval a member calling group_create() gets GC001');
select is(current_setting('gc.s2_filed')::int, 1,
  'positive control: the same member files a request');
select is(current_setting('gc.s2_approved_err'), '42501',
  'a member cannot file a request already marked approved');
select is(current_setting('gc.s2_other_err'), '42501',
  'a member cannot file a request on behalf of someone else');
select is(current_setting('gc.s2_dup_err'), '23505',
  'a second pending request with the same name is refused');
select is(current_setting('gc.s2_pending_err'), '42501',
  'a pending account cannot file a request');
select is(current_setting('gc.s2_a2_sees')::int, 0,
  'another member reads none of the requester''s requests');
select is(current_setting('gc.s2_owner_sees')::int, 1,
  'positive control: the org admin reads the one request');
select is(current_setting('gc.s2_b_sees')::int, 0,
  'org B''s admin reads none of org A''s requests');
select is(current_setting('gc.s2_b_err'), '42501',
  'org B''s admin cannot insert a request carrying org A');

-- ── 3. Approve: an admin's RPC call creates the group; decline is an UPDATE ──
do $$
declare
  org_a uuid := current_setting('gc.org_a')::uuid;
  member_a1 uuid := current_setting('gc.member_a1')::uuid;
  owner_a uuid := current_setting('gc.owner_a')::uuid;
  owner_b uuid := current_setting('gc.owner_b')::uuid;
  req uuid := current_setting('gc.req1')::uuid;
  req2 uuid;
  g uuid;
  member_err text := 'none'; again_err text := 'none'; foreign_err text := 'none';
  direct_err text := 'none'; admin_declined bigint; member_declined bigint;
  stale_declined bigint; reset_pending bigint; after_member text; after_stale text;
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);

  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  begin
    g := public.group_request_approve(req);
  exception when others then
    member_err := sqlstate;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  g := public.group_request_approve(req);
  begin
    perform public.group_request_approve(req);
  exception when others then
    again_err := sqlstate;
  end;
  update public.group_requests
    set status = 'declined', reviewed_by = owner_a, reviewed_at = now()
    where id = req;
  get diagnostics stale_declined = row_count;
  update public.group_requests set status = 'pending' where id = req;
  get diagnostics reset_pending = row_count;
  select status into after_stale from public.group_requests where id = req;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  begin
    perform public.group_request_approve(req);
  exception when others then
    foreign_err := sqlstate;
  end;

  reset role;
  insert into public.group_requests (org_id, requested_by, name)
    values (org_a, member_a1, 'Ladies Lunch') returning id into req2;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  update public.group_requests
    set status = 'declined', reviewed_by = member_a1, reviewed_at = now()
    where id = req2;
  get diagnostics member_declined = row_count;
  select status into after_member from public.group_requests where id = req2;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  begin
    update public.group_requests set status = 'approved' where id = req2;
  exception when others then
    direct_err := sqlstate;
  end;
  update public.group_requests
    set status = 'declined', reviewed_by = owner_a, reviewed_at = now()
    where id = req2;
  get diagnostics admin_declined = row_count;

  reset role;
  perform set_config('gc.grp1', g::text, true);
  perform set_config('gc.req2', req2::text, true);
  perform set_config('gc.s3_member_err', member_err, true);
  perform set_config('gc.s3_again_err', again_err, true);
  perform set_config('gc.s3_foreign_err', foreign_err, true);
  perform set_config('gc.s3_direct_err', direct_err, true);
  perform set_config('gc.s3_member_declined', member_declined::text, true);
  perform set_config('gc.s3_after_member', after_member, true);
  perform set_config('gc.s3_admin_declined', admin_declined::text, true);
  perform set_config('gc.s3_stale_declined', stale_declined::text, true);
  perform set_config('gc.s3_reset_pending', reset_pending::text, true);
  perform set_config('gc.s3_after_stale', after_stale, true);
end $$;

select is(current_setting('gc.s3_member_err'), 'GC005',
  'a member approving a request gets GC005');
select is(
  (select count(*)::int from public.groups
    where id = current_setting('gc.grp1')::uuid
      and org_id = current_setting('gc.org_a')::uuid
      and name = 'Men''s Breakfast' and description = 'Saturdays, 8:00 am'
      and created_by = current_setting('gc.member_a1')::uuid),
  1, 'positive control: the admin''s approve creates the group in org A with the request''s name, description and requester as creator');
select is(
  (select count(*)::int from public.group_members where group_id = current_setting('gc.grp1')::uuid),
  1, 'the approved group has exactly one member');
select is(
  (select count(*)::int from public.group_members
    where group_id = current_setting('gc.grp1')::uuid
      and profile_id = current_setting('gc.member_a1')::uuid
      and role = 'leader' and org_id = current_setting('gc.org_a')::uuid),
  1, 'that member is the requester, as leader');
select is(
  (select count(*)::int from public.event_calendars where group_id = current_setting('gc.grp1')::uuid),
  1, 'the approved group has exactly one calendar');
select is(
  (select name || ' ' || color from public.event_calendars where group_id = current_setting('gc.grp1')::uuid),
  'Men''s Breakfast #B85C38', 'the calendar is named after the group and is Clay');
select is(
  (select status || ':' || (group_id = current_setting('gc.grp1')::uuid)::text
          || ':' || (reviewed_by = current_setting('gc.owner_a')::uuid)::text
          || ':' || (reviewed_at is not null)::text
     from public.group_requests where id = current_setting('gc.req1')::uuid),
  'approved:true:true:true', 'the request is approved, linked to the group, and stamped with the reviewer');
select is(current_setting('gc.s3_stale_declined')::int, 0,
  'an admin declining an already-approved request matches zero rows');
select is(current_setting('gc.s3_reset_pending')::int, 0,
  'an admin resetting an approved request to pending matches zero rows');
select is(current_setting('gc.s3_after_stale'), 'approved',
  'and the request stays approved');
select is(current_setting('gc.s3_again_err'), 'GC004',
  'approving the same request again gets GC004');
select is(current_setting('gc.s3_foreign_err'), 'GC004',
  'org B''s admin approving org A''s request gets GC004, the same as a missing id');
select is(current_setting('gc.s3_member_declined')::int, 0,
  'a member''s decline matches zero rows');
select is(current_setting('gc.s3_after_member'), 'pending',
  'and leaves the request pending');
select is(current_setting('gc.s3_direct_err'), '42501',
  'an admin cannot set status = approved with a plain UPDATE');
select is(current_setting('gc.s3_admin_declined')::int, 1,
  'positive control: the admin''s decline matches one row');
select is(
  (select status || ':' || (reviewed_by = current_setting('gc.owner_a')::uuid)::text
     from public.group_requests where id = current_setting('gc.req2')::uuid),
  'declined:true', 'and the request is declined with the reviewer stamped');

-- ── 4. Approve after the requester left: refused, nothing written ───────────
do $$
declare
  org_a uuid := current_setting('gc.org_a')::uuid;
  member_a2 uuid := current_setting('gc.member_a2')::uuid;
  owner_a uuid := current_setting('gc.owner_a')::uuid;
  req3 uuid;
  left_err text := 'none';
begin
  insert into public.group_requests (org_id, requested_by, name)
    values (org_a, member_a2, 'Choir') returning id into req3;
  update public.profiles set role = 'pending' where id = member_a2;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  perform set_config('request.headers', '{}', true);
  begin
    perform public.group_request_approve(req3);
  exception when others then
    left_err := sqlstate;
  end;
  reset role;

  update public.profiles set role = 'member' where id = member_a2;
  perform set_config('gc.req3', req3::text, true);
  perform set_config('gc.s4_left_err', left_err, true);
end $$;

select is(current_setting('gc.s4_left_err'), 'GC003',
  'approving a request whose requester is now pending gets GC003');
select is(
  (select count(*)::int from public.groups where name = 'Choir'),
  0, 'no group was written for it');
select is(
  (select count(*)::int from public.event_calendars where name = 'Choir'),
  0, 'no calendar was written for it');
select is(
  (select status from public.group_requests where id = current_setting('gc.req3')::uuid),
  'pending', 'and the request stays pending');

-- ── 5. Open mode: a member creates and leads; requests are refused ──────────
update public.organizations set group_creation_policy = 'open'
  where id = current_setting('gc.org_a')::uuid;

do $$
declare
  org_a uuid := current_setting('gc.org_a')::uuid;
  member_a1 uuid := current_setting('gc.member_a1')::uuid;
  member_a2 uuid := current_setting('gc.member_a2')::uuid;
  pending_a uuid := current_setting('gc.pending_a')::uuid;
  g uuid;
  leads boolean;
  other_err text := 'none'; request_err text := 'none'; pending_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  perform set_config('request.headers', '{}', true);

  g := public.group_create('Tuesday Table', 'Tuesdays, 7 pm');
  leads := public.is_group_leader(g);

  begin
    perform public.group_create('X', null, member_a2);
  exception when others then
    other_err := sqlstate;
  end;
  begin
    insert into public.group_requests (org_id, requested_by, name)
      values (org_a, member_a1, 'Open-mode ask');
  exception when others then
    request_err := sqlstate;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', pending_a)::text, true);
  begin
    perform public.group_create('Pending group');
  exception when others then
    pending_err := sqlstate;
  end;

  reset role;
  perform set_config('gc.grp2', g::text, true);
  perform set_config('gc.s5_leads', leads::text, true);
  perform set_config('gc.s5_other_err', other_err, true);
  perform set_config('gc.s5_request_err', request_err, true);
  perform set_config('gc.s5_pending_err', pending_err, true);
end $$;

select is(
  (select count(*)::int from public.groups
    where id = current_setting('gc.grp2')::uuid
      and org_id = current_setting('gc.org_a')::uuid
      and name = 'Tuesday Table' and description = 'Tuesdays, 7 pm'
      and created_by = current_setting('gc.member_a1')::uuid),
  1, 'under open a member''s group_create() writes the group in their org with them as creator');
select is(
  (select count(*)::int from public.group_members
    where group_id = current_setting('gc.grp2')::uuid
      and profile_id = current_setting('gc.member_a1')::uuid and role = 'leader'),
  1, 'the creator is the group''s leader');
select is(
  (select count(*)::int from public.group_members where group_id = current_setting('gc.grp2')::uuid),
  1, 'and its only member');
select is(
  (select name || ' ' || color from public.event_calendars where group_id = current_setting('gc.grp2')::uuid),
  'Tuesday Table #B85C38', 'the group got its one calendar, named after it, Clay');
select is(current_setting('gc.s5_leads'), 'true',
  'is_group_leader() is true for the creator under their own claims');
select is(
  (select count(*)::int from public.teams where group_id = current_setting('gc.grp2')::uuid)
  + (select count(*)::int from public.group_labels where group_id = current_setting('gc.grp2')::uuid)
  + (select count(*)::int from public.group_settings where group_id = current_setting('gc.grp2')::uuid),
  0, 'a new group starts with no teams, labels or settings rows');
select is(current_setting('gc.s5_other_err'), 'GC005',
  'a member naming someone else as leader gets GC005');
select is(current_setting('gc.s5_request_err'), '42501',
  'under open a request insert is refused');
select is(current_setting('gc.s5_pending_err'), 'GC002',
  'a pending account calling group_create() gets GC002');

-- ── 6. Admins mode: members get nothing; an admin creates for someone else ──
update public.organizations set group_creation_policy = 'admins'
  where id = current_setting('gc.org_a')::uuid;

do $$
declare
  org_a uuid := current_setting('gc.org_a')::uuid;
  member_a1 uuid := current_setting('gc.member_a1')::uuid;
  member_a2 uuid := current_setting('gc.member_a2')::uuid;
  pending_a uuid := current_setting('gc.pending_a')::uuid;
  owner_a uuid := current_setting('gc.owner_a')::uuid;
  owner_b uuid := current_setting('gc.owner_b')::uuid;
  g uuid;
  create_err text := 'none'; request_err text := 'none';
  foreign_leader_err text := 'none'; pending_leader_err text := 'none'; blank_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);

  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  begin
    perform public.group_create('Members only');
  exception when others then
    create_err := sqlstate;
  end;
  begin
    insert into public.group_requests (org_id, requested_by, name)
      values (org_a, member_a1, 'Admins-mode ask');
  exception when others then
    request_err := sqlstate;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  g := public.group_create('Staff', null, member_a2);
  begin
    perform public.group_create('Bad', null, owner_b);
  exception when others then
    foreign_leader_err := sqlstate;
  end;
  begin
    perform public.group_create('Bad', null, pending_a);
  exception when others then
    pending_leader_err := sqlstate;
  end;
  begin
    perform public.group_create('   ');
  exception when others then
    blank_err := sqlstate;
  end;

  reset role;
  perform set_config('gc.grp3', g::text, true);
  perform set_config('gc.s6_create_err', create_err, true);
  perform set_config('gc.s6_request_err', request_err, true);
  perform set_config('gc.s6_foreign_leader_err', foreign_leader_err, true);
  perform set_config('gc.s6_pending_leader_err', pending_leader_err, true);
  perform set_config('gc.s6_blank_err', blank_err, true);
end $$;

select is(current_setting('gc.s6_create_err'), 'GC001',
  'under admins a member calling group_create() gets GC001');
select is(current_setting('gc.s6_request_err'), '42501',
  'under admins a request insert is refused');
select is(
  (select count(*)::int from public.group_members
    where group_id = current_setting('gc.grp3')::uuid
      and profile_id = current_setting('gc.member_a2')::uuid and role = 'leader'),
  1, 'positive control: the admin creates a group led by the member they named');
select is(
  (select count(*)::int from public.group_members where group_id = current_setting('gc.grp3')::uuid),
  1, 'the named leader is its only member');
select is(
  (select count(*)::int from public.group_members
    where group_id = current_setting('gc.grp3')::uuid
      and profile_id = current_setting('gc.owner_a')::uuid),
  0, 'the admin who named someone else is not a member of the group');
select is(
  (select count(*)::int from public.groups where name = 'Bad'),
  0, 'neither refused leader produced a group');
select is(current_setting('gc.s6_foreign_leader_err'), 'GC003',
  'naming another org''s member as leader gets GC003');
select is(current_setting('gc.s6_pending_leader_err'), 'GC003',
  'naming a pending account as leader gets GC003');
select is(current_setting('gc.s6_blank_err'), 'GC006',
  'a blank name gets GC006');

-- ── 7. The org setting write: the org's own admin, that one column ──────────
do $$
declare
  org_a uuid := current_setting('gc.org_a')::uuid;
  member_a1 uuid := current_setting('gc.member_a1')::uuid;
  owner_a uuid := current_setting('gc.owner_a')::uuid;
  admin_set bigint; member_set bigint; name_err text := 'none';
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  update public.organizations set group_creation_policy = 'approval' where id = org_a;
  get diagnostics admin_set = row_count;
  begin
    update public.organizations set name = 'Renamed' where id = org_a;
  exception when others then
    name_err := sqlstate;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a1)::text, true);
  update public.organizations set group_creation_policy = 'open' where id = org_a;
  get diagnostics member_set = row_count;

  reset role;
  perform set_config('gc.s7_admin_set', admin_set::text, true);
  perform set_config('gc.s7_member_set', member_set::text, true);
  perform set_config('gc.s7_name_err', name_err, true);
end $$;

select is(current_setting('gc.s7_admin_set')::int, 1,
  'the org admin''s setting change matches one row');
select is(current_setting('gc.s7_member_set')::int, 0,
  'a member''s setting change matches zero rows');
select is(
  (select group_creation_policy from public.organizations where id = current_setting('gc.org_a')::uuid),
  'approval', 'and the setting is what the admin set');
select is(current_setting('gc.s7_name_err'), '42501',
  'the admin cannot update organizations.name through the same policy');

-- ── 8. Cross-org floor on the groups created here ───────────────────────────
do $$
declare
  org_a uuid := current_setting('gc.org_a')::uuid;
  owner_b uuid := current_setting('gc.owner_b')::uuid;
  seen bigint; member boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  perform set_config('request.headers', '{}', true);
  select count(*) into seen from public.groups where org_id = org_a;
  member := public.is_group_member(current_setting('gc.grp2')::uuid);
  reset role;
  perform set_config('gc.s8_seen', seen::text, true);
  perform set_config('gc.s8_member', member::text, true);
end $$;

select is(current_setting('gc.s8_seen')::int, 0,
  'org B''s admin reads none of org A''s groups');
select is(current_setting('gc.s8_member'), 'false',
  'is_group_member() is false for org B''s admin on an org A group');
select is(
  (select count(*)::int from public.groups where org_id = current_setting('gc.org_a')::uuid),
  4, 'non-vacuity: org A holds its backfilled group and the three created here');

select * from finish();
rollback;
