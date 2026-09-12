-- Permissive rewrite — events &
-- calendars (events, event_calendars, rsvps, calendar_subscription_tokens).
--
-- event_calendars was the remaining blanket USING (true) read; it becomes
-- an org-resolved anon read (T8) like the content tables.

-- events ---------------------------------------------------------------------

drop policy "Members can view all events" on public.events;
create policy "Members can view all events" on public.events
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Admins can insert events" on public.events;
create policy "Admins can insert events" on public.events
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can update events" on public.events;
create policy "Admins can update events" on public.events
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can delete events" on public.events;
create policy "Admins can delete events" on public.events
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

-- event_calendars ------------------------------------------------------------

drop policy "Anyone can read event calendars" on public.event_calendars;
create policy "Anyone can read event calendars" on public.event_calendars
  for select to anon, authenticated
  using (org_id = (select public.app_request_org_id()));

drop policy "Admins can insert event calendars" on public.event_calendars;
create policy "Admins can insert event calendars" on public.event_calendars
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can update event calendars" on public.event_calendars;
create policy "Admins can update event calendars" on public.event_calendars
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can delete event calendars" on public.event_calendars;
create policy "Admins can delete event calendars" on public.event_calendars
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

-- rsvps ----------------------------------------------------------------------

drop policy "Members and admins can view rsvps" on public.rsvps;
create policy "Members and admins can view rsvps" on public.rsvps
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_member()) or (select public.is_admin()))
  );

drop policy "Members and admins can insert rsvps" on public.rsvps;
create policy "Members and admins can insert rsvps" on public.rsvps
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (
      ((select auth.uid()) = user_id and (select public.is_member()))
      or (select public.is_admin())
    )
  );

drop policy "Members and admins can update rsvps" on public.rsvps;
create policy "Members and admins can update rsvps" on public.rsvps
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      ((select auth.uid()) = user_id and (select public.is_member()))
      or (select public.is_admin())
    )
  )
  with check (
    org_id = (select public.app_request_org_id())
    and (
      ((select auth.uid()) = user_id and (select public.is_member()))
      or (select public.is_admin())
    )
  );

drop policy "Members and admins can delete rsvps" on public.rsvps;
create policy "Members and admins can delete rsvps" on public.rsvps
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      ((select auth.uid()) = user_id and (select public.is_member()))
      or (select public.is_admin())
    )
  );

-- calendar_subscription_tokens (T4 self-owned) -------------------------------

drop policy "Members can view own subscription token" on public.calendar_subscription_tokens;
create policy "Members can view own subscription token" on public.calendar_subscription_tokens
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select auth.uid()) = user_id
  );

drop policy "Members can create own subscription token" on public.calendar_subscription_tokens;
create policy "Members can create own subscription token" on public.calendar_subscription_tokens
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select auth.uid()) = user_id
  );

drop policy "Members can update own subscription token" on public.calendar_subscription_tokens;
create policy "Members can update own subscription token" on public.calendar_subscription_tokens
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select auth.uid()) = user_id
  )
  with check (
    org_id = (select public.app_request_org_id())
    and (select auth.uid()) = user_id
  );
