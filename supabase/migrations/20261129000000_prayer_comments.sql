-- Comments on prayer requests. Like request text, a comment is sealed by server
-- code with the prayer keys, and a writer who hides their name is stored only as
-- a keyed hash of the comment and writer ids. Who may read a comment depends on
-- that hash and on an anonymous request's author hash, neither of which the
-- database can compute, so only trusted server code holding the keys reads or
-- writes this table: no client role has any privilege on it.

create table public.prayer_comments (
  id uuid primary key,
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  request_id uuid not null,
  writer_id uuid,
  writer_hash text,
  body_ciphertext text not null,
  only_asker boolean not null default false,
  hide_name boolean not null default false,
  created_at timestamptz not null default now(),
  constraint prayer_comments_request_id_fkey
    foreign key (request_id, org_id) references public.prayer_requests (id, org_id) on delete cascade,
  -- MATCH SIMPLE: a hidden-name comment's null writer_id skips this key.
  constraint prayer_comments_writer_id_fkey
    foreign key (writer_id, org_id) references public.profiles (id, org_id) on delete cascade,
  constraint prayer_comments_one_writer check (num_nonnulls(writer_id, writer_hash) = 1),
  constraint prayer_comments_hidden_has_hash check (hide_name = (writer_hash is not null))
);

create index prayer_comments_request_idx on public.prayer_comments (org_id, request_id, created_at);
create index prayer_comments_writer_id_idx on public.prayer_comments (writer_id) where writer_id is not null;

alter table public.prayer_comments enable row level security;

create policy "org isolation" on public.prayer_comments
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

revoke all on public.prayer_comments from anon, authenticated;

comment on table public.prayer_comments is
  'Comments on prayer requests: text sealed by the server, a hidden-name writer stored only as a keyed hash. Read and written by the service key only, in server code that decides who sees each comment; goes with its request and, when named, with its writer.';

-- A hidden-name comment reaches its writer through no foreign key, so the caller
-- finds the person's ones by recomputing the hash and passes their ids. Only
-- hidden-name comments of the person's own church among them are deleted.
drop function public.delete_person(uuid, uuid, uuid[]);

create function public.delete_person(
  _person_id uuid,
  _org_id uuid,
  _anonymous_request_ids uuid[] default '{}',
  _hidden_comment_ids uuid[] default '{}'
)
  returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare
  _org uuid;
  _role text;
  _profile_email text;
  _family uuid;
  _first_name text;
  _last_name text;
  _preferred_name text;
  _login_email text;
  _today date;
  _date record;
  _opened jsonb := '[]'::jsonb;
  _addresses text[];
  _own_entries uuid[];
  _outcomes jsonb;
  _household_entries uuid[] := '{}';
  _household_goes boolean := false;
  _own_uses uuid[];
  _linked_requests uuid[];
  _accepted_tokens uuid[];
  _photo_keys text[];
