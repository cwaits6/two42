-- A church always keeps at least one church admin. The profiles UPDATE
-- policy's admin arm lets an admin change any role in their org, their own
-- included, so without this the last admin could demote themselves and lock
-- the church out of every admin page.
--
-- The lock is a transaction-scoped advisory lock keyed on the org, not
-- SELECT ... FOR UPDATE on the other admin rows: each demotion already holds
-- its own row's lock when the trigger fires, so two admins demoting each
-- other would each wait on the other's row and one would die as a deadlock.
-- Serialized on the org instead, the second demotion counts with a fresh
-- snapshot, sees the first one committed, and gets the plain refusal.
--
-- SECURITY INVOKER: an authenticated caller only reaches the role UPDATE
-- through the admin arm, and an admin reads every profile in their org.
-- Deletes come only from service-role and auth cascades, which bypass RLS.
-- Deleting the organization cascades to its profiles; with the org row
-- already gone there is no church left to protect, so that delete passes.
--
-- Error contract addition:
--   CA001  the change would leave the church with no church admin

create function public.profiles_keep_one_church_admin() returns trigger
  language plpgsql set search_path = ''
as $$
declare
  _result public.profiles := case when tg_op = 'DELETE' then old else new end;
begin
  if old.role <> 'admin' or _result.role = 'admin' and tg_op = 'UPDATE' then
    return _result;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('public.profiles:church_admin'), hashtext(old.org_id::text));

  if tg_op = 'DELETE'
     and not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return _result;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.org_id = old.org_id
      and p.role = 'admin'
      and p.id <> old.id
  ) then
    raise exception 'profiles: a church needs at least one church admin'
      using errcode = 'CA001';
  end if;

  return _result;
end $$;
revoke execute on function public.profiles_keep_one_church_admin() from public, anon, authenticated;

comment on function public.profiles_keep_one_church_admin() is
  'Trigger function on profiles: refuses a role change or delete that would leave the row''s org with no church admin. Serializes on a per-org advisory lock so concurrent demotions cannot both commit. SECURITY INVOKER; raises CA001.';

create trigger profiles_keep_one_church_admin
  before update of role or delete on public.profiles
  for each row execute function public.profiles_keep_one_church_admin();
