-- Group invite links: a leader or org admin mints an unguessable link into
-- one group. A stranger who follows it becomes an approved org member and a
-- member of that group, vouched for by the link's creator; a signed-in
-- member who follows it joins, or asks to join, under the group's own rules.
--
--   * group_invites — the link: a DB-minted uuid token, the group it opens,
--     who made it, and the three ways it stops working (expires_at,
--     max_uses, revoked_at). Read, created and revoked only by the group's
--     leaders and org admins; never deleted, so the audit trail stays whole.
--   * group_invite_uses — one row per redemption with the address it was
--     redeemed by and the outcome. max_uses is compared against this table
--     under a lock on the invite row, so there is no counter to drift.
--   * access_requests.group_id / group_invite_id — the approved request a
--     new person signs up through names the group handle_new_user() enrols
--     them in. access_requests also gains unique (id, org_id) so the use row
--     can reference it with a composite FK.
--   * group_invite_redeem() — the new-person path (service_role only): the
--     route mints the signup token and this writes the approved request and
--     the use row in one transaction.
--   * group_invite_join() — the member path (authenticated): a private group
--     admits at once (the link is the approval); otherwise join_group_apply()
--     applies the group's join_policy.
--   * handle_new_user() — enrols the invite's group ahead of the one-group
--     fallback.
--
-- SECURITY DEFINER bypasses RLS, so the org checks in the function bodies
-- ARE the tenant boundary on this surface: the org comes from the invite
-- row the token selects, never from a parameter, and every other row is
-- asserted to carry it before anything is written. schema_tenancy_lint.sql
-- check 4 only proves the source mentions org_id;
-- supabase/tests/group_invites_suite.sql pins the behaviour.
--
-- Error contract (SQLSTATEs the app maps to visitor-facing copy):
--   GI001  the link is dead: unknown token, revoked, expired, used up, or
--          another org's — one code, so the response never says which
--   GI002  blank name, an address that is not an email, or no signup token
--   GI003  the address already has an account, or an approved request or
--          unclaimed invite in another org, so a setup link could never work
--   GI004  an org admin denied this address; a leader's link does not undo it
--   GI006  wrong path: signed in on the new-person path, or anonymous /
--          not an approved member on the member path

-- ── 1. access_requests: the parent key and the group it admits into ────────
alter table public.access_requests
  add constraint access_requests_id_org_unique unique (id, org_id);

-- ── 2. group_invites ──────────────────────────────────────────────────────
create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  group_id uuid not null,
  token uuid not null default gen_random_uuid(),
  -- auth.users carries no org_id, so a plain FK is right here, as on
  -- groups.created_by.
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses integer,
  revoked_at timestamptz,
  constraint group_invites_token_key unique (token),
  constraint group_invites_max_uses_positive check (max_uses is null or max_uses > 0),
  constraint group_invites_group_id_fkey
    foreign key (group_id, org_id) references public.groups (id, org_id) on delete cascade,
  constraint group_invites_id_org_unique unique (id, org_id),
  constraint group_invites_id_group_org_unique unique (id, group_id, org_id)
);
create index group_invites_group_org_idx on public.group_invites (group_id, org_id);
create index group_invites_org_id_idx on public.group_invites (org_id);
alter table public.group_invites enable row level security;

comment on table public.group_invites is
  'A link into one group. token is the plaintext the link carries; the row is read by the service client on /join/<token> and is the org anchor for everything that follows. Dead when revoked_at is set, expires_at has passed, or group_invite_uses holds max_uses rows. Never deleted by the app.';

