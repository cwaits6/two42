-- Permissive rewrite — prayer
-- (prayer_requests, prayer_responses, prayer_call_sessions).
--
-- Group-level scoping of the prayer wall (whether it shows one group's
-- requests or the whole org's) is deliberately NOT done here — it needs a
-- group_id column and a product decision; member-facing prayer
-- surfaces stay org-scoped here.

-- prayer_requests ------------------------------------------------------------

drop policy "Members can view visible prayer requests" on public.prayer_requests;
create policy "Members can view visible prayer requests" on public.prayer_requests
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
    and (
      author_id = (select auth.uid())
      or not visible_to_warriors
      or (visible_to_warriors and (select public.is_prayer_warrior()))
    )
  );

drop policy "Members can post own prayer requests" on public.prayer_requests;
create policy "Members can post own prayer requests" on public.prayer_requests
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
    and author_id = (select auth.uid())
  );

drop policy "Posters and admins can update prayer requests" on public.prayer_requests;
create policy "Posters and admins can update prayer requests" on public.prayer_requests
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      author_id = (select auth.uid())
      or (select public.is_admin())
    )
  );

drop policy "Posters and admins can delete prayer requests" on public.prayer_requests;
create policy "Posters and admins can delete prayer requests" on public.prayer_requests
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      author_id = (select auth.uid())
      or (select public.is_admin())
    )
  );

-- prayer_responses -----------------------------------------------------------
-- The EXISTS over prayer_requests runs as the invoking role, so it sees
-- prayer_requests through that table's own RLS (including its org floor):
-- a response is only visible/creatable when its request is.

drop policy "Members can view prayer responses" on public.prayer_responses;
create policy "Members can view prayer responses" on public.prayer_responses
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
    and exists (
      select 1 from public.prayer_requests r
      where r.id = prayer_responses.request_id
    )
  );

drop policy "Members can pray for visible requests" on public.prayer_responses;
create policy "Members can pray for visible requests" on public.prayer_responses
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
    and profile_id = (select auth.uid())
    and exists (
      select 1 from public.prayer_requests r
      where r.id = prayer_responses.request_id
    )
  );

drop policy "Members can withdraw own prayer responses" on public.prayer_responses;
create policy "Members can withdraw own prayer responses" on public.prayer_responses
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and profile_id = (select auth.uid())
  );

-- prayer_call_sessions -------------------------------------------------------

drop policy "Members can view prayer call sessions" on public.prayer_call_sessions;
create policy "Members can view prayer call sessions" on public.prayer_call_sessions
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Admins can insert prayer call sessions" on public.prayer_call_sessions;
create policy "Admins can insert prayer call sessions" on public.prayer_call_sessions
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can update prayer call sessions" on public.prayer_call_sessions;
create policy "Admins can update prayer call sessions" on public.prayer_call_sessions
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can delete prayer call sessions" on public.prayer_call_sessions;
create policy "Admins can delete prayer call sessions" on public.prayer_call_sessions
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );
