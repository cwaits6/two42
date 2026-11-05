-- Event reminder choices and the sent record: who can change the event's
-- choice, the group's settings and a person's own setting (by row count,
-- since a write a policy filters out reports success); who a date's
-- reminder goes to; the claim the job makes before it mails anyone; the
-- nightly cleanup's bounded delete; and the cut-over from the job that kept
-- no record.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/event_reminder_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

do $$
declare
  org_a uuid;
  org_b uuid;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  admin_a uuid := gen_random_uuid();
  leader_2 uuid := gen_random_uuid();
  yes uuid := gen_random_uuid();
  maybe uuid := gen_random_uuid();
  nope uuid := gen_random_uuid();
  silent uuid := gen_random_uuid();
  gone uuid := gen_random_uuid();
  pending uuid := gen_random_uuid();
  noemail uuid := gen_random_uuid();
  optout uuid := gen_random_uuid();
  quiet uuid := gen_random_uuid();
  late uuid := gen_random_uuid();
  grp uuid;
  grp_2 uuid;
  grp_b uuid;
  fam uuid;
  series uuid;
  moved uuid;
  other_moved uuid;
  single uuid;
  event_b uuid;
begin
  org_a := public.provision_organization('Event Reminder Org A', 'owner-a@event-reminder.example.test');
  org_b := public.provision_organization('Event Reminder Org B', 'owner-b@event-reminder.example.test');
  update public.organizations set timezone = 'America/Chicago' where id = org_a;
  update public.organizations set timezone = 'Pacific/Auckland' where id = org_b;

  insert into public.access_requests (org_id, name, email, status)
  select org_a, who, who || '@event-reminder.example.test', 'approved'
  from unnest(array['admin-a', 'leader-2', 'yes', 'maybe', 'nope', 'silent', 'gone', 'pending',
                    'noemail', 'optout', 'quiet', 'late']) as who;
  insert into auth.users (id, email) values
    (owner_a, 'owner-a@event-reminder.example.test'),
    (owner_b, 'owner-b@event-reminder.example.test'),
    (admin_a, 'admin-a@event-reminder.example.test'),
    (leader_2, 'leader-2@event-reminder.example.test'),
    (yes, 'yes@event-reminder.example.test'),
    (maybe, 'maybe@event-reminder.example.test'),
    (nope, 'nope@event-reminder.example.test'),
    (silent, 'silent@event-reminder.example.test'),
    (gone, 'gone@event-reminder.example.test'),
    (pending, 'pending@event-reminder.example.test'),
    (noemail, 'noemail@event-reminder.example.test'),
    (optout, 'optout@event-reminder.example.test'),
    (quiet, 'quiet@event-reminder.example.test'),
    (late, 'late@event-reminder.example.test');
  update public.profiles set role = 'admin' where id = admin_a;
  update public.profiles set role = 'pending' where id = pending;
  update public.profiles set email = null where id = noemail;
  update public.profiles set email_event_reminders = false where id = optout;
  update public.profiles set email_announcements = false where id = quiet;

  -- yes and maybe share a household that yes manages.
  insert into public.family_units (org_id, family_name) values (org_a, 'Household') returning id into fam;
  update public.profiles set family_id = fam, relationship = 'primary' where id = yes;
  update public.profiles set family_id = fam, relationship = 'spouse' where id = maybe;

  insert into public.groups (org_id, name) values (org_a, 'group one') returning id into grp;
  insert into public.groups (org_id, name) values (org_a, 'group two') returning id into grp_2;
  insert into public.groups (org_id, name) values (org_b, 'group B') returning id into grp_b;
  insert into public.group_members (org_id, group_id, profile_id, role) values
    (org_a, grp, owner_a, 'leader'),
    (org_a, grp_2, leader_2, 'leader'),
    (org_b, grp_b, owner_b, 'leader');
  insert into public.group_members (org_id, group_id, profile_id)
  select org_a, grp, id
  from unnest(array[yes, maybe, nope, silent, pending, noemail, optout, quiet, late]) as id;

  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode, reminder_days_before)
    values (org_a, grp, 'Weekly', '2031-03-05 19:00-06', 'weekly', 'never', 2) returning id into series;
  insert into public.events (org_id, group_id, title, start_time, series_id, series_occurrence_date)
    values (org_a, grp, 'Weekly, moved', '2031-03-13 18:00-05', series, '2031-03-12 19:00-05') returning id into moved;
  insert into public.events (org_id, group_id, title, start_time) values (org_a, grp, 'Single', '2031-03-07 09:00-06')
    returning id into single;
  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode)
    values (org_a, grp_2, 'Other weekly', '2031-03-05 19:00-06', 'weekly', 'never');
  insert into public.events (org_id, group_id, title, start_time, series_id, series_occurrence_date)
    select org_a, grp_2, 'Other moved', '2031-03-13 18:00-05', id, '2031-03-12 19:00-05'
    from public.events where title = 'Other weekly' and org_id = org_a
    returning id into other_moved;
  insert into public.events (org_id, group_id, title, start_time) values (org_b, grp_b, 'Org B event', '2031-03-07 09:00-06')
    returning id into event_b;

  -- Replies to the series. gone replied Yes and then left the group.
  insert into public.rsvps (org_id, event_id, user_id, status) values
    (org_a, series, yes, 'yes'),
    (org_a, series, maybe, 'maybe'),
    (org_a, series, nope, 'no'),
    (org_a, series, gone, 'yes'),
    (org_a, series, pending, 'yes'),
    (org_a, series, noemail, 'yes'),
    (org_a, series, optout, 'yes'),
    (org_a, series, quiet, 'yes');
  -- Replies on the moved date: yes can't make it, nope can, silent might.
  insert into public.rsvps (org_id, event_id, user_id, status) values
    (org_a, moved, yes, 'no'),
    (org_a, moved, nope, 'yes'),
    (org_a, moved, silent, 'maybe');
  insert into public.rsvps (org_id, event_id, user_id, status) values (org_b, event_b, owner_b, 'yes');

  perform set_config('er.org_a', org_a::text, true);
  perform set_config('er.org_b', org_b::text, true);
  perform set_config('er.grp', grp::text, true);
  perform set_config('er.grp_2', grp_2::text, true);
  perform set_config('er.series', series::text, true);
  perform set_config('er.moved', moved::text, true);
  perform set_config('er.other_moved', other_moved::text, true);
  perform set_config('er.single', single::text, true);
  perform set_config('er.event_b', event_b::text, true);
  perform set_config('er.owner_a', owner_a::text, true);
  perform set_config('er.admin_a', admin_a::text, true);
  perform set_config('er.leader_2', leader_2::text, true);
  perform set_config('er.yes', yes::text, true);
  perform set_config('er.maybe', maybe::text, true);
  perform set_config('er.nope', nope::text, true);
  perform set_config('er.silent', silent::text, true);
  perform set_config('er.optout', optout::text, true);
  perform set_config('er.quiet', quiet::text, true);
  perform set_config('er.late', late::text, true);
