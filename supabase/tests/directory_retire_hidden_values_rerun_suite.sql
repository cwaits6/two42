-- The migration that drops the retired directory hide flags sweeps once more
-- first. This rebuilds the schema it starts from, sets flags the way a direct
-- API write could have after the previous sweep, and replays the migration: a
-- value under a true flag is gone, a value under no flag is kept, the two
-- remaining settings are untouched, and the flags and sweep are gone after.
--
-- The migration and the functions it drops are replayed from the statements
-- the Supabase CLI recorded in supabase_migrations.schema_migrations when it
-- applied them, so what runs here is the migration file itself.
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

-- Runs every recorded statement of one migration that matches _pattern, in
-- order, and returns how many ran, so an empty record fails instead of passing.
create function pg_temp.replay(_version text, _pattern text) returns integer
  language plpgsql as $$
declare
  _stmt text;
  _n integer := 0;
begin
  for _stmt in
    select s
      from supabase_migrations.schema_migrations m,
           unnest(m.statements) with ordinality as u(s, i)
     where m.version = _version
       and s ~ _pattern
     order by i
  loop
    execute _stmt;
    _n := _n + 1;
  end loop;
  return _n;
end $$;

-- ── The schema the drop migration starts from ───────────────────────────────
alter table public.profiles
  add column hide_phone_mobile boolean not null default false,
  add column hide_phone_home boolean not null default false,
  add column hide_phone_work boolean not null default false,
  add column hide_address boolean not null default false,
  add column hide_birthday boolean not null default false,
  add column hide_birth_year boolean not null default false,
  add column hide_anniversary boolean not null default false,
  add column hide_occupation boolean not null default false;

alter table public.family_units
  add column hide_address boolean not null default false,
  add column hide_phone_home boolean not null default false;

select is(
  pg_temp.replay('20261111000000',
    'create function public\.(family_anniversary_hidden|directory_retire_hidden_values)\('),
  2,
  'the gate and the sweep are rebuilt from the statements that created them'
);

-- ── Fixtures: flags set after the previous sweep ────────────────────────────
do $$
declare
  org_a uuid;
  fam_addr uuid;
  fam_anniv uuid;
  fam_kept uuid;
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
      address_line1 = '1 Main', city = 'Springfield', birth_month = 4, birth_day = 5,
      birth_year = 1980, occupation = 'Teacher', employer = 'School'
     where email = e || '@rerun.example.test';
  end loop;

  update public.profiles set hide_phone_work = true, hide_birth_year = true, hide_email = true, is_unlisted = true
   where email = 'hid@rerun.example.test';

  insert into public.family_units (org_id, family_name, address_line1, city, state, postal_code, phone_home, hide_address)
    values (org_a, 'Rerun Address', '9 Elm', 'Springfield', 'IL', '62703', '+15550000002', true)
    returning id into fam_addr;

  insert into public.family_units (org_id, family_name, anniversary_month, anniversary_day, anniversary_year)
    values (org_a, 'Rerun Anniversary', 6, 7, 2008)
    returning id into fam_anniv;
  update public.profiles set family_id = fam_anniv, relationship = 'primary' where email = 'anniv_p@rerun.example.test';
  update public.profiles set family_id = fam_anniv, relationship = 'spouse', hide_anniversary = true
   where email = 'anniv_s@rerun.example.test';

  insert into public.family_units (org_id, family_name, address_line1, city, state, postal_code, phone_home,
                                   anniversary_month, anniversary_day, anniversary_year)
    values (org_a, 'Rerun Kept', '3 Oak', 'Springfield', 'IL', '62704', '+15550000004', 8, 9, 2010)
    returning id into fam_kept;

  perform set_config('rr.org', org_a::text, true);
  perform set_config('rr.fam_addr', fam_addr::text, true);
  perform set_config('rr.fam_anniv', fam_anniv::text, true);
  perform set_config('rr.fam_kept', fam_kept::text, true);
end $$;

select is(
  (select count(*)::int from public.profiles
    where org_id = current_setting('rr.org')::uuid and phone_work is not null and email like '%@rerun.example.test'),
  4,
  'before the migration, every fixture still stores its work phone, hidden or not'
);

-- ── The migration ───────────────────────────────────────────────────────────
select ok(
  pg_temp.replay('20261204000000', '.') > 0,
  'the drop migration replays from its recorded statements'
);

-- ── What it deleted and what it kept ────────────────────────────────────────
select is(
  (select row(phone_work, birth_year)::text from public.profiles where email = 'hid@rerun.example.test'),
  row(null::text, null::smallint)::text,
  'a work phone and birth year hidden after the previous sweep are gone'
);

select is(
  (select row(phone_mobile, address_line1, birth_month, birth_day, occupation, employer)::text
     from public.profiles where email = 'hid@rerun.example.test'),
  row('+15550000001', '1 Main', 4::smallint, 5::smallint, 'Teacher', 'School')::text,
  'that person''s values under no flag are kept'
);

select is(
  (select row(hide_email, is_unlisted)::text from public.profiles where email = 'hid@rerun.example.test'),
  row(true, true)::text,
  'hide_email and is_unlisted are untouched'
);

select is(
  (select count(*)::int from public.profiles
    where org_id = current_setting('rr.org')::uuid and email like '%@rerun.example.test'
      and phone_work = '+15550000003' and birth_year = 1980 and occupation = 'Teacher'),
  3,
  'the three people with no flag set keep every value'
);

select is(
  (select row(address_line1, city, state, postal_code, phone_home)::text
     from public.family_units where id = current_setting('rr.fam_addr')::uuid),
  row(null::text, null::text, null::text, null::text, '+15550000002')::text,
  'a household address under a true flag is gone, and its phone under no flag is kept'
);

select is(
  (select row(anniversary, anniversary_month, anniversary_day, anniversary_year)::text
     from public.family_units where id = current_setting('rr.fam_anniv')::uuid),
  row(null::date, null::smallint, null::smallint, null::smallint)::text,
  'a household anniversary one spouse hid is gone'
);

select is(
  (select row(address_line1, city, state, postal_code, phone_home, anniversary, anniversary_month, anniversary_day, anniversary_year)::text
     from public.family_units where id = current_setting('rr.fam_kept')::uuid),
  row('3 Oak', 'Springfield', 'IL', '62704', '+15550000004', '2010-08-09'::date, 8::smallint, 9::smallint, 2010::smallint)::text,
  'a household with no flag set keeps every value'
);

select is(
  (select count(*)::int from public.family_units
    where org_id = current_setting('rr.org')::uuid and (address_line1 is not null or anniversary_month is not null)),
  1,
  'one fixture household of three keeps an address or anniversary'
);

-- ── What it dropped ─────────────────────────────────────────────────────────
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name in ('profiles', 'family_units')
      and column_name like 'hide\_%' and column_name <> 'hide_email'),
  0,
  'no retired flag column is left'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('family_anniversary_hidden', 'directory_retire_hidden_values')),
  0,
  'the gate and the sweep are dropped again'
);

select * from finish();
rollback;
