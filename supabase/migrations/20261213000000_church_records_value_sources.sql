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
-- copied before they had one would otherwise never bring it in.

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

  update public.records_field_values v set church_value = '{}'::jsonb, updated_at = now()
   where v.org_id = _org_id and v.state = 'cleared' and v.church_value <> '{}'::jsonb
     and not (_after ? (case v.field when 'preferred_name' then 'name' else v.field end));
  delete from public.records_field_values v
   where v.org_id = _org_id and v.state <> 'cleared'
     and not (_after ? (case v.field when 'preferred_name' then 'name' else v.field end));

  update public.records_household_values v set church_value = '{}'::jsonb, updated_at = now()
   where v.org_id = _org_id and v.state = 'cleared' and v.church_value <> '{}'::jsonb
     and not (_after ? v.field);
  delete from public.records_household_values v
   where v.org_id = _org_id and v.state <> 'cleared' and not (_after ? v.field);

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