end $$;

-- Runs one statement as a signed-in person and returns how many rows it
-- wrote, or the SQLSTATE.
create function pg_temp.wrote(_who text, _sql text) returns text language plpgsql as $$
declare n bigint; out text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting(_who))::text, true);
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

create function pg_temp.name_of(_profile uuid) returns text language sql stable as $$
  select coalesce(
    (select split_part(u.email, '@', 1) from auth.users u where u.id = _profile), 'deleted');
$$;

-- The people a claim returns, in name order, or the SQLSTATE.
create function pg_temp.claim(_org text, _event text, _date date, _reply text default null) returns text
language plpgsql as $$
declare ids uuid[]; failed text;
begin
  set local role service_role;
  begin
    select array_agg(c.profile_id) into ids
    from public.event_reminder_claim(
      current_setting(_org)::uuid, current_setting(_event)::uuid, _date,
      case when _reply is null then null else current_setting(_reply)::uuid end) c;
  exception when others then
    failed := sqlstate;
  end;
  reset role;
  return coalesce(failed,
    (select string_agg(pg_temp.name_of(id), ',' order by pg_temp.name_of(id)) from unnest(ids) as id), '-');
end $$;

create function pg_temp.sends(_event text, _date date) returns text language sql stable as $$
  select coalesce(string_agg(state, ',' order by state), '-')
  from (
    select pg_temp.name_of(s.profile_id) || ':'
      || case when s.sent_at is not null then 'sent' when s.claimed_at is not null then 'claimed' else 'open' end as state
    from public.event_reminder_sends s
    where s.event_id = current_setting(_event)::uuid and s.occurrence_date = _date
  ) named;
