-- A reply is for one date: the key holds the date, rsvp_set() saves and
-- clears one date, a save that names no date is refused, who can write and
-- read a reply (by row count), and each date's reminder goes to that date's
-- replies.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/event_reply_dates_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  me uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  grp uuid;
  grp_2 uuid;
  grp_b uuid;
  late uuid;
  moved uuid;
  single uuid;
  hidden uuid;
  event_b uuid;
  claim_series uuid;
  claim_moved uuid;
begin
  org_a := public.provision_organization('Reply Dates Org A', 'owner-a@reply-dates.example.test');
  org_b := public.provision_organization('Reply Dates Org B', 'owner-b@reply-dates.example.test');
  update public.organizations set timezone = 'America/Chicago' where id = org_a;
  update public.organizations set timezone = 'Pacific/Auckland' where id = org_b;

  insert into public.access_requests (org_id, name, email, status)
  select org_a, who, who || '@reply-dates.example.test', 'approved'
  from unnest(array['me', 'other', 'outsider']) as who;
  insert into auth.users (id, email) values
    (owner_a, 'owner-a@reply-dates.example.test'),
    (owner_b, 'owner-b@reply-dates.example.test'),
    (me, 'me@reply-dates.example.test'),
    (other, 'other@reply-dates.example.test'),
    (outsider, 'outsider@reply-dates.example.test');

  insert into public.groups (org_id, name) values (org_a, 'group one') returning id into grp;
  insert into public.groups (org_id, name) values (org_a, 'group two') returning id into grp_2;
  insert into public.groups (org_id, name) values (org_b, 'group B') returning id into grp_b;
  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org_a, grp, owner_a, 'leader'),
    (org_a, grp, me, 'member'),
    (org_a, grp, other, 'member'),
    (org_a, grp_2, outsider, 'leader'),
    (org_b, grp_b, owner_b, 'leader');

  -- 23:30 on Sundays from Nov 2, 2031 in Chicago; Nov 16 moved to the Friday
  -- before.
  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode)
    values (org_a, grp, 'Late Sundays', '2031-11-02 23:30-06', 'weekly', 'never') returning id into late;
  insert into public.events (org_id, group_id, title, start_time, series_id, series_occurrence_date)
    values (org_a, grp, 'Late Sundays, moved', '2031-11-14 23:30-06', late, '2031-11-16 23:30-06')
    returning id into moved;
  insert into public.events (org_id, group_id, title, start_time)
    values (org_a, grp, 'Fourth of July', '2031-07-04 23:00-05') returning id into single;
  insert into public.events (org_id, group_id, title, start_time)
    values (org_a, grp_2, 'Group two only', '2031-07-04 10:00-05') returning id into hidden;
  insert into public.events (org_id, group_id, title, start_time)
    values (org_b, grp_b, 'Org B event', '2031-07-04 10:00-05') returning id into event_b;
  insert into public.rsvps (org_id, event_id, user_id, status, occurrence_date)
    values (org_b, event_b, owner_b, 'yes', '2031-07-05');

  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode)
    values (org_a, grp, 'Claim weekly', '2031-03-05 19:00-06', 'weekly', 'never') returning id into claim_series;
  insert into public.events (org_id, group_id, title, start_time, series_id, series_occurrence_date)
    values (org_a, grp, 'Claim weekly, moved', '2031-03-13 18:00-05', claim_series, '2031-03-12 19:00-05')
    returning id into claim_moved;
  -- me answered the first date and the moved one; other answered the third,
  -- and No to the moved one.
  insert into public.rsvps (org_id, event_id, user_id, status, occurrence_date) values
    (org_a, claim_series, me, 'yes', '2031-03-05'),
    (org_a, claim_series, me, 'yes', '2031-03-12'),
    (org_a, claim_series, other, 'maybe', '2031-03-19'),
    (org_a, claim_series, other, 'no', '2031-03-12');

  perform set_config('rd.org_a', org_a::text, true);
  perform set_config('rd.org_b', org_b::text, true);
  perform set_config('rd.me', me::text, true);
  perform set_config('rd.other', other::text, true);
  perform set_config('rd.late', late::text, true);
  perform set_config('rd.moved', moved::text, true);
  perform set_config('rd.single', single::text, true);
  perform set_config('rd.hidden', hidden::text, true);
  perform set_config('rd.event_b', event_b::text, true);
  perform set_config('rd.claim_series', claim_series::text, true);
  perform set_config('rd.claim_moved', claim_moved::text, true);
end $$;

create function pg_temp.id(_name text) returns uuid language sql stable as $$
  select current_setting('rd.' || _name)::uuid;
$$;

-- Runs one statement as a signed-in person (or nobody, for null) and returns
-- how many rows it wrote, or the SQLSTATE.
create function pg_temp.wrote(_who text, _sql text) returns text language plpgsql as $$
declare n bigint; out text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    case when _who is null then '' else json_build_object('sub', current_setting('rd.' || _who))::text end, true);
  perform set_config('request.headers', '{}', true);
  begin
    execute _sql;
    get diagnostics n = row_count;
    out := n::text;
  exception when others then
    out := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return out;
end $$;

-- One value a signed-in person reads, as text, or the SQLSTATE.
create function pg_temp.read_as(_who text, _sql text) returns text language plpgsql as $$
declare out text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rd.' || _who))::text, true);
  perform set_config('request.headers', '{}', true);
  begin
    execute _sql into out;
  exception when others then
    out := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return out;
end $$;

-- The dates a person's replies to an event sit on, as postgres.
create function pg_temp.dates_of(_who text, _event text) returns text language sql stable as $$
  select coalesce(string_agg(coalesce(r.occurrence_date::text, 'none') || ':' || r.status, ','
                             order by r.occurrence_date), '')
  from public.rsvps r
  where r.user_id = pg_temp.id(_who) and r.event_id = pg_temp.id(_event);
$$;

-- ── The key ─────────────────────────────────────────────────────────────────
select col_not_null('public', 'rsvps', 'occurrence_date', 'every reply names its date');
select col_is_unique('public', 'rsvps', array['event_id', 'user_id', 'occurrence_date'],
  'a person holds one reply per date of an event');
select is((select count(*)::int from pg_constraint where conrelid = 'public.rsvps'::regclass and contype = 'u'), 1,
  'and no other unique key: none per event');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.rsvps'::regclass and not tgisinternal), 0,
  'no trigger fills in a date');
select ok(to_regprocedure('public.event_reply_day(uuid, timestamptz)') is null, 'event_reply_day is gone');
select ok(pg_get_expr(d.adbin, d.adrelid) = 'app_current_org_id()',
  'org_id keeps its fail-closed default')
from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
where d.adrelid = 'public.rsvps'::regclass and a.attname = 'org_id';
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'rsvps'
            and policyname = 'org isolation' and permissive = 'RESTRICTIVE'), 1,
  'the restrictive isolation policy stays');
select fk_ok('public', 'rsvps', array['event_id', 'org_id'], 'public', 'events', array['id', 'org_id'],
  'the event FK stays composite');
select fk_ok('public', 'rsvps', array['user_id', 'org_id'], 'public', 'profiles', array['id', 'org_id'],
  'and so does the person FK');

-- ── A save that names no date, as PostgREST sends it ────────────────────────
select is(pg_temp.wrote('me', format(
    'insert into public.rsvps (event_id, user_id, status) values (%L, %L, ''yes'') '
    'on conflict (event_id, user_id) do update set event_id = excluded.event_id, '
    'user_id = excluded.user_id, status = excluded.status returning user_id',
    pg_temp.id('late'), current_setting('rd.me'))), '42P10',
  'the upsert of a build that sends no date fails: there is no key on (event_id, user_id)');
select is(pg_temp.wrote('me', format(
    'insert into public.rsvps (event_id, user_id, status) values (%L, %L, ''yes'') returning user_id',
    pg_temp.id('single'), current_setting('rd.me'))), '23502',
  'and an insert with no date is refused');
select is((select count(*)::int from public.rsvps where user_id = pg_temp.id('me') and event_id in (pg_temp.id('late'), pg_temp.id('single'))), 0,
  'neither saved a row');

-- ── rsvp_set ────────────────────────────────────────────────────────────────
create function pg_temp.set_sql(_event text, _date text, _status text default null) returns text language sql as $$
  select format('select public.rsvp_set(%L, %L, %L)', pg_temp.id(_event), _date::date, _status);
$$;

select is(pg_temp.wrote('me', pg_temp.set_sql('late', '2031-11-02', 'yes')), '1', 'rsvp_set saves a reply');
select is(pg_temp.dates_of('me', 'late'), '2031-11-02:yes', 'on the date it names');
select is(pg_temp.wrote('me', pg_temp.set_sql('late', '2031-11-09', 'no')), '1',
  'rsvp_set saves a reply to a second date');
select is(pg_temp.dates_of('me', 'late'), '2031-11-02:yes,2031-11-09:no', 'and both dates keep their reply: two rows');
select is(pg_temp.wrote('me', pg_temp.set_sql('late', '2031-11-02', 'maybe')), '1',
  'saving a date again changes its reply');
select is(pg_temp.dates_of('me', 'late'), '2031-11-02:maybe,2031-11-09:no', 'and leaves the other date alone');
select is(pg_temp.wrote('me', pg_temp.set_sql('late', '2031-11-23')), '1',
  'clearing a date with no reply succeeds');
select is(pg_temp.dates_of('me', 'late'), '2031-11-02:maybe,2031-11-09:no', 'and changes nothing');
select is(pg_temp.wrote('me', pg_temp.set_sql('late', '2031-11-02')), '1', 'clearing a date succeeds');
select is(pg_temp.dates_of('me', 'late'), '2031-11-09:no', 'and removes that date''s reply only');

select is(pg_temp.wrote('me', pg_temp.set_sql('late', '2031-11-16', 'yes')), '1',
  'rsvp_set saves a reply to a date edited on its own');
select is(pg_temp.dates_of('me', 'late'), '2031-11-09:no,2031-11-16:yes',
  'on the series and the day it stood on in the series');
select is(pg_temp.dates_of('me', 'moved'), '', 'and nothing on the edited date''s own row');
select is(pg_temp.wrote('me', pg_temp.set_sql('late', '2031-11-16')), '1', 'clearing the edited date succeeds');
select is(pg_temp.dates_of('me', 'late'), '2031-11-09:no', 'and removes its reply only');

select is(pg_temp.wrote('me', pg_temp.set_sql('single', '2031-07-04', 'yes')), '1',
  'rsvp_set saves a reply to a one-time event');
select is(pg_temp.dates_of('me', 'single'), '2031-07-04:yes', 'on its own day');
select is(pg_temp.wrote('me', pg_temp.set_sql('single', '2031-07-04')), '1', 'and clears it');
select is(pg_temp.dates_of('me', 'single'), '', 'leaving no row');

select is(pg_temp.wrote('me', pg_temp.set_sql('moved', '2031-11-16', 'yes')), '22023',
  'an edited date''s own id is refused: a reply names the series');
select is(pg_temp.wrote('me', format('select public.rsvp_set(%L, null, %L)', pg_temp.id('single'), 'yes')), '22023',
  'a reply with no date is refused');
select is(pg_temp.wrote('me', pg_temp.set_sql('single', '2031-07-04', 'perhaps')), '23514',
  'a status other than yes, no or maybe is refused');
select is(pg_temp.wrote(null, pg_temp.set_sql('single', '2031-07-04', 'yes')), '42501',
  'a caller with no signed-in person is refused');

-- ── Who can write and read a reply ──────────────────────────────────────────
select is(pg_temp.wrote('me', format(
    'insert into public.rsvps (event_id, user_id, status, occurrence_date) values (%L, %L, ''yes'', ''2031-07-04'')',
    pg_temp.id('single'), current_setting('rd.other'))), '42501',
  'a member cannot save a reply for another person');
select is((select count(*)::int from public.rsvps where user_id = pg_temp.id('other') and event_id = pg_temp.id('single')), 0,
  'and the other person has no reply');
select is(pg_temp.wrote('me', format(
    'update public.rsvps set status = ''no'' where user_id = %L', current_setting('rd.other'))), '0',
  'a member changes none of another person''s replies');
select is(pg_temp.wrote('me', format(
    'delete from public.rsvps where user_id = %L', current_setting('rd.other'))), '0',
  'and deletes none of them');
select is((select count(*)::int from public.rsvps where user_id = pg_temp.id('other')), 2,
  'so the other person keeps both their replies');
select is(pg_temp.wrote('me', pg_temp.set_sql('hidden', '2031-07-04', 'yes')), '42501',
  'rsvp_set refuses an event in a group the member is not in');
select is((select count(*)::int from public.rsvps where event_id = pg_temp.id('hidden')), 0,
  'and nothing is saved on it');
select is(pg_temp.wrote('me', pg_temp.set_sql('event_b', '2031-07-05', 'yes')), '42501',
  'rsvp_set refuses another church''s event');
select is(pg_temp.wrote('me', pg_temp.set_sql('event_b', '2031-07-05')), '42501',
  'and a clear of it');
select is((select count(*)::int from public.rsvps where org_id = pg_temp.id('org_b')), 1,
  'and another church''s replies are unchanged');
select is(pg_temp.read_as('me', 'select count(*)::text from public.rsvps where org_id = ' || quote_literal(current_setting('rd.org_b'))), '0',
  'a member reads none of another church''s replies');
select is(pg_temp.read_as('me', format('select count(*)::text from public.rsvps where event_id = %L', pg_temp.id('claim_series'))), '4',
  'and reads every reply, on every date, on their own group''s event');
select ok(not has_function_privilege('anon', 'public.rsvp_set(uuid, date, text)', 'execute'),
  'anon cannot run rsvp_set');
select ok(has_function_privilege('authenticated', 'public.rsvp_set(uuid, date, text)', 'execute'),
  'a signed-in person can run rsvp_set');

-- ── The reminder claim reads each date's replies ────────────────────────────
create function pg_temp.claimed(_date date, _reply text default null) returns text language plpgsql as $$
declare out text;
begin
  set local role service_role;
  select string_agg(split_part(c.email, '@', 1), ',' order by c.email) into out
  from public.event_reminder_claim(pg_temp.id('org_a'), pg_temp.id('claim_series'), _date,
                                   case when _reply is null then null else pg_temp.id(_reply) end) c
  where c.email like '%@reply-dates.example.test';
  reset role;
  return coalesce(out, '');
end $$;

select is(pg_temp.claimed('2031-03-05'), 'me', 'a date''s reminder goes to that date''s Yes');
select is(pg_temp.claimed('2031-03-19'), 'other', 'and to its Maybe, not to someone who answered only another date');
select is(pg_temp.claimed('2031-03-12', 'claim_moved'), 'me',
  'a date edited on its own is read from the series row on its series day: a Yes is in, a No is not');
select is(pg_temp.claimed('2031-03-26'), '', 'a date nobody answered goes to nobody');

select * from finish();
rollback;