-- ── 3. group_invite_uses ──────────────────────────────────────────────────
create table public.group_invite_uses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  invite_id uuid not null,
  group_id uuid not null,
  used_at timestamptz not null default now(),
  -- The lower-cased address the link was redeemed by. A member's profile can
  -- carry no email, so only the new-person outcome requires one.
  email text,
  outcome text not null
    constraint group_invite_uses_outcome_check check (outcome in ('signup_sent', 'joined', 'requested')),
  profile_id uuid,
  access_request_id uuid,
  constraint group_invite_uses_signup_has_email check (outcome <> 'signup_sent' or email is not null),
  constraint group_invite_uses_invite_id_fkey
    foreign key (invite_id, group_id, org_id)
    references public.group_invites (id, group_id, org_id) on delete cascade,
  constraint group_invite_uses_profile_id_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id)
    on delete set null (profile_id),
  constraint group_invite_uses_access_request_id_fkey
    foreign key (access_request_id, org_id) references public.access_requests (id, org_id)
    on delete set null (access_request_id)
);
create index group_invite_uses_invite_id_idx on public.group_invite_uses (invite_id);
create index group_invite_uses_org_id_idx on public.group_invite_uses (org_id);
alter table public.group_invite_uses enable row level security;

comment on table public.group_invite_uses is
  'One row per redemption of a group invite. Written only by group_invite_redeem() and group_invite_join(); profile_id is stamped by handle_new_user() when a signup_sent row''s person signs up. The count per invite is what max_uses is compared against.';

alter table public.access_requests
  add column group_id uuid,
  add column group_invite_id uuid,
  add constraint access_requests_group_id_fkey
    foreign key (group_id, org_id) references public.groups (id, org_id)
    on delete set null (group_id),
  add constraint access_requests_group_invite_id_fkey
    foreign key (group_invite_id, org_id) references public.group_invites (id, org_id)
    on delete set null (group_invite_id);
create index access_requests_group_invite_id_idx on public.access_requests (group_invite_id);

comment on column public.access_requests.group_id is
  'The group an invite link admits this person into. handle_new_user() enrols them there instead of falling back to the one-group rule.';

-- ── 4. RLS and grants ─────────────────────────────────────────────────────
-- ORG ::= org_id = (select public.app_request_org_id()); every permissive
-- policy is ORG AND (arms). is_group_leader() takes a row-dependent
-- argument, so it is called bare.
create policy "org isolation" on public.group_invites
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));
create policy "org isolation" on public.group_invite_uses
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "Leaders and admins can view group invites" on public.group_invites
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

create policy "Leaders and admins can create group invites" on public.group_invites
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and created_by = (select auth.uid())
    and revoked_at is null
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

-- Revoke is one-way: the column grant below confines the UPDATE to
-- revoked_at, and the WITH CHECK refuses to clear it again.
create policy "Leaders and admins can revoke group invites" on public.group_invites
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  )
  with check (
    org_id = (select public.app_request_org_id())
    and revoked_at is not null
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

-- No DELETE policy, and no DELETE privilege: links are the audit trail.
revoke all on public.group_invites from anon;
revoke update, delete on public.group_invites from authenticated;
grant update (revoked_at) on public.group_invites to authenticated;

create policy "Leaders and admins can view group invite uses" on public.group_invite_uses
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_admin()) or public.is_group_leader(group_id))
  );

-- Written only by the definer functions below and by handle_new_user().
revoke all on public.group_invite_uses from anon;
revoke insert, update, delete on public.group_invite_uses from authenticated;

-- ── 5. The new-person path ────────────────────────────────────────────────
-- service_role only: the route holds the signup token it minted and mails
-- it, so the browser never sees a token it did not prove an address for.
create function public.group_invite_redeem(
  _token uuid,
  _name text,
  _email text,
  _signup_token text,
  _token_expires_at timestamptz
) returns table (org_id uuid, group_id uuid, group_name text, access_request_id uuid)
  language plpgsql security definer set search_path = ''
as $$
declare
  _inv public.group_invites%rowtype;
  _org uuid;
  _group uuid;
  _gname text;
  _name_norm text := btrim(coalesce(_name, ''));
  _email_norm text := lower(btrim(coalesce(_email, '')));
  _request uuid;
  _counted boolean;