$$;

-- ── The columns ─────────────────────────────────────────────────────────────
select col_type_is('public', 'events', 'reminder_days_before', 'smallint', 'events.reminder_days_before is a smallint');
select col_not_null('public', 'events', 'reminder_days_before', 'and is NOT NULL');
select col_default_is('public', 'events', 'reminder_days_before', '1',
  'an event defaults to 1 day before, which is what every existing event did');
select col_default_is('public', 'group_settings', 'event_reminders_enabled', 'true', 'a group defaults to on');
select col_not_null('public', 'group_settings', 'event_reminders_enabled', 'and is NOT NULL');
select col_default_is('public', 'group_settings', 'event_reminder_default_days', '1',
  'a group''s default for new events starts at 1 day before');
select col_not_null('public', 'group_settings', 'event_reminder_default_days', 'and is NOT NULL');
select col_type_is('public', 'profiles', 'email_event_reminders', 'boolean', 'profiles.email_event_reminders is boolean');
select col_not_null('public', 'profiles', 'email_event_reminders', 'and is NOT NULL');
select col_default_is('public', 'profiles', 'email_event_reminders', 'true',
  'a person defaults to on, existing people included');
select is(
  (select reminder_days_before from public.events where id = current_setting('er.single')::uuid), 1::smallint,
  'an event inserted without the column sends 1 day before');

select lives_ok(
  $$ update public.events set reminder_days_before = 0 where id = current_setting('er.single')::uuid $$,
  'an event takes 0');
select lives_ok(
  $$ update public.events set reminder_days_before = 1 where id = current_setting('er.single')::uuid $$,
  'an event takes 1');
select lives_ok(
  $$ update public.events set reminder_days_before = 2 where id = current_setting('er.single')::uuid $$,
  'an event takes 2');
select lives_ok(
  $$ update public.events set reminder_days_before = 7 where id = current_setting('er.single')::uuid $$,
  'an event takes 7');
select throws_ok(
  $$ update public.events set reminder_days_before = 3 where id = current_setting('er.single')::uuid $$,
  '23514', null, 'an event refuses 3 days');
select throws_ok(
  $$ insert into public.group_settings (org_id, group_id, event_reminder_default_days)
     values (current_setting('er.org_a')::uuid, current_setting('er.grp_2')::uuid, 0) $$,
  '23514', null, 'a group''s default cannot be no reminder: off is its own switch');
select throws_ok(
  $$ insert into public.group_settings (org_id, group_id, event_reminder_default_days)
     values (current_setting('er.org_a')::uuid, current_setting('er.grp_2')::uuid, 3) $$,
  '23514', null, 'a group''s default refuses 3 days');
update public.events set reminder_days_before = 1 where id = current_setting('er.single')::uuid;

-- ── The event's choice: whoever can edit the event ──────────────────────────
select is(
  pg_temp.wrote('er.yes', $$ update public.events set reminder_days_before = 7 where id = current_setting('er.single')::uuid $$),
  '0', 'a member who is not a leader changes no row');
select is(
  pg_temp.wrote('er.leader_2', $$ update public.events set reminder_days_before = 7 where id = current_setting('er.single')::uuid $$),
  '0', 'a leader of another group changes no row');
select is(
  pg_temp.wrote('er.admin_a', $$ update public.events set reminder_days_before = 7 where id = current_setting('er.single')::uuid $$),
  '0', 'a church admin who does not lead the group changes no row');
select is(
  (select reminder_days_before from public.events where id = current_setting('er.single')::uuid), 1::smallint,
  'and the choice is unchanged');
