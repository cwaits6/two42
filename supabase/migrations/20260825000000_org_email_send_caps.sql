-- Per-org email send caps (Phase 5 PR 8, CWA-72 / #365). Bounds the blast
-- radius of a bug or an abusive tenant on the shared Resend account and the
-- shared sending reputation — an abuse control, NOT a billing meter (see
-- docs/plans/phase-5-domains-email.md §3, §11).
--
-- org_email_usage:  one row per org per UTC day, the durable reserved-send
--                   counter. Written only through email_quota_consume().
-- org_email_limits: per-org daily-cap override, platform-operator-owned —
--                   an org that can raise its own cap does not have a cap.
--                   The 500/day default lives in email_quota_consume(), not
--                   a seeded row (decision D7).
--
-- email_quota_consume() is a SECURITY DEFINER writer of org-owned tables, so
-- per CLAUDE.md it is a tenant boundary of its own: the org checks in its
-- body replace RLS. The specific tension — the rule says never resolve the
-- org from a caller parameter, and this takes _org_id as a parameter — is
-- resolved the serving_signup_apply way (20260803010000): EXECUTE is granted
-- to service_role ONLY, so the only callers are server-side paths that
-- already hold a validated orgId from an anchor they verified (the caller's
-- RLS-scoped profile, the RLS-checked group row, listActiveOrgs()'s own
-- enumeration). That contract is pinned by the grant-matrix assertions in
-- supabase/tests/org_email_quota_suite.sql and recorded in
-- docs/security/service-role-inventory.md. If an authenticated entry point
-- is ever needed, it gets a separate wrapper that pins the org to
-- app_request_org_id(), exactly as serving_signup_create does.

create table public.org_email_usage (
  -- Single-column FK: organizations is the tenant root and carries no
  -- org_id of its own (CLAUDE.md's one named exception to composite FKs).
  org_id uuid not null default public.app_current_org_id()
    references public.organizations(id) on delete cascade,
  -- UTC day. A rolling window needs a row per send; a daily bucket needs one
  -- row per org per day and is enough to stop a runaway fan-out.
  usage_date date not null default (now() at time zone 'utc')::date,
  sent_count integer not null default 0 check (sent_count >= 0),
  primary key (org_id, usage_date)
);

create table public.org_email_limits (
  org_id uuid primary key default public.app_current_org_id()
    references public.organizations(id) on delete cascade,
  daily_cap integer not null default 500,
  updated_at timestamptz not null default now(),
  constraint org_email_limits_cap_sane check (daily_cap between 0 and 100000)
);

alter table public.org_email_usage enable row level security;
alter table public.org_email_limits enable row level security;

-- The isolation floor. Deliberately the ONLY policy on either table: a table
-- with a restrictive policy and no permissive one is readable and writable by
-- no PostgREST caller, which is the intended v1 posture — both tables are
-- touched by service-role code only (the RPC below and the /platform cap
-- editor). An org-facing usage display later means adding a permissive
-- SELECT arm, not relaxing this one (spec §11.1).
create policy "org isolation" on public.org_email_usage
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "org isolation" on public.org_email_limits
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

-- Lock the whole table down: Supabase's default privileges grant ALL on
-- every new public table to anon and authenticated at CREATE TABLE time
-- (20260819000000_org_email_domains.sql hit the same trap). No further
-- grants to either role — service_role bypasses grants entirely.
revoke all on public.org_email_usage from anon, authenticated;
revoke all on public.org_email_limits from anon, authenticated;

-- Atomic "reserve _n sends against today's cap". Count-then-send is a race
-- (two concurrent fan-outs both read "under the cap" and both send); the
-- single INSERT ... ON CONFLICT ... DO UPDATE ... WHERE below reserves in
-- one statement, so concurrent callers serialize on the row lock and cannot
-- jointly exceed the cap. sent_count counts RESERVED ATTEMPTS, not confirmed
-- deliveries — every error the counter can make must be in the conservative
-- direction (spec §11.2).
create or replace function public.email_quota_consume(_org_id uuid, _n integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  _cap integer;
  _ok boolean;
begin
  -- A non-positive _n is a caller bug, not a refusable request: raising makes
  -- the bug loud, and it closes the door on a negative _n walking sent_count
  -- backwards (the >= 0 CHECK on the table is the second lock on that door).
  if _org_id is null or _n is null or _n <= 0 then
    raise exception 'email_quota_consume: _n must be a positive batch size';
  end if;

  select l.daily_cap into _cap
  from public.org_email_limits l where l.org_id = _org_id;
  -- 500/day default (decision D7, resolved 2026-08-16 as a placeholder).
  -- Revisit this default against the Resend plan's actual ceiling as the
  -- tenant count grows — the per-org override in org_email_limits is the
  -- escape hatch in the meantime.
  _cap := coalesce(_cap, 500);

  -- Bounds the INSERT path: without this, the first reserve of a UTC day is
  -- unguarded (ON CONFLICT ... WHERE only constrains the UPDATE arm) and a
  -- fan-out larger than the cap would sail through on a fresh day.
  if _n > _cap then
    return false;
  end if;

  insert into public.org_email_usage as u (org_id, usage_date, sent_count)
  values (_org_id, (now() at time zone 'utc')::date, _n)
  on conflict (org_id, usage_date) do update
    set sent_count = u.sent_count + excluded.sent_count
    where u.sent_count + excluded.sent_count <= _cap
  returning true into _ok;

  return coalesce(_ok, false);
end;
$$;

-- The caller discrimination IS the grants, auditable in pg_proc.proacl and
-- asserted in supabase/tests/org_email_quota_suite.sql (mirroring
-- serving_signup_apply).
revoke execute on function public.email_quota_consume(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.email_quota_consume(uuid, integer)
  to service_role;

comment on function public.email_quota_consume(uuid, integer) is
  'Atomic per-org daily email quota reserve (Phase 5 PR 8, CWA-72). Tenant anchor: service_role-only EXECUTE — _org_id must come from an anchor the server-side caller already validated (its RLS-scoped profile, an RLS-checked group row, listActiveOrgs()), never trusted from a request. Returns false when the reservation would exceed the org''s daily cap (org_email_limits.daily_cap, default 500).';
