-- Permissive rewrite — content &
-- pages (page_content, about_page, class_teachers, lectures, lecture_series,
-- announcements).
--
-- The four blanket `USING (true)` reads (page_content, lectures,
-- lecture_series — event_calendars is in the events domain) become
-- org-resolved anon reads (T8): anon traffic resolves its org via the
-- x-two42-org header through app_request_org_id(), so public content is
-- tenant-aware instead of tenant-blind. No public flag exists on these
-- tables — all their rows are public by design; the org predicate is the
-- entire change. Fail-closed: an anon request with no resolvable org sees
-- nothing, not another tenant's content.

-- page_content ---------------------------------------------------------------

drop policy "Anyone can read page content" on public.page_content;
create policy "Anyone can read page content" on public.page_content
  for select to anon, authenticated
  using (org_id = (select public.app_request_org_id()));

drop policy "Editors can insert page content" on public.page_content;
create policy "Editors can insert page content" on public.page_content
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_content_editor())
  );

drop policy "Editors can update page content" on public.page_content;
create policy "Editors can update page content" on public.page_content
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_content_editor())
  );

drop policy "Admins can delete page content" on public.page_content;
create policy "Admins can delete page content" on public.page_content
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

-- about_page -----------------------------------------------------------------

drop policy "Members can read about page" on public.about_page;
create policy "Members can read about page" on public.about_page
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Editors can insert about page" on public.about_page;
create policy "Editors can insert about page" on public.about_page
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_content_editor())
  );

drop policy "Editors can update about page" on public.about_page;
create policy "Editors can update about page" on public.about_page
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_content_editor())
  );

-- class_teachers -------------------------------------------------------------

drop policy "Members can read class teachers" on public.class_teachers;
create policy "Members can read class teachers" on public.class_teachers
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_member())
  );

drop policy "Editors can insert class teachers" on public.class_teachers;
create policy "Editors can insert class teachers" on public.class_teachers
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_content_editor())
  );

drop policy "Editors can update class teachers" on public.class_teachers;
create policy "Editors can update class teachers" on public.class_teachers
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_content_editor())
  );

drop policy "Editors can delete class teachers" on public.class_teachers;
create policy "Editors can delete class teachers" on public.class_teachers
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_content_editor())
  );

-- lectures -------------------------------------------------------------------

drop policy "Lectures visible to all" on public.lectures;
create policy "Lectures visible to all" on public.lectures
  for select to anon, authenticated
  using (org_id = (select public.app_request_org_id()));

drop policy "Admins can insert lectures" on public.lectures;
create policy "Admins can insert lectures" on public.lectures
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can update lectures" on public.lectures;
create policy "Admins can update lectures" on public.lectures
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can delete lectures" on public.lectures;
create policy "Admins can delete lectures" on public.lectures
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

-- lecture_series -------------------------------------------------------------

drop policy "Series visible to all" on public.lecture_series;
create policy "Series visible to all" on public.lecture_series
  for select to anon, authenticated
  using (org_id = (select public.app_request_org_id()));

drop policy "Admins can insert series" on public.lecture_series;
create policy "Admins can insert series" on public.lecture_series
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can update series" on public.lecture_series;
create policy "Admins can update series" on public.lecture_series
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can delete series" on public.lecture_series;
create policy "Admins can delete series" on public.lecture_series
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

-- announcements --------------------------------------------------------------
-- Published/member OR arm: written as ORG AND (member OR published), never
-- with ORG missing from either side of the OR (the composition rule). Anon
-- keeps read access to published announcements, now org-resolved.

drop policy "Members and published announcements are visible" on public.announcements;
create policy "Members and published announcements are visible" on public.announcements
  for select to anon, authenticated
  using (
    org_id = (select public.app_request_org_id())
    and ((select public.is_member()) or is_published = true)
  );

drop policy "Admins can insert announcements" on public.announcements;
create policy "Admins can insert announcements" on public.announcements
  for insert to authenticated
  with check (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can update announcements" on public.announcements;
create policy "Admins can update announcements" on public.announcements
  for update to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );

drop policy "Admins can delete announcements" on public.announcements;
create policy "Admins can delete announcements" on public.announcements
  for delete to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (select public.is_admin())
  );
