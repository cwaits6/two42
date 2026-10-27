-- A prayer request is the request itself, shared by name or anonymously.
-- The six-value category and the retired restricted tier both go away.
--
-- Rows still flagged visible_to_warriors were shared with a specific
-- audience that no longer exists; they have been author-only since the
-- prayer-access capability was removed, and widening them to every member is
-- not an option. Deleting them is the fail-safe resolution.
delete from public.prayer_requests where visible_to_warriors;

-- The read rule becomes org isolation plus group membership. The membership
-- helper takes a row-dependent argument, so it cannot be InitPlan-hoisted
-- like the zero-argument helpers.
drop policy "Group members can view visible prayer requests" on public.prayer_requests;
create policy "Group members can view prayer requests" on public.prayer_requests
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and public.is_group_member(group_id)
  );

-- create or replace cannot remove view columns, so the view is rebuilt.
drop view public.prayer_wall;

alter table public.prayer_requests
  drop constraint prayer_requests_category_check;
alter table public.prayer_requests
  drop column category,
  drop column visible_to_warriors;

-- Same shape as before minus the two columns: security_invoker keeps the
-- base-table RLS in force, author fields are nulled on anonymous rows for
-- everyone but the poster, and `mine` lets the poster find their own
-- anonymous requests.
create view public.prayer_wall
  with (security_invoker = true)
as
select
  r.id,
  r.body,
  r.is_anonymous,
  r.is_answered,
  r.created_at,
  (r.author_id = (select auth.uid())) as mine,
  case when r.is_anonymous and r.author_id <> (select auth.uid()) then null else p.first_name end as first_name,
  case when r.is_anonymous and r.author_id <> (select auth.uid()) then null else p.last_name end as last_name,
  case when r.is_anonymous and r.author_id <> (select auth.uid()) then null else p.preferred_name end as preferred_name,
  case when r.is_anonymous and r.author_id <> (select auth.uid()) then null else p.avatar_url end as avatar_url,
  coalesce(pc.praying_count, 0) as praying_count,
  coalesce(pc.i_am_praying, false) as i_am_praying,
  r.org_id,
  r.group_id
from public.prayer_requests r
left join public.profiles p on p.id = r.author_id and p.org_id = r.org_id
left join lateral (
  select count(*)::integer as praying_count,
         bool_or(pr.profile_id = (select auth.uid())) as i_am_praying
  from public.prayer_responses pr
  where pr.request_id = r.id and pr.org_id = r.org_id
) pc on true
where r.org_id = (select public.app_request_org_id());

grant select on public.prayer_wall to authenticated;
