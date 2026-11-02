-- Directory with no hide settings: what's stored is what's shown.
--
-- Proves the sweep clears each flag's own values and nothing else, against a
-- fixture per flag with every other field filled, by exact row counts. Then the
-- anniversary move, the claimed birthday rule, the old app on the new schema,
-- the household phone pointer and who may clear what.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/directory_no_hide_settings_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- The sweep clears every org on the stack, so whatever a stack already holds is
-- cleared of flags first and the counts below only see these fixtures.
do $$ begin
  perform public.directory_retire_hidden_values();
end $$;

-- ── Probe helpers: run one statement as an authenticated actor ──────────────
create function pg_temp.as_text(_actor uuid, _query text) returns text
  language plpgsql as $$
declare _result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  set local role authenticated;
  execute _query into _result;
  reset role;
  return _result;
end $$;

-- 'rows=N' for a write that ran, else the SQLSTATE it raised.
create function pg_temp.as_write(_actor uuid, _query text) returns text
  language plpgsql as $$
declare _n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  set local role authenticated;
  begin
    execute _query;
    get diagnostics _n = row_count;
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'rows=' || _n;
end $$;

-- A profile's retired-flag fields as one comparable value, in a fixed order.
create function pg_temp.profile_fields(_id uuid) returns text
  language sql as $$
  select concat_ws('|',
    coalesce(p.phone, '-'), coalesce(p.phone_mobile, '-'), coalesce(p.phone_home, '-'),
    coalesce(p.phone_work, '-'), coalesce(p.address_line1, '-'), coalesce(p.address_line2, '-'),
    coalesce(p.city, '-'), coalesce(p.state, '-'), coalesce(p.postal_code, '-'),
    coalesce(p.birth_month::text, '-'), coalesce(p.birth_day::text, '-'), coalesce(p.birth_year::text, '-'),
    coalesce(p.anniversary::text, '-'), coalesce(p.occupation, '-'), coalesce(p.employer, '-'),
    coalesce(p.email, '-'), coalesce(p.first_name, '-'))
  from public.profiles p where p.id = _id;
$$;

create function pg_temp.family_fields(_id uuid) returns text
  language sql as $$
  select concat_ws('|',
    coalesce(f.address_line1, '-'), coalesce(f.address_line2, '-'), coalesce(f.city, '-'),
    coalesce(f.state, '-'), coalesce(f.postal_code, '-'), coalesce(f.phone_home, '-'),
    coalesce(f.anniversary::text, '-'), coalesce(f.anniversary_month::text, '-'),
    coalesce(f.anniversary_day::text, '-'), coalesce(f.anniversary_year::text, '-'))
  from public.family_units f where f.id = _id;
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- One org. Every person's retired-flag fields are filled the same way, so a
-- sweep that reached past its own flag changes a value the assertions compare.
do $$
declare
  org_a uuid;
  org_b uuid;
  emails text[] := array['owner', 'mobile', 'home', 'work', 'addr', 'bday', 'byear', 'anniv', 'occ', 'email', 'control', 'viewer', 'outsider'];
  e text;
  uid uuid;
  grp uuid;
begin
  org_a := public.provision_organization('No Hide Org A', 'owner@no-hide.example.test');
  org_b := public.provision_organization('No Hide Org B', 'owner-b@no-hide.example.test');

  foreach e in array emails loop
    if e <> 'owner' then
      insert into public.access_requests (org_id, name, email, status)
      values (org_a, e, e || '@no-hide.example.test', 'approved');
    end if;
    uid := gen_random_uuid();
    insert into auth.users (id, email) values (uid, e || '@no-hide.example.test');
    perform set_config('nh.' || e, uid::text, true);
    update public.profiles p set
      first_name = e, last_name = 'Fixture', relationship = 'other', family_id = null,
      phone = '+15550000000', phone_mobile = '+15550000001', phone_home = '+15550000002',
      phone_work = '+15550000003', address_line1 = '1 Main', address_line2 = 'Apt 2',
      city = 'Springfield', state = 'IL', postal_code = '62703',
      birth_month = 4, birth_day = 5, birth_year = 1980, anniversary = '2001-02-03',
      occupation = 'Teacher', employer = 'School',
      hide_phone_mobile = false, hide_phone_home = false, hide_phone_work = false,
      hide_address = false, hide_birthday = false, hide_birth_year = false,
      hide_anniversary = false, hide_occupation = false, hide_email = false,
      is_unlisted = false, role = case when e = 'owner' then p.role else 'member' end,
      setup_completed = true
    where p.id = current_setting('nh.' || e)::uuid;
  end loop;

  insert into public.groups (org_id, name) values (org_a, 'Everyone') returning groups.id into grp;
  perform set_config('nh.grp', grp::text, true);
  perform set_config('nh.org_a', org_a::text, true);
  perform set_config('nh.org_b', org_b::text, true);

  -- Each flag set on exactly one fixture.
  update public.profiles set hide_phone_mobile = true where email = 'mobile@no-hide.example.test';
  update public.profiles set hide_phone_home = true where email = 'home@no-hide.example.test';
  update public.profiles set hide_phone_work = true where email = 'work@no-hide.example.test';
  update public.profiles set hide_address = true where email = 'addr@no-hide.example.test';
  update public.profiles set hide_birthday = true where email = 'bday@no-hide.example.test';
  update public.profiles set hide_birth_year = true where email = 'byear@no-hide.example.test';
  update public.profiles set hide_anniversary = true where email = 'anniv@no-hide.example.test';
  update public.profiles set hide_occupation = true where email = 'occ@no-hide.example.test';
  update public.profiles set hide_email = true where email = 'email@no-hide.example.test';
end $$;

-- Households in the state a pre-migration row is in: a full date and no parts.
alter table public.family_units disable trigger family_units_sync_anniversary;

do $$
declare
  org_a uuid := current_setting('nh.org_a')::uuid;
  fam_hide_addr uuid; fam_hide_phone uuid; fam_control uuid;
  fam_either uuid; fam_child_flag uuid; fam_moved uuid; fam_own_wins uuid; fam_typo uuid;
  fm_claimed_bday uuid; fm_claimed_year uuid; fm_unclaimed uuid;
  e text;
begin
  insert into public.family_units (org_id, family_name, address_line1, address_line2, city, state, postal_code, phone_home, anniversary, hide_address)
    values (org_a, 'Hide Address', '1 Main', 'Apt 2', 'Springfield', 'IL', '62703', '+15550000002', '2001-02-03', true) returning id into fam_hide_addr;
  insert into public.family_units (org_id, family_name, address_line1, address_line2, city, state, postal_code, phone_home, anniversary, hide_phone_home)
    values (org_a, 'Hide Phone', '1 Main', 'Apt 2', 'Springfield', 'IL', '62703', '+15550000002', '2001-02-03', true) returning id into fam_hide_phone;
  insert into public.family_units (org_id, family_name, address_line1, address_line2, city, state, postal_code, phone_home, anniversary)
    values (org_a, 'Control', '1 Main', 'Apt 2', 'Springfield', 'IL', '62703', '+15550000002', '2001-02-03') returning id into fam_control;
  insert into public.family_units (org_id, family_name, anniversary) values (org_a, 'Either Spouse', '2002-03-04') returning id into fam_either;
  insert into public.family_units (org_id, family_name, anniversary) values (org_a, 'Child Flag', '2003-04-05') returning id into fam_child_flag;
  insert into public.family_units (org_id, family_name) values (org_a, 'Moved Copy') returning id into fam_moved;
  insert into public.family_units (org_id, family_name, anniversary) values (org_a, 'Own Value', '2005-06-07') returning id into fam_own_wins;
  insert into public.family_units (org_id, family_name, anniversary) values (org_a, 'Typo Year', '1850-07-08') returning id into fam_typo;

  perform set_config('nh.fam_hide_addr', fam_hide_addr::text, true);
  perform set_config('nh.fam_hide_phone', fam_hide_phone::text, true);
  perform set_config('nh.fam_control', fam_control::text, true);
  perform set_config('nh.fam_either', fam_either::text, true);
  perform set_config('nh.fam_child_flag', fam_child_flag::text, true);
  perform set_config('nh.fam_moved', fam_moved::text, true);
  perform set_config('nh.fam_own_wins', fam_own_wins::text, true);
  perform set_config('nh.fam_typo', fam_typo::text, true);

  foreach e in array array['either_a', 'either_b', 'child_p', 'child_c', 'moved_p', 'moved_s', 'own_p', 'unhoused', 'claim_bday', 'claim_year'] loop
    insert into public.access_requests (org_id, name, email, status)
    values (org_a, e, e || '@no-hide.example.test', 'approved');
    insert into auth.users (id, email) values (gen_random_uuid(), e || '@no-hide.example.test');
    update public.profiles set first_name = e, last_name = 'Fixture', role = 'member', setup_completed = true,
           family_id = null, relationship = 'other', anniversary = null
     where email = e || '@no-hide.example.test';
    perform set_config('nh.' || e, (select id::text from public.profiles where email = e || '@no-hide.example.test'), true);
  end loop;

  -- Either spouse hiding clears the household and both copies.
  update public.profiles set family_id = fam_either, relationship = 'primary', anniversary = '2002-03-04' where email = 'either_a@no-hide.example.test';
  update public.profiles set family_id = fam_either, relationship = 'spouse', anniversary = '2002-03-04', hide_anniversary = true where email = 'either_b@no-hide.example.test';
  -- A child's flag is about the child's own copy.
  update public.profiles set family_id = fam_child_flag, relationship = 'primary' where email = 'child_p@no-hide.example.test';
  update public.profiles set family_id = fam_child_flag, relationship = 'child', anniversary = '1999-01-01', hide_anniversary = true where email = 'child_c@no-hide.example.test';
  -- A primary's copy moves ahead of a spouse's, with its year.
  update public.profiles set family_id = fam_moved, relationship = 'primary', anniversary = '2004-05-06' where email = 'moved_p@no-hide.example.test';
  update public.profiles set family_id = fam_moved, relationship = 'spouse', anniversary = '2010-10-10' where email = 'moved_s@no-hide.example.test';
  -- The household's own value beats a profile copy.
  update public.profiles set family_id = fam_own_wins, relationship = 'primary', anniversary = '2011-11-11' where email = 'own_p@no-hide.example.test';
  -- No household to move to: the copy stays, unread.
  update public.profiles set anniversary = '2012-12-12' where email = 'unhoused@no-hide.example.test';

  -- Claimed rows carry the claimer's birthday through family_members_list.
  update public.profiles set family_id = fam_control, relationship = 'primary', birth_month = 1, birth_day = 2, birth_year = 1970, hide_birthday = true where email = 'claim_bday@no-hide.example.test';
  update public.profiles set family_id = fam_control, relationship = 'spouse', birth_month = 3, birth_day = 4, birth_year = 1971, hide_birth_year = true where email = 'claim_year@no-hide.example.test';
  insert into public.family_members (org_id, family_id, first_name, relationship, birth_month, birth_day, birth_year, claimed_profile_id)
    values (org_a, fam_control, 'Claimed Birthday', 'primary', 1, 2, 1970, current_setting('nh.claim_bday')::uuid) returning id into fm_claimed_bday;
  insert into public.family_members (org_id, family_id, first_name, relationship, birth_month, birth_day, birth_year, claimed_profile_id)
    values (org_a, fam_control, 'Claimed Year', 'spouse', 3, 4, 1971, current_setting('nh.claim_year')::uuid) returning id into fm_claimed_year;
  insert into public.family_members (org_id, family_id, first_name, relationship, birth_month, birth_day, birth_year)
    values (org_a, fam_control, 'Unclaimed', 'child', 5, 6, 2010) returning id into fm_unclaimed;
  perform set_config('nh.fm_claimed_bday', fm_claimed_bday::text, true);
  perform set_config('nh.fm_claimed_year', fm_claimed_year::text, true);
  perform set_config('nh.fm_unclaimed', fm_unclaimed::text, true);

  perform set_config('nh.before_profile_control', pg_temp.profile_fields(current_setting('nh.control')::uuid), true);
  perform set_config('nh.before_email', pg_temp.profile_fields(current_setting('nh.email')::uuid), true);
