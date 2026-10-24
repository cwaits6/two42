-- Group invites suite: the group_invites and group_invite_uses tables, who
-- may mint and revoke a link, the group_invite_redeem() new-person path,
-- the handle_new_user() enrolment it feeds, and the group_invite_join()
-- member path across private, open and approval groups.
--
-- SECURITY DEFINER bypasses RLS, so the org checks inside the functions are
-- the tenant boundary on this surface and no lint sees them; this suite is
-- what pins them. Every "cannot" has a paired positive control so the suite
-- cannot go green by rejecting everything.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/group_invites_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Org A: owner_a is the founding admin and leads no group. A1 is public
-- under approval, led by leader_a1. A2 is public and open, led by
-- leader_a2. A3 is private, led by leader_a1 as well. member_a is a plain
-- member in no group; pending_a signed up and was demoted to pending. Org B:
-- its owner, who leads B1, and member_b in no group. Org C has exactly one
-- group and no invite, for the one-group fallback control. Users are
-- created before any group so the one-group enrolment never fires here.
do $$
declare
  org_a uuid;
  org_b uuid;
  org_c uuid;
  owner_a uuid := gen_random_uuid();
  leader_a1 uuid := gen_random_uuid();
  leader_a2 uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
  pending_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  member_b uuid := gen_random_uuid();
  owner_c uuid := gen_random_uuid();
  grp_a1 uuid;
  grp_a2 uuid;
  grp_a3 uuid;
  grp_b1 uuid;
  grp_c1 uuid;
begin
  org_a := public.provision_organization('Group Invites Org A', 'owner-a@group-invites.example.test');
  org_b := public.provision_organization('Group Invites Org B', 'owner-b@group-invites.example.test');
  org_c := public.provision_organization('Group Invites Org C', 'owner-c@group-invites.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Leader A1', 'leader-a1@group-invites.example.test', 'approved'),
    (org_a, 'Leader A2', 'leader-a2@group-invites.example.test', 'approved'),
    (org_a, 'Member A', 'member-a@group-invites.example.test', 'approved'),
    (org_a, 'Pending A', 'pending-a@group-invites.example.test', 'approved'),
    (org_b, 'Member B', 'member-b@group-invites.example.test', 'approved');

  insert into auth.users (id, email) values
    (owner_a, 'owner-a@group-invites.example.test'),
    (leader_a1, 'leader-a1@group-invites.example.test'),
    (leader_a2, 'leader-a2@group-invites.example.test'),
    (member_a, 'member-a@group-invites.example.test'),
    (pending_a, 'pending-a@group-invites.example.test'),
    (owner_b, 'owner-b@group-invites.example.test'),
    (member_b, 'member-b@group-invites.example.test'),
    (owner_c, 'owner-c@group-invites.example.test');

  update public.profiles set role = 'pending' where id = pending_a;

  insert into public.groups (org_id, name, join_policy, is_private)
    values (org_a, 'A1', 'approval', false) returning id into grp_a1;
  insert into public.groups (org_id, name, join_policy, is_private)
    values (org_a, 'A2', 'open', false) returning id into grp_a2;
  insert into public.groups (org_id, name, join_policy, is_private)
    values (org_a, 'A3', 'approval', true) returning id into grp_a3;
  insert into public.groups (org_id, name)
    values (org_b, 'B1') returning id into grp_b1;
  insert into public.groups (org_id, name)
    values (org_c, 'C1') returning id into grp_c1;

  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org_a, grp_a1, leader_a1, 'leader'),
    (org_a, grp_a2, leader_a2, 'leader'),
    (org_a, grp_a3, leader_a1, 'leader'),
    (org_b, grp_b1, owner_b, 'leader');

  perform set_config('gi.org_a', org_a::text, true);
  perform set_config('gi.org_b', org_b::text, true);
  perform set_config('gi.org_c', org_c::text, true);
  perform set_config('gi.owner_a', owner_a::text, true);
  perform set_config('gi.leader_a1', leader_a1::text, true);
  perform set_config('gi.leader_a2', leader_a2::text, true);
  perform set_config('gi.member_a', member_a::text, true);
  perform set_config('gi.pending_a', pending_a::text, true);
  perform set_config('gi.owner_b', owner_b::text, true);
  perform set_config('gi.member_b', member_b::text, true);
  perform set_config('gi.grp_a1', grp_a1::text, true);
  perform set_config('gi.grp_a2', grp_a2::text, true);
  perform set_config('gi.grp_a3', grp_a3::text, true);
  perform set_config('gi.grp_b1', grp_b1::text, true);
  perform set_config('gi.grp_c1', grp_c1::text, true);
end $$;

select is(
  (select role from public.profiles where id = current_setting('gi.owner_a')::uuid),
  'admin', 'owner_a is the org A admin');
select is(
  (select count(*)::int from public.group_members where profile_id = current_setting('gi.owner_a')::uuid),
  0, 'owner_a leads no group, so every admin-path result below came through the admin arm');
