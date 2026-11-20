-- One first-admin invite per email: access_requests_one_founding_admin
-- refuses a second approved founding request across churches, and
-- provision_organization() answers it with TN005. A concurrent second call
-- waits on the first's uncommitted index entry and takes that same path.
-- Retry after a failed send and Resend invite update the one founding row,
-- so the index never refuses them.
--
-- Run locally (rollback-safe):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/first_admin_invite_once_suite.sql

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Fixtures ────────────────────────────────────────────────────────────────
do $$
begin
  perform set_config('fi.org_a',
    public.provision_organization('First Invite Once A', 'Owner@first-invite-once.example.test')::text, true);
  perform set_config('fi.org_b',
    public.provision_organization('First Invite Once B', 'other@first-invite-once.example.test')::text, true);
end $$;

create temp table fi_founding as
  select id from public.access_requests
  where org_id = current_setting('fi.org_a')::uuid and approved_role = 'admin';

-- ── The rule ────────────────────────────────────────────────────────────────

select has_index('public', 'access_requests', 'access_requests_one_founding_admin',
  'access_requests has the one-founding-admin index');

select ok(
  (select indisunique from pg_index where indexrelid = 'public.access_requests_one_founding_admin'::regclass),
  'the founding-admin index is unique');

select ok(
  (select indexdef like '%lower(email)%'
          and indexdef like '%approved_role = ''admin''%'
          and indexdef like '%status = ''approved''%'
   from pg_indexes where indexname = 'access_requests_one_founding_admin'),
  'the index keys lower(email) over approved founding requests only');

select throws_ok(
  format($$insert into public.access_requests (org_id, name, email, status, approved_role)
           values (%L, 'dup', 'owner@first-invite-once.example.test', 'approved', 'admin')$$,
         current_setting('fi.org_b')),
  '23505', null,
  'a second approved founding request for the same email in another church is refused, whatever its case');

select throws_ok(
  $$select public.provision_organization('First Invite Once Dup', 'OWNER@first-invite-once.example.test')$$,
  'TN005', null,
  'adding a church again for the same first admin raises TN005');

select is(
  (select count(*)::int from public.organizations where name = 'First Invite Once Dup'),
  0,
  'the refused church is not created');

select is(
  (select count(*)::int from public.access_requests
   where lower(email) = 'owner@first-invite-once.example.test'),
  1,
  'the first admin still has exactly one founding request');

-- ── Retry after a failed send, and Resend invite ────────────────────────────
-- The same three writes sendFirstAdminInvite() makes: mint, roll back on a
-- failed send, mint again.

select lives_ok(
  $$update public.access_requests
    set status = 'approved', signup_token = 'fi-token-1', token_expires_at = now() + interval '7 days'
    where id = (select id from fi_founding)$$,
  'the first send mints a token on the founding request');

select lives_ok(
  $$update public.access_requests
    set signup_token = null, token_expires_at = null
    where id = (select id from fi_founding) and signup_token = 'fi-token-1'$$,
  'a failed send rolls the token back');

select lives_ok(
  $$update public.access_requests
    set status = 'approved', signup_token = 'fi-token-2', token_expires_at = now() + interval '7 days'
    where id = (select id from fi_founding)$$,
  'a retry after the failed send mints a new token');

select lives_ok(
  $$update public.access_requests
    set status = 'approved', signup_token = 'fi-token-3', token_expires_at = now() + interval '7 days'
    where id = (select id from fi_founding)$$,
  'Resend invite mints a token again');

select results_eq(
  $$select signup_token from public.access_requests
    where lower(email) = 'owner@first-invite-once.example.test'
      and approved_role = 'admin' and status = 'approved'$$,
  $$values ('fi-token-3'::text)$$,
  'retry and resend leave one approved founding request holding the latest token');

-- ── Other churches and member requests ──────────────────────────────────────

select is(
  (select status from public.access_requests
   where org_id = current_setting('fi.org_b')::uuid and approved_role = 'admin'),
  'approved',
  'another church''s founding request is untouched');

select lives_ok(
  format($$insert into public.access_requests (org_id, name, email, status, approved_role)
           values (%L, 'member a', 'member@first-invite-once.example.test', 'approved', 'member'),
                  (%L, 'member b', 'member@first-invite-once.example.test', 'approved', null)$$,
         current_setting('fi.org_a'), current_setting('fi.org_b')),
  'member requests for one email in two churches are not founding requests and are not refused');

select lives_ok(
  $$select public.provision_organization('First Invite Once C', 'third@first-invite-once.example.test')$$,
  'a church for a different first admin is added');

-- ── A denied founding request ───────────────────────────────────────────────

update public.access_requests set status = 'denied' where id = (select id from fi_founding);

select lives_ok(
  $$select public.provision_organization('First Invite Once D', 'owner@first-invite-once.example.test')$$,
  'a first admin whose founding request was denied can found another church');

select throws_ok(
  $$update public.access_requests set status = 'approved' where id = (select id from fi_founding)$$,
  '23505', null,
  'the denied founding request cannot be approved again while another church''s is approved');

-- ── TN004 still comes first ─────────────────────────────────────────────────

insert into auth.users (id, email)
values (gen_random_uuid(), 'other@first-invite-once.example.test');

select throws_ok(
  $$select public.provision_organization('First Invite Once E', 'other@first-invite-once.example.test')$$,
  'TN004', null,
  'an email with a profile and a founding request elsewhere raises TN004');

select * from finish();
rollback;