end $$;

-- ── The sweep ───────────────────────────────────────────────────────────────
do $$ begin
  perform set_config('nh.counts', public.directory_retire_hidden_values()::text, true);
end $$;

alter table public.family_units enable trigger family_units_sync_anniversary;

create function pg_temp.swept(_key text) returns bigint
  language sql as $$ select (current_setting('nh.counts')::jsonb ->> _key)::bigint $$;

-- Row counts: each flag cleared exactly the fixtures that set it.
select is(pg_temp.swept('hide_phone_mobile'), 1::bigint, 'hide_phone_mobile clears one profile');
select is(pg_temp.swept('hide_phone_home'), 1::bigint, 'hide_phone_home clears one profile');
select is(pg_temp.swept('hide_phone_work'), 1::bigint, 'hide_phone_work clears one profile');
select is(pg_temp.swept('hide_address'), 1::bigint, 'hide_address clears one profile');
select is(pg_temp.swept('hide_birth_year'), 2::bigint, 'hide_birth_year clears two profiles, one of them claimed');
select is(pg_temp.swept('hide_birthday'), 2::bigint, 'hide_birthday clears two profiles, one of them claimed');
select is(pg_temp.swept('hide_anniversary'), 3::bigint, 'hide_anniversary clears the fixture, a spouse and a child');
select is(pg_temp.swept('hide_occupation'), 1::bigint, 'hide_occupation clears one profile');
select is(pg_temp.swept('household_hide_address'), 1::bigint, 'hide_address clears one household');
select is(pg_temp.swept('household_hide_phone_home'), 1::bigint, 'hide_phone_home clears one household');
select is(pg_temp.swept('household_anniversary'), 1::bigint, 'one household has a spouse who hid the anniversary');
select is(pg_temp.swept('claimed_birthday'), 2::bigint, 'two claimed rows carried a hidden birthday or year');
select is(pg_temp.swept('anniversary_moved'), 1::bigint, 'one household takes a profile copy');