begin
  if auth.uid() is not null then
    raise exception 'invite redeem rejected: a signed-in caller takes the member path'
      using errcode = 'GI006';
  end if;
  if _name_norm = ''
     or _email_norm = '' or length(_email_norm) > 254 or position('@' in _email_norm) = 0
     or _signup_token is null or btrim(_signup_token) = ''
     or _token_expires_at is null then
    raise exception 'invite redeem rejected: name, email and a signup token are required'
      using errcode = 'GI002';
  end if;

  -- The token is the only thing that names the org: this lookup is
  -- unscoped and the row it returns anchors every read and write below.
  -- Locked so two first-time submissions on a one-use link serialise.
  select gi.* into _inv from public.group_invites gi where gi.token = _token for update;
  if not found
     or _inv.revoked_at is not null
     or (_inv.expires_at is not null and _inv.expires_at <= now()) then
    raise exception 'invite redeem rejected: link is not valid' using errcode = 'GI001';
  end if;
  _org := _inv.org_id;
  _group := _inv.group_id;
  select g.name into _gname from public.groups g where g.id = _group and g.org_id = _org;
  if _gname is null then
    raise exception 'invite redeem rejected: link is not valid' using errcode = 'GI001';
  end if;

  -- An address that already has an account anywhere cannot sign up again
  -- (auth emails are unique), and one approved or invited into another org
  -- would be ambiguous at signup (TN002): refuse now rather than mail a
  -- link that cannot work. Existence checks only; nothing is returned.
  if exists (select 1 from public.profiles p where lower(p.email) = _email_norm)
     or exists (
       select 1 from public.access_requests ar
       where lower(ar.email) = _email_norm and ar.status = 'approved' and ar.org_id <> _org)
     or exists (
       select 1 from public.family_invites fi
       where lower(fi.invite_email) = _email_norm and fi.accepted_at is null and fi.org_id <> _org) then
    raise exception 'invite redeem rejected: address cannot sign up through this link'
      using errcode = 'GI003';
  end if;

  if exists (
    select 1 from public.access_requests ar
    where ar.org_id = _org and lower(ar.email) = _email_norm and ar.status = 'denied') then
    raise exception 'invite redeem rejected: address was denied by an admin' using errcode = 'GI004';
  end if;

  -- A repeat submission by the same address refreshes the setup link and
  -- counts as the same use, so a lost email never burns a one-use link.
  _counted := exists (
    select 1 from public.group_invite_uses u
    where u.invite_id = _inv.id and u.org_id = _org and u.email = _email_norm);
  if not _counted and _inv.max_uses is not null and (
       select count(*) from public.group_invite_uses u
       where u.invite_id = _inv.id and u.org_id = _org) >= _inv.max_uses then
    raise exception 'invite redeem rejected: link is not valid' using errcode = 'GI001';
  end if;

  select ar.id into _request from public.access_requests ar
  where ar.org_id = _org and lower(ar.email) = _email_norm
  order by ar.created_at desc
  limit 1
  for update;

  if _request is not null then
    -- The latest link wins, including over a request that named another group.
    update public.access_requests ar
      set status = 'approved',
          name = _name_norm,
          reviewed_by = _inv.created_by,
          reviewed_at = now(),
          signup_token = _signup_token,
          token_expires_at = _token_expires_at,
          group_id = _group,
          group_invite_id = _inv.id
      where ar.id = _request and ar.org_id = _org;
  else
    insert into public.access_requests
      (org_id, name, email, status, reviewed_by, reviewed_at, signup_token, token_expires_at,
       group_id, group_invite_id)
    values
      (_org, _name_norm, _email_norm, 'approved', _inv.created_by, now(), _signup_token, _token_expires_at,
       _group, _inv.id)
    returning id into _request;
  end if;

  if not _counted then
    insert into public.group_invite_uses (org_id, invite_id, group_id, email, outcome, access_request_id)
    values (_org, _inv.id, _group, _email_norm, 'signup_sent', _request);
  end if;

  return query select _org, _group, _gname, _request;
