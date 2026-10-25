-- Drop organizations.slug. Nothing resolves, routes or labels an org by it
-- any more: every anonymous entry point is a token row read on the service
-- client and provision_organization() writes no slug. Dropping the column
-- takes its unique constraint organizations_slug_key with it.
--
-- app_org_slug_for_host() selects o.slug from a string body, which
-- pg_depend does not track, so the column drop would leave it raising on
-- its first call rather than failing here; it goes in the same step. The
-- org_domains tables and org_domain_status it read carry no slug and wait
-- for their own cleanup.
drop function public.app_org_slug_for_host(text);

alter table public.organizations drop column slug;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'slug'
  ) then
    raise exception 'organizations.slug still exists';
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.organizations'::regclass and conname = 'organizations_slug_key'
  ) then
    raise exception 'organizations_slug_key still exists';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'app_org_slug_for_host'
  ) then
    raise exception 'app_org_slug_for_host() still exists';
  end if;
end
$$;
