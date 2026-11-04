-- The serving reminder sent record: the two tables no client can reach, the
-- claim the hourly job makes before it mails anyone, the pass that fixes a
-- day's recipients, the cut-over from the daily job, and the cron entries.
--
-- Run locally through the shared stack's container (never `supabase test db`):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/serving_reminder_record_suite.sql

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
  isaac uuid := gen_random_uuid();
  pending uuid := gen_random_uuid();
  grp uuid;
  team uuid;
  team_open uuid;
  team_b uuid;
  signup uuid;
  sunday date := current_date + (7 - extract(dow from current_date)::int);
begin
  org_a := public.provision_organization('Reminder Org A', 'owner-a@reminder.example.test');
  org_b := public.provision_organization('Reminder Org B', 'owner-b@reminder.example.test');
  update public.organizations set timezone = 'America/Chicago' where id = org_a;
  update public.organizations set timezone = 'Pacific/Auckland' where id = org_b;

  insert into public.access_requests (org_id, name, email, status) values
    (org_a, 'Henry', 'henry@reminder.example.test', 'approved'),
    (org_a, 'Chloe', 'chloe@reminder.example.test', 'approved'),
    (org_a, 'Isaac', 'isaac@reminder.example.test', 'approved'),
    (org_a, 'Pending', 'pending@reminder.example.test', 'approved');
  insert into auth.users (id, email) values
    (owner_b, 'owner-b@reminder.example.test'),
    (henry, 'henry@reminder.example.test'),
    (chloe, 'chloe@reminder.example.test'),
    (isaac, 'isaac@reminder.example.test'),
    (pending, 'pending@reminder.example.test');
  update public.profiles set role = 'pending' where id = pending;

  insert into public.groups (org_id, name) values (org_a, 'group A') returning id into grp;
  insert into public.teams (org_id, group_id, name, is_serving_role)
    values (org_a, grp, 'Greeters', true) returning id into team;
  insert into public.teams (org_id, group_id, name, is_serving_role)
    values (org_a, grp, 'Ushers', true) returning id into team_open;
  insert into public.serving_team_settings (org_id, team_id, enabled) values
    (org_a, team, true), (org_a, team_open, true);
  insert into public.groups (org_id, name) values (org_b, 'group B') returning id into grp;
  insert into public.teams (org_id, group_id, name, is_serving_role)
    values (org_b, grp, 'Org B team', true) returning id into team_b;
  insert into public.serving_team_settings (org_id, team_id, enabled) values (org_b, team_b, true);

  insert into public.serving_signups (org_id, team_id, service_date, created_by)
    values (org_a, team, sunday, henry) returning id into signup;
  insert into public.serving_signup_attendees (org_id, signup_id, profile_id) values
    (org_a, signup, henry), (org_a, signup, chloe), (org_a, signup, pending);

  perform set_config('rr.org_a', org_a::text, true);
  perform set_config('rr.org_b', org_b::text, true);
  perform set_config('rr.team', team::text, true);
  perform set_config('rr.team_open', team_open::text, true);
  perform set_config('rr.team_b', team_b::text, true);
  perform set_config('rr.signup', signup::text, true);
  perform set_config('rr.henry', henry::text, true);
  perform set_config('rr.chloe', chloe::text, true);
  perform set_config('rr.isaac', isaac::text, true);
  perform set_config('rr.sunday', sunday::text, true);
  perform set_config('rr.today', current_date::text, true);
end $$;

-- The people a claim returns, by first-name order, or the SQLSTATE.
create function pg_temp.claim(_org text, _teams text[]) returns text language plpgsql as $$
declare out text;
begin
  set local role service_role;
  begin
    select coalesce(string_agg(who, ',' order by who), '-')
    into out
    from (
      select case c.profile_id
        when current_setting('rr.henry')::uuid then 'henry'
        when current_setting('rr.chloe')::uuid then 'chloe'
        when current_setting('rr.isaac')::uuid then 'isaac'
        else 'other' end as who
      from public.serving_reminder_claim(
        current_setting(_org)::uuid,
        current_setting('rr.today')::date,
        current_setting('rr.sunday')::date,
        (select array_agg(current_setting(t)::uuid) from unnest(_teams) as t)) c
    ) named;
  exception when others then
    out := sqlstate;
  end;
  set local role none;
  return out;
end $$;

create function pg_temp.sends(_team text) returns text language sql stable as $$
  select coalesce(string_agg(state, ',' order by state), '-')
  from (
    select case s.profile_id
        when current_setting('rr.henry')::uuid then 'henry'
        when current_setting('rr.chloe')::uuid then 'chloe'
        when current_setting('rr.isaac')::uuid then 'isaac'
        else 'other' end
      || ':' || case when s.sent_at is not null then 'sent' when s.claimed_at is not null then 'claimed' else 'open' end as state
    from public.serving_reminder_sends s
    where s.team_id = current_setting(_team)::uuid and s.send_date = current_setting('rr.today')::date
  ) named;
$$;

-- ── Tables no client can reach ──────────────────────────────────────────────
select has_table('public', 'serving_reminder_passes', 'serving_reminder_passes exists');
select has_table('public', 'serving_reminder_sends', 'serving_reminder_sends exists');
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'serving_reminder_passes')
  and (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'serving_reminder_sends'),
  'row security is on for both');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public'
    and tablename in ('serving_reminder_passes', 'serving_reminder_sends') and permissive = 'PERMISSIVE'),
  0, 'neither table has a permissive policy: no client reads or writes the sent record');
select ok(
  not has_table_privilege('authenticated', 'public.serving_reminder_passes', 'select')
  and not has_table_privilege('anon', 'public.serving_reminder_passes', 'select')
  and not has_table_privilege('authenticated', 'public.serving_reminder_sends', 'select')
  and not has_table_privilege('anon', 'public.serving_reminder_sends', 'select'),
  'anon and authenticated hold no privilege on the sent record');
select ok(has_table_privilege('service_role', 'public.serving_reminder_sends', 'update'),
  'service_role settles sends');

select isnt_definer('public', 'serving_reminder_claim', array['uuid', 'date', 'date', 'uuid[]'],
  'serving_reminder_claim is SECURITY INVOKER: it runs as the service key, which is its only caller');
select ok(
  not has_function_privilege('anon', 'public.serving_reminder_claim(uuid,date,date,uuid[])', 'execute')
  and not has_function_privilege('authenticated', 'public.serving_reminder_claim(uuid,date,date,uuid[])', 'execute')
  and has_function_privilege('service_role', 'public.serving_reminder_claim(uuid,date,date,uuid[])', 'execute'),
  'only service_role may execute serving_reminder_claim');

-- ── The first pass fixes who the day's reminder goes to ─────────────────────
select is(pg_temp.claim('rr.org_a', array['rr.team', 'rr.team_open']), 'chloe,henry',
  'the first claim returns the attendees with an email who are not pending');
select is(
  (select count(*)::int from public.serving_reminder_passes
    where team_id in (current_setting('rr.team')::uuid, current_setting('rr.team_open')::uuid)
      and send_date = current_setting('rr.today')::date),
  2, 'both teams have a pass for today, the open date too');
select is(pg_temp.sends('rr.team'), 'chloe:claimed,henry:claimed', 'both sends are claimed');
select is(pg_temp.sends('rr.team_open'), '-', 'an open date has a pass with nothing to send');

select is(pg_temp.claim('rr.org_a', array['rr.team', 'rr.team_open']), '-',
  'a second claim right after returns nothing: the first firing holds them');

-- Isaac signs up later the same day, and someone takes the open date.
do $$
begin
  insert into public.serving_signup_attendees (org_id, signup_id, profile_id)
    values (current_setting('rr.org_a')::uuid, current_setting('rr.signup')::uuid, current_setting('rr.isaac')::uuid);
  insert into public.serving_signups (org_id, team_id, service_date, created_by)
    values (current_setting('rr.org_a')::uuid, current_setting('rr.team_open')::uuid,
            current_setting('rr.sunday')::date, current_setting('rr.isaac')::uuid);
  insert into public.serving_signup_attendees (org_id, signup_id, profile_id)
    select org_id, id, created_by from public.serving_signups
    where team_id = current_setting('rr.team_open')::uuid and service_date = current_setting('rr.sunday')::date;
