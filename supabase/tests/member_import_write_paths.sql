-- Member import write-path RLS guard (CWA-40).
--
-- The import planner emits writes that the app then executes through the
-- COOKIE-BOUND client, so every one of them runs under RLS as an org admin.
-- Nothing in TypeScript can see whether a policy actually permits them:
-- vitest exercises the planner against a plain-data snapshot, and
-- schema_tenancy_lint.sql never reads application code. That gap is how the
-- first cut of this feature shipped a write kind — the approved
-- `access_requests` invite row — that fails RLS 100% of the time, and fails
-- FOURTH in the write order, so an import containing one new person would
-- have written households, family members and profile updates and then 500'd.
--
-- This suite is the layer that can see it. It runs each planned write kind as
-- a real org admin and asserts the outcome the app depends on, plus the
-- negative that justifies dropping the invite path from v1.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/member_import_write_paths.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table member_import_results (line text) on commit drop;

do $$
declare
  _org uuid;
  _admin uuid := gen_random_uuid();
  _other uuid := gen_random_uuid();
  _family uuid;
  _group uuid;
  _member uuid;
begin
  _org := public.provision_organization(
    'Member Import Suite', 'member-import-suite', 'admin@member-import.example.test'
  );
  -- The owner signs up AFTER provisioning, so handle_new_user() resolves them
  -- into the org through the approved access_requests row provisioning made,
  -- landing role = 'admin'.
  insert into auth.users (id, email) values (_admin, 'admin@member-import.example.test');

  -- A SECOND member, in the same org, who is not the admin and shares no
  -- household with them. The profile-touching assertions below target this
  -- one, not the admin.
  --
  -- Targeting the admin's own profile would prove nothing about the import:
  -- "Profiles are updatable per access rules" is satisfied by
  -- `(select auth.uid()) = id` for a self-update, so the assertion passes on
  -- the self arm and never exercises the `or (select public.is_admin())` arm
  -- that every real import row depends on. Same for the group assignment.
  insert into public.access_requests (org_id, name, email, status)
    values (_org, 'other member', 'other@member-import.example.test', 'approved');
  insert into auth.users (id, email) values (_other, 'other@member-import.example.test');

  insert into public.family_units (org_id, family_name)
    values (_org, 'Import Suite Household') returning id into _family;
  insert into public.family_members (org_id, family_id, first_name, last_name, relationship)
    values (_org, _family, 'Kid', 'Suite', 'child') returning id into _member;
  insert into public.member_groups (org_id, name)
    values (_org, 'Import Suite Group') returning id into _group;

  perform set_config('member_import.org', _org::text, true);
  perform set_config('member_import.admin', _admin::text, true);
  perform set_config('member_import.other', _other::text, true);
  perform set_config('member_import.family', _family::text, true);
  perform set_config('member_import.group', _group::text, true);
  perform set_config('member_import.member', _member::text, true);
end $$;

-- Sanity: the fixture admin really is an admin, or every assertion below is
-- testing the wrong principal.
insert into member_import_results
  select is(
    (select role from public.profiles where id = current_setting('member_import.admin')::uuid),
    'admin',
    'fixture: the seeded owner resolved into the org as an admin'
  );

