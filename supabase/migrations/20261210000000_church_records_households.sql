-- Households from the church's records, as suggestions. The refresh reads each
-- linked person's family and stores what it means for two42: a household
-- grouping for the church admin to confirm, the family's address and home
-- phone for a household already linked to its family, and, while the church
-- has the children switch on, the family's children for the household's
-- adults to add or dismiss. Nothing here changes a household until a person
-- confirms it.
--
-- Every table is org-owned. The service key writes them through the
-- functions below, passing an org the caller already holds; members read
-- their own household's sources and suggested children, and add or dismiss a
-- child through two SECURITY DEFINER functions that resolve the org and
-- household from the caller's own profile.

-- The church-wide switch for suggesting children. It belongs to the church,
-- not to a connection, so it survives reconnecting.
create table public.records_org_settings (
  -- Single-column FK: organizations is the tenant root and carries no org_id.
  org_id uuid primary key default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  suggest_children boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint records_org_settings_updated_by_fkey
    foreign key (updated_by, org_id) references public.profiles (id, org_id) on delete set null (updated_by)
);

create index records_org_settings_updated_by_idx on public.records_org_settings (updated_by)
  where updated_by is not null;

-- A household the church admin confirmed as one family in the records. Goes
-- with the connection, since a family id means nothing in other records.
create table public.records_household_links (
  org_id uuid not null default public.app_current_org_id(),
  family_id uuid not null,
  connection_id uuid not null,
  external_family_id text not null check (char_length(external_family_id) between 1 and 100),
  confirmed_by uuid,
  confirmed_at timestamptz not null default now(),
  primary key (org_id, family_id),
  unique (org_id, connection_id, external_family_id),
  constraint records_household_links_family_fkey
    foreign key (family_id, org_id) references public.family_units (id, org_id) on delete cascade,
  constraint records_household_links_connection_fkey
    foreign key (org_id, connection_id) references public.records_connections (org_id, connection_id) on delete cascade,
  constraint records_household_links_confirmed_by_fkey
    foreign key (confirmed_by, org_id) references public.profiles (id, org_id) on delete set null (confirmed_by)
);

create index records_household_links_family_id_idx on public.records_household_links (family_id);
create index records_household_links_confirmed_by_idx on public.records_household_links (confirmed_by)
  where confirmed_by is not null;

-- Where a linked household's address and home phone came from, with the same
-- states as records_field_values: 'records' follows the church, 'changed' and
-- 'cleared' are the household's own from then on. Kept per household rather
-- than per person, so a clear holds whichever adult the copy reads next. Goes
-- with the household's link.
create table public.records_household_values (
  org_id uuid not null default public.app_current_org_id(),
  family_id uuid not null,
  field text not null check (field in ('address', 'phone_home')),
  state text not null check (state in ('records', 'changed', 'cleared')),
  church_value jsonb not null default '{}'::jsonb check (jsonb_typeof(church_value) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (org_id, family_id, field),
  constraint records_household_values_link_fkey
    foreign key (org_id, family_id) references public.records_household_links (org_id, family_id) on delete cascade
);

create index records_household_values_family_id_idx on public.records_household_values (family_id);

-- The refresh's household suggestions, replaced in full on each refresh that
-- reads every family. people holds each person whose household or
-- relationship changes: [{profile_id, from_family_id, relationship}]. basis
-- holds every linked person it was worked out from, as linked and housed
-- then: [{profile_id, external_person_id, family_id}].
create table public.records_household_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id(),
  connection_id uuid not null,
  external_family_id text not null check (char_length(external_family_id) between 1 and 100),
  target_family_id uuid,
  family_name text check (char_length(family_name) between 1 and 200),
  people jsonb not null check (jsonb_typeof(people) = 'array'),
  basis jsonb not null default '[]'::jsonb check (jsonb_typeof(basis) = 'array'),
  ready boolean not null,
  created_at timestamptz not null default now(),
  unique (org_id, connection_id, external_family_id),
  unique (id, org_id),
  constraint records_household_suggestions_target_check check ((target_family_id is null) = (family_name is not null)),
  constraint records_household_suggestions_connection_fkey
    foreign key (org_id, connection_id) references public.records_connections (org_id, connection_id) on delete cascade,
  constraint records_household_suggestions_target_fkey
    foreign key (target_family_id, org_id) references public.family_units (id, org_id) on delete cascade
);

