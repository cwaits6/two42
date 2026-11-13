-- Deletion outcomes suite: what the delete confirmation says happens to a
-- person's funds and household is what delete_person() then does.
--
-- Both read person_deletion_outcomes(). Each case below captures its answer
-- before the delete and checks the rows after it by exact counts, since a
-- filtered write reports success on zero rows.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/deletion_outcomes_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- ── Helpers ─────────────────────────────────────────────────────────────────
create function pg_temp.new_person(_org uuid, _email text, _role text default 'member',
                                   _family uuid default null) returns uuid language plpgsql as $$
declare _id uuid := gen_random_uuid();
begin
  insert into public.access_requests (org_id, name, email, status, approved_role, reviewed_at)
    values (_org, _email, _email, 'approved', 'member', now());
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', _email,
            'x', jsonb_build_object('org_id', _org), '{}', now(), now());
  update public.profiles set role = _role, family_id = _family where id = _id;
  return _id;
end $$;

-- 'deleted' when the delete commits its work, else the SQLSTATE it raised.
create function pg_temp.delete(_person uuid, _org uuid) returns text language plpgsql as $$
begin
  perform public.delete_person(_person, _org);
  return 'deleted';
exception when others then
  return sqlstate;
end $$;

create temp table fx (key text primary key, id uuid) on commit drop;

create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;

create temp table said (key text primary key, outcomes jsonb) on commit drop;

create function pg_temp.fund(_said text, _fund text) returns jsonb language sql stable as $$
  select f from said s, jsonb_array_elements(s.outcomes -> 'funds') f
   where s.key = _said and (f ->> 'id')::uuid = pg_temp.fx(_fund);
$$;

-- How many funds the outcome named ended as it said: the recipient it named,
-- or none, and waiting for a leader to review.
create function pg_temp.funds_as_said(_said text) returns bigint language sql stable as $$
  select count(*)
    from said s, jsonb_to_recordset(s.outcomes -> 'funds') o (id uuid, recipient_id uuid)
    join public.giving_funds f on f.id = o.id
   where s.key = _said
     and f.steward_id is not distinct from o.recipient_id
     and f.needs_review;
$$;

-- ── Fixture: two churches ───────────────────────────────────────────────────
do $$
declare
  _org uuid := gen_random_uuid();
  _other uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name) values
    (_org, 'Outcomes Church'), (_other, 'Outcomes Other');
  insert into public.family_units (id, org_id, family_name) values
    (gen_random_uuid(), _org, 'Shared'), (gen_random_uuid(), _org, 'Alone'),
    (gen_random_uuid(), _org, 'Claimed');
  insert into fx values ('org', _org), ('other_org', _other),
    ('shared', (select id from public.family_units where org_id = _org and family_name = 'Shared')),
    ('alone', (select id from public.family_units where org_id = _org and family_name = 'Alone')),
    ('claimed', (select id from public.family_units where org_id = _org and family_name = 'Claimed'));
end $$;

insert into fx values
  ('admin_a', pg_temp.new_person(pg_temp.fx('org'), 'a.admin@outcomes.test', 'admin')),
  ('admin_b', pg_temp.new_person(pg_temp.fx('org'), 'b.admin@outcomes.test', 'admin')),
  ('giver', pg_temp.new_person(pg_temp.fx('org'), 'giver@outcomes.test', 'member', pg_temp.fx('shared'))),
  ('spouse', pg_temp.new_person(pg_temp.fx('org'), 'spouse@outcomes.test', 'member', pg_temp.fx('shared'))),
  ('second', pg_temp.new_person(pg_temp.fx('org'), 'second@outcomes.test')),
  ('late_pending', pg_temp.new_person(pg_temp.fx('org'), 'late-pending@outcomes.test')),
  ('alone_person', pg_temp.new_person(pg_temp.fx('org'), 'alone@outcomes.test', 'member', pg_temp.fx('alone'))),
  ('claimed_owner', pg_temp.new_person(pg_temp.fx('org'), 'claimed-owner@outcomes.test', 'member', pg_temp.fx('claimed'))),
  ('claimed_elsewhere', pg_temp.new_person(pg_temp.fx('org'), 'claimed-elsewhere@outcomes.test')),
  ('operator', pg_temp.new_person(pg_temp.fx('org'), 'operator@outcomes.test')),
  ('outsider', pg_temp.new_person(pg_temp.fx('other_org'), 'outsider@outcomes.test', 'admin'));