end $$;

-- Henry's send settles; Chloe's is released, as a refused send would be.
update public.serving_reminder_sends set sent_at = now()
  where team_id = current_setting('rr.team')::uuid and profile_id = current_setting('rr.henry')::uuid;
update public.serving_reminder_sends set claimed_at = null
  where team_id = current_setting('rr.team')::uuid and profile_id = current_setting('rr.chloe')::uuid;

select is(pg_temp.claim('rr.org_a', array['rr.team', 'rr.team_open']), 'chloe',
  'a later claim returns the released send only: Isaac signed up after the pass and the taken open date stays handled');
select is(pg_temp.sends('rr.team'), 'chloe:claimed,henry:sent', 'Henry stays sent, Chloe is claimed again');
select is(pg_temp.sends('rr.team_open'), '-', 'the open date''s pass still sends nothing');

-- A claim a crashed firing never settled goes stale and is claimed again.
update public.serving_reminder_sends set claimed_at = now() - interval '9 minutes'
  where team_id = current_setting('rr.team')::uuid and profile_id = current_setting('rr.chloe')::uuid;
select is(pg_temp.claim('rr.org_a', array['rr.team']), '-', 'a claim nine minutes old is still held');
update public.serving_reminder_sends set claimed_at = now() - interval '11 minutes'
  where team_id = current_setting('rr.team')::uuid and profile_id = current_setting('rr.chloe')::uuid;
select is(pg_temp.claim('rr.org_a', array['rr.team']), 'chloe', 'a claim older than ten minutes is claimed again');

-- ── Tenant boundary ─────────────────────────────────────────────────────────
select is(pg_temp.claim('rr.org_a', array['rr.team_b']), 'SR001',
  'a team from another church is refused');
select is(
  (select count(*)::int from public.serving_reminder_passes where team_id = current_setting('rr.team_b')::uuid),
  0, 'and no pass was written for it');
select is(pg_temp.claim('rr.org_b', array['rr.team', 'rr.team_b']), 'SR001',
  'one wrong team refuses the whole call');

-- ── A person's rows go with the person ──────────────────────────────────────
delete from auth.users where id = current_setting('rr.chloe')::uuid;
select is(pg_temp.sends('rr.team'), 'henry:sent', 'deleting Chloe removes her send and leaves Henry''s');

-- ── Cut-over from the daily job ─────────────────────────────────────────────
delete from public.serving_reminder_passes where org_id in (current_setting('rr.org_a')::uuid, current_setting('rr.org_b')::uuid);
select is(private.serving_reminder_cutover('2026-11-05T14:59:00Z'), 0,
  'before the daily job''s 15:00 UTC firing, no pass is written and the hourly job sends the day itself');
select is(
  (select count(*)::int from public.serving_reminder_passes
    where org_id in (current_setting('rr.org_a')::uuid, current_setting('rr.org_b')::uuid)),
  0, 'no pass for either church');
select ok(private.serving_reminder_cutover('2026-11-05T15:01:00Z') >= 3,
  'after the firing, every enabled team gets a pass for the local date it sent on');
select is(
  (select string_agg(send_date::text, ',' order by send_date) from public.serving_reminder_passes
    where team_id in (current_setting('rr.team')::uuid, current_setting('rr.team_b')::uuid)),
  '2026-11-05,2026-11-06',
  'Chicago''s date was November 5 and Auckland''s already November 6 at that firing');
select is(private.serving_reminder_cutover('2026-11-05T15:01:00Z'), 0,
  'running it again writes nothing more');

-- ── The cron entries ────────────────────────────────────────────────────────
select is((select schedule from cron.job where jobname = 'send-serving-reminders-hourly'), '0 * * * *',
  'the serving reminders fire every hour');
select ok(
  (select command like '%"mode": "hourly"%' and command like '%timeout_milliseconds := 120000%'
    from cron.job where jobname = 'send-serving-reminders-hourly'),
  'the hourly job posts its mode and waits long enough for the run');
select is((select count(*)::int from cron.job where jobname = 'send-serving-reminders-daily'), 0,
  'the daily serving job is gone');

select * from finish();
rollback;