select is(
  (select count(*)::int from public.groups where org_id = current_setting('gi.org_a')::uuid),
  3, 'org A has three groups, so the one-group signup enrolment cannot fire for it');

-- ── 1. Shape and grants ─────────────────────────────────────────────────────
select ok(
  (select pg_get_expr(d.adbin, d.adrelid) in ('app_current_org_id()', 'public.app_current_org_id()')
     from pg_catalog.pg_attrdef d
     join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
     where d.adrelid = 'public.group_invites'::regclass and a.attname = 'org_id'),
  'group_invites.org_id defaults to app_current_org_id()');
select col_not_null('public', 'group_invites', 'org_id', 'group_invites.org_id is NOT NULL');
select ok(
  (select pg_get_expr(d.adbin, d.adrelid) in ('app_current_org_id()', 'public.app_current_org_id()')
     from pg_catalog.pg_attrdef d
     join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
     where d.adrelid = 'public.group_invite_uses'::regclass and a.attname = 'org_id'),
  'group_invite_uses.org_id defaults to app_current_org_id()');
select col_not_null('public', 'group_invite_uses', 'org_id', 'group_invite_uses.org_id is NOT NULL');
select col_is_null('public', 'group_invites', 'expires_at', 'expires_at is nullable: no expiry unless set');
select col_is_null('public', 'group_invites', 'max_uses', 'max_uses is nullable: unlimited unless set');
select throws_ok(
  format($q$ insert into public.group_invites (org_id, group_id, max_uses) values (%L, %L, 0) $q$,
    current_setting('gi.org_a'), current_setting('gi.grp_a1')),
  '23514', null, 'max_uses refuses zero');
select is(
  (select count(*)::int from unnest(array[
      'group_invites_group_id_fkey',
      'group_invite_uses_invite_id_fkey',
      'group_invite_uses_profile_id_fkey',
      'group_invite_uses_access_request_id_fkey',
      'access_requests_group_id_fkey',
      'access_requests_group_invite_id_fkey']) as c(name)
   where exists (
     select 1 from pg_constraint con
     where con.conname = c.name and con.contype = 'f'
       and exists (
         select 1 from unnest(con.conkey) k(attnum)
         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
         where a.attname = 'org_id'))),
  6, 'every FK out of the invite tables and the two new access_requests FKs is composite on org_id');
select is(
  (select count(*)::int from pg_constraint con
   where con.conname in ('access_requests_group_id_fkey', 'access_requests_group_invite_id_fkey',
                         'group_invite_uses_profile_id_fkey', 'group_invite_uses_access_request_id_fkey')
     and con.confdeltype = 'n'
     and cardinality(con.confdelsetcols) = 1
     and not exists (
       select 1 from pg_attribute a
       where a.attrelid = con.conrelid and a.attname = 'org_id' and a.attnum = any (con.confdelsetcols))),
  4, 'every SET NULL names a single column list that spares org_id');
select has_unique('public', 'access_requests', 'access_requests carries a unique for the composite parent key');
select is(
  (select count(*)::int from pg_catalog.pg_policies
     where schemaname = 'public' and tablename in ('group_invites', 'group_invite_uses')
       and permissive = 'RESTRICTIVE'),
  2, 'each invite table carries exactly one restrictive isolation policy');
select is(
  (select coalesce(array_agg(cmd order by cmd), '{}') from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'group_invites' and permissive = 'PERMISSIVE'),
  array['INSERT', 'SELECT', 'UPDATE'], 'group_invites has SELECT, INSERT and UPDATE policies and no DELETE');
select is(
  (select coalesce(array_agg(cmd order by cmd), '{}') from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'group_invite_uses' and permissive = 'PERMISSIVE'),
  array['SELECT'], 'the only permissive policy on group_invite_uses is the SELECT');

select ok(
  not has_any_column_privilege('anon', 'public.group_invites', 'select')
  and not has_table_privilege('anon', 'public.group_invites', 'insert')
  and not has_table_privilege('anon', 'public.group_invites', 'update')
  and not has_table_privilege('anon', 'public.group_invites', 'delete'),
  'anon holds no privilege on group_invites');
select ok(
  not has_any_column_privilege('anon', 'public.group_invite_uses', 'select')
  and not has_table_privilege('anon', 'public.group_invite_uses', 'insert'),
  'anon holds no privilege on group_invite_uses');
select ok(
  has_table_privilege('authenticated', 'public.group_invites', 'select')
  and has_table_privilege('authenticated', 'public.group_invites', 'insert'),
  'positive control: authenticated holds SELECT and INSERT on group_invites');
select ok(
  not has_table_privilege('authenticated', 'public.group_invites', 'update')
  and has_column_privilege('authenticated', 'public.group_invites', 'revoked_at', 'update')
  and not has_column_privilege('authenticated', 'public.group_invites', 'max_uses', 'update')
  and not has_column_privilege('authenticated', 'public.group_invites', 'expires_at', 'update')
  and not has_column_privilege('authenticated', 'public.group_invites', 'group_id', 'update'),
  'authenticated may UPDATE group_invites.revoked_at and no other column');
select ok(
  not has_table_privilege('authenticated', 'public.group_invites', 'delete'),
  'authenticated holds no DELETE on group_invites');
select ok(
  not has_table_privilege('authenticated', 'public.group_invite_uses', 'insert')
  and not has_table_privilege('authenticated', 'public.group_invite_uses', 'update')
  and not has_table_privilege('authenticated', 'public.group_invite_uses', 'delete'),
  'authenticated holds no INSERT, UPDATE or DELETE on group_invite_uses');

select has_function('public', 'group_invite_redeem', array['uuid', 'text', 'text', 'text', 'timestamp with time zone'],
  'group_invite_redeem(uuid, text, text, text, timestamptz) exists');
select has_function('public', 'group_invite_join', array['uuid'], 'group_invite_join(uuid) exists');
select is_definer('public', 'group_invite_redeem', array['uuid', 'text', 'text', 'text', 'timestamp with time zone'],
  'group_invite_redeem() is SECURITY DEFINER');
select is_definer('public', 'group_invite_join', array['uuid'], 'group_invite_join() is SECURITY DEFINER');
select ok(
  not has_function_privilege('anon', 'public.group_invite_redeem(uuid, text, text, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.group_invite_redeem(uuid, text, text, text, timestamptz)', 'execute'),
  'neither anon nor authenticated can execute group_invite_redeem()');
select ok(
  has_function_privilege('service_role', 'public.group_invite_redeem(uuid, text, text, text, timestamptz)', 'execute'),
  'positive control: service_role can execute group_invite_redeem()');
select ok(
  not has_function_privilege('anon', 'public.group_invite_join(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.group_invite_join(uuid)', 'execute'),
  'neither anon nor service_role can execute group_invite_join()');
select ok(
  has_function_privilege('authenticated', 'public.group_invite_join(uuid)', 'execute'),
  'authenticated can execute group_invite_join()');

-- ── 2. Who may mint, see and revoke a link ──────────────────────────────────
do $$
declare
  grp_a1 uuid := current_setting('gi.grp_a1')::uuid;
  grp_a2 uuid := current_setting('gi.grp_a2')::uuid;
  leader_a1 uuid := current_setting('gi.leader_a1')::uuid;
  member_a uuid := current_setting('gi.member_a')::uuid;
  owner_a uuid := current_setting('gi.owner_a')::uuid;
  owner_b uuid := current_setting('gi.owner_b')::uuid;
  link_a1 uuid; link_a2_admin uuid; token_a1 uuid;
  own_group_err text := 'none'; other_group_err text := 'none'; member_err text := 'none';
  forged_creator_err text := 'none'; pre_revoked_err text := 'none';
  leader_sees text; b_admin_sees bigint;
  revoke_rows int; unrevoke_err text := 'none'; max_uses_err text := 'none';
  member_reads bigint; uses_reads_b bigint;
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);

  -- The leader of A1 mints a link for A1 (control), not for A2.
  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  begin
    insert into public.group_invites (group_id, created_by) values (grp_a1, leader_a1)
      returning id, token into link_a1, token_a1;
  exception when others then
    own_group_err := sqlstate;
  end;
  begin
    insert into public.group_invites (group_id, created_by) values (grp_a2, leader_a1);
  exception when others then
    other_group_err := sqlstate;
  end;
  begin
    insert into public.group_invites (group_id, created_by) values (grp_a1, owner_a);
  exception when others then
    forged_creator_err := sqlstate;
  end;
  begin
    insert into public.group_invites (group_id, created_by, revoked_at) values (grp_a1, leader_a1, now());
  exception when others then
    pre_revoked_err := sqlstate;
  end;

  -- A plain member mints nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
  begin
    insert into public.group_invites (group_id, created_by) values (grp_a1, member_a);
  exception when others then
    member_err := sqlstate;
  end;
  select count(*) into member_reads from public.group_invites;

  -- The org admin mints for a group they do not lead.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  insert into public.group_invites (group_id, created_by) values (grp_a2, owner_a)
    returning id into link_a2_admin;

  -- The leader of A1 sees A1's links and none of A2's.
  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  select string_agg(group_id::text, ',') into leader_sees from public.group_invites;

  -- Org B's admin sees nothing of org A's.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  select count(*) into b_admin_sees from public.group_invites;
  select count(*) into uses_reads_b from public.group_invite_uses;

  -- Revoke is a one-row update on revoked_at, and one-way.
  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  with r as (update public.group_invites set revoked_at = now() where id = link_a1 returning 1)
    select count(*) into revoke_rows from r;
  begin
    update public.group_invites set revoked_at = null where id = link_a1;
  exception when others then
    unrevoke_err := sqlstate;
  end;
  begin
    update public.group_invites set max_uses = 5 where id = link_a1;
  exception when others then
    max_uses_err := sqlstate;
  end;

  reset role;
  perform set_config('gi.link_a1', link_a1::text, true);
  perform set_config('gi.token_a1', token_a1::text, true);
  perform set_config('gi.link_a2_admin', link_a2_admin::text, true);
  perform set_config('gi.s2_own_group_err', own_group_err, true);
  perform set_config('gi.s2_other_group_err', other_group_err, true);
  perform set_config('gi.s2_forged_creator_err', forged_creator_err, true);
  perform set_config('gi.s2_pre_revoked_err', pre_revoked_err, true);
  perform set_config('gi.s2_member_err', member_err, true);
  perform set_config('gi.s2_member_reads', member_reads::text, true);
  perform set_config('gi.s2_leader_sees', coalesce(leader_sees, 'none'), true);
  perform set_config('gi.s2_b_admin_sees', b_admin_sees::text, true);
  perform set_config('gi.s2_uses_reads_b', uses_reads_b::text, true);
  perform set_config('gi.s2_revoke_rows', revoke_rows::text, true);
  perform set_config('gi.s2_unrevoke_err', unrevoke_err, true);
  perform set_config('gi.s2_max_uses_err', max_uses_err, true);
