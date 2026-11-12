-- The second run of directory_retire_hidden_values(), once the app no longer
-- writes the retired flags: a flag set after the first run is cleared with the
-- value it hides, a value under a false flag is kept, the two remaining
-- settings are left alone, and no retired flag is true anywhere afterwards.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/directory_retire_hidden_values_rerun_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- The sweep reaches every org, so the stack's own rows are swept first and the
-- counts below see only these fixtures.
do $$ begin
  perform public.directory_retire_hidden_values();
end $$;

-- ── Fixtures: rows as a page on the earlier build left them ─────────────────
do $$
declare
  org_a uuid;
  fam_addr uuid;
  fam_anniv uuid;
  e text;
begin
  org_a := public.provision_organization('Rerun Org', 'owner@rerun.example.test');

  foreach e in array array['hid', 'kept', 'anniv_p', 'anniv_s'] loop
    insert into public.access_requests (org_id, name, email, status)
    values (org_a, e, e || '@rerun.example.test', 'approved');
    insert into auth.users (id, email) values (gen_random_uuid(), e || '@rerun.example.test');
    update public.profiles set
      first_name = e, last_name = 'Fixture', role = 'member', setup_completed = true,
      family_id = null, relationship = 'other', anniversary = null,
      phone_mobile = '+15550000001', phone_work = '+15550000003',
      occupation = 'Teacher', employer = 'School'
     where email = e || '@rerun.example.test';
    perform set_config('rr.' || e, (select id::text from public.profiles where email = e || '@rerun.example.test'), true);
  end loop;

  -- Hidden after the first run, alongside both settings that remain.
  update public.profiles set hide_phone_work = true, hide_email = true, is_unlisted = true
   where email = 'hid@rerun.example.test';

  -- An address entered over a household flag set after the first run.
  insert into public.family_units (org_id, family_name, address_line1, city, state, postal_code, phone_home, hide_address)
    values (org_a, 'Rerun Address', '9 Elm', 'Springfield', 'IL', '62703', '+15550000002', true)
    returning id into fam_addr;
  perform set_config('rr.fam_addr', fam_addr::text, true);

  -- A spouse's anniversary flag set after the first run hides the household's.
  insert into public.family_units (org_id, family_name, anniversary_month, anniversary_day, anniversary_year)
    values (org_a, 'Rerun Anniversary', 6, 7, 2008)
    returning id into fam_anniv;
  perform set_config('rr.fam_anniv', fam_anniv::text, true);
  update public.profiles set family_id = fam_anniv, relationship = 'primary' where email = 'anniv_p@rerun.example.test';
  update public.profiles set family_id = fam_anniv, relationship = 'spouse', hide_anniversary = true
   where email = 'anniv_s@rerun.example.test';
end $$;

select is(
  (select phone_work from public.profiles where id = current_setting('rr.hid')::uuid),
  '+15550000003',
  'before the run, a value hidden after the first run is still stored'
);

create temp table rr_counts as select public.directory_retire_hidden_values() as counts;

select is(
  (select counts from rr_counts),
  jsonb_build_object(
    'household_anniversary', 1, 'claimed_birthday', 0,
    'hide_phone_mobile', 0, 'hide_phone_home', 0, 'hide_phone_work', 1,
    'hide_address', 0, 'hide_birth_year', 0, 'hide_birthday', 0,
    'hide_anniversary', 1, 'hide_occupation', 0,
    'household_hide_address', 1, 'household_hide_phone_home', 0,
    'anniversary_moved', 0, 'anniversary_split', 0),
  'the run changes exactly the rows each flag set after the first run reaches'
);

select is(
  (select row(phone_work, hide_phone_work)::text from public.profiles where id = current_setting('rr.hid')::uuid),
  row(null::text, false)::text,
  'the hidden number is gone and its flag is false'
);

select is(
  (select row(phone_mobile, occupation, employer)::text from public.profiles where id = current_setting('rr.hid')::uuid),
  row('+15550000001', 'Teacher', 'School')::text,
  'values under that person''s false flags are kept'
);

select is(
  (select row(hide_email, is_unlisted)::text from public.profiles where id = current_setting('rr.hid')::uuid),
  row(true, true)::text,
  'hide_email and is_unlisted are untouched'
);

select is(
  (select row(phone_mobile, phone_work, occupation, employer, hide_email, is_unlisted)::text
     from public.profiles where id = current_setting('rr.kept')::uuid),
  row('+15550000001', '+15550000003', 'Teacher', 'School', false, false)::text,
  'a person with no flag set keeps every value'
);

select is(
  (select row(address_line1, city, state, postal_code, hide_address)::text
     from public.family_units where id = current_setting('rr.fam_addr')::uuid),
  row(null::text, null::text, null::text, null::text, false)::text,
  'an address entered over a household flag is gone and the flag is false'
);

select is(
  (select phone_home from public.family_units where id = current_setting('rr.fam_addr')::uuid),
  '+15550000002',
  'that household''s phone, under a false flag, is kept'
);

select is(
  (select row(anniversary, anniversary_month, anniversary_day, anniversary_year)::text
     from public.family_units where id = current_setting('rr.fam_anniv')::uuid),
  row(null::date, null::smallint, null::smallint, null::smallint)::text,
  'a household anniversary one spouse hid is gone'
);

select is(
  (select count(*)::int from public.profiles
    where hide_phone_mobile or hide_phone_home or hide_phone_work or hide_address
       or hide_birthday or hide_birth_year or hide_anniversary or hide_occupation),
  0,
  'no retired flag on profiles is true afterwards'
);

select is(
  (select count(*)::int from public.family_units where hide_address or hide_phone_home),
  0,
  'no retired flag on family_units is true afterwards'
);

select is(
  public.directory_retire_hidden_values(),
  jsonb_build_object(
    'household_anniversary', 0, 'claimed_birthday', 0,
    'hide_phone_mobile', 0, 'hide_phone_home', 0, 'hide_phone_work', 0,
    'hide_address', 0, 'hide_birth_year', 0, 'hide_birthday', 0,
    'hide_anniversary', 0, 'hide_occupation', 0,
    'household_hide_address', 0, 'household_hide_phone_home', 0,
    'anniversary_moved', 0, 'anniversary_split', 0),
  'a further run changes nothing'
);

select is(
  (select count(*)::int from public.profiles
    where email like '%@rerun.example.test' and (hide_email or is_unlisted)),
  1,
  'the two remaining settings still hold on the one person who set them'
);

select * from finish();
rollback;
