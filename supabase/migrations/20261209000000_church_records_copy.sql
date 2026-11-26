-- Copying members' details from the church's records into two42, field by
-- field. A church admin chooses a setting for each field; two42 keeps, per
-- person and field, where the value came from, so a member's edit or clear
-- can stop that field updating and "Use your church's value" can take it back.
--
-- Field names are two42's own (name, suffix, title, gender, phone_mobile,
-- phone_work, birthday, anniversary, photo, grade, and preferred_name, which
-- follows name), never a provider's. Every table here is org-owned and is
-- written by server code with the service key, which filters on an org it
-- already holds; members write nothing here except having seen their notice.

-- Which fields the church fills from its records. No row: not from the records.
create table public.records_field_settings (
  -- Single-column FK: organizations is the tenant root and carries no org_id.
  -- The settings belong to the church, not to a connection, so they survive
  -- reconnecting.
  org_id uuid not null default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  field text not null check (field in (
    'name', 'suffix', 'title', 'gender', 'phone_mobile', 'phone_work',
    'birthday', 'anniversary', 'photo', 'grade'
  )),
  mode text not null check (mode in ('locked', 'member')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (org_id, field),
  -- Contact details, dates and the photo are always the member's to change.
  constraint records_field_settings_lockable
    check (mode = 'member' or field in ('name', 'suffix', 'title', 'gender', 'grade')),
  constraint records_field_settings_updated_by_fkey
    foreign key (updated_by, org_id) references public.profiles (id, org_id) on delete set null (updated_by)
);

create index records_field_settings_updated_by_idx on public.records_field_settings (updated_by)
  where updated_by is not null;

-- Where each linked person's values came from. 'records': two42 holds the
-- church's value and keeps it up to date. 'changed' / 'cleared': the member
-- changed or cleared it, and it is theirs from then on. church_value is the
-- church's value when last read, keyed by two42 column. Goes with the link, so
-- unlinking or disconnecting leaves the values as ordinary two42 data.
create table public.records_field_values (
  org_id uuid not null default public.app_current_org_id(),
  profile_id uuid not null,
  field text not null check (field in (
    'name', 'preferred_name', 'suffix', 'title', 'gender', 'phone_mobile',
    'phone_work', 'birthday', 'anniversary', 'photo', 'grade'
  )),
  state text not null check (state in ('records', 'changed', 'cleared')),
  church_value jsonb not null default '{}'::jsonb check (jsonb_typeof(church_value) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (org_id, profile_id, field),
  constraint records_field_values_link_fkey
    foreign key (org_id, profile_id) references public.records_person_links (org_id, profile_id) on delete cascade
);

create index records_field_values_profile_id_idx on public.records_field_values (profile_id);

-- Per linked person: whether their first copy is done, their one-time notice,
-- and why the church admin should review them.
create table public.records_person_state (
  org_id uuid not null default public.app_current_org_id(),
  profile_id uuid not null,
  -- Null: copy every field in full on the next refresh.
  copied_at timestamptz,
  notice_filled_at timestamptz,
  notice_seen_at timestamptz,
  review_reason text check (review_reason in ('inactive', 'missing')),
  review_since timestamptz,
  primary key (org_id, profile_id),
  constraint records_person_state_link_fkey
    foreign key (org_id, profile_id) references public.records_person_links (org_id, profile_id) on delete cascade
);

create index records_person_state_profile_id_idx on public.records_person_state (profile_id);

-- The refresh's place in the records and its claim against overlapping runs.
-- cursor is the provider's own "changed since" mark, meaningful only in the
-- records it came from, so it goes with the connection.
create table public.records_refresh_state (
  org_id uuid primary key default public.app_current_org_id()
    references public.organizations (id) on delete cascade,
  connection_id uuid not null,
  cursor text check (char_length(cursor) <= 100),
  last_refreshed_at timestamptz,
  last_counts jsonb not null default '{}'::jsonb,
  running_since timestamptz,
  constraint records_refresh_state_connection_fkey
    foreign key (org_id, connection_id) references public.records_connections (org_id, connection_id) on delete cascade
);

alter table public.records_field_settings enable row level security;
alter table public.records_field_values enable row level security;
alter table public.records_person_state enable row level security;
alter table public.records_refresh_state enable row level security;

create policy "org isolation" on public.records_field_settings
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "org isolation" on public.records_field_values
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "org isolation" on public.records_person_state
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "org isolation" on public.records_refresh_state
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

-- Supabase's default privileges grant ALL on a new public table to anon and
-- authenticated; each gets only what is granted back below.
revoke all on public.records_field_settings from anon, authenticated;
revoke all on public.records_field_values from anon, authenticated;
revoke all on public.records_person_state from anon, authenticated;
revoke all on public.records_refresh_state from anon, authenticated;

-- A member's profile form shows which fields are managed by the church.
grant select on public.records_field_settings to authenticated;
create policy "Members read the church's field settings" on public.records_field_settings
  for select to authenticated
  using (org_id = (select public.app_request_org_id()));

-- A person's own sources, and every person's for a church admin. Nobody else
-- reads them, a spouse included.
grant select on public.records_field_values to authenticated;
create policy "People read their own value sources" on public.records_field_values
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (profile_id = (select auth.uid()) or (select public.is_admin()))
  );

-- The notice is the only state a member reads or writes; the review reason
-- is read by the church admin's page through the service key.
grant select (profile_id, notice_filled_at, notice_seen_at) on public.records_person_state to authenticated;
grant update (notice_seen_at) on public.records_person_state to authenticated;
create policy "Members read their own notice" on public.records_person_state
  for select to authenticated
  using (org_id = (select public.app_request_org_id()) and profile_id = (select auth.uid()));
create policy "Members mark their own notice seen" on public.records_person_state
  for update to authenticated
  using (org_id = (select public.app_request_org_id()) and profile_id = (select auth.uid()))
  with check (org_id = (select public.app_request_org_id()) and profile_id = (select auth.uid()));

-- The two42 columns each field fills. Kept beside the copy rules in
-- supabase/functions/_shared/records-copy.ts (FIELD_COLUMNS).
create function public.records_field_columns(_field text)
  returns text[]
  language sql immutable set search_path = ''
as $$
  select case _field
    when 'name' then array['first_name', 'last_name']
    when 'preferred_name' then array['preferred_name']
    when 'suffix' then array['suffix']
    when 'title' then array['title']
    when 'gender' then array['gender']
    when 'phone_mobile' then array['phone_mobile']
    when 'phone_work' then array['phone_work']
    when 'birthday' then array['birth_month', 'birth_day', 'birth_year']
    when 'anniversary' then array['anniversary_month', 'anniversary_day', 'anniversary_year']
    when 'photo' then array['avatar_url']
    when 'grade' then array['graduation_year']
  end;
$$;

-- These columns of a row as an object, with an empty string as null, so
-- values compare the way a form saves them.
create function public.records_pick(_row jsonb, _columns text[])
  returns jsonb
  language sql immutable set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(c, case when _row -> c is null or _row -> c = '""'::jsonb then 'null'::jsonb else _row -> c end),
    '{}'::jsonb
  )
  from unnest(_columns) as c;
$$;

create function public.records_is_empty(_value jsonb)
  returns boolean
  language sql immutable set search_path = ''
as $$
  select not exists (select 1 from jsonb_each(_value) as e where e.value <> 'null'::jsonb);
$$;

-- What a member's edit means for each value from the records: a clear is
-- 'cleared', the church's own value is 'records' again, anything else is
-- 'changed'.
create function public.records_edit_state(_new jsonb, _church_value jsonb, _columns text[])
  returns text
  language sql immutable set search_path = ''
as $$
  select case
    when public.records_is_empty(public.records_pick(_new, _columns)) then 'cleared'
    when public.records_pick(_new, _columns) = public.records_pick(_church_value, _columns) then 'records'
    else 'changed'
  end;
$$;

revoke execute on function public.records_field_columns(text) from public, anon, authenticated;
revoke execute on function public.records_pick(jsonb, text[]) from public, anon, authenticated;
revoke execute on function public.records_is_empty(jsonb) from public, anon, authenticated;
revoke execute on function public.records_edit_state(jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.records_pick(jsonb, text[]) to service_role;

-- Saves the church admin's settings in one transaction. A field turned off
-- loses its sources, so its values are ordinary two42 data from then on. Any
-- change asks the next refresh to copy everyone in full, which is how a field
-- just turned on gets filled.
--
-- SECURITY INVOKER and executable by the service role only: the caller is
-- server code that has checked the church admin and passes that admin's org.
create function public.records_save_field_settings(_org_id uuid, _settings jsonb, _updated_by uuid)
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  _before jsonb;
  _after jsonb;
begin
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
    return;
  end if;

  delete from public.records_field_values v
   where v.org_id = _org_id
     and not (_after ? (case v.field when 'preferred_name' then 'name' else v.field end));

  update public.records_person_state set copied_at = null
   where org_id = _org_id and copied_at is not null;
end;
$$;

revoke execute on function public.records_save_field_settings(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.records_save_field_settings(uuid, jsonb, uuid) to service_role;

-- Writes one person's copy: the profile columns in _profile, the household's
-- anniversary in _household, the grade in _grade, and the sources in
-- _values, all or nothing. _expected holds the values the copy was worked out
-- from; if a member saved anything since, nothing is written and the answer
-- is 'stale', so a member's edit is never overwritten by an older read.
-- Answers 'gone' for a profile not in this church and 'unlinked' for one no
-- longer linked.
--
-- SECURITY INVOKER and executable by the service role only, like
-- records_save_field_settings(). Running as the service role is also what
-- keeps the member-edit triggers below from counting these writes as a
-- member's edit.
create function public.records_apply_copy(
  _org_id uuid,
  _profile_id uuid,
  _expected jsonb,
  _profile jsonb,
  _household jsonb,
  _grade jsonb,
  _values jsonb,
  _filled boolean
) returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  _person public.profiles%rowtype;
  _family public.family_units%rowtype;
  _member public.family_members%rowtype;
  _key text;
begin
  select * into _person from public.profiles
   where id = _profile_id and org_id = _org_id
     for update;
  if not found then
    return 'gone';
  end if;
  if not exists (
    select 1 from public.records_person_links where org_id = _org_id and profile_id = _profile_id
  ) then
    return 'unlinked';
  end if;

  for _key in select jsonb_object_keys(coalesce(_expected -> 'profile', '{}'::jsonb)) loop
    if public.records_pick(to_jsonb(_person), array[_key]) <> public.records_pick(_expected -> 'profile', array[_key]) then
      return 'stale';
    end if;
  end loop;

  if _person.family_id is not null then
    select * into _family from public.family_units
     where id = _person.family_id and org_id = _org_id
       for update;
  end if;
  if jsonb_typeof(_expected -> 'household') = 'object' then
    if _family.id is null then
      return 'stale';
    end if;
    for _key in select jsonb_object_keys(_expected -> 'household') loop
      if public.records_pick(to_jsonb(_family), array[_key]) <> public.records_pick(_expected -> 'household', array[_key]) then
        return 'stale';
      end if;
    end loop;
  elsif _family.id is not null then
    return 'stale';
  end if;

  select * into _member from public.family_members
   where claimed_profile_id = _profile_id and org_id = _org_id
   order by id
   limit 1
     for update;
  if jsonb_typeof(_expected -> 'grade') = 'object' then
    if _member.id is null
       or public.records_pick(to_jsonb(_member), array['graduation_year'])
          <> public.records_pick(_expected -> 'grade', array['graduation_year']) then
      return 'stale';
    end if;
  elsif _member.id is not null then
    return 'stale';
  end if;

  if _profile <> '{}'::jsonb then
    update public.profiles set
      first_name = case when _profile ? 'first_name' then _profile ->> 'first_name' else first_name end,
      last_name = case when _profile ? 'last_name' then _profile ->> 'last_name' else last_name end,
      preferred_name = case when _profile ? 'preferred_name' then _profile ->> 'preferred_name' else preferred_name end,
      title = case when _profile ? 'title' then _profile ->> 'title' else title end,
      suffix = case when _profile ? 'suffix' then _profile ->> 'suffix' else suffix end,
      gender = case when _profile ? 'gender' then _profile ->> 'gender' else gender end,
      phone_mobile = case when _profile ? 'phone_mobile' then _profile ->> 'phone_mobile' else phone_mobile end,
      phone_work = case when _profile ? 'phone_work' then _profile ->> 'phone_work' else phone_work end,
      birth_month = case when _profile ? 'birth_month' then (_profile ->> 'birth_month')::smallint else birth_month end,
      birth_day = case when _profile ? 'birth_day' then (_profile ->> 'birth_day')::smallint else birth_day end,
      birth_year = case when _profile ? 'birth_year' then (_profile ->> 'birth_year')::smallint else birth_year end,
      avatar_url = case when _profile ? 'avatar_url' then _profile ->> 'avatar_url' else avatar_url end
    where id = _profile_id and org_id = _org_id;
  end if;

  if _household <> '{}'::jsonb and _family.id is not null then
    update public.family_units set
      anniversary_month = (_household ->> 'anniversary_month')::smallint,
      anniversary_day = (_household ->> 'anniversary_day')::smallint,
      anniversary_year = (_household ->> 'anniversary_year')::smallint
    where id = _family.id and org_id = _org_id;
  end if;

  if _grade <> '{}'::jsonb and _member.id is not null then
    update public.family_members set graduation_year = (_grade ->> 'graduation_year')::smallint
     where id = _member.id and org_id = _org_id;
  end if;

  insert into public.records_field_values (org_id, profile_id, field, state, church_value, updated_at)
  select _org_id, _profile_id, v.field, v.state, v.church_value, now()
    from jsonb_to_recordset(coalesce(_values, '[]'::jsonb)) as v(field text, state text, church_value jsonb)
  on conflict (org_id, profile_id, field) do update
    set state = excluded.state, church_value = excluded.church_value, updated_at = excluded.updated_at
    where (public.records_field_values.state, public.records_field_values.church_value)
          is distinct from (excluded.state, excluded.church_value);

  insert into public.records_person_state (org_id, profile_id, copied_at, notice_filled_at)
  values (_org_id, _profile_id, now(), case when _filled then now() end)
  on conflict (org_id, profile_id) do update
    set copied_at = excluded.copied_at,
        notice_filled_at = case
          when _filled and public.records_person_state.notice_seen_at is null
            then coalesce(public.records_person_state.notice_filled_at, excluded.notice_filled_at)
          else public.records_person_state.notice_filled_at
        end;

  return 'applied';
end;
$$;

revoke execute on function public.records_apply_copy(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.records_apply_copy(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)
  to service_role;

-- A member's edit of a value from the records, on any screen that saves a
-- profile: a locked field keeps its value, and a member-changeable one is
-- marked changed, cleared, or back to the church's value. Only a signed-in
-- person's write counts; the refresh writes as the service role and passes
-- through. A locked value is kept rather than refused, because every profile
-- form sends each column on save and refusing would make the whole profile
-- unsaveable.
--
-- SECURITY DEFINER because the sources it writes have no member write grant.
-- The org and person come from the row being updated, never a parameter.
create function public.records_profile_member_edit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _value record;
  _columns text[];
  _restore jsonb := '{}'::jsonb;
  _state text;
begin
  if coalesce(current_setting('role', true), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  for _value in
    select v.field, v.church_value, s.mode
      from public.records_field_values v
      left join public.records_field_settings s on s.org_id = v.org_id and s.field = v.field
     where v.org_id = old.org_id
       and v.profile_id = old.id
       and v.field not in ('anniversary', 'grade')
  loop
    _columns := public.records_field_columns(_value.field);
    continue when public.records_pick(to_jsonb(new), _columns) = public.records_pick(to_jsonb(old), _columns);
    if _value.mode = 'locked' then
      _restore := _restore || public.records_pick(to_jsonb(old), _columns);
      continue;
    end if;
    _state := public.records_edit_state(to_jsonb(new), _value.church_value, _columns);
    update public.records_field_values
       set state = _state, updated_at = now()
     where org_id = old.org_id and profile_id = old.id and field = _value.field and state <> _state;
  end loop;
  if _restore <> '{}'::jsonb then
    new := jsonb_populate_record(new, _restore);
  end if;
  return new;
end;
$$;

create trigger records_profile_member_edit
  before update on public.profiles
  for each row execute function public.records_profile_member_edit();

-- The anniversary is the household's, so an edit marks it for everyone in the
-- household whose anniversary came from the records.
create function public.records_household_member_edit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _columns text[] := public.records_field_columns('anniversary');
begin
  if coalesce(current_setting('role', true), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if public.records_pick(to_jsonb(new), _columns) = public.records_pick(to_jsonb(old), _columns) then
    return new;
  end if;
  update public.records_field_values v
     set state = public.records_edit_state(to_jsonb(new), v.church_value, _columns), updated_at = now()
   where v.org_id = old.org_id
     and v.field = 'anniversary'
     and v.profile_id in (select p.id from public.profiles p where p.family_id = old.id and p.org_id = old.org_id)
     and v.state <> public.records_edit_state(to_jsonb(new), v.church_value, _columns);
  return new;
end;
$$;

create trigger records_household_member_edit
  before update of anniversary_month, anniversary_day, anniversary_year on public.family_units
  for each row execute function public.records_household_member_edit();

create function public.records_grade_member_edit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _value record;
  _columns text[] := public.records_field_columns('grade');
begin
  if coalesce(current_setting('role', true), '') not in ('anon', 'authenticated')
     or old.claimed_profile_id is null
     or new.graduation_year is not distinct from old.graduation_year then
    return new;
  end if;
  select v.church_value, s.mode into _value
    from public.records_field_values v
    left join public.records_field_settings s on s.org_id = v.org_id and s.field = v.field
   where v.org_id = old.org_id and v.profile_id = old.claimed_profile_id and v.field = 'grade';
  if not found then
    return new;
  end if;
  if _value.mode = 'locked' then
    new.graduation_year := old.graduation_year;
    return new;
  end if;
  update public.records_field_values
     set state = public.records_edit_state(to_jsonb(new), _value.church_value, _columns), updated_at = now()
   where org_id = old.org_id and profile_id = old.claimed_profile_id and field = 'grade';
  return new;
end;
$$;

create trigger records_grade_member_edit
  before update of graduation_year on public.family_members
  for each row execute function public.records_grade_member_edit();

-- A trigger function is never called directly; EXECUTE is checked only when
-- the trigger is created, so the triggers still fire for every role.
revoke execute on function public.records_profile_member_edit() from public, anon, authenticated;
revoke execute on function public.records_household_member_edit() from public, anon, authenticated;
revoke execute on function public.records_grade_member_edit() from public, anon, authenticated;

comment on table public.records_field_settings is
  'Which fields a church fills from its church records, and whether members may change them. No row: not from the records. Members read it; only the service key writes it, through records_save_field_settings().';
comment on table public.records_field_values is
  'Per linked person and field: whether the value came from the church''s records or the member changed or cleared it, and the church''s last value. A person reads their own rows and a church admin every row; only the service key and the member-edit triggers write it. Goes with the link.';
comment on table public.records_person_state is
  'Per linked person: whether their first copy is done, their one-time notice, and why a church admin should review them. A member reads their notice columns and marks it seen; everything else is the service key''s.';
comment on table public.records_refresh_state is
  'The church records refresh''s mark in the records, its last run and its claim against overlapping runs. Service key only; goes with the connection.';