-- Each fixture lost its own fields and kept every other one. Field order:
-- phone|mobile|home|work|line1|line2|city|state|zip|month|day|year|anniversary|occupation|employer|email|name
select is(pg_temp.profile_fields(current_setting('nh.mobile')::uuid),
  '-|-|+15550000002|+15550000003|1 Main|Apt 2|Springfield|IL|62703|4|5|1980|2001-02-03|Teacher|School|mobile@no-hide.example.test|mobile',
  'hide_phone_mobile clears the mobile and its older copy, nothing else');
select is(pg_temp.profile_fields(current_setting('nh.home')::uuid),
  '+15550000000|+15550000001|-|+15550000003|1 Main|Apt 2|Springfield|IL|62703|4|5|1980|2001-02-03|Teacher|School|home@no-hide.example.test|home',
  'hide_phone_home clears the home phone, nothing else');
select is(pg_temp.profile_fields(current_setting('nh.work')::uuid),
  '+15550000000|+15550000001|+15550000002|-|1 Main|Apt 2|Springfield|IL|62703|4|5|1980|2001-02-03|Teacher|School|work@no-hide.example.test|work',
  'hide_phone_work clears the work phone, nothing else');
select is(pg_temp.profile_fields(current_setting('nh.addr')::uuid),
  '+15550000000|+15550000001|+15550000002|+15550000003|-|-|-|-|-|4|5|1980|2001-02-03|Teacher|School|addr@no-hide.example.test|addr',
  'hide_address clears the five address fields, nothing else');
select is(pg_temp.profile_fields(current_setting('nh.bday')::uuid),
  '+15550000000|+15550000001|+15550000002|+15550000003|1 Main|Apt 2|Springfield|IL|62703|-|-|-|2001-02-03|Teacher|School|bday@no-hide.example.test|bday',
  'hide_birthday clears month, day and year, nothing else');
select is(pg_temp.profile_fields(current_setting('nh.byear')::uuid),
  '+15550000000|+15550000001|+15550000002|+15550000003|1 Main|Apt 2|Springfield|IL|62703|4|5|-|2001-02-03|Teacher|School|byear@no-hide.example.test|byear',
  'hide_birth_year clears the year only');
select is(pg_temp.profile_fields(current_setting('nh.anniv')::uuid),
  '+15550000000|+15550000001|+15550000002|+15550000003|1 Main|Apt 2|Springfield|IL|62703|4|5|1980|-|Teacher|School|anniv@no-hide.example.test|anniv',
  'hide_anniversary clears the profile''s anniversary, nothing else');
select is(pg_temp.profile_fields(current_setting('nh.occ')::uuid),
  '+15550000000|+15550000001|+15550000002|+15550000003|1 Main|Apt 2|Springfield|IL|62703|4|5|1980|2001-02-03|-|-|occ@no-hide.example.test|occ',
  'hide_occupation clears occupation and employer, nothing else');

-- Every retired flag is back to false, so a value entered later shows.
select is(
  (select count(*) from public.profiles where hide_phone_mobile or hide_phone_home or hide_phone_work
     or hide_address or hide_birthday or hide_birth_year or hide_anniversary or hide_occupation),
  0::bigint, 'no profile keeps a retired flag');
select is(
  (select count(*) from public.family_units where hide_address or hide_phone_home),
  0::bigint, 'no household keeps a retired flag');

-- Field order: line1|line2|city|state|zip|phone|anniversary|month|day|year
select is(pg_temp.family_fields(current_setting('nh.fam_hide_addr')::uuid),
  '-|-|-|-|-|+15550000002|2001-02-03|2|3|2001',
  'a household''s hide_address clears the address, nothing else');
select is(pg_temp.family_fields(current_setting('nh.fam_hide_phone')::uuid),
  '1 Main|Apt 2|Springfield|IL|62703|-|2001-02-03|2|3|2001',
  'a household''s hide_phone_home clears the phone, nothing else');

-- Nothing unflagged moved.
select is(pg_temp.profile_fields(current_setting('nh.control')::uuid),
  current_setting('nh.before_profile_control'), 'a profile with no flag is unchanged');
select is(pg_temp.family_fields(current_setting('nh.fam_control')::uuid),
  '1 Main|Apt 2|Springfield|IL|62703|+15550000002|2001-02-03|2|3|2001',
  'a household with no flag gains parts and loses nothing');

-- The email setting is not retired.
select is(pg_temp.profile_fields(current_setting('nh.email')::uuid),
  current_setting('nh.before_email'), 'hide_email keeps the email and every other field');
select ok(
  (select hide_email from public.profiles where id = current_setting('nh.email')::uuid),
  'hide_email stays on');

-- ── Anniversary move ────────────────────────────────────────────────────────
select is(pg_temp.family_fields(current_setting('nh.fam_either')::uuid),
  '-|-|-|-|-|-|-|-|-|-', 'a household where a spouse hid the anniversary has none left');
select is(
  (select count(*) from public.profiles where family_id = current_setting('nh.fam_either')::uuid and anniversary is not null),
  0::bigint, 'neither spouse keeps a copy after one of them hid it');
select is(pg_temp.family_fields(current_setting('nh.fam_child_flag')::uuid),
  '-|-|-|-|-|-|2003-04-05|4|5|2003', 'a child''s flag leaves the household''s anniversary alone');
select is(pg_temp.family_fields(current_setting('nh.fam_moved')::uuid),
  '-|-|-|-|-|-|2004-05-06|5|6|2004', 'a primary''s copy moves, year kept, ahead of a spouse''s');
select is(
  (select count(*) from public.profiles where family_id = current_setting('nh.fam_moved')::uuid and anniversary is not null),
  0::bigint, 'moved copies are gone from both spouses');
select is(pg_temp.family_fields(current_setting('nh.fam_own_wins')::uuid),
  '-|-|-|-|-|-|2005-06-07|6|7|2005', 'the household''s own value beats a profile copy');
select is(
  (select anniversary::text from public.profiles where id = current_setting('nh.unhoused')::uuid),
  '2012-12-12', 'a copy with no household stays where it is');
select is(pg_temp.family_fields(current_setting('nh.fam_typo')::uuid),
  '-|-|-|-|-|-|1850-07-08|7|8|-', 'a year the check refuses is dropped instead of blocking the deploy');

-- ── Claimed birthdays ───────────────────────────────────────────────────────
select is(
  (select concat_ws('/', coalesce(birth_month::text, '-'), coalesce(birth_day::text, '-'), coalesce(birth_year::text, '-'))
     from public.family_members where id = current_setting('nh.fm_claimed_bday')::uuid),
  '-/-/-', 'a claimed row loses a hidden birthday');
select is(
  (select concat_ws('/', coalesce(birth_month::text, '-'), coalesce(birth_day::text, '-'), coalesce(birth_year::text, '-'))
     from public.family_members where id = current_setting('nh.fm_claimed_year')::uuid),
  '3/4/-', 'a claimed row loses a hidden year and keeps the month and day');
select is(
  (select concat_ws('/', birth_month, birth_day, birth_year) from public.family_members where id = current_setting('nh.fm_unclaimed')::uuid),
  '5/6/2010', 'an unclaimed row is untouched');

-- ── Idempotent ──────────────────────────────────────────────────────────────
select is(
  (select sum(value::bigint) from jsonb_each_text(public.directory_retire_hidden_values())),
  0::numeric, 'a second run changes nothing');

-- ── A couple for the live rules ─────────────────────────────────────────────
do $$
declare
  org_a uuid := current_setting('nh.org_a')::uuid;
  org_b uuid := current_setting('nh.org_b')::uuid;
  fam uuid; fam_other uuid; fam_b uuid;
  e text;
begin
  insert into public.family_units (org_id, family_name, phone_home, address_line1, city, anniversary_month, anniversary_day, anniversary_year)
    values (org_a, 'Couple', '+15559990000', '9 Oak', 'Springfield', 10, 3, 2009) returning id into fam;
  insert into public.family_units (org_id, family_name) values (org_a, 'Other Home') returning id into fam_other;
  insert into public.family_units (org_id, family_name) values (org_b, 'Org B Home') returning id into fam_b;
  perform set_config('nh.fam', fam::text, true);
  perform set_config('nh.fam_other', fam_other::text, true);
  perform set_config('nh.fam_b', fam_b::text, true);

  foreach e in array array['henry', 'chloe', 'kid', 'pend'] loop
    insert into public.access_requests (org_id, name, email, status)
    values (org_a, e, e || '@no-hide.example.test', 'approved');
    insert into auth.users (id, email) values (gen_random_uuid(), e || '@no-hide.example.test');
    update public.profiles
       set first_name = e, last_name = 'Couple', role = 'member', setup_completed = true,
           family_id = fam, is_unlisted = false, phone_mobile = '+1555888000' || length(e)
     where email = e || '@no-hide.example.test';
    perform set_config('nh.' || e, (select id::text from public.profiles where email = e || '@no-hide.example.test'), true);
  end loop;
  update public.profiles set relationship = 'primary' where id = current_setting('nh.henry')::uuid;
  update public.profiles set relationship = 'spouse' where id = current_setting('nh.chloe')::uuid;
  update public.profiles set relationship = 'child' where id = current_setting('nh.kid')::uuid;
  update public.profiles set relationship = 'spouse', role = 'pending' where id = current_setting('nh.pend')::uuid;

  -- The viewer and the couple share a group, so the views show this household.
  insert into public.group_members (org_id, group_id, profile_id)
  select org_a, current_setting('nh.grp')::uuid, p.id
    from public.profiles p
   where p.id in (current_setting('nh.viewer')::uuid, current_setting('nh.henry')::uuid, current_setting('nh.chloe')::uuid)
  on conflict do nothing;
end $$;

create function pg_temp.seen(_column text) returns text
  language sql as $$
  select pg_temp.as_text(current_setting('nh.viewer')::uuid,
    format('select coalesce(%I::text, ''-'') from public.families_directory_full where id = %L', _column, current_setting('nh.fam')));
$$;

-- ── Old app on the new schema ───────────────────────────────────────────────
select is(pg_temp.seen('anniversary'), '2009-10-03', 'parts written by the new app reach the old column');
select is(pg_temp.as_write(current_setting('nh.chloe')::uuid,
    format('update public.family_units set anniversary_year = null where id = %L', current_setting('nh.fam'))),
  'rows=1', 'a spouse drops the year');
select is(pg_temp.seen('anniversary'), '-', 'a yearless value has no date for the old app to show');
select is(pg_temp.seen('anniversary_month') || '/' || pg_temp.seen('anniversary_day') || '/' || pg_temp.seen('anniversary_year'),
  '10/3/-', 'a yearless value keeps its month and day');
select is(pg_temp.as_write(current_setting('nh.henry')::uuid,
    format('update public.family_units set anniversary = null where id = %L', current_setting('nh.fam'))),
  'rows=1', 'an old form saves the yearless household with a null date');
select is(pg_temp.seen('anniversary_month'), '10', 'that save cannot wipe the parts');
select is(pg_temp.as_write(current_setting('nh.henry')::uuid,
    format('update public.family_units set anniversary = ''2009-10-03'' where id = %L', current_setting('nh.fam'))),
  'rows=1', 'an old form writes a full date');
select is(pg_temp.seen('anniversary_year'), '2009', 'an old form''s date reaches the parts');

update public.profiles set hide_anniversary = true where id = current_setting('nh.chloe')::uuid;
select is(pg_temp.seen('anniversary') || pg_temp.seen('anniversary_month') || pg_temp.seen('anniversary_day') || pg_temp.seen('anniversary_year'),
  '----', 'a spouse hiding through the old app blanks both shapes');
update public.profiles set is_unlisted = true where id = current_setting('nh.chloe')::uuid;
select is(pg_temp.seen('anniversary') || pg_temp.seen('anniversary_month'),
  '--', 'and stays blank when that spouse is unlisted, whose row the viewer cannot read');
select is(
  pg_temp.as_text(current_setting('nh.viewer')::uuid,
    format('select count(*) from public.profiles where id = %L', current_setting('nh.chloe'))),
  '0', 'the viewer really cannot read that row');
select is(
  pg_temp.as_text(current_setting('nh.viewer')::uuid,
    format('select coalesce(anniversary::text, ''-'') from public.families_directory where id = %L', current_setting('nh.fam'))),
  '-', 'the other household view blanks it too');
update public.profiles set is_unlisted = false, hide_anniversary = false where id = current_setting('nh.chloe')::uuid;
update public.profiles set hide_anniversary = true where id = current_setting('nh.kid')::uuid;
select is(pg_temp.seen('anniversary'), '2009-10-03', 'a child''s flag does not hide the couple''s anniversary');
update public.profiles set hide_anniversary = false where id = current_setting('nh.kid')::uuid;
update public.family_units set hide_phone_home = true where id = current_setting('nh.fam')::uuid;
select is(pg_temp.seen('phone_home'), '-', 'the old household phone gate still holds');
update public.family_units set hide_phone_home = false where id = current_setting('nh.fam')::uuid;
select is(pg_temp.seen('phone_home'), '+15559990000', 'a shared number shows');

