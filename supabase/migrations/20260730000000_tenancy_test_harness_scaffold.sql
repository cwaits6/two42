-- Tenancy test harness scaffold.
-- Minimal organizations/organization_members tables + a stub
-- provision_organization() — just enough to seed two fixture orgs for the
-- pgTAP leak-suite. NOT production tenant provisioning: no caller
-- authorization, no default-data seeding, not called from any app route.
-- Later migrations harden this and add org_id to real tables.

create extension if not exists pgtap with schema extensions;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (org_id, profile_id)
);

-- The membership-visibility policy and profiles-FK cascade both look up by
-- profile_id alone, which the (org_id, profile_id) primary key can't serve.
create index organization_members_profile_id_idx
  on public.organization_members (profile_id);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

create or replace function public.is_org_member(_org_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members
    where org_id = _org_id and profile_id = auth.uid()
  );
$$;

create policy "org members can view their orgs" on public.organizations
  for select using (public.is_org_member(id));

create policy "members can view their own org memberships" on public.organization_members
  for select using (profile_id = auth.uid());

-- Stub only: no INSERT policies exist on either table by design — direct
-- self-service org creation is out of scope for this scaffold, so this security
-- definer function is the sole write path, called from test/seed SQL only.
create or replace function public.provision_organization(_name text, _owner_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  _org_id uuid;
begin
  insert into public.organizations (name) values (_name) returning id into _org_id;
  insert into public.organization_members (org_id, profile_id) values (_org_id, _owner_id);
  return _org_id;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions, and a SECURITY DEFINER
-- function in public is callable through PostgREST RPC — without this revoke,
-- any anon/authenticated request could provision orgs. Test/seed SQL runs as
-- postgres, which bypasses ACLs, so the sole intended write path still works.
revoke execute on function public.provision_organization(text, uuid)
  from public, anon, authenticated;