create index records_household_suggestions_target_family_id_idx on public.records_household_suggestions (target_family_id)
  where target_family_id is not null;

-- Children of a linked household's family, suggested to its adults. 'open'
-- holds what two42 copies for a child: names, birthday month and day, grade
-- and the photo's token, and never a birth year. 'added' and 'dismissed' keep
-- no details, only the record that the household decided, so the child is
-- never suggested again; an added child's photo token waits for the next
-- refresh to fetch it.
create table public.records_child_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.app_current_org_id(),
  family_id uuid not null,
  external_person_id text not null check (char_length(external_person_id) between 1 and 100),
  state text not null default 'open' check (state in ('open', 'added', 'dismissed')),
  first_name text check (char_length(first_name) between 1 and 100),
  last_name text check (char_length(last_name) between 1 and 100),
  birth_month smallint check (birth_month between 1 and 12),
  birth_day smallint check (birth_day >= 1 and birth_day <= (array[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])[birth_month]),
  graduation_year smallint check (graduation_year between 2000 and 2100),
  photo text check (char_length(photo) between 1 and 100),
  family_member_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, family_id, external_person_id),
  unique (id, org_id),
  constraint records_child_suggestions_open_check
    check (state <> 'open' or (first_name is not null and last_name is not null)),
  constraint records_child_suggestions_decided_check
    check (state = 'open' or (first_name is null and last_name is null and birth_month is null
                              and birth_day is null and graduation_year is null)),
  constraint records_child_suggestions_dismissed_check check (state <> 'dismissed' or photo is null),
  constraint records_child_suggestions_birthday_check check ((birth_month is null) = (birth_day is null)),
  constraint records_child_suggestions_link_fkey
    foreign key (org_id, family_id) references public.records_household_links (org_id, family_id) on delete cascade,
  constraint records_child_suggestions_member_fkey
    foreign key (family_member_id, org_id) references public.family_members (id, org_id) on delete set null (family_member_id),
  constraint records_child_suggestions_decided_by_fkey
    foreign key (decided_by, org_id) references public.profiles (id, org_id) on delete set null (decided_by)
);

create index records_child_suggestions_family_id_idx on public.records_child_suggestions (family_id);
create index records_child_suggestions_family_member_id_idx on public.records_child_suggestions (family_member_id)
  where family_member_id is not null;
create index records_child_suggestions_decided_by_idx on public.records_child_suggestions (decided_by)
  where decided_by is not null;

alter table public.records_org_settings enable row level security;
alter table public.records_household_links enable row level security;
alter table public.records_household_values enable row level security;
alter table public.records_household_suggestions enable row level security;
alter table public.records_child_suggestions enable row level security;

create policy "org isolation" on public.records_org_settings
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "org isolation" on public.records_household_links
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "org isolation" on public.records_household_values
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "org isolation" on public.records_household_suggestions
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "org isolation" on public.records_child_suggestions
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

-- Supabase's default privileges grant ALL on a new public table to anon and
-- authenticated; each gets only what is granted back below.
revoke all on public.records_org_settings from anon, authenticated;
revoke all on public.records_household_links from anon, authenticated;
revoke all on public.records_household_values from anon, authenticated;
revoke all on public.records_household_suggestions from anon, authenticated;
revoke all on public.records_child_suggestions from anon, authenticated;

-- Read by the suggested children's policy below, which runs as the member.
grant select (org_id, suggest_children) on public.records_org_settings to authenticated;
create policy "Members read the church's records settings" on public.records_org_settings
  for select to authenticated
  using (org_id = (select public.app_request_org_id()));

-- The household form shows which of its details came from the records, to
-- the people who read the household's own details.
grant select (org_id, family_id, field, state, church_value) on public.records_household_values to authenticated;
create policy "Household members read their household's value sources" on public.records_household_values
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or (family_id = (select public.current_family_id()) and (select public.is_member()))
    )
  );

