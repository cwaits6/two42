-- Directory with no hide settings: what's stored is what's shown.
--
-- Proves the retired flag columns, the anniversary gate and the sweep are gone,
-- that every directory view returns stored values unchanged, then the single
-- anniversary date and its parts, the household phone pointer and who may clear
-- what. The final sweep is proved in directory_retire_hidden_values_rerun_suite.sql.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/directory_no_hide_settings_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

-- ── What is gone ────────────────────────────────────────────────────────────
select hasnt_column('public', 'profiles', 'hide_phone_mobile', 'profiles.hide_phone_mobile is dropped');
select hasnt_column('public', 'profiles', 'hide_phone_home', 'profiles.hide_phone_home is dropped');
select hasnt_column('public', 'profiles', 'hide_phone_work', 'profiles.hide_phone_work is dropped');
select hasnt_column('public', 'profiles', 'hide_address', 'profiles.hide_address is dropped');
select hasnt_column('public', 'profiles', 'hide_birthday', 'profiles.hide_birthday is dropped');
select hasnt_column('public', 'profiles', 'hide_birth_year', 'profiles.hide_birth_year is dropped');
select hasnt_column('public', 'profiles', 'hide_anniversary', 'profiles.hide_anniversary is dropped');
select hasnt_column('public', 'profiles', 'hide_occupation', 'profiles.hide_occupation is dropped');
select hasnt_column('public', 'family_units', 'hide_address', 'family_units.hide_address is dropped');
select hasnt_column('public', 'family_units', 'hide_phone_home', 'family_units.hide_phone_home is dropped');
select has_column('public', 'profiles', 'hide_email', 'profiles.hide_email stays');
select has_column('public', 'profiles', 'is_unlisted', 'profiles.is_unlisted stays');

select hasnt_function('public', 'family_anniversary_hidden', array['uuid'], 'the anniversary gate is dropped');
select hasnt_function('public', 'directory_retire_hidden_values', array[]::text[], 'the sweep is dropped');
-- The seed writes the single date, and the app reads the parts this keeps in step.
select has_trigger('public', 'family_units', 'family_units_sync_anniversary',
  'the anniversary sync trigger stays while family_units.anniversary does');

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

-- ── Fixtures ────────────────────────────────────────────────────────────────
do $$
declare
  org_a uuid;
  org_b uuid;
  e text;
  uid uuid;
  grp uuid;
begin
  org_a := public.provision_organization('No Hide Org A', 'owner@no-hide.example.test');
  org_b := public.provision_organization('No Hide Org B', 'owner-b@no-hide.example.test');

  foreach e in array array['owner', 'shown', 'viewer', 'outsider'] loop
    if e <> 'owner' then
      insert into public.access_requests (org_id, name, email, status)
      values (org_a, e, e || '@no-hide.example.test', 'approved');
    end if;
    uid := gen_random_uuid();
    insert into auth.users (id, email) values (uid, e || '@no-hide.example.test');
    perform set_config('nh.' || e, uid::text, true);
    update public.profiles p set
      first_name = e, last_name = 'Fixture', relationship = 'other', family_id = null,
      is_unlisted = false, hide_email = false, setup_completed = true,
      role = case when e = 'owner' then p.role else 'member' end
    where p.id = uid;
  end loop;

  -- Every field the retired flags once gated, filled.
  update public.profiles set
    phone_mobile = '+15550000001', phone_home = '+15550000002', phone_work = '+15550000003',
    address_line1 = '1 Main', address_line2 = 'Apt 2', city = 'Springfield', state = 'IL',
    postal_code = '62703', birth_month = 4, birth_day = 5, birth_year = 1980,
    anniversary = '2001-02-03', occupation = 'Teacher', employer = 'School'
  where id = current_setting('nh.shown')::uuid;

  insert into public.groups (org_id, name) values (org_a, 'Everyone') returning groups.id into grp;
  perform set_config('nh.grp', grp::text, true);
  perform set_config('nh.org_a', org_a::text, true);
  perform set_config('nh.org_b', org_b::text, true);

  insert into public.group_members (org_id, group_id, profile_id)
  values (org_a, grp, current_setting('nh.viewer')::uuid), (org_a, grp, current_setting('nh.shown')::uuid);
end $$;

-- ── A person's stored values, as another member sees them ───────────────────
create function pg_temp.person_fields(_relation text) returns text
  language sql as $$
  select format($q$
    select concat_ws('|', phone_mobile, phone_home, phone_work, address_line1, address_line2, city,
                     state, postal_code, birth_month, birth_day, birth_year, anniversary, occupation, employer)
      from %s where id = %L$q$, _relation, current_setting('nh.shown'));
$$;

