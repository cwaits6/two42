-- Where copied details come from, two corrections.
--
-- A member's clear outlives the field being turned off. Turning a field off
-- still removes the sources that follow the church and the ones a member
-- changed, whose values stay as ordinary two42 data, but a 'cleared' source
-- stays, with the church's value forgotten, so turning the field on again
-- leaves the detail empty in copy mode and hidden in live mode. A changed
-- value needs no source to survive: a first fill keeps a value the member
-- entered. An empty one does, or the first fill would fill it.
--
-- Confirming a household asks the next refresh to copy the people it moves
-- in full. The anniversary is the household's and is copied only through a
-- person who is in a household when their copy runs, so someone already
-- copied before they had one would otherwise never bring it in. That full
-- copy, like the one after any field is turned on again, must not refill an
-- anniversary another member of the household cleared.

-- As before, except that a member's clear of a field turned off is kept.
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

  update public.records_person_state set copied_at = null
   where org_id = _org_id and copied_at is not null;
  return 'saved';
end;
$$;

revoke execute on function public.records_save_field_settings(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.records_save_field_settings(uuid, jsonb, uuid) to service_role;

-- As before, and the people it moves are copied in full at the next refresh.
create or replace function public.records_confirm_household(_org_id uuid, _suggestion_id uuid, _confirmed_by uuid)
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
          and pr.relationship is not distinct from p ->> 'from_relationship'
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

  update public.records_person_state set copied_at = null
   where org_id = _org_id and profile_id = any (_ids) and copied_at is not null;

  insert into public.records_household_links (org_id, family_id, connection_id, external_family_id, confirmed_by)
  values (_org_id, _target, _s.connection_id, _s.external_family_id, _confirmed_by)
  on conflict (org_id, family_id) do nothing;

  delete from public.records_household_suggestions where id = _s.id and org_id = _org_id;
  return 'confirmed';
end;
$$;

revoke execute on function public.records_confirm_household(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.records_confirm_household(uuid, uuid, uuid) to service_role;

-- As before, except that a household anniversary a member cleared is held back
-- from the copy of someone who joined the household after the clear.
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
  _anniversary jsonb := (
    select v -> 'church_value' from jsonb_array_elements(coalesce(_values, '[]'::jsonb)) as v
     where v ->> 'field' = 'anniversary'
  );
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
    if (select v.state from public.records_field_values v
         where v.org_id = _org_id and v.profile_id = _profile_id and v.field = _key)
       is distinct from (_expected -> 'states' ->> _key) then
      return 'stale';
    end if;
  end loop;

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

  -- The anniversary is one value for the household but each linked person's
  -- records hold their own. While another linked person's differs, the first
  -- one copied stands: this person's isn't written or announced, and an older
  -- church value is forgotten. A member's change or clear keeps the planned
  -- state and the new church value, so the spouses' sources can agree again
  -- once the church corrects both. Another linked person's clear holds back a
  -- write too: someone who joined the household after the clear has no source
  -- of their own, so their plan reads the cleared anniversary as never filled. The answer is 'held' so the
  -- caller doesn't count the household.
  if _anniversary is not null and _family.id is not null and exists (
    select 1
      from public.records_field_values v
      join public.profiles p on p.id = v.profile_id and p.org_id = v.org_id
     where v.org_id = _org_id
       and v.field = 'anniversary'
       and v.profile_id <> _profile_id
       and p.family_id = _family.id
       and ((v.state = 'cleared' and _household <> '{}'::jsonb)
            or public.records_pick(v.church_value, public.records_field_columns('anniversary'))
               <> public.records_pick(_anniversary, public.records_field_columns('anniversary')))
  ) then
    _household := '{}'::jsonb;
    _values := (
      select coalesce(jsonb_agg(v), '[]'::jsonb) from jsonb_array_elements(_values) as v
       where v ->> 'field' <> 'anniversary'
          or exists (
            select 1 from public.records_field_values k
             where k.org_id = _org_id and k.profile_id = _profile_id and k.field = 'anniversary'
               and k.state <> 'records'
          )
    );
    _filled := array_remove(_filled, 'anniversary');
    _held := true;
    delete from public.records_field_values
     where org_id = _org_id and profile_id = _profile_id and field = 'anniversary' and state = 'records';
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