end $$;

select is(current_setting('gi.s2_own_group_err'), 'none',
  'positive control: the leader of A1 mints a link for A1');
select is(current_setting('gi.s2_other_group_err'), '42501',
  'the leader of A1 cannot mint a link for A2 (RLS 42501)');
select is(current_setting('gi.s2_forged_creator_err'), '42501',
  'a link whose created_by is not the caller is refused (RLS 42501)');
select is(current_setting('gi.s2_pre_revoked_err'), '42501',
  'a link cannot be minted already revoked (RLS 42501)');
select is(current_setting('gi.s2_member_err'), '42501',
  'a plain member cannot mint a link (RLS 42501)');
select is(current_setting('gi.s2_member_reads')::int, 0,
  'a plain member reads no links');
select is(current_setting('gi.s2_leader_sees'), current_setting('gi.grp_a1'),
  'the leader of A1 sees exactly A1''s link and not the admin''s A2 link');
select is(current_setting('gi.s2_b_admin_sees')::int, 0,
  'org B''s admin reads none of org A''s links');
select is(current_setting('gi.s2_uses_reads_b')::int, 0,
  'org B''s admin reads none of org A''s use rows');
select is(current_setting('gi.s2_revoke_rows')::int, 1,
  'the leader revokes their own link (one row)');
select is(current_setting('gi.s2_unrevoke_err'), '42501',
  'clearing revoked_at again fails the WITH CHECK: revoke is one-way (RLS 42501)');
select is(current_setting('gi.s2_max_uses_err'), '42501',
  'a leader cannot change max_uses after minting (column grant 42501)');
select ok(
  (select revoked_at is not null from public.group_invites where id = current_setting('gi.link_a1')::uuid),
  'and the link stays revoked');
select throws_ok(
  format($q$ insert into public.group_invite_uses (org_id, invite_id, group_id, email, outcome)
           values (%L, %L, %L, 'x@group-invites.example.test', 'accepted') $q$,
    current_setting('gi.org_a'), current_setting('gi.link_a1'), current_setting('gi.grp_a1')),
  '23514', null, 'outcome refuses a value outside signup_sent / joined / requested');
select throws_ok(
  format($q$ insert into public.group_invite_uses (org_id, invite_id, group_id, outcome)
           values (%L, %L, %L, 'signup_sent') $q$,
    current_setting('gi.org_a'), current_setting('gi.link_a1'), current_setting('gi.grp_a1')),
  '23514', null, 'a signup_sent use must carry the address it was sent to');

-- ── 3. The new-person path ──────────────────────────────────────────────────
-- A fresh link into A1 (org A has three groups, so enrolment must come from
-- the invite, never the one-group fallback).
do $$
declare
  grp_a1 uuid := current_setting('gi.grp_a1')::uuid;
  leader_a1 uuid := current_setting('gi.leader_a1')::uuid;
  org_a uuid := current_setting('gi.org_a')::uuid;
  link uuid; tok uuid;
  r record;
  r2 record;
  newcomer uuid := gen_random_uuid();
  signed_in_err text := 'none';
  blank_err text := 'none';
  bad_email_err text := 'none';
begin
  insert into public.group_invites (org_id, group_id, created_by) values (org_a, grp_a1, leader_a1)
    returning id, token into link, tok;

  -- The service role carries no principal; the earlier block's claims
  -- persist for the transaction, so clear them. Input validation and the
  -- signed-in guard run before any row is written. The guard is exercised
  -- with claims set but as the owner, since authenticated has no EXECUTE.
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.group_invite_redeem(tok, '', 'blank@group-invites.example.test', 'tok-blank', now() + interval '7 days');
  exception when others then
    blank_err := sqlstate;
  end;
  begin
    perform public.group_invite_redeem(tok, 'No At', 'not-an-email', 'tok-bad', now() + interval '7 days');
  exception when others then
    bad_email_err := sqlstate;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  begin
    perform public.group_invite_redeem(tok, 'Signed In', 'signed-in@group-invites.example.test', 'tok-signed', now() + interval '7 days');
  exception when others then
    signed_in_err := sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);

  -- The real redemption, as the service role would run it (no principal).
  select * into r from public.group_invite_redeem(
    tok, '  Newcomer One ', 'Newcomer-One@Group-Invites.example.test', 'tok-newcomer-1', now() + interval '7 days');
  -- The same address again: the token is refreshed, no second use.
  select * into r2 from public.group_invite_redeem(
    tok, 'Newcomer One', 'newcomer-one@group-invites.example.test', 'tok-newcomer-1b', now() + interval '7 days');

  -- The person signs up.
  insert into auth.users (id, email) values (newcomer, 'newcomer-one@group-invites.example.test');

  perform set_config('gi.link_new', link::text, true);
  perform set_config('gi.token_new', tok::text, true);
  perform set_config('gi.newcomer', newcomer::text, true);
  perform set_config('gi.s3_org', r.org_id::text, true);
  perform set_config('gi.s3_group', r.group_id::text, true);
  perform set_config('gi.s3_group_name', r.group_name, true);
  perform set_config('gi.s3_request', r.access_request_id::text, true);
  perform set_config('gi.s3_request_again', r2.access_request_id::text, true);
  perform set_config('gi.s3_signed_in_err', signed_in_err, true);
  perform set_config('gi.s3_blank_err', blank_err, true);
  perform set_config('gi.s3_bad_email_err', bad_email_err, true);
end $$;

select is(current_setting('gi.s3_blank_err'), 'GI002', 'a blank name is GI002');
select is(current_setting('gi.s3_bad_email_err'), 'GI002', 'an address without @ is GI002');
select is(current_setting('gi.s3_signed_in_err'), 'GI006', 'a signed-in caller on the new-person path is GI006');
select is(current_setting('gi.s3_org'), current_setting('gi.org_a'), 'redeem returns the invite''s org');
select is(current_setting('gi.s3_group'), current_setting('gi.grp_a1'), 'redeem returns the invite''s group');
select is(current_setting('gi.s3_group_name'), 'A1', 'redeem returns the group name');
select is(current_setting('gi.s3_request_again'), current_setting('gi.s3_request'),
  'a repeat submission by the same address refreshes the same access request');
select is(
  (select status || ':' || name || ':' || email || ':' || (reviewed_by = current_setting('gi.leader_a1')::uuid)::text
      || ':' || (group_id = current_setting('gi.grp_a1')::uuid)::text
      || ':' || (group_invite_id = current_setting('gi.link_new')::uuid)::text
      || ':' || signup_token || ':' || coalesce(approved_role, 'member-by-default')
     from public.access_requests where id = current_setting('gi.s3_request')::uuid),
  'approved:Newcomer One:newcomer-one@group-invites.example.test:true:true:true:tok-newcomer-1b:member-by-default',
  'the access request is approved, vouched by the link''s creator, names the group and link, carries the latest token, and lowers and trims the input');
select is(
  (select count(*)::int from public.group_invite_uses where invite_id = current_setting('gi.link_new')::uuid),
  1, 'two submissions by one address are one use');
select is(
  (select outcome || ':' || email || ':' || (access_request_id = current_setting('gi.s3_request')::uuid)::text
     from public.group_invite_uses where invite_id = current_setting('gi.link_new')::uuid),
  'signup_sent:newcomer-one@group-invites.example.test:true',
  'the use row records signup_sent, the lower-cased address and the request');
select is(
  (select role || ':' || (org_id = current_setting('gi.org_a')::uuid)::text
     from public.profiles where id = current_setting('gi.newcomer')::uuid),
  'member:true', 'the newcomer signs up as a member of org A');
select is(
  (select string_agg(group_id::text || ':' || role || ':' || coalesce(added_by::text, '-'), ',')
     from public.group_members where profile_id = current_setting('gi.newcomer')::uuid),
  current_setting('gi.grp_a1') || ':member:' || current_setting('gi.leader_a1'),
  'the newcomer lands in exactly the invite''s group, as a member, added by the link''s creator');
select is(
  (select profile_id from public.group_invite_uses where invite_id = current_setting('gi.link_new')::uuid),
  current_setting('gi.newcomer')::uuid, 'signup stamps the use row with the new profile');

-- Dead links, denied addresses and addresses that could never sign up.
do $$
declare
  grp_a1 uuid := current_setting('gi.grp_a1')::uuid;
  grp_a2 uuid := current_setting('gi.grp_a2')::uuid;
  leader_a1 uuid := current_setting('gi.leader_a1')::uuid;
  org_a uuid := current_setting('gi.org_a')::uuid;
  org_b uuid := current_setting('gi.org_b')::uuid;
  live_token uuid := current_setting('gi.token_new')::uuid;
  revoked_token uuid := (select token from public.group_invites where id = current_setting('gi.link_a1')::uuid);
  expired_token uuid; capped_token uuid;
  unknown_err text := 'none'; revoked_err text := 'none'; expired_err text := 'none';
  cap_first text := 'none'; cap_second_err text := 'none'; cap_resend text := 'none'; cap_uses bigint;
  has_profile_err text := 'none'; approved_elsewhere_err text := 'none'; invited_elsewhere_err text := 'none';
  denied_err text := 'none'; denied_status text;
  _family uuid; _fm uuid;