select is(
  pg_temp.wrote('er.owner_a', $$ update public.events set reminder_days_before = 7 where id = current_setting('er.single')::uuid $$),
  '1', 'the group''s leader changes one row');
select is(
  (select reminder_days_before from public.events where id = current_setting('er.single')::uuid), 7::smallint,
  'and the choice is saved');

-- ── The group's settings: its leaders ───────────────────────────────────────
select is(
  pg_temp.wrote('er.yes', $$ insert into public.group_settings (group_id, event_reminders_enabled)
    values (current_setting('er.grp')::uuid, false) $$),
  '42501', 'a member who is not a leader cannot create the group''s settings');
select is(
  pg_temp.wrote('er.owner_a', $$ insert into public.group_settings (group_id, event_reminder_default_days)
    values (current_setting('er.grp')::uuid, 2) $$),
  '1', 'a leader sets the default for new events');
select is(
  pg_temp.wrote('er.yes', $$ update public.group_settings set event_reminders_enabled = false, event_reminder_default_days = 7
    where group_id = current_setting('er.grp')::uuid $$),
  '0', 'a member who is not a leader changes no row of them');
select is(
  pg_temp.wrote('er.leader_2', $$ update public.group_settings set event_reminders_enabled = false
    where group_id = current_setting('er.grp')::uuid $$),
  '0', 'nor does a leader of another group');
select is(
  (select event_reminders_enabled::text || ',' || event_reminder_default_days
     from public.group_settings where group_id = current_setting('er.grp')::uuid),
  'true,2', 'and the settings are unchanged');
select is(
  pg_temp.wrote('er.owner_a', $$ update public.group_settings set event_reminders_enabled = false
    where group_id = current_setting('er.grp')::uuid $$),
  '1', 'a leader turns the group''s reminders off');
select is(
  (select string_agg(title || '=' || reminder_days_before, ',' order by title) from public.events
    where group_id = current_setting('er.grp')::uuid and series_id is null),
  'Single=7,Weekly=2', 'turning a group off leaves each event''s choice saved');
update public.group_settings set event_reminders_enabled = true where group_id = current_setting('er.grp')::uuid;

-- ── A person's own setting ──────────────────────────────────────────────────
select is(
  pg_temp.wrote('er.maybe', $$ update public.profiles set email_event_reminders = false where id = current_setting('er.maybe')::uuid $$),
  '1', 'a person turns their own event reminders off');
select is(
  (select email_event_reminders::text || ',' || email_announcements from public.profiles where id = current_setting('er.maybe')::uuid),
  'false,true', 'which leaves their announcements setting alone');
select is(
  pg_temp.wrote('er.maybe', $$ update public.profiles set email_event_reminders = true where id = current_setting('er.maybe')::uuid $$),
  '1', 'and back on');
select is(
  pg_temp.wrote('er.admin_a', $$ update public.profiles set email_event_reminders = false where id = current_setting('er.maybe')::uuid $$),
  '42501', 'a church admin cannot change someone else''s');
select is(
  pg_temp.wrote('er.yes', $$ update public.profiles set email_event_reminders = false where id = current_setting('er.maybe')::uuid $$),
  '42501', 'nor can the manager of their household');
select is(
  pg_temp.wrote('er.nope', $$ update public.profiles set email_event_reminders = false where id = current_setting('er.maybe')::uuid $$),
  '0', 'someone with no say over the person changes no row');
select is(
  (select email_event_reminders from public.profiles where id = current_setting('er.maybe')::uuid), true,
  'and the setting is unchanged');
select is(
  pg_temp.wrote('er.admin_a', $$ update public.profiles set preferred_name = 'May', email_event_reminders = true
    where id = current_setting('er.maybe')::uuid $$),
  '1', 'a church admin still edits the rest of the row: the rule is on a change to the one column');
select is(
  pg_temp.wrote('er.yes', $$ update public.profiles set preferred_name = 'Mae' where id = current_setting('er.maybe')::uuid $$),
  '1', 'and so does the household''s manager');