-- The household's primary and spouse see its suggested children, and only
-- while the church suggests children. Never the child's id in the records or
-- photo token.
grant select (id, org_id, family_id, state, first_name, last_name, birth_month, birth_day, graduation_year, created_at)
  on public.records_child_suggestions to authenticated;
create policy "A household's adults read its suggested children" on public.records_child_suggestions
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and state = 'open'
    and family_id = (select public.current_family_id())
    and (select public.is_household_manager())
    and exists (
      select 1 from public.records_org_settings s
       where s.org_id = records_child_suggestions.org_id and s.suggest_children
    )
  );

-- The household field names join the person fields a church admin chooses a
-- setting for. They are not in records_field_settings_lockable's list, so
-- they are always the members' to change.
alter table public.records_field_settings drop constraint records_field_settings_field_check;
alter table public.records_field_settings add constraint records_field_settings_field_check check (field in (
  'name', 'suffix', 'title', 'gender', 'phone_mobile', 'phone_work',
  'birthday', 'anniversary', 'photo', 'grade', 'address', 'phone_home'
));

-- As before, and a household field turned off also loses its sources.
create or replace function public.records_save_field_settings(_org_id uuid, _settings jsonb, _updated_by uuid)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  _before jsonb;
  _after jsonb;
  _running timestamptz;
begin
  -- Before a church's first refresh there is no row to lock, so one is made.
  insert into public.records_refresh_state (org_id, connection_id)
  select org_id, connection_id from public.records_connections where org_id = _org_id
  on conflict (org_id) do nothing;
  select running_since into _running from public.records_refresh_state
   where org_id = _org_id
     for update;
  if _running is not null and _running > now() - interval '15 minutes' then
    return 'busy';
  end if;

  select coalesce(jsonb_object_agg(field, mode), '{}'::jsonb) into _before
    from public.records_field_settings where org_id = _org_id;

  delete from public.records_field_settings
   where org_id = _org_id and not (_settings ? field);

  insert into public.records_field_settings (org_id, field, mode, updated_by, updated_at)
  select _org_id, s.key, s.value #>> '{}', _updated_by, now()
    from jsonb_each(_settings) as s
  on conflict (org_id, field) do update
    set mode = excluded.mode, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    where public.records_field_settings.mode is distinct from excluded.mode;

  select coalesce(jsonb_object_agg(field, mode), '{}'::jsonb) into _after
    from public.records_field_settings where org_id = _org_id;
  if _after = _before then
    return 'saved';
  end if;

  delete from public.records_field_values v
   where v.org_id = _org_id
     and not (_after ? (case v.field when 'preferred_name' then 'name' else v.field end));

  delete from public.records_household_values v
   where v.org_id = _org_id and not (_after ? v.field);

  update public.records_person_state set copied_at = null
   where org_id = _org_id and copied_at is not null;
  return 'saved';
end;
$$;