end;
$$;

revoke execute on function public.group_invite_redeem(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.group_invite_redeem(uuid, text, text, text, timestamptz)
  to service_role;

comment on function public.group_invite_redeem(uuid, text, text, text, timestamptz) is
  'New-person redemption of a group invite. Tenant anchor: the group_invites row the token selects (locked for update), never a parameter; the approved access_requests row and the use row carry its org_id. A repeat submission by the same address re-mints the setup token without a new use. service_role only. GI001 dead link, GI002 bad input, GI003 address cannot sign up, GI004 denied by an admin, GI006 signed-in caller.';

-- ── 6. The member path ────────────────────────────────────────────────────
create function public.group_invite_join(_token uuid) returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _org uuid;
  _email text;
  _inv public.group_invites%rowtype;
  _private boolean;
  _counted boolean;
  _result text;
begin
  if _uid is null then
    raise exception 'invite join rejected: no authenticated principal' using errcode = 'GI006';
  end if;
  -- Org from the caller's own profile; the invite must carry the same one.
  select p.org_id, p.email into _org, _email
  from public.profiles p where p.id = _uid and p.role <> 'pending';
  if _org is null then
    raise exception 'invite join rejected: caller % is not an approved member', _uid using errcode = 'GI006';
  end if;

  select gi.* into _inv from public.group_invites gi where gi.token = _token for update;
  if not found
     or _inv.org_id <> _org
     or _inv.revoked_at is not null
     or (_inv.expires_at is not null and _inv.expires_at <= now()) then
    raise exception 'invite join rejected: link is not valid' using errcode = 'GI001';
  end if;

  if exists (
    select 1 from public.group_members m
    where m.group_id = _inv.group_id and m.profile_id = _uid and m.org_id = _org) then
    return 'already_member';
  end if;

  -- The same person following the link again is one use, not two.
  _counted := exists (
    select 1 from public.group_invite_uses u
    where u.invite_id = _inv.id and u.org_id = _org and u.profile_id = _uid);
  if not _counted and _inv.max_uses is not null and (
       select count(*) from public.group_invite_uses u
       where u.invite_id = _inv.id and u.org_id = _org) >= _inv.max_uses then
    raise exception 'invite join rejected: link is not valid' using errcode = 'GI001';
  end if;

  select g.is_private into _private
  from public.groups g where g.id = _inv.group_id and g.org_id = _org;
  if _private is null then
    raise exception 'invite join rejected: link is not valid' using errcode = 'GI001';
  end if;

  if _private then
    -- A private group has no discoverable join path, so the link is the
    -- approval: the creator vouches, as added_by records.
    insert into public.group_members (org_id, group_id, profile_id, role, added_by)
    values (_org, _inv.group_id, _uid, 'member', _inv.created_by)
    on conflict (group_id, profile_id) do nothing;
    update public.group_join_requests
      set status = 'approved', reviewed_at = now()
      where group_id = _inv.group_id and profile_id = _uid
        and org_id = _org and status = 'pending';
    _result := 'joined';
  else
    _result := public.join_group_apply(_inv.group_id, _uid);
  end if;

  if not _counted then
    insert into public.group_invite_uses (org_id, invite_id, group_id, email, outcome, profile_id)
    values (_org, _inv.id, _inv.group_id, lower(_email), _result, _uid);
  end if;

  return _result;
end;
$$;

revoke execute on function public.group_invite_join(uuid) from public, anon, service_role;
grant execute on function public.group_invite_join(uuid) to authenticated;

comment on function public.group_invite_join(uuid) is
  'A signed-in member follows a group invite. Tenant anchor: the caller''s own profiles row (GI006 when none or pending); the invite row, locked for update, must carry that org (GI001 for foreign, missing, revoked, expired or used up). Returns already_member with no use row; joined at once for a private group (added_by = the invite''s creator); otherwise join_group_apply() decides joined or requested. One use row per person per link.';

-- ── 7. handle_new_user(): enrol the invite's group ────────────────────────
-- Body copied verbatim from 20261018000000_directory_visibility.sql; only
-- the enrolment block after the organization_members insert changes.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  _full_name text := new.raw_user_meta_data->>'full_name';
  _first text;
  _last text;
  _org_ids uuid[];
  _org_id uuid;
  _hint_org_id uuid;
  _role text;
  _request_id uuid;
  _invite_group_id uuid;
  _invite_id uuid;
  _voucher uuid;
begin
  -- Email matches are case-insensitive: GoTrue lowercases auth emails while
  -- access_requests / family_invites store them as typed, so an exact
  -- comparison would raise TN001 for anyone whose request was entered with
  -- capitals — locking them out of signup entirely.
  select coalesce(array_agg(distinct org_id), '{}') into _org_ids
  from (
    select org_id from public.access_requests
    where lower(email) = lower(new.email) and status = 'approved'
    union
    select org_id from public.family_invites
    where lower(invite_email) = lower(new.email) and accepted_at is null
  ) matches;

  -- Server-set disambiguator only: narrow within the resolved set, never
  -- widen it. (jsonb ->> on a missing key is NULL; a malformed value should
  -- fail the signup loudly rather than be ignored, so no exception handling
  -- around the cast.)
  _hint_org_id := nullif(new.raw_app_meta_data ->> 'org_id', '')::uuid;
  if _hint_org_id is not null and _hint_org_id = any (_org_ids) then
    _org_ids := array[_hint_org_id];
  end if;

  if coalesce(array_length(_org_ids, 1), 0) = 0 then
    raise exception 'signup rejected: no approved access request or invite for %', new.email
      using errcode = 'TN001';
  elsif array_length(_org_ids, 1) > 1 then
    raise exception 'signup ambiguous: % matches approved invitations in multiple organizations', new.email
      using errcode = 'TN002';
  end if;

  _org_id := _org_ids[1];

  -- Approval logic: an approved access request grants its
  -- approved_role, with NULL preserving the previous behavior ('member').
  -- The order by makes a non-NULL approved_role win deterministically if an
  -- org somehow holds two approved requests for the same email. _role stays
  -- NULL — hence 'pending' — when the match came only from family_invites
  -- (the family claim flow promotes it), preserving today's semantics.
  select coalesce(ar.approved_role, 'member') into _role
  from public.access_requests ar
  where lower(ar.email) = lower(new.email)
    and ar.status = 'approved'
    and ar.org_id = _org_id
  order by ar.approved_role is null, ar.created_at desc
  limit 1;
  _role := coalesce(_role, 'pending');

  if _full_name is not null and btrim(_full_name) <> '' then
    if position(' ' in btrim(_full_name)) = 0 then
      _first := btrim(_full_name);
      _last := null;
    else
      _first := btrim(substring(btrim(_full_name) from 1 for (length(btrim(_full_name)) - position(' ' in reverse(btrim(_full_name))))));
      _last := btrim(substring(btrim(_full_name) from (length(btrim(_full_name)) - position(' ' in reverse(btrim(_full_name))) + 2)));
    end if;
  end if;

  insert into public.profiles (id, first_name, last_name, email, role, relationship, org_id)
  values (new.id, _first, _last, new.email, _role, 'primary', _org_id);

  insert into public.organization_members (org_id, profile_id)
  values (_org_id, new.id)
  on conflict do nothing;

  -- The approved request that admits this person may name a group — an
  -- invite link. Its composite FK pins that group to _org_id.
  select ar.id, ar.group_id, ar.group_invite_id
    into _request_id, _invite_group_id, _invite_id
  from public.access_requests ar
  where lower(ar.email) = lower(new.email)
    and ar.status = 'approved'
    and ar.org_id = _org_id
  order by ar.group_id is null, ar.created_at desc
  limit 1;

  if _role <> 'pending' and _invite_group_id is not null then
    select gi.created_by into _voucher
    from public.group_invites gi
    where gi.id = _invite_id and gi.org_id = _org_id;
    insert into public.group_members (org_id, group_id, profile_id, role, added_by)
    values (_org_id, _invite_group_id, new.id, 'member', _voucher)
    on conflict (group_id, profile_id) do nothing;
    update public.group_invite_uses
      set profile_id = new.id
      where access_request_id = _request_id and org_id = _org_id;
  -- One-group orgs: enrol on signup, mirroring group_model_backfill(). With
  -- zero or several groups there is no right answer, so nobody is enrolled.
  -- A family-invite signup lands as 'pending' and is promoted later by the
  -- claim route, which does not enrol.
  elsif _role <> 'pending'
     and (select count(*) from public.groups g where g.org_id = _org_id) = 1 then
    insert into public.group_members (org_id, group_id, profile_id, role)
    select _org_id, g.id, new.id, 'member'
    from public.groups g
    where g.org_id = _org_id
    on conflict (group_id, profile_id) do nothing;
  end if;

  return new;
end;
$$;

-- ── 8. Self-check ─────────────────────────────────────────────────────────
-- Fails the migration, not CI, if the new tables' policy or grant shape
-- drifts.
do $$
declare
  _t text;
  _restrictive int;
  _bare int;
  _deletes int;
begin
  foreach _t in array array['group_invites', 'group_invite_uses'] loop
    select count(*) into _restrictive from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = _t
      and permissive = 'RESTRICTIVE' and qual like '%org\_id%';
    if _restrictive <> 1 then
      raise exception '%: expected exactly one restrictive isolation policy, found %', _t, _restrictive;
    end if;

    select count(*) into _bare from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = _t
      and (qual = 'true' or with_check = 'true');
    if _bare <> 0 then
      raise exception '%: % policy(ies) carry a bare true predicate', _t, _bare;
    end if;

    if has_any_column_privilege('anon', 'public.' || _t, 'select')
       or has_table_privilege('anon', 'public.' || _t, 'insert')
       or has_table_privilege('anon', 'public.' || _t, 'update')
       or has_table_privilege('anon', 'public.' || _t, 'delete') then
      raise exception '%: anon must hold no privilege', _t;
    end if;
  end loop;

  select count(*) into _deletes from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'group_invites' and cmd = 'DELETE';
  if _deletes <> 0 or has_table_privilege('authenticated', 'public.group_invites', 'delete') then
    raise exception 'group_invites: links are never deleted by a client';
  end if;

  if has_table_privilege('authenticated', 'public.group_invites', 'update')
     or not has_column_privilege('authenticated', 'public.group_invites', 'revoked_at', 'update')
     or has_column_privilege('authenticated', 'public.group_invites', 'max_uses', 'update')
     or has_column_privilege('authenticated', 'public.group_invites', 'expires_at', 'update') then
    raise exception 'group_invites: authenticated may update revoked_at and nothing else';
  end if;

  if has_table_privilege('authenticated', 'public.group_invite_uses', 'insert')
     or has_table_privilege('authenticated', 'public.group_invite_uses', 'update')
     or has_table_privilege('authenticated', 'public.group_invite_uses', 'delete') then
    raise exception 'group_invite_uses: authenticated must hold no table-level write privilege';
  end if;

  -- Default privileges grant EXECUTE to every API role on creation, so each
  -- role a function is not meant for has to be revoked by name.
  if has_function_privilege('anon', 'public.group_invite_redeem(uuid, text, text, text, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.group_invite_redeem(uuid, text, text, text, timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.group_invite_redeem(uuid, text, text, text, timestamptz)', 'execute') then
    raise exception 'group_invite_redeem: service_role only';
  end if;
  if has_function_privilege('anon', 'public.group_invite_join(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.group_invite_join(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.group_invite_join(uuid)', 'execute') then
    raise exception 'group_invite_join: authenticated only';
  end if;
end $$;
