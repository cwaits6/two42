-- Fields nothing reads are gone, the drop of prayer_call_sessions kept every
-- event, and a church set up before the clean-up holds neither unused
-- setting. A new church's settings and branding are asserted in
-- tenancy_signup_provisioning_suite.sql and branding_rls_suite.sql.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/retired_fields_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select hasnt_column('public', 'lectures', 'thumbnail_url', 'lectures.thumbnail_url is dropped');
select hasnt_column('public', 'group_settings', c, format('group_settings.%s is dropped', c))
from unnest(array['weekly_zoom_url', 'zoom_meeting_time', 'weekly_prayer_call_url', 'weekly_prayer_call_time']) as c;
select hasnt_table('public', 'prayer_call_sessions', 'prayer_call_sessions is dropped');

-- The table's one link to events was its own (event_id, org_id, group_id)
-- FK with on delete set null (event_id). Replayed on a table holding that
-- FK and a row on every event: dropping it keeps every event.
do $$
declare
  _org uuid;
  _grp uuid;
  _cal uuid;
  _linked bigint;
  _before bigint;
begin
  _org := public.provision_organization('Retired Fields Org', 'owner@retired-fields.example.test');
  insert into public.groups (org_id, name) values (_org, 'Probe group') returning id into _grp;
  insert into public.event_calendars (org_id, group_id, name) values (_org, _grp, 'Probe group') returning id into _cal;
  insert into public.events (org_id, group_id, calendar_id, title, start_time)
    values (_org, _grp, _cal, 'Probe event', now());

  create table public.retired_fields_probe (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null,
    group_id uuid not null,
    event_id uuid,
    foreign key (event_id, org_id, group_id)
      references public.events (id, org_id, group_id) on delete set null (event_id)
  );
  insert into public.retired_fields_probe (org_id, group_id, event_id)
    select org_id, group_id, id from public.events;
  select count(*) into _linked from public.retired_fields_probe;
  select count(*) into _before from public.events;
  drop table public.retired_fields_probe;

  perform set_config('rf.linked', _linked::text, true);
  perform set_config('rf.events_before', _before::text, true);
  perform set_config('rf.events_after', (select count(*) from public.events)::text, true);
end $$;

select ok(current_setting('rf.linked')::int >= 1, 'non-vacuity: the dropped table held a row on every event');
select is(current_setting('rf.linked'), current_setting('rf.events_before'), 'every event was linked');
select is(current_setting('rf.events_after'), current_setting('rf.events_before'),
  'dropping the table deletes no event');

-- The oldest church is created by 20260730010000_org_spine.sql and got both
-- removed values from earlier migrations, so it is a church set up before
-- the clean-up wherever the migrations run.
do $$
begin
  perform set_config('rf.oldest',
    (select id::text from public.organizations order by created_at, id limit 1), true);
end $$;

select is(
  (select count(*)::int from public.site_settings
    where org_id = current_setting('rf.oldest')::uuid and key = 'giving_dashboard_tile'),
  0, 'the church set up before the clean-up has no giving_dashboard_tile row');
select is(
  (select count(*)::int from public.site_settings
    where org_id = current_setting('rf.oldest')::uuid and key = 'giving_manage_mode'),
  1, 'its giving_manage_mode row stays');
select is(
  (select count(*)::int from public.organizations
    where id = current_setting('rf.oldest')::uuid and branding ? 'logo_url'),
  0, 'its branding has no logo_url key');
select is(
  (select count(*)::int from public.site_settings where key = 'giving_dashboard_tile'),
  0, 'no church has a giving_dashboard_tile row');

select * from finish();
rollback;