revoke execute on function public.records_save_field_settings(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.records_save_field_settings(uuid, jsonb, uuid) to service_role;

-- Saves the children switch. Turning it off removes every suggested child the
-- household hasn't decided on and every photo token still waiting, so nothing
-- about a child is kept while it is off; the records of a household's
-- decisions stay, so a dismissed child stays dismissed. Answers 'busy',
-- saving nothing, while a refresh holds its claim, since that run read the
-- switch when it started and would keep suggesting children and fetching
-- their photos; the 15 minutes match the claim's lease, as in
-- records_save_field_settings().
--
-- SECURITY INVOKER and executable by the service role only: the caller is
-- server code that has checked the church admin and passes that admin's org.
create function public.records_save_children_setting(_org_id uuid, _on boolean, _updated_by uuid)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  _running timestamptz;
begin
  insert into public.records_refresh_state (org_id, connection_id)
  select org_id, connection_id from public.records_connections where org_id = _org_id
  on conflict (org_id) do nothing;
  select running_since into _running from public.records_refresh_state
   where org_id = _org_id
     for update;
  if _running is not null and _running > now() - interval '15 minutes' then
    return 'busy';
  end if;

  insert into public.records_org_settings (org_id, suggest_children, updated_by, updated_at)
  values (_org_id, _on, _updated_by, now())
  on conflict (org_id) do update
    set suggest_children = excluded.suggest_children, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  if not _on then
    delete from public.records_child_suggestions where org_id = _org_id and state = 'open';
    update public.records_child_suggestions set photo = null, updated_at = now()
     where org_id = _org_id and photo is not null;
  end if;
  return 'saved';
end;
$$;

revoke execute on function public.records_save_children_setting(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.records_save_children_setting(uuid, boolean, uuid) to service_role;

-- Replaces the connection's household suggestions with the refresh's. Changes
-- no household. A suggestion into a household deleted since the refresh read
-- it is left out.
--
-- SECURITY INVOKER and executable by the service role only, like
-- records_save_children_setting().
create function public.records_replace_household_suggestions(_org_id uuid, _connection_id uuid, _suggestions jsonb)
  returns integer
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  _count integer;
begin
  delete from public.records_household_suggestions
   where org_id = _org_id and connection_id = _connection_id;
  insert into public.records_household_suggestions
    (org_id, connection_id, external_family_id, target_family_id, family_name, people, basis, ready)
  select _org_id, _connection_id, s.external_family_id, s.target_family_id, s.family_name, s.people,
         coalesce(s.basis, '[]'::jsonb), s.ready
    from jsonb_to_recordset(coalesce(_suggestions, '[]'::jsonb))
      as s(external_family_id text, target_family_id uuid, family_name text, people jsonb, basis jsonb, ready boolean)
   where s.target_family_id is null
      or exists (
        select 1 from public.family_units f where f.id = s.target_family_id and f.org_id = _org_id
      );
  get diagnostics _count = row_count;
  return _count;
end;
$$;

revoke execute on function public.records_replace_household_suggestions(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.records_replace_household_suggestions(uuid, uuid, jsonb) to service_role;

-- The church admin's confirmation of one household suggestion, all or
-- nothing: puts exactly the people it names in its household, with the
-- relationships it names, makes the household when the suggestion is for a
-- new one, and links the household to its family. Whoever stays behind, and
-- the household they stay in, is left as it is.
--
-- Answers 'stale', changing nothing, when anyone it names or was worked out
-- from has moved, been unlinked or relinked, or is no longer approved, or its
-- household is now linked to
-- another family or holds a primary or spouse it didn't; 'gone' for a
-- suggestion not in this church; and 'busy' while a refresh holds its claim,
-- since that run is replacing the suggestions. The 15 minutes match the
-- claim's lease in supabase/functions/_shared/records-refresh.ts.
--
-- SECURITY INVOKER and executable by the service role only, like
-- records_save_children_setting().
create function public.records_confirm_household(_org_id uuid, _suggestion_id uuid, _confirmed_by uuid)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  _s public.records_household_suggestions%rowtype;
  _running timestamptz;
  _target uuid;
  _ids uuid[];
begin
  insert into public.records_refresh_state (org_id, connection_id)
  select org_id, connection_id from public.records_connections where org_id = _org_id
  on conflict (org_id) do nothing;
  select running_since into _running from public.records_refresh_state
   where org_id = _org_id
     for update;
  if _running is not null and _running > now() - interval '15 minutes' then
    return 'busy';
  end if;

  select * into _s from public.records_household_suggestions
   where id = _suggestion_id and org_id = _org_id
     for update;
  if not found then
    return 'gone';
  end if;

  _ids := array(select (p ->> 'profile_id')::uuid from jsonb_array_elements(_s.people) as p);
  perform 1 from public.profiles where org_id = _org_id
     and (id = any (_ids) or id in (select (b ->> 'profile_id')::uuid from jsonb_array_elements(_s.basis) as b))
   order by id for update;
  -- Locked so none of the links the suggestion rests on can end or change before it is written.
  perform 1 from public.records_person_links
   where org_id = _org_id and connection_id = _s.connection_id
     and profile_id in (select (b ->> 'profile_id')::uuid from jsonb_array_elements(_s.basis) as b)
   order by profile_id for update;
  if exists (
    select 1 from jsonb_array_elements(_s.basis) as b
     where not exists (
       select 1 from public.profiles pr
         join public.records_person_links l
           on l.org_id = pr.org_id and l.profile_id = pr.id and l.connection_id = _s.connection_id
        where pr.id = (b ->> 'profile_id')::uuid
          and pr.org_id = _org_id
          and pr.role in ('member', 'admin')
          and l.external_person_id = b ->> 'external_person_id'
          and pr.family_id is not distinct from (b ->> 'family_id')::uuid
     )
  ) then
    return 'stale';
  end if;
  if exists (
    select 1 from jsonb_array_elements(_s.people) as p
     where not exists (
       select 1 from public.profiles pr
         join public.records_person_links l
           on l.org_id = pr.org_id and l.profile_id = pr.id and l.connection_id = _s.connection_id
        where pr.id = (p ->> 'profile_id')::uuid
          and pr.org_id = _org_id
          and pr.role in ('member', 'admin')
          and pr.family_id is not distinct from (p ->> 'from_family_id')::uuid
     )
  ) then
    return 'stale';
  end if;

  if exists (
    select 1 from public.records_household_links
     where org_id = _org_id and connection_id = _s.connection_id
       and external_family_id = _s.external_family_id
       and family_id is distinct from _s.target_family_id
  ) then
    return 'stale';
  end if;

  _target := _s.target_family_id;
  if _target is not null then
    perform 1 from public.family_units where id = _target and org_id = _org_id for update;
    if not found then
      return 'stale';
    end if;
    if exists (
      select 1 from public.records_household_links
       where org_id = _org_id and family_id = _target
         and (connection_id <> _s.connection_id or external_family_id <> _s.external_family_id)
    ) then
      return 'stale';
    end if;
    if exists (
      select 1 from public.profiles o
       where o.org_id = _org_id and o.family_id = _target
         and not (o.id = any (_ids))
         and o.relationship in (
           select p ->> 'relationship' from jsonb_array_elements(_s.people) as p
            where p ->> 'relationship' in ('primary', 'spouse')
         )
    ) then
      return 'stale';
    end if;
  else
    insert into public.family_units (org_id, family_name)
    values (_org_id, _s.family_name)
    returning id into _target;
  end if;

  update public.profiles pr
     set family_id = _target, relationship = p.relationship
    from jsonb_to_recordset(_s.people) as p(profile_id uuid, relationship text)
   where pr.id = p.profile_id and pr.org_id = _org_id;

  insert into public.records_household_links (org_id, family_id, connection_id, external_family_id, confirmed_by)
  values (_org_id, _target, _s.connection_id, _s.external_family_id, _confirmed_by)
  on conflict (org_id, family_id) do nothing;

  delete from public.records_household_suggestions where id = _s.id and org_id = _org_id;
  return 'confirmed';
end;
$$;

revoke execute on function public.records_confirm_household(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.records_confirm_household(uuid, uuid, uuid) to service_role;

-- Writes one linked household's address and home phone, and their sources,
-- all or nothing. _expected holds the family the copy was read from, the
-- household's columns and each field's state as the copy read them; if a
-- member saved anything since, nothing is written and the answer is 'stale'.
-- Answers 'gone' for a household not in this church and 'unlinked' for one no
-- longer linked to that family.
--
-- SECURITY INVOKER and executable by the service role only, like
-- records_save_children_setting(). Running as the service role is also what
-- keeps records_household_value_edit() from counting these writes as a
-- member's edit.
create function public.records_apply_household_copy(
  _org_id uuid,
  _connection_id uuid,
  _family_id uuid,
  _expected jsonb,
  _household jsonb,
  _values jsonb
) returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  _family public.family_units%rowtype;
  _key text;
begin
  select * into _family from public.family_units
   where id = _family_id and org_id = _org_id
     for update;
  if not found then
    return 'gone';
  end if;
  -- Locked, and the refresh's own connection, so a replaced connection's run can't write.
  perform 1 from public.records_household_links
   where org_id = _org_id and family_id = _family_id and connection_id = _connection_id
     and external_family_id = _expected ->> 'family'
     for share;
  if not found then
    return 'unlinked';
  end if;

  for _key in select jsonb_object_keys(coalesce(_expected -> 'household', '{}'::jsonb)) loop
    if public.records_pick(to_jsonb(_family), array[_key]) <> public.records_pick(_expected -> 'household', array[_key]) then
      return 'stale';
    end if;
  end loop;
  for _key in select jsonb_object_keys(coalesce(_expected -> 'states', '{}'::jsonb)) loop
    if (select v.state from public.records_household_values v
         where v.org_id = _org_id and v.family_id = _family_id and v.field = _key)
       is distinct from (_expected -> 'states' ->> _key) then
      return 'stale';
    end if;
  end loop;

  if _household <> '{}'::jsonb then
    update public.family_units set
      address_line1 = case when _household ? 'address_line1' then _household ->> 'address_line1' else address_line1 end,
      address_line2 = case when _household ? 'address_line2' then _household ->> 'address_line2' else address_line2 end,
      city = case when _household ? 'city' then _household ->> 'city' else city end,
      state = case when _household ? 'state' then _household ->> 'state' else state end,
      postal_code = case when _household ? 'postal_code' then _household ->> 'postal_code' else postal_code end,
      phone_home = case when _household ? 'phone_home' then _household ->> 'phone_home' else phone_home end
    where id = _family_id and org_id = _org_id;
  end if;

  insert into public.records_household_values (org_id, family_id, field, state, church_value, updated_at)
  select _org_id, _family_id, v.field, v.state, v.church_value, now()
    from jsonb_to_recordset(coalesce(_values, '[]'::jsonb)) as v(field text, state text, church_value jsonb)
  on conflict (org_id, family_id, field) do update
    set state = excluded.state, church_value = excluded.church_value, updated_at = excluded.updated_at
    where (public.records_household_values.state, public.records_household_values.church_value)
          is distinct from (excluded.state, excluded.church_value);
  return 'applied';
end;
$$;

revoke execute on function public.records_apply_household_copy(uuid, uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.records_apply_household_copy(uuid, uuid, uuid, jsonb, jsonb, jsonb) to service_role;

-- Brings a linked household's suggested children up to date with its family:
-- a new child is suggested, an open suggestion takes the records' latest
-- details, and one the family no longer has is removed. A child the
-- household added or dismissed is never suggested again. Does nothing while
-- the church's children switch is off, or once the household is no longer
-- linked to that family.
--
-- SECURITY INVOKER and executable by the service role only, like
-- records_save_children_setting().
create function public.records_sync_child_suggestions(
  _org_id uuid,
  _connection_id uuid,
  _family_id uuid,
  _external_family_id text,
  _children jsonb
) returns integer
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  _count integer;
begin
  if not exists (select 1 from public.records_org_settings where org_id = _org_id and suggest_children) then
    return 0;
  end if;
  -- Locked so the link can't end, and its suggestions with it, while they are written.
  perform 1 from public.records_household_links
   where org_id = _org_id and family_id = _family_id and connection_id = _connection_id
     and external_family_id = _external_family_id
     for share;
  if not found then
    return 0;
  end if;

  insert into public.records_child_suggestions
    (org_id, family_id, external_person_id, first_name, last_name, birth_month, birth_day, graduation_year, photo)
  select _org_id, _family_id, c.external_person_id, c.first_name, c.last_name, c.birth_month, c.birth_day,
         c.graduation_year, c.photo
    from jsonb_to_recordset(coalesce(_children, '[]'::jsonb)) as c(
      external_person_id text, first_name text, last_name text,
      birth_month smallint, birth_day smallint, graduation_year smallint, photo text
    )
  on conflict (org_id, family_id, external_person_id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        birth_month = excluded.birth_month,
        birth_day = excluded.birth_day,
        graduation_year = excluded.graduation_year,
        photo = excluded.photo,
        updated_at = now()
    where public.records_child_suggestions.state = 'open'
      and (public.records_child_suggestions.first_name, public.records_child_suggestions.last_name,
           public.records_child_suggestions.birth_month, public.records_child_suggestions.birth_day,
           public.records_child_suggestions.graduation_year, public.records_child_suggestions.photo)
          is distinct from
          (excluded.first_name, excluded.last_name, excluded.birth_month, excluded.birth_day,
           excluded.graduation_year, excluded.photo);
  get diagnostics _count = row_count;

  delete from public.records_child_suggestions s
   where s.org_id = _org_id and s.family_id = _family_id and s.state = 'open'
     and not exists (
       select 1 from jsonb_array_elements(coalesce(_children, '[]'::jsonb)) as c
        where c ->> 'external_person_id' = s.external_person_id
     );
  return _count;
end;
$$;

revoke execute on function public.records_sync_child_suggestions(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.records_sync_child_suggestions(uuid, uuid, uuid, text, jsonb) to service_role;

-- A household's primary or spouse adds a suggested child to their household,
-- as a child without an account: first and last name, birthday month and day,
-- and grade, with no birth year. The photo follows at the next refresh.
-- Returns the household member's id: the new one, or the one already in the
-- household under the child's name.
--
-- SECURITY DEFINER because members have no write grant on the suggestions.
-- The org and household come from auth.uid()'s own profile, never a
-- parameter, and the suggestion must be that household's, open, and in a
-- church with the children switch on; otherwise it raises RC001, so another
-- household's suggestion reads the same as a missing one.
create function public.records_add_suggested_child(_suggestion_id uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _me public.profiles%rowtype;
  _s public.records_child_suggestions%rowtype;
  _id uuid;
begin
  select * into _me from public.profiles
   where id = auth.uid() and org_id = public.app_current_org_id()
     for update;
  if not found or _me.role not in ('member', 'admin') or _me.relationship not in ('primary', 'spouse')
     or _me.family_id is null then
    raise exception 'records_add_suggested_child: no such suggestion' using errcode = 'RC001';
  end if;
  select * into _s from public.records_child_suggestions
   where id = _suggestion_id and org_id = _me.org_id and family_id = _me.family_id and state = 'open'
     for update;
  if not found or not exists (
    select 1 from public.records_org_settings where org_id = _me.org_id and suggest_children
  ) then
    raise exception 'records_add_suggested_child: no such suggestion' using errcode = 'RC001';
  end if;

  -- Someone in the household already under the same name, entered since the
  -- refresh, is this child: the suggestion is settled by them, not a second
  -- entry. The name key folds case, Latin accents, spaces and punctuation.
  select m.id into _id from public.family_members m
   where m.org_id = _me.org_id and m.family_id = _me.family_id
     and lower(regexp_replace(normalize(coalesce(m.first_name, ''), NFKD), '[\u0300-\u036f[:space:][:punct:]]', '', 'g'))
       = lower(regexp_replace(normalize(_s.first_name, NFKD), '[\u0300-\u036f[:space:][:punct:]]', '', 'g'))
     and lower(regexp_replace(normalize(coalesce(m.last_name, ''), NFKD), '[\u0300-\u036f[:space:][:punct:]]', '', 'g'))
       = lower(regexp_replace(normalize(_s.last_name, NFKD), '[\u0300-\u036f[:space:][:punct:]]', '', 'g'))
   order by m.id
   limit 1;
  if _id is null then
    insert into public.family_members
      (org_id, family_id, first_name, last_name, relationship, birth_month, birth_day, graduation_year, is_class_member)
    values
      (_me.org_id, _me.family_id, _s.first_name, _s.last_name, 'child', _s.birth_month, _s.birth_day,
       _s.graduation_year, false)
    returning id into _id;
  end if;

  update public.records_child_suggestions
     set state = 'added', family_member_id = _id, decided_by = _me.id, decided_at = now(),
         first_name = null, last_name = null, birth_month = null, birth_day = null, graduation_year = null,
         updated_at = now()
   where id = _s.id and org_id = _me.org_id;
  return _id;
end;
$$;

-- A household's primary or spouse dismisses a suggested child; they aren't
-- suggested again. The same checks as records_add_suggested_child().
create function public.records_dismiss_suggested_child(_suggestion_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _me public.profiles%rowtype;
begin
  select * into _me from public.profiles
   where id = auth.uid() and org_id = public.app_current_org_id()
     for update;
  if not found or _me.role not in ('member', 'admin') or _me.relationship not in ('primary', 'spouse')
     or _me.family_id is null
     or not exists (select 1 from public.records_org_settings where org_id = _me.org_id and suggest_children) then
    raise exception 'records_dismiss_suggested_child: no such suggestion' using errcode = 'RC001';
  end if;
  update public.records_child_suggestions
     set state = 'dismissed', decided_by = _me.id, decided_at = now(),
         first_name = null, last_name = null, birth_month = null, birth_day = null, graduation_year = null,
         photo = null, updated_at = now()
   where id = _suggestion_id and org_id = _me.org_id and family_id = _me.family_id and state = 'open';
  if not found then
    raise exception 'records_dismiss_suggested_child: no such suggestion' using errcode = 'RC001';
  end if;
end;
$$;

revoke execute on function public.records_add_suggested_child(uuid) from public, anon;
revoke execute on function public.records_dismiss_suggested_child(uuid) from public, anon;
grant execute on function public.records_add_suggested_child(uuid) to authenticated;
grant execute on function public.records_dismiss_suggested_child(uuid) to authenticated;

-- A member's edit of a linked household's address or home phone marks it
-- changed, cleared, or back to the church's value, on any screen that saves a
-- household. family_units_phone_owner_guard fires first, by name, so a spouse
-- choosing their own number has already cleared phone_home and reads as a
-- clear. Only a signed-in person's write counts; the refresh writes as the
-- service role and passes through.
--
-- SECURITY DEFINER because the sources it writes have no member write grant.
-- The org and household come from the row being updated, never a parameter.
create function public.records_household_value_edit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _value record;
  _columns text[];
  _state text;
begin
  if coalesce(current_setting('role', true), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  for _value in
    select v.field, v.church_value from public.records_household_values v
     where v.org_id = old.org_id and v.family_id = old.id
  loop
    _columns := case _value.field
      when 'address' then array['address_line1', 'address_line2', 'city', 'state', 'postal_code']
      else array['phone_home']
    end;
    continue when public.records_pick(to_jsonb(new), _columns) = public.records_pick(to_jsonb(old), _columns);
    _state := public.records_edit_state(to_jsonb(new), _value.church_value, _columns);
    update public.records_household_values
       set state = _state, updated_at = now()
     where org_id = old.org_id and family_id = old.id and field = _value.field and state <> _state;
  end loop;
  return new;
end;
$$;

create trigger records_household_value_edit
  before update of address_line1, address_line2, city, state, postal_code, phone_home, phone_profile_id
  on public.family_units
  for each row execute function public.records_household_value_edit();

-- A trigger function is never called directly; EXECUTE is checked only when
-- the trigger is created, so the trigger still fires for every role.
revoke execute on function public.records_household_value_edit() from public, anon, authenticated;

comment on table public.records_org_settings is
  'A church''s church-records switches: whether children in a linked household''s family are suggested to its adults. Off by default. Members read it; only the service key writes it, through records_save_children_setting().';
comment on table public.records_household_links is
  'A household a church admin confirmed as one family in the church''s records. Service key only; goes with the connection.';
comment on table public.records_household_values is
  'Per linked household: whether its address and home phone came from the church''s records or the household changed or cleared them, and the church''s last value. Read by the household''s members and church admins; written only by the service key and records_household_value_edit(). Goes with the household''s link.';
comment on table public.records_household_suggestions is
  'The church records refresh''s household groupings for the church admin to confirm. Service key only; goes with the connection.';
comment on table public.records_child_suggestions is
  'Children of a linked household''s family, suggested to the household''s primary and spouse while the church''s children switch is on, and the household''s decision on each. Never holds a birth year. Members read their own household''s open suggestions and decide through records_add_suggested_child() and records_dismiss_suggested_child().';
comment on function public.records_confirm_household(uuid, uuid, uuid) is
  'A church admin''s confirmation of one household suggestion, all or nothing; service key only.';
comment on function public.records_add_suggested_child(uuid) is
  'A household''s primary or spouse adds a suggested child as a child without an account, with no birth year. Org and household from auth.uid()''s profile.';
comment on function public.records_dismiss_suggested_child(uuid) is
  'A household''s primary or spouse dismisses a suggested child, who is never suggested again. Org and household from auth.uid()''s profile.';