-- ── The five write kinds the planner can emit ───────────────────────────────
-- Each runs as the org admin over PostgREST's `authenticated` role, exactly
-- as applyWrites does. Payloads carry no org_id: the column DEFAULT
-- public.app_current_org_id() is the fail-closed resolver, and these
-- assertions are also what pins that the DEFAULT works for an admin.
-- Outcomes are collected into arrays while impersonating and recorded AFTER
-- `reset role` — the `authenticated` role has no rights on the temp table.
do $$
declare
  _admin uuid := current_setting('member_import.admin')::uuid;
  _group uuid := current_setting('member_import.group')::uuid;
  _member uuid := current_setting('member_import.member')::uuid;
  -- Deliberately NOT the admin: see the fixture note above.
  _profile uuid := current_setting('member_import.other')::uuid;
  _new_family uuid;
  _kinds text[] := array[
    'insert_family_unit: an org admin can create a household',
    'insert_family_member: an org admin can add a family member',
    'update_family_member: an org admin can update a family member',
    'update_profile: an org admin can update a profile',
    'insert_profile_group: an org admin can assign a group',
    'update_profile_group: an org admin can promote to leader',
    'delete_profile_group: an org admin can remove an assignment'
  ];
  _errs text[] := '{}';
  _err text;
  _rows int;
  i int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);

  begin
    insert into public.family_units (family_name)
      values ('Planned Household') returning id into _new_family;
    _err := null;
  exception when others then _err := sqlerrm;
  end;
  _errs := _errs || _err;

  begin
    insert into public.family_members (family_id, first_name, last_name, relationship)
      values (_new_family, 'Planned', 'Person', 'child');
    _err := null;
  exception when others then _err := sqlerrm;
  end;
  _errs := _errs || _err;

  -- From here down every statement is an UPDATE or DELETE, and for those an
  -- exception is the WRONG thing to assert on by itself. RLS does not raise
  -- when it denies a row — it filters it, so a blocked UPDATE affects zero
  -- rows and reports success. Asserting only `_err is null` would therefore
  -- pass even if no policy permitted the write at all, which is the same
  -- false-success this feature's own applyWrites() had to be fixed for.
  -- Each one records "no error AND it actually touched a row".
  begin
    update public.family_members set relationship = 'sibling' where id = _member;
    get diagnostics _rows = row_count;
    _err := case when _rows = 0 then 'matched no row (policy filtered it)' end;
  exception when others then _err := sqlerrm;
  end;
  _errs := _errs || _err;

  begin
    update public.profiles set city = 'Springfield' where id = _profile;
    get diagnostics _rows = row_count;
    _err := case when _rows = 0 then 'matched no row (policy filtered it)' end;
  exception when others then _err := sqlerrm;
  end;
  _errs := _errs || _err;

  begin
    insert into public.profile_groups (profile_id, group_id, is_leader, assigned_by)
      values (_profile, _group, false, _admin);
    _err := null;
  exception when others then _err := sqlerrm;
  end;
  _errs := _errs || _err;

  begin
    update public.profile_groups set is_leader = true
      where profile_id = _profile and group_id = _group;
    get diagnostics _rows = row_count;
    _err := case when _rows = 0 then 'matched no row (policy filtered it)' end;
  exception when others then _err := sqlerrm;
  end;
  _errs := _errs || _err;

  begin
    delete from public.profile_groups
      where profile_id = _profile and group_id = _group;
    get diagnostics _rows = row_count;
    _err := case when _rows = 0 then 'matched no row (policy filtered it)' end;
  exception when others then _err := sqlerrm;
  end;
  _errs := _errs || _err;

  perform set_config('request.jwt.claims', '', true);
  reset role;

  for i in 1 .. array_length(_kinds, 1) loop
    insert into member_import_results select is(_errs[i], null, _kinds[i]);
  end loop;
end $$;

-- ── Why v1 drops create_invite ──────────────────────────────────────────────
-- access_requests has exactly one INSERT policy — "Anyone can submit access
-- request" — whose WITH CHECK requires status = 'pending' and NULL for
-- reviewed_by / reviewed_at / signup_token / token_expires_at /
-- approved_role. There is no admin INSERT policy, so the approved invite row
-- an import would write cannot be inserted by anyone over PostgREST.
--
-- Pinned as a NEGATIVE deliberately: when a follow-up adds the admin policy,
-- this assertion fails, and that failure is the signal to re-enable the
-- planner's create_invite path (and to fix invite-bulk, which issues the same
-- insert and is broken today for the same reason).
do $$
declare
  _admin uuid := current_setting('member_import.admin')::uuid;
  _err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);

  begin
    insert into public.access_requests
      (email, name, status, reviewed_by, reviewed_at, signup_token, token_expires_at)
    values
      ('invitee@member-import.example.test', 'Iva', 'approved', _admin, now(),
       encode(gen_random_bytes(32), 'hex'), now() + interval '14 days');
    _err := null;
  exception when others then _err := sqlerrm;
  end;

  perform set_config('request.jwt.claims', '', true);
  reset role;

  insert into member_import_results
    select ok(
      _err is not null,
      'access_requests: an org admin CANNOT insert the approved invite row — this is why import plans LOGIN_CREATE_UNSUPPORTED instead of writing it'
    );

  -- The rollback path invite-bulk uses is equally unavailable: there is no
  -- DELETE policy on access_requests at all. Fold this into the same
  -- follow-up migration.
  insert into member_import_results
    select is(
      (select count(*)::int from pg_policies
       where schemaname = 'public' and tablename = 'access_requests' and cmd = 'DELETE'),
      0,
      'access_requests has no DELETE policy — invite-bulk''s rollback cannot work either'
    );
end $$;

select line from member_import_results;
select * from finish();
rollback;
