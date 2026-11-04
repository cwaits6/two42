-- serving_signup_change(): who can switch a date between a couple, one of
-- them, or the other. The function is SECURITY DEFINER, so its grants and the
-- checks in its body are the whole permission, and every refusal is proved by
-- the SQLSTATE and by the attendee rows it left untouched.
--
-- Henry tapped Sign up for himself; Chloe is his spouse and Jack their child,
-- all in one household. Isaac is on the team in another household, Zoe leads
-- the group without being on the team, and org B has its own owner.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/serving_signup_change_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

do $$
declare
  org_a uuid;
  org_b uuid;
  owner_b uuid := gen_random_uuid();
  henry uuid := gen_random_uuid();
  chloe uuid := gen_random_uuid();
  jack uuid := gen_random_uuid();
  isaac uuid := gen_random_uuid();
  zoe uuid := gen_random_uuid();
  grp uuid;
  team uuid;
  family uuid;
  signup uuid;
  sunday date := current_date + (7 - extract(dow from current_date)::int);
begin
  org_a := public.provision_organization('Change Org A', 'owner-a@change.example.test');
  org_b := public.provision_organization('Change Org B', 'owner-b@change.example.test');

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Henry', 'henry@change.example.test', 'approved'),
    (org_a, 'Chloe', 'chloe@change.example.test', 'approved'),
    (org_a, 'Jack', 'jack@change.example.test', 'approved'),
    (org_a, 'Isaac', 'isaac@change.example.test', 'approved'),
    (org_a, 'Zoe', 'zoe@change.example.test', 'approved');
  insert into auth.users (id, email) values
    (owner_b, 'owner-b@change.example.test'),
    (henry, 'henry@change.example.test'),
    (chloe, 'chloe@change.example.test'),
    (jack, 'jack@change.example.test'),
    (isaac, 'isaac@change.example.test'),
    (zoe, 'zoe@change.example.test');

  insert into public.family_units (org_id, family_name) values (org_a, 'Mockingham') returning id into family;
  update public.profiles set family_id = family, relationship = 'primary' where id = henry;
  update public.profiles set family_id = family, relationship = 'spouse' where id = chloe;
  update public.profiles set family_id = family, relationship = 'child' where id = jack;

  insert into public.groups (org_id, name) values (org_a, 'group A') returning id into grp;
  insert into public.teams (org_id, group_id, name, is_serving_role)
    values (org_a, grp, 'Greeters', true) returning id into team;
  insert into public.serving_team_settings (org_id, team_id, enabled) values (org_a, team, true);
  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org_a, grp, henry, 'member'), (org_a, grp, chloe, 'member'), (org_a, grp, jack, 'member'),
    (org_a, grp, isaac, 'member'), (org_a, grp, zoe, 'leader');
  insert into public.team_members (org_id, team_id, profile_id) values
    (org_a, team, henry), (org_a, team, chloe), (org_a, team, jack), (org_a, team, isaac);

  insert into public.serving_signups (org_id, team_id, service_date, family_id, created_by)
    values (org_a, team, sunday, null, henry) returning id into signup;
  insert into public.serving_signup_attendees (org_id, signup_id, profile_id) values (org_a, signup, henry);

  perform set_config('chg.signup', signup::text, true);
  perform set_config('chg.henry', henry::text, true);
  perform set_config('chg.chloe', chloe::text, true);
  perform set_config('chg.jack', jack::text, true);
  perform set_config('chg.isaac', isaac::text, true);
  perform set_config('chg.zoe', zoe::text, true);
  perform set_config('chg.owner_b', owner_b::text, true);
  perform set_config('chg.family', family::text, true);
end $$;

-- 'added:<n> removed:<m>' on success, the SQLSTATE on failure.
create function pg_temp.change(_actor text, _attendees text[]) returns text language plpgsql as $$
declare r record; out text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting(_actor), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    select * into r from public.serving_signup_change(
      current_setting('chg.signup')::uuid,
      (select array_agg(current_setting(a)::uuid) from unnest(_attendees) as a));
    out := format('added:%s removed:%s', r.added, r.removed);
  exception when others then
    out := sqlstate;
  end;
  set local role none;
  return out;
