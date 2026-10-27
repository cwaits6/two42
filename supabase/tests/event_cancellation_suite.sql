-- A cancelled date of a repeating event is an exception row with
-- is_cancelled = true. This suite proves the column's contract: it defaults
-- to false, it can only be set on an exception row of a series, and it goes
-- with the series when the series is deleted.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/event_cancellation_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

do $$
declare
  org uuid;
  grp uuid;
  series uuid;
begin
  insert into public.organizations (name, branding, status)
    values ('Cancellation Suite Org', '{}'::jsonb, 'active')
    returning id into org;
  insert into public.groups (org_id, name) values (org, 'Cancellation group') returning id into grp;
  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode)
    values (org, grp, 'Weekly', '2026-11-03 19:00+00', 'weekly', 'never')
    returning id into series;
  perform set_config('cancel_suite.org', org::text, true);
  perform set_config('cancel_suite.group', grp::text, true);
  perform set_config('cancel_suite.series', series::text, true);
end $$;

select is(
  (select is_cancelled from public.events where id = current_setting('cancel_suite.series')::uuid),
  false,
  'a new event row is not cancelled'
);

select throws_ok(
  $$ insert into public.events (org_id, group_id, title, start_time, is_cancelled)
     values (current_setting('cancel_suite.org')::uuid, current_setting('cancel_suite.group')::uuid,
             'One-off', '2026-11-10 19:00+00', true) $$,
  '23514',
  null,
  'a one-off event cannot be cancelled; it is deleted'
);

select throws_ok(
  $$ insert into public.events (org_id, group_id, title, start_time, series_id, is_cancelled)
     values (current_setting('cancel_suite.org')::uuid, current_setting('cancel_suite.group')::uuid,
             'Weekly', '2026-11-10 19:00+00', current_setting('cancel_suite.series')::uuid, true) $$,
  '23514',
  null,
  'a cancelled row must name the series date it removes'
);

select lives_ok(
  $$ insert into public.events (org_id, group_id, title, start_time, series_id, series_occurrence_date, is_cancelled)
     values (current_setting('cancel_suite.org')::uuid, current_setting('cancel_suite.group')::uuid,
             'Weekly', '2026-11-10 19:00+00', current_setting('cancel_suite.series')::uuid,
             '2026-11-10 19:00+00', true) $$,
  'an exception row of a series can be cancelled'
);

select is(
  (select count(*)::int from public.events
     where series_id = current_setting('cancel_suite.series')::uuid and is_cancelled),
  1,
  'the cancelled date is stored as one exception row of the series'
);

delete from public.events where id = current_setting('cancel_suite.series')::uuid;

select is(
  (select count(*)::int from public.events
     where series_id = current_setting('cancel_suite.series')::uuid),
  0,
  'deleting the series takes its cancelled dates with it'
);

select * from finish();
rollback;
