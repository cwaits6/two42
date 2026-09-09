-- Atomic claim of a custom sending domain, so the platform-wide cap cannot
-- be exceeded by concurrent claims.
--
-- The cap is a count across every org's org_email_domains rows (Resend's
-- account tier limits total domains regardless of tenant), and the
-- unique-per-org index only serializes claims from the SAME org. Two orgs
-- claiming at once could each observe a free slot, each insert, and each
-- create a Resend domain — one more than the cap. A count-then-insert in the
-- route cannot close that window; a single transaction holding a
-- platform-wide advisory lock can.
--
-- Same shape as email_quota_consume(): SECURITY DEFINER because the count
-- spans every tenant, EXECUTE granted to service_role only, and the org
-- passed in must come from an anchor the server-side caller already
-- validated (the admin's RLS-scoped profile) — a browser can never reach
-- this function. The org's enablement flag is re-checked here so the gate
-- holds even if a caller skips the route's own pre-check.
create or replace function public.org_email_domain_claim(
  _org_id uuid,
  _domain text,
  _cap integer
) returns public.org_email_domains
language plpgsql security definer set search_path = ''
as $$
declare
  _enabled boolean;
  _claimed integer;
  _row public.org_email_domains;
begin
  if _org_id is null or _domain is null or _cap is null or _cap < 0 then
    raise exception 'org_email_domain_claim: _org_id, _domain and a non-negative _cap are required';
  end if;

  -- One claim at a time, platform-wide. Transaction-scoped so it releases
  -- on commit or rollback; the key is arbitrary but stable.
  perform pg_advisory_xact_lock(hashtext('public.org_email_domains:claim'));

  select o.custom_email_domain_enabled into _enabled
  from public.organizations o where o.id = _org_id;
  if _enabled is null then
    raise exception 'org_email_domain_claim: unknown organization'
      using errcode = 'ED001';
  end if;
  if not _enabled then
    raise exception 'org_email_domain_claim: custom sending domains are not enabled for this organization'
      using errcode = 'ED002';
  end if;

  -- Rows still awaiting provider-side cleanup count too: their Resend
  -- domain still occupies a slot.
  select count(*) into _claimed from public.org_email_domains;
  if _claimed >= _cap then
    raise exception 'org_email_domain_claim: platform domain cap reached'
      using errcode = 'ED003';
  end if;

  -- A duplicate claim for the same org raises unique_violation (23505) from
  -- the unique-per-org index, exactly as a direct insert would.
  insert into public.org_email_domains (org_id, domain)
  values (_org_id, _domain)
  returning * into _row;

  return _row;
end;
$$;

revoke execute on function public.org_email_domain_claim(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.org_email_domain_claim(uuid, text, integer)
  to service_role;

comment on function public.org_email_domain_claim(uuid, text, integer) is
  'Atomic claim of an org''s custom sending domain under a platform-wide cap. Tenant anchor: service_role-only EXECUTE — _org_id must come from an anchor the server-side caller already validated (the admin''s RLS-scoped profile), never from a request. Raises ED001 (unknown org), ED002 (custom domains not enabled), ED003 (cap reached), or 23505 (org already holds a row).';
