-- Permissive rewrite — settings &
-- access (site_settings, access_requests, feedback).

-- site_settings --------------------------------------------------------------
-- Two SELECT arms as before: members read everything in their org, anon
-- reads only rows flagged is_public, now org-resolved.

drop policy "Members can read settings" on public.site_settings;
create policy "Members can read settings" on public.site_settings
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Anon can read public settings" on public.site_settings;
create policy "Anon can read public settings" on public.site_settings
  for select to anon, authenticated
  using (
    org_id = (select public.app_request_org_id())
    and is_public
  );

drop policy "Admins can update settings" on public.site_settings;
create policy "Admins can update settings" on public.site_settings
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

-- access_requests ------------------------------------------------------------
-- T9: the "anyone can request access" path stays open to anon but is now
-- org-pinned — the inserted row's org must match the org the request
-- resolves to (the x-two42-org header for anon, the caller's own org when
-- authenticated). The bare `WITH CHECK (true)` disappears.
--
-- The row must also arrive un-reviewed. status = 'approved' is the signup
-- trust anchor (handle_new_user() mints a member profile from it), and the
-- status CHECK alone would let anyone self-approve straight through
-- PostgREST. Review fields and signup tokens are only ever set server-side
-- (admin approve / invite flows run as service_role, which bypasses RLS),
-- so a public insert carrying any of them is forged.

drop policy "Anyone can submit access request" on public.access_requests;
create policy "Anyone can submit access request" on public.access_requests
  for insert to anon, authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and signup_token is null
    and token_expires_at is null
  );

drop policy "Admins can view access requests" on public.access_requests;
create policy "Admins can view access requests" on public.access_requests
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can update access requests" on public.access_requests;
create policy "Admins can update access requests" on public.access_requests
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

-- feedback -------------------------------------------------------------------

drop policy "Members can submit their own feedback" on public.feedback;
create policy "Members can submit their own feedback" on public.feedback
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select auth.uid()) = profile_id
    and (select public.is_member())
  );

drop policy "Admins can read feedback" on public.feedback;
create policy "Admins can read feedback" on public.feedback
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );
