-- Regression guard for the site_settings RLS policies added in
-- 20260725000000_site_settings_is_public.sql (issue #215).
--
-- Plain-SQL smoke test — no pgTAP dependency, since the repo has no test
-- runner installed. Run against the local Supabase stack:
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/site_settings_rls.sql
--
-- Fails loudly (raises an exception) if a future migration reopens the
-- anon-read hole this PR closed, or exposes a non-public key.

begin;

do $$
declare
  anon_public_count bigint;
  anon_private_count bigint;
  member_private_count bigint;
  admin_id uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  -- anon (no JWT) resolves no org at all, so it reads nothing — not even a
  -- row marked is_public, and whatever x-two42-org header it sends.
  set local role anon;
  reset request.jwt.claims;
  perform set_config('request.headers', '{}', true);

  select count(*) into anon_public_count
    from public.site_settings where key = 'site_name';
  if anon_public_count <> 0 then
    raise exception 'anon with no org header should read nothing (fail-closed), got % rows', anon_public_count;
  end if;

  perform set_config('request.headers', json_build_object('x-two42-org', 'default')::text, true);

  select count(*) into anon_public_count
    from public.site_settings where key = 'site_name';
  if anon_public_count <> 0 then
    raise exception 'anon with an x-two42-org header should still read nothing (no header path remains), got % rows', anon_public_count;
  end if;

  select count(*) into anon_private_count
    from public.site_settings
    where key in ('giving_manage_mode', 'giving_dashboard_tile');
  if anon_private_count <> 0 then
    raise exception 'anon should NOT read private settings, got % rows', anon_private_count;
  end if;

  -- a logged-in member (seeded admin profile) can still read everything
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id)::text, true);

  select count(*) into member_private_count
    from public.site_settings
    where key in ('giving_manage_mode', 'giving_dashboard_tile');
  if member_private_count <> 2 then
    raise exception 'member should read all private settings via is_member(), got % of 2 rows', member_private_count;
  end if;

  reset role;
  raise notice 'site_settings RLS smoke test passed';
end $$;

rollback;
