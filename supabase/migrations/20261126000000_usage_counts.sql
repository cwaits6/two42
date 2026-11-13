-- Usage counts: how often each page of a church's space was opened, and how
-- often one showed its error state, one running total per church, per UTC
-- day, per route pattern. Nothing here identifies a person: no account, no
-- address, no ids, no device, and no order of pages, so no one's path through
-- the app can be rebuilt from it. The counts go with the church through the
-- cascade on org_id and hold nothing delete_person() has to remove.
--
-- usage_count_record() is a SECURITY DEFINER writer of an org-owned table, so
-- the checks in its body replace RLS: the church is the signed-in person's own
-- (app_request_org_id()), never a parameter, and a pattern is stored only when
-- it is one of usage_page_patterns(), so text from a browser is never stored.

create table public.usage_counts (
  -- Single-column FK: organizations is the tenant root and carries no org_id.
  org_id uuid not null default public.app_current_org_id()
    references public.organizations(id) on delete cascade,
  usage_date date not null,
  kind text not null check (kind in ('view', 'error')),
  pattern text not null,
  total integer not null check (total > 0),
  primary key (org_id, usage_date, kind, pattern)
);

alter table public.usage_counts enable row level security;

create policy "org isolation" on public.usage_counts
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

-- Church-wide lists are for church admins; a count in a small church can
-- point at one member, so members read none.
create policy "Church admins can read usage counts" on public.usage_counts
  for select to authenticated
  using ((select public.is_admin()));

-- Supabase's default privileges grant ALL on a new public table to anon and
-- authenticated; usage_count_record() is the only writer.
revoke all on public.usage_counts from anon, authenticated;
grant select on public.usage_counts to authenticated;

-- Every page under app/, as its route pattern: PAGE_PATTERNS in
-- lib/analytics/pagePattern.ts, which lib/analytics/usagePatterns.test.ts
-- holds this list equal to. A page added there needs a migration that
-- replaces this function, or its views are refused.
create function public.usage_page_patterns()
  returns text[]
  language sql immutable set search_path = ''
as $$
  select array[
    '/',
    '/admin',
    '/admin/families',
    '/admin/groups',
    '/admin/groups/[id]',
    '/admin/invite',
    '/admin/members',
    '/admin/members/[id]',
    '/admin/members/invite',
    '/admin/requests',
    '/admin/settings',
    '/admin/settings/email',
    '/admin/usage',
    '/calendar',
    '/dashboard',
    '/directory',
    '/directory/anniversaries',
    '/directory/birthdays',
    '/directory/families',
    '/directory/groups',
    '/find-a-group',
    '/forgot-password',
    '/g/[groupId]/about',
    '/g/[groupId]/about/edit',
    '/g/[groupId]/announcements',
    '/g/[groupId]/announcements/[id]/edit',
    '/g/[groupId]/announcements/new',
    '/g/[groupId]/calendar',
    '/g/[groupId]/calendar/[id]',
    '/g/[groupId]/calendar/[id]/edit',
    '/g/[groupId]/calendar/new',
    '/g/[groupId]/dashboard',
    '/g/[groupId]/directory',
    '/g/[groupId]/directory/anniversaries',
    '/g/[groupId]/directory/birthdays',
    '/g/[groupId]/directory/families',
    '/g/[groupId]/directory/groups',
    '/g/[groupId]/give',
    '/g/[groupId]/give/[fundId]/edit',
    '/g/[groupId]/give/new',
    '/g/[groupId]/lectures',
    '/g/[groupId]/lectures/[id]',
    '/g/[groupId]/lectures/[id]/edit',
    '/g/[groupId]/lectures/new',
    '/g/[groupId]/lectures/series',
    '/g/[groupId]/lectures/series/[id]',
    '/g/[groupId]/lectures/series/[id]/edit',
    '/g/[groupId]/lectures/series/new',
    '/g/[groupId]/prayer',
    '/g/[groupId]/serving',
    '/g/[groupId]/serving/[teamId]',
    '/g/[groupId]/settings',
    '/g/[groupId]/settings/details',
    '/g/[groupId]/settings/invites',
    '/g/[groupId]/settings/labels',
    '/g/[groupId]/settings/privacy',
    '/g/[groupId]/settings/requests',
    '/g/[groupId]/settings/serving',
    '/g/[groupId]/settings/teams',
    '/household',
    '/join/[token]',
    '/join/family/[token]',
    '/login',
    '/platform',
    '/platform/organizations',
    '/platform/organizations/[id]',
    '/platform/usage',
    '/privacy',
    '/profile',
    '/profile/setup',
    '/serving/go',
    '/settings',
    '/setup-account',
    '/terms',
    '/update-password'
  ]::text[];