begin
  select p.org_id, p.role, p.email, p.family_id, p.first_name, p.last_name, p.preferred_name
    into _org, _role, _profile_email, _family, _first_name, _last_name, _preferred_name
  from public.profiles p
  where p.id = _person_id;

  if _org is null or _org is distinct from _org_id then
    raise exception 'delete_person: no such person in this church' using errcode = 'AD001';
  end if;

  if exists (select 1 from public.platform_admins a where a.profile_id = _person_id) then
    raise exception 'delete_person: a platform operator can''t be deleted here' using errcode = 'AD002';
  end if;

  -- The same lock profiles_keep_one_church_admin takes, held from here so this
  -- refusal comes before any write. The trigger still decides at the delete, for
  -- a person made an admin since the read above.
  if _role = 'admin' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('public.profiles:church_admin'), pg_catalog.hashtext(_org::text));
    if not exists (
      select 1 from public.profiles p
      where p.org_id = _org and p.role = 'admin' and p.id <> _person_id
    ) then
      raise exception 'delete_person: a church needs at least one church admin' using errcode = 'CA001';
    end if;
  end if;

  -- After the lock, so a second delete of the same person waits here and then
  -- finds no row, rather than reaching the writes below.
  select u.email into _login_email from auth.users u where u.id = _person_id for update;
  if not found then
    raise exception 'delete_person: no such person in this church' using errcode = 'AD001';
  end if;

  select (pg_catalog.now() at time zone o.timezone)::date into _today
  from public.organizations o where o.id = _org;

  -- serving_signups.created_by cascades, so a date this person booked and shares
  -- has to move first. A future date left with nobody on it opens up, and the
  -- caller tells the team's leaders. A past one is history: it stays unless the
  -- created_by cascade takes it, because they booked it themself.
  for _date in
    select s.id, s.created_by, s.service_date, s.team_id, t.group_id, t.name as team_name,
           (select a.profile_id from public.serving_signup_attendees a
             where a.signup_id = s.id and a.org_id = _org and a.profile_id <> _person_id
             order by a.profile_id limit 1) as remaining
    from public.serving_signups s
    join public.teams t on t.id = s.team_id and t.org_id = s.org_id
    where s.org_id = _org
      and (s.created_by = _person_id
           or exists (select 1 from public.serving_signup_attendees a
                       where a.signup_id = s.id and a.org_id = _org and a.profile_id = _person_id))
    for update of s
  loop
    if _date.remaining is not null then
      if _date.created_by = _person_id then
        update public.serving_signups set created_by = _date.remaining
        where id = _date.id and org_id = _org;
      end if;
    elsif _date.service_date >= _today then
      delete from public.serving_signups where id = _date.id and org_id = _org;
      _opened := _opened || jsonb_build_object(
        'team_id', _date.team_id,
        'group_id', _date.group_id,
        'team_name', _date.team_name,
        'service_date', _date.service_date);
    end if;
  end loop;

  select coalesce(array_agg(distinct a), '{}') into _addresses
  from unnest(array[pg_catalog.lower(_profile_email), pg_catalog.lower(_login_email)]) as a
  where a is not null;

  select coalesce(array_agg(m.id), '{}') into _own_entries
  from public.family_members m
  where m.org_id = _org and m.claimed_profile_id = _person_id;

  -- Everything at an address they still hold is theirs, since group_invite_redeem()
  -- refuses an address with a profile. An address they have left may be shared and
  -- nothing records whose a row there is, so only a request linked to them through
  -- an invite goes, and not one with a setup link waiting: theirs was spent when
  -- they signed up, so that link is for someone else, who reused the row.
  select coalesce(array_agg(u.id), '{}'),
         coalesce(array_agg(u.access_request_id) filter (where u.access_request_id is not null), '{}')
    into _own_uses, _linked_requests
  from public.group_invite_uses u
  where u.org_id = _org and u.profile_id = _person_id;

  select coalesce(array_agg(i.token), '{}') into _accepted_tokens
  from public.family_invites i
  where i.org_id = _org and i.family_member_id = any (_own_entries) and i.accepted_at is not null;

  delete from public.family_invites i
  where i.org_id = _org and i.accepted_at is null and pg_catalog.lower(i.invite_email) = any (_addresses);

  -- The rows stay, because max_uses counts them: without them a used-up link
  -- would admit someone again. The profile link clears through its foreign key.
  -- group_invite_uses_signup_has_email requires an email on signup_sent, and the
  -- placeholder can't equal an address, since group_invite_redeem() requires an @.
  update public.group_invite_uses u
     set email = case when u.outcome = 'signup_sent' then 'deleted' end,
         access_request_id = null
   where u.org_id = _org
     and (u.id = any (_own_uses)
          or (u.profile_id is null and pg_catalog.lower(u.email) = any (_addresses)));

  delete from public.access_requests r
  where r.org_id = _org
    and (pg_catalog.lower(r.email) = any (_addresses)
         or (r.signup_token is null
             and (r.id = any (_linked_requests) or r.invite_token = any (_accepted_tokens))));

  _outcomes := public.person_deletion_outcomes(_person_id, _org);
  _household_goes := coalesce((_outcomes #>> '{household,goes}')::boolean, false);
  if _household_goes then
    select coalesce(array_agg((e ->> 'id')::uuid), '{}') into _household_entries
    from jsonb_array_elements(_outcomes #> '{household,entries}') as e;
  end if;

  select coalesce(array_agg(o.name), '{}') into _photo_keys
  from storage.objects o
  where o.bucket_id = 'avatars'
    and (o.name like _org || '/profiles/' || _person_id || '/%'
         or o.name like _person_id || '/%'
         or exists (select 1 from unnest(_own_entries || _household_entries) as e(id)
                     where o.name like _org || '/family-members/' || e.id || '/%'
                        or o.name like 'family-members/' || e.id || '/%')
         or (_household_goes and (o.name like _org || '/families/' || _family || '/%'
                                  or o.name like 'families/' || _family || '/%')));

  -- The foreign key would only unclaim it, leaving them listed in the household.
  delete from public.family_members m where m.org_id = _org and m.id = any (_own_entries);

  if _household_goes then
    delete from public.family_units f where f.org_id = _org and f.id = _family;
  end if;

  delete from public.prayer_requests r
  where r.org_id = _org
    and r.is_anonymous
    and (r.author_id is null or r.author_id = _person_id)
    and r.id = any (coalesce(_anonymous_request_ids, '{}'));

  -- Named comments go with the profile's cascade, and comments on their requests
  -- with those requests.
  delete from public.prayer_comments c
  where c.org_id = _org
    and c.writer_id is null
    and c.id = any (coalesce(_hidden_comment_ids, '{}'));

  delete from auth.users u where u.id = _person_id;
  if not found then
    raise exception 'delete_person: the login was gone before it could be deleted' using errcode = 'AD001';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(_outcomes -> 'funds') as o (id uuid, recipient_id uuid)
    where not exists (
      select 1 from public.giving_funds f
      where f.org_id = _org
        and f.id = o.id
        and f.steward_id is not distinct from o.recipient_id
        and f.needs_review)
  ) then
    raise exception 'delete_person: a fund didn''t end as its outcome said' using errcode = 'AD003';
  end if;

  return jsonb_build_object(
    'first_name', _first_name,
    'last_name', _last_name,
    'preferred_name', _preferred_name,
    'email', _profile_email,
    'opened_dates', _opened,
    'photo_keys', to_jsonb(_photo_keys));
end;
$$;

revoke execute on function public.delete_person(uuid, uuid, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.delete_person(uuid, uuid, uuid[], uuid[]) to service_role;

comment on function public.delete_person(uuid, uuid, uuid[], uuid[]) is
  'Deletes one person and their login in a single transaction, and returns the storage keys and opened serving dates for the caller to act on after commit. _anonymous_request_ids are the person''s anonymous requests, which the caller finds by their author hash, plus those still carrying their author_id, which the backfill may hash meanwhile; only anonymous rows of the person''s church among them that are hashed or name the person are deleted. _hidden_comment_ids are the person''s hidden-name prayer comments, found the same way by their writer hash; only hidden-name comments of the person''s church among them are deleted. Tenant anchor: org_id from the target''s profile row; _org_id is only compared with it. service_role only. Raises AD001, AD002, CA001 or AD003.';