begin
  insert into public.group_invites (org_id, group_id, created_by, expires_at)
    values (org_a, grp_a1, leader_a1, now() - interval '1 minute') returning token into expired_token;
  insert into public.group_invites (org_id, group_id, created_by, max_uses)
    values (org_a, grp_a1, leader_a1, 1) returning token into capped_token;

  begin
    perform public.group_invite_redeem(gen_random_uuid(), 'Nobody', 'nobody@group-invites.example.test', 'tok-nobody', now() + interval '7 days');
  exception when others then unknown_err := sqlstate; end;
  begin
    perform public.group_invite_redeem(revoked_token, 'Late', 'late@group-invites.example.test', 'tok-late', now() + interval '7 days');
  exception when others then revoked_err := sqlstate; end;
  begin
    perform public.group_invite_redeem(expired_token, 'Later', 'later@group-invites.example.test', 'tok-later', now() + interval '7 days');
  exception when others then expired_err := sqlstate; end;

  -- A one-use link: the first address uses it, a second is refused, the
  -- first may still resend.
  begin
    perform public.group_invite_redeem(capped_token, 'First', 'first@group-invites.example.test', 'tok-first', now() + interval '7 days');
    cap_first := 'ok';
  exception when others then cap_first := sqlstate; end;
  begin
    perform public.group_invite_redeem(capped_token, 'Second', 'second@group-invites.example.test', 'tok-second', now() + interval '7 days');
  exception when others then cap_second_err := sqlstate; end;
  begin
    perform public.group_invite_redeem(capped_token, 'First', 'first@group-invites.example.test', 'tok-first-again', now() + interval '7 days');
    cap_resend := 'ok';
  exception when others then cap_resend := sqlstate; end;
  select count(*) into cap_uses from public.group_invite_uses u
    join public.group_invites gi on gi.id = u.invite_id where gi.token = capped_token;

  -- Addresses a setup link could never serve.
  begin
    perform public.group_invite_redeem(live_token, 'Already', 'leader-a1@group-invites.example.test', 'tok-already', now() + interval '7 days');
  exception when others then has_profile_err := sqlstate; end;
  insert into public.access_requests (org_id, name, email, status)
    values (org_b, 'Elsewhere', 'approved-elsewhere@group-invites.example.test', 'approved');
  begin
    perform public.group_invite_redeem(live_token, 'Elsewhere', 'approved-elsewhere@group-invites.example.test', 'tok-elsewhere', now() + interval '7 days');
  exception when others then approved_elsewhere_err := sqlstate; end;
  insert into public.family_units (org_id, family_name) values (org_b, 'B family') returning id into _family;
  insert into public.family_members (org_id, family_id, first_name, relationship)
    values (org_b, _family, 'B spouse', 'spouse') returning id into _fm;
  insert into public.family_invites (org_id, family_id, family_member_id, invite_email)
    values (org_b, _family, _fm, 'invited-elsewhere@group-invites.example.test');
  begin
    perform public.group_invite_redeem(live_token, 'Invited', 'invited-elsewhere@group-invites.example.test', 'tok-invited', now() + interval '7 days');
  exception when others then invited_elsewhere_err := sqlstate; end;

  -- An admin's denial beats a leader's link, and the row stays denied.
  insert into public.access_requests (org_id, name, email, status)
    values (org_a, 'Denied', 'denied@group-invites.example.test', 'denied');
  begin
    perform public.group_invite_redeem(live_token, 'Denied', 'denied@group-invites.example.test', 'tok-denied', now() + interval '7 days');
  exception when others then denied_err := sqlstate; end;
  select status into denied_status from public.access_requests
    where org_id = org_a and email = 'denied@group-invites.example.test';

  perform set_config('gi.s3b_unknown_err', unknown_err, true);
  perform set_config('gi.s3b_revoked_err', revoked_err, true);
  perform set_config('gi.s3b_expired_err', expired_err, true);
  perform set_config('gi.s3b_cap_first', cap_first, true);
  perform set_config('gi.s3b_cap_second_err', cap_second_err, true);
  perform set_config('gi.s3b_cap_resend', cap_resend, true);
  perform set_config('gi.s3b_cap_uses', cap_uses::text, true);
  perform set_config('gi.s3b_has_profile_err', has_profile_err, true);
  perform set_config('gi.s3b_approved_elsewhere_err', approved_elsewhere_err, true);
  perform set_config('gi.s3b_invited_elsewhere_err', invited_elsewhere_err, true);
  perform set_config('gi.s3b_denied_err', denied_err, true);
  perform set_config('gi.s3b_denied_status', denied_status, true);
end $$;

