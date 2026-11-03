-- A church's choice to delete old prayer requests, and the nightly job that
-- clears out expired data. NULL means prayer requests are kept: no default, so
-- adding the column leaves every existing church off.

alter table public.organizations
  add column prayer_request_retention_months integer
    constraint organizations_prayer_request_retention_months_check
    check (prayer_request_retention_months in (6, 12, 24));

comment on column public.organizations.prayer_request_retention_months is
  'Age in months, from created_at, at which the nightly job deletes a prayer request. NULL keeps them.';

-- ADD COLUMN grants nothing on this table. The one org-settings UPDATE policy
-- confines writes to the org's own admin, so these grants are the only new
-- surface.
grant select (prayer_request_retention_months) on public.organizations to authenticated;
grant update (prayer_request_retention_months) on public.organizations to authenticated;

do $$
declare
  _writes int;
begin
  if not has_column_privilege('authenticated', 'public.organizations', 'prayer_request_retention_months', 'select')
     or not has_column_privilege('authenticated', 'public.organizations', 'prayer_request_retention_months', 'update') then
    raise exception 'organizations.prayer_request_retention_months: authenticated must hold SELECT and UPDATE on the column';
  end if;
  if has_column_privilege('anon', 'public.organizations', 'prayer_request_retention_months', 'select')
     or has_column_privilege('anon', 'public.organizations', 'prayer_request_retention_months', 'update') then
    raise exception 'organizations.prayer_request_retention_months: anon must hold no SELECT or UPDATE privilege on the column';
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

  if exists (select 1 from public.organizations where prayer_request_retention_months is not null) then
    raise exception 'organizations.prayer_request_retention_months: an existing church was turned on';
  end if;
end $$;

-- 09:00 UTC is the early hours across the US, clear of the 15:00 UTC reminders.
select private.schedule_edge_reminder(
  'clean-up-expired-data-nightly',
  '0 9 * * *',
  '/functions/v1/clean-up-expired-data',
  '{}'::jsonb
);
