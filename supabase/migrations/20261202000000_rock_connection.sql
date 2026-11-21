-- A church's connection to its own Rock RMS, and the two42 profiles a church
-- admin has confirmed as Rock people. two42 only reads from Rock.
--
-- The REST key is sealed by server code with ROCK_KEY_SECRET before it is
-- stored, and is never sent back to a browser, so no client role has any
-- privilege on either table: both are read and written by the service key in
-- server code that has already checked the caller is a church admin and
-- filters on that admin's own org_id.

create table public.rock_connections (
  -- Single-column FK: organizations is the tenant root and carries no org_id.
  org_id uuid primary key default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  base_url text not null check (base_url ~ '^https://[^/?#@]+$' and char_length(base_url) <= 300),
  key_ciphertext text not null,
  key_hint text not null check (char_length(key_hint) between 1 and 4),
  connected_by uuid,
  connected_at timestamptz not null default now(),
  constraint rock_connections_connected_by_fkey
    foreign key (connected_by, org_id) references public.profiles (id, org_id) on delete set null (connected_by)
);

create index rock_connections_connected_by_idx on public.rock_connections (connected_by) where connected_by is not null;

-- Disconnecting removes every link with the connection; the profiles stay as they are.
create table public.rock_person_links (
  org_id uuid not null default public.app_current_org_id()
    references public.rock_connections (org_id) on delete cascade,
  profile_id uuid not null,
  rock_person_id integer not null check (rock_person_id > 0),
  linked_by uuid,
  linked_at timestamptz not null default now(),
  primary key (org_id, profile_id),
  constraint rock_person_links_one_profile_per_person unique (org_id, rock_person_id),
  constraint rock_person_links_profile_id_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade,
  constraint rock_person_links_linked_by_fkey
    foreign key (linked_by, org_id) references public.profiles (id, org_id) on delete set null (linked_by)
);

create index rock_person_links_profile_id_idx on public.rock_person_links (profile_id);
create index rock_person_links_linked_by_idx on public.rock_person_links (linked_by) where linked_by is not null;

alter table public.rock_connections enable row level security;
alter table public.rock_person_links enable row level security;

create policy "org isolation" on public.rock_connections
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "org isolation" on public.rock_person_links
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

-- Supabase's default privileges grant ALL on a new public table to anon and
-- authenticated; neither gets anything here.
revoke all on public.rock_connections from anon, authenticated;
revoke all on public.rock_person_links from anon, authenticated;

comment on table public.rock_connections is
  'A church''s Rock RMS address and its REST key, sealed by the server with ROCK_KEY_SECRET. One row per church. Read and written by the service key only, after a church admin check; the key never leaves the server.';
comment on table public.rock_person_links is
  'Which Rock person a two42 profile is, as a church admin confirmed it. Goes with the profile, and with the connection when Rock is disconnected. Read and written by the service key only.';

-- The church admin's Rock page is counted like every other page.
create or replace function public.usage_page_patterns()
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
    '/admin/settings/rock',
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
