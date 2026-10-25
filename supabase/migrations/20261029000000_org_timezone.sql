-- One time zone per organization: every event time is entered and displayed
-- in it, never in the browser's or the server's zone.

-- ── 1. The column ─────────────────────────────────────────────────────────
alter table public.organizations
  add column timezone text not null default 'America/New_York';

comment on column public.organizations.timezone is
  'IANA zone every event time is entered and displayed in. organizations_timezone_check() refuses a name Postgres does not know; the app falls back to its configured default only when no org row resolves.';

-- ── 2. The validator ──────────────────────────────────────────────────────
-- Postgres carries the IANA database, so `at time zone` is the check: an
-- unknown name raises invalid_parameter_value, re-raised as a
-- check_violation so a client sees one SQLSTATE for a refused value. A
-- trigger rather than a CHECK constraint because the probe is not immutable.
create function public.organizations_timezone_check() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  begin
    perform now() at time zone new.timezone;
  exception when invalid_parameter_value then
    raise exception 'organizations.timezone: unknown time zone "%"', new.timezone
      using errcode = 'check_violation';
  end;
  return new;
end $$;

create trigger organizations_timezone_check
  before insert or update of timezone on public.organizations
  for each row execute function public.organizations_timezone_check();

-- ── 3. Grants ─────────────────────────────────────────────────────────────
-- Column privileges on organizations are fail-closed (ADD COLUMN grants
-- nothing). Every signed-in member reads the zone; the one org-settings
-- UPDATE policy already confines writes to the org's own admin, so the
-- column grant is the only new write surface. anon has no org to read.
grant select (timezone) on public.organizations to authenticated;
grant update (timezone) on public.organizations to authenticated;

-- ── 4. Self-check ─────────────────────────────────────────────────────────
-- Fails the migration if the grant shape, the single write policy, or the
-- validator is not what the app relies on.
do $$
declare
  _writes int;
begin
  if not has_column_privilege('authenticated', 'public.organizations', 'timezone', 'select')
     or not has_column_privilege('authenticated', 'public.organizations', 'timezone', 'update') then
    raise exception 'organizations.timezone: authenticated must hold SELECT and UPDATE on the column';
  end if;
  if has_column_privilege('anon', 'public.organizations', 'timezone', 'select')
     or has_column_privilege('anon', 'public.organizations', 'timezone', 'update') then
    raise exception 'organizations.timezone: anon must hold no privilege on the column';
  end if;
  if has_table_privilege('authenticated', 'public.organizations', 'update') then
    raise exception 'organizations: table-level UPDATE must stay revoked from authenticated';
  end if;

  select count(*) into _writes from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'organizations'
    and permissive = 'PERMISSIVE' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  if _writes <> 1 then
    raise exception 'organizations: expected exactly one permissive write policy, found %', _writes;
  end if;

  -- The probe row never commits: the trigger aborts the subtransaction, and
  -- a probe that survives is itself the failure.
  begin
    insert into public.organizations (name, timezone) values ('timezone probe', 'Nowhere/Bogus');
    raise exception 'organizations.timezone: the validator accepted an unknown zone';
  exception when check_violation then
    null;
  end;
end $$;