insert into public.platform_admins (profile_id) values (pg_temp.fx('operator'));
update public.profiles set first_name = 'Sam', last_name = 'Second' where id = pg_temp.fx('second');

-- After the people: someone who joins a church with one group is added to it.
insert into fx values ('group', gen_random_uuid());
insert into public.groups (id, org_id, name) values (pg_temp.fx('group'), pg_temp.fx('org'), 'Outcomes Group');
insert into public.group_members (org_id, group_id, profile_id)
select pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx(k)
from unnest(array['giver', 'second', 'late_pending', 'spouse']) k;

create function pg_temp.new_fund(_key text, _steward text, _second text) returns void language plpgsql as $$
declare _id uuid;
begin
  insert into public.giving_funds (org_id, group_id, name, steward_id, co_steward_id)
    values (pg_temp.fx('org'), pg_temp.fx('group'), _key, pg_temp.fx(_steward), pg_temp.fx(_second))
    returning id into _id;
  insert into public.giving_fund_methods (fund_id, org_id, group_id, method, custom_handle)
    values (_id, pg_temp.fx('org'), pg_temp.fx('group'), 'venmo', '@' || _key);
  insert into fx values (_key, _id);
end $$;

select pg_temp.new_fund('passes_on', 'giver', 'second');
select pg_temp.new_fund('no_second', 'giver', null);
select pg_temp.new_fund('pending_second', 'giver', 'late_pending');
select pg_temp.new_fund('theirs', 'second', 'giver');
update public.profiles set role = 'pending' where id = pg_temp.fx('late_pending');

insert into public.family_members (org_id, family_id, first_name, last_name, relationship, claimed_profile_id)
values
  (pg_temp.fx('org'), pg_temp.fx('shared'), 'Giver', 'Shared', 'primary', pg_temp.fx('giver')),
  (pg_temp.fx('org'), pg_temp.fx('shared'), 'Spouse', 'Shared', 'spouse', pg_temp.fx('spouse')),
  (pg_temp.fx('org'), pg_temp.fx('shared'), 'Kid', 'Shared', 'child', null),
  (pg_temp.fx('org'), pg_temp.fx('alone'), 'Alone', 'Person', 'primary', pg_temp.fx('alone_person')),
  (pg_temp.fx('org'), pg_temp.fx('alone'), 'Kit', 'Person', 'child', null),
  (pg_temp.fx('org'), pg_temp.fx('claimed'), 'Owner', 'Claimed', 'primary', pg_temp.fx('claimed_owner')),
  (pg_temp.fx('org'), pg_temp.fx('claimed'), 'Elsewhere', 'Claimed', 'sibling', pg_temp.fx('claimed_elsewhere'));

-- ── Who can call it ─────────────────────────────────────────────────────────
select ok((select prosecdef from pg_proc where oid = 'public.person_deletion_outcomes(uuid, uuid)'::regprocedure),
  'person_deletion_outcomes is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'public.person_deletion_outcomes(uuid, uuid)'::regprocedure),
  array['search_path=""'], 'person_deletion_outcomes pins an empty search_path');
select is((select provolatile from pg_proc where oid = 'public.person_deletion_outcomes(uuid, uuid)'::regprocedure),
  's', 'person_deletion_outcomes is read-only');
select ok(not has_function_privilege('anon', 'public.person_deletion_outcomes(uuid, uuid)', 'execute'),
  'anon can''t call it');
