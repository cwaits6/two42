-- Group names and descriptions get the same length limits in the database
-- that the create, request and Group settings forms enforce in the browser
-- (GROUP_NAME_MAX and GROUP_DESCRIPTION_MAX in lib/groups/creation.ts). A
-- caller going straight to PostgREST or group_create() could otherwise store
-- a name or description of any length, which the approval queue and the
-- directory render in full.
--
-- The constraints are NOT VALID: they hold for every row written from now
-- on, but adding them does not scan existing rows, so a long row written
-- before this migration cannot fail the deploy. A row that is edited later
-- must then fit.
--
-- char_length counts code points; the browser's String.length counts UTF-16
-- units, so anything the forms accept also passes here.
--
-- Error contract addition:
--   GC007  the group name or description is longer than its limit

alter table public.groups
  add constraint groups_name_length check (char_length(name) <= 120) not valid,
  add constraint groups_description_length
    check (description is null or char_length(description) <= 1000) not valid;

alter table public.group_requests
  add constraint group_requests_name_length check (char_length(name) <= 120) not valid,
  add constraint group_requests_description_length
    check (description is null or char_length(description) <= 1000) not valid;

-- The body is unchanged apart from the length check after the blank-name
-- check, which runs on the trimmed values group_create_for() stores.
-- CREATE OR REPLACE keeps the existing grants.
create or replace function public.group_create(
  _name text, _description text default null, _leader_id uuid default null
) returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  _actor uuid := auth.uid();
  _org uuid;
  _admin boolean;
  _policy text;
  _leader uuid;
begin
  if _actor is null then
    raise exception 'group creation rejected: no authenticated principal' using errcode = 'GC002';
  end if;
  -- Org and role from the caller's own profile, never a parameter.
  select p.org_id, p.role = 'admin' into _org, _admin
  from public.profiles p where p.id = _actor and p.role <> 'pending';
  if _org is null then
    raise exception 'group creation rejected: actor % is not an approved member', _actor using errcode = 'GC002';
  end if;
  if _name is null or btrim(_name) = '' then
    raise exception 'group creation rejected: name is required' using errcode = 'GC006';
  end if;
  if char_length(btrim(_name)) > 120 or char_length(btrim(coalesce(_description, ''))) > 1000 then
    raise exception 'group creation rejected: name or description is too long' using errcode = 'GC007';
  end if;

  _leader := coalesce(_leader_id, _actor);
  if not _admin then
    if _leader <> _actor then
      raise exception 'group creation rejected: only an org admin may name another leader' using errcode = 'GC005';
    end if;
    select o.group_creation_policy into _policy from public.organizations o where o.id = _org;
    if _policy is distinct from 'open' then
      raise exception 'group creation rejected: org policy is %', coalesce(_policy, 'unknown') using errcode = 'GC001';
    end if;
  end if;

  return public.group_create_for(_org, _name, _description, _leader, _actor);
end;
$$;

comment on function public.group_create(text, text, uuid) is
  'Creates a group with its leader and calendar. Tenant anchor: the caller''s own profiles row (org and role), never a parameter. A non-admin may only lead the group themselves (GC005) and only under the open policy (GC001); an admin may name any approved member of their org (GC003 otherwise). GC002: not an approved member. GC006: blank name. GC007: name over 120 or description over 1000 characters.';
