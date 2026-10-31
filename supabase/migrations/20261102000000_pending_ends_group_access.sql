-- A person moved back to pending keeps their group_members and team_members
-- rows, so approving them again restores every group, team and leader role
-- with no re-adding. Access is ended here instead: each group helper, and
-- the direct team_members arm of the serving-signup RPC, now also requires
-- the caller's profile to be non-pending.
--
-- The serving_signups INSERT policy's own team_members arm needs no change:
-- its subquery runs under team_members RLS, which reads is_group_member().

-- create or replace keeps each function's owner and execute grants.
create or replace function public.is_team_lead(_team_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    join public.profiles p on p.id = tm.profile_id and p.org_id = tm.org_id
    where tm.profile_id = auth.uid()
      and tm.team_id = _team_id
      and tm.is_leader = true
      and tm.org_id = public.app_current_org_id()
      and p.role <> 'pending'
  );
$$;

create or replace function public.is_group_member(_group_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    join public.profiles p on p.id = gm.profile_id and p.org_id = gm.org_id
    where gm.profile_id = auth.uid()
      and gm.group_id = _group_id
      and gm.org_id = public.app_current_org_id()
      and p.role <> 'pending'
  );
$$;

create or replace function public.is_group_leader(_group_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    join public.profiles p on p.id = gm.profile_id and p.org_id = gm.org_id
    where gm.profile_id = auth.uid()
      and gm.group_id = _group_id
      and gm.role = 'leader'
      and gm.org_id = public.app_current_org_id()
      and p.role <> 'pending'
  );
$$;

comment on function public.is_team_lead(uuid) is
  'True when the caller (auth.uid()) is a non-pending lead of the given team in their own org.';
comment on function public.is_group_member(uuid) is
  'True when the caller (auth.uid()) is a non-pending member of the given group in their own org. Caller resolved from auth.uid() only.';
comment on function public.is_group_leader(uuid) is
  'True when the caller (auth.uid()) is a non-pending leader of the given group in their own org. Caller resolved from auth.uid() only.';

create or replace function public.serving_signup_create(
  _group_id     uuid,
  _service_date date,
  _attendee_ids uuid[]
) returns table (signup_id uuid, signup_org_id uuid, created boolean)
  language plpgsql security definer set search_path = ''
as $$
declare
  _actor uuid;
  _org uuid;
  _grp uuid;
begin
  _actor := auth.uid();
  if _actor is null then
    raise exception 'serving signup rejected: no authenticated principal'
      using errcode = 'SV002';
  end if;

  select t.org_id, t.group_id into _org, _grp
  from public.teams t
  where t.id = _group_id;

  if _org is null or _org is distinct from public.app_request_org_id() then
    raise exception 'serving signup rejected: group % does not resolve to the request org', _group_id
      using errcode = 'SV002';
  end if;

  -- The RLS INSERT policy's arms, re-implemented because SECURITY DEFINER
  -- bypasses the policy. Bare helper calls are correct here — the
  -- (select ...) InitPlan rule applies to policy expressions only.
  if not (
    public.is_team_lead(_group_id)
    or public.is_group_leader(_grp)
    or exists (
      select 1 from public.team_members tm
      join public.profiles p on p.id = tm.profile_id and p.org_id = tm.org_id
      where tm.profile_id = _actor
        and tm.team_id = _group_id
        and tm.org_id = _org
        and p.role <> 'pending'
    )
  ) then
    raise exception 'serving signup rejected: actor % is not on team %', _actor, _group_id
      using errcode = 'SV004';
  end if;

  return query
  select * from public.serving_signup_apply(_group_id, _service_date, _actor, _attendee_ids);
end;
$$;

comment on function public.serving_signup_create(uuid, date, uuid[]) is
  'Authenticated serving signup entry point. Actor from auth.uid(); tenant anchor: the team''s org pinned against app_request_org_id(), fail-closed on NULL; the RLS INSERT-policy arms (non-pending team member, team lead, or a leader of the team''s group) are re-checked before delegating to serving_signup_apply().';