select ok(not has_function_privilege('authenticated', 'public.person_deletion_outcomes(uuid, uuid)', 'execute'),
  'a signed-in member can''t call it');
select ok(has_function_privilege('service_role', 'public.person_deletion_outcomes(uuid, uuid)', 'execute'),
  'the service role can, for the confirmation');
select is(public.person_deletion_outcomes(pg_temp.fx('giver'), pg_temp.fx('other_org')), null,
  'another church''s id gets nothing about this church''s person');
select is(public.person_deletion_outcomes(gen_random_uuid(), pg_temp.fx('org')), null,
  'an unknown person gets nothing');

-- ── A person with three funds and a shared household ────────────────────────
insert into said values
  ('giver', public.person_deletion_outcomes(pg_temp.fx('giver'), pg_temp.fx('org')));

select is(jsonb_array_length((select outcomes -> 'funds' from said where key = 'giver')), 3,
  'the outcome names the three funds they receive gifts for, and not the one they are second on');
select is(pg_temp.fund('giver', 'passes_on') ->> 'outcome', 'passed_on',
  'a fund with a second person in its group passes to them');
select is((pg_temp.fund('giver', 'passes_on') ->> 'recipient_id')::uuid, pg_temp.fx('second'),
  'and names that second person');
select is(pg_temp.fund('giver', 'passes_on') #>> '{recipient,first_name}', 'Sam',
  'with their name for the person deleting themself');
select is(pg_temp.fund('giver', 'passes_on') ->> 'group_name', 'Outcomes Group',
  'and the fund''s group');
select is(pg_temp.fund('giver', 'no_second') ->> 'outcome', 'needs_recipient',
  'a fund with no second person needs a recipient');
select is(pg_temp.fund('giver', 'pending_second') ->> 'outcome', 'needs_recipient',
  'a fund whose second person is waiting for approval needs a recipient');
