-- No client role can read prayer_requests.author_id. The wall reaches the
-- author only through prayer_request_visible_author(), which returns it to the
-- author, and for a by-name request to whoever may see that author's profile.
-- Column privileges are what close the indirect routes: filtering, ordering,
-- RETURNING and embeds all need SELECT on the column. RLS policies are exempt
-- from them, so the policies keep using author_id.

-- The by-name arm mirrors the profiles read policy, because a definer function
-- is not subject to it. Returning the id where the policy hides the name would
-- let those requests be linked to each other.
create function public.prayer_request_visible_author(_request_id uuid)
  returns uuid
  language sql stable security definer set search_path = ''
as $$
  select r.author_id
  from public.prayer_requests r
  join public.profiles p on p.id = r.author_id and p.org_id = r.org_id
  where r.id = _request_id
    and r.org_id = public.app_request_org_id()
    and public.is_group_member(r.group_id)
    and (
      r.author_id = auth.uid()
      or (
        not r.is_anonymous
        and (
          public.is_admin()
          or (p.family_id is not null and p.family_id = public.current_family_id())
          or (
            not p.is_unlisted
            and p.role in ('member', 'admin')
            and (public.org_directory_visible() or public.shares_group_with(p.id))
          )
        )
      )
    );
$$;
revoke execute on function public.prayer_request_visible_author(uuid) from public, anon, service_role;
grant execute on function public.prayer_request_visible_author(uuid) to authenticated;

-- offset 0 keeps the function call from being flattened into the join and
-- evaluated once per reference to its result.
create or replace view public.prayer_wall
  with (security_invoker = true)
as
select
  r.id,
  r.body,
  r.is_anonymous,
  r.is_answered,
  r.created_at,
  coalesce(a.author_id = (select auth.uid()), false) as mine,
  p.first_name,
  p.last_name,
  p.preferred_name,
  p.avatar_url,
  coalesce(pc.praying_count, 0) as praying_count,
  coalesce(pc.i_am_praying, false) as i_am_praying,
  r.org_id,
  r.group_id
from public.prayer_requests r
cross join lateral (select public.prayer_request_visible_author(r.id) as author_id offset 0) a
left join public.profiles p on p.id = a.author_id and p.org_id = r.org_id
left join lateral (
  select count(*)::integer as praying_count,
         bool_or(pr.profile_id = (select auth.uid())) as i_am_praying
  from public.prayer_responses pr
  where pr.request_id = r.id and pr.org_id = r.org_id
) pc on true
where r.org_id = (select public.app_request_org_id());

-- ADD COLUMN adds nothing to a column-level grant, so a new column on this
-- table is unreadable and unwritable until it is listed here. INSERT stays at
-- table level: the app names the author on insert, and the policy pins it to
-- auth.uid().
revoke select, update on public.prayer_requests from anon, authenticated;
grant select (id, org_id, group_id, body, is_anonymous, is_answered, created_at, updated_at)
  on public.prayer_requests to anon, authenticated;
grant update (id, org_id, group_id, body, is_anonymous, is_answered, created_at, updated_at)
  on public.prayer_requests to anon, authenticated;

-- A leader may edit a request, but flipping is_anonymous would unmask its
-- author, and a WITH CHECK cannot compare the new value to the old one.
create function public.prayer_requests_author_sets_anonymity()
  returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and auth.uid() is distinct from old.author_id then
    raise exception 'only the author can change whether a request is anonymous'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger prayer_requests_author_sets_anonymity
  before update of is_anonymous on public.prayer_requests
  for each row when (old.is_anonymous is distinct from new.is_anonymous)
  execute function public.prayer_requests_author_sets_anonymity();

-- Changing a person's id trips whichever foreign key points at them first, and
-- that error's constraint name would say whether they have written a request.
-- Refusing before any foreign key fires gives everyone the same answer.
create function public.profiles_keep_id()
  returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'a profile id cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger profiles_keep_id
  before update of id on public.profiles
  for each row when (old.id is distinct from new.id)
  execute function public.profiles_keep_id();