select is(current_setting('gi.s3b_unknown_err'), 'GI001', 'an unknown token is GI001');
select is(current_setting('gi.s3b_revoked_err'), 'GI001', 'a revoked link is GI001, the same code');
select is(current_setting('gi.s3b_expired_err'), 'GI001', 'an expired link is GI001, the same code');
select is(current_setting('gi.s3b_cap_first'), 'ok', 'positive control: the first address uses a one-use link');
select is(current_setting('gi.s3b_cap_second_err'), 'GI001', 'a second address on a used-up link is GI001');
select is(current_setting('gi.s3b_cap_resend'), 'ok', 'the first address can still resend on the used-up link');
select is(current_setting('gi.s3b_cap_uses')::int, 1, 'and the used-up link still holds one use');
select is(
  (select count(*)::int from public.access_requests where email = 'second@group-invites.example.test'),
  0, 'the refused second address left no access request behind');
select is(current_setting('gi.s3b_has_profile_err'), 'GI003', 'an address that already has an account is GI003');
select is(current_setting('gi.s3b_approved_elsewhere_err'), 'GI003', 'an address approved in another org is GI003');
select is(current_setting('gi.s3b_invited_elsewhere_err'), 'GI003', 'an address with an unclaimed family invite in another org is GI003');
select is(current_setting('gi.s3b_denied_err'), 'GI004', 'an address an admin denied is GI004');
select is(current_setting('gi.s3b_denied_status'), 'denied', 'and the denied row stays denied');

-- The one-group fallback still enrols a signup that came through no link.
do $$
declare
  u uuid := gen_random_uuid();
begin
  insert into public.access_requests (org_id, name, email, status)
    values (current_setting('gi.org_c')::uuid, 'Plain C', 'plain-c@group-invites.example.test', 'approved');
  insert into auth.users (id, email) values (u, 'plain-c@group-invites.example.test');
  perform set_config('gi.plain_c', u::text, true);
end $$;
select is(
  (select string_agg(group_id::text, ',') from public.group_members where profile_id = current_setting('gi.plain_c')::uuid),
  current_setting('gi.grp_c1'), 'regression control: a one-group org still enrols a plain approved signup');

-- ── 4. The member path ──────────────────────────────────────────────────────
do $$
declare
  org_a uuid := current_setting('gi.org_a')::uuid;
  grp_a1 uuid := current_setting('gi.grp_a1')::uuid;
  grp_a2 uuid := current_setting('gi.grp_a2')::uuid;
  grp_a3 uuid := current_setting('gi.grp_a3')::uuid;
  leader_a1 uuid := current_setting('gi.leader_a1')::uuid;
  leader_a2 uuid := current_setting('gi.leader_a2')::uuid;
  member_a uuid := current_setting('gi.member_a')::uuid;
  pending_a uuid := current_setting('gi.pending_a')::uuid;
  member_b uuid := current_setting('gi.member_b')::uuid;
  t_private uuid; t_open uuid; t_approval uuid; t_capped uuid;
  anon_err text := 'none'; pending_err text := 'none'; cross_org_err text := 'none'; revoked_err text := 'none';
  private_result text; private_again text; open_result text; approval_result text; approval_again text;
  capped_result text; capped_second_err text := 'none';
begin
  insert into public.group_invites (org_id, group_id, created_by) values (org_a, grp_a3, leader_a1) returning token into t_private;
  insert into public.group_invites (org_id, group_id, created_by) values (org_a, grp_a2, leader_a2) returning token into t_open;
  insert into public.group_invites (org_id, group_id, created_by) values (org_a, grp_a1, leader_a1) returning token into t_approval;
  insert into public.group_invites (org_id, group_id, created_by, max_uses) values (org_a, grp_a2, leader_a2, 1) returning token into t_capped;

  -- No principal: GI006 before any lookup. Run as the owner, since anon
  -- has no EXECUTE (pinned above) and would stop at 42501 instead.
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.group_invite_join(t_open);
  exception when others then anon_err := sqlstate; end;

  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', pending_a)::text, true);
  begin
    perform public.group_invite_join(t_open);
  exception when others then pending_err := sqlstate; end;

  perform set_config('request.jwt.claims', json_build_object('sub', member_b)::text, true);
  begin
    perform public.group_invite_join(t_open);
  exception when others then cross_org_err := sqlstate; end;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a)::text, true);
  begin
    perform public.group_invite_join((select token from public.group_invites where id = current_setting('gi.link_a1')::uuid));
  exception when others then revoked_err := sqlstate; end;

  private_result := public.group_invite_join(t_private);
  private_again := public.group_invite_join(t_private);
  open_result := public.group_invite_join(t_open);
  approval_result := public.group_invite_join(t_approval);
  approval_again := public.group_invite_join(t_approval);

  -- A one-use link: the first member uses it, a second is refused.
  perform set_config('request.jwt.claims', json_build_object('sub', leader_a1)::text, true);
  capped_result := public.group_invite_join(t_capped);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('gi.owner_a'))::text, true);
  begin
    perform public.group_invite_join(t_capped);
  exception when others then capped_second_err := sqlstate; end;

  reset role;
  perform set_config('gi.t_private', t_private::text, true);
  perform set_config('gi.t_open', t_open::text, true);
  perform set_config('gi.t_approval', t_approval::text, true);
  perform set_config('gi.t_capped', t_capped::text, true);
  perform set_config('gi.s4_anon_err', anon_err, true);
  perform set_config('gi.s4_pending_err', pending_err, true);
  perform set_config('gi.s4_cross_org_err', cross_org_err, true);
  perform set_config('gi.s4_revoked_err', revoked_err, true);
  perform set_config('gi.s4_private_result', private_result, true);
  perform set_config('gi.s4_private_again', private_again, true);
  perform set_config('gi.s4_open_result', open_result, true);
  perform set_config('gi.s4_approval_result', approval_result, true);
  perform set_config('gi.s4_approval_again', approval_again, true);
  perform set_config('gi.s4_capped_result', capped_result, true);
  perform set_config('gi.s4_capped_second_err', capped_second_err, true);
