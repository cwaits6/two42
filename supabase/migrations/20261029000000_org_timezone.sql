-- One time zone per organization: every event time is entered and displayed
-- in it, never in the browser's or the server's zone.

-- ── 1. The column ─────────────────────────────────────────────────────────
alter table public.organizations
  add column timezone text not null default 'America/New_York';

comment on column public.organizations.timezone is
  'IANA zone every event time is entered and displayed in. organizations_timezone_check() refuses anything but an exact IANA name; the app falls back to its configured default only when no org row resolves.';

-- ── 2. The validator ──────────────────────────────────────────────────────
-- Postgres carries the IANA database, so pg_timezone_names is the check: an
-- exact, case-sensitive name, excluding the posix/ duplicates and the
-- Factory placeholder — the set Intl formats in, so the app and the edge
-- functions never meet a stored value they cannot read. `at time zone` is not
-- the check because it also takes POSIX rule strings, offsets and
-- case variants that Intl refuses. A trigger rather than a CHECK constraint
-- because the catalog lookup is not immutable; it raises check_violation so
-- a client sees one SQLSTATE for a refused value.
create function public.organizations_timezone_check() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = new.timezone
      and name not like 'posix/%'
      and name not in ('Factory', 'localtime', 'posixrules')
  ) then
    raise exception 'organizations.timezone: unknown time zone "%"', new.timezone
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function public.organizations_timezone_check() is
  'Trigger function: refuses an organizations.timezone that is not an exact IANA name in pg_timezone_names (no posix/ duplicates; no Factory, localtime or posixrules, which Postgres lists but Intl does not know). SECURITY INVOKER; raises check_violation.';

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
    raise exception 'organizations.timezone: anon must hold no SELECT or UPDATE privilege on the column';
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

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = 'America/New_York') then
    raise exception 'organizations.timezone: the default is not a known zone on this build';
  end if;

  -- The probe rows never commit: the trigger aborts the subtransaction, and
  -- a probe that survives is itself the failure.
  begin
    insert into public.organizations (name, timezone) values ('timezone probe', 'Nowhere/Bogus');
    raise exception 'organizations.timezone: the validator accepted an unknown zone';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.organizations (name, timezone) values ('timezone probe', 'posix/America/New_York');
    raise exception 'organizations.timezone: the validator accepted a name that is not an IANA zone';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.organizations (name, timezone) values ('timezone probe', 'posixrules');
    raise exception 'organizations.timezone: the validator accepted a Postgres-only zone name';
  exception when check_violation then
    null;
  end;
end $$;
