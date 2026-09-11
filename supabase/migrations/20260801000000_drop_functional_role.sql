-- Drop member_groups.functional_role, again.
--
-- 20260716000002_configurable_group_roles.sql dropped the original
-- functional_role enum because hardwiring seeded group names to app features
-- was the wrong model — capability flags an admin can put on any group
-- (grants_prayer_access, is_serving_role) replaced it. The org spine
-- (20260730010000) re-added the column on a *proposed* basis so a real
-- provision_organization() could look up seeded functional groups by key,
-- pending a maintainer decision on the role names.
--
-- The maintainer decision (2026-08-01) went the other
-- way: groups are org-defined, not platform-defined. provision_organization()
-- seeds no groups; each org creates the groups it wants in /admin/groups and
-- designates capabilities per group and leadership per membership
-- (profile_groups.is_leader). With no seeded lookup key needed, the column is
-- dead again — no app surface ever consumed it (generated types aside), and
-- every row on the deployed org carries NULL. Drop it and its partial unique.

-- Preflight: the every-row-is-NULL claim above is asserted, not assumed. The
-- explicit lock is held until this migration's transaction commits, so no
-- concurrent write can populate the column between the check and the drop.
do $$
begin
  lock table public.member_groups in access exclusive mode;
  if exists (
    select 1 from public.member_groups where functional_role is not null
  ) then
    raise exception 'member_groups.functional_role has populated rows; refusing to drop the column';
  end if;
end $$;

drop index if exists public.member_groups_org_id_functional_role_key;

alter table public.member_groups
  drop column functional_role;
