-- Narrow the anon column grant on organizations.
--
-- 20260801000002_org_branding_backfill.sql:64-66 already revoked table-level
-- SELECT and re-granted the four-column list (id, name, slug, branding) to
-- BOTH anon and authenticated. The remaining delta is dropping
-- `name` from anon alone; authenticated keeps it.
--
-- Verified safe: the only two app reads of organizations are
-- lib/branding.ts:87-91 (`.select("branding")`, request-scoped client) and
-- lib/email/identity.ts:87 (service-role, unaffected by grants). No
-- anonymous read path touches organizations.name.

-- `revoke select ... from anon` removes the table-level AND every
-- column-level SELECT grant for the role, so the explicit column re-grant
-- must follow in the same migration. Stated as a full column list (not
-- `revoke select (name)`) so a future audit reads the granted set directly.
revoke select on public.organizations from anon;
grant select (id, slug, branding) on public.organizations to anon;