select is(
  pg_temp.as_text(current_setting('nh.viewer')::uuid, pg_temp.person_fields('public.profiles_directory')),
  '+15550000001|+15550000002|+15550000003|1 Main|Apt 2|Springfield|IL|62703|4|5|1980|2001-02-03|Teacher|School',
  'profiles_directory returns every stored value unchanged'
);
select is(
  pg_temp.as_text(current_setting('nh.viewer')::uuid,
    format('select email from public.profiles_directory where id = %L', current_setting('nh.shown'))),
  'shown@no-hide.example.test',
  'and the email of someone who shows it'
);
update public.profiles set hide_email = true where id = current_setting('nh.shown')::uuid;
select is(
  pg_temp.as_text(current_setting('nh.viewer')::uuid,
    format('select coalesce(email, ''-'') || ''|'' || phone_mobile from public.profiles_directory where id = %L', current_setting('nh.shown'))),
  '-|+15550000001',
  'the email setting still takes the email, and only the email'
);
update public.profiles set hide_email = false, is_unlisted = true where id = current_setting('nh.shown')::uuid;
select is(
  pg_temp.as_text(current_setting('nh.viewer')::uuid,
    format('select count(*) from public.profiles_directory where id = %L', current_setting('nh.shown'))),
  '0',
  'the listing setting still takes the person out'
);
update public.profiles set is_unlisted = false where id = current_setting('nh.shown')::uuid;

-- ── A couple ────────────────────────────────────────────────────────────────
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
  update public.profiles set relationship = 'primary', birth_month = 6, birth_day = 7, birth_year = 1975
   where id = current_setting('nh.henry')::uuid;
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

-- ── A household's stored values, as another member sees them ────────────────
select is(
  pg_temp.as_text(current_setting('nh.viewer')::uuid,
    format('select concat_ws(''|'', address_line1, city, phone_home, anniversary) from public.families_directory where id = %L',
      current_setting('nh.fam'))),
  '9 Oak|Springfield|+15559990000|2009-10-03',
  'families_directory returns the stored address, phone and anniversary unchanged'
);
select is(
  pg_temp.as_text(current_setting('nh.viewer')::uuid,
    format('select concat_ws(''|'', address_line1, city, phone_home, anniversary, anniversary_month, anniversary_day, anniversary_year) from public.families_directory_full where id = %L',
      current_setting('nh.fam'))),
  '9 Oak|Springfield|+15559990000|2009-10-03|10|3|2009',
  'families_directory_full returns them unchanged, with the anniversary parts'
);
select is(
  pg_temp.as_text(current_setting('nh.viewer')::uuid,
    format('select concat_ws(''|'', m->>''phone_mobile'', m->>''birth_month'', m->>''birth_day'', m->>''birth_year'') from public.families_directory_full f, jsonb_array_elements(f.members) m where f.id = %L and m->>''id'' = %L',
      current_setting('nh.fam'), current_setting('nh.henry'))),
  '+15558880005|6|7|1975',
  'a member in families_directory_full carries their stored mobile and birthday unchanged'
);

create function pg_temp.seen(_column text) returns text
  language sql as $$
  select pg_temp.as_text(current_setting('nh.viewer')::uuid,
    format('select coalesce(%I::text, ''-'') from public.families_directory_full where id = %L', _column, current_setting('nh.fam')));
$$;

-- ── The single anniversary date and its parts stay in step ───────────────────
select is(pg_temp.seen('anniversary'), '2009-10-03', 'parts written by the app reach the single date');
select is(pg_temp.as_write(current_setting('nh.chloe')::uuid,
    format('update public.family_units set anniversary_year = null where id = %L', current_setting('nh.fam'))),
  'rows=1', 'a spouse drops the year');
select is(pg_temp.seen('anniversary'), '-', 'a yearless value has no single date');
select is(pg_temp.seen('anniversary_month') || '/' || pg_temp.seen('anniversary_day') || '/' || pg_temp.seen('anniversary_year'),
  '10/3/-', 'a yearless value keeps its month and day');
select is(pg_temp.as_write(current_setting('nh.henry')::uuid,
    format('update public.family_units set anniversary = null where id = %L', current_setting('nh.fam'))),
  'rows=1', 'a write of a null date to a yearless household');
select is(pg_temp.seen('anniversary_month'), '10', 'that save cannot wipe the parts');
select is(pg_temp.as_write(current_setting('nh.henry')::uuid,
    format('update public.family_units set anniversary = ''2009-10-03'' where id = %L', current_setting('nh.fam'))),
  'rows=1', 'a write of a full date');
select is(pg_temp.seen('anniversary_year'), '2009', 'that date reaches the parts');
select is(pg_temp.as_write(current_setting('nh.henry')::uuid,
    format('update public.family_units set anniversary = ''2050-10-03'' where id = %L', current_setting('nh.fam'))),
  'rows=1', 'a write of a year the household forms refuse');
select is(pg_temp.seen('anniversary_month') || '/' || pg_temp.seen('anniversary_day') || '/' || pg_temp.seen('anniversary_year'),
  '10/3/-', 'that year stays out of the parts');
select is(pg_temp.as_write(current_setting('nh.henry')::uuid,
    format('update public.family_units set anniversary = ''2009-10-03'' where id = %L', current_setting('nh.fam'))),
  'rows=1', 'a write of the full date back');

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

update public.profiles set is_unlisted = true where id = current_setting('nh.chloe')::uuid;
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
select ok(not has_function_privilege('authenticated', 'public.family_units_sync_anniversary()', 'execute'),
  'the sync trigger function is not callable');
select ok(not has_function_privilege('authenticated', 'public.family_units_phone_owner_guard()', 'execute'),
  'the guard trigger function is not callable');

select * from finish();
rollback;