-- ── Tables no client can reach ──────────────────────────────────────────────
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('event_reminder_passes', 'event_reminder_sends')),
  'row security is on for both tables of the sent record');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public'
    and tablename in ('event_reminder_passes', 'event_reminder_sends') and permissive = 'PERMISSIVE'),
  0, 'neither has a permissive policy: no client reads or writes the sent record');
select ok(
  not has_table_privilege('authenticated', 'public.event_reminder_passes', 'select')
  and not has_table_privilege('anon', 'public.event_reminder_passes', 'select')
  and not has_table_privilege('authenticated', 'public.event_reminder_sends', 'select')
  and not has_table_privilege('anon', 'public.event_reminder_sends', 'select'),
  'anon and authenticated hold no privilege on it');
select ok(has_table_privilege('service_role', 'public.event_reminder_sends', 'update'), 'service_role settles sends');

select isnt_definer('public', 'event_reminder_claim', array['uuid', 'uuid', 'date', 'uuid'],
  'event_reminder_claim is SECURITY INVOKER: it runs as the service key, which is its only caller');
select ok(
  not has_function_privilege('anon', 'public.event_reminder_claim(uuid,uuid,date,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.event_reminder_claim(uuid,uuid,date,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.event_reminder_claim(uuid,uuid,date,uuid)', 'execute'),
  'only service_role may execute event_reminder_claim');

-- ── Who a date's reminder goes to ───────────────────────────────────────────
select is(pg_temp.claim('er.org_a', 'er.series', '2031-03-05'), 'maybe,quiet,yes',
  'Yes and Maybe on the series, still in the group, not pending, with an email and the setting on; announcements off does not matter');
select is(pg_temp.sends('er.series', '2031-03-05'), 'maybe:claimed,quiet:claimed,yes:claimed',
  'No, no reply, left the group, pending, no email and the setting off have no send');

select is(pg_temp.claim('er.org_a', 'er.series', '2031-03-12', 'er.moved'), 'maybe,nope,quiet,silent',
  'a reply on a date edited on its own overrides the series reply for that person: a No drops a series Yes, a Yes or Maybe is enough on its own, and the rest keep their series reply');

select is(pg_temp.claim('er.org_a', 'er.series', '2031-03-05'), '-',
  'a second claim right after returns nothing: the first firing holds them');

-- late replies Yes after the pass started.
insert into public.rsvps (org_id, event_id, user_id, status)
  values (current_setting('er.org_a')::uuid, current_setting('er.series')::uuid, current_setting('er.late')::uuid, 'yes');

-- yes's send settles; maybe's is released, as a refused send would be.
update public.event_reminder_sends set sent_at = now()
  where event_id = current_setting('er.series')::uuid and occurrence_date = '2031-03-05'
    and profile_id = current_setting('er.yes')::uuid;
update public.event_reminder_sends set claimed_at = null
  where event_id = current_setting('er.series')::uuid and occurrence_date = '2031-03-05'
    and profile_id = current_setting('er.maybe')::uuid;

select is(pg_temp.claim('er.org_a', 'er.series', '2031-03-05'), 'maybe',
  'a later claim returns the released send only: a reply after the pass started is not added');
select is(pg_temp.sends('er.series', '2031-03-05'), 'maybe:claimed,quiet:claimed,yes:sent',
  'the sent one stays sent');
select is(pg_temp.claim('er.org_a', 'er.series', '2031-03-19'), 'late,maybe,quiet,yes',
  'the next date of the series has its own pass, and the late reply is in it');

-- A claim a crashed firing never settled goes stale and is claimed again.
update public.event_reminder_sends set claimed_at = now() - interval '9 minutes'
  where event_id = current_setting('er.series')::uuid and occurrence_date = '2031-03-05'
    and profile_id = current_setting('er.maybe')::uuid;
select is(pg_temp.claim('er.org_a', 'er.series', '2031-03-05'), '-', 'a claim nine minutes old is still held');
update public.event_reminder_sends set claimed_at = now() - interval '11 minutes'
  where event_id = current_setting('er.series')::uuid and occurrence_date = '2031-03-05'
    and profile_id = current_setting('er.maybe')::uuid;
