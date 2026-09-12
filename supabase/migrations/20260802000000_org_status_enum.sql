-- org_status enum.
--
-- The DB half already shipped: 20260730010000_org_spine.sql:24 added
-- the CHECK constraint pinning organizations.status to 'active'/'suspended'.
-- What never shipped is the issue's actual ask — the 'active' | 'suspended'
-- union reaching lib/supabase/database.types.ts. `supabase gen types` emits
-- unions for ENUMS only, never for CHECK constraints, so status is still
-- typed `string` and `.update({ status: "suspend" })` compiles. Converting
-- the column to a real enum is the only change that fixes that.
--
-- Safe to convert: status carries no index, no FK, and no policy predicate
-- references it (20260731000001_org_helpers.sql notes neither org helper
-- consults status). Column ACLs survive ALTER COLUMN ... TYPE, so the
-- anon/authenticated column grants from 20260801000002 are unaffected.
-- listActiveOrgs()'s .eq("status", "active") keeps working — PostgREST
-- casts the literal to the enum.

create type public.org_status as enum ('active', 'suspended');

-- Preflight: every existing value must already be a valid enum label. The
-- CHECK from 20260730010000:24 guarantees it; assert rather than assume,
-- and hold the lock so no concurrent write can slip in between the check
-- and the conversion.
do $$
begin
  lock table public.organizations in access exclusive mode;
  if exists (
    select 1 from public.organizations
    where status not in ('active', 'suspended')
  ) then
    raise exception 'organizations.status holds a value outside (active, suspended); refusing the enum conversion';
  end if;
end $$;

alter table public.organizations
  drop constraint organizations_status_check;

-- The DEFAULT must be dropped before the type change and re-added after —
-- Postgres cannot cast the existing 'active'::text default expression in
-- place.
alter table public.organizations
  alter column status drop default,
  alter column status type public.org_status using status::public.org_status,
  alter column status set default 'active'::public.org_status;