select is((select outcomes #>> '{household,goes}' from said where key = 'giver'), 'false',
  'a household someone else is in stays');
select is((select outcomes #>> '{household,name}' from said where key = 'giver'), 'Shared',
  'and is named');

select is(pg_temp.delete(pg_temp.fx('giver'), pg_temp.fx('org')), 'deleted', 'the delete runs');
select is(pg_temp.funds_as_said('giver'), 3::bigint, 'every fund ended as the outcome said');
select is((select count(*) from public.giving_funds
            where id = pg_temp.fx('passes_on') and steward_id = pg_temp.fx('second') and needs_review),
  1::bigint, 'the fund with a second person passed to them and waits for review');
select is((select count(*) from public.giving_funds
            where id in (pg_temp.fx('no_second'), pg_temp.fx('pending_second'))
              and steward_id is null and needs_review),
  2::bigint, 'the funds without one have no recipient and wait for review');
select is((select count(*) from public.giving_fund_methods
            where fund_id in (pg_temp.fx('passes_on'), pg_temp.fx('no_second'), pg_temp.fx('pending_second'))),
  3::bigint, 'no fund lost its payment methods');
select is((select count(*) from public.giving_funds where id = pg_temp.fx('theirs') and steward_id = pg_temp.fx('second')),
  1::bigint, 'the fund they were second on keeps its recipient');
select is((select count(*) from public.family_units where id = pg_temp.fx('shared')),
  1::bigint, 'the shared household stays, as the outcome said');
select is(
  (select array_agg(m.id order by m.id) from public.family_members m where m.family_id = pg_temp.fx('shared')),
  (select array_agg((e ->> 'id')::uuid order by (e ->> 'id')::uuid)
     from said s, jsonb_array_elements(s.outcomes #> '{household,entries}') e where s.key = 'giver'),
  'the people left listed in it are the ones the outcome named');
select is((select count(*) from public.family_members m where m.family_id = pg_temp.fx('shared')),
  2::bigint, 'only their own entry left it');

-- ── A household with nobody left ────────────────────────────────────────────
insert into said values
  ('alone', public.person_deletion_outcomes(pg_temp.fx('alone_person'), pg_temp.fx('org')));

select is((select outcomes #>> '{household,goes}' from said where key = 'alone'), 'true',
  'a household nobody else is in goes');
select is((select jsonb_agg(e ->> 'first_name') from said s, jsonb_array_elements(s.outcomes #> '{household,entries}') e
            where s.key = 'alone'),
  '["Kit"]'::jsonb, 'and names who goes with it');
select is((select outcomes -> 'funds' from said where key = 'alone'), '[]'::jsonb,
  'someone with no funds has no fund outcomes');

select is(pg_temp.delete(pg_temp.fx('alone_person'), pg_temp.fx('org')), 'deleted', 'the delete runs');
select is((select count(*) from public.family_units where id = pg_temp.fx('alone')),
  0::bigint, 'the household went, as the outcome said');
select is((select count(*) from public.family_members where family_id = pg_temp.fx('alone')),
  0::bigint, 'and the people listed in it went with it');

-- ── A household whose only other tie is an entry claimed from another household
insert into said values
  ('claimed', public.person_deletion_outcomes(pg_temp.fx('claimed_owner'), pg_temp.fx('org')));

select is((select outcomes #>> '{household,goes}' from said where key = 'claimed'), 'false',
  'a household listing someone with their own account stays, though no one else''s profile is in it');
select is(pg_temp.delete(pg_temp.fx('claimed_owner'), pg_temp.fx('org')), 'deleted', 'the delete runs');
select is((select count(*) from public.family_units where id = pg_temp.fx('claimed')),
  1::bigint, 'the household stays, as the outcome said');
select is((select count(*) from public.family_members
            where family_id = pg_temp.fx('claimed') and claimed_profile_id = pg_temp.fx('claimed_elsewhere')),
  1::bigint, 'and still lists the person with their own account');

-- ── Refusals are unchanged ──────────────────────────────────────────────────
select is(pg_temp.delete(pg_temp.fx('second'), pg_temp.fx('other_org')), 'AD001',
  'a person in another church is refused');
select is(pg_temp.delete(pg_temp.fx('operator'), pg_temp.fx('org')), 'AD002',
  'a platform operator is refused');
select is(pg_temp.delete(pg_temp.fx('outsider'), pg_temp.fx('other_org')), 'CA001',
  'the last church admin is refused');
select is((select count(*) from public.profiles where id in (pg_temp.fx('second'), pg_temp.fx('operator'), pg_temp.fx('outsider'))),
  3::bigint, 'and none of them was deleted');
select isnt(public.person_deletion_outcomes(pg_temp.fx('operator'), pg_temp.fx('org')), null,
  'the refusal is the delete''s: the outcome still answers for a platform operator');
select isnt(public.person_deletion_outcomes(pg_temp.fx('outsider'), pg_temp.fx('other_org')), null,
  'and for the last church admin');

-- ── An outcome the delete can't keep stops it ───────────────────────────────
-- Last, because it replaces the function for the rest of the transaction.
select pg_temp.new_fund('drifted', 'second', null);
create or replace function public.person_deletion_outcomes(_person_id uuid, _org_id uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'funds', jsonb_build_array(jsonb_build_object('id', id, 'recipient_id', gen_random_uuid())),
    'household', null)
  from pg_temp.fx where key = 'drifted';
$$;

select is(pg_temp.delete(pg_temp.fx('second'), pg_temp.fx('org')), 'AD003',
  'a fund that didn''t end as its outcome said stops the delete');
select is((select count(*) from public.profiles where id = pg_temp.fx('second')), 1::bigint,
  'the person is still there');
select is((select count(*) from auth.users where id = pg_temp.fx('second')), 1::bigint,
  'and so is their login');
select is((select count(*) from public.giving_funds where id = pg_temp.fx('drifted') and steward_id = pg_temp.fx('second')),
  1::bigint, 'and the fund still has them as its recipient');

select * from finish();
rollback;