end $$;

select is(current_setting('gi.s4_anon_err'), 'GI006', 'an anonymous caller on the member path is GI006');
select is(current_setting('gi.s4_pending_err'), 'GI006', 'a pending-role caller is GI006');
select is(current_setting('gi.s4_cross_org_err'), 'GI001', 'an org B member with an org A token gets GI001, the same as a dead link');
select is(current_setting('gi.s4_revoked_err'), 'GI001', 'a revoked link is GI001 on the member path too');
select is(current_setting('gi.s4_private_result'), 'joined', 'a private group admits the member at once: the link is the approval');
select is(
  (select role || ':' || coalesce(added_by::text, '-') || ':' || (org_id = current_setting('gi.org_a')::uuid)::text
     from public.group_members
     where group_id = current_setting('gi.grp_a3')::uuid and profile_id = current_setting('gi.member_a')::uuid),
  'member:' || current_setting('gi.leader_a1') || ':true',
  'the private-group membership is a member row in org A, added by the link''s creator');
select is(current_setting('gi.s4_private_again'), 'already_member', 'following the same link again is already_member');
select is(current_setting('gi.s4_open_result'), 'joined', 'an open group joins at once through join_group_apply()');
select is(
  (select coalesce(added_by::text, '-') from public.group_members
     where group_id = current_setting('gi.grp_a2')::uuid and profile_id = current_setting('gi.member_a')::uuid),
  current_setting('gi.member_a'), 'the open-group membership carries the core''s added_by = the actor');
select is(current_setting('gi.s4_approval_result'), 'requested', 'an approval group files a request');
select is(current_setting('gi.s4_approval_again'), 'requested', 'following it again is still requested, not a duplicate');
select is(
  (select count(*)::int from public.group_join_requests
     where group_id = current_setting('gi.grp_a1')::uuid and profile_id = current_setting('gi.member_a')::uuid and status = 'pending'),
  1, 'exactly one pending join request was filed');
select is(
  (select string_agg(g.name || ':' || u.outcome || ':' || coalesce(u.email, '-'), ',' order by g.name)
     from public.group_invite_uses u
     join public.group_invites gi on gi.id = u.invite_id
     join public.groups g on g.id = gi.group_id and g.org_id = gi.org_id
     where u.profile_id = current_setting('gi.member_a')::uuid),
  'A1:requested:member-a@group-invites.example.test,'
    || 'A2:joined:member-a@group-invites.example.test,'
    || 'A3:joined:member-a@group-invites.example.test',
  'one use row per link for the member: requested, joined and joined, each with their address');
select is(
  (select count(*)::int from public.group_invite_uses u join public.group_invites gi on gi.id = u.invite_id
     where gi.token = current_setting('gi.t_private')::uuid),
  1, 'already_member wrote no second use row');
select is(current_setting('gi.s4_capped_result'), 'joined', 'positive control: the first member uses a one-use link');
select is(current_setting('gi.s4_capped_second_err'), 'GI001', 'a second member on a used-up link is GI001');
select is(
  (select count(*)::int from public.group_members
     where group_id = current_setting('gi.grp_a2')::uuid and profile_id = current_setting('gi.owner_a')::uuid),
  0, 'and the refused member was not enrolled');

-- ── 5. Cross-org floor on the tables ────────────────────────────────────────
do $$
declare
  org_a uuid := current_setting('gi.org_a')::uuid;
  grp_a1 uuid := current_setting('gi.grp_a1')::uuid;
  owner_b uuid := current_setting('gi.owner_b')::uuid;
  mint_err text := 'none'; revoke_rows int;
begin
  set local role authenticated;
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  begin
    insert into public.group_invites (org_id, group_id, created_by) values (org_a, grp_a1, owner_b);
  exception when others then mint_err := sqlstate; end;
  with r as (update public.group_invites set revoked_at = now() where org_id = org_a returning 1)
    select count(*) into revoke_rows from r;
  reset role;
  perform set_config('gi.s5_mint_err', mint_err, true);
  perform set_config('gi.s5_revoke_rows', revoke_rows::text, true);
end $$;

select is(current_setting('gi.s5_mint_err'), '42501', 'org B''s admin cannot mint a link into an org A group (RLS 42501)');
select is(current_setting('gi.s5_revoke_rows')::int, 0, 'org B''s admin revokes zero org A links');

select * from finish();
rollback;
