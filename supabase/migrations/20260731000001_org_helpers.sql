-- The two org-resolution helpers.
-- app_current_org_id() shipped in 20260730010000_org_spine.sql as
-- the fail-closed column DEFAULT; it is re-stated here unchanged so both
-- helpers and their grants/comments live together as the single reference
-- point for the RLS rewrite.

-- Authoritative org of the calling principal. Derived only from server-owned
-- state (the caller's own profiles row). Never from a claim, header, or GUC
-- the client can influence — any role can set_config() an arbitrary GUC, so
-- GUC-first resolution would hand every member a tenant switch (a trusted
-- service-role override, if ever needed, is future work and must be gated on
-- auth.role() = 'service_role'). NULL when there is no authenticated
-- principal, which fails closed everywhere it is consumed: NULL org_id
-- default violates NOT NULL on write, and `org_id = NULL` is not TRUE so
-- every RLS predicate filters the row.
create or replace function public.app_current_org_id() returns uuid
  language sql stable security definer set search_path = ''
as $$
  select org_id from public.profiles where id = (select auth.uid());
$$;

-- No recursion: RLS on profiles calls this function, but SECURITY DEFINER
-- bypasses RLS on the inner profiles read, exactly as is_admin()/is_member()
-- already do (see 20260715000000_fix_profiles_update_recursion.sql for the
-- cautionary tale; the pgTAP suite has an explicit no-recursion test).

comment on function public.app_current_org_id() is
  'Org of the calling principal, resolved from their own profiles row only. NULL for anon/service callers — fail-closed by construction. Wrap call sites as (select public.app_current_org_id()) so the planner evaluates it once per statement (InitPlan).';

-- Org this HTTP request is *about*. Branches on the presence of an
-- authenticated principal, not on whether their org resolved: a logged-in
-- user can never widen (or switch) their own scope by sending a header —
-- including a JWT whose profiles row is gone, which resolves NULL and fails
-- closed rather than falling back to header resolution. Host/slug resolution
-- via the x-two42-org request header applies only to anonymous callers — and
-- anon permissive policies only ever expose orgs' already-public content, so
-- the header selects among public surfaces, never grants access.
--
-- organizations.status is deliberately NOT consulted here: neither helper
-- cuts access for a 'suspended' org, so suspension currently does nothing.
-- Enforcement belongs to the platform-admin work, which owns the /platform
-- suspend surface and must decide the cut point (helper predicate vs.
-- middleware) together with its UX — don't assume it's enforced until then.
create or replace function public.app_request_org_id() returns uuid
  language sql stable security definer set search_path = ''
as $$
  select case
    when (select auth.uid()) is not null then (select public.app_current_org_id())
    else (select o.id from public.organizations o
      where o.slug = nullif(
        -- request.headers is only set (to a JSON object) by PostgREST; in
        -- any other execution context it is unset or empty, and the nullif
        -- below turns that into NULL rather than a JSON cast error, keeping
        -- the fail-closed contract.
        nullif(current_setting('request.headers', true), '')::json
          ->> 'x-two42-org', ''))
  end;
$$;

comment on function public.app_request_org_id() is
  'Org a request is about: the authenticated principal''s org, else the org whose slug matches the x-two42-org request header (anon public surface only). NULL when neither resolves — fail-closed. Wrap call sites as (select public.app_request_org_id()).';

-- Policy expressions run as the invoking role, so both helpers must be
-- executable by anon and authenticated. (REVOKE is provision_organization()'s
-- treatment, not these.)
grant execute on function public.app_current_org_id() to anon, authenticated, service_role;
grant execute on function public.app_request_org_id() to anon, authenticated, service_role;