-- ── Date shape ──────────────────────────────────────────────────────────────
select is(pg_temp.as_write(current_setting('nh.henry')::uuid,
    format('update public.family_units set anniversary_day = null where id = %L', current_setting('nh.fam'))),
  '23514', 'a month with no day is refused');
select is(pg_temp.as_write(current_setting('nh.henry')::uuid,
    format('update public.family_units set anniversary_month = 2, anniversary_day = 30, anniversary_year = null where id = %L', current_setting('nh.fam'))),
  '23514', 'a day the month never has is refused');
select is(pg_temp.as_write(current_setting('nh.henry')::uuid,
    format('update public.family_units set anniversary_month = 2, anniversary_day = 29, anniversary_year = 2023 where id = %L', current_setting('nh.fam'))),
  '22008', 'Feb 29 in a year without one is refused');
select is(pg_temp.as_write(current_setting('nh.henry')::uuid,
    format('update public.family_units set anniversary_month = 2, anniversary_day = 29, anniversary_year = null where id = %L', current_setting('nh.fam'))),
  'rows=1', 'a yearless Feb 29 is allowed');
update public.family_units set anniversary_month = 10, anniversary_day = 3, anniversary_year = 2009 where id = current_setting('nh.fam')::uuid;

-- ── Household phone: only that spouse chooses their own number ──────────────
create function pg_temp.point_at(_target uuid) returns text
  language sql as $$
  select format('update public.family_units set phone_profile_id = %L where id = %L', _target, current_setting('nh.fam'));
$$;

select is(pg_temp.as_write(current_setting('nh.henry')::uuid, pg_temp.point_at(current_setting('nh.chloe')::uuid)),
  'HP001', 'one spouse cannot point the household phone at the other');
select is((select phone_profile_id::text from public.family_units where id = current_setting('nh.fam')::uuid), null,
  'that refused write left the household unchanged');
select is(pg_temp.as_write(current_setting('nh.kid')::uuid, pg_temp.point_at(current_setting('nh.kid')::uuid)),
  'HP001', 'a child cannot choose their own number');
select is(pg_temp.as_write(current_setting('nh.outsider')::uuid, pg_temp.point_at(current_setting('nh.outsider')::uuid)),
  'rows=0', 'someone outside the household reaches no row');
select is(pg_temp.as_write(current_setting('nh.owner')::uuid, pg_temp.point_at(current_setting('nh.chloe')::uuid)),
  'HP001', 'a church admin cannot choose it for them');
select is(pg_temp.as_write(current_setting('nh.chloe')::uuid, pg_temp.point_at(current_setting('nh.chloe')::uuid)),
  'rows=1', 'a spouse chooses their own number');
select is((select phone_home from public.family_units where id = current_setting('nh.fam')::uuid), null,
  'the shared number is cleared, not kept behind the choice');
select is(pg_temp.seen('phone_home'), '+15558880005', 'the household phone reads their current number');
select is(pg_temp.seen('phone_profile_id'), current_setting('nh.chloe'), 'and says whose it is');

select is(pg_temp.as_write(current_setting('nh.chloe')::uuid,
    format('update public.profiles set phone_mobile = ''+15558881111'' where id = %L', current_setting('nh.chloe'))),
  'rows=1', 'the owner changes the number on their profile');
select is(pg_temp.seen('phone_home'), '+15558881111', 'the household phone follows the change');
select is(pg_temp.as_write(current_setting('nh.chloe')::uuid,
    format('update public.profiles set phone_mobile = null where id = %L', current_setting('nh.chloe'))),
  'rows=1', 'the owner clears the number on their profile');
select is(pg_temp.seen('phone_home'), '-', 'the household phone clears with it');
update public.profiles set phone_mobile = '+15558880005' where id = current_setting('nh.chloe')::uuid;

update public.profiles set hide_phone_mobile = true where id = current_setting('nh.chloe')::uuid;
select is(pg_temp.seen('phone_home'), '-', 'a mobile hidden through the old app stays hidden through the pointer');
update public.profiles set hide_phone_mobile = false, is_unlisted = true where id = current_setting('nh.chloe')::uuid;
select is(pg_temp.seen('phone_home'), '-', 'an unlisted owner''s number does not show');
update public.profiles set is_unlisted = false, family_id = current_setting('nh.fam_other')::uuid where id = current_setting('nh.chloe')::uuid;
select is(pg_temp.seen('phone_home'), '-', 'an owner who moved out takes the number with them');
update public.profiles set family_id = current_setting('nh.fam')::uuid where id = current_setting('nh.chloe')::uuid;