select is(pg_temp.claim('er.org_a', 'er.series', '2031-03-05'), 'maybe', 'a claim older than ten minutes is claimed again');

-- Someone who turns the setting off between firings is not handed out.
update public.event_reminder_sends set claimed_at = null
  where event_id = current_setting('er.series')::uuid and occurrence_date = '2031-03-05';
update public.profiles set email_event_reminders = false where id = current_setting('er.quiet')::uuid;
select is(pg_temp.claim('er.org_a', 'er.series', '2031-03-05'), 'maybe',
  'a person who turned the setting off after the pass started is not mailed');
update public.profiles set email_event_reminders = true where id = current_setting('er.quiet')::uuid;

-- ── Tenant boundary ─────────────────────────────────────────────────────────
select is(pg_temp.claim('er.org_a', 'er.event_b', '2031-03-07'), 'ER001', 'an event from another church is refused');
select is(pg_temp.claim('er.org_b', 'er.series', '2031-03-05'), 'ER001', 'and so is this church''s event under another church''s id');
select is(
  (select count(*)::int from public.event_reminder_passes where event_id = current_setting('er.event_b')::uuid),
  0, 'and no pass was written');
select is(pg_temp.claim('er.org_a', 'er.series', '2031-03-26', 'er.other_moved'), 'ER001',
  'a reply row that is not a date of the series is refused');
select is(pg_temp.claim('er.org_a', 'er.series', '2031-03-26', 'er.single'), 'ER001',
  'and so is an event that is not a date of any series');
select is(
  (select count(*)::int from public.event_reminder_passes
    where event_id = current_setting('er.series')::uuid and occurrence_date = '2031-03-26'),
  0, 'neither wrote a pass');
select is(pg_temp.claim('er.org_b', 'er.event_b', '2031-03-07'), 'owner-b', 'the other church claims its own');

-- ── A person's rows go with the person, and a pass with its event ───────────
do $$
begin
  perform public.delete_person(
    _org_id => current_setting('er.org_a')::uuid, _person_id => current_setting('er.maybe')::uuid);
end $$;
select is(pg_temp.sends('er.series', '2031-03-05'), 'quiet:claimed,yes:sent',
  'deleting a person removes their sends and leaves the others''');
select is(
  (select count(*)::int from public.event_reminder_sends where profile_id = current_setting('er.maybe')::uuid),
  0, 'on every date');

delete from public.events where id = current_setting('er.series')::uuid;
select is(
  (select count(*)::int from public.event_reminder_passes where event_id = current_setting('er.series')::uuid)
  + (select count(*)::int from public.event_reminder_sends where event_id = current_setting('er.series')::uuid),
  0, 'deleting an event removes its passes and sends');

-- ── The nightly cleanup's bounded delete ────────────────────────────────────
select isnt_definer('public', 'event_reminder_passes_prune', array['uuid', 'date', 'integer'],
  'event_reminder_passes_prune is SECURITY INVOKER, like the claim');
select ok(
  not has_function_privilege('anon', 'public.event_reminder_passes_prune(uuid,date,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.event_reminder_passes_prune(uuid,date,integer)', 'execute')
  and has_function_privilege('service_role', 'public.event_reminder_passes_prune(uuid,date,integer)', 'execute'),
  'only service_role may execute event_reminder_passes_prune');

delete from public.event_reminder_passes where org_id in (current_setting('er.org_a')::uuid, current_setting('er.org_b')::uuid);
insert into public.event_reminder_passes (org_id, event_id, occurrence_date)
  select current_setting('er.org_a')::uuid, current_setting('er.single')::uuid, d::date
  from generate_series(date '2026-01-01', date '2026-01-05', interval '1 day') d;
insert into public.event_reminder_passes (org_id, event_id, occurrence_date)
  values (current_setting('er.org_b')::uuid, current_setting('er.event_b')::uuid, '2026-01-01');
insert into public.event_reminder_sends (org_id, event_id, occurrence_date, profile_id)
  values (current_setting('er.org_a')::uuid, current_setting('er.single')::uuid, '2026-01-01', current_setting('er.yes')::uuid);