end $$;

create function pg_temp.attendees() returns text language sql stable as $$
  select coalesce(string_agg(who, ',' order by who), '')
  from (
    select case a.profile_id
      when current_setting('chg.henry')::uuid then 'henry'
      when current_setting('chg.chloe')::uuid then 'chloe'
      when current_setting('chg.jack')::uuid then 'jack'
      when current_setting('chg.isaac')::uuid then 'isaac'
      else 'other' end as who
    from public.serving_signup_attendees a
    where a.signup_id = current_setting('chg.signup')::uuid
  ) named;
$$;

create function pg_temp.family() returns text language sql stable as $$
  select coalesce(family_id::text, '<null>') from public.serving_signups
  where id = current_setting('chg.signup')::uuid;
$$;

-- ── Shape and grants ────────────────────────────────────────────────────────
select is_definer('public', 'serving_signup_change', array['uuid', 'uuid[]'],
  'serving_signup_change is SECURITY DEFINER');
select ok(not has_function_privilege('anon', 'public.serving_signup_change(uuid,uuid[])', 'execute'),
  'anon may not execute serving_signup_change');
select ok(has_function_privilege('authenticated', 'public.serving_signup_change(uuid,uuid[])', 'execute'),
  'authenticated may execute serving_signup_change');

-- ── The couple ──────────────────────────────────────────────────────────────
select is(pg_temp.change('chg.henry', array['chg.henry', 'chg.chloe']), 'added:1 removed:0',
  'Henry, who tapped Sign up, adds Chloe: one attendee row added');
select is(pg_temp.attendees(), 'chloe,henry', 'both are on the date');
select is(pg_temp.family(), current_setting('chg.family'), 'the date carries their household');

select is(pg_temp.change('chg.chloe', array['chg.chloe']), 'added:0 removed:1',
  'Chloe, listed but not the one who tapped Sign up, makes it just her');
select is(pg_temp.attendees(), 'chloe', 'Henry is off the date');
select is(pg_temp.family(), '<null>', 'a single attendee carries no household');

select is(pg_temp.change('chg.henry', array['chg.henry']), 'added:1 removed:1',
  'Henry, off the date but the one who tapped Sign up, makes it just him');
select is(pg_temp.attendees(), 'henry', 'Chloe is off and Henry is on');

select is(pg_temp.change('chg.henry', array['chg.henry', 'chg.henry']), 'added:0 removed:0',
  'a repeated attendee is one row and no change');

-- ── Refusals, each leaving the rows as they were ────────────────────────────
select is(pg_temp.change('chg.isaac', array['chg.isaac']), 'SV005',
  'a team member who is not on the date cannot take it');
select is(pg_temp.change('chg.zoe', array['chg.zoe']), 'SV005',
  'the group leader cannot change who is serving through this path');
select is(pg_temp.change('chg.jack', array['chg.jack']), 'SV005',
  'a child in the household who is not on the date cannot take it');
select is(pg_temp.change('chg.henry', array['chg.henry', 'chg.isaac']), 'SV002',
  'Henry cannot add someone outside his household');
select is(pg_temp.change('chg.henry', array['chg.henry', 'chg.jack']), 'SV002',
  'Henry cannot add their child: only the couple gets the spouse choice');
select is(pg_temp.change('chg.henry', array[]::text[]), 'SV002',
  'a date cannot be left with nobody; Cancel is the way to open it');
select is(pg_temp.change('chg.owner_b', array['chg.owner_b']), 'SV002',
  'another church''s owner does not resolve the signup''s org and is refused');
select is(pg_temp.attendees(), 'henry', 'no refusal changed the attendees');

select * from finish();
rollback;
