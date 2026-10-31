-- A team lead adds and removes the non-lead members of their own team.
--
-- The team-lead arm is pinned to is_leader = false on both sides: a lead
-- cannot add a lead, and cannot remove one (themselves included). There is
-- no UPDATE arm, so the lead flag stays with group leaders and church admins.
-- Who can be added is still bounded by team_members_require_group_membership:
-- only a member of the team's group.

drop policy "Leaders and admins can insert team members" on public.team_members;
drop policy "Leaders and admins can delete team members" on public.team_members;

create policy "Leaders, team leads and admins can insert team members" on public.team_members
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.teams t
        where t.id = team_members.team_id
          and t.org_id = team_members.org_id
          and public.is_group_leader(t.group_id)
      )
      or (public.is_team_lead(team_id) and is_leader = false)
    )
  );

create policy "Leaders, team leads and admins can delete team members" on public.team_members
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.teams t
        where t.id = team_members.team_id
          and t.org_id = team_members.org_id
          and public.is_group_leader(t.group_id)
      )
      or (public.is_team_lead(team_id) and is_leader = false)
    )
  );