select is(pg_temp.as_write(current_setting('nh.henry')::uuid,
    format('update public.family_units set phone_home = ''+15550001111'' where id = %L', current_setting('nh.fam'))),
  'rows=1', 'a stale form writes a shared number over the choice');
select is(pg_temp.seen('phone_home'), '+15558880005', 'the choice wins until it is cleared');
select is(pg_temp.as_write(current_setting('nh.henry')::uuid,
    format('update public.family_units set phone_profile_id = null where id = %L', current_setting('nh.fam'))),
  'rows=1', 'the other spouse clears the choice');
select is(pg_temp.seen('phone_home') || pg_temp.seen('phone_profile_id'), '--', 'it is gone for both');

-- The guard refuses this first for any real caller, so it steps aside to prove the key.
alter table public.family_units disable trigger family_units_phone_owner_guard;
select throws_ok(
  format('update public.family_units set phone_profile_id = %L where id = %L', current_setting('nh.henry'), current_setting('nh.fam_b')),
  '23503', null, 'the composite key refuses another org''s profile');
alter table public.family_units enable trigger family_units_phone_owner_guard;

select is(pg_temp.as_write(current_setting('nh.chloe')::uuid, pg_temp.point_at(current_setting('nh.chloe')::uuid)),
  'rows=1', 'the owner chooses the number again');
delete from public.family_members where claimed_profile_id = current_setting('nh.chloe')::uuid;
delete from auth.users where id = current_setting('nh.chloe')::uuid;
select is(
  (select concat_ws('|', family_name, coalesce(phone_profile_id::text, '-'), anniversary_month) from public.family_units where id = current_setting('nh.fam')::uuid),
  'Couple|-|10', 'deleting the owner nulls only the pointer');

-- ── Either spouse clears, for both ──────────────────────────────────────────
update public.profiles set relationship = 'spouse' where id = current_setting('nh.kid')::uuid;
select is(pg_temp.as_write(current_setting('nh.kid')::uuid,
    format('update public.family_units set address_line1 = null, city = null, phone_home = null, anniversary_month = null, anniversary_day = null, anniversary_year = null where id = %L', current_setting('nh.fam'))),
  'rows=1', 'a spouse clears the address, phone and anniversary');
select is(pg_temp.seen('address_line1') || pg_temp.seen('phone_home') || pg_temp.seen('anniversary_month') || pg_temp.seen('anniversary'),
  '----', 'they are gone from the directory');
select is(
  pg_temp.as_text(current_setting('nh.henry')::uuid,
    format('select coalesce(address_line1, ''-'') || coalesce(phone_home, ''-'') || coalesce(anniversary_month::text, ''-'') from public.family_units where id = %L', current_setting('nh.fam'))),
  '---', 'and gone for the other spouse');

update public.family_units set anniversary_month = 1, anniversary_day = 1 where id = current_setting('nh.fam')::uuid;
select is(pg_temp.as_write(current_setting('nh.pend')::uuid,
    format('update public.family_units set anniversary_month = null, anniversary_day = null where id = %L', current_setting('nh.fam'))),
  'rows=0', 'a pending spouse has no write path: 0 rows, as the pull request reports');
select is((select anniversary_month from public.family_units where id = current_setting('nh.fam')::uuid), 1::smallint,
  'that write changed nothing');

-- ── ACLs ────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'public.directory_retire_hidden_values()', 'execute'),
  'authenticated cannot run the sweep');
select ok(not has_function_privilege('service_role', 'public.directory_retire_hidden_values()', 'execute'),
  'service_role cannot run the sweep');
select ok(not has_function_privilege('anon', 'public.family_anniversary_hidden(uuid)', 'execute'),
  'anon cannot call the anniversary gate');
select ok(has_function_privilege('authenticated', 'public.family_anniversary_hidden(uuid)', 'execute'),
  'authenticated can, because the views call it as the caller');
select ok(not has_function_privilege('authenticated', 'public.family_units_sync_anniversary()', 'execute'),
  'the sync trigger function is not callable');
select ok(not has_function_privilege('authenticated', 'public.family_units_phone_owner_guard()', 'execute'),
  'the guard trigger function is not callable');

select * from finish();
rollback;