$$;

revoke execute on function public.usage_page_patterns() from public, anon, authenticated;

create function public.usage_count_record(_pattern text, _kind text)
  returns boolean
  language plpgsql security definer set search_path = ''
as $$
declare
  _org uuid := public.app_request_org_id();
begin
  if _org is null
     or _kind is null or _kind not in ('view', 'error')
     or _pattern is null or not (_pattern = any (public.usage_page_patterns())) then
    return false;
  end if;

  -- Concurrent views of one page on one day wait on this row's lock for one
  -- single-row update; other pages and churches do not contend.
  insert into public.usage_counts as u (org_id, usage_date, kind, pattern, total)
  values (_org, (now() at time zone 'utc')::date, _kind, _pattern, 1)
  on conflict (org_id, usage_date, kind, pattern)
  do update set total = u.total + 1;

  return true;
end;
$$;

revoke execute on function public.usage_count_record(text, text) from public, anon;
grant execute on function public.usage_count_record(text, text) to authenticated;

-- Invoker: on the request client RLS keeps a church admin to their own church
-- and gives anyone else no rows; on the service client _org_id is the bound.
create function public.usage_count_totals(_org_id uuid, _days integer)
  returns table (kind text, pattern text, total bigint)
  language sql stable security invoker set search_path = ''
as $$
  select u.kind, u.pattern, sum(u.total)::bigint
  from public.usage_counts u
  where u.org_id = _org_id
    and u.usage_date > (now() at time zone 'utc')::date - _days
  group by u.kind, u.pattern;
$$;

revoke execute on function public.usage_count_totals(uuid, integer) from public, anon;
grant execute on function public.usage_count_totals(uuid, integer) to authenticated, service_role;

create function public.usage_counts_prune(_org_id uuid, _before date, _limit integer)
  returns integer
  language sql security invoker set search_path = ''
as $$
  with doomed as (
    select u.usage_date, u.kind, u.pattern
    from public.usage_counts u
    where u.org_id = _org_id and u.usage_date < _before
    order by u.usage_date
    limit _limit
  ),
  gone as (
    delete from public.usage_counts u
    using doomed d
    where u.org_id = _org_id and u.usage_date = d.usage_date
      and u.kind = d.kind and u.pattern = d.pattern
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.usage_counts_prune(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.usage_counts_prune(uuid, date, integer) to service_role;

comment on table public.usage_counts is
  'Page views and error states per church, per UTC day, per route pattern. No column identifies a person. Written only by usage_count_record().';
comment on function public.usage_page_patterns() is
  'The route patterns usage_count_record() accepts: every page under app/, equal to PAGE_PATTERNS in lib/analytics/pagePattern.ts.';
comment on function public.usage_count_record(text, text) is
  'Adds one to today''s count of a page view or error state for the caller''s church. Tenant anchor: app_request_org_id(), never a parameter. Returns false and writes nothing for an unknown pattern or kind, or a caller with no church. authenticated only.';
comment on function public.usage_count_totals(uuid, integer) is
  'Totals per kind and pattern for one church over the last _days UTC days. Invoker: RLS bounds request-client callers; _org_id bounds the service role.';
comment on function public.usage_counts_prune(uuid, date, integer) is
  'Deletes at most _limit of one church''s usage counts dated before _before, oldest first, and returns how many went. Tenant anchor: the _org_id predicate on every row it reads and deletes. service_role only.';