create function pg_temp.prune(_org text, _before date, _limit integer) returns integer language plpgsql as $$
declare n integer;
begin
  set local role service_role;
  n := public.event_reminder_passes_prune(current_setting(_org)::uuid, _before, _limit);
  reset role;
  return n;
end $$;

select is(pg_temp.prune('er.org_a', '2026-01-05', 3), 3, 'one call deletes no more than its limit');
select is(
  (select string_agg(occurrence_date::text, ',' order by occurrence_date) from public.event_reminder_passes
    where org_id = current_setting('er.org_a')::uuid),
  '2026-01-04,2026-01-05', 'the oldest passes went first');
select is(
  (select count(*)::int from public.event_reminder_sends where org_id = current_setting('er.org_a')::uuid),
  0, 'a pass takes its sends with it');
select is(pg_temp.prune('er.org_a', '2026-01-05', 3), 1, 'the next call takes what is left before the date');
select is(pg_temp.prune('er.org_a', '2026-01-05', 3), 0, 'a pass on the date itself stays');
select is(
  (select count(*)::int from public.event_reminder_passes where org_id = current_setting('er.org_b')::uuid),
  1, 'another church''s pass, older than the date, is untouched');

-- ── Cut-over from the job that kept no record ───────────────────────────────
-- The 15:00 UTC firing mailed every row starting in the next 24 hours. Rows
-- here: a single event, a date edited on its own, and one deleted on its own.
do $$
declare
  org_a uuid := current_setting('er.org_a')::uuid;
  grp uuid := current_setting('er.grp')::uuid;
  weekly uuid;
begin
  delete from public.event_reminder_passes where org_id = org_a;
  update public.events set start_time = '2031-06-05 20:00-05' where id = current_setting('er.single')::uuid;
  insert into public.events (org_id, group_id, title, start_time, recurrence_frequency, recurrence_end_mode)
    values (org_a, grp, 'Cutover weekly', '2031-05-01 19:00-05', 'weekly', 'never') returning id into weekly;
  insert into public.events (org_id, group_id, title, start_time, series_id, series_occurrence_date)
    values (org_a, grp, 'Cutover moved', '2031-06-05 21:30-05', weekly, '2031-06-04 19:00-05');
  insert into public.events (org_id, group_id, title, start_time, series_id, series_occurrence_date, is_cancelled)
    values (org_a, grp, 'Cutover deleted', '2031-06-05 19:00-05', weekly, '2031-06-05 19:00-05', true);
  perform set_config('er.cutover_weekly', weekly::text, true);
end $$;

create function pg_temp.cutover_passes(_at timestamptz) returns text language plpgsql as $$
declare out text;
begin
  delete from public.event_reminder_passes where org_id = current_setting('er.org_a')::uuid;
  perform private.event_reminder_cutover(_at);
  select coalesce(string_agg(
      case p.event_id when current_setting('er.single')::uuid then 'single' else 'weekly' end
        || ' ' || p.occurrence_date, ',' order by p.occurrence_date, p.event_id), '-')
    into out
  from public.event_reminder_passes p
  where p.org_id = current_setting('er.org_a')::uuid;
  return out;
end $$;

select is(pg_temp.cutover_passes('2031-06-05T16:30:00Z'), 'weekly 2031-06-04,single 2031-06-05',
  'between the 15:00 and 17:00 firings: what the 15:00 one mailed is handled, the moved date under its series and the day it stood on, the deleted date not at all');
select is(pg_temp.cutover_passes('2031-06-05T14:59:00Z'), '-',
  'just before the firing, those dates are left to it');
select is(pg_temp.cutover_passes('2031-06-06T14:59:00Z'), 'weekly 2031-06-04,single 2031-06-05',
  'the next morning the same firing still counts');
select is(private.event_reminder_cutover('2031-06-05T16:30:00Z'), 0, 'running it again writes nothing more');
select is(pg_temp.sends('er.single', '2031-06-05'), '-', 'a cut-over pass has nothing to send');

select * from finish();
rollback;
