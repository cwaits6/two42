-- Permissive rewrite — serving
-- (serving_signups, serving_signup_attendees, serving_broadcasts,
-- serving_team_settings).
--
-- is_group_leader(group_id) takes a row-dependent argument, so it cannot be
-- InitPlan-hoisted like the zero-argument helpers; since Task 2 it carries
-- its own org check internally (the group must belong to the caller's org),
-- so a leader flag on another org's group never grants anything here.

-- serving_signups ------------------------------------------------------------

drop policy "Members can view serving signups" on public.serving_signups;
create policy "Members can view serving signups" on public.serving_signups
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Members can create serving signups" on public.serving_signups;
create policy "Members can create serving signups" on public.serving_signups
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and created_by = (select auth.uid())
    and (
      (select public.is_admin())
      or public.is_group_leader(group_id)
      or exists (
        select 1 from public.profile_groups pg
        where pg.profile_id = (select auth.uid())
          and pg.group_id = serving_signups.group_id
      )
    )
  );

drop policy "Members can delete own serving signups" on public.serving_signups;
create policy "Members can delete own serving signups" on public.serving_signups
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      created_by = (select auth.uid())
      or (select public.is_admin())
      or public.is_group_leader(group_id)
    )
  );

-- serving_signup_attendees ---------------------------------------------------

drop policy "Members can view serving attendees" on public.serving_signup_attendees;
create policy "Members can view serving attendees" on public.serving_signup_attendees
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Signup owners can add attendees" on public.serving_signup_attendees;
create policy "Signup owners can add attendees" on public.serving_signup_attendees
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and exists (
      select 1 from public.serving_signups s
      where s.id = serving_signup_attendees.signup_id
        and (
          s.created_by = (select auth.uid())
          or (select public.is_admin())
          or public.is_group_leader(s.group_id)
        )
    )
  );

drop policy "Signup owners can remove attendees" on public.serving_signup_attendees;
create policy "Signup owners can remove attendees" on public.serving_signup_attendees
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and exists (
      select 1 from public.serving_signups s
      where s.id = serving_signup_attendees.signup_id
        and (
          s.created_by = (select auth.uid())
          or (select public.is_admin())
          or public.is_group_leader(s.group_id)
        )
    )
  );

-- serving_broadcasts ---------------------------------------------------------

drop policy "Leaders and admins can view serving broadcasts" on public.serving_broadcasts;
create policy "Leaders and admins can view serving broadcasts" on public.serving_broadcasts
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or public.is_group_leader(group_id)
    )
  );

drop policy "Leaders and admins can log serving broadcasts" on public.serving_broadcasts;
create policy "Leaders and admins can log serving broadcasts" on public.serving_broadcasts
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and sent_by = (select auth.uid())
    and (
      (select public.is_admin())
      or public.is_group_leader(group_id)
    )
  );

-- serving_team_settings ------------------------------------------------------

drop policy "Members can view serving settings" on public.serving_team_settings;
create policy "Members can view serving settings" on public.serving_team_settings
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Leaders and admins can insert serving settings" on public.serving_team_settings;
create policy "Leaders and admins can insert serving settings" on public.serving_team_settings
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or public.is_group_leader(group_id)
    )
  );

drop policy "Leaders and admins can update serving settings" on public.serving_team_settings;
create policy "Leaders and admins can update serving settings" on public.serving_team_settings
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or public.is_group_leader(group_id)
    )
  );

drop policy "Admins can delete serving settings" on public.serving_team_settings;
create policy "Admins can delete serving settings" on public.serving_team_settings
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );
