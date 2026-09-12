-- Permissive rewrite — people &
-- households (profiles, family_units, family_members, family_invites,
-- member_groups, profile_groups).
--
-- Template: every policy is ORG AND (role arms), with ORG factored out
-- front exactly once — never `(ORG AND arm1) OR arm2`, which is how an org
-- predicate goes missing on one arm. The restrictive "org isolation" floor
-- already enforces isolation; this rewrite makes the org predicate visible
-- where a reader looks and fixes the arms that are semantically wrong at two
-- orgs (the profiles directory arm is the one known as the
-- directory-view leak: "any member" is its predicate, so without ORG it is
-- org-blind by construction).
--
-- ORG ::= org_id = (select public.app_request_org_id())

-- profiles -------------------------------------------------------------------

drop policy "Profiles are visible per access rules" on public.profiles;
create policy "Profiles are visible per access rules" on public.profiles
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select auth.uid()) = id
      or (select public.is_admin())
      or (
        family_id is not null
        and family_id = (select public.current_family_id())
        and (select auth.uid()) <> id
        and (select public.is_member())
      )
      or (
        -- Directory arm (T7)
        (select public.is_member())
        and is_unlisted = false
        and role = any (array['member', 'content_editor', 'admin'])
      )
    )
  );

drop policy "Profiles are updatable per access rules" on public.profiles;
create policy "Profiles are updatable per access rules" on public.profiles
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select auth.uid()) = id
      or (select public.is_admin())
      or (
        (select auth.uid()) <> id
        and family_id is not null
        and family_id = (select public.current_family_id())
        and (select public.is_household_manager())
      )
    )
  )
  with check (
    org_id = (select public.app_request_org_id())
    and (
      (
        (select auth.uid()) = id
        and role = (select public.get_own_role())
        and not (email is distinct from (select public.get_own_email()))
      )
      or (select public.is_admin())
      or (
        family_id = (select public.current_family_id())
        and role = public.get_profile_role(id)
        and not (email is distinct from public.get_profile_email(id))
      )
    )
  );

-- family_units ---------------------------------------------------------------

drop policy "Members can view family units" on public.family_units;
create policy "Members can view family units" on public.family_units
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Admins and members can update family units" on public.family_units;
create policy "Admins and members can update family units" on public.family_units
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or (id = (select public.current_family_id()) and (select public.is_member()))
    )
  )
  with check (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or (id = (select public.current_family_id()) and (select public.is_member()))
    )
  );

drop policy "Admins can insert family units" on public.family_units;
create policy "Admins can insert family units" on public.family_units
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can delete family units" on public.family_units;
create policy "Admins can delete family units" on public.family_units
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

-- family_members -------------------------------------------------------------

drop policy "Members can view family members" on public.family_members;
create policy "Members can view family members" on public.family_members
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Admins and household leaders can insert family members" on public.family_members;
create policy "Admins and household leaders can insert family members" on public.family_members
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or (
        family_id = (select public.current_family_id())
        and (select public.is_member())
        and exists (
          select 1 from public.profiles self
          where self.id = (select auth.uid())
            and self.relationship = any (array['primary', 'spouse'])
        )
      )
    )
  );

drop policy "Admins and household leaders can update family members" on public.family_members;
create policy "Admins and household leaders can update family members" on public.family_members
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or (
        family_id = (select public.current_family_id())
        and (select public.is_member())
        and exists (
          select 1 from public.profiles self
          where self.id = (select auth.uid())
            and self.relationship = any (array['primary', 'spouse'])
        )
      )
    )
  )
  with check (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or (
        family_id = (select public.current_family_id())
        and (select public.is_member())
        and exists (
          select 1 from public.profiles self
          where self.id = (select auth.uid())
            and self.relationship = any (array['primary', 'spouse'])
        )
      )
    )
  );

drop policy "Admins and household leaders can delete family members" on public.family_members;
create policy "Admins and household leaders can delete family members" on public.family_members
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or (
        family_id = (select public.current_family_id())
        and (select public.is_member())
        and exists (
          select 1 from public.profiles self
          where self.id = (select auth.uid())
            and self.relationship = any (array['primary', 'spouse'])
        )
      )
    )
  );

-- family_invites -------------------------------------------------------------

drop policy "Members can view family invites" on public.family_invites;
create policy "Members can view family invites" on public.family_invites
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Admins and household primary can insert family invites" on public.family_invites;
create policy "Admins and household primary can insert family invites" on public.family_invites
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.profiles self
        where self.id = (select auth.uid())
          and self.family_id = family_invites.family_id
          and self.family_id is not null
          and self.relationship = 'primary'
      )
    )
  );

drop policy "Admins and household primary can update family invites" on public.family_invites;
create policy "Admins and household primary can update family invites" on public.family_invites
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.profiles self
        where self.id = (select auth.uid())
          and self.family_id = family_invites.family_id
          and self.family_id is not null
          and self.relationship = 'primary'
      )
    )
  )
  with check (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.profiles self
        where self.id = (select auth.uid())
          and self.family_id = family_invites.family_id
          and self.family_id is not null
          and self.relationship = 'primary'
      )
    )
  );

-- member_groups --------------------------------------------------------------

drop policy "Members can view member groups" on public.member_groups;
create policy "Members can view member groups" on public.member_groups
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Admins can insert member groups" on public.member_groups;
create policy "Admins can insert member groups" on public.member_groups
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can update member groups" on public.member_groups;
create policy "Admins can update member groups" on public.member_groups
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can delete member groups" on public.member_groups;
create policy "Admins can delete member groups" on public.member_groups
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

-- profile_groups -------------------------------------------------------------

drop policy "Members can view profile groups" on public.profile_groups;
create policy "Members can view profile groups" on public.profile_groups
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Admins can insert profile groups" on public.profile_groups;
create policy "Admins can insert profile groups" on public.profile_groups
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can update profile groups" on public.profile_groups;
create policy "Admins can update profile groups" on public.profile_groups
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can delete profile groups" on public.profile_groups;
create policy "Admins can delete profile groups" on public.profile_groups
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );
