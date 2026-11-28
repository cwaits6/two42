-- The household anniversary's source, kept once per household, and every
-- member's clear remembered while the church's records are connected.
--
-- The anniversary is one value for the household, but its source was kept
-- per linked person, so a household's clear bound only the spouses who had a
-- source, and a hold between spouses whose records differ lasted only until
-- the next copy. records_household_anniversary holds it once per household.
-- Each copy reads every linked person in the household and writes the
-- anniversary only while their records agree, so the hold lasts whichever
-- spouse is copied first.
--
-- A member's clear of a detail the records can supply is written as a
-- 'cleared' source even when there was none, whether the field is on or off,
-- for a linked person or a linked household. Written as an upsert, it lands
-- whether it commits before or after a field-off delete of the same source.
--
-- records_field_values rows with field = 'anniversary' are no longer read or
-- written. They are kept, unchanged, for app code still deployed while this
-- rolls out; a later migration drops them.

create table public.records_household_anniversary (
  org_id uuid not null default public.app_current_org_id(),
  family_id uuid not null,
  connection_id uuid not null,
  state text not null check (state in ('records', 'changed', 'cleared')),
  church_value jsonb not null default '{}'::jsonb check (jsonb_typeof(church_value) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (org_id, family_id),
  constraint records_household_anniversary_family_fkey
    foreign key (family_id, org_id) references public.family_units (id, org_id) on delete cascade,
  constraint records_household_anniversary_connection_fkey
    foreign key (org_id, connection_id) references public.records_connections (org_id, connection_id) on delete cascade
);

create index records_household_anniversary_family_id_idx on public.records_household_anniversary (family_id);
create index records_household_anniversary_connection_idx on public.records_household_anniversary (org_id, connection_id);

alter table public.records_household_anniversary enable row level security;

create policy "org isolation" on public.records_household_anniversary
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

revoke all on public.records_household_anniversary from anon, authenticated;

grant select (org_id, family_id, state, church_value) on public.records_household_anniversary to authenticated;
create policy "Household members read their household's anniversary source" on public.records_household_anniversary
  for select to authenticated
  using (
    org_id = (select public.app_request_org_id())
    and (
      (select public.is_admin())
      or (family_id = (select public.current_family_id()) and (select public.is_member()))
    )
  );

comment on table public.records_household_anniversary is
  'Per household: whether its anniversary came from the church''s records or the household changed or cleared it, and the church''s last value. Read by the household''s members and church admins; written only by the service key, records_household_member_edit() and records_live_hide(). Goes with the household and the connection.';

-- In live mode the household's anniversary source records only its own
-- change or clear, as records_live_value_guard() does for the other sources.
create function public.records_live_anniversary_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if (new.state = 'records' or new.church_value <> '{}'::jsonb)
     and exists (select 1 from public.records_org_settings s where s.org_id = new.org_id and s.mode = 'live') then
    raise exception 'live mode stores no anniversary from the church''s records' using errcode = 'RC002';
  end if;
  return new;
end;
$$;

create trigger records_live_anniversary_guard
  before insert or update on public.records_household_anniversary
  for each row execute function public.records_live_anniversary_guard();

revoke execute on function public.records_live_anniversary_guard() from public, anon, authenticated;

-- The per-person anniversary sources, moved to the household each person is
-- in. A clear by anyone in it binds the household, then a change; the
-- church's value is the one matching the household's anniversary, else the
-- one the records agree on. supabase/tests/church_records_household_anniversary_suite.sql
-- runs this same statement.
insert into public.records_household_anniversary (org_id, family_id, connection_id, state, church_value, updated_at)
select v.org_id, p.family_id, (array_agg(l.connection_id))[1],
       case when bool_or(v.state = 'cleared') then 'cleared'
            when bool_or(v.state = 'changed') then 'changed'
            else 'records' end,
       case when exists (select 1 from public.records_org_settings s where s.org_id = v.org_id and s.mode = 'live')
              then '{}'::jsonb
            else coalesce(
              (array_agg(v.church_value order by v.updated_at desc) filter (
                 where not public.records_is_empty(public.records_pick(v.church_value, public.records_field_columns('anniversary')))
                   and public.records_pick(v.church_value, public.records_field_columns('anniversary'))
                       = public.records_pick(jsonb_build_object('anniversary_month', f.anniversary_month,
                           'anniversary_day', f.anniversary_day, 'anniversary_year', f.anniversary_year),
                         public.records_field_columns('anniversary'))))[1],
              case when count(distinct public.records_pick(v.church_value, public.records_field_columns('anniversary'))) filter (
                          where not public.records_is_empty(public.records_pick(v.church_value, public.records_field_columns('anniversary')))) = 1
                   then (array_agg(v.church_value order by v.updated_at desc) filter (
                          where not public.records_is_empty(public.records_pick(v.church_value, public.records_field_columns('anniversary')))))[1]
              end,
              '{}'::jsonb)
       end,
       max(v.updated_at)
  from public.records_field_values v
  join public.profiles p on p.id = v.profile_id and p.org_id = v.org_id
  join public.family_units f on f.id = p.family_id and f.org_id = p.org_id
  join public.records_person_links l on l.org_id = v.org_id and l.profile_id = v.profile_id
 where v.field = 'anniversary'
 group by v.org_id, p.family_id, f.anniversary_month, f.anniversary_day, f.anniversary_year;

-- Writes one person's copy, as before, with the household's anniversary
-- source in records_household_anniversary. _expected -> 'anniversaries'
-- holds the church anniversary read for every linked person in the
-- household, by profile id; a copy that touches the anniversary without
-- exactly those reads is 'stale'. While more than one non-empty value is
-- read, the anniversary is left out and the answer is 'held'. An anniversary
-- the household changed or cleared is never written.
create or replace function public.records_apply_copy(
  _org_id uuid,
  _profile_id uuid,
  _expected jsonb,
  _profile jsonb,
  _household jsonb,
  _grade jsonb,
  _values jsonb,
  _filled text[]
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
  _held boolean := false;
  _columns text[] := public.records_field_columns('anniversary');
  _reads jsonb := _expected -> 'anniversaries';
  _anniversary jsonb := (
    select v from jsonb_array_elements(coalesce(_values, '[]'::jsonb)) as v
     where v ->> 'field' = 'anniversary'
  );
  _own text;
begin
  select * into _person from public.profiles
   where id = _profile_id and org_id = _org_id
     for update;
  if not found then
    return 'gone';
  end if;
  if not exists (
    select 1 from public.records_person_links
     where org_id = _org_id and profile_id = _profile_id
       and external_person_id = _expected ->> 'person'
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
       or public.records_pick(to_jsonb(_member), public.records_field_columns('grade'))
          <> public.records_pick(_expected -> 'grade', public.records_field_columns('grade')) then
      return 'stale';
    end if;
  elsif _member.id is not null then
    return 'stale';
  end if;

  -- A member's change or clear moves a field's state even when its value ends
  -- where the plan read it, and the plan was worked out for the state it read.
  for _key in select jsonb_object_keys(coalesce(_expected -> 'states', '{}'::jsonb)) loop
    if (case when _key = 'anniversary' then
          (select h.state from public.records_household_anniversary h
            where h.org_id = _org_id and h.family_id = _family.id)
        else
          (select v.state from public.records_field_values v
            where v.org_id = _org_id and v.profile_id = _profile_id and v.field = _key)
        end) is distinct from (_expected -> 'states' ->> _key) then
      return 'stale';
    end if;
  end loop;

  if _family.id is null then
    _household := '{}'::jsonb;
    _anniversary := null;
  elsif (_household <> '{}'::jsonb or _anniversary is not null) and jsonb_typeof(_reads) is distinct from 'object' then
    return 'stale';
  end if;
  if _family.id is not null and jsonb_typeof(_reads) = 'object' then
    -- Someone who joined or left the household since the reads changes whose records count.
    if exists (
      select 1 from public.records_person_links l
        join public.profiles p on p.id = l.profile_id and p.org_id = l.org_id
       where l.org_id = _org_id and p.family_id = _family.id and not (_reads ? l.profile_id::text)
    ) or exists (
      select 1 from jsonb_object_keys(_reads) as k
       where not exists (
         select 1 from public.records_person_links l
           join public.profiles p on p.id = l.profile_id and p.org_id = l.org_id
          where l.org_id = _org_id and p.family_id = _family.id and l.profile_id::text = k
       )
    ) then
      return 'stale';
    end if;
    -- A person whose records have no anniversary doesn't count against the others.
    if (select count(distinct public.records_pick(r.value, _columns)) from jsonb_each(_reads) as r
         where not public.records_is_empty(public.records_pick(r.value, _columns))) > 1 then
      _household := '{}'::jsonb;
      _anniversary := null;
      _filled := array_remove(_filled, 'anniversary');
      _held := true;
    end if;
  end if;
  select h.state into _own from public.records_household_anniversary h
   where h.org_id = _org_id and h.family_id = _family.id;
  if _own is not null and _own <> 'records' then
    _household := '{}'::jsonb;
    _filled := array_remove(_filled, 'anniversary');
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

  if _household <> '{}'::jsonb then
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

  if _anniversary is not null then
    insert into public.records_household_anniversary (org_id, family_id, connection_id, state, church_value, updated_at)
    select _org_id, _family.id, l.connection_id, _anniversary ->> 'state', _anniversary -> 'church_value', now()
      from public.records_person_links l
     where l.org_id = _org_id and l.profile_id = _profile_id
    on conflict (org_id, family_id) do update
      set state = case when public.records_household_anniversary.state = 'records' then excluded.state
                       else public.records_household_anniversary.state end,
          church_value = excluded.church_value,
          updated_at = excluded.updated_at
      where (public.records_household_anniversary.state, public.records_household_anniversary.church_value)
            is distinct from (excluded.state, excluded.church_value);
  end if;

  insert into public.records_field_values (org_id, profile_id, field, state, church_value, updated_at)
  select _org_id, _profile_id, v.field, v.state, v.church_value, now()
    from jsonb_to_recordset(coalesce(_values, '[]'::jsonb)) as v(field text, state text, church_value jsonb)
   where v.field <> 'anniversary'
  on conflict (org_id, profile_id, field) do update
    set state = excluded.state, church_value = excluded.church_value, updated_at = excluded.updated_at
    where (public.records_field_values.state, public.records_field_values.church_value)
          is distinct from (excluded.state, excluded.church_value);

  insert into public.records_person_state (org_id, profile_id, copied_at, notice_filled_at)
  values (_org_id, _profile_id, now(), case when cardinality(_filled) > 0 then now() end)
  on conflict (org_id, profile_id) do update
    set copied_at = excluded.copied_at,
        notice_filled_at = case
          when cardinality(_filled) > 0 and public.records_person_state.notice_seen_at is null
            then coalesce(public.records_person_state.notice_filled_at, excluded.notice_filled_at)
          else public.records_person_state.notice_filled_at
        end;

  return case when _held then 'held' else 'applied' end;
end;
$$;

revoke execute on function public.records_apply_copy(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.records_apply_copy(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text[])
  to service_role;

-- A member's edit of a linked person's detail, as before, and a clear is
-- remembered as 'cleared' even with no source yet and with the field turned
-- off. A detail that was always empty isn't cleared, and a locked field
-- still takes the church's value.
create or replace function public.records_profile_member_edit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _field text;
  _columns text[];
  _restore jsonb := '{}'::jsonb;
  _mode text;
  _source public.records_field_values%rowtype;
  _state text;
begin
  if coalesce(current_setting('role', true), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if not exists (
    select 1 from public.records_person_links l where l.org_id = old.org_id and l.profile_id = old.id
  ) then
    return new;
  end if;
  foreach _field in array array['name', 'preferred_name', 'suffix', 'title', 'gender', 'phone_mobile', 'phone_work', 'birthday', 'photo'] loop
    _columns := public.records_field_columns(_field);
    continue when public.records_pick(to_jsonb(new), _columns) = public.records_pick(to_jsonb(old), _columns);
    select s.mode into _mode from public.records_field_settings s where s.org_id = old.org_id and s.field = _field;
    select * into _source from public.records_field_values v
     where v.org_id = old.org_id and v.profile_id = old.id and v.field = _field;
    if _mode = 'locked' then
      if _source.field is not null then
        _restore := _restore || public.records_pick(to_jsonb(old), _columns);
      end if;
      continue;
    end if;
    if public.records_is_empty(public.records_pick(to_jsonb(new), _columns)) then
      insert into public.records_field_values (org_id, profile_id, field, state)
      values (old.org_id, old.id, _field, 'cleared')
      on conflict (org_id, profile_id, field) do update
        set state = 'cleared', updated_at = now()
        where public.records_field_values.state <> 'cleared';
    elsif _source.field is not null then
      _state := public.records_edit_state(to_jsonb(new), _source.church_value, _columns);
      update public.records_field_values
         set state = _state, updated_at = now()
       where org_id = old.org_id and profile_id = old.id and field = _field and state <> _state;
    end if;
  end loop;
  if _restore <> '{}'::jsonb then
    new := jsonb_populate_record(new, _restore);
  end if;
  return new;
end;
$$;

-- The household's anniversary source, once for the household: a clear is
-- remembered while anyone in it is linked, and an edit marks it changed or
-- back to the church's value.
create or replace function public.records_household_member_edit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _columns text[] := public.records_field_columns('anniversary');
  _connection uuid;
begin
  if coalesce(current_setting('role', true), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if public.records_pick(to_jsonb(new), _columns) = public.records_pick(to_jsonb(old), _columns) then
    return new;
  end if;
  if public.records_is_empty(public.records_pick(to_jsonb(new), _columns)) then
    select l.connection_id into _connection
      from public.records_person_links l
      join public.profiles p on p.id = l.profile_id and p.org_id = l.org_id
     where l.org_id = old.org_id and p.family_id = old.id
     limit 1;
    if _connection is null then
      update public.records_household_anniversary set state = 'cleared', updated_at = now()
       where org_id = old.org_id and family_id = old.id and state <> 'cleared';
    else
      insert into public.records_household_anniversary (org_id, family_id, connection_id, state)
      values (old.org_id, old.id, _connection, 'cleared')
      on conflict (org_id, family_id) do update
        set state = 'cleared', updated_at = now()
        where public.records_household_anniversary.state <> 'cleared';
    end if;
    return new;
  end if;
  update public.records_household_anniversary h
     set state = public.records_edit_state(to_jsonb(new), h.church_value, _columns), updated_at = now()
   where h.org_id = old.org_id and h.family_id = old.id
     and h.state <> public.records_edit_state(to_jsonb(new), h.church_value, _columns);
  return new;
end;
$$;

-- As before, and a clear of a linked person's grade is remembered even with
-- no source yet.
create or replace function public.records_grade_member_edit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _mode text;
  _source public.records_field_values%rowtype;
  _columns text[] := public.records_field_columns('grade');
begin
  if coalesce(current_setting('role', true), '') not in ('anon', 'authenticated')
     or old.claimed_profile_id is null
     or public.records_pick(to_jsonb(new), _columns) = public.records_pick(to_jsonb(old), _columns) then
    return new;
  end if;
  -- The copy owns only the person's lowest-id claimed row, as records_apply_copy() picks it.
  if exists (
    select 1 from public.family_members m
     where m.claimed_profile_id = old.claimed_profile_id and m.org_id = old.org_id and m.id < old.id
  ) or not exists (
    select 1 from public.records_person_links l
     where l.org_id = old.org_id and l.profile_id = old.claimed_profile_id
  ) then
    return new;
  end if;
  select s.mode into _mode from public.records_field_settings s where s.org_id = old.org_id and s.field = 'grade';
  select * into _source from public.records_field_values v
   where v.org_id = old.org_id and v.profile_id = old.claimed_profile_id and v.field = 'grade';
  if _mode = 'locked' then
    if _source.field is not null then
      new := jsonb_populate_record(new, public.records_pick(to_jsonb(old), _columns));
    end if;
    return new;
  end if;
  if public.records_is_empty(public.records_pick(to_jsonb(new), _columns)) then
    insert into public.records_field_values (org_id, profile_id, field, state)
    values (old.org_id, old.claimed_profile_id, 'grade', 'cleared')
    on conflict (org_id, profile_id, field) do update
      set state = 'cleared', updated_at = now()
      where public.records_field_values.state <> 'cleared';
  elsif _source.field is not null then
    update public.records_field_values
       set state = public.records_edit_state(to_jsonb(new), _source.church_value, _columns), updated_at = now()
     where org_id = old.org_id and profile_id = old.claimed_profile_id and field = 'grade';
  end if;
  return new;
end;
$$;

-- As before, and a clear of a linked household's address or home phone is
-- remembered even with no source yet.
create or replace function public.records_household_value_edit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _field text;
  _columns text[];
  _source public.records_household_values%rowtype;
  _state text;
begin
  if coalesce(current_setting('role', true), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if not exists (
    select 1 from public.records_household_links k where k.org_id = old.org_id and k.family_id = old.id
  ) then
    return new;
  end if;
  foreach _field in array array['address', 'phone_home'] loop
    _columns := case _field
      when 'address' then array['address_line1', 'address_line2', 'city', 'state', 'postal_code']
      else array['phone_home']
    end;
    continue when public.records_pick(to_jsonb(new), _columns) = public.records_pick(to_jsonb(old), _columns);
    select * into _source from public.records_household_values v
     where v.org_id = old.org_id and v.family_id = old.id and v.field = _field;
    if public.records_is_empty(public.records_pick(to_jsonb(new), _columns)) then
      insert into public.records_household_values (org_id, family_id, field, state)
      values (old.org_id, old.id, _field, 'cleared')
      on conflict (org_id, family_id, field) do update
        set state = 'cleared', updated_at = now()
        where public.records_household_values.state <> 'cleared';
    elsif _source.field is not null then
      _state := public.records_edit_state(to_jsonb(new), _source.church_value, _columns);
      update public.records_household_values
         set state = _state, updated_at = now()
       where org_id = old.org_id and family_id = old.id and field = _field and state <> _state;
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function public.records_profile_member_edit() from public, anon, authenticated;
revoke execute on function public.records_household_member_edit() from public, anon, authenticated;
revoke execute on function public.records_grade_member_edit() from public, anon, authenticated;
revoke execute on function public.records_household_value_edit() from public, anon, authenticated;

-- As before, and the anniversary turned off loses its household sources the
-- same way, keeping a clear without the church's value.
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

  -- Delete before forgetting: a member's edit can turn a source 'cleared'
  -- without this lock, and the forget's later snapshot then still sees it.
  delete from public.records_field_values v
   where v.org_id = _org_id and v.state <> 'cleared'
     and not (_after ? (case v.field when 'preferred_name' then 'name' else v.field end));
  update public.records_field_values v set church_value = '{}'::jsonb, updated_at = now()
   where v.org_id = _org_id and v.state = 'cleared' and v.church_value <> '{}'::jsonb
     and not (_after ? (case v.field when 'preferred_name' then 'name' else v.field end));

  delete from public.records_household_values v
   where v.org_id = _org_id and v.state <> 'cleared' and not (_after ? v.field);
  update public.records_household_values v set church_value = '{}'::jsonb, updated_at = now()
   where v.org_id = _org_id and v.state = 'cleared' and v.church_value <> '{}'::jsonb
     and not (_after ? v.field);

  if not (_after ? 'anniversary') then
    delete from public.records_household_anniversary h
     where h.org_id = _org_id and h.state <> 'cleared';
    update public.records_household_anniversary h set church_value = '{}'::jsonb, updated_at = now()
     where h.org_id = _org_id and h.state = 'cleared' and h.church_value <> '{}'::jsonb;
  end if;

  update public.records_person_state set copied_at = null
   where org_id = _org_id and copied_at is not null;
  return 'saved';
end;
$$;

revoke execute on function public.records_save_field_settings(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.records_save_field_settings(uuid, jsonb, uuid) to service_role;

-- Households whose anniversary is still the church's: its source is
-- 'records' and someone in it is linked. A household with nobody linked
-- holds ordinary two42 data.
create or replace function public.records_live_anniversary_households(_org_id uuid)
  returns table (family_id uuid)
  language sql stable
  security invoker
  set search_path = ''
as $$
  select h.family_id
    from public.records_household_anniversary h
   where h.org_id = _org_id and h.state = 'records'
     and exists (
       select 1 from public.records_person_links l
         join public.profiles p on p.id = l.profile_id and p.org_id = l.org_id
        where l.org_id = _org_id and p.family_id = h.family_id
     );
$$;

revoke execute on function public.records_live_anniversary_households(uuid) from public, anon, authenticated;
grant execute on function public.records_live_anniversary_households(uuid) to service_role;

-- As before, with the household anniversary sources rewritten like the others.
create or replace function public.records_save_mode(_org_id uuid, _mode text, _updated_by uuid)
  returns jsonb
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  _running timestamptz;
  _before text;
  _removed integer := 0;
begin
  if _mode not in ('copy', 'live') then
    raise exception 'records_save_mode: unknown mode' using errcode = '22023';
  end if;
  insert into public.records_refresh_state (org_id, connection_id)
  select org_id, connection_id from public.records_connections where org_id = _org_id
  on conflict (org_id) do nothing;
  select running_since into _running from public.records_refresh_state
   where org_id = _org_id
     for update;
  if _running is not null and _running > now() - interval '15 minutes' then
    return jsonb_build_object('outcome', 'busy');
  end if;

  select mode into _before from public.records_org_settings where org_id = _org_id for update;
  _before := coalesce(_before, 'copy');
  if _before = _mode then
    return jsonb_build_object('outcome', 'saved', 'removed', 0);
  end if;

  if _mode = 'live' then
    -- Locks the rows to clear before any statement below reads their sources.
    -- An UPDATE that waits on a member's edit rechecks the row it updates but
    -- not the source it joined, so it would clear the member's new value;
    -- once locked, the next statements see the source that edit wrote.
    perform 1 from public.profiles p
      join public.records_field_values v on v.profile_id = p.id and v.org_id = p.org_id
     where p.org_id = _org_id and v.field = 'birthday' and v.state = 'records'
       for update of p;
    perform 1 from public.family_members m
      join public.records_field_values v on v.profile_id = m.claimed_profile_id and v.org_id = m.org_id
     where m.org_id = _org_id and v.field = 'grade' and v.state = 'records'
       for update of m;
    perform 1 from public.family_units f
     where f.org_id = _org_id
       and (f.id in (select h.family_id from public.records_live_anniversary_households(_org_id) h)
            or f.id in (select hv.family_id from public.records_household_values hv
                         where hv.org_id = _org_id and hv.field = 'address' and hv.state = 'records'))
       for update of f;

    _removed := public.records_live_copied_count(_org_id);

    update public.profiles p set birth_month = null, birth_day = null, birth_year = null
      from public.records_field_values v
     where v.org_id = _org_id and v.field = 'birthday' and v.state = 'records'
       and p.id = v.profile_id and p.org_id = _org_id;

    -- The copy owns only the person's lowest-id claimed row, as records_apply_copy() picks it.
    update public.family_members m set graduation_year = null
      from public.records_field_values v
     where v.org_id = _org_id and v.field = 'grade' and v.state = 'records'
       and m.org_id = _org_id
       and m.id = (
         select m2.id from public.family_members m2
          where m2.claimed_profile_id = v.profile_id and m2.org_id = _org_id
          order by m2.id limit 1);

    update public.family_units f set anniversary_month = null, anniversary_day = null, anniversary_year = null
     where f.org_id = _org_id
       and f.id in (select h.family_id from public.records_live_anniversary_households(_org_id) h);

    update public.family_units f
       set address_line1 = null, address_line2 = null, city = null, state = null, postal_code = null
      from public.records_household_values v
     where v.org_id = _org_id and v.field = 'address' and v.state = 'records'
       and f.id = v.family_id and f.org_id = _org_id;

    delete from public.records_field_values
     where org_id = _org_id and public.records_live_only_field(field) and state = 'records';
    update public.records_field_values set church_value = '{}'::jsonb, updated_at = now()
     where org_id = _org_id and public.records_live_only_field(field) and church_value <> '{}'::jsonb;
    delete from public.records_household_values
     where org_id = _org_id and public.records_live_only_field(field) and state = 'records';
    update public.records_household_values set church_value = '{}'::jsonb, updated_at = now()
     where org_id = _org_id and public.records_live_only_field(field) and church_value <> '{}'::jsonb;
    delete from public.records_household_anniversary
     where org_id = _org_id and state = 'records';
    update public.records_household_anniversary set church_value = '{}'::jsonb, updated_at = now()
     where org_id = _org_id and church_value <> '{}'::jsonb;

    update public.records_child_suggestions
       set birth_month = null, birth_day = null, graduation_year = null, updated_at = now()
     where org_id = _org_id and state = 'open'
       and (birth_month is not null or birth_day is not null or graduation_year is not null);
  else
    update public.records_person_state set copied_at = null
     where org_id = _org_id and copied_at is not null;
  end if;

  -- Last, so the guards still see copy mode while the sources are rewritten.
  insert into public.records_org_settings (org_id, mode, updated_by, updated_at)
  values (_org_id, _mode, _updated_by, now())
  on conflict (org_id) do update
    set mode = excluded.mode, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('outcome', 'saved', 'removed', _removed);
end;
$$;

revoke execute on function public.records_save_mode(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.records_save_mode(uuid, text, uuid) to service_role;

-- As before, with the household's anniversary hide kept once per household.
-- It needs someone in the household linked, or a source already there.
create or replace function public.records_live_hide(_field text, _hidden boolean)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _me public.profiles%rowtype;
  _connection uuid;
begin
  select * into _me from public.profiles
   where id = auth.uid() and org_id = public.app_current_org_id();
  if not found or _me.role not in ('member', 'admin')
     or not exists (select 1 from public.records_org_settings where org_id = _me.org_id and mode = 'live') then
    raise exception 'records_live_hide: not allowed' using errcode = 'RC001';
  end if;

  if _field = 'birthday' then
    if not exists (select 1 from public.records_person_links where org_id = _me.org_id and profile_id = _me.id) then
      raise exception 'records_live_hide: not allowed' using errcode = 'RC001';
    end if;
    if _hidden then
      insert into public.records_field_values (org_id, profile_id, field, state)
      values (_me.org_id, _me.id, 'birthday', 'cleared')
      on conflict (org_id, profile_id, field) do nothing;
    else
      delete from public.records_field_values
       where org_id = _me.org_id and profile_id = _me.id and field = 'birthday' and state = 'cleared';
    end if;
    return;
  end if;

  if _field not in ('anniversary', 'address') or _me.family_id is null
     or _me.relationship not in ('primary', 'spouse') then
    raise exception 'records_live_hide: not allowed' using errcode = 'RC001';
  end if;

  if _field = 'address' then
    if not exists (
      select 1 from public.records_household_links where org_id = _me.org_id and family_id = _me.family_id
    ) then
      raise exception 'records_live_hide: not allowed' using errcode = 'RC001';
    end if;
    if _hidden then
      insert into public.records_household_values (org_id, family_id, field, state)
      values (_me.org_id, _me.family_id, 'address', 'cleared')
      on conflict (org_id, family_id, field) do nothing;
    else
      delete from public.records_household_values
       where org_id = _me.org_id and family_id = _me.family_id and field = 'address' and state = 'cleared';
    end if;
    return;
  end if;

  select l.connection_id into _connection
    from public.records_person_links l
    join public.profiles p on p.id = l.profile_id and p.org_id = l.org_id
   where l.org_id = _me.org_id and p.family_id = _me.family_id
   limit 1;
  if _connection is null and not exists (
    select 1 from public.records_household_anniversary
     where org_id = _me.org_id and family_id = _me.family_id
  ) then
    raise exception 'records_live_hide: not allowed' using errcode = 'RC001';
  end if;
  if not _hidden then
    delete from public.records_household_anniversary
     where org_id = _me.org_id and family_id = _me.family_id and state = 'cleared';
  elsif _connection is not null then
    insert into public.records_household_anniversary (org_id, family_id, connection_id, state)
    values (_me.org_id, _me.family_id, _connection, 'cleared')
    on conflict (org_id, family_id) do nothing;
  end if;
end;
$$;

revoke execute on function public.records_live_hide(text, boolean) from public, anon;
grant execute on function public.records_live_hide(text, boolean) to authenticated;
